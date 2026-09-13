const pino = require('pino');

const redactKeys = [
  'ALI_PASSWORD',
  'password',
  'token',
  'cookie',
  'cookies',
  'SESSION_SECRET',
  'GITHUB_TOKEN',
  'secret',
  'auth',
  'authorization'
];

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: redactKeys,
    censor: '[REDACTED]'
  },
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime
});

module.exports = logger;
