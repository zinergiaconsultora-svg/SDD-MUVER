// Tests de la confirmación de contraseña por el túnel (lib/reauth.js, POST /api/auth/reauth, gateExec) —
// F4: R2 (integración), R67–R70, R74. Reloj inyectable (makeClock) y siempre el CLI falso.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeProjectDir, makeTempDir, writeRegistry, startApp, request, removeDir, makeClock, cookieHeaderFromSetCookie } from './helpers.js';
import { waitForRun, fileExists, tunnelHeaders, makeAccessKeys, startCertsServer, makeJwt } from './work-helpers.js';
import { REAUTH_TTL_MS, isTunnelRequest, isReauthFresh } from '../lib/reauth.js';

const PASSWORD = 'contraseña-de-la-fase-4';
const MIN = 60 * 1000;
const REAUTH_REQUIRED = { error: 'Confirma tu contraseña para continuar', reauthRequired: true };

const cleanup = [];
const apps = [];
const servers = [];
after(async () => {
  for (const app of apps) await app.close();
  for (const server of servers) await server.close();
  for (const dir of cleanup) await removeDir(dir);
});

async function setup({ withPassword = true, ...options } = {}) {
  const base = await makeTempDir('muver-f4-reauth-');
  const dir = await makeProjectDir();
  cleanup.push(base, dir);
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, [{ id: 'proy', name: 'Proy', path: dir }]);
  const clock = makeClock(Date.parse('2026-10-25T10:00:00.000Z'));
  const app = await startApp({ projectsFile: registryFile, ...(withPassword ? { password: PASSWORD } : {}), now: clock.now, ...options });
  apps.push(app);
  cleanup.push(app.dataDir);
  const call = (urlPath, init = {}) => request(app.baseUrl, urlPath, init);
  const runPost = (cookie, headers = {}) => call('/api/projects/proy/runs', { method: 'POST', cookie, headers, body: JSON.stringify({ prompt: 'hola' }) });
  return { app, clock, call, runPost, dir };
}

test('[F4-R67] reauth.js: TTL de 15 minutos, petición por el túnel y confirmación reciente', () => {
  assert.equal(REAUTH_TTL_MS, 15 * MIN);
  assert.equal(isTunnelRequest({ headers: { 'cf-connecting-ip': '203.0.113.7' } }), true);
  assert.equal(isTunnelRequest({ headers: { 'cf-ray': '8abc-MAD' } }), true);
  assert.equal(isTunnelRequest({ headers: { 'x-forwarded-proto': 'https' } }), true);
  assert.equal(isTunnelRequest({ headers: { 'x-forwarded-proto': 'HTTPS, http' } }), true);
  assert.equal(isTunnelRequest({ headers: { 'x-forwarded-proto': 'http' } }), false);
  assert.equal(isTunnelRequest({ headers: { 'cf-connecting-ip': '  ' } }), false);
  assert.equal(isTunnelRequest({ headers: {} }), false);
  assert.equal(isReauthFresh(1000, 1000 + 15 * MIN), true);
  assert.equal(isReauthFresh(1000, 1000 + 15 * MIN + 1), false);
  assert.equal(isReauthFresh(undefined, 1000), false);
  assert.equal(isReauthFresh('1000', 1000), false);
});

test('[F4-R67] por el túnel sin confirmación reciente (16 min) → 401 reauthRequired sin proceso; también con X-Forwarded-Proto y Cf-Ray', async () => {
  const ctx = await setup();
  const cookie = await ctx.app.login();
  ctx.clock.advance(16 * MIN);
  for (const headers of [tunnelHeaders(), { 'X-Forwarded-Proto': 'https' }, { 'Cf-Ray': '8abc-MAD' }]) {
    const r = await ctx.runPost(cookie, headers);
    assert.equal(r.status, 401, JSON.stringify(headers));
    assert.deepEqual(r.json, REAUTH_REQUIRED);
  }
  assert.equal(await fileExists(ctx.app.fakeLog), false, 'no se lanzó el CLI');
  const status = await ctx.call('/api/work/status', { cookie, headers: tunnelHeaders() });
  assert.equal(status.json.tunnel, true);
  assert.equal(status.json.reauthFresh, false);
  const session = await ctx.call('/api/auth/status', { cookie, headers: tunnelHeaders() });
  assert.equal(session.json.authenticated, true, 'la sesión no se cierra');
});

test('[F4-R68] POST /api/auth/reauth correcto → 204, reauthAt en sessions.json y la acción pasa a 202', async () => {
  const ctx = await setup();
  const cookie = await ctx.app.login();
  ctx.clock.advance(16 * MIN);
  assert.equal((await ctx.runPost(cookie, tunnelHeaders())).status, 401);
  const reauth = await ctx.call('/api/auth/reauth', { method: 'POST', cookie, headers: tunnelHeaders(), body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(reauth.status, 204, reauth.text);
  const sessions = JSON.parse(await fs.readFile(path.join(ctx.app.dataDir, 'sessions.json'), 'utf8'));
  const reauthAts = Object.values(sessions.sessions).map((s) => s.reauthAt);
  assert.ok(reauthAts.includes(ctx.clock.now()), 'reauthAt = ahora persistido');
  const r = await ctx.runPost(cookie, tunnelHeaders());
  assert.equal(r.status, 202, r.text);
  await waitForRun(ctx.app, cookie, r.json.runId);
  const noCsrf = await ctx.call('/api/auth/reauth', { method: 'POST', cookie, csrf: false, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(noCsrf.status, 403);
});

test('[F4-R68] reauth incorrecto → 401 "Contraseña incorrecta" (sin reauthRequired); al sexto intento 429; sin sesión 401', async () => {
  const ctx = await setup();
  const cookie = await ctx.app.login();
  for (let i = 0; i < 5; i++) {
    const r = await ctx.call('/api/auth/reauth', { method: 'POST', cookie, body: JSON.stringify({ password: 'otra-contraseña-mala' }) });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: 'Contraseña incorrecta' });
  }
  const blocked = await ctx.call('/api/auth/reauth', { method: 'POST', cookie, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  const anon = await ctx.call('/api/auth/reauth', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(anon.status, 401);
  assert.deepEqual(anon.json, { error: 'No autenticado' });
});

test('[F4-R69] login fija reauthAt: acción por el túnel inmediata → 202; a los 16 minutos → 401', async () => {
  const ctx = await setup();
  const cookie = await ctx.app.login();
  const now = await ctx.runPost(cookie, tunnelHeaders());
  assert.equal(now.status, 202, now.text);
  await waitForRun(ctx.app, cookie, now.json.runId);
  ctx.clock.advance(16 * MIN);
  const later = await ctx.runPost(cookie, tunnelHeaders());
  assert.equal(later.status, 401);
  assert.deepEqual(later.json, REAUTH_REQUIRED);
});

test('[F4-R69] setup (crear contraseña) también fija reauthAt', async () => {
  const ctx = await setup({ withPassword: false });
  const created = await ctx.call('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(created.status, 201);
  const cookie = cookieHeaderFromSetCookie(created.setCookie);
  const r = await ctx.runPost(cookie, tunnelHeaders());
  assert.equal(r.status, 202, r.text);
  await waitForRun(ctx.app, cookie, r.json.runId);
});

test('[F4-R70] desde la red local basta la sesión: 2 horas después del login → 202', async () => {
  const ctx = await setup();
  const cookie = await ctx.app.login();
  ctx.clock.advance(120 * MIN);
  const r = await ctx.runPost(cookie);
  assert.equal(r.status, 202, r.text);
  await waitForRun(ctx.app, cookie, r.json.runId);
  const status = await ctx.call('/api/work/status', { cookie });
  assert.equal(status.json.tunnel, false);
  assert.equal(status.json.reauthFresh, true);
});

test('[F4-R2] cfAccess con error: todo por el túnel → 403 "Access mal configurado"; la red local → 200', async () => {
  const ctx = await setup({ cfAccess: { error: 'PANEL_CF_ACCESS_TEAM no válido' } });
  for (const urlPath of ['/', '/api/auth/status', '/app.js']) {
    const r = await ctx.call(urlPath, { headers: tunnelHeaders() });
    assert.equal(r.status, 403, urlPath);
    assert.ok(r.text.includes('Cloudflare Access mal configurado en el panel'), r.text);
  }
  assert.equal((await ctx.call('/')).status, 200);
  assert.equal((await ctx.call('/api/auth/status')).status, 200);
  const cookie = await ctx.app.login();
  ctx.clock.advance(16 * MIN);
  const local = await ctx.runPost(cookie);
  assert.equal(local.status, 202, 'la red local sigue funcionando');
  await waitForRun(ctx.app, cookie, local.json.runId);
});

test('[F4-R74] con Access configurado y token válido no se pide confirmación (1 h después); sin cookie → 401', async () => {
  const keys = makeAccessKeys('kid-reauth');
  const certs = await startCertsServer([keys.jwk]);
  servers.push(certs);
  const ctx = await setup({ cfAccess: { team: 'muver', aud: 'aud-123' }, cfCertsUrl: certs.url });
  const nowSec = () => Math.floor(ctx.clock.now() / 1000);
  const token = () => makeJwt(keys.privateKey, { alg: 'RS256', kid: 'kid-reauth' }, { aud: ['aud-123'], iss: 'https://muver.cloudflareaccess.com', exp: nowSec() + 3600, iat: nowSec(), email: 'humano@example.com' });
  const headers = () => ({ ...tunnelHeaders(), 'Cf-Access-Jwt-Assertion': token() });
  const cookie = await ctx.app.login(PASSWORD, { headers: headers() });
  ctx.clock.advance(60 * MIN);
  const r = await ctx.runPost(cookie, headers());
  assert.equal(r.status, 202, r.text);
  await waitForRun(ctx.app, cookie, r.json.runId);
  const status = await ctx.call('/api/work/status', { cookie, headers: headers() });
  assert.equal(status.json.accessConfigured, true);
  assert.equal(status.json.reauthFresh, true);
  const anon = await ctx.runPost(undefined, headers());
  assert.equal(anon.status, 401);
  assert.deepEqual(anon.json, { error: 'No autenticado' });
});

// ---------- Corrección T36 (= M3 de la fase 2): el límite de intentos usa la IP real ----------

const os = await import('node:os');
const lanAddress = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

test('[F4-R68] corrección T36: desde una IP no loopback, cambiar CF-Connecting-IP en cada intento no evita el bloqueo (429 al sexto)', { skip: lanAddress ? false : 'sin interfaz de red no loopback' }, async () => {
  const ctx = await setup();
  const lanUrl = ctx.app.baseUrl.replace('127.0.0.1', lanAddress);
  for (let i = 0; i < 5; i++) {
    const r = await request(lanUrl, '/api/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': `203.0.113.${i + 1}` }, body: JSON.stringify({ password: 'mala-contraseña-1' }) });
    assert.equal(r.status, 401, `intento ${i + 1}`);
  }
  const blocked = await request(lanUrl, '/api/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.99' }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(blocked.status, 429);
  // Con cabeceras de Cloudflare desde la LAN la comprobación sigue siendo MÁS estricta: se trata como túnel.
  const local = await ctx.app.login();
  ctx.clock.advance(16 * MIN);
  const strict = await request(lanUrl, '/api/projects/proy/runs', { method: 'POST', cookie: local, headers: tunnelHeaders(), body: JSON.stringify({ prompt: 'hola' }) });
  assert.equal(strict.status, 401);
  assert.equal(strict.json.reauthRequired, true);
});

test('[F4-R68] corrección T36: desde loopback (cloudflared) se usa CF-Connecting-IP para el límite', async () => {
  const ctx = await setup();
  for (let i = 0; i < 5; i++) {
    await ctx.call('/api/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.50' }, body: JSON.stringify({ password: 'mala-contraseña-1' }) });
  }
  const sameIp = await ctx.call('/api/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.50' }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(sameIp.status, 429);
  const otherIp = await ctx.call('/api/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.51' }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(otherIp.status, 200, 'otro cliente real tras el túnel no queda bloqueado');
});
