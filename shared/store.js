const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json');
const ROLES_FILE = path.join(DATA_DIR, 'roles.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCommandName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('!') ? trimmed.toLowerCase() : `!${trimmed.toLowerCase()}`;
}

function normalizeAliases(aliases, commandName) {
  const seen = new Set();
  return (Array.isArray(aliases) ? aliases : [])
    .map(normalizeCommandName)
    .filter((alias) => alias && alias !== commandName)
    .filter((alias) => {
      if (seen.has(alias)) return false;
      seen.add(alias);
      return true;
    });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      writeJson(file, fallback);
      return clone(fallback);
    }
    if (err instanceof SyntaxError) {
      const backupFile = `${file}.broken-${Date.now()}`;
      fs.copyFileSync(file, backupFile);
      writeJson(file, fallback);
      console.warn(`Rebuilt unreadable JSON file and kept a backup at ${backupFile}.`);
      return clone(fallback);
    }
    console.warn(`Could not read ${path.basename(file)}. Using safe defaults for this run.`);
    return clone(fallback);
  }
}

function writeJson(file, value) {
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2));
  fs.renameSync(tempFile, file);
}

class CommandStore {
  constructor() {
    this.commands = {};
    this.roles = { trusted: [] };
  }

  load() {
    this.commands = readJson(COMMANDS_FILE, {});
    this.roles = readJson(ROLES_FILE, { trusted: [] });
    this.normalizeAll();
  }

  normalizeAll() {
    const normalized = {};
    for (const [rawName, rawCommand] of Object.entries(this.commands || {})) {
      const name = normalizeCommandName(rawName);
      if (!name || !rawCommand || typeof rawCommand !== 'object') continue;
      normalized[name] = this.cleanCommand(rawCommand, name);
    }
    this.commands = normalized;
    this.roles = {
      trusted: Array.isArray(this.roles.trusted) ? this.roles.trusted : []
    };
  }

  saveCommands() {
    writeJson(COMMANDS_FILE, this.commands);
  }

  saveRoles() {
    writeJson(ROLES_FILE, this.roles);
  }

  cleanCommand(command, commandName) {
    return {
      response: String(command.response || '').trim(),
      cooldown: Math.max(0, Number(command.cooldown) || 0),
      userlevel: command.userlevel || 'everyone',
      aliases: normalizeAliases(command.aliases, commandName),
      count: Math.max(0, Number(command.count) || 0),
      enabled: command.enabled !== false
    };
  }

  getCommands() {
    return clone(this.commands);
  }

  getCommand(name) {
    const commandName = normalizeCommandName(name);
    return this.commands[commandName] ? clone(this.commands[commandName]) : null;
  }

  createCommand(payload) {
    const name = normalizeCommandName(payload.name);
    if (!name) {
      const err = new Error('Command name is required');
      err.reason = 'missing_fields';
      throw err;
    }
    if (!payload.response || !String(payload.response).trim()) {
      const err = new Error('Command response is required');
      err.reason = 'missing_fields';
      throw err;
    }
    if (this.commands[name]) {
      const err = new Error('Command already exists');
      err.reason = 'command_exists';
      throw err;
    }

    this.commands[name] = this.cleanCommand(payload, name);
    this.saveCommands();
    return { name, command: clone(this.commands[name]) };
  }

  updateCommand(name, payload) {
    const commandName = normalizeCommandName(name);
    const existing = this.commands[commandName];
    if (!existing) {
      const err = new Error('Command not found');
      err.reason = 'command_not_found';
      throw err;
    }

    const next = { ...existing };
    if (payload.response !== undefined) next.response = String(payload.response || '').trim();
    if (payload.cooldown !== undefined) next.cooldown = payload.cooldown;
    if (payload.userlevel !== undefined) next.userlevel = payload.userlevel;
    if (payload.aliases !== undefined) next.aliases = payload.aliases;
    if (payload.enabled !== undefined) next.enabled = Boolean(payload.enabled);

    if (!next.response) {
      const err = new Error('Command response is required');
      err.reason = 'missing_fields';
      throw err;
    }

    this.commands[commandName] = this.cleanCommand(next, commandName);
    this.saveCommands();
    return { name: commandName, command: clone(this.commands[commandName]) };
  }

  deleteCommand(name) {
    const commandName = normalizeCommandName(name);
    if (!this.commands[commandName]) {
      const err = new Error('Command not found');
      err.reason = 'command_not_found';
      throw err;
    }
    delete this.commands[commandName];
    this.saveCommands();
    return commandName;
  }

  findCommand(trigger) {
    const commandName = normalizeCommandName(trigger);
    if (!commandName) return null;
    if (this.commands[commandName]) {
      return { name: commandName, command: this.commands[commandName] };
    }

    for (const [name, command] of Object.entries(this.commands)) {
      if ((command.aliases || []).includes(commandName)) {
        return { name, command };
      }
    }
    return null;
  }

  incrementCount(name) {
    const commandName = normalizeCommandName(name);
    if (!this.commands[commandName]) return 0;
    this.commands[commandName].count = (this.commands[commandName].count || 0) + 1;
    this.saveCommands();
    return this.commands[commandName].count;
  }

  getTrustedUsers() {
    return Array.isArray(this.roles.trusted) ? [...this.roles.trusted] : [];
  }
}

module.exports = {
  CommandStore,
  normalizeCommandName
};
