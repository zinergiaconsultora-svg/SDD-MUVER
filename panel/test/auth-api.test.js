// Tests de integración de la autenticación (lib/app.js) — F2-R1–R6, F2-R8–R11, F2-R14–R29, F2-R33
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir, writeRegistry, startApp, request, removeDir, makeClock, parseSetCookie, cookieHeaderFromSetCookie } from './helpers.js';
import { signId } from '../lib/sessions.js';

const PASSWORD = 'contraseña-segura-123';
const OTHER_PASSWORD = 'otra-contraseña-456';
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-10-25T10:00:00Z');
const TOKEN_RE = /^[0-9a-f]{64}\.[0-9a-f]{64}$/;
const NO_AUTH = { error: 'No autenticado' };

const apps = [];
const dirs = [];
let base;
let registryFile;
let projectDir;

async function boot(options = {}) {
  const app = await startApp({ projectsFile: registryFile, ...options });
  apps.push(app);
  dirs.push(app.dataDir);
  return app;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function sessionIds(dataDir) {
  const saved = await readJson(path.join(dataDir, 'sessions.json'));
  return saved && saved.sessions ? Object.keys(saved.sessions) : [];
}

function login(baseUrl, password, init = {}) {
  return request(baseUrl, '/api/auth/login', { method: 'POST', body: JSON.stringify({ password }), ...init });
}

async function freshRegistry() {
  const file = path.join(await makeTempDir('muver-reg-'), 'projects.json');
  await writeRegistry(file, [{ id: 'uno', name: 'Uno', path: projectDir, appUrl: '', repoUrl: '', tags: [] }]);
  return file;
}

base = await makeTempDir('muver-auth-api-');
projectDir = await makeTempDir('muver-proj-');
registryFile = path.join(base, 'projects.json');
await writeRegistry(registryFile, [{ id: 'uno', name: 'Uno', path: projectDir, appUrl: '', repoUrl: '', tags: [] }]);

after(async () => {
  for (const app of apps) await app.close();
  for (const dir of dirs) await removeDir(dir);
  await removeDir(base);
  await removeDir(projectDir);
});

// ---------- Bloque A: primer arranque y setup ----------

test('[F2-R1] GET /api/auth/status sin auth.json → 200 { configured: false, authenticated: false, publicUrl: null }', async () => {
  const app = await boot();
  const r = await request(app.baseUrl, '/api/auth/status');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { configured: false, authenticated: false, publicUrl: null });
});

test('[F2-R2] POST /api/auth/setup crea auth.json (§3.1), responde 201 con cookie y el status posterior es authenticated', async () => {
  const app = await boot();
  const r = await request(app.baseUrl, '/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json, { authenticated: true });
  assert.ok(r.setCookie, 'Set-Cookie presente');
  const cookie = parseSetCookie(r.setCookie);
  assert.equal(cookie.name, 'muver_session');
  assert.match(cookie.value, TOKEN_RE);

  const record = await readJson(path.join(app.dataDir, 'auth.json'));
  assert.equal(record.algorithm, 'scrypt');
  assert.match(record.salt, /^[0-9a-f]{32}$/);
  assert.match(record.hash, /^[0-9a-f]{128}$/);
  assert.deepEqual(record.params, { N: 16384, r: 8, p: 1, keylen: 64 });
  assert.match(record.sessionSecret, /^[0-9a-f]{64}$/);
  assert.notEqual(record.sessionSecret, record.salt);
  assert.ok(!Number.isNaN(Date.parse(record.createdAt)));
  assert.ok(!Number.isNaN(Date.parse(record.updatedAt)));
  assert.equal((await sessionIds(app.dataDir)).length, 1, 'se creó una sesión');

  const status = await request(app.baseUrl, '/api/auth/status', { cookie: cookieHeaderFromSetCookie(r.setCookie) });
  assert.equal(status.json.configured, true);
  assert.equal(status.json.authenticated, true);
});

test('[F2-R3] setup con password ausente, no cadena, 9 o 129 caracteres → 400 y sin auth.json', async () => {
  const app = await boot();
  for (const body of [{}, { password: 1234567890 }, { password: 'a'.repeat(9) }, { password: 'a'.repeat(129) }]) {
    const r = await request(app.baseUrl, '/api/auth/setup', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.json, { error: 'La contraseña debe tener entre 10 y 128 caracteres', field: 'password' });
    assert.equal(r.setCookie, null);
  }
  assert.equal(await readJson(path.join(app.dataDir, 'auth.json')), null);
});

test('[F2-R4] setup repetido → 409 y auth.json byte a byte igual', async () => {
  const app = await boot({ password: PASSWORD });
  const file = path.join(app.dataDir, 'auth.json');
  const before = await fs.readFile(file, 'utf8');
  const r = await request(app.baseUrl, '/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: OTHER_PASSWORD }) });
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { error: 'La contraseña ya está configurada' });
  assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('[F2-R5] auth.json roto → 500 en status/login/setup, fichero intacto y GET / sigue en 200', async () => {
  const dataDir = await makeTempDir('muver-data-');
  await fs.writeFile(path.join(dataDir, 'auth.json'), '{ roto', 'utf8');
  const app = await boot({ dataDir });
  const expected = { error: 'Fichero de autenticación ilegible; ejecuta npm run reset-password' };
  const status = await request(app.baseUrl, '/api/auth/status');
  assert.equal(status.status, 500);
  assert.deepEqual(status.json, expected);
  const loginR = await login(app.baseUrl, PASSWORD);
  assert.equal(loginR.status, 500);
  assert.deepEqual(loginR.json, expected);
  const setup = await request(app.baseUrl, '/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(setup.status, 500);
  assert.deepEqual(setup.json, expected);
  assert.equal(await fs.readFile(path.join(dataDir, 'auth.json'), 'utf8'), '{ roto');
  const index = await request(app.baseUrl, '/');
  assert.equal(index.status, 200);
});

test('[F2-R6] dataDir inexistente: el setup crea la carpeta y auth.json sin .tmp residual', async () => {
  const parent = await makeTempDir('muver-data-');
  const dataDir = path.join(parent, 'nuevo', 'datos');
  const app = await boot({ dataDir });
  dirs.push(parent);
  const r = await request(app.baseUrl, '/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(r.status, 201);
  const entries = await fs.readdir(dataDir);
  assert.ok(entries.includes('auth.json'));
  assert.ok(!entries.some((e) => e.endsWith('.tmp')), `sin .tmp: ${entries}`);
  assert.doesNotThrow(async () => JSON.parse(await fs.readFile(path.join(dataDir, 'auth.json'), 'utf8')));
  JSON.parse(await fs.readFile(path.join(dataDir, 'sessions.json'), 'utf8'));
});

// ---------- Bloque B: login, cookie, status, estáticos ----------

test('[F2-R8] login correcto → 200, cookie con HttpOnly/SameSite=Lax/Path=//Max-Age=2592000 y sesión con expiresAt = now + 30 d', async () => {
  const clock = makeClock(T0);
  const app = await boot({ password: PASSWORD, now: clock.now });
  const r = await login(app.baseUrl, PASSWORD);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { authenticated: true });
  const cookie = parseSetCookie(r.setCookie);
  assert.equal(cookie.name, 'muver_session');
  assert.match(cookie.value, TOKEN_RE);
  for (const attr of ['httponly', 'samesite=lax', 'path=/', 'max-age=2592000']) {
    assert.ok(cookie.attributes.has(attr), `falta ${attr} en ${r.setCookie}`);
  }
  assert.ok(!cookie.attributes.has('secure'), 'sin Secure en HTTP plano');
  const id = cookie.value.split('.')[0];
  const saved = await readJson(path.join(app.dataDir, 'sessions.json'));
  assert.deepEqual(saved.sessions[id], { createdAt: T0, lastSeenAt: T0, expiresAt: T0 + 30 * DAY });
});

test('[F2-R9] contraseña incorrecta → 401 "Contraseña incorrecta", sin Set-Cookie ni sesión nueva', async () => {
  const app = await boot({ password: PASSWORD });
  const before = (await sessionIds(app.dataDir)).length;
  const r = await login(app.baseUrl, OTHER_PASSWORD);
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, { error: 'Contraseña incorrecta' });
  assert.equal(r.setCookie, null);
  assert.equal((await sessionIds(app.dataDir)).length, before);
});

test('[F2-R10] login sin password o con password no cadena → 400 siempre (nunca 429) y no cuenta como fallo', async () => {
  const app = await boot({ password: PASSWORD });
  for (let i = 0; i < 6; i++) {
    for (const body of [{}, { password: 5 }]) {
      const r = await request(app.baseUrl, '/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
      assert.equal(r.status, 400, `intento ${i} con ${JSON.stringify(body)}`);
      assert.deepEqual(r.json, { error: 'Falta la contraseña', field: 'password' });
    }
  }
  const ok = await login(app.baseUrl, PASSWORD);
  assert.equal(ok.status, 200);
});

test('[F2-R11] login sin auth.json → 409 "Contraseña no configurada"', async () => {
  const app = await boot();
  const r = await login(app.baseUrl, PASSWORD);
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { error: 'Contraseña no configurada' });
});

test('[F2-R14] atributo Secure solo con X-Forwarded-Proto: https (proxy de confianza) o secureCookies: true', async () => {
  const app = await boot({ password: PASSWORD });
  const plain = await login(app.baseUrl, PASSWORD);
  assert.ok(!parseSetCookie(plain.setCookie).attributes.has('secure'));
  const viaProxy = await login(app.baseUrl, PASSWORD, { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(viaProxy.status, 200);
  assert.ok(parseSetCookie(viaProxy.setCookie).attributes.has('secure'));

  const secureApp = await boot({ password: PASSWORD, secureCookies: true });
  const forced = await login(secureApp.baseUrl, PASSWORD);
  assert.ok(parseSetCookie(forced.setCookie).attributes.has('secure'));
});

test('[F2-R15] trustProxy: false ignora X-Forwarded-Proto y CF-Connecting-IP', async () => {
  const app = await boot({ password: PASSWORD, trustProxy: false, now: () => T0 });
  const r = await login(app.baseUrl, PASSWORD, { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(r.status, 200);
  assert.ok(!parseSetCookie(r.setCookie).attributes.has('secure'));
  for (let i = 1; i <= 5; i++) {
    const fail = await login(app.baseUrl, OTHER_PASSWORD, { headers: { 'CF-Connecting-IP': `10.0.0.${i}` } });
    assert.equal(fail.status, 401, `fallo ${i}`);
  }
  const sixth = await login(app.baseUrl, PASSWORD, { headers: { 'CF-Connecting-IP': '10.0.0.99' } });
  assert.equal(sixth.status, 429, 'todas las IP falsas cuentan en el mismo contador (remoteAddress)');
});

test('[F2-R22] status con cookie válida / sin cookie / alterada → authenticated true/false/false, configured true, sin renovar', async () => {
  const app = await boot({ password: PASSWORD });
  const cookie = await app.login();
  const file = path.join(app.dataDir, 'sessions.json');
  const before = await fs.readFile(file, 'utf8');
  const valid = await request(app.baseUrl, '/api/auth/status', { cookie });
  assert.equal(valid.status, 200);
  assert.equal(valid.json.configured, true);
  assert.equal(valid.json.authenticated, true);
  const none = await request(app.baseUrl, '/api/auth/status');
  assert.deepEqual(none.json, { configured: true, authenticated: false, publicUrl: null });
  const altered = await request(app.baseUrl, '/api/auth/status', { cookie: cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0') });
  assert.deepEqual(altered.json, { configured: true, authenticated: false, publicUrl: null });
  assert.equal(await fs.readFile(file, 'utf8'), before, 'status no renueva ni reescribe sessions.json');
});

test('[F2-R33] los ocho estáticos son públicos sin sesión y el servidor escucha en 0.0.0.0', async () => {
  const app = await boot({ password: PASSWORD });
  for (const urlPath of ['/', '/styles.css', '/app.js', '/render.js', '/app-config.js', '/api-client.js', '/manifest.webmanifest', '/icon.svg']) {
    const r = await request(app.baseUrl, urlPath);
    assert.equal(r.status, 200, urlPath);
    assert.ok(r.text.length > 0, urlPath);
  }
  assert.equal(app.server.address().address, '0.0.0.0');
});

test('[F2-R10][F2-R3][F2-R29] cuerpos JSON que no son un objeto (null, "", 0, []) → 400 "Cuerpo JSON inválido" en login, setup, change-password y POST /api/projects, y el servidor sigue vivo', async () => {
  const file = await freshRegistry();
  const app = await boot({ projectsFile: file, password: PASSWORD });
  const cookie = await app.login();
  const fresh = await boot({ projectsFile: file });
  const expected = { error: 'Cuerpo JSON inválido' };
  const before = await fs.readFile(file, 'utf8');
  for (const body of ['null', '""', '0', '[]', 'false', '"texto"']) {
    const targets = [
      [app, '/api/auth/login', {}],
      [fresh, '/api/auth/setup', {}],
      [app, '/api/auth/change-password', { cookie }],
      [app, '/api/projects', { cookie }],
    ];
    for (const [target, urlPath, extra] of targets) {
      const r = await request(target.baseUrl, urlPath, { method: 'POST', body, ...extra });
      assert.equal(r.status, 400, `${urlPath} con cuerpo ${body}`);
      assert.deepEqual(r.json, expected, `${urlPath} con cuerpo ${body}`);
      assert.equal(r.setCookie, null);
    }
  }
  assert.equal(await fs.readFile(file, 'utf8'), before, 'projects.json intacto');
  assert.equal(await readJson(path.join(fresh.dataDir, 'auth.json')), null, 'setup no creó auth.json');
  assert.equal((await request(app.baseUrl, '/api/projects', { cookie })).status, 200, 'servidor vivo');
  assert.equal((await login(app.baseUrl, PASSWORD)).status, 200, 'los 400 no cuentan como fallos');
});

// ---------- Bloque C: middleware de sesión ----------

test('[F2-R17] sin cookie / firma incorrecta / id no listado / caducada → 401 "No autenticado" sin tocar projects.json', async () => {
  const clock = makeClock(T0);
  const file = await freshRegistry();
  const app = await boot({ projectsFile: file, password: PASSWORD, now: clock.now });
  const valid = await app.login();
  const token = valid.split('=')[1];
  const record = await readJson(path.join(app.dataDir, 'auth.json'));
  const ghostId = 'e'.repeat(64);
  const forged = `muver_session=${ghostId}.${signId(ghostId, record.sessionSecret)}`;
  const badSignature = valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0');

  const expiredApp = await boot({ projectsFile: file, password: PASSWORD, now: clock.now });
  const expiredCookie = await expiredApp.login();

  const before = await fs.readFile(file, 'utf8');
  const newDir = await makeTempDir('muver-nuevo-');
  dirs.push(newDir);
  const body = JSON.stringify({ name: 'Intruso', path: newDir });

  const cases = [
    [app, undefined, 'sin cookie'],
    [app, badSignature, 'firma incorrecta'],
    [app, forged, 'id no listado'],
  ];
  for (const [target, cookie, label] of cases) {
    const get = await request(target.baseUrl, '/api/projects', { cookie });
    assert.equal(get.status, 401, `GET ${label}`);
    assert.deepEqual(get.json, NO_AUTH);
    const post = await request(target.baseUrl, '/api/projects', { method: 'POST', body, cookie });
    assert.equal(post.status, 401, `POST ${label}`);
    assert.deepEqual(post.json, NO_AUTH);
  }
  clock.set(T0 + 31 * DAY);
  const expiredGet = await request(expiredApp.baseUrl, '/api/projects', { cookie: expiredCookie });
  assert.equal(expiredGet.status, 401, 'GET caducada');
  assert.deepEqual(expiredGet.json, NO_AUTH);
  const expiredPost = await request(expiredApp.baseUrl, '/api/projects', { method: 'POST', body, cookie: expiredCookie });
  assert.equal(expiredPost.status, 401, 'POST caducada');
  assert.equal(await fs.readFile(file, 'utf8'), before, 'projects.json intacto');
  assert.match(token, TOKEN_RE);
});

test('[F2-R16] petición autenticada ejecuta la ruta como en la fase 1 (GET 200, POST 201)', async () => {
  const file = await freshRegistry();
  const app = await boot({ projectsFile: file, password: PASSWORD });
  const cookie = await app.login();
  const list = await request(app.baseUrl, '/api/projects', { cookie });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.map((p) => p.id), ['uno']);
  const newDir = await makeTempDir('muver-nuevo-');
  dirs.push(newDir);
  const created = await request(app.baseUrl, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Dos', path: newDir }), cookie });
  assert.equal(created.status, 201);
  assert.equal(created.json.id, 'dos');
});

test('[F2-R18] renovación deslizante: a los 10 s no hay Set-Cookie ni cambio; a los 20 días se renueva (expiresAt = t0 + 50 d)', async () => {
  const clock = makeClock(T0);
  const app = await boot({ password: PASSWORD, now: clock.now });
  const cookie = await app.login();
  const id = cookie.split('=')[1].split('.')[0];
  const file = path.join(app.dataDir, 'sessions.json');

  clock.set(T0 + 10 * 1000);
  const soon = await request(app.baseUrl, '/api/projects', { cookie });
  assert.equal(soon.status, 200);
  assert.equal(soon.setCookie, null);
  assert.equal((await readJson(file)).sessions[id].expiresAt, T0 + 30 * DAY);

  clock.set(T0 + 20 * DAY);
  const later = await request(app.baseUrl, '/api/projects', { cookie });
  assert.equal(later.status, 200);
  assert.ok(later.setCookie, 'Set-Cookie al renovar');
  const renewed = parseSetCookie(later.setCookie);
  assert.equal(`${renewed.name}=${renewed.value}`, cookie, 'misma cookie');
  assert.ok(renewed.attributes.has('max-age=2592000'));
  const saved = (await readJson(file)).sessions[id];
  assert.equal(saved.lastSeenAt, T0 + 20 * DAY);
  assert.equal(saved.expiresAt, T0 + 50 * DAY);
});

test('[F2-R19] sesión caducada (t0 + 31 d) → 401 y la entrada desaparece de sessions.json', async () => {
  const clock = makeClock(T0);
  const app = await boot({ password: PASSWORD, now: clock.now });
  const cookie = await app.login();
  const id = cookie.split('=')[1].split('.')[0];
  assert.ok((await sessionIds(app.dataDir)).includes(id));
  clock.set(T0 + 31 * DAY);
  const r = await request(app.baseUrl, '/api/projects', { cookie });
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, NO_AUTH);
  assert.ok(!(await sessionIds(app.dataDir)).includes(id));
});

test('[F2-R20] logout → 204 con cookie de borrado, sesión eliminada, cookie antigua → 401; logout sin cookie → 204', async () => {
  const app = await boot({ password: PASSWORD });
  const cookie = await app.login();
  const id = cookie.split('=')[1].split('.')[0];
  const r = await request(app.baseUrl, '/api/auth/logout', { method: 'POST', cookie });
  assert.equal(r.status, 204);
  assert.equal(r.text, '');
  const cleared = parseSetCookie(r.setCookie);
  assert.equal(cleared.name, 'muver_session');
  assert.equal(cleared.value, '');
  for (const attr of ['max-age=0', 'path=/', 'httponly', 'samesite=lax']) assert.ok(cleared.attributes.has(attr), attr);
  assert.ok(!(await sessionIds(app.dataDir)).includes(id));
  const again = await request(app.baseUrl, '/api/projects', { cookie });
  assert.equal(again.status, 401);
  const noCookie = await request(app.baseUrl, '/api/auth/logout', { method: 'POST' });
  assert.equal(noCookie.status, 204);
});

test('[F2-R21] reinicio con el mismo dataDir conserva la sesión', async () => {
  const first = await startApp({ projectsFile: registryFile, password: PASSWORD });
  dirs.push(first.dataDir);
  const cookie = await first.login();
  await first.close();
  const second = await boot({ dataDir: first.dataDir });
  const r = await request(second.baseUrl, '/api/projects', { cookie });
  assert.equal(r.status, 200);
});

test('[F2-R21] sessions.json roto → arranca con cero sesiones (401 en /api/projects, 200 en status) y avisa por console.error', async () => {
  const first = await startApp({ projectsFile: registryFile, password: PASSWORD });
  dirs.push(first.dataDir);
  const cookie = await first.login();
  await first.close();
  await fs.writeFile(path.join(first.dataDir, 'sessions.json'), '{ roto', 'utf8');
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const second = await boot({ dataDir: first.dataDir });
    const r = await request(second.baseUrl, '/api/projects', { cookie });
    assert.equal(r.status, 401);
    const status = await request(second.baseUrl, '/api/auth/status');
    assert.equal(status.status, 200);
    assert.deepEqual(status.json, { configured: true, authenticated: false, publicUrl: null });
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((e) => e.includes('sessions.json ilegible')), errors.join('\n'));
});

// ---------- Bloque D: límite de intentos y CSRF ----------

test('[F2-R23] 5 fallos → el login correcto responde 429 con cuerpo, Retry-After y sin sesión', async () => {
  const app = await boot({ password: PASSWORD, now: () => T0 });
  for (let i = 1; i <= 5; i++) {
    const r = await login(app.baseUrl, OTHER_PASSWORD);
    assert.equal(r.status, 401, `fallo ${i}`);
  }
  const before = (await sessionIds(app.dataDir)).length;
  const blocked = await login(app.baseUrl, PASSWORD);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, 'Demasiados intentos. Espera 15 minutos.');
  assert.ok(Number.isInteger(blocked.json.retryAfterSeconds));
  assert.ok(blocked.json.retryAfterSeconds >= 1 && blocked.json.retryAfterSeconds <= 900);
  const retryAfter = Number(blocked.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 900, `Retry-After ${retryAfter}`);
  assert.equal(retryAfter, blocked.json.retryAfterSeconds);
  assert.equal(blocked.setCookie, null);
  assert.equal((await sessionIds(app.dataDir)).length, before);
});

test('[F2-R24] a los 15 min + 1 s del bloqueo el login correcto responde 200; 4 fallos + éxito + 4 fallos nunca dan 429', async () => {
  const clock = makeClock(T0);
  const app = await boot({ password: PASSWORD, now: clock.now });
  for (let i = 0; i < 5; i++) await login(app.baseUrl, OTHER_PASSWORD);
  assert.equal((await login(app.baseUrl, PASSWORD)).status, 429);
  clock.advance(15 * MINUTE + 1000);
  assert.equal((await login(app.baseUrl, PASSWORD)).status, 200);

  const other = await boot({ password: PASSWORD, now: () => T0 });
  for (let i = 0; i < 4; i++) assert.equal((await login(other.baseUrl, OTHER_PASSWORD)).status, 401);
  assert.equal((await login(other.baseUrl, PASSWORD)).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await login(other.baseUrl, OTHER_PASSWORD)).status, 401);
  assert.equal((await login(other.baseUrl, PASSWORD)).status, 200);
});

test('[F2-R25] con proxy de confianza cada CF-Connecting-IP tiene su propio contador', async () => {
  const app = await boot({ password: PASSWORD, now: () => T0 });
  const ipA = { headers: { 'CF-Connecting-IP': '1.1.1.1' } };
  const ipB = { headers: { 'CF-Connecting-IP': '2.2.2.2' } };
  for (let i = 0; i < 4; i++) {
    assert.equal((await login(app.baseUrl, OTHER_PASSWORD, ipA)).status, 401);
    assert.equal((await login(app.baseUrl, OTHER_PASSWORD, ipB)).status, 401);
  }
  assert.equal((await login(app.baseUrl, OTHER_PASSWORD, ipA)).status, 401, 'quinto fallo de 1.1.1.1');
  assert.equal((await login(app.baseUrl, PASSWORD, ipA)).status, 429, '1.1.1.1 bloqueada');
  assert.equal((await login(app.baseUrl, OTHER_PASSWORD, ipB)).status, 401, '2.2.2.2 sigue en 401 (su quinto fallo)');
  assert.equal((await login(app.baseUrl, PASSWORD, ipB)).status, 429, '2.2.2.2 se bloquea por sus propios fallos, no por los de 1.1.1.1');
  assert.equal((await login(app.baseUrl, PASSWORD)).status, 200, 'sin cabecera usa remoteAddress, que no está bloqueada');
});

test('[F2-R26] mutaciones sin X-Requested-With → 403 antes de la sesión, sin efectos ni fallo contado', async () => {
  const file = await freshRegistry();
  const app = await boot({ projectsFile: file, password: PASSWORD, now: () => T0 });
  const expected = { error: 'Cabecera X-Requested-With requerida' };
  for (let i = 0; i < 5; i++) {
    const r = await login(app.baseUrl, PASSWORD, { csrf: false });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, expected);
    assert.equal(r.setCookie, null);
  }
  const cookie = await app.login();
  assert.ok(cookie, 'los 403 no cuentan como fallos');
  const before = await fs.readFile(file, 'utf8');
  const newDir = await makeTempDir('muver-nuevo-');
  dirs.push(newDir);
  const post = await request(app.baseUrl, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Tres', path: newDir }), cookie, csrf: false });
  assert.equal(post.status, 403);
  assert.deepEqual(post.json, expected);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  const del = await request(app.baseUrl, '/api/projects/uno', { method: 'DELETE', cookie, csrf: false });
  assert.equal(del.status, 403);
  assert.deepEqual(del.json, expected);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  const logout = await request(app.baseUrl, '/api/auth/logout', { method: 'POST', cookie, csrf: false });
  assert.equal(logout.status, 403);
  const change = await request(app.baseUrl, '/api/auth/change-password', { method: 'POST', body: '{}', cookie, csrf: false });
  assert.equal(change.status, 403);
  const lower = await request(app.baseUrl, '/api/auth/logout', { method: 'POST', cookie, csrf: false, headers: { 'X-Requested-With': 'FETCH' } });
  assert.equal(lower.status, 204, 'el valor no distingue mayúsculas');
});

// ---------- Bloque E: cambio de contraseña ----------

test('[F2-R27] change-password → 204, revoca las otras sesiones, conserva la actual y el sessionSecret, cambia salt y hash', async () => {
  const app = await boot({ password: PASSWORD });
  const first = await app.login();
  const second = await app.login();
  const file = path.join(app.dataDir, 'auth.json');
  const before = await readJson(file);
  const r = await request(app.baseUrl, '/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }),
    cookie: first,
  });
  assert.equal(r.status, 204);
  assert.deepEqual(await sessionIds(app.dataDir), [first.split('=')[1].split('.')[0]], 'solo queda la sesión actual');
  assert.equal((await request(app.baseUrl, '/api/projects', { cookie: second })).status, 401, 'la otra sesión queda revocada');
  assert.equal((await request(app.baseUrl, '/api/projects', { cookie: first })).status, 200, 'la actual sigue viva');
  assert.equal((await login(app.baseUrl, PASSWORD)).status, 401, 'la antigua ya no vale');
  assert.equal((await login(app.baseUrl, OTHER_PASSWORD)).status, 200, 'la nueva sí');
  const after = await readJson(file);
  assert.equal(after.sessionSecret, before.sessionSecret);
  assert.notEqual(after.salt, before.salt);
  assert.notEqual(after.hash, before.hash);
  assert.equal(after.createdAt, before.createdAt);
  assert.ok(Date.parse(after.updatedAt) >= Date.parse(before.updatedAt));
});

test('[F2-R28] currentPassword incorrecta → 403 con field, auth.json intacto y cuenta para el 429', async () => {
  const app = await boot({ password: PASSWORD, now: () => T0 });
  const cookie = await app.login();
  const file = path.join(app.dataDir, 'auth.json');
  const before = await fs.readFile(file, 'utf8');
  for (let i = 0; i < 5; i++) {
    const r = await request(app.baseUrl, '/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: OTHER_PASSWORD, newPassword: 'nueva-contraseña-789' }),
      cookie,
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: 'La contraseña actual no es correcta', field: 'currentPassword' });
  }
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal((await login(app.baseUrl, PASSWORD)).status, 429);
  // M1: change-password también pasa por el limitador: con la IP bloqueada responde 429 aunque la contraseña actual sea correcta.
  const blocked = await request(app.baseUrl, '/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'nueva-contraseña-789' }),
    cookie,
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, 'Demasiados intentos. Espera 15 minutos.');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.equal(await fs.readFile(file, 'utf8'), before, 'auth.json sigue intacto');
  assert.equal((await request(app.baseUrl, '/api/projects', { cookie })).status, 200, 'la sesión actual sigue viva');
});

test('[F2-R29] newPassword ausente, no cadena o fuera de 10–128 → 400 con field newPassword sin modificar auth.json', async () => {
  const app = await boot({ password: PASSWORD });
  const cookie = await app.login();
  const file = path.join(app.dataDir, 'auth.json');
  const before = await fs.readFile(file, 'utf8');
  for (const newPassword of [undefined, 12, 'corta', 'x'.repeat(129)]) {
    const r = await request(app.baseUrl, '/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword }),
      cookie,
    });
    assert.equal(r.status, 400, String(newPassword));
    assert.deepEqual(r.json, { error: 'La contraseña debe tener entre 10 y 128 caracteres', field: 'newPassword' });
  }
  assert.equal(await fs.readFile(file, 'utf8'), before);
  const noSession = await request(app.baseUrl, '/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }),
  });
  assert.equal(noSession.status, 401);
  assert.deepEqual(noSession.json, NO_AUTH);
});
