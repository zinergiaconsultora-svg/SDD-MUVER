// Verificación en el origen del JWT de Cloudflare Access (design.md §5.9): RS256 con node:crypto, claves públicas
// de https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs (caché de 1 h). Falla cerrado: ante cualquier duda,
// la petición por el túnel se rechaza.
import crypto from 'node:crypto';

export const ACCESS_HEADER = 'cf-access-jwt-assertion';

export function accessIssuer(team) {
  return `https://${team}.cloudflareaccess.com`;
}

export function accessCertsUrl(team) {
  return `${accessIssuer(team)}/cdn-cgi/access/certs`;
}

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** { header, payload, signingInput, signature } o null si no son tres partes base64url con JSON válido. */
export function decodeJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]*$/.test(parts[2])) return null;
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (!header || !payload) return null;
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
}

/**
 * Verificador de tokens de Access. verify(token) → { ok: true, claims } | { ok: false, reason } con reason en
 * missing, malformed, alg, kid, signature, aud, iss, exp, nbf, certs.
 */
export function createAccessVerifier({
  team,
  aud,
  certsUrl = accessCertsUrl(team),
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheMs = 3600000,
  refetchMinMs = 60000,
  leewaySec = 60,
  log = console.error,
} = {}) {
  const issuer = accessIssuer(team);
  let keys = null; // Map<kid, KeyObject>
  let fetchedAt = 0;
  let lastAttemptAt = -Infinity;
  let inflight = null;

  async function download() {
    lastAttemptAt = now();
    const res = await fetchImpl(certsUrl, { headers: { Accept: 'application/json' } });
    if (!res || !res.ok) throw new Error(`respuesta HTTP ${res ? res.status : '?'}`);
    const data = await res.json();
    const map = new Map();
    for (const jwk of Array.isArray(data && data.keys) ? data.keys : []) {
      if (!jwk || typeof jwk.kid !== 'string') continue;
      try {
        map.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        // clave no utilizable: se ignora
      }
    }
    keys = map;
    fetchedAt = now();
    return map;
  }

  /** Claves en caché o descargadas (una sola descarga a la vez). Lanza si la descarga falla. */
  function loadKeys({ force = false } = {}) {
    if (!force && keys && now() - fetchedAt < cacheMs) return Promise.resolve(keys);
    if (!inflight) {
      inflight = download().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  async function keyFor(kid) {
    let map = await loadKeys();
    if (!map.has(kid) && now() - lastAttemptAt >= refetchMinMs) map = await loadKeys({ force: true });
    return map.get(kid) || null;
  }

  async function verify(token) {
    if (typeof token !== 'string' || token === '') return { ok: false, reason: 'missing' };
    const jwt = decodeJwt(token);
    if (!jwt) return { ok: false, reason: 'malformed' };
    if (jwt.header.alg !== 'RS256') return { ok: false, reason: 'alg' };
    let key;
    try {
      key = await keyFor(String(jwt.header.kid ?? ''));
    } catch (err) {
      log('[panel] No se pudieron descargar las claves de Cloudflare Access:', err && err.message ? err.message : err);
      return { ok: false, reason: 'certs' };
    }
    if (!key) return { ok: false, reason: 'kid' };
    let valid = false;
    try {
      valid = crypto.verify('RSA-SHA256', Buffer.from(jwt.signingInput), key, jwt.signature);
    } catch {
      valid = false;
    }
    if (!valid) return { ok: false, reason: 'signature' };
    const claims = jwt.payload;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(aud)) return { ok: false, reason: 'aud' };
    if (claims.iss !== issuer) return { ok: false, reason: 'iss' };
    const nowSec = now() / 1000;
    if (!Number.isFinite(claims.exp) || claims.exp + leewaySec <= nowSec) return { ok: false, reason: 'exp' };
    if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf - leewaySec > nowSec)) return { ok: false, reason: 'nbf' };
    return { ok: true, claims };
  }

  return { verify };
}
