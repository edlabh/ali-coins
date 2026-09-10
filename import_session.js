const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

async function getRawToken() {
  // 1. Argumento da linha de comando
  if (process.argv[2] && process.argv[2].trim()) {
    return process.argv[2].trim();
  }

  // 2. Arquivo session_token.txt no diretório atual
  const tokenFile = path.join(__dirname, 'session_token.txt');
  if (fs.existsSync(tokenFile)) {
    const fileContent = fs.readFileSync(tokenFile, 'utf-8').trim();
    if (fileContent) return fileContent;
  }

  // 3. Stdin (pipe)
  if (!process.stdin.isTTY) {
    return new Promise(resolve => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data.trim()));
    });
  }

  return null;
}

async function importSession() {
  console.log('===================================================================');
  console.log('               IMPORTAÇÃO DE SESSÃO ALIEXPRESS');
  console.log('===================================================================\n');

  const rawToken = await getRawToken();

  if (!rawToken) {
    console.error('[ERRO] Nenhum token de sessão informado.');
    console.error('Uso:');
    console.error('  node import_session.js \'<TOKEN_GERADO_NO_EXPORT>\'');
    console.error('  OU salve o token em "session_token.txt" e execute: node import_session.js\n');
    process.exit(1);
  }

  let payload;
  try {
    const jsonStr = zlib.gunzipSync(Buffer.from(rawToken, 'base64')).toString('utf-8');
    payload = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[ERRO] Token inválido ou corrompido:', e.message);
    process.exit(1);
  }

  if (!payload.session || !payload.session.cookies) {
    console.error('[ERRO] Estrutura de sessão inválida no token.');
    process.exit(1);
  }

  const hasAuth = payload.session.cookies.some(c => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value);
  if (!hasAuth) {
    console.error('[ERRO] O token não contém cookies válidos de autenticação do AliExpress.');
    process.exit(1);
  }

  const sessionPath = path.join(__dirname, 'session.json');
  const sessionMetaPath = path.join(__dirname, 'session_meta.json');

  fs.writeFileSync(sessionPath, JSON.stringify(payload.session, null, 2), 'utf-8');
  fs.writeFileSync(sessionMetaPath, JSON.stringify(payload.meta || { user: 'importado' }, null, 2), 'utf-8');

  const user = (payload.meta && payload.meta.user) ? payload.meta.user : 'autenticado';
  console.log(`[SUCESSO] Sessão autenticada importada com êxito para a conta: "${user}"!`);
  console.log(`[SUCESSO] Arquivo "session.json" gravado (${payload.session.cookies.length} cookies).`);
  console.log(`[SUCESSO] Arquivo "session_meta.json" gravado.`);
  console.log('\nVocê já pode executar o fluxo diário com:');
  console.log('  ./run_all.sh\n');
  console.log('===================================================================');
}

importSession();
