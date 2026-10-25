// Tests unitarios de lib/auth.js y lib/sessions.js — F2-R2, F2-R5, F2-R6, F2-R8, F2-R12, F2-R13, F2-R18–R21, F2-R27
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  SCRYPT_PARAMS,
  validatePassword,
  hashPassword,
  verifyPassword,
  createAuthRecord,
  loadAuth,
  saveAuth,
} from '../lib/auth.js';
import { signId, verifyToken, createSessionStore, SESSION_TTL_MS, TOUCH_INTERVAL_MS } from '../lib/sessions.js';
import { PANEL_DIR, makeTempDir, removeDir, makeClock } from './helpers.js';

const HEX = (n) => new RegExp(`^[0-9a-f]{${n}}$`);
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD_ERROR = 'La contraseña debe tener entre 10 y 128 caracteres';

// ---------- lib/auth.js ----------

test('[F2-R3][F2-R29] validatePassword acepta 10 y 128 caracteres y rechaza 9, 129 y no cadenas', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.equal(MAX_PASSWORD_LENGTH, 128);
  assert.deepEqual(validatePassword('a'.repeat(10)), { ok: true });
  assert.deepEqual(validatePassword('ñ'.repeat(128)), { ok: true });
  assert.deepEqual(validatePassword('a'.repeat(9)), { ok: false, error: PASSWORD_ERROR });
  assert.deepEqual(validatePassword('a'.repeat(129)), { ok: false, error: PASSWORD_ERROR });
  assert.deepEqual(validatePassword(1234567890), { ok: false, error: PASSWORD_ERROR });
  assert.deepEqual(validatePassword(undefined), { ok: false, error: PASSWORD_ERROR });
  assert.deepEqual(validatePassword(null), { ok: false, error: PASSWORD_ERROR });
});

test('[F2-R12] hashPassword usa scrypt N=16384 r=8 p=1 keylen=64 con salt nuevo; verifyPassword acepta la correcta y rechaza la alterada', async () => {
  assert.deepEqual(SCRYPT_PARAMS, { N: 16384, r: 8, p: 1, keylen: 64 });
  const a = await hashPassword('contraseña-de-prueba');
  const b = await hashPassword('contraseña-de-prueba');
  assert.deepEqual(a.params, { N: 16384, r: 8, p: 1, keylen: 64 });
  assert.match(a.salt, HEX(32));
  assert.match(a.hash, HEX(128));
  assert.notEqual(a.salt, b.salt, 'salt distinto en cada llamada');
  assert.notEqual(a.hash, b.hash, 'hash distinto con salt distinto');
  assert.equal(await verifyPassword('contraseña-de-prueba', a), true);
  assert.equal(await verifyPassword('contraseña-de-prueba', b), true);
  assert.equal(await verifyPassword('contraseña-de-pruebb', a), false, 'difiere solo en el último carácter');
  assert.equal(await verifyPassword('', a), false);
});

test('[F2-R13] verifyPassword con hash de longitud distinta o hex inválido devuelve false sin lanzar', async () => {
  const record = await hashPassword('contraseña-de-prueba');
  assert.equal(await verifyPassword('contraseña-de-prueba', { ...record, hash: record.hash.slice(0, 64) }), false);
  assert.equal(await verifyPassword('contraseña-de-prueba', { ...record, hash: 'zz' + record.hash.slice(2) }), false);
  assert.equal(await verifyPassword('contraseña-de-prueba', { ...record, hash: 'no-es-hex' }), false);
  assert.equal(await verifyPassword('contraseña-de-prueba', {}), false);
  assert.equal(await verifyPassword(undefined, record), false);
});

test('[F2-R13] lib/auth.js y lib/sessions.js usan timingSafeEqual', async () => {
  for (const file of ['auth.js', 'sessions.js']) {
    const source = await fs.readFile(path.join(PANEL_DIR, 'lib', file), 'utf8');
    assert.ok(source.includes('timingSafeEqual'), `${file} debe usar timingSafeEqual`);
  }
});

test('[F2-R2] createAuthRecord devuelve el registro del contrato §3.1 con sessionSecret distinto del salt', async () => {
  const record = await createAuthRecord('contraseña-de-prueba');
  assert.equal(record.version, 1);
  assert.equal(record.algorithm, 'scrypt');
  assert.match(record.salt, HEX(32));
  assert.match(record.hash, HEX(128));
  assert.deepEqual(record.params, { N: 16384, r: 8, p: 1, keylen: 64 });
  assert.match(record.sessionSecret, HEX(64));
  assert.notEqual(record.sessionSecret, record.salt);
  assert.ok(!Number.isNaN(Date.parse(record.createdAt)));
  assert.equal(record.createdAt, record.updatedAt);
  assert.equal(await verifyPassword('contraseña-de-prueba', record), true);
});

test('[F2-R5][F2-R6] loadAuth: ausente → missing; válido → ok; roto → corrupt; sin sessionSecret → corrupt; saveAuth atómico', async () => {
  const dir = await makeTempDir('muver-auth-');
  const file = path.join(dir, 'anidado', 'auth.json');
  assert.deepEqual(await loadAuth(file), { state: 'missing' });

  const record = await createAuthRecord('contraseña-de-prueba');
  await saveAuth(file, record);
  const entries = await fs.readdir(path.dirname(file));
  assert.deepEqual(entries, ['auth.json'], 'sin .tmp residual y con el directorio creado');
  const loaded = await loadAuth(file);
  assert.equal(loaded.state, 'ok');
  assert.deepEqual(loaded.record, record);

  await fs.writeFile(file, '{ roto', 'utf8');
  assert.deepEqual(await loadAuth(file), { state: 'corrupt' });
  const { sessionSecret, ...withoutSecret } = record;
  await fs.writeFile(file, JSON.stringify(withoutSecret), 'utf8');
  assert.deepEqual(await loadAuth(file), { state: 'corrupt' });
  await fs.writeFile(file, JSON.stringify({ ...record, salt: 'no-hex' }), 'utf8');
  assert.deepEqual(await loadAuth(file), { state: 'corrupt' });
  await removeDir(dir);
});

// ---------- lib/sessions.js ----------

const SECRET = 'a'.repeat(64);

test('[F2-R13] signId/verifyToken: token válido → id; "abc", "a.b", "", firma alterada, otro secreto → null', () => {
  const id = '0123456789abcdef'.repeat(4);
  const signature = signId(id, SECRET);
  assert.match(signature, HEX(64));
  assert.equal(verifyToken(`${id}.${signature}`, SECRET), id);
  assert.equal(verifyToken('abc', SECRET), null);
  assert.equal(verifyToken('a.b', SECRET), null);
  assert.equal(verifyToken('', SECRET), null);
  assert.equal(verifyToken(undefined, SECRET), null);
  const altered = signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0');
  assert.equal(verifyToken(`${id}.${altered}`, SECRET), null, 'firma de longitud correcta pero alterada');
  assert.equal(verifyToken(`${id}.${signature}`, 'b'.repeat(64)), null, 'otro secreto');
  assert.equal(verifyToken(`${id}.${signature}`.toUpperCase(), SECRET), null);
});

async function readSessions(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

test('[F2-R8][F2-R18][F2-R19] createSessionStore: create persiste con expiresAt = now + 30 d; touch deslizante; caducidad', async () => {
  assert.equal(SESSION_TTL_MS, 30 * DAY);
  assert.equal(TOUCH_INTERVAL_MS, 60 * 1000);
  const dir = await makeTempDir('muver-sessions-');
  const file = path.join(dir, 'sub', 'sessions.json');
  const t0 = Date.parse('2026-10-25T10:00:00Z');
  const clock = makeClock(t0);
  const store = createSessionStore({ file, secret: SECRET, now: clock.now });

  const created = await store.create();
  assert.match(created.id, HEX(64));
  assert.match(created.token, new RegExp(`^${created.id}\\.[0-9a-f]{64}$`));
  assert.equal(created.expiresAt, t0 + 30 * DAY);
  let saved = await readSessions(file);
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.sessions[created.id], { createdAt: t0, lastSeenAt: t0, expiresAt: t0 + 30 * DAY });
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['sessions.json']);

  // Id firmado pero no listado → null (lista blanca).
  const ghost = 'f'.repeat(64);
  assert.equal(await store.verify(`${ghost}.${signId(ghost, SECRET)}`), null);
  assert.equal(await store.verify('basura'), null);

  // Verificación + touch a los 10 s: no renueva ni escribe.
  clock.advance(10 * 1000);
  const session = await store.verify(created.token);
  assert.equal(session.id, created.id);
  assert.equal(session.expiresAt, t0 + 30 * DAY);
  const before = await fs.readFile(file, 'utf8');
  assert.deepEqual(await store.touch(created.id), { renewed: false });
  assert.equal(await fs.readFile(file, 'utf8'), before);

  // A los 20 días: renueva y escribe.
  clock.set(t0 + 20 * DAY);
  assert.deepEqual(await store.touch(created.id), { renewed: true });
  saved = await readSessions(file);
  assert.equal(saved.sessions[created.id].lastSeenAt, t0 + 20 * DAY);
  assert.equal(saved.sessions[created.id].expiresAt, t0 + 50 * DAY);
  assert.equal(store.count(), 1);

  // Caducada: verify → null y eliminada del fichero.
  clock.set(t0 + 51 * DAY);
  assert.equal(await store.verify(created.token), null);
  saved = await readSessions(file);
  assert.equal(created.id in saved.sessions, false);
  assert.equal(store.count(), 0);
  await removeDir(dir);
});

test('[F2-R20][F2-R27] destroy elimina una sesión y destroyOthers conserva solo la indicada', async () => {
  const dir = await makeTempDir('muver-sessions-');
  const file = path.join(dir, 'sessions.json');
  const store = createSessionStore({ file, secret: SECRET, now: () => 1000 });
  const a = await store.create();
  const b = await store.create();
  const c = await store.create();
  assert.equal(store.count(), 3);
  await store.destroy(b.id);
  assert.equal(await store.verify(b.token), null);
  assert.ok(await store.verify(a.token));
  await store.destroyOthers(a.id);
  assert.equal(store.count(), 1);
  assert.ok(await store.verify(a.token));
  assert.equal(await store.verify(c.token), null);
  const saved = await readSessions(file);
  assert.deepEqual(Object.keys(saved.sessions), [a.id]);
  await store.destroy('inexistente'); // no lanza
  await removeDir(dir);
});

test('[F2-R21] createSessionStore carga desde fichero existente; roto → cero sesiones y console.error', async () => {
  const dir = await makeTempDir('muver-sessions-');
  const file = path.join(dir, 'sessions.json');
  const first = createSessionStore({ file, secret: SECRET, now: () => 1000 });
  const created = await first.create();

  const second = createSessionStore({ file, secret: SECRET, now: () => 2000 });
  assert.ok(await second.verify(created.token), 'la sesión sobrevive a un reinicio');

  await fs.writeFile(file, '{ roto', 'utf8');
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const third = createSessionStore({ file, secret: SECRET, now: () => 3000 });
    assert.equal(await third.verify(created.token), null);
    assert.equal(third.count(), 0);
    assert.ok(errors.some((e) => e.includes('sessions.json ilegible')), errors.join('\n'));
    await third.create();
    assert.ok((await readSessions(file)).version === 1, 'la siguiente escritura lo sobrescribe');
  } finally {
    console.error = original;
  }
  await removeDir(dir);
});

// ---------- Fase 4: reauthAt en las sesiones (F4-R68, F4-R69) ----------

test('[F4-R68] createSessionStore: create({ reauthAt }), markReauth, persistencia y carga de reauthAt', async () => {
  const dir = await makeTempDir('muver-sessions-');
  const file = path.join(dir, 'sessions.json');
  const clock = makeClock(Date.parse('2026-10-25T10:00:00Z'));
  const store = createSessionStore({ file, secret: SECRET, now: clock.now });
  const withReauth = await store.create({ reauthAt: clock.now() });
  const without = await store.create();
  assert.equal((await store.verify(withReauth.token)).reauthAt, clock.now());
  assert.equal((await store.verify(without.token)).reauthAt, undefined);

  clock.advance(20 * 60 * 1000);
  await store.markReauth(without.id);
  assert.equal((await store.verify(without.token)).reauthAt, clock.now());
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.sessions[without.id].reauthAt, clock.now());
  assert.equal(saved.sessions[withReauth.id].reauthAt, clock.now() - 20 * 60 * 1000);

  // Una sesión con reauthAt no numérico se carga sin él (se trata como no confirmada).
  saved.sessions[withReauth.id].reauthAt = 'ayer';
  await fs.writeFile(file, JSON.stringify(saved));
  const reloaded = createSessionStore({ file, secret: SECRET, now: clock.now });
  assert.equal((await reloaded.verify(without.token)).reauthAt, clock.now());
  const loadedWithout = await reloaded.verify(withReauth.token);
  assert.ok(loadedWithout, 'la sesión sigue siendo válida');
  assert.equal(loadedWithout.reauthAt, undefined);
  await reloaded.markReauth('f'.repeat(64)); // sesión inexistente: no lanza
  await removeDir(dir);
});
