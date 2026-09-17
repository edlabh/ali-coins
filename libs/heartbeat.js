const logger = require('../logger');

const { version: APP_VERSION } = require('../package.json');
const USER_AGENT = `ali-coins/${APP_VERSION}`;

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
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      const lastIndex = pathParts.length - 1;
      const last = pathParts[lastIndex];
      // Se for ação /start ou /fail no final, pega a parte anterior
      if ((last === 'start' || last === 'fail') && pathParts.length > 1) {
        const token = pathParts[lastIndex - 1];
        if (token.length > 8) {
          pathParts[lastIndex - 1] = `${token.slice(0, 4)}***${token.slice(-4)}`;
        } else {
          pathParts[lastIndex - 1] = '***';
        }
      } else if (last.length > 8) {
        pathParts[lastIndex] = `${last.slice(0, 4)}***${last.slice(-4)}`;
      } else {
        pathParts[lastIndex] = '***';
      }
      parsed.pathname = '/' + pathParts.join('/');
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
  if (clean.endsWith('/start')) {
    clean = clean.slice(0, -6);
  } else if (clean.endsWith('/fail')) {
    clean = clean.slice(0, -5);
  }
  return clean;
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
  const startUrl = `${base}/start`;
  const masked = maskHeartbeatUrl(startUrl);

  try {
    const res = await fetch(startUrl, {
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
      const getRes = await fetch(startUrl, {
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
    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'start', err: err.message },
      `Falha ao enviar heartbeat de início: ${err.message}`
    );
    return { ok: false, error: err.message };
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
        body = JSON.stringify(report, null, 2);
        contentType = 'application/json';
      }
    } catch {
      body = String(report);
    }
  }

  try {
    const res = await fetch(base, {
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
      const getRes = await fetch(base, {
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
    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'success', err: err.message },
      `Falha ao enviar heartbeat de sucesso: ${err.message}`
    );
    return { ok: false, error: err.message };
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
  const failUrl = `${base}/fail`;
  const masked = maskHeartbeatUrl(failUrl);

  let body = 'AliExpress Coins job encountered a failure';
  if (err) {
    if (err instanceof Error) {
      body = `${err.name}: ${err.message}\n${err.stack || ''}`;
    } else {
      body = String(err);
    }
  }

  try {
    const res = await fetch(failUrl, {
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
      const getRes = await fetch(failUrl, {
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
    logger.warn(
      { heartbeat: 'failed', url: masked, stage: 'fail', err: e.message },
      `Falha ao enviar heartbeat de falha: ${e.message}`
    );
    return { ok: false, error: e.message };
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
  pingStart,
  pingSuccess,
  pingFail,
  sendHeartbeat
};
