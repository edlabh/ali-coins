const path = require('path');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');
const { z } = require('zod');

// Caminhos padrão de arquivos
const credentialsEnvPath = path.join(__dirname, 'credentials.env');
const sessionPath = path.join(__dirname, 'session.json');
const sessionMetaPath = path.join(__dirname, 'session_meta.json');
const sessionTokenPath = path.join(__dirname, 'session_token.txt');
const lockFilePath = process.platform === 'win32'
  ? path.join(os.tmpdir(), 'ali-coins.lock')
  : '/tmp/ali-coins.lock';

// Carregar variáveis do arquivo credentials.env se ele existir
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

// Schema de validação Zod para configuração
const configSchema = z.object({
  ALI_USER: z.string({
    required_error: 'A variável ALI_USER é obrigatória no credentials.env.',
    invalid_type_error: 'A variável ALI_USER deve ser uma string de texto.'
  }).trim().min(1, 'ALI_USER não pode estar vazio.'),
  ALI_PASSWORD: z.string({
    required_error: 'A variável ALI_PASSWORD é obrigatória no credentials.env.',
    invalid_type_error: 'A variável ALI_PASSWORD deve ser uma string de texto.'
  }).min(1, 'ALI_PASSWORD não pode estar vazio.'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET deve conter no mínimo 32 caracteres.').optional(),
  ALLOW_MEDIA: z.preprocess((val) => {
    if (typeof val === 'string') {
      return val.toLowerCase() === 'true' || val === '1';
    }
    return Boolean(val);
  }, z.boolean()).default(false),
  HEADLESS: z.preprocess((val) => {
    if (typeof val === 'string') {
      return val.toLowerCase() !== 'false' && val !== '0';
    }
    return val !== undefined ? Boolean(val) : true;
  }, z.boolean()).default(true),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info')
});

function isDryRun() {
  return process.argv.includes('--dry-run') || process.argv.includes('-d');
}

function isForce() {
  return process.argv.includes('--force') || process.argv.includes('-f');
}

function loadConfig(requireCredentials = true) {
  const rawEnv = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
    ALLOW_MEDIA: process.env.ALLOW_MEDIA,
    HEADLESS: process.env.HEADLESS,
    LOG_LEVEL: process.env.LOG_LEVEL
  };

  // Se não for estritamente obrigatório (ex: durante import de sessão), fornecer dummy caso ausente
  if (!requireCredentials) {
    if (!rawEnv.ALI_USER) rawEnv.ALI_USER = 'placeholder@ali.local';
    if (!rawEnv.ALI_PASSWORD) rawEnv.ALI_PASSWORD = 'placeholder_password';
  }

  const result = configSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map(issue => ` • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error('\n' + '='.repeat(68));
    console.error(' [ERRO DE CONFIGURAÇÃO - CREDENCIAIS INVÁLIDAS]');
    console.error(' Falha na validação do arquivo "credentials.env":');
    console.error(errorDetails);
    console.error('');
    console.error(' Solução:');
    console.error(' 1. Verifique se o arquivo credentials.env existe na raiz do projeto.');
    console.error(' 2. Certifique-se de preencher ALI_USER e ALI_PASSWORD corretamente.');
    console.error('    Exemplo em credentials.env.example');
    console.error('='.repeat(68) + '\n');

    const err = new Error('Falha na validação das variáveis de configuração em credentials.env.');
    err.validationIssues = result.error.issues;
    throw err;
  }

  return result.data;
}

// Execução direta em modo dry-run
function handleDryRun() {
  if (isDryRun()) {
    console.log('===============================================================');
    console.log('                 MODO DE VALIDAÇÃO (DRY-RUN)');
    console.log('===============================================================\n');
    console.log('[DRY-RUN] Verificando configuração e credenciais...');
    const cfg = loadConfig(true);
    const maskedUser = cfg.ALI_USER.includes('@')
      ? cfg.ALI_USER.replace(/(.{2})(.*)(@.*)/, '$1***$3')
      : (cfg.ALI_USER.length > 4 ? cfg.ALI_USER.slice(0, 2) + '***' + cfg.ALI_USER.slice(-2) : '***');
    console.log(`[DRY-RUN] ✅ Configuração validada com sucesso!`);
    console.log(` • Usuário: ${maskedUser}`);
    console.log(` • Senha: [CONFIGURADA - ${cfg.ALI_PASSWORD.length} caracteres]`);
    console.log(` • Bloqueio de mídia (ALLOW_MEDIA): ${cfg.ALLOW_MEDIA}`);
    console.log(` • Modo Headless: ${cfg.HEADLESS}`);
    console.log(` • Nível de Log: ${cfg.LOG_LEVEL}`);
    if (cfg.SESSION_SECRET) {
      console.log(` • SESSION_SECRET: [CONFIGURADO - ${cfg.SESSION_SECRET.length} caracteres]`);
    } else {
      console.log(` • SESSION_SECRET: [NÃO CONFIGURADO - necessário para export_session]`);
    }
    console.log('\n[DRY-RUN] Execução concluída sem inicializar navegador.');
    console.log('===============================================================\n');
    process.exit(0);
  }
}

module.exports = {
  loadConfig,
  isDryRun,
  isForce,
  handleDryRun,
  credentialsEnvPath,
  sessionPath,
  sessionMetaPath,
  sessionTokenPath,
  lockFilePath
};
