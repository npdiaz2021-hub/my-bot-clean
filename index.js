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
let botConnected = false;

// =========================
// Error codes reference
// =========================
const ERROR_CODES = {
  // UI/Button Errors (1xxx)
  UI_BUTTON_FAILED: 'UI_BUTTON_FAILED',
  UI_NOT_RESPONDING: 'UI_NOT_RESPONDING',
  UI_RENDER_ERROR: 'UI_RENDER_ERROR',
  UI_FETCH_ERROR: 'UI_FETCH_ERROR',
  
  // Sync Errors (2xxx)
  SYNC_FAILED: 'SYNC_FAILED',
  SYNC_TIMEOUT: 'SYNC_TIMEOUT',
  COMMAND_NOT_SYNCED: 'COMMAND_NOT_SYNCED',
  
  // File I/O Errors (3xxx)
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
  FILE_PARSE_ERROR: 'FILE_PARSE_ERROR',
  FILE_CORRUPTED: 'FILE_CORRUPTED',
  
  // Bot Connection Errors (4xxx)
  BOT_DISCONNECTED: 'BOT_DISCONNECTED',
  BOT_CONNECT_FAILED: 'BOT_CONNECT_FAILED',
  BOT_NOT_RESPONDING: 'BOT_NOT_RESPONDING',
  BOT_AUTH_FAILED: 'BOT_AUTH_FAILED',
  
  // API/Permission Errors (5xxx)
  ADMIN_CODE_REQUIRED: 'ADMIN_CODE_REQUIRED',
  INVALID_ADMIN_CODE: 'INVALID_ADMIN_CODE',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Command Errors (6xxx)
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  COMMAND_EXISTS: 'COMMAND_EXISTS',
  COMMAND_DISABLED: 'COMMAND_DISABLED',
  COMMAND_ON_COOLDOWN: 'COMMAND_ON_COOLDOWN',
  INVALID_SYNTAX: 'INVALID_SYNTAX',
  MISSING_FIELDS: 'MISSING_FIELDS',
  
  // Server Errors (7xxx)
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT'
};

// =========================
// Load / Save helpers
// =========================
function loadCommands() {
  try {
    const data = fs.readFileSync(COMMANDS_FILE, 'utf8');
    customCommands = JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Commands file not found, creating new one');
      customCommands = {};
    } else if (err instanceof SyntaxError) {
      console.error(`Error parsing commands file: ${err.message}`);
      customCommands = {};
    } else {
      console.error(`File read error: ${err.message}`);
      customCommands = {};
    }
  }
}

function saveCommands() {
  try {
    fs.writeFileSync(COMMANDS_FILE, JSON.stringify(customCommands, null, 2));
  } catch (err) {
    console.error(`Failed to save commands: ${err.message}`);
    throw { code: ERROR_CODES.FILE_WRITE_ERROR, message: 'Could not save commands to file' };
  }
}

function loadRoles() {
  try {
    const data = fs.readFileSync(ROLES_FILE, 'utf8');
    roles = JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Roles file not found, creating new one');
      roles = { trusted: [] };
    } else if (err instanceof SyntaxError) {
      console.error(`Error parsing roles file: ${err.message}`);
      roles = { trusted: [] };
    } else {
      console.error(`File read error: ${err.message}`);
      roles = { trusted: [] };
    }
  }
}

function saveRoles() {
  try {
    fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2));
  } catch (err) {
    console.error(`Failed to save roles: ${err.message}`);
    throw { code: ERROR_CODES.FILE_WRITE_ERROR, message: 'Could not save roles to file' };
  }
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
const hhapp = express();
const WEB_PORT = process.env.PORT || process.env.WEB_PORT || 61234;
const WEB_HOST = process.env.WEB_HOST || '0.0.0.0';
const ADMIN_CODE = process.env.ADMIN_CODE || 'streamadmin';
const WEB_URL = process.env.WEB_URL || `http://${getLocalIPAddress()}:${WEB_PORT}`;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function sendError(res, status, error, code) {
  console.error(`API Error [${code}]: ${error}`);
  return res.status(status).json({ error, code, contact: 'noahisontopfr' });
}

function requireAdminCode(req, res, next) {
  const code = req.headers['x-admin-code'] || req.body.adminCode || req.query.adminCode;
  if (!code) {
    return sendError(res, 401, 'Admin code required', ERROR_CODES.ADMIN_CODE_REQUIRED);
  }
  if (code !== ADMIN_CODE) {
    return sendError(res, 401, 'Invalid admin code', ERROR_CODES.INVALID_ADMIN_CODE);
  }
  next();
}

app.post('/api/auth', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return sendError(res, 400, 'Admin code is required', ERROR_CODES.MISSING_FIELDS);
  }
  if (code === ADMIN_CODE) {
    return res.json({ success: true });
  }
  return sendError(res, 401, 'Invalid admin code', ERROR_CODES.INVALID_ADMIN_CODE);
});

app.get('/api/status', (req, res) => {
  res.json({
    connected: botConnected,
    uptime: process.uptime(),
    commands: Object.keys(customCommands).length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/commands', (req, res) => {
  try {
    res.json(customCommands);
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch commands', ERROR_CODES.UI_FETCH_ERROR);
  }
});

app.get('/api/commands/:name', (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const cmd = customCommands[name];
    if (!cmd) return sendError(res, 404, 'Command not found', ERROR_CODES.COMMAND_NOT_FOUND);
    res.json(cmd);
  } catch (err) {
    return sendError(res, 500, 'Error retrieving command', ERROR_CODES.UI_FETCH_ERROR);
  }
});

app.post('/api/commands', requireAdminCode, (req, res) => {
  try {
    const { name, response, cooldown = 5, userlevel = 'everyone', aliases = [], enabled = true } = req.body;
    if (!name || !response) {
      return sendError(res, 400, 'Name and response are required', ERROR_CODES.MISSING_FIELDS);
    }

    if (customCommands[name]) {
      return sendError(res, 409, 'Command already exists', ERROR_CODES.COMMAND_EXISTS);
    }

    customCommands[name] = { response, cooldown, userlevel, aliases, count: 0, enabled };
    saveCommands();
    loadCommands(); // Reload commands to sync with file
    res.status(201).json({ success: true, name, command: customCommands[name] });
  } catch (err) {
    if (err.code === ERROR_CODES.FILE_WRITE_ERROR) {
      return sendError(res, 500, 'Failed to save command - file error', ERROR_CODES.SYNC_FAILED);
    }
    return sendError(res, 500, 'Error creating command', ERROR_CODES.UI_BUTTON_FAILED);
  }
});

app.put('/api/commands/:name', requireAdminCode, (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const cmd = customCommands[name];
    if (!cmd) return sendError(res, 404, 'Command not found', ERROR_CODES.COMMAND_NOT_FOUND);

    const { response, cooldown, userlevel, aliases, enabled } = req.body;
    if (response !== undefined) cmd.response = response;
    if (cooldown !== undefined) cmd.cooldown = cooldown;
    if (userlevel !== undefined) cmd.userlevel = userlevel;
    if (aliases !== undefined) cmd.aliases = aliases;
    if (enabled !== undefined) cmd.enabled = enabled;

    saveCommands();
    loadCommands(); // Reload commands to sync with file
    res.json({ success: true, name, command: cmd });
  } catch (err) {
    if (err.code === ERROR_CODES.FILE_WRITE_ERROR) {
      return sendError(res, 500, 'Failed to save command - file error', ERROR_CODES.SYNC_FAILED);
    }
    return sendError(res, 500, 'Error updating command', ERROR_CODES.UI_BUTTON_FAILED);
  }
});

app.delete('/api/commands/:name', requireAdminCode, (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    if (!customCommands[name]) return sendError(res, 404, 'Command not found', ERROR_CODES.COMMAND_NOT_FOUND);
    delete customCommands[name];
    saveCommands();
    loadCommands(); // Reload commands to sync with file
    res.json({ success: true, deleted: name });
  } catch (err) {
    if (err.code === ERROR_CODES.FILE_WRITE_ERROR) {
      return sendError(res, 500, 'Failed to delete command - file error', ERROR_CODES.SYNC_FAILED);
    }
    return sendError(res, 500, 'Error deleting command', ERROR_CODES.UI_BUTTON_FAILED);
  }
});

app.use((err, req, res, next) => {
  console.error('Express error:', err);
  if (res.headersSent) return next(err);
  sendError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
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

client.connect()
  .then(() => {
    console.log(`Connected to Twitch as ${process.env.TWITCH_USERNAME}`);
    botConnected = true;
  })
  .catch((err) => {
    console.error(`Bot connection failed [BOT_CONNECT_FAILED]: ${err.message}`);
    botConnected = false;
  });

client.on('disconnected', (reason) => {
  console.error(`Bot disconnected [BOT_DISCONNECTED]: ${reason}`);
  botConnected = false;
  console.log('Attempting to reconnect...');
  setTimeout(() => {
    client.connect().catch(err => console.error('Reconnection failed:', err));
  }, 5000);
});

client.on('connected', () => {
  botConnected = true;
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
    try {
      const parts = message.split(' ');
      const commandName = parts[1];
      const response = parts.slice(2).join(' ');

      if (!commandName || !response) {
        client.say(channel, `Error: ${ERROR_CODES.INVALID_SYNTAX} - Usage: #6add !command Your message here`);
        return;
      }

      if (!addCommand(commandName, response)) {
        client.say(channel, `Error: ${ERROR_CODES.COMMAND_EXISTS} - ${commandName}`);
        return;
      }

      client.say(channel, `✓ Command added: ${commandName}`);
      return;
    } catch (err) {
      client.say(channel, `Error: ${ERROR_CODES.SYNC_FAILED} - Could not create command`);
      console.error('Add command error:', err);
    }
  }

  // #6edit !cmd new response
  if (msgLower.startsWith('#6edit ') && isManager) {
    try {
      const parts = message.split(' ');
      const commandName = parts[1];
      const newResponse = parts.slice(2).join(' ');

      if (!commandName || !newResponse) {
        client.say(channel, `Error: ${ERROR_CODES.INVALID_SYNTAX} - Usage: #6edit !command New response here`);
        return;
      }

      if (!editCommand(commandName, newResponse)) {
        client.say(channel, `Error: ${ERROR_CODES.COMMAND_NOT_FOUND} - ${commandName}`);
        return;
      }

      client.say(channel, `✓ Command updated: ${commandName}`);
      return;
    } catch (err) {
      client.say(channel, `Error: ${ERROR_CODES.SYNC_FAILED} - Could not update command`);
      console.error('Edit command error:', err);
    }
  }

  // #6del !cmd
  if (msgLower.startsWith('#6del ') && isManager) {
    try {
      const parts = message.split(' ');
      const commandName = parts[1];

      if (!commandName) {
        client.say(channel, `Error: ${ERROR_CODES.INVALID_SYNTAX} - Usage: #6del !command`);
        return;
      }

      if (!deleteCommand(commandName)) {
        client.say(channel, `Error: ${ERROR_CODES.COMMAND_NOT_FOUND} - ${commandName}`);
        return;
      }

      client.say(channel, `✓ Command deleted: ${commandName}`);
      return;
    } catch (err) {
      client.say(channel, `Error: ${ERROR_CODES.SYNC_FAILED} - Could not delete command`);
      console.error('Delete command error:', err);
    }
  }

  // !commands — send users to the web page to view commands
  // =========================
  // Custom commands
  // =========================
  if (msg.startsWith('!')) {
    if (msgLower === '!commands') {
      client.say(channel, `See available commands and admin tools at ${WEB_URL}`);
      return;
    }

    const found = findCommand(msg);
    if (found) {
      const { name, cmd } = found;
      
      if (cmd.enabled === false) {
        client.say(channel, `Error: ${ERROR_CODES.COMMAND_DISABLED}`);
        return;
      }

      const requiredLevel = cmd.userlevel || 'everyone';
      if (!hasPermission(requiredLevel, userLevels)) {
        client.say(channel, `Error: ${ERROR_CODES.INSUFFICIENT_PERMISSIONS}`);
        return;
      }

      const cooldownSeconds = cmd.cooldown || 0;
      if (isOnCooldown(name, cooldownSeconds)) {
        client.say(channel, `Error: ${ERROR_CODES.COMMAND_ON_COOLDOWN}`);
        return;
      }

      const context = { username, channel, command: name };
      const response = parseVariables(cmd.response, cmd, context);

      client.say(channel, response);
      setCooldown(name);
      return;
    } else {
      // Command not found
      client.say(channel, `Error: ${ERROR_CODES.COMMAND_NOT_FOUND}`);
      return;
    }
  }

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
