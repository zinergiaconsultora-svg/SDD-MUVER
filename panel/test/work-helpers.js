// Utilidades de los tests de la fase 4 (design.md §8.2): espera de runs, lectura de SSE, claves y tokens de
// Cloudflare Access generados en el propio test, servidor local de claves públicas y lectura del log del CLI falso.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';

import { request } from './helpers.js';

export const FINAL_STATES = Object.freeze(['succeeded', 'failed', 'cancelled', 'timeout', 'needs_permission']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sondea GET /api/runs/:runId hasta que el estado esté en `states` (por defecto, cualquier estado final). */
export async function waitForRun(app, cookie, runId, { states = FINAL_STATES, timeoutMs = 10000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await request(app.baseUrl, `/api/runs/${runId}`, { cookie });
    last = r;
    if (r.status === 200 && states.includes(r.json.run.state)) return r.json;
    await sleep(intervalMs);
  }
  throw new Error(`El run ${runId} no llegó a ${states.join('/')} (último: ${last && last.text})`);
}

/** Parsea un bloque SSE (líneas separadas por \n) en { id, data, comment, retry }. */
function parseBlock(block) {
  const message = { id: null, data: null, comments: [], retry: null };
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) message.comments.push(line.slice(1).trim());
    else if (line.startsWith('id:')) message.id = line.slice(3).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    else if (line.startsWith('retry:')) message.retry = Number(line.slice(6).trim());
  }
  if (dataLines.length) {
    try {
      message.data = JSON.parse(dataLines.join('\n'));
    } catch {
      message.data = dataLines.join('\n');
    }
  }
  return message;
}

/**
 * Lee un flujo SSE con fetch. Devuelve { status, headers, messages, ended } donde `ended` indica que el servidor
 * cerró el flujo. Para cuando `until(messages)` es true (y aborta la conexión) o tras `timeoutMs`.
 */
export async function readSse(url, { cookie, headers = {}, until = () => false, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const allHeaders = { Accept: 'text/event-stream', ...headers };
  if (cookie) allHeaders.Cookie = cookie;
  const messages = [];
  let ended = false;
  let res;
  try {
    res = await fetch(url, { headers: allHeaders, signal: controller.signal });
    if (!String(res.headers.get('content-type') || '').startsWith('text/event-stream')) {
      const text = await res.text();
      clearTimeout(timer);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, headers: res.headers, messages, ended: true, json };
    }
    const decoder = new TextDecoder();
    let buffer = '';
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        messages.push(parseBlock(block));
      }
      if (until(messages)) {
        controller.abort();
        break;
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
  }
  return { status: res ? res.status : 0, headers: res ? res.headers : null, messages, ended };
}

/** Par RSA de 2048 bits y su JWK pública con `kid` (para simular las claves de Cloudflare Access). */
export function makeAccessKeys(kid = 'kid-test-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  return { privateKey, publicKey, jwk, kid };
}

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** Firma un JWT RS256 con la clave privada (la cabecera se usa tal cual, aunque diga otro alg). */
export function makeJwt(privateKey, header, payload) {
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

/** Servidor HTTP local que sirve { keys } y cuenta las peticiones. */
export async function startCertsServer(jwks) {
  let keys = jwks;
  let count = 0;
  const server = http.createServer((req, res) => {
    count += 1;
    const body = JSON.stringify({ keys });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/cdn-cgi/access/certs`;
  return {
    url,
    count: () => count,
    setKeys(next) {
      keys = next;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Cabeceras de una petición que llega por el túnel de Cloudflare. */
export function tunnelHeaders() {
  return { 'CF-Connecting-IP': '203.0.113.7' };
}

/** Lee el log del CLI falso: array de objetos ([] si no existe). */
export async function readFakeLog(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** true si el fichero existe. */
export async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Espera a que `predicate()` (síncrono o asíncrono) sea verdadero. */
export async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 25, message = 'condición' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Tiempo agotado esperando: ${message}`);
}

/** true si el proceso `pid` sigue vivo (process.kill(pid, 0) no lanza ESRCH). */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}
