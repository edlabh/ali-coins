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
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
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
  // Falha de DNS é tolerada (o destino simplesmente não responderá); o objetivo é
  // impedir que um hostname PÚBLICO resolva para IP privado/loopback.
  if (options.resolveDns !== false) {
    try {
      const records = await dns.lookup(host, { all: true });
      for (const rec of records) {
        if (isPrivateIp(rec.address) && !allowPrivate) {
          return {
            ok: false,
            reason: `Host resolve para IP privado (${rec.address}) — bloqueado (SSRF).`
          };
        }
      }
    } catch {
      // Sem resolução DNS: não bloqueia (o fetch irá falhar por conta própria)
    }
  }

  return { ok: true, url: parsed };
}

module.exports = {
  isPrivateIp,
  allowPrivateTargets,
  validateExternalUrl,
  PRIVATE_HOSTNAMES
};
