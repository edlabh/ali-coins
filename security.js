const fs = require('fs');
const crypto = require('crypto');
const { z } = require('zod');

// Salt fixo da aplicação para derivação determinística de chave via scrypt
const APP_SCRYPT_SALT = Buffer.from('ali-coins-session-encryption-v1-scrypt-salt', 'utf-8');

/**
 * Ajusta permissões do arquivo para 0o600 de forma segura entre plataformas
 * @param {string} filePath
 */
function safeChmod600(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o600);
    }
  } catch (_) {
    // Windows e alguns sistemas de arquivos ignoram chmod sem erro fatal
  }
}

/**
 * Escrita segura e assíncrona de arquivo com permissão 0o600
 * @param {string} filePath
 * @param {string|Buffer} data
 * @param {string} [encoding='utf-8']
 */
async function safeWriteFile(filePath, data, encoding = 'utf-8') {
  await fs.promises.writeFile(filePath, data, { encoding, mode: 0o600 });
  try {
    await fs.promises.chmod(filePath, 0o600);
  } catch (_) {}
}


/**
 * Criptografa o payload da sessão usando scrypt + aes-256-gcm
 * @param {string} payloadJson
 * @param {string} secret
 * @returns {string} Token no formato v1:iv:tag:ciphertext:base64
 */
function encryptSession(payloadJson, secret) {
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    throw new Error('SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para criptografia segura.');
  }

  const key = crypto.scryptSync(secret, APP_SCRYPT_SALT, 32, { N: 16384, r: 8, p: 1 });
  const iv = crypto.randomBytes(12);

  let ciphertext;
  let tag;

  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    ciphertext = Buffer.concat([cipher.update(payloadJson, 'utf-8'), cipher.final()]);
    tag = cipher.getAuthTag();
  } finally {
    // Zerar chave da memória
    key.fill(0);
  }

  const ivB64 = iv.toString('base64');
  const tagB64 = tag.toString('base64');
  const cipherB64 = ciphertext.toString('base64');

  return `v1:${ivB64}:${tagB64}:${cipherB64}:base64`;
}

/**
 * Descriptografa o token de sessão usando scrypt + aes-256-gcm
 * @param {string} tokenString
 * @param {string} secret
 * @returns {string} Payload JSON descriptografado
 */
function decryptSession(tokenString, secret) {
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    throw new Error('SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para descriptografia.');
  }

  const trimmed = tokenString.trim();
  const parts = trimmed.split(':');

  if (parts[0] !== 'v1' || parts.length < 4) {
    throw new Error('Formato de token de sessão inválido. O token deve iniciar com "v1:" e possuir blocos iv:tag:ciphertext.');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  const key = crypto.scryptSync(secret, APP_SCRYPT_SALT, 32, { N: 16384, r: 8, p: 1 });
  let decryptedStr = null;

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decryptedBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    decryptedStr = decryptedBuf.toString('utf-8');
    decryptedBuf.fill(0);
  } catch (err) {
    throw new Error(`Falha na autenticação/descriptografia do token. Verifique se o SESSION_SECRET está correto. Detalhes: ${err.message}`);
  } finally {
    // Zerar buffers da memória imediatamente após o uso
    key.fill(0);
    iv.fill(0);
    tag.fill(0);
    ciphertext.fill(0);
  }

  return decryptedStr;
}

// Schemas Zod para validação rigorosa da sessão
const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.string().optional()
});

const sessionPayloadSchema = z.object({
  session: z.object({
    cookies: z.array(cookieSchema).min(1, 'A sessão deve conter ao menos um cookie.'),
    origins: z.array(z.any()).optional()
  }),
  meta: z.object({
    user: z.string().min(1, 'O usuário no metadado da sessão não pode ser vazio.'),
    exportedAt: z.string().optional(),
    expiresAt: z.string().optional(),
    savedAt: z.string().optional()
  }).optional()
});

/**
 * Valida o schema dos dados de sessão importados
 * @param {object} rawPayload
 * @returns {object} Dados validados
 */
function validateSessionPayload(rawPayload) {
  const result = sessionPayloadSchema.safeParse(rawPayload);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Estrutura de sessão inválida: ${issues}`);
  }
  return result.data;
}

/**
 * Verifica se um cookie está expirado
 * @param {object} cookie
 * @returns {boolean}
 */
function isCookieExpired(cookie) {
  if (typeof cookie.expires === 'number' && cookie.expires > 0) {
    // Playwright armazena expires em segundos Unix
    return (cookie.expires * 1000) <= Date.now();
  }
  return false;
}

/**
 * Validação rigorosa de sessão: correspondência exata de conta e validade dos cookies
 * @param {object} sessionData
 * @param {object} metaData
 * @param {string} expectedUser
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateSession(sessionData, metaData, expectedUser) {
  if (!sessionData || !Array.isArray(sessionData.cookies)) {
    return { valid: false, reason: 'Dados da sessão ausentes ou sem lista de cookies.' };
  }

  // 1. Verificação exata da conta (sem includes solto)
  if (expectedUser) {
    if (!metaData || !metaData.user) {
      return { valid: false, reason: 'Metadados de sessão ausentes ou sem identificação da conta vinculada.' };
    }
    if (metaData.user !== expectedUser) {
      return {
        valid: false,
        reason: `Conta da sessão ativa ("${metaData.user}") não corresponde à conta configurada ("${expectedUser}").`
      };
    }
  }

  // 2. Verificação da presença dos cookies de autenticação
  const authCookies = sessionData.cookies.filter(
    c => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value
  );

  if (authCookies.length === 0) {
    return { valid: false, reason: 'Nenhum cookie de autenticação válido (xman_us_t / login_aliyunid_ticket) encontrado.' };
  }

  // 3. Verificação de expiração dos cookies de autenticação
  const validUnexpiredAuthCookies = authCookies.filter(c => !isCookieExpired(c));
  if (validUnexpiredAuthCookies.length === 0) {
    return { valid: false, reason: 'Todos os cookies de autenticação do AliExpress estão expirados.' };
  }

  // 4. Verificação de idade da sessão exportada (aviso se > 90 dias ou se expiresAt ultrapassado)
  if (metaData && metaData.exportedAt) {
    const exportedTime = new Date(metaData.exportedAt).getTime();
    if (!isNaN(exportedTime)) {
      const ageDays = (Date.now() - exportedTime) / (1000 * 60 * 60 * 24);
      if (ageDays > 90) {
        console.warn(`\n[AVISO DE SESSÃO] A sessão exportada foi gerada há mais de 90 dias (${Math.floor(ageDays)} dias).`);
        console.warn('[AVISO DE SESSÃO] Os cookies do AliExpress podem ter expirado ou estar prestes a expirar. Recomendado renovar com export_session.js.\n');
      }
    }
  }

  if (metaData && metaData.expiresAt) {
    const expiryTime = new Date(metaData.expiresAt).getTime();
    if (!isNaN(expiryTime) && Date.now() > expiryTime) {
      console.warn(`\n[AVISO DE SESSÃO] A sessão ultrapassou a data estimada de expiração (${metaData.expiresAt}).\n`);
    }
  }

  return { valid: true };
}

/**
 * Solicita código 2FA mascarado no terminal com timeout de 120s
 * Falha graciosamente se não for TTY
 * @param {string} promptText
 * @param {number} [timeoutMs=120000]
 * @returns {Promise<string>}
 */
function readMasked2FACode(promptText = '>> Digite o código de 6 dígitos enviado para seu e-mail/SMS: ', timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error(
        'Execução não-interativa detectada (sem TTY). O AliExpress solicitou verificação 2FA.\n' +
        'Solução: Execute localmente com interface interativa (./run_all.sh), resolva o desafio, ' +
        'e use "node export_session.js" / "node import_session.js" para transferir a sessão autenticada.'
      ));
    }

    process.stdout.write(promptText);
    let input = '';
    let timer = null;

    const wasRaw = process.stdin.isRaw;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw || false);
      }
      process.stdin.pause();
    };

    timer = setTimeout(() => {
      cleanup();
      process.stdout.write('\n');
      reject(new Error('Tempo esgotado (120s) aguardando o código 2FA.'));
    }, timeoutMs);

    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          return resolve(input.trim());
        } else if (char === '\u0003') { // Ctrl+C
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
        } else if (char === '\u0008' || char === '\x7f') { // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char.charCodeAt(0) >= 32) {
          input += char;
          process.stdout.write('*');
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

module.exports = {
  safeChmod600,
  safeWriteFile,
  encryptSession,
  decryptSession,
  validateSessionPayload,
  validateSession,
  isCookieExpired,
  readMasked2FACode
};
