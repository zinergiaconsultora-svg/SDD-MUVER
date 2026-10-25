// Confirmación reciente de la contraseña para las acciones de ejecución pedidas por el túnel (design.md §5.10).
// "Por el túnel" = trae CF-Connecting-IP, Cf-Ray o X-Forwarded-Proto: https. Se mira SIEMPRE (aunque
// PANEL_TRUST_PROXY=0): cloudflared conecta desde localhost y falsear estas cabeceras desde la LAN solo endurece.

export const REAUTH_TTL_MS = 15 * 60 * 1000;

function headerText(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** true si la petición llega por el túnel de Cloudflare. */
export function isTunnelRequest(req) {
  const headers = (req && req.headers) || {};
  if (headerText(headers['cf-connecting-ip']) || headerText(headers['cf-ray'])) return true;
  return headerText(headers['x-forwarded-proto']).split(',')[0].trim().toLowerCase() === 'https';
}

/** true si la contraseña se confirmó hace como mucho `ttlMs`. */
export function isReauthFresh(reauthAt, nowMs, ttlMs = REAUTH_TTL_MS) {
  return Number.isFinite(reauthAt) && nowMs - reauthAt <= ttlMs;
}
