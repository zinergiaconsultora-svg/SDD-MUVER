// Tests de evidencia de la feature 19 (design.md §7.1): con el git real, en un repo temporal y un entorno aislado
// (como [F15-R6]), cada caso demuestra PRIMERO que la llamada git del vector ejecuta un script de marca SIN la
// protección ("la evidencia es efectiva") y DESPUÉS que las peticiones del panel no lo ejecutan. Los scripts de marca
// solo crean un fichero dentro de un temporal. Se saltan sin git y en Windows (scripts #!/bin/sh); la máquina de los
// tests es git 2.43 (la parte de GIT_NO_LAZY_FETCH de R10 se salta con git < 2.45, la cubre la tarea manual).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { makeTempDir, makeProjectDir, writeRegistry, startApp, request, removeDir, hasGit } from './helpers.js';
import { waitForRun } from './work-helpers.js';
import { createGitRunner, defaultRunner } from '../lib/git-info.js';
import { planCommitPush } from '../lib/git-actions.js';

const execFileAsync = promisify(execFile);
const PASSWORD = 'contraseña-de-la-feature-19';
const IS_WINDOWS = process.platform === 'win32';
const gitAvailable = await hasGit();
const skip = IS_WINDOWS ? 'scripts #!/bin/sh: en Windows se comprueba a mano (F19-R20)' : (gitAvailable ? false : 'git no está disponible en este sistema');

// Versión de git: con < 2.45 la descarga perezosa no respeta GIT_NO_LAZY_FETCH (riesgo documentado); la parte del
// panel de R10 se salta con ese motivo exacto.
let lazyFetchSupported = false;
if (gitAvailable) {
  const m = (await execFileAsync('git', ['--version'])).stdout.match(/(\d+)\.(\d+)/);
  const [maj, min] = [Number(m[1]), Number(m[2])];
  lazyFetchSupported = maj > 2 || (maj === 2 && min >= 45);
}
const SKIP_LAZY = 'git < 2.45 no admite GIT_NO_LAZY_FETCH';

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
 * Entorno aislado como [F15-R6]: sin variables GIT_* heredadas, con HOME y XDG_CONFIG_HOME temporales,
 * GIT_CONFIG_NOSYSTEM=1 y GIT_TERMINAL_PROMPT=0; user.name/email van en el ~/.gitconfig temporal.
 */
async function isolatedEvidenceEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase().startsWith('GIT_')) continue;
    env[key] = value;
  }
  env.HOME = await tempDir('muver-home-f19-');
  env.XDG_CONFIG_HOME = await tempDir('muver-xdg-f19-');
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  await execFileAsync('git', ['config', '--global', 'user.name', 'Test MUVER'], { env });
  await execFileAsync('git', ['config', '--global', 'user.email', 'test@muver.local'], { env });
  await execFileAsync('git', ['config', '--global', 'commit.gpgsign', 'false'], { env });
  await execFileAsync('git', ['config', '--global', 'init.defaultBranch', 'main'], { env });
  return env;
}

/** git con el entorno aislado (preparar el fixture y la evidencia; shell:false, timeout 10 s). */
function gitRun(env) {
  return (dir, args, { input } = {}) =>
    execFileAsync('git', args, { cwd: dir, env, timeout: 10000, shell: false, windowsHide: true, ...(input !== undefined ? { input } : {}) });
}

/**
 * Runner del panel que usa el mismo entorno aislado en las lecturas git (el runner central antepone el prefijo y
 * añade GIT_NO_LAZY_FETCH). Así las peticiones del panel ven solo el HOME temporal y la configuración local del repo.
 */
function isolatedRunner(env) {
  const inner = createGitRunner();
  return (file, args, opts = {}) => inner(file, args, { ...opts, env: opts.env || env });
}

/** Script de marca: crea (o añade a) el fichero de marca si git lo ejecuta. `cat` deja pasar el contenido (filtros). */
async function writeMark(file, markFile, { cat = false } = {}) {
  const body = cat
    ? `#!/bin/sh\necho "$0 $*" >> "${markFile}"\ncat\n`
    : `#!/bin/sh\necho "$0 $*" >> "${markFile}"\nexit 1\n`;
  await fs.writeFile(file, body, { mode: 0o755 });
  await fs.chmod(file, 0o755);
}

/** App del panel con el repo dado, el entorno aislado y un runner que lee con ese entorno. Sesión iniciada. */
async function startPanel(dir, env) {
  const base = await tempDir('muver-f19-reg-');
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, [{ id: 'proy', name: 'Proy', path: dir }]);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD, env, runner: isolatedRunner(env) });
  apps.push(app);
  cleanup.push(app.dataDir);
  const cookie = await app.login();
  const authed = (urlPath, init = {}) => request(app.baseUrl, urlPath, { cookie, ...init });
  const post = (urlPath, body) => authed(urlPath, { method: 'POST', body: JSON.stringify(body ?? {}) });
  return { app, cookie, authed, post };
}

// ---------- R3: firma de git log (gpg.program) ----------

test('[F19-R3] log.showSignature + gpg.program: git log ejecuta gpg.program; el listado y el detalle del panel no', { skip }, async () => {
  const env = await isolatedEvidenceEnv();
  const g = gitRun(env);
  const dir = await tempDir('muver-f19-r3-');
  const marks = await tempDir('muver-f19-r3-marks-');
  const tools = await tempDir('muver-f19-r3-tools-');
  const mark = path.join(marks, 'r3');
  await g(dir, ['init', '-q', '-b', 'main']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'hola\n');
  await g(dir, ['add', 'a.txt']);
  await g(dir, ['commit', '-q', '-m', 'init']);
  // Firma falsa en HEAD: insertar las líneas gpgsig tras la línea committer.
  const raw = (await g(dir, ['cat-file', 'commit', 'HEAD'])).stdout;
  const out = [];
  let inserted = false;
  for (const line of raw.split('\n')) {
    out.push(line);
    if (!inserted && line.startsWith('committer ')) {
      out.push('gpgsig -----BEGIN PGP SIGNATURE-----', ' x', ' -----END PGP SIGNATURE-----');
      inserted = true;
    }
  }
  const commitFile = path.join(await tempDir('muver-f19-r3-commit-'), 'commit');
  await fs.writeFile(commitFile, out.join('\n'));
  const newHash = (await g(dir, ['hash-object', '-t', 'commit', '-w', commitFile])).stdout.trim();
  await g(dir, ['reset', '-q', '--hard', newHash]);
  const gpg = path.join(tools, 'gpg.sh');
  await writeMark(gpg, mark);
  await g(dir, ['config', 'log.showSignature', 'true']);
  await g(dir, ['config', 'gpg.program', gpg]);

  // Evidencia: git log -1 sin el prefijo ejecuta gpg.program.
  await fs.rm(mark, { force: true });
  await g(dir, ['log', '-1', '--format=%H']).catch(() => {});
  assert.ok(existsSync(mark), 'la evidencia es efectiva: git log -1 ejecutó gpg.program');

  // Panel: el listado y el detalle responden con la rama y el último commit reales, y no ejecutan gpg.program.
  await fs.rm(mark, { force: true });
  const panel = await startPanel(dir, env);
  const list = await panel.authed('/api/projects');
  assert.equal(list.status, 200, list.text);
  const detail = await panel.authed('/api/projects/proy');
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.git.branch, 'main');
  assert.equal(detail.json.git.recentCommits[0].hash, newHash);
  assert.equal(existsSync(mark), false, 'el panel no ejecutó gpg.program');
});

// ---------- R7: filtros clean/process (dos fuentes de atributos) ----------

async function runR7({ driver, attrInInfo }) {
  const env = await isolatedEvidenceEnv();
  const g = gitRun(env);
  const dir = await tempDir('muver-f19-r7-');
  const marks = await tempDir('muver-f19-r7-marks-');
  const tools = await tempDir('muver-f19-r7-tools-');
  const mark = path.join(marks, 'r7');
  await g(dir, ['init', '-q', '-b', 'main']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'hola\n');
  await g(dir, ['add', 'a.txt']);
  await g(dir, ['commit', '-q', '-m', 'init']);
  if (attrInInfo) {
    await fs.mkdir(path.join(dir, '.git', 'info'), { recursive: true });
    await fs.writeFile(path.join(dir, '.git', 'info', 'attributes'), 'a.txt filter=marca\n');
  } else {
    await fs.writeFile(path.join(dir, '.gitattributes'), 'a.txt filter=marca\n');
  }
  const flt = path.join(tools, 'flt.sh');
  await writeMark(flt, mark, { cat: true });
  await g(dir, ['config', `filter.marca.${driver}`, flt]);
  await g(dir, ['config', 'filter.marca.required', 'true']);
  // Cambio del mismo tamaño que el índice para forzar que git relea a.txt.
  await fs.writeFile(path.join(dir, 'a.txt'), 'chau\n');

  // Evidencia: status y diff --stat sin la anulación ejecutan el filtro.
  await fs.rm(mark, { force: true });
  await g(dir, ['status', '--porcelain']).catch(() => {});
  await g(dir, ['diff', '--stat']).catch(() => {});
  assert.ok(existsSync(mark), `la evidencia es efectiva: git status/diff ejecutó filter.marca.${driver}`);

  // Panel: listado, detalle, /changes, /diff y planCommitPush no ejecutan el filtro y responden con normalidad.
  await fs.rm(mark, { force: true });
  const panel = await startPanel(dir, env);
  const list = await panel.authed('/api/projects');
  assert.equal(list.status, 200, list.text);
  const detail = await panel.authed('/api/projects/proy');
  assert.equal(detail.status, 200, detail.text);
  assert.ok(detail.json.git.dirtyFiles.includes('a.txt'), 'a.txt entre los ficheros con cambios');
  const changes = await panel.authed('/api/projects/proy/changes');
  assert.equal(changes.status, 200, changes.text);
  assert.ok(changes.json.files.some((f) => f.path === 'a.txt'), 'a.txt en la lista de cambios');
  const diff = await panel.authed(`/api/projects/proy/changes/diff?file=${encodeURIComponent('a.txt')}`);
  assert.equal(diff.status, 200, diff.text);
  // planCommitPush con el runner real (sin lanzar los pasos): el status previo tampoco ejecuta el filtro.
  const plan = await planCommitPush(dir, 'Mensaje', { runner: isolatedRunner(env), env });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(existsSync(mark), false, `el panel no ejecutó filter.marca.${driver}`);
}

test('[F19-R7] filter.clean con .gitattributes: git lo ejecuta; el panel no', { skip }, async () => {
  await runR7({ driver: 'clean', attrInInfo: false });
});

test('[F19-R7] filter.process con .git/info/attributes: git lo ejecuta; el panel no', { skip }, async () => {
  await runR7({ driver: 'process', attrInInfo: true });
});

// ---------- R9: filtro clean en la configuración local de un submódulo ----------

test('[F19-R9] filtro en un submódulo: git status recursivo lo ejecuta; el panel no (--ignore-submodules=dirty)', { skip }, async () => {
  const env = await isolatedEvidenceEnv();
  const g = gitRun(env);
  const marks = await tempDir('muver-f19-r9-marks-');
  const tools = await tempDir('muver-f19-r9-tools-');
  const mark = path.join(marks, 'r9');
  const sub = await tempDir('muver-f19-r9-S-');
  await g(sub, ['init', '-q', '-b', 'main']);
  await fs.writeFile(path.join(sub, 's.txt'), 'hola\n');
  await g(sub, ['add', 's.txt']);
  await g(sub, ['commit', '-q', '-m', 'init']);
  const dir = await tempDir('muver-f19-r9-main-');
  await g(dir, ['init', '-q', '-b', 'main']);
  await fs.writeFile(path.join(dir, 'x.txt'), 'x\n');
  await g(dir, ['add', 'x.txt']);
  await g(dir, ['commit', '-q', '-m', 'init']);
  await g(dir, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sub']);
  await g(dir, ['commit', '-q', '-m', 'addsub']);
  const subDir = path.join(dir, 'sub');
  await fs.writeFile(path.join(subDir, '.gitattributes'), 's.txt filter=m\n');
  const flt = path.join(tools, 'flt.sh');
  await writeMark(flt, mark, { cat: true });
  await g(subDir, ['config', 'filter.m.clean', flt]);
  await g(subDir, ['config', 'filter.m.required', 'true']);
  await fs.writeFile(path.join(subDir, 's.txt'), 'chau\n');

  // Evidencia: git status --porcelain en el principal (recursivo) ejecuta el filtro del submódulo.
  await fs.rm(mark, { force: true });
  await g(dir, ['status', '--porcelain']).catch(() => {});
  assert.ok(existsSync(mark), 'la evidencia es efectiva: git status entró en el submódulo y ejecutó su filtro');

  // Panel: listado, detalle y /changes no entran en el submódulo.
  await fs.rm(mark, { force: true });
  const panel = await startPanel(dir, env);
  assert.equal((await panel.authed('/api/projects')).status, 200);
  assert.equal((await panel.authed('/api/projects/proy')).status, 200);
  assert.equal((await panel.authed('/api/projects/proy/changes')).status, 200);
  assert.equal(existsSync(mark), false, 'el panel no ejecutó el filtro del submódulo');
});

// ---------- R10: clon parcial, descarga perezosa (remote.origin.uploadpack) ----------

test('[F19-R10] clon parcial: git diff HEAD descarga el blob ausente y ejecuta remote.origin.uploadpack', { skip }, async () => {
  const env = await isolatedEvidenceEnv();
  const g = gitRun(env);
  const marks = await tempDir('muver-f19-r10-marks-');
  const tools = await tempDir('muver-f19-r10-tools-');
  const mark = path.join(marks, 'r10');
  const origin = await tempDir('muver-f19-r10-O-');
  await g(origin, ['init', '-q', '-b', 'main']);
  await g(origin, ['config', 'uploadpack.allowFilter', 'true']);
  await fs.writeFile(path.join(origin, 'f.txt'), 'v1\n');
  await g(origin, ['add', 'f.txt']);
  await g(origin, ['commit', '-q', '-m', 'c1']);
  const dir = await tempDir('muver-f19-r10-C-');
  await g(dir, ['clone', '-q', '--filter=blob:none', `file://${origin}`, dir]);
  await fs.writeFile(path.join(origin, 'f.txt'), 'v2 cambia el contenido\n');
  await g(origin, ['add', 'f.txt']);
  await g(origin, ['commit', '-q', '-m', 'c2']);
  await g(dir, ['fetch', '-q', 'origin']);
  await g(dir, ['reset', '-q', '--soft', 'origin/main']);
  const up = path.join(tools, 'up.sh');
  await writeMark(up, mark);
  await g(dir, ['config', 'remote.origin.uploadpack', up]);

  // Evidencia: git diff HEAD -- f.txt sin GIT_NO_LAZY_FETCH ejecuta remote.origin.uploadpack para traer el blob.
  await fs.rm(mark, { force: true });
  await g(dir, ['diff', 'HEAD', '--', 'f.txt']).catch(() => {});
  assert.ok(existsSync(mark), 'la evidencia es efectiva: git diff HEAD ejecutó remote.origin.uploadpack');

  // Panel: con git ≥ 2.45, GET /diff responde 200 y no ejecuta el programa; con git < 2.45 se salta (riesgo documentado).
  if (!lazyFetchSupported) {
    assert.ok(true, SKIP_LAZY);
    return;
  }
  await fs.rm(mark, { force: true });
  const panel = await startPanel(dir, env);
  const diff = await panel.authed(`/api/projects/proy/changes/diff?file=${encodeURIComponent('f.txt')}`);
  assert.equal(diff.status, 200, diff.text);
  assert.equal(existsSync(mark), false, 'el panel no ejecutó remote.origin.uploadpack');
});

// ---------- R14: transporte ext:: en el push ----------

test('[F19-R14] protocol.ext.allow=always + URL ext::: git push ejecuta el programa; el push del panel no (run failed)', { skip }, async () => {
  const env = await isolatedEvidenceEnv();
  const g = gitRun(env);
  const marks = await tempDir('muver-f19-r14-marks-');
  const tools = await tempDir('muver-f19-r14-tools-');
  const mark = path.join(marks, 'r14');
  const dir = await makeProjectDir({ git: { commits: ['Inicial'] } });
  cleanup.push(dir);
  await g(dir, ['config', 'protocol.ext.allow', 'always']);
  const prog = path.join(tools, 'ext.sh');
  await writeMark(prog, mark);
  await g(dir, ['remote', 'add', 'origin', `ext::${prog} %G`]);

  // Evidencia: git push origin HEAD sin el prefijo ejecuta el programa del transporte ext::.
  await fs.rm(mark, { force: true });
  await g(dir, ['push', 'origin', 'HEAD']).catch(() => {});
  assert.ok(existsSync(mark), 'la evidencia es efectiva: git push por ext:: ejecutó el programa');

  // Panel: POST commit-push con un cambio nuevo; el push falla por protocol.ext.allow=never y no ejecuta el programa.
  await fs.rm(mark, { force: true });
  await fs.writeFile(path.join(dir, 'commit-1.txt'), 'cambio nuevo\n');
  const panel = await startPanel(dir, env);
  const r = await panel.post('/api/projects/proy/git/commit-push', { message: 'Avance' });
  assert.equal(r.status, 202, r.text);
  const done = await waitForRun(panel.app, panel.cookie, r.json.runId);
  assert.equal(done.run.state, 'failed', JSON.stringify(done.run));
  assert.equal(existsSync(mark), false, 'el panel no ejecutó el programa del transporte ext::');
});

// ---------- R11: avisos de la configuración local en GET /changes ----------

test('[F19-R11] GET /changes devuelve execConfig con las claves locales que ejecutan programas (y [] en un repo recién creado)', { skip }, async () => {
  const env = await isolatedEvidenceEnv();
  const g = gitRun(env);
  const dir = await tempDir('muver-f19-r11-');
  await g(dir, ['init', '-q', '-b', 'main']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'hola\n');
  await g(dir, ['add', 'a.txt']);
  await g(dir, ['commit', '-q', '-m', 'init']);
  // Seis claves locales que ejecutan programas.
  await g(dir, ['config', 'gpg.program', '/bin/true']);
  await g(dir, ['config', 'core.askPass', '/bin/true']);
  await g(dir, ['config', 'credential.helper', 'store']);
  await g(dir, ['config', 'core.sshCommand', 'ssh']);
  await g(dir, ['config', 'remote.origin.receivepack', 'git-receive-pack']);
  await g(dir, ['config', 'filter.x.clean', '/bin/true']);
  // En el ~/.gitconfig temporal (ámbito global): no deben aparecer en execConfig.
  await g(dir, ['config', '--global', 'credential.helper', 'cache']);
  await g(dir, ['config', '--global', 'filter.lfs.process', 'git-lfs filter-process']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'chau\n');

  const panel = await startPanel(dir, env);
  const changes = await panel.authed('/api/projects/proy/changes');
  assert.equal(changes.status, 200, changes.text);
  assert.deepEqual(changes.json.execConfig, ['core.askpass', 'core.sshcommand', 'credential.helper', 'filter.x.clean', 'gpg.program', 'remote.origin.receivepack']);

  // Repo recién creado sin esas claves → execConfig vacío.
  const plain = await tempDir('muver-f19-r11b-');
  await g(plain, ['init', '-q', '-b', 'main']);
  await fs.writeFile(path.join(plain, 'b.txt'), 'x\n');
  const base2 = await tempDir('muver-f19-r11b-reg-');
  const reg2 = path.join(base2, 'projects.json');
  await writeRegistry(reg2, [{ id: 'proy2', name: 'Proy2', path: plain }]);
  const app2 = await startApp({ projectsFile: reg2, password: PASSWORD, env, runner: isolatedRunner(env) });
  apps.push(app2);
  cleanup.push(app2.dataDir);
  const cookie2 = await app2.login();
  const changes2 = await request(app2.baseUrl, '/api/projects/proy2/changes', { cookie: cookie2 });
  assert.equal(changes2.status, 200, changes2.text);
  assert.deepEqual(changes2.json.execConfig, []);
});
