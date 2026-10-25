// Tests de lib/audit.js y de la auditoría de las acciones de ejecución — F4: R75, R76, R77.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createAuditLog, clipPrompt } from '../lib/audit.js';
import { makeProjectDir, makeTempDir, writeRegistry, startApp, request, removeDir, makeClock } from './helpers.js';
import { waitForRun, waitFor, tunnelHeaders, makeAccessKeys, startCertsServer, makeJwt } from './work-helpers.js';

const PASSWORD = 'contraseña-secreta-del-panel';
const T0 = Date.parse('2026-10-25T10:00:00.000Z');
const MIN = 60 * 1000;

const cleanup = [];
const closers = [];
after(async () => {
  for (const close of closers) await close();
  for (const dir of cleanup) await removeDir(dir);
});

async function readLines(file) {
  try {
    return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// ---------- Unitarios ----------

test('[F4-R75] createAuditLog escribe una línea JSON por entrada con "at" primero y clipPrompt recorta a 120', async () => {
  const dir = await makeTempDir('muver-audit-');
  cleanup.push(dir);
  const file = path.join(dir, 'sub', 'audit.log');
  const log = createAuditLog({ file, now: () => T0 });
  await Promise.all([
    log.write({ ip: '1.2.3.4', tunnel: false, projectId: 'p', action: 'run.chat', result: 'started', runId: 'x', status: 202 }),
    log.write({ ip: '1.2.3.4', tunnel: true, projectId: 'p', action: 'run.end', result: 'ok', detail: { state: 'succeeded' } }),
  ]);
  const raw = await fs.readFile(file, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('{"at":"2026-10-25T10:00:00.000Z","ip":"1.2.3.4"'), lines[0]);
  assert.equal(JSON.parse(lines[1]).detail.state, 'succeeded');
  assert.equal([...clipPrompt('ñ'.repeat(500))].length, 120);
  assert.equal(clipPrompt('corto'), 'corto');
  assert.equal(clipPrompt(undefined), '');
});

test('[F4-R77] createAuditLog rota a audit.log.1 al superar maxBytes (sustituyendo la copia anterior) y nunca lanza', async () => {
  const dir = await makeTempDir('muver-audit-');
  cleanup.push(dir);
  const file = path.join(dir, 'audit.log');
  const log = createAuditLog({ file, now: () => T0, maxBytes: 200 });
  for (let i = 1; i <= 5; i++) await log.write({ action: 'run.chat', n: i, pad: 'x'.repeat(40) });
  const current = await readLines(file);
  const rotated = await readLines(`${file}.1`);
  assert.ok((await fs.stat(file)).size <= 200);
  assert.ok(current.length >= 1 && rotated.length >= 1);
  assert.equal(current.at(-1).n, 5, 'la última entrada está en el fichero actual');
  assert.ok(rotated.every((e) => e.n < current[0].n), 'la copia tiene entradas anteriores');
  assert.ok(current.length + rotated.length < 5, 'la copia anterior se sustituye');

  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await fs.writeFile(path.join(dir, 'fichero'), 'no es carpeta');
    const broken = createAuditLog({ file: path.join(dir, 'fichero', 'audit.log'), now: () => T0 });
    await assert.doesNotReject(broken.write({ action: 'x', secreto: 'NO-DEBE-APARECER' }));
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.ok(!errors[0].includes('NO-DEBE-APARECER'), 'el error no incluye el contenido');
});

// ---------- Integración ----------

async function setup(options = {}) {
  const base = await makeTempDir('muver-f4-audit-');
  const dir = await makeProjectDir();
  cleanup.push(base, dir);
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, [{ id: 'proy', name: 'Proy', path: dir }, { id: 'perdido', name: 'Perdido', path: path.join(dir, 'no-existe') }]);
  const clock = makeClock(T0);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD, now: clock.now, ...options });
  closers.push(() => app.close());
  cleanup.push(app.dataDir);
  const auditFile = path.join(app.dataDir, 'audit.log');
  return { app, clock, auditFile, call: (urlPath, init = {}) => request(app.baseUrl, urlPath, init) };
}

test('[F4-R75][F4-R77] run aceptado, 409 y 401 por confirmación: líneas con sus campos y run.end con el estado', async () => {
  const ctx = await setup();
  const cookie = await ctx.app.login();
  const prompt = 'p'.repeat(500);
  const ok = await ctx.call('/api/projects/proy/runs', { method: 'POST', cookie, body: JSON.stringify({ prompt }) });
  assert.equal(ok.status, 202);
  await waitForRun(ctx.app, cookie, ok.json.runId);
  const conflict = await ctx.call('/api/projects/perdido/runs', { method: 'POST', cookie, body: JSON.stringify({ prompt: 'hola' }) });
  assert.equal(conflict.status, 409);
  ctx.clock.advance(16 * MIN);
  const reauth = await ctx.call('/api/projects/proy/runs', { method: 'POST', cookie, headers: tunnelHeaders(), body: JSON.stringify({ prompt: 'por el túnel' }) });
  assert.equal(reauth.status, 401);

  await waitFor(async () => (await readLines(ctx.auditFile)).length >= 4, { message: 'cuatro líneas de auditoría' });
  const lines = await readLines(ctx.auditFile);
  const started = lines.find((l) => l.action === 'run.chat' && l.result === 'started');
  assert.deepEqual(Object.keys(started), ['at', 'ip', 'tunnel', 'projectId', 'action', 'result', 'runId', 'status', 'detail']);
  assert.equal(started.at, new Date(T0).toISOString());
  assert.equal(started.tunnel, false);
  assert.equal(started.projectId, 'proy');
  assert.equal(started.runId, ok.json.runId);
  assert.equal(started.status, 202);
  assert.equal(started.detail.promptPreview, 'p'.repeat(120));
  assert.equal(started.detail.session, undefined, 'sin session en el cuerpo, no se inventa');

  const rejected = lines.find((l) => l.action === 'run.chat' && l.status === 409);
  assert.deepEqual({ projectId: rejected.projectId, result: rejected.result, tunnel: rejected.tunnel }, { projectId: 'perdido', result: 'rejected', tunnel: false });

  const unauth = lines.find((l) => l.status === 401);
  assert.equal(unauth.action, 'run.chat');
  assert.equal(unauth.result, 'rejected');
  assert.equal(unauth.tunnel, true);
  assert.equal(unauth.ip, '203.0.113.7');
  assert.equal(unauth.detail.promptPreview, 'por el túnel');

  const end = lines.find((l) => l.action === 'run.end');
  assert.equal(end.runId, ok.json.runId);
  assert.equal(end.detail.state, 'succeeded');
  assert.equal(end.projectId, 'proy');
});

test('[F4-R76] audit.log no contiene la contraseña, el token de sesión, el JWT de Access ni el carácter 121 del prompt', async () => {
  const keys = makeAccessKeys('kid-audit');
  const certs = await startCertsServer([keys.jwk]);
  closers.push(() => certs.close());
  const ctx = await setup({ cfAccess: { team: 'muver', aud: 'aud-x' }, cfCertsUrl: certs.url });
  const nowSec = Math.floor(T0 / 1000);
  const jwt = makeJwt(keys.privateKey, { alg: 'RS256', kid: 'kid-audit' }, { aud: 'aud-x', iss: 'https://muver.cloudflareaccess.com', exp: nowSec + 3600, email: 'humano@example.com' });
  const headers = { ...tunnelHeaders(), 'Cf-Access-Jwt-Assertion': jwt };
  const cookie = await ctx.app.login(PASSWORD, { headers });
  const sessionToken = cookie.split('=')[1];
  assert.equal((await ctx.call('/api/auth/reauth', { method: 'POST', cookie, headers, body: JSON.stringify({ password: PASSWORD }) })).status, 204);
  assert.equal((await ctx.call('/api/auth/reauth', { method: 'POST', cookie, headers, body: JSON.stringify({ password: 'contraseña-equivocada-123' }) })).status, 401);
  const prompt = 'a'.repeat(120) + 'MARCA-121' + 'b'.repeat(371);
  const r = await ctx.call('/api/projects/proy/runs', { method: 'POST', cookie, headers, body: JSON.stringify({ prompt }) });
  assert.equal(r.status, 202, r.text);
  await waitForRun(ctx.app, cookie, r.json.runId);
  await waitFor(async () => (await readLines(ctx.auditFile)).some((l) => l.action === 'run.end'), { message: 'línea run.end' });
  const raw = await fs.readFile(ctx.auditFile, 'utf8');
  for (const secret of [PASSWORD, 'contraseña-equivocada-123', sessionToken, jwt, jwt.split('.')[2], 'MARCA-121', prompt.slice(0, 121)]) {
    assert.ok(!raw.includes(secret), `audit.log contiene algo sensible: ${secret.slice(0, 20)}…`);
  }
  const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.filter((l) => l.action === 'auth.reauth').map((l) => l.result), ['ok', 'rejected']);
  assert.ok(lines.every((l) => !l.detail || !l.detail.promptPreview || [...l.detail.promptPreview].length <= 120));
});
