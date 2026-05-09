const express = require('express');
const os = require('os');
const path = require('path');
const { ERROR_CODES } = require('./errorCodes');

function getLocalIPAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function errorCodeFor(err) {
  if (err.reason === 'missing_fields') return ERROR_CODES.MISSING_FIELDS;
  if (err.reason === 'command_exists') return ERROR_CODES.COMMAND_EXISTS;
  if (err.reason === 'command_not_found') return ERROR_CODES.COMMAND_NOT_FOUND;
  if (err instanceof SyntaxError) return ERROR_CODES.FILE_PARSE_ERROR;
  if (err.code === 'EACCES') return ERROR_CODES.FILE_PERMISSION_ERROR;
  if (err.code === 'ENOENT') return ERROR_CODES.FILE_NOT_FOUND;
  return ERROR_CODES.INTERNAL_SERVER_ERROR;
}

function createWebsite({ store, getBotStatus }) {
  const app = express();
  const port = Number(process.env.PORT || process.env.WEB_PORT || 61234);
  const host = process.env.WEB_HOST || '0.0.0.0';
  const publicUrl = process.env.WEB_URL || `http://${getLocalIPAddress()}:${port}`;
  const adminCode = process.env.ADMIN_CODE || 'streamadmin';

  app.use(express.json({ limit: '250kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  function sendError(res, status, error, code) {
    console.error(`Website API error [${code}]: ${error}`);
    return res.status(status).json({ error, code, contact: 'noahisontopfr' });
  }

  function requireAdminCode(req, res, next) {
    const code = req.headers['x-admin-code'] || req.body.adminCode || req.query.adminCode;
    if (!code) {
      return sendError(res, 401, 'Admin code required', ERROR_CODES.ADMIN_CODE_REQUIRED);
    }
    if (code !== adminCode) {
      return sendError(res, 401, 'Invalid admin code', ERROR_CODES.INVALID_ADMIN_CODE);
    }
    next();
  }

  app.post('/api/auth', (req, res) => {
    if (!req.body.code) {
      return sendError(res, 400, 'Admin code is required', ERROR_CODES.MISSING_FIELDS);
    }
    if (req.body.code !== adminCode) {
      return sendError(res, 401, 'Invalid admin code', ERROR_CODES.INVALID_ADMIN_CODE);
    }
    return res.json({ success: true });
  });

  app.get('/api/status', (req, res) => {
    const botStatus = getBotStatus();
    res.json({
      connected: botStatus.connected,
      bot: botStatus,
      uptime: process.uptime(),
      commands: Object.keys(store.getCommands()).length,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/commands', (req, res) => {
    try {
      res.json(store.getCommands());
    } catch (err) {
      sendError(res, 500, 'Failed to fetch commands', errorCodeFor(err));
    }
  });

  app.get('/api/commands/:name', (req, res) => {
    const command = store.getCommand(req.params.name);
    if (!command) {
      return sendError(res, 404, 'Command not found', ERROR_CODES.COMMAND_NOT_FOUND);
    }
    return res.json(command);
  });

  app.post('/api/commands', requireAdminCode, (req, res) => {
    try {
      const result = store.createCommand(req.body);
      res.status(201).json({ success: true, ...result });
    } catch (err) {
      const code = errorCodeFor(err);
      const status = code === ERROR_CODES.COMMAND_EXISTS ? 409 : 400;
      sendError(res, status, err.message || 'Error creating command', code);
    }
  });

  app.put('/api/commands/:name', requireAdminCode, (req, res) => {
    try {
      const result = store.updateCommand(req.params.name, req.body);
      res.json({ success: true, ...result });
    } catch (err) {
      const code = errorCodeFor(err);
      const status = code === ERROR_CODES.COMMAND_NOT_FOUND ? 404 : 400;
      sendError(res, status, err.message || 'Error updating command', code);
    }
  });

  app.patch('/api/commands/bulk', requireAdminCode, (req, res) => {
    try {
      const updates = Array.isArray(req.body) ? req.body : [];
      const updated = [];
      for (const update of updates) {
        const result = store.updateCommand(update.name, update);
        updated.push(result.name);
      }
      res.json({ success: true, updated });
    } catch (err) {
      sendError(res, 400, err.message || 'Error updating commands', errorCodeFor(err));
    }
  });

  app.delete('/api/commands/bulk', requireAdminCode, (req, res) => {
    try {
      const names = Array.isArray(req.body.names) ? req.body.names : [];
      const deleted = names.map((name) => store.deleteCommand(name));
      res.json({ success: true, deleted });
    } catch (err) {
      sendError(res, 400, err.message || 'Error deleting commands', errorCodeFor(err));
    }
  });

  app.delete('/api/commands/:name', requireAdminCode, (req, res) => {
    try {
      const deleted = store.deleteCommand(req.params.name);
      res.json({ success: true, deleted });
    } catch (err) {
      const code = errorCodeFor(err);
      const status = code === ERROR_CODES.COMMAND_NOT_FOUND ? 404 : 400;
      sendError(res, status, err.message || 'Error deleting command', code);
    }
  });

  app.use((req, res) => {
    sendError(res, 404, 'Page not found', ERROR_CODES.PAGE_NOT_FOUND);
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    sendError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
  });

  function start() {
    const server = app.listen(port, host, () => {
      console.log(`Website running on ${publicUrl}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Website failed [${ERROR_CODES.PORT_ALREADY_IN_USE}]: port ${port} is already in use.`);
      } else {
        console.error(`Website failed [${ERROR_CODES.SERVER_START_FAILED}]: ${err.message}`);
      }
      process.exit(1);
    });

    return server;
  }

  return { app, start, publicUrl };
}

module.exports = { createWebsite };
