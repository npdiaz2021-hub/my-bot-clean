require('dotenv').config();
const tmi = require('tmi.js');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

console.log("Bot starting...");

// =========================
// File paths
// =========================
const COMMANDS_FILE = path.join(__dirname, 'commands.json');
const ROLES_FILE = path.join(__dirname, 'roles.json');

// =========================
// Data stores
// =========================
let customCommands = {};
let roles = { trusted: [] };
let cooldowns = {}; // { commandName: timestamp }

// =========================
// Load / Save helpers
// =========================
function loadCommands() {
  try {
    customCommands = JSON.parse(fs.readFileSync(COMMANDS_FILE, 'utf8'));
  } catch (err) {
    customCommands = {};
  }
}

function saveCommands() {
  fs.writeFileSync(COMMANDS_FILE, JSON.stringify(customCommands, null, 2));
}

function loadRoles() {
  try {
    roles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
  } catch (err) {
    roles = { trusted: [] };
  }
}

function saveRoles() {
  fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2));
}

loadCommands();
loadRoles();

function getLocalIPAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// =========================
// Web admin UI
// =========================
const app = express();
const WEB_PORT = process.env.PORT || process.env.WEB_PORT || 61234;
const WEB_HOST = process.env.WEB_HOST || '0.0.0.0';
const ADMIN_CODE = process.env.ADMIN_CODE || 'streamadmin';
const WEB_URL = process.env.WEB_URL || `http://${getLocalIPAddress()}:${WEB_PORT}`;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function sendError(res, status, error, code) {
  return res.status(status).json({ error, code, contact: 'noahisontopfr' });
}

function requireAdminCode(req, res, next) {
  const code = req.headers['x-admin-code'] || req.body.adminCode || req.query.adminCode;
  if (!code || code !== ADMIN_CODE) {
    return sendError(res, 401, 'Admin code required', 'ADMIN_CODE_REQUIRED');
  }
  next();
}

app.post('/api/auth', (req, res) => {
  const { code } = req.body;
  if (code === ADMIN_CODE) {
    return res.json({ success: true });
  }
  return sendError(res, 401, 'Invalid admin code', 'INVALID_ADMIN_CODE');
});

app.get('/api/commands', (req, res) => {
  res.json(customCommands);
});

app.get('/api/commands/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const cmd = customCommands[name];
  if (!cmd) return sendError(res, 404, 'Command not found', 'COMMAND_NOT_FOUND');
  res.json(cmd);
});

app.post('/api/commands', requireAdminCode, (req, res) => {
  const { name, response, cooldown = 5, userlevel = 'everyone', aliases = [], enabled = true } = req.body;
  if (!name || !response) {
    return sendError(res, 400, 'Name and response are required', 'MISSING_FIELDS');
  }

  if (customCommands[name]) {
    return sendError(res, 409, 'Command already exists', 'COMMAND_EXISTS');
  }

  customCommands[name] = { response, cooldown, userlevel, aliases, count: 0, enabled };
  saveCommands();
  loadCommands(); // Reload commands to sync with file
  res.status(201).json({ name, command: customCommands[name] });
});

app.put('/api/commands/:name', requireAdminCode, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const cmd = customCommands[name];
  if (!cmd) return sendError(res, 404, 'Command not found', 'COMMAND_NOT_FOUND');

  const { response, cooldown, userlevel, aliases, enabled } = req.body;
  if (response !== undefined) cmd.response = response;
  if (cooldown !== undefined) cmd.cooldown = cooldown;
  if (userlevel !== undefined) cmd.userlevel = userlevel;
  if (aliases !== undefined) cmd.aliases = aliases;
  if (enabled !== undefined) cmd.enabled = enabled;

  saveCommands();
  loadCommands(); // Reload commands to sync with file
  res.json({ name, command: cmd });
});

app.delete('/api/commands/:name', requireAdminCode, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!customCommands[name]) return sendError(res, 404, 'Command not found', 'COMMAND_NOT_FOUND');
  delete customCommands[name];
  saveCommands();
  loadCommands(); // Reload commands to sync with file
  res.json({ deleted: name });
});

app.use((err, req, res, next) => {
  console.error('Express error:', err);
  if (res.headersSent) return next(err);
  sendError(res, 500, 'Internal server error', 'INTERNAL_SERVER_ERROR');
});

app.listen(WEB_PORT, WEB_HOST, () => {
  console.log(`Web admin running on ${WEB_URL}`);
});

// =========================
// Greeting memory (1 hour reset)
// =========================
let greetedUsers = new Set();

setInterval(() => {
  greetedUsers.clear();
  console.log("Greeting memory reset (1 hour passed)");
}, 3600000);

// =========================
 // Twitch client setup
// =========================
const client = new tmi.Client({
  identity: {
    username: process.env.TWITCH_USERNAME,
    password: process.env.TWITCH_OAUTH
  },
  channels: [process.env.TWITCH_CHANNEL]
});

client.connect().then(() => {
  console.log(`Connected to Twitch as ${process.env.TWITCH_USERNAME}`);
});

// =========================
// Permission system
// =========================
function getUserLevels(tags) {
  const levels = new Set();
  levels.add('everyone');

  const badges = tags.badges || {};
  const isBroadcaster = badges.broadcaster === '1';
  const isMod = tags.mod;
  const isSub = badges.subscriber === '1' || badges.founder === '1';
  const isVip = badges.vip === '1';

  if (isBroadcaster) levels.add('broadcaster');
  if (isMod) levels.add('moderator');
  if (isSub) levels.add('subscriber');
  if (isVip) levels.add('vip');

  const username = (tags['display-name'] || '').toLowerCase();
  const trustedList = (roles.trusted || []).map(u => u.toLowerCase());
  if (trustedList.includes(username)) {
    levels.add('trusted');
  }

  return levels;
}

function hasPermission(required, userLevels) {
  if (!required || required === 'everyone') return true;
  if (userLevels.has('broadcaster')) return true; // owner override
  return userLevels.has(required);
}

// =========================
// Cooldown system
// =========================
function isOnCooldown(commandName, cooldownSeconds) {
  if (!cooldownSeconds || cooldownSeconds <= 0) return false;
  const now = Date.now();
  const last = cooldowns[commandName] || 0;
  return (now - last) < cooldownSeconds * 1000;
}

function setCooldown(commandName) {
  cooldowns[commandName] = Date.now();
}

// =========================
// Variable parser
// =========================
function parseVariables(response, cmd, context) {
  let out = response;

  // $(user)
  out = out.replace(/\$\((user)\)/gi, context.username);

  // $(channel)
  out = out.replace(/\$\((channel)\)/gi, context.channel.replace('#', ''));

  // $(time) — Timmy's current time in CST
  out = out.replace(
    /\$\((time)\)/gi,
    new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago" })
  );

  // $(count)
  if (/\$\((count)\)/i.test(out)) {
    cmd.count = (cmd.count || 0) + 1;
    out = out.replace(/\$\((count)\)/gi, String(cmd.count));
    saveCommands();
  }

  return out;
}

// =========================
// Command lookup (name + aliases)
// =========================
function findCommand(trigger) {
  const lower = trigger.toLowerCase();
  if (lower === '!commands') return null;
  if (customCommands[trigger]) return { name: trigger, cmd: customCommands[trigger] };

  for (const [name, cmd] of Object.entries(customCommands)) {
    const aliases = cmd.aliases || [];
    if (aliases.map(a => a.toLowerCase()).includes(lower)) {
      return { name, cmd };
    }
  }

  return null;
}

// =========================
// Command management helpers
// =========================
function addCommand(name, response) {
  if (customCommands[name]) return false; // Already exists
  customCommands[name] = {
    response: response,
    cooldown: 5,
    userlevel: "everyone",
    aliases: [],
    count: 0,
    enabled: true
  };
  saveCommands();
  return true;
}

function editCommand(name, newResponse) {
  if (!customCommands[name]) return false;
  customCommands[name].response = newResponse;
  saveCommands();
  return true;
}

function deleteCommand(name) {
  if (!customCommands[name]) return false;
  delete customCommands[name];
  saveCommands();
  return true;
}

// =========================
// Message handler
// =========================
client.on('message', (channel, tags, message, self) => {
  if (self) return;

  const username = tags['display-name'] || 'User';
  const msg = message.trim();
  const msgLower = msg.toLowerCase();
  const userLevels = getUserLevels(tags);

  // =========================
  // Command management (broadcaster/mod/trusted)
// =========================
  const isManager =
    userLevels.has('broadcaster') ||
    userLevels.has('moderator') ||
    userLevels.has('trusted');

  // #6add !cmd response
  if (msgLower.startsWith('#6add ') && isManager) {
    const parts = message.split(' ');
    const commandName = parts[1];
    const response = parts.slice(2).join(' ');

    if (!commandName || !response) {
      client.say(channel, `Error: INVALID_SYNTAX - Usage: #6add !command Your message here`);
      return;
    }

    if (!addCommand(commandName, response)) {
      client.say(channel, `Error: COMMAND_EXISTS - ${commandName}`);
      return;
    }

    client.say(channel, `Success: COMMAND_ADDED - ${commandName}`);
    return;
  }

  // #6edit !cmd new response
  if (msgLower.startsWith('#6edit ') && isManager) {
    const parts = message.split(' ');
    const commandName = parts[1];
    const newResponse = parts.slice(2).join(' ');

    if (!commandName || !newResponse) {
      client.say(channel, `Error: INVALID_SYNTAX - Usage: #6edit !command New response here`);
      return;
    }

    if (!editCommand(commandName, newResponse)) {
      client.say(channel, `Error: COMMAND_NOT_FOUND - ${commandName}`);
      return;
    }

    client.say(channel, `Success: COMMAND_UPDATED - ${commandName}`);
    return;
  }

  // #6del !cmd
  if (msgLower.startsWith('#6del ') && isManager) {
    const parts = message.split(' ');
    const commandName = parts[1];

    if (!commandName) {
      client.say(channel, `Error: INVALID_SYNTAX - Usage: #6del !command`);
      return;
    }

    if (!deleteCommand(commandName)) {
      client.say(channel, `Error: COMMAND_NOT_FOUND - ${commandName}`);
      return;
    }

    client.say(channel, `Success: COMMAND_DELETED - ${commandName}`);
    return;
  }

  // !commands — send users to the web page to view commands
  // =========================
  // Custom commands
  // =========================
  if (msg.startsWith('!')) {
    const found = findCommand(msg);
    if (found) {
      const { name, cmd } = found;
      
      if (cmd.enabled === false) {
        client.say(channel, "Error: COMMAND_DISABLED");
        return;
      }

      const requiredLevel = cmd.userlevel || 'everyone';
      if (!hasPermission(requiredLevel, userLevels)) {
        client.say(channel, "Error: INSUFFICIENT_PERMISSIONS");
        return;
      }

      const cooldownSeconds = cmd.cooldown || 0;
      if (isOnCooldown(name, cooldownSeconds)) {
        client.say(channel, "Error: COMMAND_ON_COOLDOWN");
        return;
      }

      const context = { username, channel, command: name };
      const response = parseVariables(cmd.response, cmd, context);

      client.say(channel, response);
      setCooldown(name);
      return;
    } else {
      // Command not found
      client.say(channel, "Error: COMMAND_NOT_FOUND");

  // =========================
  // Greeting responses
  // =========================
  const greetingResponses = {
    "hello": `Hello ${username}!`,
    "hi": `Hi there, ${username}!`,
    "hey": `Hey ${username}!`,
    "yo": `Yo ${username}, what's good!`,
    "sup": `Not much, ${username}! What's up with you?`,
    "hola": `¡Hola ${username}!`,
    "hiya": `Hiya ${username}!`,
    "heyo": `Heyo ${username}!`,
    "greetings": `Greetings, ${username}!`
  };

  if (!greetedUsers.has(username)) {
    for (const greet in greetingResponses) {
      if (msgLower.includes(greet)) {
        client.say(channel, greetingResponses[greet]);
        greetedUsers.add(username);
        break;
      }
    }
  }

  // =========================
  // Built-in commands
  // =========================
  if (msgLower === '!hello') {
    client.say(channel, `Hello ${username}!`);
  }

  if (msgLower === '!discord') {
    client.say(channel, `Join The Discord — https://discord.gg/fb3ZpTzFmC`);
  }
});

// =========================
// Disconnect handler
// =========================
client.on('disconnected', (reason) => {
  console.log(`Disconnected from Twitch: ${reason}`);
});
