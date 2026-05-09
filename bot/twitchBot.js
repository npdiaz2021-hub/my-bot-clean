const tmi = require('tmi.js');

const DEFAULTS = {
  managerPrefix: '#6',
  commandPrefix: '!',
  defaultCooldownSeconds: 5,
  greetMemoryMs: 60 * 60 * 1000,
  maxChatMessageLength: 450,
  chatSendDelayMs: 1350,
  maxQueueSize: 25
};

const USER_LEVELS = new Set([
  'everyone',
  'subscriber',
  'vip',
  'moderator',
  'trusted',
  'broadcaster'
]);

function cleanUsername(value) {
  return String(value || '').replace(/^@/, '').trim().toLowerCase();
}

function normalizeChannel(channel) {
  const cleaned = String(channel || '').trim().replace(/^#/, '');
  return cleaned ? `#${cleaned.toLowerCase()}` : '';
}

function getDisplayName(tags) {
  return tags['display-name'] || tags.username || 'there';
}

function getUserLevels(tags, trustedUsers) {
  const levels = new Set(['everyone']);
  const badges = tags.badges || {};

  if (badges.broadcaster === '1') levels.add('broadcaster');
  if (tags.mod) levels.add('moderator');
  if (badges.subscriber === '1' || badges.founder === '1') levels.add('subscriber');
  if (badges.vip === '1') levels.add('vip');

  const username = cleanUsername(tags.username || tags['display-name']);
  const trusted = trustedUsers.map(cleanUsername);
  if (trusted.includes(username)) levels.add('trusted');

  return levels;
}

function hasPermission(required, userLevels) {
  const level = String(required || 'everyone').toLowerCase();
  if (level === 'everyone') return true;
  if (userLevels.has('broadcaster')) return true;
  return userLevels.has(level);
}

function isManager(userLevels) {
  return userLevels.has('broadcaster') || userLevels.has('moderator') || userLevels.has('trusted');
}

function parseTokens(message) {
  return String(message || '').trim().split(/\s+/).filter(Boolean);
}

function parseManagerLine(message) {
  const trimmed = String(message || '').trim();
  const tokens = parseTokens(trimmed);
  const action = tokens[0] ? tokens[0].slice(DEFAULTS.managerPrefix.length).toLowerCase() : '';
  return {
    action,
    tokens,
    commandName: tokens[1] || '',
    rest: tokens.slice(2).join(' ').trim()
  };
}

function isStandaloneGreeting(message) {
  const greetings = ['yo', 'hey', 'hi', 'hello', 'sup', 'hola', 'heyo', 'hiya', 'greetings'];
  return greetings.find((greeting) => (
    message === greeting ||
    message.startsWith(`${greeting} `) ||
    message.startsWith(`${greeting}!`) ||
    message.startsWith(`${greeting}?`)
  ));
}

function truncateForChat(message, maxLength = DEFAULTS.maxChatMessageLength) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

class TwitchBot {
  constructor({ store, webUrl, logger = console, options = {} }) {
    this.store = store;
    this.webUrl = webUrl;
    this.logger = logger;
    this.options = { ...DEFAULTS, ...options };

    this.client = null;
    this.connected = false;
    this.started = false;
    this.readyAt = null;
    this.lastDisconnectReason = '';
    this.lastMessageAt = null;

    this.commandCooldowns = new Map();
    this.userCommandCooldowns = new Map();
    this.greetedUsers = new Set();
    this.outgoingQueue = [];
    this.queueTimer = null;
    this.greetingTimer = null;
  }

  getStatus() {
    return {
      connected: this.connected,
      started: this.started,
      channel: process.env.TWITCH_CHANNEL || '',
      username: process.env.TWITCH_USERNAME || '',
      lastDisconnectReason: this.lastDisconnectReason,
      queuedMessages: this.outgoingQueue.length,
      greetedUsers: this.greetedUsers.size,
      readyAt: this.readyAt,
      lastMessageAt: this.lastMessageAt
    };
  }

  start() {
    if (process.env.TWITCH_BOT_ENABLED === 'false') {
      this.logger.log('Twitch bot is disabled by TWITCH_BOT_ENABLED=false.');
      return;
    }

    if (!this.hasCredentials()) {
      this.logger.warn('Twitch bot is paused because Twitch username, OAuth token, or channel is missing.');
      return;
    }

    this.client = new tmi.Client({
      options: { debug: process.env.TWITCH_DEBUG === 'true' },
      connection: {
        reconnect: true,
        secure: true
      },
      identity: {
        username: process.env.TWITCH_USERNAME,
        password: process.env.TWITCH_OAUTH
      },
      channels: [normalizeChannel(process.env.TWITCH_CHANNEL)]
    });

    this.attachHandlers();
    this.started = true;

    this.client.connect().catch((err) => {
      this.connected = false;
      this.lastDisconnectReason = err.message;
      this.logger.warn(`Twitch bot could not connect: ${err.message}`);
    });

    this.greetingTimer = setInterval(() => {
      this.greetedUsers.clear();
      this.logger.log('Greeting memory reset.');
    }, this.options.greetMemoryMs);
    this.greetingTimer.unref?.();
  }

  hasCredentials() {
    return Boolean(process.env.TWITCH_USERNAME && process.env.TWITCH_OAUTH && process.env.TWITCH_CHANNEL);
  }

  attachHandlers() {
    this.client.on('connected', () => {
      this.connected = true;
      this.readyAt = new Date().toISOString();
      this.lastDisconnectReason = '';
      this.greetedUsers.clear();
      this.logger.log(`Twitch bot connected as ${process.env.TWITCH_USERNAME}.`);
      this.pumpQueue();
    });

    this.client.on('disconnected', (reason) => {
      this.connected = false;
      this.lastDisconnectReason = reason || 'Disconnected';
      this.logger.warn(`Twitch bot disconnected: ${this.lastDisconnectReason}`);
    });

    this.client.on('reconnect', () => {
      this.logger.log('Twitch bot reconnecting...');
    });

    this.client.on('notice', (channel, msgid, message) => {
      this.logger.warn(`Twitch notice ${msgid || 'notice'}: ${message}`);
    });

    this.client.on('message', (channel, tags, message, self) => {
      if (self) return;
      this.handleMessage(channel, tags, message).catch((err) => {
        this.logger.warn(`Twitch message skipped: ${err.message}`);
      });
    });
  }

  async handleMessage(channel, tags, message) {
    const rawMessage = String(message || '').trim();
    if (!rawMessage || this.shouldIgnoreMessage(tags, rawMessage)) return;

    this.lastMessageAt = new Date().toISOString();

    const msgLower = rawMessage.toLowerCase();
    const username = getDisplayName(tags);
    const userLevels = getUserLevels(tags, this.store.getTrustedUsers());

    if (msgLower.startsWith(this.options.managerPrefix)) {
      await this.handleManagerCommand(channel, rawMessage, userLevels);
      return;
    }

    if (msgLower.startsWith(this.options.commandPrefix)) {
      await this.handleChatCommand(channel, username, userLevels, rawMessage);
      return;
    }

    await this.handleGreeting(channel, username, msgLower);
  }

  shouldIgnoreMessage(tags, message) {
    if (tags['message-type'] === 'system') return true;
    if (tags['custom-reward-id']) return false;

    const username = cleanUsername(tags.username || tags['display-name']);
    const botName = cleanUsername(process.env.TWITCH_USERNAME);
    if (username && botName && username === botName) return true;

    const lower = String(message || '').toLowerCase();
    if (lower.startsWith('welcome to ') || lower.includes(' joined the channel')) return true;
    return false;
  }

  async handleManagerCommand(channel, rawMessage, userLevels) {
    if (!isManager(userLevels)) return;

    const parsed = parseManagerLine(rawMessage);
    const action = parsed.action;

    const handlers = {
      help: () => this.managerHelp(channel),
      ping: () => this.say(channel, 'Bot is online.'),
      reload: () => this.reloadData(channel),
      add: () => this.addCommand(channel, parsed),
      edit: () => this.editCommand(channel, parsed),
      del: () => this.deleteCommand(channel, parsed),
      delete: () => this.deleteCommand(channel, parsed),
      enable: () => this.setCommandEnabled(channel, parsed, true),
      disable: () => this.setCommandEnabled(channel, parsed, false),
      cooldown: () => this.setCommandCooldown(channel, parsed),
      level: () => this.setCommandLevel(channel, parsed),
      alias: () => this.setCommandAliases(channel, parsed),
      info: () => this.commandInfo(channel, parsed),
      list: () => this.listCommands(channel)
    };

    if (!handlers[action]) return;
    await handlers[action]();
  }

  async managerHelp(channel) {
    await this.say(channel, 'Manager commands: #6add, #6edit, #6del, #6enable, #6disable, #6cooldown, #6level, #6alias, #6info, #6list, #6reload, #6ping');
  }

  async reloadData(channel) {
    this.store.load();
    this.commandCooldowns.clear();
    this.userCommandCooldowns.clear();
    await this.say(channel, 'Bot data reloaded.');
  }

  async addCommand(channel, parsed) {
    if (!parsed.commandName || !parsed.rest) {
      await this.say(channel, 'Usage: #6add !command response');
      return;
    }

    try {
      const result = this.store.createCommand({
        name: parsed.commandName,
        response: parsed.rest,
        cooldown: this.options.defaultCooldownSeconds,
        userlevel: 'everyone',
        aliases: [],
        enabled: true
      });
      await this.say(channel, `Command added: ${result.name}`);
    } catch (err) {
      await this.say(channel, this.storeMessageFor(err, 'Could not add that command.'));
    }
  }

  async editCommand(channel, parsed) {
    if (!parsed.commandName || !parsed.rest) {
      await this.say(channel, 'Usage: #6edit !command new response');
      return;
    }

    try {
      const result = this.store.updateCommand(parsed.commandName, { response: parsed.rest });
      await this.say(channel, `Command updated: ${result.name}`);
    } catch (err) {
      await this.say(channel, this.storeMessageFor(err, 'Could not update that command.'));
    }
  }

  async deleteCommand(channel, parsed) {
    if (!parsed.commandName) {
      await this.say(channel, 'Usage: #6del !command');
      return;
    }

    try {
      const deleted = this.store.deleteCommand(parsed.commandName);
      this.commandCooldowns.delete(deleted);
      await this.say(channel, `Command deleted: ${deleted}`);
    } catch (err) {
      await this.say(channel, this.storeMessageFor(err, 'Could not delete that command.'));
    }
  }

  async setCommandEnabled(channel, parsed, enabled) {
    if (!parsed.commandName) {
      await this.say(channel, `Usage: #6${enabled ? 'enable' : 'disable'} !command`);
      return;
    }

    try {
      const result = this.store.updateCommand(parsed.commandName, { enabled });
      await this.say(channel, `${result.name} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      await this.say(channel, this.storeMessageFor(err, 'Could not update that command.'));
    }
  }

  async setCommandCooldown(channel, parsed) {
    const seconds = Number(parsed.rest);
    if (!parsed.commandName || !Number.isFinite(seconds) || seconds < 0) {
      await this.say(channel, 'Usage: #6cooldown !command seconds');
      return;
    }

    try {
      const result = this.store.updateCommand(parsed.commandName, { cooldown: seconds });
      await this.say(channel, `${result.name} cooldown set to ${seconds}s.`);
    } catch (err) {
      await this.say(channel, this.storeMessageFor(err, 'Could not update that command.'));
    }
  }

  async setCommandLevel(channel, parsed) {
    const level = parsed.rest.toLowerCase();
    if (!parsed.commandName || !USER_LEVELS.has(level)) {
      await this.say(channel, `Usage: #6level !command ${Array.from(USER_LEVELS).join('|')}`);
      return;
    }

    try {
      const result = this.store.updateCommand(parsed.commandName, { userlevel: level });
      await this.say(channel, `${result.name} user level set to ${level}.`);
    } catch (err) {
      await this.say(channel, this.storeMessageFor(err, 'Could not update that command.'));
    }
  }

  async setCommandAliases(channel, parsed) {
    if (!parsed.commandName) {
      await this.say(channel, 'Usage: #6alias !command !alias1 !alias2');
      return;
    }

    const aliases = parseTokens(parsed.rest);
    try {
      const result = this.store.updateCommand(parsed.commandName, { aliases });
      const aliasText = result.command.aliases.length ? result.command.aliases.join(', ') : 'none';
      await this.say(channel, `${result.name} aliases: ${aliasText}`);
    } catch (err) {
      await this.say(channel, this.storeMessageFor(err, 'Could not update aliases.'));
    }
  }

  async commandInfo(channel, parsed) {
    const command = this.store.getCommand(parsed.commandName);
    if (!command) {
      await this.say(channel, 'Command not found.');
      return;
    }

    const aliases = command.aliases.length ? command.aliases.join(', ') : 'none';
    await this.say(channel, `${parsed.commandName}: ${command.enabled ? 'enabled' : 'disabled'}, level ${command.userlevel}, cooldown ${command.cooldown}s, aliases ${aliases}, uses ${command.count || 0}.`);
  }

  async listCommands(channel) {
    const names = Object.keys(this.store.getCommands()).sort();
    if (!names.length) {
      await this.say(channel, 'No commands are set up yet.');
      return;
    }

    const preview = names.slice(0, 18).join(', ');
    const suffix = names.length > 18 ? ` and ${names.length - 18} more` : '';
    await this.say(channel, `Commands: ${preview}${suffix}. Full list: ${this.webUrl}`);
  }

  storeMessageFor(err, fallback) {
    if (err.reason === 'command_not_found') return 'Command not found.';
    if (err.reason === 'command_exists') return 'That command already exists.';
    if (err.reason === 'missing_fields') return 'Missing command name or response.';
    return fallback;
  }

  async handleChatCommand(channel, username, userLevels, rawMessage) {
    const tokens = parseTokens(rawMessage);
    const trigger = tokens[0] || '';
    const args = tokens.slice(1);

    if (trigger.toLowerCase() === '!commands') {
      await this.say(channel, `Commands and admin tools: ${this.webUrl}`);
      return;
    }

    const found = this.store.findCommand(trigger);
    if (!found) return;

    const { name, command } = found;
    if (command.enabled === false) return;
    if (!hasPermission(command.userlevel, userLevels)) return;
    if (!isManager(userLevels) && this.isOnCooldown(name, username, command.cooldown)) return;

    if ((name === '!hello' || name === '!hi') && this.greetedUsers.has(cleanUsername(username))) return;

    const response = this.parseVariables(command.response, name, {
      username,
      channel,
      args,
      trigger
    });

    if (response) {
      await this.say(channel, response);
      this.setCooldown(name, username);
    }

    if (name === '!hello' || name === '!hi') {
      this.greetedUsers.add(cleanUsername(username));
    }
  }

  async handleGreeting(channel, username, msgLower) {
    if (process.env.TWITCH_GREETING_ENABLED === 'false') return;

    const greeting = isStandaloneGreeting(msgLower);
    if (!greeting) return;

    const key = cleanUsername(username);
    if (this.greetedUsers.has(key)) return;

    const responses = {
      hello: `Hello ${username}!`,
      hi: `Hi there, ${username}!`,
      hey: `Hey ${username}!`,
      yo: `Yo ${username}, what's good!`,
      sup: `Not much, ${username}! What's up with you?`,
      hola: `Hola ${username}!`,
      hiya: `Hiya ${username}!`,
      heyo: `Heyo ${username}!`,
      greetings: `Greetings, ${username}!`
    };

    await this.say(channel, responses[greeting] || `Hello ${username}!`);
    this.greetedUsers.add(key);
  }

  parseVariables(response, commandName, context) {
    let output = String(response || '');
    const argsText = context.args.join(' ');
    const target = context.args[0] || context.username;

    output = output.replace(/\$\(user\)/gi, context.username);
    output = output.replace(/\$\(sender\)/gi, context.username);
    output = output.replace(/\$\(channel\)/gi, context.channel.replace('#', ''));
    output = output.replace(/\$\(time\)/gi, new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' }));
    output = output.replace(/\$\(args\)/gi, argsText);
    output = output.replace(/\$\(target\)/gi, target);
    output = output.replace(/\$\(touser\)/gi, target);
    output = output.replace(/\$\((\d+)\)/g, (_match, index) => context.args[Number(index) - 1] || '');
    output = output.replace(/\$\(random:([^)]+)\)/gi, (_match, choices) => {
      const options = choices.split('|').map((choice) => choice.trim()).filter(Boolean);
      if (!options.length) return '';
      return options[Math.floor(Math.random() * options.length)];
    });

    if (/\$\(count\)/i.test(output)) {
      const count = this.store.incrementCount(commandName);
      output = output.replace(/\$\(count\)/gi, String(count));
    }

    return truncateForChat(output, this.options.maxChatMessageLength);
  }

  isOnCooldown(commandName, username, cooldownSeconds) {
    const seconds = Number(cooldownSeconds) || 0;
    if (seconds <= 0) return false;

    const now = Date.now();
    const commandLastUsed = this.commandCooldowns.get(commandName) || 0;
    if (now - commandLastUsed < seconds * 1000) return true;

    const key = `${commandName}:${cleanUsername(username)}`;
    const userLastUsed = this.userCommandCooldowns.get(key) || 0;
    return now - userLastUsed < Math.max(2, Math.floor(seconds / 2)) * 1000;
  }

  setCooldown(commandName, username) {
    this.commandCooldowns.set(commandName, Date.now());
    this.userCommandCooldowns.set(`${commandName}:${cleanUsername(username)}`, Date.now());
  }

  async say(channel, message) {
    const text = truncateForChat(message, this.options.maxChatMessageLength);
    if (!text) return;

    if (this.outgoingQueue.length >= this.options.maxQueueSize) {
      this.logger.warn('Twitch chat queue is full. Dropping outgoing message.');
      return;
    }

    this.outgoingQueue.push({ channel, message: text });
    this.pumpQueue();
  }

  pumpQueue() {
    if (this.queueTimer || !this.connected || !this.client || !this.outgoingQueue.length) return;

    const next = this.outgoingQueue.shift();
    this.client.say(next.channel, next.message).catch((err) => {
      this.logger.warn(`Twitch message was not sent: ${err.message}`);
    });

    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      this.pumpQueue();
    }, this.options.chatSendDelayMs);
    this.queueTimer.unref?.();
  }

  async stop() {
    if (this.greetingTimer) clearInterval(this.greetingTimer);
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.outgoingQueue = [];

    if (!this.client || !this.connected) return;
    try {
      await this.client.disconnect();
    } catch (err) {
      this.logger.warn(`Twitch bot disconnect did not finish cleanly: ${err.message}`);
    }
  }
}

module.exports = {
  TwitchBot,
  getUserLevels,
  hasPermission,
  parseManagerLine
};
