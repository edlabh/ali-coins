/**
 * Validação de URLs de destino externas (webhooks/heartbeat) contra SSRF.
 *
 * Bloqueia destinos privados/loopback/link-local/metadata por padrão, permitindo
 * apenas http(s) público. Opt-in explícito para destinos privados via
 * ALLOW_PRIVATE_WEBHOOKS=true (útil em testes locais), mantendo compatibilidade.
 */
const dns = require('dns').promises;
const net = require('net');

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback'
]);

/**
 * Extrai um IPv4 embutido nos últimos 32 bits de um IPv6 em notação hexadecimal
 * (ex.: "64:ff9b::a9fe:a9fe" -> "169.254.169.254", "2002:7f00:1::" -> "127.0.0.1").
 * Retorna null quando não há 32 bits finais interpretáveis.
 * @param {string} lower IPv6 em minúsculas
 * @returns {string|null}
 */
function extractTrailingIpv4FromV6(lower) {
  // Expande "::" para os hextetos completos e pega os 2 últimos
  const [head, tail = ''] = lower.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const full = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  if (full.length < 2) return null;
  const hi = parseInt(full[full.length - 2], 16);
  const lo = parseInt(full[full.length - 1], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/**
 * Verifica se um IP (v4/v6) é privado/loopback/link-local/reservado.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this network"
    if (a === 169 && b === 254) return true; // link-local / cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast/reservado
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback/unspecified
    // Link-local fe80::/10 e site-local (depreciado) fec0::/10: testa a faixa
    // numericamente no primeiro hexteto (fe80..febf e fec0..feff), não só o prefixo "fe80".
    const firstHextet = parseInt(lower.split(':')[0], 16);
    if (Number.isFinite(firstHextet) && (firstHextet & 0xffc0) === 0xfe80) return true;
    if (Number.isFinite(firstHextet) && (firstHextet & 0xffc0) === 0xfec0) return true;
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    // Prefixos que EMBUTEM um IPv4 e traduzem para ele em redes NAT64/6to4/Teredo:
    // 64:ff9b::/96 e 64:ff9b:1::/48 (NAT64), 2002::/16 (6to4), 2001::/32 (Teredo).
    // Em rede com DNS64, [64:ff9b::a9fe:a9fe] alcança 169.254.169.254 (metadata).
    if (firstHextet === 0x0064) {
      const h1 = parseInt(lower.split(':')[1], 16);
      if (h1 === 0xff9b) {
        const embedded = extractTrailingIpv4FromV6(lower);
        return embedded ? isPrivateIp(embedded) : true; // NAT64: trata prefixo como privado
      }
    }
    if (firstHextet === 0x2002) {
      const embedded = extractTrailingIpv4FromV6(lower);
      return embedded ? isPrivateIp(embedded) : true; // 6to4
    }
    // Teredo 2001::/32: o segundo hexteto é 0x0000 (precisa normalizar a expansão de "::")
    if (firstHextet === 0x2001) {
      const seconds = lower.split('::')[0].split(':');
      const secondHextet = seconds.length > 1 ? parseInt(seconds[1], 16) : 0;
      if (secondHextet === 0x0000) {
        const embedded = extractTrailingIpv4FromV6(lower);
        return embedded ? isPrivateIp(embedded) : true;
      }
    }
    // IPv4 mapeado em decimal (::ffff:a.b.c.d)
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    // IPv4 mapeado em hexadecimal (::ffff:7f00:1) — forma para a qual new URL() normaliza
    // um literal como [::ffff:127.0.0.1]. Também cobre IPv4 compatível (::7f00:1, sem ffff).
    const mappedHex = lower.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }

  return true; // não é IP válido: trata como inseguro
}

/**
 * Decide se destinos privados são permitidos (opt-in explícito).
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
function allowPrivateTargets(env = process.env) {
  const raw = env.ALLOW_PRIVATE_WEBHOOKS;
  if (raw === undefined || raw === null || raw === '') return false;
  return ['true', '1', 'on', 'yes'].includes(String(raw).trim().toLowerCase());
}

/**
 * Valida uma URL de destino externo quanto a SSRF.
 * @param {string} rawUrl
 * @param {object} [options={}]
 * @param {boolean} [options.allowPrivate] Sobrescreve o opt-in do env
 * @param {boolean} [options.resolveDns=true] Resolver o hostname para checar IPs privados
 * @returns {Promise<{ ok: boolean, reason?: string, url?: URL }>}
 */
async function validateExternalUrl(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, reason: 'URL ausente ou inválida.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL malformada.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Protocolo não permitido: ${parsed.protocol}` };
  }

  const allowPrivate =
    typeof options.allowPrivate === 'boolean' ? options.allowPrivate : allowPrivateTargets();

  // Host literal (IP ou hostname conhecido) — checagem síncrona.
  // URL.hostname devolve IPv6 entre colchetes ("[::1]"); remove os colchetes e o ponto
  // final (FQDN absoluto, ex.: "localhost.") antes de classificar.
  const host = parsed.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
  if (PRIVATE_HOSTNAMES.has(host)) {
    if (!allowPrivate) return { ok: false, reason: 'Destino loopback bloqueado (SSRF).' };
    return { ok: true, url: parsed };
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host) && !allowPrivate) {
      return { ok: false, reason: 'Destino em rede privada/loopback bloqueado (SSRF).' };
    }
    return { ok: true, url: parsed };
  }

  // Hostname: resolve e valida todos os IPs (evita DNS rebinding para rede privada).
  // FALHA FECHADA: se não conseguir resolver, bloqueia. Antes tolerava a falha, o que
  // permitia que um hostname que só resolve no momento do fetch escapasse da checagem.
  // Com allowPrivate, o destino privado é permitido por opt-in — não há o que bloquear.
  if (options.resolveDns !== false && !allowPrivate) {
    let records;
    try {
      records = await withTimeout(
        dns.lookup(host, { all: true }),
        options.dnsTimeoutMs || 3000,
        'Tempo esgotado ao resolver o DNS do destino (SSRF guard).'
      );
    } catch (err) {
      return {
        ok: false,
        reason: `Não foi possível resolver o DNS do destino (${err.message}) — bloqueado por segurança (SSRF).`
      };
    }
    if (!Array.isArray(records) || records.length === 0) {
      return { ok: false, reason: 'Destino sem registros DNS — bloqueado por segurança (SSRF).' };
    }
    for (const rec of records) {
      if (isPrivateIp(rec.address) && !allowPrivate) {
        return {
          ok: false,
          reason: `Host resolve para IP privado (${rec.address}) — bloqueado (SSRF).`
        };
      }
    }
  }

  return { ok: true, url: parsed };
}

/**
 * Corrida entre uma promise e um timeout.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * fetch para destinos externos com proteção SSRF que NÃO é contornável por redirects.
 *
 * O `fetch` nativo segue redirects por padrão (redirect: 'follow'), então um destino
 * público pode responder 302 para um IP privado/metadata e o guard em
 * `validateExternalUrl` nunca veria o alvo. Aqui seguimos os redirects manualmente,
 * revalidando CADA hop com `validateExternalUrl` (mesmo guard), limitando o número
 * de saltos e rejeitando métodos/URLs inválidos. Segredos no header Authorization
 * são descartados ao mudar de origem.
 *
 * @param {string} rawUrl
 * @param {object} [init={}] Opções do fetch (method, headers, body, signal)
 * @param {object} [options={}]
 * @param {number} [options.maxRedirects=5]
 * @param {boolean} [options.allowPrivate]
 * @param {number} [options.dnsTimeoutMs]
 * @returns {Promise<Response>}
 */
async function safeFetch(rawUrl, init = {}, options = {}) {
  const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : 5;
  let currentUrl = rawUrl;
  let currentInit = { ...init };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const guard = await validateExternalUrl(currentUrl, {
      allowPrivate: options.allowPrivate,
      dnsTimeoutMs: options.dnsTimeoutMs
    });
    if (!guard.ok) {
      const err = new Error(`Destino bloqueado pelo guard SSRF: ${guard.reason}`);
      err.code = 'SSRF_BLOCKED';
      err.reason = guard.reason;
      throw err;
    }

    const response = await fetch(currentUrl, { ...currentInit, redirect: 'manual' });

    // 3xx com Location: segue manualmente revalidando o próximo hop
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (hop === maxRedirects) {
        throw new Error(
          `Número máximo de redirects (${maxRedirects}) excedido no destino externo.`
        );
      }
      const nextUrl = new URL(response.headers.get('location'), currentUrl).toString();
      const sameOrigin = new URL(nextUrl).origin === new URL(currentUrl).origin;
      if (!sameOrigin) {
        // Não propaga credenciais para outra origem
        const headers = { ...(currentInit.headers || {}) };
        delete headers.Authorization;
        delete headers.authorization;
        delete headers.Cookie;
        delete headers.cookie;
        currentInit = { ...currentInit, headers };
      }
      // 303 (e 301/302 em POST, por convenção) viram GET sem body
      const method = String(currentInit.method || 'GET').toUpperCase();
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === 'POST')
      ) {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
      if (typeof response.body?.cancel === 'function') {
        await response.body.cancel().catch(() => {});
      }
      currentUrl = nextUrl;
      continue;
    }

    return response;
  }

  throw new Error('Fluxo de redirects não resolvido (guard SSRF).');
}

module.exports = {
  isPrivateIp,
  allowPrivateTargets,
  validateExternalUrl,
  safeFetch,
  PRIVATE_HOSTNAMES
};
