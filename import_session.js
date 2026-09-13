const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { sessionPath, sessionMetaPath, credentialsEnvPath } = require('./config');
const { decryptSession, validateSessionPayload, safeWriteFile, safeChmod600 } = require('./security');
const logger = require('./logger');

// Carregar variáveis de ambiente do credentials.env de forma silenciosa
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

async function readTokenFromInput() {
  const args = process.argv.slice(2);
  let filePath = null;

  // 1. Detectar e alertar caso alguém tente passar token via argv direto
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--from-file=')) {
      filePath = arg.split('=')[1].trim();
    } else if (arg === '--from-file' && args[i + 1]) {
      filePath = args[i + 1].trim();
      i++;
    } else if (arg.startsWith('-')) {
      // Outras possíveis flags ignoradas
      continue;
    } else {
      console.warn('\n' + '!'.repeat(68));
      console.warn(' [AVISO DE SEGURANÇA - ARGUMENTO ARGV IGNORADO]');
      console.warn(' Tokens de sessão NÃO são aceitos diretamente como argumentos de argv.');
      console.warn(' Passar tokens sensíveis na linha de comando expõe seus segredos no');
      console.warn(' histórico do shell (~/.bash_history) e na listagem de processos (ps aux).');
      console.warn('');
      console.warn(' O argumento fornecido foi IGNORADO.');
      console.warn(' Utilize:');
      console.warn('   node import_session.js < session_token.txt');
      console.warn('   OU');
      console.warn('   node import_session.js --from-file=session_token.txt');
      console.warn('!'.repeat(68) + '\n');
    }
  }

  // 2. Leitura via arquivo com flag explícita --from-file
  if (filePath) {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Arquivo especificado em --from-file não encontrado: "${resolvedPath}"`);
    }
    const content = await fs.promises.readFile(resolvedPath, 'utf-8');
    return Buffer.from(content.trim(), 'utf-8');
  }

  // 3. Leitura via STDIN (pipe ou redirecionamento <)
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      process.stdin.on('data', chunk => chunks.push(chunk));
      process.stdin.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        resolve(fullBuffer);
      });
      process.stdin.on('error', reject);
    });
  }

  return null;
}

async function importSession() {
  console.log('===================================================================');
  console.log('         IMPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM)');
  console.log('===================================================================\n');

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    console.error('\n' + '='.repeat(68));
    console.error(' [ERRO DE SEGURANÇA - SESSION_SECRET OBRIGATÓRIA]');
    console.error(' A descriptografia da sessão exige uma chave de no mínimo 32 caracteres.');
    console.error('');
    console.error(' Como configurar:');
    console.error(' 1. Defina a variável de ambiente:');
    console.error('    export SESSION_SECRET="sua_chave_ultra_secreta_com_mais_de_32_caracteres"');
    console.error(' 2. Ou declare diretamente no credentials.env:');
    console.error('    SESSION_SECRET="sua_chave_ultra_secreta_com_mais_de_32_caracteres"');
    console.error('='.repeat(68) + '\n');
    process.exit(1);
  }

  const rawTokenBuffer = await readTokenFromInput();

  if (!rawTokenBuffer || rawTokenBuffer.length === 0) {
    console.error('[ERRO] Nenhum token de sessão fornecido via STDIN ou --from-file.');
    console.error('\nInstruções de uso seguro:');
    console.error('  1. Via redirecionamento STDIN (Recomendado):');
    console.error('     node import_session.js < session_token.txt\n');
    console.error('  2. Via flag de arquivo:');
    console.error('     node import_session.js --from-file=session_token.txt\n');
    process.exit(1);
  }

  const tokenString = rawTokenBuffer.toString('utf-8').trim();

  let decryptedJson;
  try {
    decryptedJson = decryptSession(tokenString, secret);
  } catch (err) {
    console.error(`\n[ERRO DE DESCRIPTOGRAFIA] ${err.message}\n`);
    process.exit(1);
  } finally {
    // Zerar buffer com o token sensível da memória após uso
    rawTokenBuffer.fill(0);
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(decryptedJson);
  } catch (err) {
    console.error('[ERRO] Conteúdo descriptografado não é um JSON válido.');
    process.exit(1);
  }

  // Validação estrita do schema via Zod
  let validated;
  try {
    validated = validateSessionPayload(parsedPayload);
  } catch (err) {
    console.error(`[ERRO] ${err.message}`);
    process.exit(1);
  }

  const sessionData = validated.session;
  const metaData = validated.meta || { user: 'importado', savedAt: new Date().toISOString() };

  // Verificação de idade da sessão importada (alerta se > 90 dias ou expirada)
  if (metaData.exportedAt) {
    const exportedTime = new Date(metaData.exportedAt).getTime();
    if (!isNaN(exportedTime)) {
      const ageDays = (Date.now() - exportedTime) / (1000 * 60 * 60 * 24);
      if (ageDays > 90) {
        console.warn(`\n⚠️  [AVISO DE EXPIRAÇÃO] A sessão importada foi exportada há mais de 90 dias (${Math.floor(ageDays)} dias).`);
        console.warn('   Os cookies do AliExpress podem ter expirado ou estar prestes a expirar.');
        console.warn('   Se a autenticação falhar, renove a sessão no computador e faça nova exportação.\n');
      }
    }
  }

  if (metaData.expiresAt) {
    const expiryTime = new Date(metaData.expiresAt).getTime();
    if (!isNaN(expiryTime) && Date.now() > expiryTime) {
      console.warn(`\n⚠️  [AVISO DE EXPIRAÇÃO] A data de expiração recomendada (${metaData.expiresAt}) foi ultrapassada.\n`);
    }
  }

  // Gravar arquivos com permissões estritas 0o600
  await safeWriteFile(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
  await safeWriteFile(sessionMetaPath, JSON.stringify(metaData, null, 2), 'utf-8');
  safeChmod600(sessionPath);
  safeChmod600(sessionMetaPath);

  console.log(`[SUCESSO] Sessão autenticada descriptografada e validada para a conta: "${metaData.user}"!`);
  if (metaData.exportedAt) {
    console.log(`[SUCESSO] Data de exportação original: ${metaData.exportedAt}`);
  }
  if (metaData.expiresAt) {
    console.log(`[SUCESSO] Validade estimada da sessão: até ${metaData.expiresAt}`);
  }
  console.log(`[SUCESSO] Arquivo "session.json" gravado com permissão 0o600 (${sessionData.cookies.length} cookies).`);
  console.log(`[SUCESSO] Arquivo "session_meta.json" gravado com permissão 0o600.`);
  console.log('\nVocê já pode executar a automação diária com:');
  console.log('  ./run_all.sh\n');
  console.log('===================================================================');
}

if (require.main === module) {
  importSession().catch(err => {
    logger.error({ err: err.message }, 'Falha na importação da sessão.');
    process.exit(1);
  });
}

module.exports = { importSession };
