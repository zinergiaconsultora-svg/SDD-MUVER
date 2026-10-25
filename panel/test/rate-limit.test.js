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
  assert.equal(getClientIp(fakeReq({ 'cf-connecting-ip': '  203.0.113.5 ' }), { trustProxy: true }), '203.0.113.5');
  assert.equal(getClientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.5, 10.0.0.1' }), { trustProxy: true }), '203.0.113.5');
  assert.equal(getClientIp(fakeReq({}), { trustProxy: true }), '192.168.1.20');
  assert.equal(getClientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.5' }), { trustProxy: false }), '192.168.1.20');
  assert.equal(getClientIp({ headers: {}, socket: {} }, { trustProxy: true }), 'unknown');
});

test('[F2-R14][F2-R15] isHttpsRequest según X-Forwarded-Proto, trustProxy y secureCookies', () => {
  assert.equal(isHttpsRequest(fakeReq({}), { trustProxy: true, secureCookies: false }), false);
  assert.equal(isHttpsRequest(fakeReq({ 'x-forwarded-proto': 'https' }), { trustProxy: true, secureCookies: false }), true);
  assert.equal(isHttpsRequest(fakeReq({ 'x-forwarded-proto': 'HTTPS, http' }), { trustProxy: true, secureCookies: false }), true);
  assert.equal(isHttpsRequest(fakeReq({ 'x-forwarded-proto': 'http' }), { trustProxy: true, secureCookies: false }), false);
  assert.equal(isHttpsRequest(fakeReq({ 'x-forwarded-proto': 'https' }), { trustProxy: false, secureCookies: false }), false);
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
