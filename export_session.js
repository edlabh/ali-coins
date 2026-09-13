const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { sessionPath, sessionMetaPath, sessionTokenPath, credentialsEnvPath } = require('./config');
const { encryptSession, safeWriteFile, safeChmod600, validateSession } = require('./security');
const logger = require('./logger');

// Carregar variáveis de ambiente do credentials.env de forma silenciosa
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

async function exportSession() {
  console.log('===================================================================');
  console.log('         EXPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM)');
  console.log('===================================================================\n');

  if (!fs.existsSync(sessionPath)) {
    console.error('[ERRO] Arquivo "session.json" não encontrado.');
    console.error('Execute o fluxo na máquina local primeiro (./run_all.sh) para autenticar e gerar uma sessão.');
    process.exit(1);
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    console.error('\n' + '='.repeat(68));
    console.error(' [ERRO DE SEGURANÇA - SESSION_SECRET OBRIGATÓRIA]');
    console.error(' A exportação de sessão exige uma chave de criptografia de no mínimo 32 caracteres.');
    console.error('');
    console.error(' Como configurar:');
    console.error(' 1. Defina a variável de ambiente antes de executar:');
    console.error('    export SESSION_SECRET="sua_chave_ultra_secreta_com_mais_de_32_caracteres"');
    console.error(' 2. Ou declare diretamente no credentials.env:');
    console.error('    SESSION_SECRET="sua_chave_ultra_secreta_com_mais_de_32_caracteres"');
    console.error('='.repeat(68) + '\n');
    process.exit(1);
  }

  let session;
  try {
    session = JSON.parse(await fs.promises.readFile(sessionPath, 'utf-8'));
  } catch (e) {
    console.error('[ERRO] Falha ao ler session.json:', e.message);
    process.exit(1);
  }

  let meta = { user: 'desconhecido' };
  if (fs.existsSync(sessionMetaPath)) {
    try {
      meta = JSON.parse(await fs.promises.readFile(sessionMetaPath, 'utf-8'));
    } catch (_) {}
  }

  if (meta.user === 'desconhecido' && process.env.ALI_USER) {
    meta.user = process.env.ALI_USER;
  }

  const validation = validateSession(session, meta, meta.user);
  if (!validation.valid) {
    console.error(`[ERRO] Sessão inválida para exportação: ${validation.reason}`);
    process.exit(1);
  }

  // Otimizar payload removendo caches volumosos de scripts do localStorage (>200KB)
  if (session.origins && Array.isArray(session.origins)) {
    session.origins.forEach(o => {
      if (o.localStorage && Array.isArray(o.localStorage)) {
        o.localStorage = o.localStorage.filter(i => !i.name.includes('APLUS_S_CORE') && !i.name.includes('batman'));
      }
    });
  }

  const now = new Date();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + ninetyDaysMs);

  const exportMeta = {
    user: meta.user,
    exportedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  const payloadString = JSON.stringify({ session, meta: exportMeta });
  const encryptedBlob = encryptSession(payloadString, secret);

  // Salvar token criptografado com permissões restritas 0o600
  await safeWriteFile(sessionTokenPath, encryptedBlob, 'utf-8');
  safeChmod600(sessionPath);
  safeChmod600(sessionMetaPath);
  safeChmod600(sessionTokenPath);

  const fingerprint = crypto.createHash('sha256').update(encryptedBlob).digest('hex').slice(0, 16);
  const blobSize = Buffer.byteLength(encryptedBlob, 'utf-8');

  console.log(`[OK] Sessão autenticada encontrada para a conta: ${meta.user}`);
  console.log(`[OK] Cookies de autenticação: VÁLIDOS (${session.cookies.length} cookies)`);
  console.log(`[OK] Data de exportação: ${exportMeta.exportedAt}`);
  console.log(`[OK] Expiração estimada: até ${exportMeta.expiresAt} (~90 dias)`);
  console.log(`[OK] Fingerprint do token (SHA-256): ${fingerprint}`);
  console.log(`[OK] Tamanho do payload: ${blobSize} bytes`);
  console.log(`[OK] Permissões 0o600 aplicadas em session.json, session_meta.json e session_token.txt`);
  console.log(`[OK] Token criptografado salvo com segurança em: session_token.txt\n`);

  console.log('--- COMO IMPORTAR NO SEU SERVIDOR NA NUVEM DE FORMA SEGURA ---');
  console.log('Opção A (Recomendada via STDIN):');
  console.log('  node import_session.js < session_token.txt\n');
  console.log('Opção B (Via arquivo):');
  console.log('  node import_session.js --from-file=session_token.txt\n');

  const showToken = process.argv.includes('--show-token');
  if (showToken) {
    console.warn('⚠️  [AVISO] Exibição de token em tela solicitada via --show-token.');
    console.log('Blob criptografado (v1):');
    console.log(encryptedBlob);
  } else {
    console.log('(Dica: Por segurança contra vazamento em logs/telas, o token não é exibido no stdout por padrão.');
    console.log(' Caso realmente precise visualizá-lo no terminal, adicione a flag: --show-token)');
  }

  console.log('\n===================================================================');
}

if (require.main === module) {
  exportSession().catch(err => {
    logger.error({ err: err.message }, 'Falha na exportação da sessão.');
    process.exit(1);
  });
}

module.exports = { exportSession };
