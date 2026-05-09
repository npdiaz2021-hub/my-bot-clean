require('dotenv').config();

const { CommandStore } = require('../shared/store');
const { createWebsite } = require('../website/server');
const { TwitchBot } = require('../bot/twitchBot');

console.log('Starting TimmySudo control center...');

const store = new CommandStore();
store.load();

const website = createWebsite({
  store,
  getBotStatus: () => bot.getStatus()
});

const bot = new TwitchBot({
  store,
  webUrl: website.publicUrl
});

const server = website.start();
bot.start();

function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  server.close(() => {
    console.log('Website stopped.');
  });

  bot.stop().finally(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error(`Unexpected app failure: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`Unexpected async failure: ${reason}`);
  process.exit(1);
});
