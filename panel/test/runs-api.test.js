// Tests de integración de los runs de Claude, cancelación, historial y SSE (lib/runs.js, lib/run-store.js,
// lib/sse.js, lib/work-api.js) — F4: R17–R27, R29, R30, R32–R43. Siempre con el CLI falso, nunca el `claude` real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeProjectDir, makeTempDir, writeRegistry, startApp, request, removeDir, PANEL_DIR, FAKE_COMMAND } from './helpers.js';
import { makeClaudeHome, sessionLine, encodeForFixture, VIEJO_FOLDER } from './claude-fixtures.js';
import { waitForRun, readSse, readFakeLog, fileExists, waitFor, isAlive } from './work-helpers.js';
import { slugify } from '../lib/registry.js';
import { RUN_ID_RE } from '../lib/run-store.js';

const PASSWORD = 'contraseña-de-la-fase-4';
const IS_WINDOWS = process.platform === 'win32';
const skipWindows = IS_WINDOWS ? 'árbol de procesos en Windows: comprobación manual (R97)' : false;
const DEFAULT_TOOLS_TEXT = 'Read,Edit,Write,Glob,Grep,Bash(git status *),Bash(git diff *),Bash(git log *)';

const cleanup = [];
const apps = [];
after(async () => {
  for (const app of apps) await app.close();
  for (const dir of cleanup) await removeDir(dir);
});

async function tempDir(prefix) {
  const dir = await makeTempDir(prefix);
  cleanup.push(dir);
  return dir;
}

/** App con un proyecto ejecutable "proy" (y los que se pasen en `entries`). */
async function setup({ entries, claudeHome, projectDir, ...options } = {}) {
  const base = await tempDir('muver-f4-');
  const dir = projectDir || (await makeProjectDir());
  cleanup.push(dir);
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, entries || [{ id: 'proy', name: 'Proy', path: dir }]);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD, claudeHome, ...options });
  apps.push(app);
  cleanup.push(app.dataDir);
  const cookie = await app.login();
  const authed = (urlPath, init = {}) => request(app.baseUrl, urlPath, { cookie, ...init });
  const post = (urlPath, body) => authed(urlPath, { method: 'POST', body: JSON.stringify(body ?? {}) });
  return { app, cookie, authed, post, dir, registryFile };
}

const wait = (ctx, runId, opts) => waitForRun(ctx.app, ctx.cookie, runId, opts);

async function grandchildPid(fakeLog) {
  let pid = null;
  await waitFor(async () => {
    const entry = (await readFakeLog(fakeLog)).find((e) => e.grandchildPid);
    pid = entry ? entry.grandchildPid : null;
    return pid !== null;
  }, { message: 'PID del nieto en FAKE_CLAUDE_LOG' });
  return pid;
}

// ---------- R17, R23, R34, R38 ----------

test('[F4-R17][F4-R23][F4-R34][F4-R38] POST /runs con el escenario ok: 202, argumentos, cwd, estados y ficheros del historial', async () => {
  const ctx = await setup();
  const prompt = '[[ok]] ' + 'á'.repeat(493);
  const r = await ctx.post('/api/projects/proy/runs', { prompt });
  assert.equal(r.status, 202, r.text);
  const meta = r.json;
  assert.match(meta.runId, RUN_ID_RE);
  assert.equal(meta.projectId, 'proy');
  assert.equal(meta.kind, 'claude');
  assert.equal(meta.action, 'chat');
  assert.equal(meta.label, 'Chat');
  assert.equal(meta.command, null);
  assert.deepEqual(meta.session, { mode: 'new', id: null });
  assert.ok(['queued', 'running'].includes(meta.state));
  assert.equal([...meta.promptPreview].length, 120);
  assert.equal(meta.promptPreview, [...prompt].slice(0, 120).join(''));
  for (const key of ['startedAt', 'endedAt', 'durationMs', 'exitCode', 'claudeSessionId', 'costUsd', 'numTurns', 'permissionDenials', 'error', 'truncated', 'outputBytes', 'dismissed']) {
    assert.ok(key in meta, `falta ${key}`);
  }

  const done = await wait(ctx, meta.runId);
  const final = done.run;
  assert.equal(final.state, 'succeeded');
  assert.equal(final.exitCode, 0);
  assert.equal(final.costUsd, 0.0123);
  assert.equal(final.numTurns, 3);
  assert.equal(final.claudeSessionId, 'fake-session-1');
  assert.ok(final.endedAt);
  assert.equal(typeof final.durationMs, 'number');
  assert.ok(final.outputBytes > 0);

  const states = done.events.filter((e) => e.type === 'state').map((e) => e.state);
  assert.deepEqual(states, ['queued', 'running', 'succeeded']);
  assert.deepEqual(done.events.map((e) => e.seq), done.events.map((_, i) => i + 1), 'seq consecutivo desde 1');
  assert.deepEqual(done.events[0], { seq: 1, at: done.events[0].at, type: 'prompt', text: prompt }, 'el prompt completo es el primer evento');
  const end = done.events.at(-1);
  assert.deepEqual(end, { seq: end.seq, at: end.at, type: 'end', state: 'succeeded', exitCode: 0, durationMs: final.durationMs });
  assert.deepEqual(done.events.filter((e) => e.type === 'tool').map((e) => [e.name, e.summary]), [['Edit', 'src/a.js'], ['Bash', 'git status']]);

  const log = await readFakeLog(ctx.app.fakeLog);
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].argv, ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', DEFAULT_TOOLS_TEXT, prompt]);
  assert.equal(await fs.realpath(log[0].cwd), await fs.realpath(ctx.dir));

  const runDir = path.join(ctx.app.dataDir, 'runs', 'proy');
  const lines = (await fs.readFile(path.join(runDir, `${meta.runId}.jsonl`), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines, done.events, 'los eventos del GET son los del .jsonl');
  const index = JSON.parse(await fs.readFile(path.join(runDir, 'index.json'), 'utf8'));
  assert.equal(index.runs[0].runId, meta.runId);
  assert.equal(index.runs[0].state, 'succeeded');
});

test('[F4-R17] estático: runs.js lanza sin shell, con stdin ignorado, windowsHide y grupo de procesos fuera de Windows', async () => {
  const source = await fs.readFile(path.join(PANEL_DIR, 'lib', 'runs.js'), 'utf8');
  assert.ok(source.includes("stdio: ['ignore', 'pipe', 'pipe']"));
  assert.ok(source.includes('windowsHide: true'));
  assert.ok(source.includes('shell: false'));
  assert.ok(source.includes("detached: platform !== 'win32'"));
  for (const file of ['runs.js', 'command-runner.js', 'work-api.js', 'git-actions.js', 'sdd-actions.js', 'exec-utils.js', 'claude-cli.js']) {
    const text = await fs.readFile(path.join(PANEL_DIR, 'lib', file), 'utf8');
    assert.ok(!/shell:\s*true/.test(text), `${file} no usa shell`);
    const imports = [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'node:child_process'/g)].flatMap((m) => m[1].split(',').map((n) => n.trim()).filter(Boolean));
    for (const name of imports) assert.ok(['spawn', 'execFile'].includes(name), `${file} importa ${name} de child_process (solo spawn/execFile, sin shell)`);
  }
});

// ---------- R18 ----------

test('[F4-R18] prompt ausente, no cadena, vacío o de más de 20000 caracteres → 400 sin proceso; 20000 (también ñ) → 202', async () => {
  const ctx = await setup();
  const cases = [
    [{}, 'Escribe un mensaje para Claude'],
    [{ prompt: 5 }, 'Escribe un mensaje para Claude'],
    [{ prompt: '   ' }, 'Escribe un mensaje para Claude'],
    [{ prompt: 'x'.repeat(20001) }, 'El mensaje supera los 20000 caracteres'],
  ];
  for (const [body, error] of cases) {
    const r = await ctx.post('/api/projects/proy/runs', body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 40));
    assert.deepEqual(r.json, { error, field: 'prompt' });
  }
  assert.equal(await fileExists(ctx.app.fakeLog), false, 'no se lanzó ningún proceso');
  const exact = await ctx.post('/api/projects/proy/runs', { prompt: 'x'.repeat(20000) });
  assert.equal(exact.status, 202, exact.text);
  await wait(ctx, exact.json.runId);
  const multibyte = await ctx.post('/api/projects/proy/runs', { prompt: 'ñ'.repeat(20000) });
  assert.equal(multibyte.status, 202, multibyte.text);
  await wait(ctx, multibyte.json.runId);
});

// ---------- R19 ----------

test('[F4-R19] proyecto inexistente → 404; manual con ruta inexistente y de Claude no resuelto → 409 sin proceso', async () => {
  const { claudeHome } = await makeClaudeHome({ projects: { [VIEJO_FOLDER]: { 'v-1': [sessionLine({ type: 'user', text: 'viejo', timestamp: '2026-01-01T00:00:00.000Z' })] } } });
  cleanup.push(claudeHome);
  const dir = await makeProjectDir();
  const ctx = await setup({ claudeHome, entries: [{ id: 'proy', name: 'Proy', path: dir }, { id: 'perdido', name: 'Perdido', path: path.join(dir, 'no-existe') }] });
  const missing = await ctx.post('/api/projects/no-existe/runs', { prompt: 'hola' });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { error: 'Proyecto no encontrado' });
  const lost = await ctx.post('/api/projects/perdido/runs', { prompt: 'hola' });
  assert.equal(lost.status, 409);
  assert.deepEqual(lost.json, { error: 'El proyecto no tiene una carpeta accesible en este PC' });
  const unresolvedId = slugify(VIEJO_FOLDER);
  const unresolved = await ctx.post(`/api/projects/${unresolvedId}/runs`, { prompt: 'hola' });
  assert.equal(unresolved.status, 409, unresolved.text);
  assert.equal(await fileExists(ctx.app.fakeLog), false);
});

// ---------- R20, R21, R26, R27 ----------

test('[F4-R20][F4-R26] un run activo bloquea otro chat y los tests (409 con runId); cancelar mata el árbol y deja cancelled', { skip: skipWindows }, async () => {
  const dir = await makeProjectDir();
  const ctx = await setup({ projectDir: dir, entries: [{ id: 'proy', name: 'Proy', path: dir, testCommand: `node ${FAKE_COMMAND} ok` }] });
  const first = await ctx.post('/api/projects/proy/runs', { prompt: '[[hang]] espera' });
  assert.equal(first.status, 202);
  const runId = first.json.runId;
  await wait(ctx, runId, { states: ['running'] });
  const second = await ctx.post('/api/projects/proy/runs', { prompt: 'otro' });
  assert.equal(second.status, 409);
  assert.deepEqual(second.json, { error: 'Ya hay una ejecución en marcha en este proyecto', runId });
  const tests = await ctx.post('/api/projects/proy/tests');
  assert.equal(tests.status, 409);
  assert.deepEqual(tests.json, { error: 'Ya hay una ejecución en marcha en este proyecto', runId });

  const grandchild = await grandchildPid(ctx.app.fakeLog);
  const claudePid = (await readFakeLog(ctx.app.fakeLog))[0].pid;
  assert.ok(isAlive(grandchild));
  const started = Date.now();
  const cancel = await ctx.post(`/api/runs/${runId}/cancel`);
  assert.equal(cancel.status, 202);
  assert.equal(cancel.json.runId, runId);
  const done = await wait(ctx, runId, { timeoutMs: 10000 });
  assert.equal(done.run.state, 'cancelled');
  await waitFor(() => !isAlive(grandchild) && !isAlive(claudePid), { timeoutMs: 10000, message: 'nieto y CLI terminados' });
  assert.ok(Date.now() - started < 10000);
  assert.throws(() => process.kill(grandchild, 0), { code: 'ESRCH' });
  assert.equal(done.events.at(-1).type, 'end');
  assert.equal(done.events.at(-1).state, 'cancelled');
});

test('[F4-R21] con maxRuns 1 un run en A hace que B responda 429; tras cancelar A, B → 202', { skip: skipWindows }, async () => {
  const a = await makeProjectDir();
  const b = await makeProjectDir();
  const ctx = await setup({ maxRuns: 1, entries: [{ id: 'a', name: 'A', path: a }, { id: 'b', name: 'B', path: b }] });
  cleanup.push(a, b);
  const first = await ctx.post('/api/projects/a/runs', { prompt: '[[hang]]' });
  assert.equal(first.status, 202);
  await wait(ctx, first.json.runId, { states: ['running'] });
  const launches = async () => (await readFakeLog(ctx.app.fakeLog)).filter((e) => e.argv).length;
  await waitFor(async () => (await launches()) >= 1, { message: 'CLI falso arrancado' });
  const blocked = await ctx.post('/api/projects/b/runs', { prompt: 'hola' });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.json, { error: 'Se ha alcanzado el máximo de ejecuciones simultáneas (1)' });
  assert.equal(await launches(), 1, 'no se lanzó un segundo proceso');
  await ctx.post(`/api/runs/${first.json.runId}/cancel`);
  await wait(ctx, first.json.runId);
  const ok = await ctx.post('/api/projects/b/runs', { prompt: 'hola' });
  assert.equal(ok.status, 202, ok.text);
  await wait(ctx, ok.json.runId);
});

test('[F4-R27] cancelar un run terminado → 409; id bien formado inexistente o mal formado → 404', async () => {
  const ctx = await setup();
  const r = await ctx.post('/api/projects/proy/runs', { prompt: 'hola' });
  await wait(ctx, r.json.runId);
  const finished = await ctx.post(`/api/runs/${r.json.runId}/cancel`);
  assert.equal(finished.status, 409);
  assert.deepEqual(finished.json, { error: 'La ejecución ya ha terminado' });
  for (const id of ['abcdef12-0123abcd', '..%2Fx', 'no-vale']) {
    const missing = await ctx.post(`/api/runs/${id}/cancel`);
    assert.equal(missing.status, 404, id);
    assert.deepEqual(missing.json, { error: 'Ejecución no encontrada' });
  }
});

// ---------- R22 ----------

test('[F4-R22] sesión new/continue/resume: válida e inválida', async () => {
  const dir = await makeProjectDir();
  const other = await makeProjectDir();
  cleanup.push(other);
  const ts = '2026-10-24T09:00:00.000Z';
  const { claudeHome } = await makeClaudeHome({
    projects: {
      [encodeForFixture(dir)]: { 's-1': [sessionLine({ type: 'user', text: 'hola', cwd: dir, timestamp: ts })] },
      [encodeForFixture(other)]: { 's-9': [sessionLine({ type: 'user', text: 'otro', cwd: other, timestamp: ts })] },
    },
  });
  cleanup.push(claudeHome);
  const ctx = await setup({ claudeHome, projectDir: dir, entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  const run = async (session) => ctx.post('/api/projects/proy/runs', { prompt: 'sigue', session });

  const resume = await run({ mode: 'resume', id: 's-1' });
  assert.equal(resume.status, 202, resume.text);
  assert.deepEqual(resume.json.session, { mode: 'resume', id: 's-1' });
  const done = await wait(ctx, resume.json.runId);
  let log = await readFakeLog(ctx.app.fakeLog);
  assert.deepEqual(log.at(-1).argv.slice(-3), ['--resume', 's-1', 'sigue']);

  for (const session of [{ mode: 'resume', id: 's-9' }, { mode: 'resume', id: '../x' }, { mode: 'otro' }, { mode: 'resume' }, 'continue']) {
    const bad = await run(session);
    assert.equal(bad.status, 400, JSON.stringify(session));
    assert.deepEqual(bad.json, { error: 'Sesión de Claude no válida para este proyecto' });
  }

  const fromRun = await run({ mode: 'resume', id: done.run.claudeSessionId });
  assert.equal(fromRun.status, 202, 'el claudeSessionId de un run anterior es válido');
  await wait(ctx, fromRun.json.runId);
  const cont = await run({ mode: 'continue' });
  assert.equal(cont.status, 202);
  assert.deepEqual(cont.json.session, { mode: 'continue', id: null });
  await wait(ctx, cont.json.runId);
  log = await readFakeLog(ctx.app.fakeLog);
  assert.deepEqual(log.at(-1).argv.slice(-2), ['--continue', 'sigue']);
  assert.deepEqual(log.at(-2).argv.slice(-3), ['--resume', 'fake-session-1', 'sigue']);
});

// ---------- R24, R25 ----------

test('[F4-R24] escenario denied → needs_permission con permissionDenials exacto', async () => {
  const ctx = await setup();
  const r = await ctx.post('/api/projects/proy/runs', { prompt: '[[denied]] lint' });
  const done = await wait(ctx, r.json.runId);
  assert.equal(done.run.state, 'needs_permission');
  assert.equal(done.run.exitCode, 0);
  assert.deepEqual(done.run.permissionDenials, [
    { tool: 'Bash', detail: 'npm run lint -- --fix', suggestion: 'npm run lint' },
    { tool: 'WebFetch', detail: 'https://example.com', suggestion: null },
  ]);
  assert.equal(done.events.filter((e) => e.type === 'permission_denied').length, 2);
});

test('[F4-R25] escenarios error y crash → failed; ejecutable inexistente → failed con evento error', async () => {
  const ctx = await setup();
  const error = await ctx.post('/api/projects/proy/runs', { prompt: '[[error]]' });
  const e = await wait(ctx, error.json.runId);
  assert.equal(e.run.state, 'failed');
  assert.equal(e.run.exitCode, 1);
  assert.equal(e.events.find((ev) => ev.type === 'result').ok, false);

  const crash = await ctx.post('/api/projects/proy/runs', { prompt: '[[crash]]' });
  const c = await wait(ctx, crash.json.runId);
  assert.equal(c.run.state, 'failed');
  assert.equal(c.run.exitCode, 2);
  assert.ok(c.events.some((ev) => ev.type === 'output' && ev.stream === 'stderr' && ev.text === 'Error: fallo simulado'));

  const missingCtx = await setup({ claudeCommand: { file: path.join(ctx.dir, 'no-existe', 'claude'), prefixArgs: [] } });
  const m = await missingCtx.post('/api/projects/proy/runs', { prompt: 'hola' });
  assert.equal(m.status, 202);
  const md = await wait(missingCtx, m.json.runId);
  assert.equal(md.run.state, 'failed');
  assert.equal(md.run.error, 'No se pudo ejecutar Claude Code: ENOENT');
  assert.ok(md.events.some((ev) => ev.type === 'error' && ev.message === 'No se pudo ejecutar Claude Code: ENOENT'));
  assert.equal(md.events.at(-1).type, 'end');
});

// ---------- R29, R30 ----------

test('[F4-R29] runTimeoutMs 300 con hang → timeout y aviso de límite de tiempo', { skip: skipWindows }, async () => {
  const ctx = await setup({ runTimeoutMs: 300 });
  const r = await ctx.post('/api/projects/proy/runs', { prompt: '[[hang]]' });
  const done = await wait(ctx, r.json.runId, { timeoutMs: 10000 });
  assert.equal(done.run.state, 'timeout');
  assert.ok(done.events.some((e) => e.type === 'notice' && /^Tiempo máximo alcanzado \(.+ min\): se detiene la ejecución$/.test(e.message)), JSON.stringify(done.events.filter((e) => e.type === 'notice')));
  const grandchild = await grandchildPid(ctx.app.fakeLog);
  await waitFor(() => !isAlive(grandchild), { message: 'nieto terminado tras el timeout' });
});

test('[F4-R30] outputLimitBytes 10000 con big: un único aviso, .jsonl acotado, truncated y succeeded con coste', async () => {
  const ctx = await setup({ outputLimitBytes: 10000 });
  const r = await ctx.post('/api/projects/proy/runs', { prompt: '[[big]]' });
  const done = await wait(ctx, r.json.runId);
  const notices = done.events.filter((e) => e.type === 'notice' && e.message.startsWith('Salida truncada: se alcanzó el límite de'));
  assert.equal(notices.length, 1);
  assert.equal(done.run.truncated, true);
  assert.equal(done.run.state, 'succeeded');
  assert.equal(done.run.costUsd, 0.0123);
  assert.ok(done.run.outputBytes <= 10000);
  const stat = await fs.stat(path.join(ctx.app.dataDir, 'runs', 'proy', `${r.json.runId}.jsonl`));
  assert.ok(stat.size < 10000 + 4096, `tamaño ${stat.size}`);
  assert.ok(done.events.some((e) => e.type === 'result'));
});

// ---------- R32, R33 ----------

test('[F4-R32] al arrancar, un run running del índice pasa a failed "Interrumpida al reiniciar el panel"', async () => {
  const dataDir = await tempDir('muver-data-orphan-');
  const NOW = Date.parse('2026-10-25T12:00:00.000Z');
  const runId = 'mgx3k2a1-9f3c0b1e';
  await fs.mkdir(path.join(dataDir, 'runs', 'proy'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'runs', 'proy', 'index.json'), JSON.stringify({ version: 1, runs: [{ runId, projectId: 'proy', kind: 'claude', action: 'chat', label: 'Chat', state: 'running', startedAt: '2026-10-25T11:00:00.000Z', endedAt: null }] }));
  const ctx = await setup({ dataDir, now: () => NOW });
  const r = await ctx.authed(`/api/runs/${runId}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.run.state, 'failed');
  assert.equal(r.json.run.error, 'Interrumpida al reiniciar el panel');
  assert.equal(r.json.run.endedAt, new Date(NOW).toISOString());
});

test('[F4-R33] al cerrar el servidor se cancelan los runs activos y mueren sus procesos', { skip: skipWindows }, async () => {
  const ctx = await setup();
  const r = await ctx.post('/api/projects/proy/runs', { prompt: '[[hang]]' });
  assert.equal(r.status, 202);
  const grandchild = await grandchildPid(ctx.app.fakeLog);
  const pid = (await readFakeLog(ctx.app.fakeLog))[0].pid;
  await ctx.app.close();
  apps.splice(apps.indexOf(ctx.app), 1);
  await waitFor(() => !isAlive(pid) && !isAlive(grandchild), { timeoutMs: 10000, message: 'procesos terminados tras close()' });
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

// ---------- R35, R36 ----------

test('[F4-R35][F4-R36] historial con dos terminados y uno activo; GET /api/runs/:runId terminado, activo e ids no válidos', { skip: skipWindows }, async () => {
  const ctx = await setup();
  const one = await ctx.post('/api/projects/proy/runs', { prompt: 'uno' });
  await wait(ctx, one.json.runId);
  const two = await ctx.post('/api/projects/proy/runs', { prompt: '[[denied]] dos' });
  await wait(ctx, two.json.runId);
  const three = await ctx.post('/api/projects/proy/runs', { prompt: '[[hang]] tres' });
  await wait(ctx, three.json.runId, { states: ['running'] });

  const list = await ctx.authed('/api/projects/proy/runs');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.map((m) => m.runId), [three.json.runId, two.json.runId, one.json.runId]);
  assert.deepEqual(list.json.map((m) => m.state), ['running', 'needs_permission', 'succeeded']);

  const active = await ctx.authed(`/api/runs/${three.json.runId}`);
  assert.equal(active.status, 200);
  assert.equal(active.json.run.state, 'running');
  assert.ok(active.json.events.length >= 3);

  const finished = await ctx.authed(`/api/runs/${one.json.runId}`);
  const raw = await fs.readFile(path.join(ctx.app.dataDir, 'runs', 'proy', `${one.json.runId}.jsonl`), 'utf8');
  assert.deepEqual(finished.json.events, raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)));

  for (const id of ['abcdef12-0123abcd', '..%2F..%2Fetc', 'x']) {
    const r = await ctx.authed(`/api/runs/${id}`);
    assert.equal(r.status, 404, id);
    assert.deepEqual(r.json, { error: 'Ejecución no encontrada' });
  }
  assert.equal((await ctx.authed('/api/projects/no-existe/runs')).status, 404);
  await ctx.post(`/api/runs/${three.json.runId}/cancel`);
  await wait(ctx, three.json.runId);
});

// ---------- R39–R43: SSE ----------

test('[F4-R39][F4-R43] SSE durante un run: cabeceras, retry, eventos ya producidos, eventos nuevos y latido', { skip: skipWindows }, async () => {
  const ctx = await setup({ sseHeartbeatMs: 50 });
  const r = await ctx.post('/api/projects/proy/runs', { prompt: '[[hang]]' });
  const runId = r.json.runId;
  await wait(ctx, runId, { states: ['running'] });
  const before = (await ctx.authed(`/api/runs/${runId}`)).json.events.length;
  const sse = await readSse(`${ctx.app.baseUrl}/api/runs/${runId}/events`, {
    cookie: ctx.cookie,
    until: (messages) => messages.filter((m) => m.data && m.data.type === 'text').length >= 6 && messages.some((m) => m.comments.includes('ping')),
  });
  assert.equal(sse.status, 200);
  assert.match(sse.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(sse.headers.get('cache-control'), 'no-store');
  assert.equal(sse.headers.get('x-accel-buffering'), 'no');
  assert.equal(sse.messages[0].retry, 3000);
  const data = sse.messages.filter((m) => m.data);
  assert.equal(data[0].data.seq, 1);
  assert.equal(data[0].id, '1');
  assert.ok(data.at(-1).data.seq > before, 'llegan eventos posteriores a la apertura');
  assert.ok(sse.messages.some((m) => m.comments.includes('ping')), 'latido : ping');
  await ctx.post(`/api/runs/${runId}/cancel`);
  await wait(ctx, runId);
});

test('[F4-R40][F4-R41] SSE de un run terminado con Last-Event-ID: 3 empieza en 4 y se cierra tras end; abierto durante un run que termina', { skip: skipWindows }, async () => {
  const ctx = await setup();
  const r = await ctx.post('/api/projects/proy/runs', { prompt: 'hola' });
  const done = await wait(ctx, r.json.runId);
  const replay = await readSse(`${ctx.app.baseUrl}/api/runs/${r.json.runId}/events`, { cookie: ctx.cookie, headers: { 'Last-Event-ID': '3' } });
  assert.equal(replay.ended, true, 'el servidor cierra el flujo');
  const ids = replay.messages.filter((m) => m.data).map((m) => Number(m.id));
  assert.equal(ids[0], 4);
  assert.equal(ids.at(-1), done.events.at(-1).seq);
  assert.equal(replay.messages.filter((m) => m.data).at(-1).data.type, 'end');

  const live = await ctx.post('/api/projects/proy/runs', { prompt: '[[hang]]' });
  await wait(ctx, live.json.runId, { states: ['running'] });
  const reading = readSse(`${ctx.app.baseUrl}/api/runs/${live.json.runId}/events`, { cookie: ctx.cookie });
  setTimeout(() => ctx.post(`/api/runs/${live.json.runId}/cancel`), 300);
  const stream = await reading;
  assert.equal(stream.ended, true);
  const last = stream.messages.filter((m) => m.data).at(-1).data;
  assert.equal(last.type, 'end');
  assert.equal(last.state, 'cancelled');
});

test('[F4-R42] SSE sin sesión → 401 y con id inexistente → 404 JSON', async () => {
  const ctx = await setup();
  const anon = await request(ctx.app.baseUrl, '/api/runs/abcdef12-0123abcd/events');
  assert.equal(anon.status, 401);
  assert.deepEqual(anon.json, { error: 'No autenticado' });
  const missing = await readSse(`${ctx.app.baseUrl}/api/runs/abcdef12-0123abcd/events`, { cookie: ctx.cookie });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { error: 'Ejecución no encontrada' });
  const badId = await ctx.authed('/api/runs/..%2Fx/events');
  assert.equal(badId.status, 404);
});
