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
// Cobre também `pass`/`pwd`/`accessKey`/`private_key`/`bearer`/`senha` (variantes comuns).
const SENSITIVE_KEY_REGEX =
  /(secret|passwd|password|\bpass\b|\bpwd\b|senha|token|cookie|authorization|\bbearer\b|credential|access[_-]?key|private[_-]?key|api[_-]?key)/i;

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
 * @param {WeakMap} [seen] mapa objeto->cópia (preserva referências compartilhadas; evita
 *   tratar reaparecimento do mesmo objeto em ramos irmãos como "circular")
 * @returns {*}
 */
const MAX_LOG_DEPTH = 12;

function scrubSensitiveFields(value, depth = 0, seen = new WeakMap()) {
  if (depth > MAX_LOG_DEPTH || value === null || typeof value !== 'object') return value;
  if (value instanceof Error || Buffer.isBuffer(value)) return value;
  if (seen.has(value)) return seen.get(value);
  if (!isPlainObject(value) && !Array.isArray(value)) return value;

  if (Array.isArray(value)) {
    const arr = [];
    seen.set(value, arr);
    for (const item of value) arr.push(scrubSensitiveFields(item, depth + 1, seen));
    return arr;
  }

  const result = {};
  seen.set(value, result);
  for (const [key, val] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_REGEX.test(key)
      ? '[REDACTED]'
      : scrubSensitiveFields(val, depth + 1, seen);
  }
  return result;
}

/**
 * Aplica a sanitização de query params sensíveis a TODOS os valores string do objeto,
 * cobrindo campos estruturados como { url } que não passam pelo hook de msg/err.
 * @param {*} value
 * @param {number} [depth=0]
 * @param {WeakMap} [seen]
 * @returns {*}
 */
function sanitizeLogStrings(value, depth = 0, seen = new WeakMap()) {
  if (typeof value === 'string') return sanitizeSensitiveQueryParams(value);
  if (depth > MAX_LOG_DEPTH || value === null || typeof value !== 'object') return value;
  if (value instanceof Error || Buffer.isBuffer(value)) return value;
  if (seen.has(value)) return seen.get(value);
  if (!isPlainObject(value) && !Array.isArray(value)) return value;

  if (Array.isArray(value)) {
    const arr = [];
    seen.set(value, arr);
    for (const item of value) arr.push(sanitizeLogStrings(item, depth + 1, seen));
    return arr;
  }

  const result = {};
  seen.set(value, result);
  for (const [key, val] of Object.entries(value)) {
    result[key] = sanitizeLogStrings(val, depth + 1, seen);
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
  return (
    str
      .replace(
        /([?&;#](?:access_token|api[_-]?key|apikey|auth|authorization|code|password|passwd|secret|session|ticket|token)=)[^&#;\s]+/gi,
        '$1[REDACTED]'
      )
      .replace(/(bot\d+:[\w-]{20,})/gi, 'bot[REDACTED_TOKEN]')
      // Cabeçalhos textualizados (Bearer/authorization/cookie) vazam segredo em logs
      .replace(/(Bearer\s+)[\w\-._~+/=]+/gi, '$1[REDACTED]')
      // Cabeçalhos textualizados (Bearer/authorization/cookie) vazam segredo em logs.
      // `[^\r\n]+` redige a LINHA inteira: cookies são multivalorados (`a=1; b=2; c=3`)
      // e parar no `;`/`,` deixava os pares seguintes expostos.
      .replace(
        /((?:authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*)[^\r\n]+/gi,
        '$1[REDACTED]'
      )
  );
}

/**
 * Atalho para registros "planos" (apenas primitivos, Error/Buffer e sem chaves sensíveis).
 * Evita a cópia recursiva de scrubSensitiveFields/sanitizeLogStrings no caminho quente
 * do logger, preservando a sanitização de strings e de err.message.
 * @param {object} object
 * @returns {boolean}
 */
function isFlatLogRecord(object) {
  for (const key of Object.keys(object)) {
    if (SENSITIVE_KEY_REGEX.test(key)) return false;
    const value = object[key];
    if (value === null || typeof value !== 'object') continue;
    if (value instanceof Error || Buffer.isBuffer(value)) continue;
    return false;
  }
  return true;
}

const isJsonMode = process.argv.includes('--json');
const isTest = Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === 'test';
// Pretty (pino.transport/pino-pretty) apenas em terminal interativo. Em cron/systemd
// sem TTY não sobe worker thread nem formata/coloriza cada linha (economia de CPU/RAM).
const isDev =
  Boolean(process.stdout.isTTY) &&
  !process.env.CI &&
  process.env.NODE_ENV !== 'production' &&
  !isTest &&
  !isJsonMode;

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

const PINO_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const requestedLevel = process.env.LOG_LEVEL
  ? String(process.env.LOG_LEVEL).trim().toLowerCase()
  : 'info';
if (!PINO_LEVELS.has(requestedLevel)) {
  // O pino lançaria no require (antes do ConfigValidationError): avisa e usa 'info';
  // o schema do config continua validando o valor para o usuário.
  process.stderr.write(
    `[logger] LOG_LEVEL inválido ("${requestedLevel}"); usando "info". Valores aceitos: ${[...PINO_LEVELS].join(', ')}.\n`
  );
}

const logger = pino(
  {
    level: PINO_LEVELS.has(requestedLevel) ? requestedLevel : 'info',
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
          // Preserva stack/type: o spread de um Error copia só propriedades enumeráveis
          // (message/stack são non-enumerable em V8), o que quebrava o errSerializer.
          const origErr = sanitized.err;
          sanitized.err = {
            type: origErr.name || origErr.type || 'Error',
            message: sanitizeSensitiveQueryParams(origErr.message),
            stack:
              typeof origErr.stack === 'string'
                ? sanitizeSensitiveQueryParams(origErr.stack)
                : undefined,
            ...Object.fromEntries(Object.entries(origErr))
          };
        }
        if (typeof sanitized.err === 'string') {
          sanitized.err = sanitizeSensitiveQueryParams(sanitized.err);
        }
        if (isFlatLogRecord(object)) {
          for (const key of Object.keys(sanitized)) {
            if (key === 'msg' || key === 'err') continue;
            if (typeof sanitized[key] === 'string') {
              sanitized[key] = sanitizeSensitiveQueryParams(sanitized[key]);
            }
          }
          return sanitized;
        }
        return sanitizeLogStrings(scrubSensitiveFields(sanitized));
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

/**
 * Força o flush síncrono do destino (sonic-boom) quando aplicável.
 * Usado no encerramento gracioso para não perder os últimos logs em modo --json.
 */
logger.flushLogs = function flushLogs() {
  try {
    if (destination && typeof destination.flushSync === 'function') {
      destination.flushSync();
    }
  } catch {
    // Falha de flush nunca deve impedir o encerramento
  }
};

module.exports = logger;
module.exports.sanitizeSensitiveQueryParams = sanitizeSensitiveQueryParams;
module.exports.scrubSensitiveFieldsForTest = scrubSensitiveFields;
module.exports.sanitizeLogStringsForTest = sanitizeLogStrings;
