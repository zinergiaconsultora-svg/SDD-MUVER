// Utilidades HTTP: respuestas JSON, lectura segura del cuerpo y servicio de estáticos.
import fs from 'node:fs/promises';
import path from 'node:path';

export const BODY_LIMIT_BYTES = 65536;

export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
});

export const COOKIE_NAME = 'muver_session';

/** Responde JSON. Conserva las cabeceras ya fijadas con res.setHeader (p. ej. Set-Cookie). */
export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status);
  res.end(payload);
}

export function sendEmpty(res, status) {
  res.writeHead(status);
  res.end();
}

export function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Lee el cuerpo de la petición como JSON. Rechaza con { status: 400, error: 'Cuerpo JSON inválido' }
 * si supera `limit` bytes, no parsea o no es un objeto plano (null, "", 0, [], false…). Cuerpo vacío → {}.
 */
export function readJsonBody(req, { limit = BODY_LIMIT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const invalid = () => ({ status: 400, error: 'Cuerpo JSON inválido' });
    const chunks = [];
    let received = 0;
    let settled = false;

    const fail = () => {
      if (settled) return;
      settled = true;
      req.removeAllListeners('data');
      req.resume();
      reject(invalid());
    };

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > limit) return fail();
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
        const parsed = text.trim() === '' ? {} : JSON.parse(text);
        if (!isPlainObject(parsed)) return reject(invalid());
        resolve(parsed);
      } catch {
        reject(invalid());
      }
    });
    req.on('error', fail);
  });
}

/** Parsea la cabecera Cookie: { nombre: valor }, con decodeURIComponent tolerante. */
export function parseCookies(req) {
  const header = req && req.headers ? req.headers.cookie : '';
  const cookies = {};
  if (typeof header !== 'string' || !header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

/** Construye la cabecera Set-Cookie de sesión. Borrado: buildSetCookie('', { maxAge: 0, secure }). */
export function buildSetCookie(value, { maxAge, secure = false }) {
  const parts = [`${COOKIE_NAME}=${value}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.max(0, Math.floor(maxAge))}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.split(',')[0].trim() : '';
}

/**
 * Corrección T36 (= M3 de la fase 2): true si la conexión viene de la propia máquina (127.0.0.0/8, ::1 o su forma
 * IPv4 mapeada). cloudflared conecta desde ahí; solo entonces se creen las cabeceras que añade el proxy.
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  return ip === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

function fromProxy(req, trustProxy) {
  return Boolean(trustProxy) && isLoopbackAddress(req && req.socket ? req.socket.remoteAddress : undefined);
}

/** true si la cookie debe llevar Secure: secureCookies, o X-Forwarded-Proto: https llegado desde el proxy local. */
export function isHttpsRequest(req, { trustProxy = true, secureCookies = false } = {}) {
  if (secureCookies) return true;
  if (!fromProxy(req, trustProxy)) return false;
  return firstHeaderValue(req.headers['x-forwarded-proto']).toLowerCase() === 'https';
}

/**
 * IP del cliente: CF-Connecting-IP (o X-Forwarded-For) SOLO si trustProxy y la conexión viene de loopback; si no,
 * remoteAddress (una IP inventada desde la LAN ya no evita el límite de intentos); 'unknown' si no hay ninguna.
 */
export function getClientIp(req, { trustProxy = true } = {}) {
  if (fromProxy(req, trustProxy)) {
    const forwarded = firstHeaderValue(req.headers['cf-connecting-ip']) || firstHeaderValue(req.headers['x-forwarded-for']);
    if (forwarded) return forwarded;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** Resuelve una ruta URL dentro de publicDir; devuelve null si queda fuera o no es válida. */
export function resolveStaticPath(publicDir, urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const root = path.resolve(publicDir);
  const resolved = path.resolve(root, '.' + pathname.replace(/\\/g, '/'));
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/** Sirve un fichero de publicDir o responde 404 "No encontrado" (sin revelar rutas). */
export async function serveStatic(publicDir, urlPath, res) {
  const filePath = resolveStaticPath(publicDir, urlPath);
  if (!filePath) return sendText(res, 404, 'No encontrado');

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    return sendText(res, 404, 'No encontrado');
  }
  if (!stats.isFile()) return sendText(res, 404, 'No encontrado');

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = await fs.readFile(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length,
    'Cache-Control': 'no-cache',
  });
  res.end(content);
}
