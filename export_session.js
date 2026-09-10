const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function exportSession() {
  const sessionPath = path.join(__dirname, 'session.json');
  const sessionMetaPath = path.join(__dirname, 'session_meta.json');
  const envPath = path.join(__dirname, 'credentials.env');

  console.log('===================================================================');
  console.log('               EXPORTAÇÃO DE SESSÃO ALIEXPRESS');
  console.log('===================================================================\n');

  if (!fs.existsSync(sessionPath)) {
    console.error('[ERRO] Arquivo "session.json" não encontrado.');
    console.error('Execute o script na máquina local primeiro (./run_all.sh) para gerar uma sessão autenticada.');
    process.exit(1);
  }

  let session;
  try {
    session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  } catch (e) {
    console.error('[ERRO] Falha ao ler session.json:', e.message);
    process.exit(1);
  }

  const hasAuth = (session.cookies || []).some(c => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value);
  if (!hasAuth) {
    console.error('[ERRO] A sessão em "session.json" não possui cookies válidos de autenticação.');
    console.error('Execute o script interativamente para se logar no AliExpress.');
    process.exit(1);
  }

  let user = 'desconhecido';
  if (fs.existsSync(sessionMetaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(sessionMetaPath, 'utf-8'));
      if (meta.user) user = meta.user;
    } catch (e) {}
  }

  if (user === 'desconhecido' && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const m = envContent.match(/ALI_USER=["']?([^"'\r\n]+)/);
    if (m) user = m[1].trim();
  }

  // Otimizar payload removendo caches volumosos de scripts do localStorage (>200KB)
  if (session.origins && Array.isArray(session.origins)) {
    session.origins.forEach(o => {
      if (o.localStorage && Array.isArray(o.localStorage)) {
        o.localStorage = o.localStorage.filter(i => !i.name.includes('APLUS_S_CORE') && !i.name.includes('batman'));
      }
    });
  }

  const meta = {
    user,
    exportedAt: new Date().toISOString()
  };

  const payload = JSON.stringify({ session, meta });
  const compressed = zlib.gzipSync(Buffer.from(payload, 'utf-8')).toString('base64');

  // Salvar token também em arquivo auxiliar
  const tokenFile = path.join(__dirname, 'session_token.txt');
  fs.writeFileSync(tokenFile, compressed, 'utf-8');

  console.log(`[OK] Sessão autenticada encontrada para a conta: ${user}`);
  console.log(`[OK] Cookies de autenticação: VÁLIDOS (${session.cookies.length} cookies)`);
  console.log(`[OK] Arquivo auxiliar salvo em: session_token.txt\n`);
  console.log('--- COMO IMPORTAR NO SEU SERVIDOR NA NUVEM (ORACLE CLOUD / AWS) ---');
  console.log('No terminal do seu servidor na nuvem, dentro da pasta ~/ali-coins,');
  console.log('execute o seguinte comando:\n');
  console.log(`node import_session.js '${compressed}'\n`);
  console.log('===================================================================');
}

exportSession();
