const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { z } = require('zod');
const { Command } = require('commander');
const logger = require('./logger');

// Caminhos padrão de arquivos
const credentialsEnvPath = path.join(__dirname, 'credentials.env');
const sessionPath = path.join(__dirname, 'session.json');
const sessionEncPath = path.join(__dirname, 'session.json.enc');
const sessionMetaPath = path.join(__dirname, 'session_meta.json');
const sessionTokenPath = path.join(__dirname, 'session_token.txt');
const scratchDir = path.join(__dirname, 'scratch');
const lockFilePath =
  process.platform === 'win32' ? path.join(os.tmpdir(), 'ali-coins.lock') : '/tmp/ali-coins.lock';

// Carregar variáveis do arquivo credentials.env se existir
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

// Helper para número inteiro positivo com valor padrão
const positiveInt = (defaultVal) =>
  z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return defaultVal;
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? defaultVal : parsed;
    }, z.number().int().positive())
    .default(defaultVal);

// Schema de validação Zod para configuração
const configSchema = z
  .object({
    ALI_USER: z
      .string({
        required_error: 'A variável ALI_USER é obrigatória no credentials.env.',
        invalid_type_error: 'A variável ALI_USER deve ser uma string de texto.'
      })
      .trim()
      .min(1, 'ALI_USER não pode estar vazio.'),
    ALI_PASSWORD: z
      .string({
        required_error: 'A variável ALI_PASSWORD é obrigatória no credentials.env.',
        invalid_type_error: 'A variável ALI_PASSWORD deve ser uma string de texto.'
      })
      .min(1, 'ALI_PASSWORD não pode estar vazio.'),
    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET deve conter no mínimo 32 caracteres.')
      .optional(),
    SESSION_SECRET_OLD: z
      .string()
      .min(32, 'SESSION_SECRET_OLD deve conter no mínimo 32 caracteres.')
      .optional(),
    ENCRYPT_LOCAL_SESSION: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() !== 'false' && val !== '0';
        }
        return val !== undefined ? Boolean(val) : true;
      }, z.boolean())
      .default(true),
    ALLOW_MEDIA: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() === 'true' || val === '1';
        }
        return Boolean(val);
      }, z.boolean())
      .default(false),
    HEADLESS: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() !== 'false' && val !== '0';
        }
        return val !== undefined ? Boolean(val) : true;
      }, z.boolean())
      .default(true),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    NO_SANDBOX: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() === 'true' || val === '1';
        }
        return Boolean(val);
      }, z.boolean())
      .default(false),

    // Timeouts e limites configuráveis
    NAV_TIMEOUT: positiveInt(35000),
    NAV_TIMEOUT_SHORT: positiveInt(15000),
    SELECTOR_TIMEOUT: positiveInt(8000),
    ELEMENT_TIMEOUT: positiveInt(4000),
    TASK_MAX_ACTIONS: positiveInt(25),
    TASK_MAX_ATTEMPTS: positiveInt(4),
    SCROLL_WAIT_SECONDS: positiveInt(10),
    LOCK_STALE_TIMEOUT_MS: positiveInt(30 * 60 * 1000),

    // Diagnósticos do Playwright
    PW_TRACE: z
      .enum(['off', 'on', 'retain-on-failure', 'on-first-retry'])
      .default('retain-on-failure'),
    PW_SCREENSHOT: z.enum(['off', 'on', 'only-on-failure']).default('only-on-failure'),
    PW_VIDEO: z.enum(['off', 'on', 'retain-on-failure', 'on-first-retry']).default('off'),
    PW_OUTPUT_DIR: z.string().default(scratchDir),

    // Notificações via Telegram (todas opcionais por padrão)
    TELEGRAM_ENABLED: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() === 'true' || val === '1';
        }
        return Boolean(val);
      }, z.boolean())
      .default(false),
    TELEGRAM_BOT_TOKEN: z
      .preprocess((val) => {
        if (val === undefined || val === null) return '';
        return String(val).trim();
      }, z.string())
      .default(''),
    TELEGRAM_CHAT_ID: z
      .preprocess((val) => {
        if (val === undefined || val === null) return '';
        return String(val).trim();
      }, z.string())
      .default(''),
    TELEGRAM_SILENT: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() === 'true' || val === '1';
        }
        return Boolean(val);
      }, z.boolean())
      .default(false),
    TELEGRAM_TIMEOUT_MS: positiveInt(5000),
    NOTIFY_HOST_LABEL: z
      .preprocess((val) => {
        if (val === undefined || val === null) return '';
        return String(val).trim();
      }, z.string())
      .default(''),

    // Dead Man's Switch / Monitoramento de Heartbeat (opcional por padrão)
    HEARTBEAT_ENABLED: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() === 'true' || val === '1';
        }
        return Boolean(val);
      }, z.boolean())
      .default(false),
    HEARTBEAT_URL: z
      .preprocess((val) => {
        if (val === undefined || val === null) return '';
        return String(val).trim();
      }, z.string())
      .default(''),
    HEARTBEAT_TIMEOUT_MS: positiveInt(5000)
  })
  .superRefine((data, ctx) => {
    if (data.TELEGRAM_ENABLED) {
      if (!data.TELEGRAM_BOT_TOKEN || !/^\d+:[\w-]{30,}$/.test(data.TELEGRAM_BOT_TOKEN)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'TELEGRAM_BOT_TOKEN é obrigatório e deve ter formato válido (/^\\d+:[\\w-]{30,}$/) quando TELEGRAM_ENABLED=true.',
          path: ['TELEGRAM_BOT_TOKEN']
        });
      }
      if (!data.TELEGRAM_CHAT_ID || String(data.TELEGRAM_CHAT_ID).trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TELEGRAM_CHAT_ID é obrigatório quando TELEGRAM_ENABLED=true.',
          path: ['TELEGRAM_CHAT_ID']
        });
      }
    }
    if (data.HEARTBEAT_ENABLED) {
      if (!data.HEARTBEAT_URL || !/^https?:\/\/.+/i.test(data.HEARTBEAT_URL)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'HEARTBEAT_URL é obrigatória e deve ser uma URL válida (http/https) quando HEARTBEAT_ENABLED=true.',
          path: ['HEARTBEAT_URL']
        });
      }
    }
  });

class ConfigValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'ConfigValidationError';
    this.validationIssues = issues;
  }
}

/**
 * Cria e configura instância do Commander para suporte completo a CLI
 * @returns {import('commander').Command}
 */
function createCliProgram() {
  const program = new Command();
  const pkg = require('./package.json');
  program
    .name('ali-coins')
    .description('AliExpress Coin Collector & Task Runner com Playwright')
    .version(pkg.version)
    .option('-d, --dry-run', 'Valida credenciais e ambiente sem abrir navegador')
    .option('-f, --force', 'Ignora e sobrescreve lockfile ativo existente')
    .option('--json', 'Formata a saída de status e relatórios em JSON')
    .option('--notify', 'Ativa notificações via Telegram (sobrescreve TELEGRAM_ENABLED)')
    .option('--no-notify', 'Desativa notificações via Telegram')
    .option(
      '--heartbeat',
      'Ativa envio de heartbeat / dead man switch (sobrescreve HEARTBEAT_ENABLED)'
    )
    .option('--no-heartbeat', 'Desativa envio de heartbeat / dead man switch')
    .option('--show-token', 'Exibe o token criptografado gerado no terminal (export_session)')
    .option('--from-file <path>', 'Caminho do arquivo com o token de sessão (import_session)')
    .option(
      '--plaintext',
      'Salva a sessão importada em texto puro sem criptografia at-rest (import_session)'
    )
    .option('--all', 'Exporta ou importa todas as contas configuradas com sessão ativa')
    .option(
      '--account <id>',
      'Especifica o índice (1, 2) ou e-mail da conta (export_session / import_session)'
    )
    .allowUnknownOption(true)
    .helpOption('-h, --help', 'Exibe esta ajuda com a lista de opções');

  return program;
}

function parseCliOptions(argv = process.argv) {
  const program = createCliProgram();
  program.parse(argv);
  return program.opts();
}

function isDryRun() {
  return process.argv.includes('--dry-run') || process.argv.includes('-d');
}

function isForce() {
  return process.argv.includes('--force') || process.argv.includes('-f');
}

function isJson() {
  return process.argv.includes('--json');
}

function isNotify(argv = process.argv) {
  try {
    const opts = parseCliOptions(argv);
    if (typeof opts.notify === 'boolean') {
      return opts.notify;
    }
  } catch {}
  if (argv.includes('--no-notify')) return false;
  if (argv.includes('--notify')) return true;
  return null;
}

function isHeartbeat(argv = process.argv) {
  try {
    const opts = parseCliOptions(argv);
    if (typeof opts.heartbeat === 'boolean') {
      return opts.heartbeat;
    }
  } catch {}
  if (argv.includes('--no-heartbeat')) return false;
  if (argv.includes('--heartbeat')) return true;
  return null;
}

function isShowToken() {
  return process.argv.includes('--show-token');
}

function isPlaintext() {
  return process.argv.includes('--plaintext');
}

function getFromFile() {
  const fromFileArg = process.argv.find((a) => a.startsWith('--from-file='));
  if (fromFileArg) {
    return fromFileArg.split('=')[1].trim();
  }
  const idx = process.argv.indexOf('--from-file');
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('-')) {
    return process.argv[idx + 1].trim();
  }
  return null;
}

function isAll() {
  return process.argv.includes('--all');
}

function getAccountArg() {
  const accArg = process.argv.find((a) => a.startsWith('--account='));
  if (accArg) {
    return accArg.split('=')[1].trim();
  }
  const idx = process.argv.indexOf('--account');
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('-')) {
    return process.argv[idx + 1].trim();
  }
  return null;
}

function checkAndDisplayHelp(argv = process.argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    const program = createCliProgram();
    program.outputHelp();
    return true;
  }
  if (argv.includes('--version') || argv.includes('-V')) {
    const program = createCliProgram();
    console.log(program.version());
    return true;
  }
  return false;
}

/**
 * Carrega e valida configurações a partir das variáveis de ambiente
 * @param {boolean} [requireCredentials=true]
 * @param {string[]} [argv=process.argv]
 * @returns {z.infer<typeof configSchema>}
 */
function loadConfig(requireCredentials = true, argv = process.argv) {
  const notifyOverride = isNotify(argv);
  const heartbeatOverride = isHeartbeat(argv);
  const rawHeartbeatUrl = process.env.HEARTBEAT_URL ? String(process.env.HEARTBEAT_URL).trim() : '';
  const rawHeartbeatEnabled =
    heartbeatOverride !== null
      ? heartbeatOverride
      : process.env.HEARTBEAT_ENABLED !== undefined
        ? process.env.HEARTBEAT_ENABLED
        : Boolean(rawHeartbeatUrl.length > 0);

  const rawEnv = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
    SESSION_SECRET_OLD: process.env.SESSION_SECRET_OLD,
    ENCRYPT_LOCAL_SESSION: process.env.ENCRYPT_LOCAL_SESSION,
    ALLOW_MEDIA: process.env.ALLOW_MEDIA,
    HEADLESS: process.env.HEADLESS,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NO_SANDBOX: process.env.NO_SANDBOX,
    NAV_TIMEOUT: process.env.NAV_TIMEOUT,
    NAV_TIMEOUT_SHORT: process.env.NAV_TIMEOUT_SHORT,
    SELECTOR_TIMEOUT: process.env.SELECTOR_TIMEOUT,
    ELEMENT_TIMEOUT: process.env.ELEMENT_TIMEOUT,
    TASK_MAX_ACTIONS: process.env.TASK_MAX_ACTIONS,
    TASK_MAX_ATTEMPTS: process.env.TASK_MAX_ATTEMPTS,
    SCROLL_WAIT_SECONDS: process.env.SCROLL_WAIT_SECONDS,
    LOCK_STALE_TIMEOUT_MS: process.env.LOCK_STALE_TIMEOUT_MS,
    PW_TRACE: process.env.PW_TRACE,
    PW_SCREENSHOT: process.env.PW_SCREENSHOT,
    PW_VIDEO: process.env.PW_VIDEO,
    PW_OUTPUT_DIR: process.env.PW_OUTPUT_DIR,
    TELEGRAM_ENABLED: notifyOverride !== null ? notifyOverride : process.env.TELEGRAM_ENABLED,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_SILENT: process.env.TELEGRAM_SILENT,
    TELEGRAM_TIMEOUT_MS: process.env.TELEGRAM_TIMEOUT_MS,
    HEARTBEAT_ENABLED: rawHeartbeatEnabled,
    HEARTBEAT_URL: rawHeartbeatUrl,
    HEARTBEAT_TIMEOUT_MS: process.env.HEARTBEAT_TIMEOUT_MS
  };

  if (!requireCredentials) {
    if (!rawEnv.ALI_USER) rawEnv.ALI_USER = 'placeholder@ali.local';
    if (!rawEnv.ALI_PASSWORD) rawEnv.ALI_PASSWORD = 'placeholder_password';
    rawEnv.TELEGRAM_ENABLED = false;
    rawEnv.HEARTBEAT_ENABLED = false;
  }

  const result = configSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => ` • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    logger.error(
      { issues: result.error.issues },
      `Falha na validação do arquivo credentials.env:\n${errorDetails}`
    );

    throw new ConfigValidationError(
      'Falha na validação das variáveis de configuração em credentials.env.',
      result.error.issues
    );
  }

  logger.updateLogLevel(result.data.LOG_LEVEL);
  return result.data;
}

/**
 * Mascara identificador de usuário (e-mail ou telefone)
 * @param {string} user
 * @returns {string}
 */
function maskUser(user) {
  if (!user || typeof user !== 'string') return '***';
  if (user.includes('@')) {
    return user.replace(/(.{2})(.*)(@.*)/, '$1***$3');
  }
  return user.length > 4 ? user.slice(0, 2) + '***' + user.slice(-2) : '***';
}

/**
 * Carrega a lista de contas configuradas (ALI_USER/ALI_PASSWORD, ALI_USER_2/ALI_PASSWORD_2, ou accounts.json)
 * @param {object} [env=process.env]
 * @param {string} [baseDir=__dirname]
 * @returns {Array<{ index: number, user: string, password: string, maskedUser: string, sessionPath: string, sessionMetaPath: string, lockPath: string }>}
 */
function loadAccounts(env = process.env, baseDir = __dirname) {
  const accounts = [];
  const accountsFile = path.join(baseDir, 'accounts.json');

  if (fs.existsSync(accountsFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
      if (Array.isArray(raw)) {
        for (const acc of raw) {
          if (acc && acc.user && acc.password) {
            accounts.push({
              user: String(acc.user).trim(),
              password: String(acc.password),
              telegramChatId:
                acc.telegramChatId || acc.telegram_chat_id
                  ? String(acc.telegramChatId || acc.telegram_chat_id).trim()
                  : null
            });
          }
        }
      }
    } catch {
      logger.warn('Falha ao ler arquivo accounts.json. Ignorando...');
    }
  }

  // Se houver ALI_USER configurado no env e ainda não presente na lista
  if (env.ALI_USER && env.ALI_PASSWORD) {
    const trimmedUser = env.ALI_USER.trim();
    const primaryChatId = env.TELEGRAM_CHAT_ID_1 || env.TELEGRAM_CHAT_ID || null;
    const existing = accounts.find((a) => a.user === trimmedUser);
    if (existing) {
      if (!existing.telegramChatId && primaryChatId) {
        existing.telegramChatId = String(primaryChatId).trim();
      }
    } else {
      accounts.unshift({
        user: trimmedUser,
        password: env.ALI_PASSWORD,
        telegramChatId: primaryChatId ? String(primaryChatId).trim() : null
      });
    }
  }

  // Verifica contas adicionais no env (ALI_USER_2, ALI_USER_3, ...)
  for (let i = 2; i <= 20; i++) {
    const u = env[`ALI_USER_${i}`];
    const p = env[`ALI_PASSWORD_${i}`];
    const chatId = env[`TELEGRAM_CHAT_ID_${i}`] || null;
    if (u && p) {
      const trimmedUser = u.trim();
      const existing = accounts.find((a) => a.user === trimmedUser);
      if (existing) {
        if (!existing.telegramChatId && chatId) {
          existing.telegramChatId = String(chatId).trim();
        }
      } else {
        accounts.push({
          user: trimmedUser,
          password: p,
          telegramChatId: chatId ? String(chatId).trim() : null
        });
      }
    }
  }

  return accounts.map((acc, idx) => {
    const hash = crypto.createHash('sha256').update(acc.user).digest('hex').slice(0, 8);
    const isPrimary = idx === 0;
    const envChatId = isPrimary
      ? env.TELEGRAM_CHAT_ID_1 || env.TELEGRAM_CHAT_ID || null
      : env[`TELEGRAM_CHAT_ID_${idx + 1}`] || env.TELEGRAM_CHAT_ID || null;
    return {
      index: idx + 1,
      user: acc.user,
      password: acc.password,
      maskedUser: maskUser(acc.user),
      telegramChatId: acc.telegramChatId || (envChatId ? String(envChatId).trim() : null),
      sessionPath: isPrimary
        ? path.join(baseDir, 'session.json')
        : path.join(baseDir, `session_${hash}.json`),
      sessionMetaPath: isPrimary
        ? path.join(baseDir, 'session_meta.json')
        : path.join(baseDir, `session_meta_${hash}.json`),
      lockPath: isPrimary ? lockFilePath : path.join(os.tmpdir(), `ali-coins-${hash}.lock`)
    };
  });
}

/**
 * Sincroniza e migra arquivos de sessão quando há reordenação de contas ou transição mono -> multi-conta
 * @param {Array<object>} accounts
 * @param {string} [baseDir=__dirname]
 */
function syncAccountSessions(accounts, baseDir = __dirname) {
  if (!Array.isArray(accounts) || accounts.length === 0) return;
  const legacyMetaPath = path.join(baseDir, 'session_meta.json');
  const legacySessionPath = path.join(baseDir, 'session.json');
  const legacySessionEncPath = path.join(baseDir, 'session.json.enc');

  if (!fs.existsSync(legacyMetaPath)) return;

  try {
    const raw = fs.readFileSync(legacyMetaPath, 'utf-8');
    const meta = JSON.parse(raw);
    if (!meta || !meta.user) return;

    // Se a sessão em session_meta.json não pertence à conta primária (accounts[0]),
    // mas pertence a uma das contas secundárias configuradas (accounts[1..n])
    if (accounts.length > 1 && accounts[0].user !== meta.user) {
      const targetAcc = accounts.slice(1).find((a) => a.user === meta.user);
      if (targetAcc) {
        const targetEncPath = `${targetAcc.sessionPath}.enc`;
        const targetPlainPath = targetAcc.sessionPath;
        const targetMetaPath = targetAcc.sessionMetaPath;

        const hasSecondarySession = fs.existsSync(targetEncPath) || fs.existsSync(targetPlainPath);
        if (!hasSecondarySession) {
          if (fs.existsSync(legacySessionEncPath)) {
            fs.renameSync(legacySessionEncPath, targetEncPath);
            try {
              fs.chmodSync(targetEncPath, 0o600);
            } catch {}
          } else if (fs.existsSync(legacySessionPath)) {
            fs.renameSync(legacySessionPath, targetPlainPath);
            try {
              fs.chmodSync(targetPlainPath, 0o600);
            } catch {}
          }
          fs.renameSync(legacyMetaPath, targetMetaPath);
          try {
            fs.chmodSync(targetMetaPath, 0o600);
          } catch {}
          logger.info(
            { user: targetAcc.maskedUser },
            'Sessão legada vinculada a conta secundária migrada com sucesso para arquivos isolados.'
          );
        }
      }
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Aviso ao verificar sincronização de sessões multi-conta.');
  }
}

/**
 * Manipula execução em modo dry-run sem chamar process.exit()
 * Retorna true se dry-run ativo, false caso contrário.
 * @returns {Promise<boolean>}
 */
async function handleDryRun() {
  if (isDryRun()) {
    const cfg = loadConfig(true);
    const accounts = loadAccounts(process.env, __dirname);
    const maskedUser = maskUser(cfg.ALI_USER);
    const maskedAccounts = accounts.map((a) => ({
      index: a.index,
      user: a.maskedUser,
      passwordConfigured: Boolean(a.password)
    }));

    let telegramTestResult = null;
    if (isNotify() === true) {
      const { sendTelegram } = require('./libs/notify');
      telegramTestResult = await sendTelegram({ config: cfg, event: 'dry_run' });
    }

    if (isJson()) {
      const summary = {
        dryRun: true,
        valid: true,
        user: maskedUser,
        passwordConfigured: Boolean(cfg.ALI_PASSWORD),
        sessionSecretConfigured: Boolean(cfg.SESSION_SECRET),
        sessionSecretOldConfigured: Boolean(cfg.SESSION_SECRET_OLD),
        encryptLocalSession: cfg.ENCRYPT_LOCAL_SESSION,
        allowMedia: cfg.ALLOW_MEDIA,
        headless: cfg.HEADLESS,
        logLevel: cfg.LOG_LEVEL,
        noSandbox: cfg.NO_SANDBOX,
        navTimeout: cfg.NAV_TIMEOUT,
        taskMaxActions: cfg.TASK_MAX_ACTIONS,
        taskMaxAttempts: cfg.TASK_MAX_ATTEMPTS,
        telegram: {
          enabled: cfg.TELEGRAM_ENABLED,
          botTokenConfigured: Boolean(cfg.TELEGRAM_BOT_TOKEN),
          chatIdConfigured: Boolean(cfg.TELEGRAM_CHAT_ID),
          silent: cfg.TELEGRAM_SILENT,
          testSent: isNotify() === true,
          testSuccess: telegramTestResult ? telegramTestResult.ok : undefined
        },
        heartbeat: {
          enabled: cfg.HEARTBEAT_ENABLED,
          urlConfigured: Boolean(cfg.HEARTBEAT_URL),
          timeoutMs: cfg.HEARTBEAT_TIMEOUT_MS
        },
        accounts: maskedAccounts
      };
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } else {
      const { maskHeartbeatUrl } = require('./libs/heartbeat');
      logger.info('===============================================================');
      logger.info('                 MODO DE VALIDAÇÃO (DRY-RUN)');
      logger.info('===============================================================');
      logger.info('Configuração validada com sucesso:');
      if (accounts.length > 1) {
        logger.info(` • Contas detectadas (${accounts.length}):`);
        accounts.forEach((acc) => {
          logger.info(`    - [Conta ${acc.index}] ${acc.maskedUser}`);
        });
      } else {
        logger.info(` • Usuário: ${maskedUser}`);
        logger.info(` • Senha: [CONFIGURADA - ${cfg.ALI_PASSWORD.length} caracteres]`);
      }
      logger.info(` • Bloqueio de mídia (ALLOW_MEDIA): ${cfg.ALLOW_MEDIA}`);
      logger.info(` • Modo Headless: ${cfg.HEADLESS}`);
      logger.info(` • Nível de Log: ${cfg.LOG_LEVEL}`);
      logger.info(
        ` • Sandbox Chromium: ${cfg.NO_SANDBOX ? 'Desativado (--no-sandbox)' : 'Ativado'}`
      );
      logger.info(` • Timeout de Navegação (NAV_TIMEOUT): ${cfg.NAV_TIMEOUT}ms`);
      logger.info(` • Limite de Ações de Tarefas: ${cfg.TASK_MAX_ACTIONS}`);
      logger.info(
        ` • SESSION_SECRET: ${cfg.SESSION_SECRET ? `[CONFIGURADO - ${cfg.SESSION_SECRET.length} chars]` : '[NÃO CONFIGURADO]'}`
      );
      logger.info(
        ` • Notificações Telegram: ${
          cfg.TELEGRAM_ENABLED
            ? `Ativado (Chat ID: ${cfg.TELEGRAM_CHAT_ID}, Token: [CONFIGURADO - ${cfg.TELEGRAM_BOT_TOKEN.length} chars])`
            : 'Desativado'
        }`
      );
      if (telegramTestResult) {
        logger.info(
          ` • Envio Teste Telegram: ${telegramTestResult.ok ? '✅ Mensagem enviada com sucesso!' : `❌ Falha: ${telegramTestResult.error}`}`
        );
      }
      logger.info(
        ` • Dead Man's Switch (Heartbeat): ${
          cfg.HEARTBEAT_ENABLED
            ? `Ativado (${maskHeartbeatUrl(cfg.HEARTBEAT_URL)}, timeout: ${cfg.HEARTBEAT_TIMEOUT_MS}ms)`
            : 'Desativado'
        }`
      );
      logger.info('===============================================================');
    }
    return true;
  }
  return false;
}

module.exports = {
  configSchema,
  ConfigValidationError,
  loadConfig,
  isDryRun,
  isForce,
  isJson,
  isNotify,
  isHeartbeat,
  isShowToken,
  isPlaintext,
  isAll,
  getAccountArg,
  getFromFile,
  checkAndDisplayHelp,
  createCliProgram,
  parseCliOptions,
  handleDryRun,
  maskUser,
  loadAccounts,
  syncAccountSessions,
  credentialsEnvPath,
  sessionPath,
  sessionEncPath,
  sessionMetaPath,
  sessionTokenPath,
  scratchDir,
  lockFilePath
};
