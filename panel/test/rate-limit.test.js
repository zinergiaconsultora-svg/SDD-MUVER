// Tests unitarios de lib/rate-limit.js y de los añadidos de lib/http-utils.js — F2-R14, F2-R15, F2-R20, F2-R23, F2-R24, F2-R25
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter, MAX_FAILURES, WINDOW_MS, BLOCK_MS } from '../lib/rate-limit.js';
import { parseCookies, buildSetCookie, COOKIE_NAME, isHttpsRequest, getClientIp } from '../lib/http-utils.js';
import { makeClock } from './helpers.js';

const MINUTE = 60 * 1000;

test('[F2-R23] createRateLimiter: 4 fallos no bloquean; el quinto bloquea con retryAfterMs <= 15 min', () => {
  assert.equal(MAX_FAILURES, 5);
  assert.equal(WINDOW_MS, 15 * MINUTE);
  assert.equal(BLOCK_MS, 15 * MINUTE);
  const clock = makeClock(1_000_000);
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < 4; i++) {
    limiter.recordFailure('1.1.1.1');
    assert.deepEqual(limiter.check('1.1.1.1'), { blocked: false }, `fallo ${i + 1}`);
  }
  limiter.recordFailure('1.1.1.1');
  const result = limiter.check('1.1.1.1');
  assert.equal(result.blocked, true);
  assert.ok(result.retryAfterMs > 0 && result.retryAfterMs <= 15 * MINUTE);
  clock.advance(5 * MINUTE);
  assert.equal(limiter.check('1.1.1.1').retryAfterMs, 10 * MINUTE);
  assert.deepEqual(limiter.check('2.2.2.2'), { blocked: false }, 'otra clave no se ve afectada');
});

test('[F2-R24] a los 15 min + 1 s se desbloquea y el contador vuelve a cero', () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
  assert.equal(limiter.check('ip').blocked, true);
  clock.advance(15 * MINUTE + 1000);
  assert.deepEqual(limiter.check('ip'), { blocked: false });
  for (let i = 0; i < 4; i++) limiter.recordFailure('ip');
  assert.deepEqual(limiter.check('ip'), { blocked: false }, 'el contador empezó de cero tras el bloqueo');
});

test('[F2-R24] 4 fallos + reset + 4 fallos → nunca bloqueado', () => {
  const limiter = createRateLimiter({ now: () => 0 });
  for (let i = 0; i < 4; i++) limiter.recordFailure('ip');
  limiter.reset('ip');
  for (let i = 0; i < 4; i++) limiter.recordFailure('ip');
  assert.deepEqual(limiter.check('ip'), { blocked: false });
});

test('[F2-R23] fallos separados más de 15 minutos no se acumulan', () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({ now: clock.now });
  for (let i = 0; i < 4; i++) limiter.recordFailure('ip');
  clock.advance(15 * MINUTE + 1);
  for (let i = 0; i < 4; i++) limiter.recordFailure('ip');
  assert.deepEqual(limiter.check('ip'), { blocked: false });
  limiter.recordFailure('ip');
  assert.equal(limiter.check('ip').blocked, true);
});

function fakeReq(headers = {}, remoteAddress = '192.168.1.20') {
  return { headers, socket: { remoteAddress } };
}

test('[F2-R25] getClientIp usa CF-Connecting-IP solo con trustProxy; si no, remoteAddress', () => {
  // Desviación (corrección T36 / M3 de la fase 2): las cabeceras del proxy solo cuentan si la conexión viene de
  // loopback (cloudflared); estos casos de la fase 2 se adaptan para llegar desde 127.0.0.1.
  const viaTunnel = (headers) => fakeReq(headers, '127.0.0.1');
  assert.equal(getClientIp(viaTunnel({ 'cf-connecting-ip': '  203.0.113.5 ' }), { trustProxy: true }), '203.0.113.5');
  assert.equal(getClientIp(viaTunnel({ 'cf-connecting-ip': '203.0.113.5, 10.0.0.1' }), { trustProxy: true }), '203.0.113.5');
  assert.equal(getClientIp(fakeReq({}), { trustProxy: true }), '192.168.1.20');
  assert.equal(getClientIp(viaTunnel({ 'cf-connecting-ip': '203.0.113.5' }), { trustProxy: false }), '127.0.0.1');
  assert.equal(getClientIp({ headers: {}, socket: {} }, { trustProxy: true }), 'unknown');
});

test('[F2-R14][F2-R15] isHttpsRequest según X-Forwarded-Proto, trustProxy y secureCookies', () => {
  // Desviación (corrección T36): X-Forwarded-Proto solo cuenta desde loopback.
  const viaTunnel = (headers) => fakeReq(headers, '127.0.0.1');
  assert.equal(isHttpsRequest(viaTunnel({}), { trustProxy: true, secureCookies: false }), false);
  assert.equal(isHttpsRequest(viaTunnel({ 'x-forwarded-proto': 'https' }), { trustProxy: true, secureCookies: false }), true);
  assert.equal(isHttpsRequest(viaTunnel({ 'x-forwarded-proto': 'HTTPS, http' }), { trustProxy: true, secureCookies: false }), true);
  assert.equal(isHttpsRequest(viaTunnel({ 'x-forwarded-proto': 'http' }), { trustProxy: true, secureCookies: false }), false);
  assert.equal(isHttpsRequest(viaTunnel({ 'x-forwarded-proto': 'https' }), { trustProxy: false, secureCookies: false }), false);
  assert.equal(isHttpsRequest(fakeReq({}), { trustProxy: false, secureCookies: true }), true);
});

test('[F2-R8][F2-R20] parseCookies y buildSetCookie (con y sin Secure, borrado con Max-Age=0)', () => {
  assert.equal(COOKIE_NAME, 'muver_session');
  assert.deepEqual(parseCookies(fakeReq({ cookie: 'a=1; muver_session=abc.def; raro=%E2%9C%93; mal=%E0%A4%A' })), {
    a: '1',
    muver_session: 'abc.def',
    raro: '✓',
    mal: '%E0%A4%A',
  });
  assert.deepEqual(parseCookies(fakeReq({})), {});

  const plain = buildSetCookie('abc.def', { maxAge: 2592000, secure: false });
  assert.equal(plain, 'muver_session=abc.def; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000');
  const secure = buildSetCookie('abc.def', { maxAge: 2592000, secure: true });
  assert.equal(secure, 'muver_session=abc.def; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure');
  const cleared = buildSetCookie('', { maxAge: 0, secure: false });
  assert.ok(cleared.startsWith('muver_session=; '));
  assert.ok(cleared.includes('Max-Age=0'));
  assert.ok(cleared.includes('Path=/'));
  assert.ok(cleared.includes('HttpOnly'));
  assert.ok(cleared.includes('SameSite=Lax'));
});

// ---------- Corrección T36 (= M3 de la fase 2): IP real para el límite de intentos y mapa acotado ----------

test('[F4-R68] corrección T36: las cabeceras del proxy solo cuentan desde loopback (cloudflared); desde la LAN, remoteAddress', async () => {
  const { isLoopbackAddress } = await import('../lib/http-utils.js');
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(ip), true, ip);
  for (const ip of ['192.168.1.20', '10.0.0.1', '::ffff:192.168.1.20', '', undefined, '127.0.0.1.evil']) assert.equal(isLoopbackAddress(ip), false, String(ip));
  const lan = fakeReq({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1', 'x-forwarded-proto': 'https' }, '192.168.1.20');
  assert.equal(getClientIp(lan, { trustProxy: true }), '192.168.1.20', 'IP inventada desde la LAN ignorada');
  assert.equal(isHttpsRequest(lan, { trustProxy: true }), false);
  assert.equal(getClientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.9' }, '::1'), { trustProxy: true }), '203.0.113.9');
  assert.equal(getClientIp(fakeReq({ 'x-forwarded-for': '198.51.100.1, 10.0.0.2' }, '::ffff:127.0.0.1'), { trustProxy: true }), '198.51.100.1', 'X-Forwarded-For desde loopback');
});

test('[F4-R68] corrección T36: el mapa del limitador está acotado (tope y limpieza de caducadas)', () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({ now: clock.now, maxEntries: 100 });
  for (let i = 0; i < 250; i++) limiter.recordFailure(`10.0.${Math.floor(i / 250)}.${i}`);
  assert.ok(limiter.size() <= 100, `tamaño ${limiter.size()}`);
  // Las más antiguas se descartan primero; un bloqueo reciente sobrevive.
  for (let i = 0; i < 5; i++) limiter.recordFailure('atacante');
  for (let i = 0; i < 99; i++) limiter.recordFailure(`relleno-${i}`);
  assert.equal(limiter.check('atacante').blocked, true, 'el bloqueo activo no se descarta por el tope');
  clock.advance(WINDOW_MS + BLOCK_MS + 1000);
  limiter.recordFailure('nuevo');
  assert.ok(limiter.size() <= 2, `caducadas eliminadas: ${limiter.size()}`);
  assert.equal(createRateLimiter().size(), 0);
});
