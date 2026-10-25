// Tests de integración del endurecimiento de la ejecución (feature 14, design.md §8): ejecutables falsos en la
// carpeta del proyecto con un PATH de prueba aislado, core.fsmonitor y textconv con marca, diff literal de un fichero
// "*", hooks en GET /changes y "Aprobar spec" con un run activo. Nunca se lanza el `claude` real (el PATH de prueba
// no reutiliza el del sistema) ni se hace push a un remoto real (remoto --bare temporal).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { makeTempDir, makeProjectDir, writeRegistry, startApp, request, removeDir, hasGit, git } from './helpers.js';
import { waitForRun, readFakeLog, fileExists } from './work-helpers.js';
import { BIN_ERRORS } from '../lib/trusted-bin.js';

const execFileAsync = promisify(execFile);
const PASSWORD = 'contraseña-de-la-feature-14';

const IS_WINDOWS = process.platform === 'win32';
const gitAvailable = await hasGit();
// Los ejecutables falsos son scripts #!/bin/sh y el PATH de prueba usa enlaces simbólicos: solo POSIX con git.
const skipHardening = IS_WINDOWS ? 'scripts #!/bin/sh y enlaces simbólicos: en Windows se comprueba a mano (F14-R12)' : (gitAvailable ? false : 'git no está disponible en este sistema');

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

/**
 * Planta en `dir` un ejecutable falso por nombre: si llegara a ejecutarse, añade una línea a `<markDir>/marca-<nombre>`.
 */
async function plantFakeBins(dir, names, markDir) {
  for (const name of names) {
    const file = path.join(dir, name);
    await fs.writeFile(file, `#!/bin/sh\necho "$0 $@" >> "${path.join(markDir, `marca-${name}`)}"\nexit 0\n`, { mode: 0o755 });
    await fs.chmod(file, 0o755);
  }
}

/** Ruta real de un programa del sistema buscándolo en el PATH del proceso de tests (solo para preparar el fixture). */
function findOnSystemPath(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * PATH de prueba aislado: [proyecto, '.', binDir] donde binDir solo tiene enlaces a los `git` y `sh` reales. No
 * reutiliza el PATH del sistema, así que un `claude` real instalado en el equipo nunca es alcanzable.
 */
async function makeTestPath(projectDir) {
  const binDir = await tempDir('muver-bin-');
  for (const name of ['git', 'sh']) {
    const real = findOnSystemPath(name);
    if (real) await fs.symlink(real, path.join(binDir, name));
  }
  return { binDir, PATH: [projectDir, '.', binDir].join(':') };
}

/** true si existe el fichero de marca de `name` (el ejecutable falso llegó a ejecutarse). */
function markExists(markDir, name) {
  return existsSync(path.join(markDir, `marca-${name}`));
}

test('[F14-R11] preparación: ejecutables falsos y PATH de prueba aislado', { skip: skipHardening }, async () => {
  const project = await tempDir('muver-proj-');
  const marks = await tempDir('muver-marks-');
  await plantFakeBins(project, ['git'], marks);
  const { PATH, binDir } = await makeTestPath(project);
  assert.equal(PATH.split(':')[0], project);
  assert.ok(existsSync(path.join(binDir, 'git')));
  assert.equal(markExists(marks, 'git'), false);
});

/** App con los proyectos dados (registro temporal, nunca panel/projects.json) y sesión iniciada. */
async function setup(entries, options = {}) {
  const base = await tempDir('muver-f14-');
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, entries);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD, ...options });
  apps.push(app);
  cleanup.push(app.dataDir);
  const cookie = await app.login();
  const authed = (urlPath, init = {}) => request(app.baseUrl, urlPath, { cookie, ...init });
  const post = (urlPath, body) => authed(urlPath, { method: 'POST', body: JSON.stringify(body ?? {}) });
  return { app, cookie, authed, post, registryFile };
}

/** Repo temporal con un commit, rama main y remoto --bare local con upstream. */
async function repoWithRemote(extra = {}) {
  const dir = await makeProjectDir({ git: { commits: ['Inicial'] }, ...extra });
  cleanup.push(dir);
  const bare = await tempDir('muver-remote-');
  await git(bare, ['init', '-q', '--bare', '-b', 'main']);
  await git(dir, ['remote', 'add', 'origin', bare]);
  await git(dir, ['push', '-q', '-u', 'origin', 'main']);
  return { dir, bare };
}

/** Script de marca: si se ejecuta, añade una línea a `mark`. */
async function markScript(dir, name, mark) {
  const file = path.join(dir, name);
  await fs.writeFile(file, `#!/bin/sh\necho "$0 $@" >> "${mark}"\nexit 0\n`, { mode: 0o755 });
  await fs.chmod(file, 0o755);
  return file;
}

const SPEC_READY = { features: [{ id: 1, slug: 'base', status: 'done' }, { id: 2, slug: 'siguiente', status: 'spec_ready' }] };

// ---------- R11, R4: ejecutables falsos en la carpeta del proyecto ----------

test('[F14-R11][F14-R4] con git, claude, node, npm y bash falsos en el proyecto y PATH = proyecto:.:bin, el panel no ejecuta ninguno', { skip: skipHardening }, async () => {
  const { dir, bare } = await repoWithRemote();
  const marks = await tempDir('muver-marks-');
  await plantFakeBins(dir, ['git', 'claude', 'node', 'npm', 'bash'], marks);
  // Los ejecutables falsos son ficheros del repo: se commitean para no ensuciar el estado y se cambia un fichero.
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'Ejecutables falsos']);
  await git(dir, ['push', '-q']);
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambiado\n');
  const { PATH } = await makeTestPath(dir);
  const home = await tempDir('muver-home-'); // ningún ~/.local/bin/claude real alcanzable
  const ctx = await setup([{ id: 'proy', name: 'Proy', path: dir, testCommand: 'git --version' }], { env: { ...process.env, PATH, HOME: home }, claudeBin: 'claude' });

  const list = await ctx.authed('/api/projects');
  assert.equal(list.status, 200, list.text);
  const summary = list.json.find((p) => p.id === 'proy');
  assert.equal(summary.git.branch, 'main', 'el listado muestra la rama real');
  assert.equal((await ctx.authed('/api/projects/proy')).status, 200);
  assert.equal((await ctx.authed('/api/projects/proy/work')).status, 200);
  const changes = await ctx.authed('/api/projects/proy/changes');
  assert.equal(changes.status, 200, changes.text);
  assert.deepEqual(changes.json.files.map((f) => f.path), ['commit-1.txt']);
  const diff = await ctx.authed('/api/projects/proy/changes/diff?file=commit-1.txt');
  assert.equal(diff.status, 200);
  assert.ok(diff.json.diff.includes('+cambiado'));

  const tests = await ctx.post('/api/projects/proy/tests');
  assert.equal(tests.status, 202, tests.text);
  const testRun = await waitForRun(ctx.app, ctx.cookie, tests.json.runId);
  assert.equal(testRun.run.state, 'succeeded', JSON.stringify(testRun.events));
  assert.ok(testRun.events.some((e) => e.type === 'output' && /^git version /.test(e.text)), 'salida del git del sistema');

  const push = await ctx.post('/api/projects/proy/git/commit-push', { message: 'Commit desde el panel endurecido' });
  assert.equal(push.status, 202, push.text);
  const pushRun = await waitForRun(ctx.app, ctx.cookie, push.json.runId, { timeoutMs: 20000 });
  assert.equal(pushRun.run.state, 'succeeded', JSON.stringify(pushRun.events));
  const { stdout } = await git(bare, ['log', '-1', '--format=%s', 'main']);
  assert.equal(stdout.trim(), 'Commit desde el panel endurecido', 'el commit llegó al remoto con el git del sistema');

  const chat = await ctx.post('/api/projects/proy/runs', { prompt: 'hola' });
  assert.equal(chat.status, 409);
  assert.deepEqual(chat.json, { error: BIN_ERRORS.onlyInProject('claude') });
  assert.equal(await fileExists(ctx.app.fakeLog), false, 'no se lanzó ningún Claude');

  for (const name of ['git', 'claude', 'node', 'npm', 'bash']) assert.equal(markExists(marks, name), false, `se ejecutó el ${name} falso`);
});

test('[F14-R4] claudeBin "claude" sin Claude en el PATH del panel: POST /runs → 409 notFound sin lanzar nada', { skip: skipHardening }, async () => {
  const dir = await makeProjectDir();
  cleanup.push(dir);
  const binDir = await tempDir('muver-bin-vacio-');
  const home = await tempDir('muver-home-');
  const ctx = await setup([{ id: 'proy', name: 'Proy', path: dir }], { env: { ...process.env, PATH: binDir, HOME: home }, claudeBin: 'claude' });
  for (const route of ['/api/projects/proy/runs']) {
    const r = await ctx.post(route, { prompt: 'hola' });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { error: BIN_ERRORS.notFound('claude') });
  }
  assert.equal(await fileExists(ctx.app.fakeLog), false);
  const audit = (await fs.readFile(path.join(ctx.app.dataDir, 'audit.log'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(audit.some((l) => l.action === 'run.chat' && l.status === 409));
});

// ---------- R22: core.fsmonitor ----------

test('[F14-R22] core.fsmonitor con un script de marca no se ejecuta en el listado, el detalle, los cambios, el diff ni el commit y push', { skip: skipHardening }, async () => {
  const { dir, bare } = await repoWithRemote();
  const marks = await tempDir('muver-marks-');
  const mark = path.join(marks, 'marca-fsmonitor');
  const script = await markScript(marks, 'fsmonitor.sh', mark);
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambiado\n');
  await git(dir, ['config', 'core.fsmonitor', script]); // lo último: a partir de aquí cualquier git status lo ejecutaría
  const ctx = await setup([{ id: 'proy', name: 'Proy', path: dir }]);
  assert.equal((await ctx.authed('/api/projects')).status, 200);
  assert.equal((await ctx.authed('/api/projects/proy')).json.git.dirtyCount, 1);
  assert.equal((await ctx.authed('/api/projects/proy/changes')).json.files.length, 1);
  assert.ok((await ctx.authed('/api/projects/proy/changes/diff?file=commit-1.txt')).json.diff.includes('+cambiado'));
  const push = await ctx.post('/api/projects/proy/git/commit-push', { message: 'Con fsmonitor' });
  assert.equal(push.status, 202, push.text);
  const done = await waitForRun(ctx.app, ctx.cookie, push.json.runId, { timeoutMs: 20000 });
  assert.equal(done.run.state, 'succeeded', JSON.stringify(done.events));
  assert.equal((await git(bare, ['log', '-1', '--format=%s', 'main'])).stdout.trim(), 'Con fsmonitor');
  assert.equal(existsSync(mark), false, 'el panel no ejecutó core.fsmonitor');
  // Comprobación del fixture: un git status normal (sin el prefijo del panel) sí lo ejecuta.
  await execFileAsync('git', ['status', '--porcelain'], { cwd: dir }).catch(() => {});
  assert.equal(existsSync(mark), true, 'el fixture es efectivo');
});

// ---------- R23: diff literal y sin drivers ----------

test('[F14-R23] un fichero llamado "*" devuelve solo su diff y el textconv del repo no se ejecuta', { skip: skipHardening }, async () => {
  const dir = await makeProjectDir({ git: { commits: [] } });
  cleanup.push(dir);
  const marks = await tempDir('muver-marks-');
  const mark = path.join(marks, 'marca-textconv');
  const script = await markScript(marks, 'textconv.sh', mark);
  await fs.writeFile(path.join(dir, '*'), 'estrella\n');
  await fs.writeFile(path.join(dir, 'b.txt'), 'be\n');
  await fs.writeFile(path.join(dir, '.gitattributes'), '* diff=marca\n');
  await execFileAsync('git', ['add', '--', '*', 'b.txt', '.gitattributes'], { cwd: dir, env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' } });
  await git(dir, ['commit', '-q', '-m', 'Inicial']);
  await fs.writeFile(path.join(dir, '*'), 'estrella cambiada\n');
  await fs.writeFile(path.join(dir, 'b.txt'), 'be cambiada\n');
  await git(dir, ['config', 'diff.marca.textconv', script]);
  const ctx = await setup([{ id: 'proy', name: 'Proy', path: dir }]);
  const changes = await ctx.authed('/api/projects/proy/changes');
  assert.deepEqual(changes.json.files.map((f) => f.path).sort(), ['*', 'b.txt']);
  const r = await ctx.authed(`/api/projects/proy/changes/diff?file=${encodeURIComponent('*')}`);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.diff.includes('+estrella cambiada'));
  assert.ok(!r.json.diff.includes('b.txt'), 'solo el diff del fichero "*"');
  assert.equal(existsSync(mark), false, 'el textconv del repo no se ejecutó');
  await execFileAsync('git', ['diff', 'HEAD', '--', 'b.txt'], { cwd: dir }).catch(() => {});
  assert.equal(existsSync(mark), true, 'el fixture es efectivo');
});

// ---------- R24: hooks en GET /changes ----------

test('[F14-R24] GET /changes informa de los hooks activos (ordenados, sin .sample) y de core.hooksPath', { skip: skipHardening }, async () => {
  const dir = await makeProjectDir({ git: { commits: ['Inicial'] } });
  cleanup.push(dir);
  const ctx = await setup([{ id: 'proy', name: 'Proy', path: dir }]);
  const fresh = await ctx.authed('/api/projects/proy/changes');
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.json.hooks, []);
  assert.equal(fresh.json.hooksPathCustom, false);
  for (const name of ['pre-push', 'pre-commit']) await fs.writeFile(path.join(dir, '.git', 'hooks', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const two = await ctx.authed('/api/projects/proy/changes');
  assert.deepEqual(two.json.hooks, ['pre-commit', 'pre-push']);
  assert.equal(two.json.hooksPathCustom, false);
  await fs.mkdir(path.join(dir, 'ganchos'));
  await fs.writeFile(path.join(dir, 'ganchos', 'post-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await git(dir, ['config', 'core.hooksPath', 'ganchos']);
  const custom = await ctx.authed('/api/projects/proy/changes');
  assert.deepEqual(custom.json.hooks, ['post-commit']);
  assert.equal(custom.json.hooksPathCustom, true);
});

// ---------- R29: aprobar spec con un run activo ----------

test('[F14-R29] approve-spec con un run activo → 409 con runId y feature_list.json intacto; tras cancelarlo → 200', async () => {
  const dir = await makeProjectDir({ featureList: SPEC_READY });
  cleanup.push(dir);
  const ctx = await setup([{ id: 'proy', name: 'Proy', path: dir }]);
  const file = path.join(dir, 'feature_list.json');
  const before = await fs.readFile(file);
  const run = await ctx.post('/api/projects/proy/runs', { prompt: '[[hang]]' });
  assert.equal(run.status, 202, run.text);
  const busy = await ctx.post('/api/projects/proy/sdd/approve-spec', { featureId: 2 });
  assert.equal(busy.status, 409);
  assert.deepEqual(busy.json, { error: 'Ya hay una ejecución en marcha en este proyecto', runId: run.json.runId });
  assert.ok((await fs.readFile(file)).equals(before), 'bytes idénticos');
  assert.equal((await ctx.post(`/api/runs/${run.json.runId}/cancel`)).status, 202);
  await waitForRun(ctx.app, ctx.cookie, run.json.runId, { timeoutMs: 15000 });
  const ok = await ctx.post('/api/projects/proy/sdd/approve-spec', { featureId: 2 });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).features[1].status, 'in_progress');
});
