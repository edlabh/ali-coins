const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const pino = require('pino');

// Carregar credentials.env antes de ler LOG_LEVEL para garantir precedência
const credentialsEnvPath = path.join(__dirname, 'credentials.env');
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

const redactKeys = [
  '*.password',
  '*.passwd',
  '*.cookie',
  '*.cookies',
  '*.token',
  '*secret*',
  '*passwd*',
  'password',
  'passwd',
  'token',
  'cookie',
  'cookies',
  'SESSION_SECRET',
  'ALI_PASSWORD',
  'GITHUB_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  '*.TELEGRAM_BOT_TOKEN',
  'secret',
  'auth',
  'authorization',
  'headers.cookie',
  'headers.authorization'
];

/**
 * Mascara parâmetros de consulta sensíveis em strings/URLs e tokens de bot Telegram
 * @param {string} str
 * @returns {string}
 */
function sanitizeSensitiveQueryParams(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/([?&](?:token|code|ticket|password|passwd|secret)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/(bot\d+:[\w-]{20,})/gi, 'bot[REDACTED_TOKEN]');
}

const isJsonMode = process.argv.includes('--json');
const isTest = Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === 'test';
const isDev = !process.env.CI && process.env.NODE_ENV !== 'production' && !isTest && !isJsonMode;

let destination;
if (isJsonMode) {
  // Quando em modo --json, direcionar logs para stderr (fd 2),
  // mantendo stdout 100% limpo para parse JSON por ferramentas como jq
  destination = pino.destination(2);
} else if (isDev) {
  try {
    destination = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname'
      }
    });
  } catch {
    // Fallback gracioso para stdout padrão caso transporte falhe em algum ambiente
    destination = undefined;
  }
}

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: redactKeys,
      censor: '[REDACTED]'
    },
    hooks: {
      logMethod(inputArgs, method) {
        for (let i = 0; i < inputArgs.length; i++) {
          if (typeof inputArgs[i] === 'string') {
            inputArgs[i] = sanitizeSensitiveQueryParams(inputArgs[i]);
          }
        }
        return method.apply(this, inputArgs);
      }
    },
    formatters: {
      log(object) {
        if (object) {
          if (typeof object.msg === 'string') {
            object.msg = sanitizeSensitiveQueryParams(object.msg);
          }
          if (object.err && typeof object.err.message === 'string') {
            object.err.message = sanitizeSensitiveQueryParams(object.err.message);
          }
          if (typeof object.err === 'string') {
            object.err = sanitizeSensitiveQueryParams(object.err);
          }
        }
        return object;
      }
    },
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  destination
);

/**
 * Atualiza o nível de log do logger dinamicamente
 * @param {string} level
 */
logger.updateLogLevel = function updateLogLevel(level) {
  if (level && ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(level)) {
    logger.level = level;
  }
};

module.exports = logger;
