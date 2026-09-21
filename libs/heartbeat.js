const logger = require('../logger');
const { sanitizeSensitiveQueryParams } = require('../logger');
const { validateExternalUrl, safeFetch } = require('./url_guard');

const { version: APP_VERSION } = require('../package.json');
const USER_AGENT = `ali-coins/${APP_VERSION}`;

// Teto do corpo enviado ao endpoint externo (mesmo limite do webhook).
const HEARTBEAT_MAX_BODY_BYTES = 32 * 1024;

/**
 * Mascara uma URL de heartbeat/ping para exibição segura em logs, preservando
 * o host e mascarando o meio do UUID ou token de identificação.
 * @param {string} url URL completa do heartbeat
 * @returns {string} URL mascarada
 */
function maskHeartbeatUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    // Nunca expõe credenciais embutidas na URL (https://user:senha@host/...)
    parsed.username = '';
    parsed.password = '';

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      const lastIndex = pathParts.length - 1;
      for (let i = 0; i <= lastIndex; i++) {
        const part = pathParts[i];
        const isAction = i === lastIndex && (part === 'start' || part === 'fail');
        if (isAction) continue; // ação não é segredo
        if (i === lastIndex) {
          // Último segmento: sempre mascarado (token) — preserva o comportamento histórico
          pathParts[i] = part.length > 8 ? `${part.slice(0, 4)}***${part.slice(-4)}` : '***';
        } else if (part.length > 8) {
          // Segmentos intermediários longos também são tokens (ex: /api/<token>/ping)
          pathParts[i] = `${part.slice(0, 4)}***${part.slice(-4)}`;
        }
      }
      parsed.pathname = '/' + pathParts.join('/');
    }
    // Mascara valores de query string (tokens/apikeys enviados como parâmetro)
    if (parsed.searchParams.size > 0) {
      for (const [key, value] of parsed.searchParams) {
        parsed.searchParams.set(
          key,
          value.length > 8 ? `${value.slice(0, 4)}***${value.slice(-4)}` : '***'
        );
      }
    }
    if (parsed.hash) {
      parsed.hash = '';
    }
    return parsed.toString();
  } catch {
    return url.length > 12 ? `${url.slice(0, 8)}***${url.slice(-4)}` : '***';
  }
}

/**
 * Normaliza a URL base removendo barras finais e caminhos de ação prévios (/start ou /fail)
 * @param {string} url
 * @returns {string}
 */
function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let clean = url.trim().replace(/\/+$/, '');
  // Remove sufixos de ação preservando query string (ex.: .../uuid/start?x=1)
  clean = clean.replace(/\/(start|fail)(?=($|[?#]))/i, '');
  return clean;
}

/**
 * Monta a URL de uma ação do heartbeat (start/fail) inserindo o segmento ANTES da
 * query string, preservando-a (ex.: https://host/uuid?k=v -> https://host/uuid/start?k=v).
 * @param {string} baseUrl
 * @param {'start'|'fail'} action
 * @returns {string}
 */
function buildActionUrl(baseUrl, action) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return '';
  try {
    const u = new URL(base);
    const path = u.pathname.replace(/\/+$/, '');
    u.pathname = `${path}/${action}`;
    return u.toString();
  } catch {
    return `${base}/${action}`;
  }
}

/**
 * Envia sinal de início (start) para o monitor de dead man's switch
 * @param {string} url URL base do heartbeat
 * @param {object} [options={}] Opções adicionais
 * @param {number} [options.timeoutMs=5000] Tempo limite da requisição em milissegundos
 * @param {string} [options.body] Mensagem opcional de corpo
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string, status?: number }>}
 */
async function pingStart(url, options = {}) {
  const base = normalizeBaseUrl(url);
  if (!base) {
    logger.debug({ heartbeat: 'skipped' }, 'Heartbeat ignorado no início: URL não informada.');
    return { ok: true, skipped: true };
  }

  const timeoutMs = options.timeoutMs || 5000;
  const startUrl = buildActionUrl(base, 'start');
  const masked = maskHeartbeatUrl(startUrl);

  try {
    const res = await safeFetch(startUrl, {
      method: 'POST',
      body: options.body || 'AliExpress Coins job started',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'text/plain'
      }
    });

    if (res.ok) {
      logger.info(
        { heartbeat: 'ok', url: masked, stage: 'start', status: res.status },
        'Heartbeat de início enviado com sucesso.'
      );
      return { ok: true, status: res.status };
    }

    // Se o serviço não aceitar POST no /start (ex: 405 Method Not Allowed), tenta GET como fallback
    if (res.status === 405) {
      const getRes = await safeFetch(startUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT }
      });
      if (getRes.ok) {
        logger.info(
          { heartbeat: 'ok', url: masked, stage: 'start', status: getRes.status },
          'Heartbeat de início (GET fallback) enviado com sucesso.'
        );
        return { ok: true, status: getRes.status };
      }
    }

    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'start', status: res.status },
      `Falha na resposta do heartbeat de início (HTTP ${res.status}).`
    );
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    const safeErr = sanitizeSensitiveQueryParams(String((err && err.message) || err));
    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'start', err: safeErr },
      `Falha ao enviar heartbeat de início: ${safeErr}`
    );
    return { ok: false, error: safeErr };
  }
}

/**
 * Envia sinal de sucesso para o monitor de dead man's switch com relatório anexado
 * @param {string} url URL base do heartbeat
 * @param {object|string} [report] Relatório de execução ou mensagem descritiva
 * @param {object} [options={}] Opções adicionais
 * @param {number} [options.timeoutMs=5000] Tempo limite da requisição em milissegundos
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string, status?: number }>}
 */
async function pingSuccess(url, report = null, options = {}) {
  const base = normalizeBaseUrl(url);
  if (!base) {
    logger.debug({ heartbeat: 'skipped' }, 'Heartbeat ignorado no sucesso: URL não informada.');
    return { ok: true, skipped: true };
  }

  const timeoutMs = options.timeoutMs || 5000;
  const masked = maskHeartbeatUrl(base);

  let body = 'AliExpress Coins job finished successfully';
  let contentType = 'text/plain';

  if (report) {
    try {
      if (typeof report === 'string') {
        body = report;
      } else {
        body = JSON.stringify(report);
        contentType = 'application/json';
      }
    } catch {
      body = String(report);
    }
  }

  // Teto de tamanho: evita POSTar um relatório grande/inesperado a um endpoint de terceiros.
  // Nunca FATIAR o body (JSON cortado no meio vira inválido): usa o resumo em texto puro.
  if (Buffer.byteLength(body, 'utf8') > HEARTBEAT_MAX_BODY_BYTES) {
    body = 'AliExpress Coins job finished successfully (payload excedeu o limite)';
    contentType = 'text/plain';
  }

  try {
    const res = await safeFetch(base, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': contentType
      }
    });

    if (res.ok) {
      logger.info(
        { heartbeat: 'ok', url: masked, stage: 'success', status: res.status },
        'Heartbeat de sucesso enviado com sucesso.'
      );
      return { ok: true, status: res.status };
    }

    // Fallback GET caso POST retorne 405
    if (res.status === 405) {
      const getRes = await safeFetch(base, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT }
      });
      if (getRes.ok) {
        logger.info(
          { heartbeat: 'ok', url: masked, stage: 'success', status: getRes.status },
          'Heartbeat de sucesso (GET fallback) enviado com sucesso.'
        );
        return { ok: true, status: getRes.status };
      }
    }

    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'success', status: res.status },
      `Falha na resposta do heartbeat de sucesso (HTTP ${res.status}).`
    );
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    const safeErr = sanitizeSensitiveQueryParams(String((err && err.message) || err));
    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'success', err: safeErr },
      `Falha ao enviar heartbeat de sucesso: ${safeErr}`
    );
    return { ok: false, error: safeErr };
  }
}

/**
 * Envia sinal de falha (fail) para o monitor de dead man's switch
 * @param {string} url URL base do heartbeat
 * @param {Error|string} [err] Erro ocorrido durante a execução
 * @param {object} [options={}] Opções adicionais
 * @param {number} [options.timeoutMs=5000] Tempo limite da requisição em milissegundos
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string, status?: number }>}
 */
async function pingFail(url, err = null, options = {}) {
  const base = normalizeBaseUrl(url);
  if (!base) {
    logger.debug({ heartbeat: 'skipped' }, 'Heartbeat ignorado na falha: URL não informada.');
    return { ok: true, skipped: true };
  }

  const timeoutMs = options.timeoutMs || 5000;
  const failUrl = buildActionUrl(base, 'fail');
  const masked = maskHeartbeatUrl(failUrl);

  let body = 'AliExpress Coins job encountered a failure';
  if (err) {
    // Redige segredos que possam aparecer na mensagem (URLs com token/code, headers).
    const safeMsg = sanitizeSensitiveQueryParams(
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    );
    body = safeMsg.slice(0, 2000);
  }

  try {
    const res = await safeFetch(failUrl, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'text/plain'
      }
    });

    if (res.ok) {
      logger.info(
        { heartbeat: 'ok', url: masked, stage: 'fail', status: res.status },
        'Heartbeat de falha enviado com sucesso.'
      );
      return { ok: true, status: res.status };
    }

    // Fallback GET caso POST retorne 405
    if (res.status === 405) {
      const getRes = await safeFetch(failUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT }
      });
      if (getRes.ok) {
        logger.info(
          { heartbeat: 'ok', url: masked, stage: 'fail', status: getRes.status },
          'Heartbeat de falha (GET fallback) enviado com sucesso.'
        );
        return { ok: true, status: getRes.status };
      }
    }

    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'fail', status: res.status },
      `Falha na resposta do heartbeat de falha (HTTP ${res.status}).`
    );
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    const safeErr = sanitizeSensitiveQueryParams(String((e && e.message) || e));
    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'fail', err: safeErr },
      `Falha ao enviar heartbeat de falha: ${safeErr}`
    );
    return { ok: false, error: safeErr };
  }
}

/**
 * Função de alto nível para disparo controlado de heartbeat conforme configuração
 * @param {'start'|'success'|'fail'} stage Etapa de envio
 * @param {object} params
 * @param {object} [params.config] Configuração validada
 * @param {string} [params.url] URL opcional (caso não fornecida via config)
 * @param {object|string} [params.report] Relatório de execução
 * @param {Error|string} [params.error] Erro ocorrido
 * @param {number} [params.timeoutMs] Timeout opcional
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
 */
async function sendHeartbeat(stage, params = {}) {
  const { config, url, report, error, timeoutMs } = params;
  const targetUrl = url || (config && config.HEARTBEAT_URL);
  const isEnabled = config ? config.HEARTBEAT_ENABLED : Boolean(targetUrl);
  const timeout = timeoutMs || (config && config.HEARTBEAT_TIMEOUT_MS) || 5000;

  if (!isEnabled || !targetUrl) {
    logger.debug({ heartbeat: 'skipped' }, `Heartbeat (${stage}) desativado ou sem URL.`);
    return { ok: true, skipped: true };
  }

  // Proteção contra SSRF: bloqueia destinos loopback/privados e também hostnames que
  // resolvem para IP privado (ex.: metadata interno via DNS). Opt-in ALLOW_PRIVATE_WEBHOOKS
  // para ambientes que realmente precisam de destino privado.
  const guard = await validateExternalUrl(targetUrl);
  if (!guard.ok) {
    logger.warn(
      { heartbeat: 'blocked', reason: guard.reason, url: maskHeartbeatUrl(targetUrl) },
      'Heartbeat não enviado: destino bloqueado pela validação de segurança (SSRF).'
    );
    return { ok: false, error: guard.reason };
  }

  if (stage === 'start') {
    return await pingStart(targetUrl, { timeoutMs: timeout });
  }
  if (stage === 'success') {
    return await pingSuccess(targetUrl, report, { timeoutMs: timeout });
  }
  if (stage === 'fail') {
    return await pingFail(targetUrl, error, { timeoutMs: timeout });
  }

  return { ok: false, error: `Estágio de heartbeat desconhecido: "${stage}"` };
}

module.exports = {
  maskHeartbeatUrl,
  normalizeBaseUrl,
  buildActionUrl,
  pingStart,
  pingSuccess,
  pingFail,
  sendHeartbeat
};
