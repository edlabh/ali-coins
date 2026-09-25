const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { z } = require('zod');
const { Command } = require('commander');
const logger = require('./logger');
const { safeChmod600 } = require('./security');
const { allowPrivateTargets } = require('./libs/url_guard');

// Caminhos padrão de arquivos
const credentialsEnvPath = path.join(__dirname, 'credentials.env');
const sessionPath = path.join(__dirname, 'session.json');
const sessionMetaPath = path.join(__dirname, 'session_meta.json');
const sessionTokenPath = path.join(__dirname, 'session_token.txt');
const scratchDir = path.join(__dirname, 'scratch');

// Lockfile isolado por usuário: em hosts multiusuário, impede que outro usuário
// bloqueie (ou seja bloqueado por) a execução via /tmp/ali-coins.lock compartilhado.
const lockUserSuffix =
  typeof process.getuid === 'function'
    ? `u${process.getuid()}`
    : crypto
        .createHash('sha256')
        .update(os.userInfo().username || 'unknown')
        .digest('hex')
        .slice(0, 8);
// Lock no próprio diretório do projeto (privado do usuário na VM/container).
// Evita o vetor de DoS/adulteração por outros usuários em diretórios compartilhados como /tmp
// (ex: criar um diretório no caminho do lock, symlink ou timestamp forjado).
const lockFilePath = path.join(__dirname, `ali-coins-${lockUserSuffix}.lock`);

// Carregar variáveis do arquivo credentials.env se existir.
// Reforça 0o600 em runtime: o arquivo contém ALI_PASSWORD, SESSION_SECRET e tokens,
// e pode ter sido criado manualmente sem as permissões restritas do instalador.
if (fs.existsSync(credentialsEnvPath)) {
  safeChmod600(credentialsEnvPath);
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

// Helper para número inteiro positivo com valor padrão (rejeita valores não numéricos como '10abc')
const positiveInt = (defaultVal) =>
  z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return defaultVal;
      const parsed = typeof val === 'number' ? val : Number(String(val).trim());
      return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultVal;
    }, z.number().int().positive())
    .default(defaultVal);

// Helper para número inteiro NÃO negativo (aceita 0) com valor padrão
const nonNegativeInt = (defaultVal) =>
  z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return defaultVal;
      const parsed = typeof val === 'number' ? val : Number(String(val).trim());
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultVal;
    }, z.number().int().nonnegative())
    .default(defaultVal);

// Schema de validação Zod para configuração
const configSchema = z
  .object({
    // Zod 4: a opção `error` substitui `required_error`/`invalid_type_error` (removidos)
    ALI_USER: z
      .string({
        error: (iss) =>
          iss.input === undefined || iss.input === null
            ? 'A variável ALI_USER é obrigatória no credentials.env.'
            : 'A variável ALI_USER deve ser uma string de texto.'
      })
      .trim()
      .min(1, 'ALI_USER não pode estar vazio.'),
    ALI_PASSWORD: z
      .string({
        error: (iss) =>
          iss.input === undefined || iss.input === null
            ? 'A variável ALI_PASSWORD é obrigatória no credentials.env.'
            : 'A variável ALI_PASSWORD deve ser uma string de texto.'
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
          // Aceita as mesmas formas dos demais booleanos (off/no/0/false desligam).
          return !/^(false|0|off|no)$/i.test(val.trim());
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
    LOG_LEVEL: z.preprocess(
      (val) => (typeof val === 'string' ? val.trim().toLowerCase() : val),
      z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info')
    ),
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
    NAV_TIMEOUT_SHORT: positiveInt(20000),
    SELECTOR_TIMEOUT: positiveInt(8000),
    ELEMENT_TIMEOUT: positiveInt(4000),
    TASK_MAX_ACTIONS: positiveInt(25),
    TASK_MAX_ATTEMPTS: positiveInt(4),
    TASK_ROUND_MAX_ATTEMPTS: positiveInt(3),
    TASK_MAX_DURATION_MS: positiveInt(3 * 60 * 1000),
    TASK_SCROLL_MAX_MS: positiveInt(30000),
    SCROLL_WAIT_SECONDS: positiveInt(10),
    LOCK_STALE_TIMEOUT_MS: positiveInt(30 * 60 * 1000),

    // Cooldown pós-captcha: após um desafio anti-bot no login, novas tentativas ficam
    // pausadas por N horas (0 desliga). Evita insistência que escala o desafio/risco.
    CAPTCHA_COOLDOWN_HOURS: z
      .preprocess((val) => {
        if (val === undefined || val === null || val === '') return 12;
        const parsed = typeof val === 'number' ? val : Number(String(val).trim());
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : 12;
      }, z.number().int().min(0))
      .default(12),

    // Tentativas ADICIONAIS (segunda passada) para tarefas que não concluíram nenhuma
    // rodada ou concluíram parcialmente. Cada passada foca somente nas tarefas
    // incompletas, respeita o teto global de ações e não repete claims/rodadas já feitas.
    TASK_RETRY_UNFINISHED: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() === 'true' || val === '1';
        }
        return Boolean(val);
      }, z.boolean())
      .default(false),
    // Quantidade máxima de passadas extras (padrão: 1 passada).
    TASK_RETRY_PASSES: positiveInt(1),
    // Espera entre passadas, em ms, para dar tempo do site consolidar o progresso (padrão: 5000).
    TASK_RETRY_DELAY_MS: positiveInt(5000),

    // Pausa ALEATÓRIA antes de cada tarefa do painel (inclui a 1ª, logo após o check-in), em ms,
    // sorteada uniformemente entre MIN e MAX. Padrão 0/0 = desligada (comportamento anterior).
    // Deixa o ritmo menos mecânico: sem isso as tarefas rodam encadeadas, com esperas fixas.
    TASK_PAUSE_MIN_MS: nonNegativeInt(0),
    TASK_PAUSE_MAX_MS: nonNegativeInt(0),

    // Pausa ALEATÓRIA entre contas no fluxo multi-conta, em ms, sorteada uniformemente
    // entre MIN e MAX. Padrão 0/0 = desligada (sem espera entre contas em sucesso).
    // Deixa o ritmo entre contas menos mecânico e randomiza o início de cada conta.
    ACCOUNT_DELAY_MIN_MS: nonNegativeInt(0),
    ACCOUNT_DELAY_MAX_MS: nonNegativeInt(0),

    // Atraso ALEATÓRIO no início da execução (somente no all.js real; --dry-run nunca
    // atrasa), em ms, sorteado uniformemente entre MIN e MAX. Padrão 0/0 = desligado.
    // Randomiza o horário de início (cron/launchd/Agendador/Docker) sem depender de shell.
    START_DELAY_MIN_MS: nonNegativeInt(0),
    START_DELAY_MAX_MS: nonNegativeInt(0),

    // Tarefas que exigem o app nativo (Prize Land/regar, minigames como Merge Boss,
    // quizzes e avaliações de pedidos) nunca concluem via web e consomem tentativas.
    // Por padrão são desligadas (ignoradas no loop e marcadas no relatório).
    // Defina SKIP_APP_ONLY_TASKS=false para voltar a tentá-las.
    SKIP_APP_ONLY_TASKS: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          const v = val.trim().toLowerCase();
          if (['false', '0', 'off', 'no'].includes(v)) return false;
          if (['true', '1', 'on', 'yes'].includes(v)) return true;
        }
        return Boolean(val);
      }, z.boolean())
      .default(true),

    // Diagnósticos do Playwright.
    // O default efetivo é resolvido em libs/ui/diagnostics.js: em modo de baixo consumo
    // de memória (CHROMIUM_LOW_MEMORY habilitado, padrão) o tracing fica 'off' para
    // economizar CPU/RAM/disco; a env explícita sempre tem precedência.
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
    // Envio da notificação individual de cada conta (além do consolidado final).
    // Desligado por padrão: quando todas as contas usam o mesmo chat, evita rajada de
    // mensagens no mesmo destino. O consolidado é SEMPRE enviado.
    TELEGRAM_PER_ACCOUNT: z
      .preprocess((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() === 'true' || val === '1';
        }
        return Boolean(val);
      }, z.boolean())
      .default(false),
    // Timeout por tentativa de envio ao Telegram; retry (até 3x) já cobre falhas
    // transitórias. 15s evita descartes em VPS com DNS/TLS lentos.
    TELEGRAM_TIMEOUT_MS: positiveInt(15000),
    NOTIFY_HOST_LABEL: z
      .preprocess((val) => {
        if (val === undefined || val === null) return '';
        // Limite defensivo: rótulos longos inflam o tamanho da mensagem do Telegram.
        return String(val).trim().slice(0, 64);
      }, z.string())
      .default(''),
    // URL do webhook de notificação (Discord/Telegram/HTTP POST): validada no boot
    // (antes só era avaliada em runtime, deixando URLs malformadas/http passarem).
    NOTIFY_WEBHOOK_URL: z
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
    if (data.TASK_PAUSE_MAX_MS < data.TASK_PAUSE_MIN_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TASK_PAUSE_MAX_MS deve ser >= TASK_PAUSE_MIN_MS.',
        path: ['TASK_PAUSE_MAX_MS']
      });
    }
    if (data.ACCOUNT_DELAY_MAX_MS < data.ACCOUNT_DELAY_MIN_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ACCOUNT_DELAY_MAX_MS deve ser >= ACCOUNT_DELAY_MIN_MS.',
        path: ['ACCOUNT_DELAY_MAX_MS']
      });
    }
    if (data.START_DELAY_MAX_MS < data.START_DELAY_MIN_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'START_DELAY_MAX_MS deve ser >= START_DELAY_MIN_MS.',
        path: ['START_DELAY_MAX_MS']
      });
    }
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
      } else {
        // Parseia com o MESMO parser do runtime: regex sobre a string bruta aceitava
        // `http://localhost:8080@evil.com` (o hostname real é evil.com) e rejeitava
        // `http://localhost?k=v`.
        let hbUrl = null;
        try {
          hbUrl = new URL(data.HEARTBEAT_URL);
        } catch {
          // Formato já garantido pelo regex acima
        }
        const hbHost = hbUrl
          ? hbUrl.hostname
              .toLowerCase()
              .replace(/^\[|\]$/g, '')
              .replace(/\.$/, '')
          : '';
        // Loopback em qualquer forma: localhost, ::1 (o hostname do URL vem com
        // colchetes), 127.0.0.0/8 e IPv4 mapeado ::ffff:127.x.
        const isLoopbackHb =
          hbHost === 'localhost' ||
          hbHost === '::1' ||
          /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hbHost) ||
          /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hbHost);
        if (hbUrl && hbUrl.protocol === 'http:' && !isLoopbackHb && !allowPrivateTargets()) {
          // O token do dead man's switch vai no path: em http ele trafega em claro e pode
          // ser forjado. Aceita http apenas para localhost ou com opt-in explícito.
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "HEARTBEAT_URL deve usar https:// (o token do dead man's switch não deve trafegar em claro). http:// é aceito apenas para localhost ou com ALLOW_PRIVATE_WEBHOOKS=true.",
            path: ['HEARTBEAT_URL']
          });
        }
      }
    }
    // NOTIFY_WEBHOOK_URL: mesma regra do HEARTBEAT_URL, validada no boot.
    if (data.NOTIFY_WEBHOOK_URL && data.NOTIFY_WEBHOOK_URL.length > 0) {
      let whUrl = null;
      try {
        whUrl = new URL(data.NOTIFY_WEBHOOK_URL);
      } catch {
        // Formato inválido: cai no issue abaixo
      }
      if (!/^https?:\/\//i.test(data.NOTIFY_WEBHOOK_URL) || !whUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NOTIFY_WEBHOOK_URL deve ser uma URL válida começando com http:// ou https://.',
          path: ['NOTIFY_WEBHOOK_URL']
        });
      } else {
        const whHost = whUrl.hostname
          .toLowerCase()
          .replace(/^\[|\]$/g, '')
          .replace(/\.$/, '');
        const isLoopbackWh =
          whHost === 'localhost' ||
          whHost === '::1' ||
          /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(whHost) ||
          /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(whHost);
        if (whUrl.protocol === 'http:' && !isLoopbackWh && !allowPrivateTargets()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'NOTIFY_WEBHOOK_URL deve usar https:// (o webhook não deve trafegar em claro). http:// é aceito apenas para localhost ou com ALLOW_PRIVATE_WEBHOOKS=true.',
            path: ['NOTIFY_WEBHOOK_URL']
          });
        }
      }
    }
    // Segurança at-rest: com a criptografia ligada (padrão), a ausência de SESSION_SECRET
    // faz o saveSession recusar gravar — a sessão nunca persiste e o erro só aparecia no
    // log do save (engolido no fluxo). Falha no startup com mensagem acionável.
    if (data.ENCRYPT_LOCAL_SESSION !== false && !data.SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'SESSION_SECRET é obrigatório (>= 32 caracteres) quando ENCRYPT_LOCAL_SESSION=true (padrão): sem ele a sessão NÃO é persistida. Defina SESSION_SECRET ou use ENCRYPT_LOCAL_SESSION=false explicitamente.',
        path: ['SESSION_SECRET']
      });
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
    .option(
      '-f, --force',
      'Força a execução: sobrescreve lockfile ativo e ignora o cooldown pós-captcha (tenta o login)'
    )
    .option(
      '--no-delay',
      'Não aplica o atraso inicial aleatório (START_DELAY_MIN_MS/MAX_MS); use em execuções manuais e retentativas'
    )
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
    .option(
      '--keep-tokens',
      'Mantém os arquivos session_token*.txt após a importação em lote (padrão: remover)'
    )
    .option('--migrate', 'Migra session.json legado para session.json.enc (import_session)')
    .option(
      '--rotate',
      'Re-criptografa as sessões com a nova chave SESSION_SECRET_NEW/SESSION_SECRET_OLD (export_session)'
    )
    .option(
      '--new-secret-from-env <var>',
      'Nome da variável de ambiente com a nova chave para --rotate (export_session)'
    )
    .allowUnknownOption(true)
    .helpOption('-h, --help', 'Exibe esta ajuda com a lista de opções')
    .addHelpText(
      'after',
      `
Códigos de Saída (Exit Codes):
  0  Sucesso (novas moedas coletadas com sucesso)
  1  Falha crítica de execução ou autenticação
  2  Sem Ação / Já Coletado (check-in já realizado e sem tarefas pendentes)
  3  Lock Ativo (outra instância já em execução no host)
  4  Streak Quebrado (sequência de check-in foi interrompida)
  5  2FA Não-Interativo (solicitação de 2FA em ambiente sem TTY)
  6  Falha Global Não Tratada (uncaughtException / unhandledRejection)
`
    );

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

function isNoDelay(argv = process.argv) {
  return argv.includes('--no-delay');
}

/**
 * Decide se o atraso inicial aleatório (START_DELAY_MIN_MS/MAX_MS) deve ser aplicado.
 * Nunca no --dry-run (o HEALTHCHECK do Docker roda `all.js --dry-run --json` a cada
 * 10 min — um atraso ali deixaria o container unhealthy), nunca com --no-delay
 * (execuções manuais/retentativas) e nunca com teto 0 (recurso desligado).
 * @param {{dryRun?: boolean, noDelay?: boolean, maxMs?: number}} [params]
 * @returns {boolean}
 */
function shouldApplyStartDelay({ dryRun = false, noDelay = false, maxMs = 0 } = {}) {
  if (dryRun === true || noDelay === true) return false;
  return Number.isFinite(maxMs) && maxMs > 0;
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

function getFromFile() {
  const fromFileArg = process.argv.find((a) => a.startsWith('--from-file='));
  if (fromFileArg) {
    // Usa apenas o PRIMEIRO '=' como separador (preserva caminhos que contenham '=')
    return fromFileArg.slice(fromFileArg.indexOf('=') + 1).trim();
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
    // Usa apenas o PRIMEIRO '=' como separador (preserva valores com '=')
    return accArg.slice(accArg.indexOf('=') + 1).trim();
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
      : process.env.HEARTBEAT_ENABLED !== undefined &&
          String(process.env.HEARTBEAT_ENABLED).trim() !== ''
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
    TASK_ROUND_MAX_ATTEMPTS: process.env.TASK_ROUND_MAX_ATTEMPTS,
    TASK_MAX_DURATION_MS: process.env.TASK_MAX_DURATION_MS,
    TASK_SCROLL_MAX_MS: process.env.TASK_SCROLL_MAX_MS,
    SCROLL_WAIT_SECONDS: process.env.SCROLL_WAIT_SECONDS,
    LOCK_STALE_TIMEOUT_MS: process.env.LOCK_STALE_TIMEOUT_MS,
    SKIP_APP_ONLY_TASKS: process.env.SKIP_APP_ONLY_TASKS,
    TASK_RETRY_UNFINISHED: process.env.TASK_RETRY_UNFINISHED,
    TASK_RETRY_PASSES: process.env.TASK_RETRY_PASSES,
    TASK_RETRY_DELAY_MS: process.env.TASK_RETRY_DELAY_MS,
    TASK_PAUSE_MIN_MS: process.env.TASK_PAUSE_MIN_MS,
    TASK_PAUSE_MAX_MS: process.env.TASK_PAUSE_MAX_MS,
    ACCOUNT_DELAY_MIN_MS: process.env.ACCOUNT_DELAY_MIN_MS,
    ACCOUNT_DELAY_MAX_MS: process.env.ACCOUNT_DELAY_MAX_MS,
    START_DELAY_MIN_MS: process.env.START_DELAY_MIN_MS,
    START_DELAY_MAX_MS: process.env.START_DELAY_MAX_MS,
    PW_TRACE: process.env.PW_TRACE,
    PW_SCREENSHOT: process.env.PW_SCREENSHOT,
    PW_VIDEO: process.env.PW_VIDEO,
    PW_OUTPUT_DIR: process.env.PW_OUTPUT_DIR,
    TELEGRAM_ENABLED: notifyOverride !== null ? notifyOverride : process.env.TELEGRAM_ENABLED,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_SILENT: process.env.TELEGRAM_SILENT,
    TELEGRAM_PER_ACCOUNT: process.env.TELEGRAM_PER_ACCOUNT,
    TELEGRAM_TIMEOUT_MS: process.env.TELEGRAM_TIMEOUT_MS,
    NOTIFY_HOST_LABEL: process.env.NOTIFY_HOST_LABEL,
    NOTIFY_WEBHOOK_URL: process.env.NOTIFY_WEBHOOK_URL,
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
    const atIndex = user.indexOf('@');
    const local = user.slice(0, atIndex);
    const domain = user.slice(atIndex);
    // Local part com 1 caractere (ex: a@b.co) também precisa ser mascarado
    return local.length >= 2 ? `${local.slice(0, 2)}***${domain}` : `***${domain}`;
  }
  // Telefones/IDs sem '@': expõe apenas os 2 primeiros caracteres, sem vazar os dígitos finais
  return user.length > 4 ? user.slice(0, 2) + '***' : '***';
}

/**
 * Mascara o Chat ID do Telegram para exibição em logs/dry-run.
 * Expõe apenas os 4 primeiros dígitos; IDs curtos são totalmente mascarados.
 * @param {string|number} chatId
 * @returns {string}
 */
function maskChatId(chatId) {
  if (chatId === undefined || chatId === null) return '';
  const value = String(chatId).trim();
  if (!value) return '';
  if (value.length <= 4) return '***';
  return `${value.slice(0, 4)}***`;
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
    // accounts.json contém senhas em texto puro: restringe a 0o600 em runtime,
    // avisando quando o arquivo estava legível por outros usuários.
    try {
      const mode = fs.statSync(accountsFile).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        logger.warn(
          { mode: mode.toString(8) },
          'accounts.json contém credenciais e estava acessível a outros usuários; aplicando permissão 0o600.'
        );
      }
    } catch {
      // Sem permissão de stat: apenas segue para a leitura normal
    }
    safeChmod600(accountsFile);

    try {
      const raw = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
      if (Array.isArray(raw)) {
        for (const acc of raw) {
          if (!acc || !acc.user) continue;
          const trimmedUser = String(acc.user).trim();
          const chatId =
            acc.telegramChatId || acc.telegram_chat_id
              ? String(acc.telegramChatId || acc.telegram_chat_id).trim()
              : null;

          // Resolução da senha com prioridade para fontes externas ao arquivo:
          // passwordEnv (nome da variável) > passwordFile (arquivo 0600) > password inline.
          // Recomendado não manter a senha em texto puro no accounts.json.
          let password = null;
          if (acc.passwordEnv && typeof acc.passwordEnv === 'string') {
            const envName = acc.passwordEnv.trim();
            // Somente propriedades PRÓPRIAS do env: evita resolver propriedades herdadas
            // de Object.prototype (ex.: passwordEnv="constructor"/"toString") como senha.
            const raw = Object.prototype.hasOwnProperty.call(env, envName)
              ? env[envName]
              : undefined;
            password = typeof raw === 'string' && raw.length > 0 ? raw : null;
            if (!password) {
              logger.warn(
                { account: maskUser(trimmedUser), passwordEnv: envName },
                'accounts.json: passwordEnv definido, mas a variável não está no ambiente; conta ignorada.'
              );
              continue;
            }
          } else if (acc.passwordFile && typeof acc.passwordFile === 'string') {
            try {
              // Confina o caminho ao diretório do accounts.json: impede path traversal
              // (ex.: "../../etc/passwd") e chmod 0600 em arquivo arbitrário do sistema.
              const baseDir = path.dirname(accountsFile);
              const pwPath = path.resolve(baseDir, acc.passwordFile);
              const rel = path.relative(baseDir, pwPath);
              if (rel.startsWith('..') || path.isAbsolute(rel)) {
                throw new Error('passwordFile deve residir no mesmo diretório do accounts.json.');
              }
              // Symlink dentro do diretório apontando para fora contornaria a checagem
              // lexical: revalida o caminho REAL antes de ler.
              const realBase = fs.realpathSync(baseDir);
              const realPw = fs.realpathSync(pwPath);
              const relReal = path.relative(realBase, realPw);
              if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
                throw new Error(
                  'passwordFile não pode apontar (via symlink) para fora do diretório do accounts.json.'
                );
              }
              password = fs.readFileSync(pwPath, 'utf-8').trim();
              safeChmod600(pwPath);
            } catch (pwErr) {
              logger.warn(
                { account: maskUser(trimmedUser), err: pwErr.message },
                'accounts.json: falha ao ler passwordFile; conta ignorada.'
              );
              continue;
            }
          } else if (acc.password) {
            password = String(acc.password);
          }

          if (!password) continue;

          // Dedup case-insensitive: preserva o primeiro cadastro do accounts.json e herda telegramChatId
          const existing = accounts.find((a) => a.user.toLowerCase() === trimmedUser.toLowerCase());
          if (existing) {
            if (!existing.telegramChatId && chatId) {
              existing.telegramChatId = chatId;
            }
          } else {
            accounts.push({
              user: trimmedUser,
              password,
              telegramChatId: chatId
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
    const existing = accounts.find((a) => a.user.toLowerCase() === trimmedUser.toLowerCase());
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
      const existing = accounts.find((a) => a.user.toLowerCase() === trimmedUser.toLowerCase());
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
      // Lock isolado por usuário; contas secundárias seguem o baseDir das sessões
      // (antes ignoravam baseDir customizado). Primária mantém o lock global do projeto.
      lockPath: isPrimary
        ? lockFilePath
        : path.join(baseDir, `ali-coins-${lockUserSuffix}-${hash}.lock`)
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
    if (accounts.length > 1 && accounts[0].user.toLowerCase() !== meta.user.toLowerCase()) {
      const targetAcc = accounts
        .slice(1)
        .find((a) => a.user.toLowerCase() === meta.user.toLowerCase());
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
        captchaCooldownHours: cfg.CAPTCHA_COOLDOWN_HOURS,
        noSandbox: cfg.NO_SANDBOX,
        navTimeout: cfg.NAV_TIMEOUT,
        taskMaxActions: cfg.TASK_MAX_ACTIONS,
        taskMaxAttempts: cfg.TASK_MAX_ATTEMPTS,
        taskRoundMaxAttempts: cfg.TASK_ROUND_MAX_ATTEMPTS,
        taskMaxDurationMs: cfg.TASK_MAX_DURATION_MS,
        taskScrollMaxMs: cfg.TASK_SCROLL_MAX_MS,
        taskPauseMinMs: cfg.TASK_PAUSE_MIN_MS,
        taskPauseMaxMs: cfg.TASK_PAUSE_MAX_MS,
        accountDelayMinMs: cfg.ACCOUNT_DELAY_MIN_MS,
        accountDelayMaxMs: cfg.ACCOUNT_DELAY_MAX_MS,
        startDelayMinMs: cfg.START_DELAY_MIN_MS,
        startDelayMaxMs: cfg.START_DELAY_MAX_MS,
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
        webhook: {
          urlConfigured: Boolean(cfg.NOTIFY_WEBHOOK_URL),
          allowPrivateWebhooks: allowPrivateTargets()
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
        logger.info(' • Senha: [CONFIGURADA]');
      }
      logger.info(` • Bloqueio de mídia (ALLOW_MEDIA): ${cfg.ALLOW_MEDIA}`);
      logger.info(` • Modo Headless: ${cfg.HEADLESS}`);
      logger.info(` • Nível de Log: ${cfg.LOG_LEVEL}`);
      logger.info(
        ` • Cooldown pós-captcha (CAPTCHA_COOLDOWN_HOURS): ${
          cfg.CAPTCHA_COOLDOWN_HOURS > 0 ? `${cfg.CAPTCHA_COOLDOWN_HOURS}h` : 'desligado'
        }`
      );
      logger.info(
        ` • Sandbox Chromium: ${cfg.NO_SANDBOX ? 'Desativado (--no-sandbox)' : 'Ativado'}`
      );
      logger.info(` • Timeout de Navegação (NAV_TIMEOUT): ${cfg.NAV_TIMEOUT}ms`);
      logger.info(` • Limite de Ações de Tarefas: ${cfg.TASK_MAX_ACTIONS}`);
      logger.info(` • Limite por Rodada (TASK_ROUND_MAX_ATTEMPTS): ${cfg.TASK_ROUND_MAX_ATTEMPTS}`);
      logger.info(` • Timeout por Tentativa (TASK_MAX_DURATION_MS): ${cfg.TASK_MAX_DURATION_MS}ms`);
      logger.info(` • Teto de Scroll (TASK_SCROLL_MAX_MS): ${cfg.TASK_SCROLL_MAX_MS}ms`);
      logger.info(
        ` • Pausa entre tarefas (TASK_PAUSE_MIN_MS..MAX_MS): ${cfg.TASK_PAUSE_MAX_MS > 0 ? `${cfg.TASK_PAUSE_MIN_MS}-${cfg.TASK_PAUSE_MAX_MS}ms` : 'Desligada'}`
      );
      logger.info(
        ` • Pausa entre contas (ACCOUNT_DELAY_MIN_MS..MAX_MS): ${cfg.ACCOUNT_DELAY_MAX_MS > 0 ? `${cfg.ACCOUNT_DELAY_MIN_MS}-${cfg.ACCOUNT_DELAY_MAX_MS}ms` : 'Desligada'}`
      );
      logger.info(
        ` • Atraso inicial (START_DELAY_MIN_MS..MAX_MS): ${cfg.START_DELAY_MAX_MS > 0 ? `${cfg.START_DELAY_MIN_MS}-${cfg.START_DELAY_MAX_MS}ms` : 'Desligado'}`
      );
      logger.info(
        ` • Tarefas exclusivas do app (SKIP_APP_ONLY_TASKS): ${cfg.SKIP_APP_ONLY_TASKS ? 'Desligadas' : 'Ativas'}`
      );
      logger.info(
        ` • SESSION_SECRET: ${cfg.SESSION_SECRET ? '[CONFIGURADO]' : '[NÃO CONFIGURADO]'}`
      );
      logger.info(
        ` • Webhook de notificação: ${cfg.NOTIFY_WEBHOOK_URL ? '[CONFIGURADO]' : '[NÃO CONFIGURADO]'}${allowPrivateTargets() ? ' (ALLOW_PRIVATE_WEBHOOKS ativo)' : ''}`
      );
      logger.info(
        ` • Notificações Telegram: ${
          cfg.TELEGRAM_ENABLED
            ? `Ativado (Chat ID: ${maskChatId(cfg.TELEGRAM_CHAT_ID)}, Token: [CONFIGURADO])`
            : 'Desativado'
        }`
      );
      logger.info(
        ` • Notificação individual por conta (TELEGRAM_PER_ACCOUNT): ${
          cfg.TELEGRAM_PER_ACCOUNT ? 'Ativada' : 'Desativada (apenas consolidado)'
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
  isNoDelay,
  shouldApplyStartDelay,
  isJson,
  isNotify,
  isHeartbeat,
  isShowToken,
  isAll,
  getAccountArg,
  getFromFile,
  checkAndDisplayHelp,
  createCliProgram,
  parseCliOptions,
  handleDryRun,
  maskUser,
  maskChatId,
  loadAccounts,
  syncAccountSessions,
  credentialsEnvPath,
  sessionPath,
  sessionMetaPath,
  sessionTokenPath,
  scratchDir,
  lockFilePath
};
