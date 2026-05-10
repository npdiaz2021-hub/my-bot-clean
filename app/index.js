require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { CommandStore } = require('../shared/store');
const { createWebsite } = require('../website/server');
const { TwitchBot } = require('../bot/twitchBot');

const LOCK_DIR = path.join(__dirname, '..', 'data');
const LOCK_FILE = path.join(LOCK_DIR, 'app.lock');
const LEGACY_LOCK_FILE = path.join(LOCK_DIR, 'bot.lock');
const BOT_ONLY_MODE = process.argv.includes('--bot-only') || process.env.WEBSITE_ENABLED === 'false';
const SHOULD_RUN_TWITCH_BOT = process.env.TWITCH_BOT_ENABLED !== 'false'
  && Boolean(process.env.TWITCH_USERNAME && process.env.TWITCH_OAUTH && process.env.TWITCH_CHANNEL);
const SHOULD_LOCK_INSTANCE = process.env.INSTANCE_LOCK_ENABLED !== 'false';

function isProcessRunning(pid) {
  if (!pid || pid === process.pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

function sleep(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function terminatePreviousInstance(pid) {
  if (!isProcessRunning(pid)) return true;

  console.warn(`Terminating previous bot instance PID ${pid} before restart.`);

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    console.warn(`Could not signal previous bot instance ${pid}: ${err.message}`);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessRunning(pid)) return true;
    sleep(250);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    console.error(`Could not terminate previous bot instance ${pid}: ${err.message}`);
    return false;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessRunning(pid)) return true;
    sleep(250);
  }

  return !isProcessRunning(pid);
}

function acquireLock() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  terminateFromLockFile(LOCK_FILE);
  terminateFromLockFile(LEGACY_LOCK_FILE);

  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
  } catch (err) {
    console.error(`Could not acquire app lock: ${err.message}`);
    process.exit(1);
  }
}

function terminateFromLockFile(file) {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    const existingPid = Number(existing);
    if (isProcessRunning(existingPid)) {
      if (!terminatePreviousInstance(existingPid)) {
        console.error(`Another app instance is already running as PID ${existingPid}.`);
        process.exit(1);
      }
    }
    fs.unlinkSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Could not inspect app lock ${path.basename(file)}: ${err.message}`);
      process.exit(1);
    }
  }
}

function releaseLock() {
  try {
    const lockedPid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    if (lockedPid === String(process.pid)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Could not release app lock: ${err.message}`);
    }
  }
}

if (SHOULD_LOCK_INSTANCE) {
  acquireLock();
}

console.log(BOT_ONLY_MODE ? 'Starting TimmySudo Twitch bot...' : 'Starting TimmySudo control center...');

const store = new CommandStore();
store.load();

let bot;
let server = null;
let website = null;

if (!BOT_ONLY_MODE) {
  website = createWebsite({
    store,
    getBotStatus: () => bot.getStatus()
  });
}

bot = new TwitchBot({
  store,
  webUrl: website ? website.publicUrl : process.env.WEB_URL
});

if (website) {
  server = website.start();
} else {
  console.log('Website disabled. Twitch bot will run without the dashboard server.');
}

bot.start();

function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  if (server) {
    server.close(() => {
      console.log('Website stopped.');
    });
  }

  bot.stop().finally(() => {
    if (SHOULD_LOCK_INSTANCE) {
      releaseLock();
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error(`Unexpected app failure: ${err.message}`);
  console.error(err.stack);
  if (SHOULD_LOCK_INSTANCE) {
    releaseLock();
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`Unexpected async failure: ${reason}`);
  if (SHOULD_LOCK_INSTANCE) {
    releaseLock();
  }
  process.exit(1);
});

process.on('exit', () => {
  if (SHOULD_LOCK_INSTANCE) {
    releaseLock();
  }
});
