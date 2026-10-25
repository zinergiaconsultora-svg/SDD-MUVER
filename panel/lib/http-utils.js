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

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
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

/**
 * Lee el cuerpo de la petición como JSON. Rechaza con { status: 400, error: 'Cuerpo JSON inválido' }
 * si supera `limit` bytes o no parsea.
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
        const text = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
        resolve(text.trim() === '' ? {} : JSON.parse(text));
      } catch {
        reject(invalid());
      }
    });
    req.on('error', fail);
  });
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
