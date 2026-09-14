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
  'secret',
  'auth',
  'authorization',
  'headers.cookie',
  'headers.authorization'
];

/**
 * Mascara parâmetros de consulta sensíveis em strings/URLs
 * @param {string} str
 * @returns {string}
 */
function sanitizeSensitiveQueryParams(str) {
  if (typeof str !== 'string') return str;
  return str.replace(
    /([?&](?:token|code|ticket|password|passwd|secret)=)[^&#\s]+/gi,
    '$1[REDACTED]'
  );
}

const isDev = !process.env.CI && process.env.NODE_ENV !== 'production';

let transport;
if (isDev) {
  try {
    transport = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname'
      }
    });
  } catch {
    // Fallback gracioso para stdout padrão caso transporte falhe em algum ambiente
    transport = undefined;
  }
}

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: redactKeys,
      censor: '[REDACTED]'
    },
    formatters: {
      log(object) {
        if (object && typeof object.msg === 'string') {
          object.msg = sanitizeSensitiveQueryParams(object.msg);
        }
        return object;
      }
    },
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  transport
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
