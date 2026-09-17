const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const pino = require('pino');

// Carregar credentials.env antes de ler LOG_LEVEL para garantir precedência
const credentialsEnvPath = path.join(__dirname, 'credentials.env');
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

// Caminhos fast-redact válidos (wildcards parciais como '*secret*' são silenciosamente ignorados).
// A defesa em profundidade para chaves fora desta lista fica em scrubSensitiveFields().
const redactKeys = [
  'password',
  'passwd',
  'token',
  'cookie',
  'cookies',
  'secret',
  'auth',
  'authorization',
  '*.password',
  '*.passwd',
  '*.token',
  '*.cookie',
  '*.cookies',
  '*.secret',
  '*.auth',
  '*.authorization',
  'headers.cookie',
  'headers.authorization',
  'SESSION_SECRET',
  'ALI_PASSWORD',
  'GITHUB_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  '*.SESSION_SECRET',
  '*.ALI_PASSWORD',
  '*.TELEGRAM_BOT_TOKEN',
  '*.GITHUB_TOKEN'
];

// Chaves cujo nome sugere segredo são mascaradas recursivamente (ex: my_secret_field, userToken, apiKey)
const SENSITIVE_KEY_REGEX =
  /(secret|passwd|password|token|cookie|authorization|credential|api[_-]?key)/i;

/**
 * Verifica se o valor é um objeto simples (não Error, Buffer, Date, etc.)
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Copia recursivamente o objeto mascarando valores de chaves sensíveis,
 * sem mutar a referência original do chamador.
 * @param {*} value
 * @param {number} [depth=0]
 * @param {WeakSet} [seen]
 * @returns {*}
 */
function scrubSensitiveFields(value, depth = 0, seen = new WeakSet()) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error || Buffer.isBuffer(value)) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitiveFields(item, depth + 1, seen));
  }
  if (!isPlainObject(value)) return value;

  const result = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_REGEX.test(key)
      ? '[REDACTED]'
      : scrubSensitiveFields(val, depth + 1, seen);
  }
  return result;
}

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
        if (!object) return object;
        const sanitized = { ...object };
        if (typeof sanitized.msg === 'string') {
          sanitized.msg = sanitizeSensitiveQueryParams(sanitized.msg);
        }
        if (sanitized.err && typeof sanitized.err.message === 'string') {
          sanitized.err = {
            ...sanitized.err,
            message: sanitizeSensitiveQueryParams(sanitized.err.message)
          };
        }
        if (typeof sanitized.err === 'string') {
          sanitized.err = sanitizeSensitiveQueryParams(sanitized.err);
        }
        return scrubSensitiveFields(sanitized);
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
