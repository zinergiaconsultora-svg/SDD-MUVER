// Tests de integración de lib/work-api.js — bloque A (F4: R50, R51, R55–R60): ejecutar tests, ver cambios y
// "Commit y push" contra repos git temporales reales y un remoto --bare local (nunca un remoto real).
// Bloque B (F4: R4–R6, R62–R64, R66, R78, R79): estado, permisos por proyecto y cola de atención.
// Feature 14: F14-R16, F14-R17 y F14-R18 (comandos amplios con confirmación expresa). Ajuste de [F4-R6]: la
// respuesta de /work incluye broadCommands (desviación declarada en docs/verification.md).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeProjectDir, makeTempDir, writeRegistry, startApp, request, removeDir, hasGit, git, FAKE_COMMAND } from './helpers.js';
import { waitForRun, readFakeLog, fileExists } from './work-helpers.js';
import { defaultRunner } from '../lib/git-info.js';

const PASSWORD = 'contraseña-de-la-fase-4';
const gitAvailable = await hasGit();
const skipNoGit = gitAvailable ? false : 'git no está disponible en este sistema';
// init.sh necesita bash: en Windows se ejecuta si se encuentra Git Bash (misma búsqueda que el panel).
const { findGitBash } = await import('../lib/exec-utils.js');
const { existsSync } = await import('node:fs');
const gitBash = process.platform === 'win32' ? findGitBash({ env: process.env, exists: existsSync, bashBin: process.env.PANEL_BASH_BIN || null }) : null;
const skipNoBash = process.platform === 'win32' && !gitBash ? 'init.sh con bash: no se encontró Git Bash (comprobación manual R98)' : false;

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

async function setup({ entries, dir, ...options } = {}) {
  const base = await tempDir('muver-f4-work-');
  const projectDir = dir || (await makeProjectDir());
  cleanup.push(projectDir);
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, entries || [{ id: 'proy', name: 'Proy', path: projectDir }]);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD, ...options });
  apps.push(app);
  cleanup.push(app.dataDir);
  const cookie = await app.login();
  const authed = (urlPath, init = {}) => request(app.baseUrl, urlPath, { cookie, ...init });
  const post = (urlPath, body) => authed(urlPath, { method: 'POST', body: JSON.stringify(body ?? {}) });
  return { app, cookie, authed, post, dir: projectDir, registryFile };
}

const wait = (ctx, runId, opts) => waitForRun(ctx.app, ctx.cookie, runId, opts);

/** Repo con un commit, una rama main y (opcional) remoto --bare local con o sin upstream. */
async function makeRepo({ remote = false, upstream = false } = {}) {
  const dir = await makeProjectDir({ git: { commits: ['Inicial'] } });
  cleanup.push(dir);
  let bare = null;
  if (remote) {
    bare = await tempDir('muver-remote-');
    await git(bare, ['init', '-q', '--bare', '-b', 'main']);
    await git(dir, ['remote', 'add', 'origin', bare]);
    if (upstream) await git(dir, ['push', '-q', '-u', 'origin', 'main']);
  }
  return { dir, bare };
}

async function commitCount(dir) {
  const { stdout } = await git(dir, ['rev-list', '--count', 'HEAD']);
  return Number(stdout.trim());
}

// ---------- R50, R51: ejecutar tests ----------

test('[F4-R50] POST /tests con testCommand ok: run command/tests, salida stdout y stderr sin ANSI, succeeded', async () => {
  const dir = await makeProjectDir();
  const ctx = await setup({ dir, entries: [{ id: 'proy', name: 'Proy', path: dir, testCommand: `node ${FAKE_COMMAND} ok` }] });
  const r = await ctx.post('/api/projects/proy/tests');
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.kind, 'command');
  assert.equal(r.json.action, 'tests');
  assert.equal(r.json.label, 'Ejecutar tests');
  assert.equal(r.json.command, `node ${FAKE_COMMAND} ok`);
  assert.equal(r.json.session, null);
  assert.equal(r.json.promptPreview, null);
  const done = await wait(ctx, r.json.runId);
  assert.equal(done.run.state, 'succeeded');
  assert.equal(done.run.exitCode, 0);
  const outputs = done.events.filter((e) => e.type === 'output').map((e) => [e.stream, e.text]);
  assert.deepEqual(outputs.sort(), [['stderr', 'aviso'], ['stdout', 'todo bien']]);
  assert.deepEqual(done.events.find((e) => e.type === 'step'), { ...done.events.find((e) => e.type === 'step'), index: 1, total: 1, command: `node ${FAKE_COMMAND} ok` });
  assert.ok(!JSON.stringify(done.events).includes('\\u001b'), 'sin secuencias ANSI');
});

test('[F4-R50] POST /tests con fail 3 → failed con exitCode 3', async () => {
  const dir = await makeProjectDir();
  const ctx = await setup({ dir, entries: [{ id: 'proy', name: 'Proy', path: dir, testCommand: `node ${FAKE_COMMAND} fail 3` }] });
  const r = await ctx.post('/api/projects/proy/tests');
  const done = await wait(ctx, r.json.runId);
  assert.equal(done.run.state, 'failed');
  assert.equal(done.run.exitCode, 3);
  assert.ok(done.events.some((e) => e.type === 'output' && e.text === 'fallo'));
});

test('[F4-R51] sin testCommand usa bash init.sh; sin ninguno → 409', { skip: skipNoBash }, async () => {
  const dir = await makeProjectDir();
  await fs.writeFile(path.join(dir, 'init.sh'), '#!/usr/bin/env bash\necho listo\n', 'utf8');
  const ctx = await setup({ dir });
  const r = await ctx.post('/api/projects/proy/tests');
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.command, 'bash init.sh');
  const done = await wait(ctx, r.json.runId);
  assert.equal(done.run.state, 'succeeded');
  assert.ok(done.events.some((e) => e.type === 'output' && e.stream === 'stdout' && e.text === 'listo'));

  const empty = await setup();
  const none = await empty.post('/api/projects/proy/tests');
  assert.equal(none.status, 409);
  assert.deepEqual(none.json, { error: 'Configura el comando de tests del proyecto (Ajustes de ejecución → Comando de tests)' });
});

// ---------- R55–R57: cambios y diff ----------

test('[F4-R55] GET /changes: modificado, sin seguimiento, renombrado y nombre con espacios y acentos; sin git → 409', { skip: skipNoGit }, async () => {
  const { dir } = await makeRepo();
  await fs.writeFile(path.join(dir, 'viejo.txt'), 'viejo\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'Añade viejo']);
  await git(dir, ['mv', 'viejo.txt', 'renombrado.txt']);
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambiado\n');
  await fs.mkdir(path.join(dir, 'carpeta con espacio'));
  await fs.writeFile(path.join(dir, 'carpeta con espacio', 'ñandú café.txt'), 'hola\n');
  await fs.writeFile(path.join(dir, 'nuevo.txt'), 'nuevo\n');
  const ctx = await setup({ dir });
  const r = await ctx.authed('/api/projects/proy/changes');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.branch, 'main');
  assert.equal(r.json.truncated, false);
  const byPath = Object.fromEntries(r.json.files.map((f) => [f.path, f.status]));
  assert.deepEqual(byPath, {
    'commit-1.txt': ' M',
    'renombrado.txt': 'R ',
    'carpeta con espacio/ñandú café.txt': '??',
    'nuevo.txt': '??',
  });
  assert.match(r.json.stat, /commit-1\.txt/);

  const plain = await makeProjectDir();
  cleanup.push(plain);
  const noGit = await setup({ dir: plain });
  const n = await noGit.authed('/api/projects/proy/changes');
  assert.equal(n.status, 409);
  assert.deepEqual(n.json, { error: 'El proyecto no es un repositorio git' });
});

test('[F4-R56] GET /changes/diff: modificado (-antes/+después), sin seguimiento y 300 KB recortado a 200 KB', { skip: skipNoGit }, async () => {
  const { dir } = await makeRepo();
  await fs.writeFile(path.join(dir, 'texto.txt'), 'antes\n');
  await fs.writeFile(path.join(dir, 'grande.txt'), 'inicio\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'Ficheros']);
  await fs.writeFile(path.join(dir, 'texto.txt'), 'después\n');
  await fs.writeFile(path.join(dir, 'grande.txt'), ('linea de relleno 0123456789\n').repeat(11000));
  await fs.writeFile(path.join(dir, 'suelto.txt'), 'suelto\n');
  const ctx = await setup({ dir });

  const text = await ctx.authed(`/api/projects/proy/changes/diff?file=${encodeURIComponent('texto.txt')}`);
  assert.equal(text.status, 200, text.text);
  assert.equal(text.json.file, 'texto.txt');
  assert.equal(text.json.untracked, false);
  assert.equal(text.json.truncated, false);
  assert.match(text.json.diff, /^-antes$/m);
  assert.match(text.json.diff, /^\+después$/m);

  const untracked = await ctx.authed('/api/projects/proy/changes/diff?file=suelto.txt');
  assert.deepEqual(untracked.json, { file: 'suelto.txt', diff: null, untracked: true, truncated: false });

  const big = await ctx.authed('/api/projects/proy/changes/diff?file=grande.txt');
  assert.equal(big.json.truncated, true);
  assert.equal(Buffer.byteLength(big.json.diff), 200 * 1024);
});

test('[F4-R57] diff de un fichero no listado (../secreto.txt, sin cambios, sin parámetro) → 400 sin ejecutar git diff', { skip: skipNoGit }, async () => {
  const { dir } = await makeRepo();
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambiado\n');
  const calls = [];
  const runner = (file, args, opts) => {
    calls.push(args);
    return defaultRunner(file, args, opts);
  };
  const ctx = await setup({ dir, runner });
  for (const query of [`?file=${encodeURIComponent('../secreto.txt')}`, '?file=README.md', '']) {
    const r = await ctx.authed(`/api/projects/proy/changes/diff${query}`);
    assert.equal(r.status, 400, query);
    assert.deepEqual(r.json, { error: 'El fichero no está en la lista de cambios' });
  }
  assert.ok(calls.length > 0, 'el runner espía se usa');
  assert.ok(!calls.some((args) => args.includes('diff') && args.includes('--')), 'no se ejecutó git diff');
});

// ---------- R58–R60: commit y push ----------

test('[F4-R58] commit-push con upstream: add, commit y push al remoto --bare con el mensaje exacto', { skip: skipNoGit }, async () => {
  const { dir, bare } = await makeRepo({ remote: true, upstream: true });
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambio para subir\n');
  const ctx = await setup({ dir });
  const message = 'Avance de demo desde el Puesto de Mando';
  const r = await ctx.post('/api/projects/proy/git/commit-push', { message });
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.kind, 'command');
  assert.equal(r.json.action, 'commit-push');
  assert.equal(r.json.label, 'Commit y push');
  assert.equal(r.json.command, `git add -A → git commit -m "${message}" → git push`);
  const done = await wait(ctx, r.json.runId);
  assert.equal(done.run.state, 'succeeded', JSON.stringify(done.events.filter((e) => e.type === 'output')));
  assert.deepEqual(done.events.filter((e) => e.type === 'step').map((e) => e.command), ['git add -A', `git commit -m "${message}"`, 'git push']);
  const { stdout } = await git(bare, ['log', '-1', '--format=%s', 'main']);
  assert.equal(stdout.trim(), message);
});

test('[F4-R58] commit-push sin upstream → push -u origin main; remoto inexistente → failed tras el commit', { skip: skipNoGit }, async () => {
  const { dir, bare } = await makeRepo({ remote: true, upstream: false });
  await fs.writeFile(path.join(dir, 'nuevo.txt'), 'nuevo\n');
  const ctx = await setup({ dir });
  const r = await ctx.post('/api/projects/proy/git/commit-push', { message: 'Primer push' });
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.command, 'git add -A → git commit -m "Primer push" → git push -u origin main');
  const done = await wait(ctx, r.json.runId);
  assert.equal(done.run.state, 'succeeded', JSON.stringify(done.events.filter((e) => e.type === 'output')));
  const upstream = await git(dir, ['rev-parse', '--abbrev-ref', '@{u}']);
  assert.equal(upstream.stdout.trim(), 'origin/main');
  assert.equal((await git(bare, ['log', '-1', '--format=%s', 'main'])).stdout.trim(), 'Primer push');

  const broken = await makeRepo();
  await git(broken.dir, ['remote', 'add', 'origin', path.join(broken.dir, 'no-existe.git')]);
  await fs.writeFile(path.join(broken.dir, 'nuevo.txt'), 'x\n');
  const before = await commitCount(broken.dir);
  const ctx2 = await setup({ dir: broken.dir });
  const r2 = await ctx2.post('/api/projects/proy/git/commit-push', { message: 'No llegará' });
  const done2 = await wait(ctx2, r2.json.runId);
  assert.equal(done2.run.state, 'failed');
  assert.equal(await commitCount(broken.dir), before + 1, 'el commit se hizo; el push falló');
  assert.equal(done2.events.filter((e) => e.type === 'step').length, 3);
});

test('[F4-R59] commit-push: mensaje inválido → 400; sin cambios → 409; HEAD separado → 409; sin commits nuevos', { skip: skipNoGit }, async () => {
  const { dir } = await makeRepo({ remote: true, upstream: true });
  const ctx = await setup({ dir });
  const before = await commitCount(dir);
  const nothing = await ctx.post('/api/projects/proy/git/commit-push', { message: 'Nada' });
  assert.equal(nothing.status, 409);
  assert.deepEqual(nothing.json, { error: 'No hay cambios que commitear' });
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambio\n');
  for (const [body, error] of [
    [{}, 'Escribe el mensaje del commit'],
    [{ message: '  ' }, 'Escribe el mensaje del commit'],
    [{ message: 'a\u0000b' }, 'Escribe el mensaje del commit'],
    [{ message: 'x'.repeat(2001) }, 'El mensaje del commit supera los 2000 caracteres'],
  ]) {
    const r = await ctx.post('/api/projects/proy/git/commit-push', body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 30));
    assert.deepEqual(r.json, { error, field: 'message' });
  }
  await git(dir, ['checkout', '-q', '--detach']);
  const detached = await ctx.post('/api/projects/proy/git/commit-push', { message: 'Separado' });
  assert.equal(detached.status, 409);
  assert.deepEqual(detached.json, { error: 'No se puede hacer push sin rama (HEAD separado)' });
  assert.equal(await commitCount(dir), before, 'no hay commits nuevos');
  const plain = await makeProjectDir();
  cleanup.push(plain);
  const noGit = await setup({ dir: plain });
  assert.equal((await noGit.post('/api/projects/proy/git/commit-push', { message: 'x' })).status, 409);
  assert.equal(await fileExists(noGit.app.fakeLog), false);
});

test('[F4-R60] commit-push: un mensaje "--amend; rm -rf /" llega como un único argumento (git log lo muestra literal)', { skip: skipNoGit }, async () => {
  const { dir } = await makeRepo({ remote: true, upstream: true });
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambio\n');
  const ctx = await setup({ dir });
  const before = await commitCount(dir);
  const r = await ctx.post('/api/projects/proy/git/commit-push', { message: '--amend; rm -rf /' });
  const done = await wait(ctx, r.json.runId);
  assert.equal(done.run.state, 'succeeded');
  assert.equal(await commitCount(dir), before + 1, 'commit nuevo, no --amend');
  assert.equal((await git(dir, ['log', '-1', '--format=%s'])).stdout.trim(), '--amend; rm -rf /');
  assert.deepEqual(await readFakeLog(ctx.app.fakeLog), []);
});

// =====================================================================================================
// Bloque B (F4: R4–R6, R62–R64, R66, R78, R79): estado, ajustes y permisos por proyecto, cola de atención.
// =====================================================================================================

const SPEC_READY_FEATURES = { features: [{ id: 1, slug: 'base', status: 'done' }, { id: 4, slug: 'puesto-de-mando-trabajar', status: 'spec_ready' }] };
const DEFAULT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git status *)', 'PowerShell(git status *)', 'Bash(git diff *)', 'PowerShell(git diff *)', 'Bash(git log *)', 'PowerShell(git log *)'];

async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

test('[F4-R4] GET /api/work/status: valores por defecto, allowExec false, por el túnel y con un run activo', async () => {
  const ctx = await setup();
  const r = await ctx.authed('/api/work/status');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { execEnabled: true, accessConfigured: false, tunnel: false, reauthFresh: true, maxRuns: 2, activeRuns: 0, runTimeoutMin: 30 });
  const tunnel = await ctx.authed('/api/work/status', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
  assert.equal(tunnel.json.tunnel, true);
  assert.equal(tunnel.json.reauthFresh, true, 'recién iniciada la sesión no hace falta confirmar');
  const run = await ctx.post('/api/projects/proy/runs', { prompt: '[[hang]]' });
  await wait(ctx, run.json.runId, { states: ['running'] });
  assert.equal((await ctx.authed('/api/work/status')).json.activeRuns, 1);
  await ctx.post(`/api/runs/${run.json.runId}/cancel`);
  await wait(ctx, run.json.runId);
  assert.equal((await request(ctx.app.baseUrl, '/api/work/status')).status, 401);

  const off = await setup({ allowExec: false, maxRuns: 3, runTimeoutMs: 45 * 60000 });
  assert.deepEqual((await off.authed('/api/work/status')).json, { execEnabled: false, accessConfigured: false, tunnel: false, reauthFresh: true, maxRuns: 3, activeRuns: 0, runTimeoutMin: 45 });
});

test('[F4-R6] GET /api/projects/:id/work: con arnés, git, init.sh y allowedCommands; sin nada; no ejecutable; inexistente', { skip: skipNoGit }, async () => {
  const { makeClaudeHome, sessionLine, encodeForFixture, VIEJO_FOLDER } = await import('./claude-fixtures.js');
  const { slugify } = await import('../lib/registry.js');
  const full = await makeProjectDir({ featureList: SPEC_READY_FEATURES, git: { commits: ['Inicial'] } });
  await fs.writeFile(path.join(full, 'init.sh'), 'echo listo\n');
  const bare = await makeProjectDir();
  cleanup.push(full, bare);
  const { claudeHome } = await makeClaudeHome({
    projects: {
      [encodeForFixture(full)]: { 's-1': [sessionLine({ type: 'user', text: 'primera sesión', cwd: full, timestamp: '2026-10-24T09:00:00.000Z' })] },
      [VIEJO_FOLDER]: { 'v-1': [sessionLine({ type: 'user', text: 'viejo', timestamp: '2026-01-01T00:00:00.000Z' })] },
    },
  });
  cleanup.push(claudeHome);
  const ctx = await setup({ claudeHome, entries: [
    { id: 'full', name: 'Full', path: full, allowedCommands: ['npm test'] },
    { id: 'bare', name: 'Bare', path: bare },
  ] });
  const r = await ctx.authed('/api/projects/full/work');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, {
    projectId: 'full',
    executable: true,
    execEnabled: true,
    hasSdd: true,
    isRepo: true,
    specReady: [{ id: 4, slug: 'puesto-de-mando-trabajar' }],
    inProgress: null,
    allowedCommands: ['npm test'],
    testCommand: '',
    effectiveTestCommand: 'bash init.sh',
    testCommandError: null,
    defaultTools: DEFAULT_TOOLS,
    activeRun: null,
    sessions: [{ id: 's-1', title: 'primera sesión', lastActivityAt: '2026-10-24T09:00:00.000Z' }],
    broadCommands: [], // feature 14 (F14-R18)
    // Feature 13 (F13-R58, design.md §3.7): modelo recordado y opciones del selector (ajuste declarado).
    model: 'default',
    models: [
      { value: 'default', label: 'Por defecto' },
      { value: 'haiku', label: 'Haiku' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus', label: 'Opus' },
    ],
  });
  const b = await ctx.authed('/api/projects/bare/work');
  assert.equal(b.json.hasSdd, false);
  assert.equal(b.json.isRepo, false);
  assert.equal(b.json.effectiveTestCommand, null);
  assert.equal(b.json.testCommandError, 'Configura el comando de tests del proyecto (Ajustes de ejecución → Comando de tests)');
  assert.deepEqual(b.json.sessions, []);
  assert.deepEqual(b.json.allowedCommands, []);
  const unresolved = await ctx.authed(`/api/projects/${slugify(VIEJO_FOLDER)}/work`);
  assert.equal(unresolved.status, 200);
  assert.equal(unresolved.json.executable, false);
  assert.equal(unresolved.json.hasSdd, false);
  assert.equal(unresolved.json.isRepo, false);
  assert.equal(unresolved.json.effectiveTestCommand, null);
  assert.equal((await ctx.authed('/api/projects/no-existe/work')).status, 404);
});

test('[F4-R5][F4-R63] allowExec false: las ocho acciones de ejecución → 403 sin procesos ni ficheros; las lecturas → 200', { skip: skipNoGit }, async () => {
  const dir = await makeProjectDir({ featureList: SPEC_READY_FEATURES, git: { commits: ['Inicial'] } });
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambio\n');
  const ctx = await setup({ dir, allowExec: false, entries: [{ id: 'proy', name: 'Proy', path: dir, testCommand: `node ${FAKE_COMMAND} ok` }] });
  const featureBefore = await fs.readFile(path.join(dir, 'feature_list.json'));
  const registryBefore = await fs.readFile(ctx.registryFile);
  const actions = [
    ['POST', '/api/projects/proy/runs', { prompt: 'hola' }],
    ['POST', '/api/projects/proy/sdd/implement', {}],
    ['POST', '/api/projects/proy/sdd/approve-tests', {}],
    ['POST', '/api/projects/proy/sdd/approve-spec', { featureId: 4 }],
    ['POST', '/api/projects/proy/tests', {}],
    ['POST', '/api/projects/proy/git/commit-push', { message: 'x' }],
    ['POST', '/api/projects/proy/permissions', { command: 'npm run lint' }],
    ['PATCH', '/api/projects/proy', { testCommand: 'npm test' }],
  ];
  for (const [method, urlPath, body] of actions) {
    const r = await ctx.authed(urlPath, { method, body: JSON.stringify(body) });
    assert.equal(r.status, 403, `${method} ${urlPath}`);
    assert.deepEqual(r.json, { error: 'Acciones de ejecución desactivadas en este panel (PANEL_ALLOW_EXEC=0)' });
  }
  assert.equal(await fileExists(ctx.app.fakeLog), false);
  assert.deepEqual(await fs.readFile(path.join(dir, 'feature_list.json')), featureBefore);
  assert.deepEqual(await fs.readFile(ctx.registryFile), registryBefore);
  assert.equal(await commitCount(dir), 1);
  assert.equal((await ctx.authed('/api/projects/proy/runs')).status, 200);
  assert.equal((await ctx.authed('/api/projects/proy/changes')).status, 200);
  assert.equal((await ctx.authed('/api/projects/proy/changes/diff?file=commit-1.txt')).status, 200);
  assert.equal((await ctx.authed('/api/projects/proy/work')).json.execEnabled, false);
  const rename = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ name: 'Nuevo nombre' }) });
  assert.equal(rename.status, 200, 'un PATCH sin campos de ejecución funciona como en la fase 3');
});

test('[F4-R62][F4-R63] PATCH con allowedCommands/testCommand: válidos se guardan, inválidos 400; por el túnel sin confirmación 401', async () => {
  const { makeClock } = await import('./helpers.js');
  const clock = makeClock(Date.parse('2026-10-25T10:00:00.000Z'));
  const ctx = await setup({ now: clock.now });
  const ok = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ allowedCommands: ['npm test', ' npm  run build ', 'npm test'], testCommand: ' npm test ' }) });
  assert.equal(ok.status, 200, ok.text);
  const saved = (await readJsonFile(ctx.registryFile)).projects[0];
  assert.deepEqual(saved.allowedCommands, ['npm test', 'npm run build']);
  assert.equal(saved.testCommand, 'npm test');
  const work = await ctx.authed('/api/projects/proy/work');
  assert.deepEqual(work.json.allowedCommands, ['npm test', 'npm run build']);
  assert.equal(work.json.effectiveTestCommand, 'npm test');

  for (const [body, field] of [[{ allowedCommands: ['npm test && rm'] }, 'allowedCommands'], [{ allowedCommands: ['a(b)'] }, 'allowedCommands'], [{ testCommand: '"sin cerrar' }, 'testCommand']]) {
    const r = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify(body) });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.field, field);
  }
  const tooMany = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ allowedCommands: Array.from({ length: 31 }, (_, i) => `c${i}`) }) });
  assert.deepEqual(tooMany.json, { error: 'Como mucho 30 comandos autorizados', field: 'allowedCommands' });
  assert.deepEqual((await readJsonFile(ctx.registryFile)).projects[0].allowedCommands, ['npm test', 'npm run build'], 'sin guardar lo inválido');

  clock.advance(16 * 60 * 1000);
  const tunnel = await ctx.authed('/api/projects/proy', { method: 'PATCH', headers: { 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify({ testCommand: '' }) });
  assert.equal(tunnel.status, 401);
  assert.deepEqual(tunnel.json, { error: 'Confirma tu contraseña para continuar', reauthRequired: true });
  const pin = await ctx.authed('/api/projects/proy', { method: 'PATCH', headers: { 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify({ pinned: true }) });
  assert.equal(pin.status, 200, 'sin campos de ejecución no se pide confirmación');
  const audit = (await fs.readFile(path.join(ctx.app.dataDir, 'audit.log'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const settings = audit.filter((l) => l.action === 'settings.exec');
  assert.equal(settings[0].result, 'ok');
  assert.deepEqual(settings[0].detail.fields, ['allowedCommands', 'testCommand']);
  assert.ok(settings.some((l) => l.status === 401));
});

test('[F4-R64] POST /permissions: añade sin duplicar, crea la entrada de un proyecto solo de Claude y rechaza comandos no válidos', async () => {
  const { makeClaudeHome, sessionLine, encodeForFixture } = await import('./claude-fixtures.js');
  const { slugify } = await import('../lib/registry.js');
  const claudeOnly = await makeProjectDir();
  cleanup.push(claudeOnly);
  const { claudeHome } = await makeClaudeHome({ projects: { [encodeForFixture(claudeOnly)]: { 'c-1': [sessionLine({ type: 'user', text: 'hola', cwd: claudeOnly, timestamp: '2026-10-24T09:00:00.000Z' })] } } });
  cleanup.push(claudeHome);
  const ctx = await setup({ claudeHome });
  for (let i = 0; i < 2; i++) {
    const r = await ctx.post('/api/projects/proy/permissions', { command: 'npm run lint' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { allowedCommands: ['npm run lint'] });
  }
  assert.deepEqual((await readJsonFile(ctx.registryFile)).projects[0].allowedCommands, ['npm run lint']);
  const bad = await ctx.post('/api/projects/proy/permissions', { command: 'npm test; rm' });
  assert.equal(bad.status, 400);
  // Feature 14 (texto ampliado de design.md §4.1, desviación declarada en docs/verification.md).
  assert.deepEqual(bad.json, { error: 'Comando no válido: solo letras, números, espacios y . _ : / = @ + - (máx. 200; no puede empezar por - ni terminar en :)', field: 'command' });
  assert.equal((await ctx.post('/api/projects/no-existe/permissions', { command: 'npm test' })).status, 404);

  const claudeId = slugify(path.basename(claudeOnly));
  const added = await ctx.post(`/api/projects/${claudeId}/permissions`, { command: 'pytest' });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(added.json, { allowedCommands: ['pytest'] });
  const entry = (await readJsonFile(ctx.registryFile)).projects.find((p) => p.id === claudeId);
  assert.equal(entry.path, claudeOnly);
  assert.deepEqual(entry.allowedCommands, ['pytest']);
  const listed = (await ctx.authed('/api/projects')).json.find((p) => p.id === claudeId);
  assert.equal(listed.source, 'both');
});

test('[F4-R66] POST /api/projects y PATCH con appUrl/repoUrl que no son http(s) → 400 con field, sin guardar', async () => {
  const ctx = await setup();
  const extra = await makeProjectDir();
  cleanup.push(extra);
  const before = await fs.readFile(ctx.registryFile, 'utf8');
  for (const [field, value] of [['appUrl', 'javascript:alert(1)'], ['repoUrl', 'ftp://x']]) {
    const created = await ctx.post('/api/projects', { name: 'Extra', path: extra, [field]: value });
    assert.equal(created.status, 400);
    assert.deepEqual(created.json, { error: 'La URL debe empezar por http:// o https://', field });
    const patched = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
    assert.equal(patched.status, 400);
    assert.deepEqual(patched.json, { error: 'La URL debe empezar por http:// o https://', field });
  }
  assert.equal(await fs.readFile(ctx.registryFile, 'utf8'), before);
  const ok = await ctx.post('/api/projects', { name: 'Extra', path: extra, appUrl: 'https://ok.example', repoUrl: '' });
  assert.equal(ok.status, 201);
});

test('[F4-R78][F4-R79] GET /api/attention y POST /dismiss', async () => {
  const spec = await makeProjectDir({ featureList: SPEC_READY_FEATURES });
  const blocked = await makeProjectDir({ featureList: { features: [] }, currentMd: '# Estado\n- **Bloqueos / esperando:** Esperando credenciales del banco\n' });
  const hidden = await makeProjectDir({ featureList: SPEC_READY_FEATURES });
  const work = await makeProjectDir();
  cleanup.push(spec, blocked, hidden, work);
  const dataDir = await tempDir('muver-data-attention-');
  const old = { runId: 'oldrun01-0000aaaa', projectId: 'trabajo', kind: 'claude', action: 'chat', label: 'Chat', state: 'needs_permission', startedAt: new Date(Date.now() - 8 * 86400000).toISOString(), endedAt: new Date(Date.now() - 8 * 86400000).toISOString(), permissionDenials: [], dismissed: false };
  await fs.mkdir(path.join(dataDir, 'runs', 'trabajo'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'runs', 'trabajo', 'index.json'), JSON.stringify({ version: 1, runs: [old] }));
  const ctx = await setup({ dataDir, entries: [
    { id: 'spec', name: 'Spec', path: spec },
    { id: 'bloqueado', name: 'Bloqueado', path: blocked },
    { id: 'oculto', name: 'Oculto', path: hidden, hidden: true },
    { id: 'trabajo', name: 'Trabajo', path: work },
  ] });
  const denied = await ctx.post('/api/projects/trabajo/runs', { prompt: '[[denied_fail]]' });
  await wait(ctx, denied.json.runId);
  const info = await ctx.post('/api/projects/trabajo/runs', { prompt: '[[denied_real]]' });
  await wait(ctx, info.json.runId);
  const ok = await ctx.post('/api/projects/trabajo/runs', { prompt: 'bien' });
  await wait(ctx, ok.json.runId);

  const r = await ctx.authed('/api/attention');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.projects.map((p) => p.id).sort(), ['bloqueado', 'spec']);
  assert.deepEqual(r.json.projects.find((p) => p.id === 'spec'), { id: 'spec', name: 'Spec', reason: 'spec_ready', features: [{ id: 4, slug: 'puesto-de-mando-trabajar' }], blockReason: null, tasksAwaiting: 0 }); // F13-R62: campo nuevo (ajuste declarado)
  assert.deepEqual(r.json.projects.find((p) => p.id === 'bloqueado'), { id: 'bloqueado', name: 'Bloqueado', reason: 'bloqueo', features: [], blockReason: 'Esperando credenciales del banco', tasksAwaiting: 0 });
  // Corrección T36: un succeeded con denegaciones aparece como aviso informativo; el needs_permission como fallo.
  assert.deepEqual(r.json.runs.map((x) => x.runId), [info.json.runId, denied.json.runId]);
  const item = r.json.runs.find((x) => x.runId === denied.json.runId);
  assert.deepEqual(Object.keys(item).sort(), ['endedAt', 'informative', 'label', 'permissionDenials', 'projectId', 'projectName', 'runId', 'state']);
  assert.equal(item.projectName, 'Trabajo');
  assert.equal(item.state, 'needs_permission');
  assert.equal(item.informative, false);
  assert.equal(item.permissionDenials.length, 1);
  const infoItem = r.json.runs.find((x) => x.runId === info.json.runId);
  assert.equal(infoItem.state, 'succeeded');
  assert.equal(infoItem.informative, true);

  for (const id of [denied.json.runId, info.json.runId]) assert.equal((await ctx.post(`/api/runs/${id}/dismiss`)).status, 204);
  assert.deepEqual((await ctx.authed('/api/attention')).json.runs, []);
  assert.equal((await ctx.authed(`/api/runs/${denied.json.runId}`)).json.run.dismissed, true);
  assert.equal((await ctx.post('/api/runs/abcdef12-0123abcd/dismiss')).status, 404);

  const live = await ctx.post('/api/projects/trabajo/runs', { prompt: '[[hang]]' });
  await wait(ctx, live.json.runId, { states: ['running'] });
  const busy = await ctx.post(`/api/runs/${live.json.runId}/dismiss`);
  assert.equal(busy.status, 409);
  assert.deepEqual(busy.json, { error: 'La ejecución sigue en marcha' });
  await ctx.post(`/api/runs/${live.json.runId}/cancel`);
  await wait(ctx, live.json.runId);
});

// ---------- Feature 14: comandos amplios (R16, R17, R18) ----------

async function auditLines(ctx) {
  try {
    return (await fs.readFile(path.join(ctx.app.dataDir, 'audit.log'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test('[F14-R16] POST /permissions con un comando amplio: 400 needsAcknowledge sin guardar; con acknowledgeBroad se guarda y se audita', async () => {
  const ctx = await setup();
  const before = await fs.readFile(ctx.registryFile, 'utf8');
  const r = await ctx.post('/api/projects/proy/permissions', { command: 'node' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, {
    error: 'Comando de ejecución libre: «node». Permite a Claude ejecutar cualquier programa en este proyecto; confírmalo expresamente para autorizarlo',
    field: 'command',
    needsAcknowledge: true,
    broadCommands: ['node'],
  });
  assert.equal(await fs.readFile(ctx.registryFile, 'utf8'), before, 'projects.json sin cambios');
  const notTrue = await ctx.post('/api/projects/proy/permissions', { command: 'node', acknowledgeBroad: 'true' });
  assert.equal(notTrue.status, 400, 'solo vale acknowledgeBroad === true');

  const ok = await ctx.post('/api/projects/proy/permissions', { command: 'node', acknowledgeBroad: true });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json, { allowedCommands: ['node'] });
  assert.deepEqual((await readJsonFile(ctx.registryFile)).projects[0].allowedCommands, ['node']);
  const entries = (await auditLines(ctx)).filter((l) => l.action === 'permissions.add');
  const accepted = entries.find((l) => l.status === 200);
  assert.deepEqual(accepted.detail.acknowledgedBroad, ['node']);
  assert.ok(entries.some((l) => l.status === 400 && l.result === 'rejected'));

  const again = await ctx.post('/api/projects/proy/permissions', { command: 'node' });
  assert.equal(again.status, 200, 'un comando ya guardado no pide la marca');
  const plain = await ctx.post('/api/projects/proy/permissions', { command: 'npm test' });
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.json, { allowedCommands: ['node', 'npm test'] });
});

test('[F14-R17] PATCH con un comando amplio nuevo: 400 sin guardar ningún campo; con la marca 200; después se conserva sin la marca', async () => {
  const ctx = await setup();
  const before = await fs.readFile(ctx.registryFile, 'utf8');
  const r = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ allowedCommands: ['npm test', 'git'], testCommand: 'npm test', name: 'Otro' }) });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, {
    error: 'Comando de ejecución libre: «git». Permite a Claude ejecutar cualquier programa en este proyecto; confírmalo expresamente para autorizarlo',
    field: 'allowedCommands',
    needsAcknowledge: true,
    broadCommands: ['git'],
  });
  assert.equal(await fs.readFile(ctx.registryFile, 'utf8'), before, 'ni allowedCommands ni testCommand ni name');
  const two = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ allowedCommands: ['node -e', 'git'] }) });
  assert.equal(two.json.error, 'Comandos de ejecución libre: «node -e», «git». Permite a Claude ejecutar cualquier programa en este proyecto; confírmalo expresamente para autorizarlo');
  assert.deepEqual(two.json.broadCommands, ['node -e', 'git']);

  const ok = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ allowedCommands: ['npm test', 'git'], testCommand: 'npm test', acknowledgeBroad: true }) });
  assert.equal(ok.status, 200, ok.text);
  const saved = (await readJsonFile(ctx.registryFile)).projects[0];
  assert.deepEqual(saved.allowedCommands, ['npm test', 'git']);
  assert.equal(saved.testCommand, 'npm test');
  assert.ok(!('acknowledgeBroad' in saved), 'la marca no se guarda');
  const settings = (await auditLines(ctx)).filter((l) => l.action === 'settings.exec' && l.status === 200);
  assert.deepEqual(settings.at(-1).detail.acknowledgedBroad, ['git']);

  const keep = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ allowedCommands: ['git', 'npm run build'] }) });
  assert.equal(keep.status, 200, 'git ya estaba guardado: no se pide la marca');
  assert.deepEqual((await readJsonFile(ctx.registryFile)).projects[0].allowedCommands, ['git', 'npm run build']);
});

test('[F14-R18] GET /work incluye broadCommands en el orden de allowedCommands (vacía si no hay)', async () => {
  const dir = await makeProjectDir();
  const other = await makeProjectDir();
  cleanup.push(other);
  const ctx = await setup({ dir, entries: [
    { id: 'proy', name: 'Proy', path: dir, allowedCommands: ['npm test', 'node', 'git rev-list', 'env'] },
    { id: 'otro', name: 'Otro', path: other },
  ] });
  assert.deepEqual((await ctx.authed('/api/projects/proy/work')).json.broadCommands, ['node', 'env']);
  assert.deepEqual((await ctx.authed('/api/projects/otro/work')).json.broadCommands, []);
});

test('[F14-R34] POST /permissions y PATCH exigen acknowledgeBroad para git fetch, npx.cmd, Invoke-Expression y git grep', async () => {
  const ctx = await setup();
  for (const command of ['git fetch', 'npx.cmd', 'Invoke-Expression', 'git grep']) {
    const r = await ctx.post('/api/projects/proy/permissions', { command });
    assert.equal(r.status, 400, command);
    assert.equal(r.json.needsAcknowledge, true, command);
    assert.deepEqual(r.json.broadCommands, [command]);
  }
  const patch = await ctx.authed('/api/projects/proy', { method: 'PATCH', body: JSON.stringify({ allowedCommands: ['npm test', 'git fetch', 'npx.cmd', 'Invoke-Expression', 'git grep'] }) });
  assert.equal(patch.status, 400);
  assert.deepEqual(patch.json.broadCommands, ['git fetch', 'npx.cmd', 'Invoke-Expression', 'git grep']);
  assert.deepEqual((await readJsonFile(ctx.registryFile)).projects[0].allowedCommands ?? [], []);
});

// ---------- Feature 13: modelo de Claude en los runs de trabajo (F13-R56, F13-R57, F13-R58) ----------

const MODEL_FEATURES = { features: [{ id: 1, slug: 'uno', description: 'Uno', status: 'in_progress' }] };

/** Argumentos de la última invocación del CLI falso. */
async function lastArgv(ctx) {
  const log = (await readFakeLog(ctx.app.fakeLog)).filter((e) => e.argv);
  return log.at(-1);
}

test('[F13-R56] chat con sonnet, implement sin model (usa el recordado) y chat con default (quita el campo)', async () => {
  const dir = await makeProjectDir({ featureList: MODEL_FEATURES });
  const ctx = await setup({ dir });
  const readEntry = async () => JSON.parse(await fs.readFile(ctx.registryFile, 'utf8')).projects.find((p) => p.id === 'proy');

  const chat = await ctx.post('/api/projects/proy/runs', { prompt: 'Hola', model: 'sonnet' });
  assert.equal(chat.status, 202, chat.text);
  assert.equal(chat.json.model, 'sonnet');
  await wait(ctx, chat.json.runId);
  let entry = await lastArgv(ctx);
  assert.equal(entry.model, 'sonnet');
  const idx = entry.argv.indexOf('--model');
  assert.ok(idx > 0 && entry.argv[idx + 1] === 'sonnet');
  assert.equal(entry.argv.at(-2), '--allowedTools', '--allowedTools sigue siendo la última');
  assert.ok(idx < entry.argv.indexOf('--allowedTools'));
  assert.equal((await readEntry()).model, 'sonnet', 'modelo recordado en el registro');

  const implement = await ctx.post('/api/projects/proy/sdd/implement', {});
  assert.equal(implement.status, 202, implement.text);
  assert.equal(implement.json.model, 'sonnet', 'sin model usa el recordado');
  await wait(ctx, implement.json.runId);
  entry = await lastArgv(ctx);
  assert.equal(entry.model, 'sonnet');

  const plain = await ctx.post('/api/projects/proy/runs', { prompt: 'Otra', model: 'default' });
  assert.equal(plain.status, 202);
  assert.equal(plain.json.model, null);
  await wait(ctx, plain.json.runId);
  entry = await lastArgv(ctx);
  assert.ok(!entry.argv.includes('--model'), 'default no pasa --model');
  assert.ok(!('model' in (await readEntry())), 'default quita el campo del registro');

  const approve = await ctx.post('/api/projects/proy/sdd/approve-tests', { model: 'opus' });
  assert.equal(approve.status, 202, approve.text);
  assert.equal(approve.json.model, 'opus');
  await wait(ctx, approve.json.runId);
  assert.equal((await lastArgv(ctx)).model, 'opus');

  const runs = await ctx.authed('/api/projects/proy/runs');
  assert.deepEqual(runs.json.map((m) => m.model), ['opus', null, 'sonnet', 'sonnet']);
  const audit = (await fs.readFile(path.join(ctx.app.dataDir, 'audit.log'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(audit.some((a) => a.action === 'run.chat' && a.detail && a.detail.model === 'sonnet'), 'detail.model en la auditoría');
});

test('[F13-R57] model inválido en runs y botones SDD → 400 sin proceso ni escritura del registro', async () => {
  const dir = await makeProjectDir({ featureList: MODEL_FEATURES });
  const ctx = await setup({ dir });
  const before = await fs.readFile(ctx.registryFile);
  for (const model of ['gpt-4', 3, 'haiku --verbose']) {
    for (const [url, body] of [['/api/projects/proy/runs', { prompt: 'Hola', model }], ['/api/projects/proy/sdd/implement', { model }], ['/api/projects/proy/sdd/approve-tests', { model }]]) {
      const r = await ctx.post(url, body);
      assert.equal(r.status, 400, `${url} ${JSON.stringify(model)}`);
      assert.deepEqual(r.json, { error: 'Modelo no válido: elige Por defecto, Haiku, Sonnet u Opus', field: 'model' });
    }
  }
  assert.equal(await fileExists(ctx.app.fakeLog), false, 'ningún proceso');
  assert.ok((await fs.readFile(ctx.registryFile)).equals(before), 'registro sin cambios');
});

test('[F13-R58] GET /work trae model (recordado o default) y models', async () => {
  const dir = await makeProjectDir();
  const other = await makeProjectDir();
  cleanup.push(other);
  const ctx = await setup({ dir, entries: [{ id: 'proy', name: 'Proy', path: dir }, { id: 'opus', name: 'Opus', path: other, model: 'opus' }] });
  const plain = await ctx.authed('/api/projects/proy/work');
  assert.equal(plain.json.model, 'default');
  assert.deepEqual(plain.json.models, [
    { value: 'default', label: 'Por defecto' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
  ]);
  const remembered = await ctx.authed('/api/projects/opus/work');
  assert.equal(remembered.json.model, 'opus');
});
