const path = require('path');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');
const { z } = require('zod');
const { Command } = require('commander');
const logger = require('./logger');

// Caminhos padrão de arquivos
const credentialsEnvPath = path.join(__dirname, 'credentials.env');
const sessionPath = path.join(__dirname, 'session.json');
const sessionMetaPath = path.join(__dirname, 'session_meta.json');
const sessionTokenPath = path.join(__dirname, 'session_token.txt');
const scratchDir = path.join(__dirname, 'scratch');
const lockFilePath =
  process.platform === 'win32'
    ? path.join(os.tmpdir(), 'ali-coins.lock')
    : '/tmp/ali-coins.lock';

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
const configSchema = z.object({
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
  PW_TRACE: z.enum(['off', 'on', 'retain-on-failure', 'on-first-retry']).default('retain-on-failure'),
  PW_SCREENSHOT: z.enum(['off', 'on', 'only-on-failure']).default('only-on-failure'),
  PW_VIDEO: z.enum(['off', 'on', 'retain-on-failure', 'on-first-retry']).default('off'),
  PW_OUTPUT_DIR: z.string().default(scratchDir)
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
  program
    .name('ali-coins')
    .description('AliExpress Coin Collector & Task Runner com Playwright')
    .version('0.7.0')
    .option('-d, --dry-run', 'Valida credenciais e ambiente sem abrir navegador')
    .option('-f, --force', 'Ignora e sobrescreve lockfile ativo existente')
    .option('--json', 'Formata a saída de status e relatórios em JSON')
    .option('--show-token', 'Exibe o token criptografado gerado no terminal (export_session)')
    .option('--from-file <path>', 'Caminho do arquivo com o token de sessão (import_session)')
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

function isShowToken() {
  return process.argv.includes('--show-token');
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
 * @returns {z.infer<typeof configSchema>}
 */
function loadConfig(requireCredentials = true) {
  const rawEnv = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
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
    PW_OUTPUT_DIR: process.env.PW_OUTPUT_DIR
  };

  if (!requireCredentials) {
    if (!rawEnv.ALI_USER) rawEnv.ALI_USER = 'placeholder@ali.local';
    if (!rawEnv.ALI_PASSWORD) rawEnv.ALI_PASSWORD = 'placeholder_password';
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
 * Manipula execução em modo dry-run sem chamar process.exit()
 * Retorna true se dry-run ativo, false caso contrário.
 * @returns {boolean}
 */
function handleDryRun() {
  if (isDryRun()) {
    const cfg = loadConfig(true);
    const maskedUser = cfg.ALI_USER.includes('@')
      ? cfg.ALI_USER.replace(/(.{2})(.*)(@.*)/, '$1***$3')
      : cfg.ALI_USER.length > 4
        ? cfg.ALI_USER.slice(0, 2) + '***' + cfg.ALI_USER.slice(-2)
        : '***';

    if (isJson()) {
      const summary = {
        dryRun: true,
        valid: true,
        user: maskedUser,
        passwordConfigured: Boolean(cfg.ALI_PASSWORD),
        sessionSecretConfigured: Boolean(cfg.SESSION_SECRET),
        allowMedia: cfg.ALLOW_MEDIA,
        headless: cfg.HEADLESS,
        logLevel: cfg.LOG_LEVEL,
        noSandbox: cfg.NO_SANDBOX,
        navTimeout: cfg.NAV_TIMEOUT,
        taskMaxActions: cfg.TASK_MAX_ACTIONS,
        taskMaxAttempts: cfg.TASK_MAX_ATTEMPTS
      };
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } else {
      logger.info('===============================================================');
      logger.info('                 MODO DE VALIDAÇÃO (DRY-RUN)');
      logger.info('===============================================================');
      logger.info('Configuração validada com sucesso:');
      logger.info(` • Usuário: ${maskedUser}`);
      logger.info(` • Senha: [CONFIGURADA - ${cfg.ALI_PASSWORD.length} caracteres]`);
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
  isShowToken,
  getFromFile,
  checkAndDisplayHelp,
  createCliProgram,
  parseCliOptions,
  handleDryRun,
  credentialsEnvPath,
  sessionPath,
  sessionMetaPath,
  sessionTokenPath,
  scratchDir,
  lockFilePath
};
