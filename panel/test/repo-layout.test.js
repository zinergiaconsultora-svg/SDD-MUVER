// Tests de lib/repo-layout.js (feature 13, design.md §5.2): clasificación de carpetas en principal / worktree /
// ninguno con `git --no-optional-locks rev-parse --git-dir --git-common-dir` por el runner central de la feature 14,
// caché de 10 min, worktree probable y claves de grupo — F13-R26, F13-R27, F13-R29, F13-R30.
// Repos git reales en temporales con `git worktree add`; nunca un repo del humano.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  classifyRepoLayout,
  createRepoLayoutCache,
  isLikelyWorktree,
  groupKeyFor,
  groupNameFor,
  LAYOUT_TTL_MS,
} from '../lib/repo-layout.js';
import { CMD_REPO_LAYOUT, GIT_COMMANDS, GIT_SAFE_PREFIX, GIT_TIMEOUT_MS, createGitRunner } from '../lib/git-info.js';
import { pathKey } from '../lib/path-key.js';
import { hasGit, makeTempDir, removeDir, makeClock } from './helpers.js';
import { makeRepoWithWorktrees } from './summary-helpers.js';

const gitAvailable = await hasGit();
const skipNoGit = gitAvailable ? false : 'git no está disponible en este sistema';

const cleanup = [];
after(async () => {
  for (const dir of cleanup) await removeDir(dir);
});

const isDir = async () => ({ isDirectory: () => true });
const noDir = async () => {
  throw Object.assign(new Error('no existe'), { code: 'ENOENT' });
};

/** Runner espía que devuelve `stdout` (o lanza `error`) y registra cada llamada. */
function spyRunner({ stdout = '.git\n.git\n', error = null } = {}) {
  const calls = [];
  const runner = async (file, args, opts) => {
    calls.push({ file, args: [...args], opts });
    if (error) throw error;
    return { stdout, stderr: '' };
  };
  return { runner, calls };
}

test('[F13-R26] CMD_REPO_LAYOUT es la última entrada de GIT_COMMANDS', () => {
  assert.deepEqual(CMD_REPO_LAYOUT, ['--no-optional-locks', 'rev-parse', '--git-dir', '--git-common-dir']);
  assert.equal(GIT_COMMANDS.at(-1), CMD_REPO_LAYOUT);
  assert.ok(Object.isFrozen(CMD_REPO_LAYOUT));
});

test('[F13-R26] git real: worktree → worktree con mainPath; principal → main; sin git → none; inexistente → missing', { skip: skipNoGit }, async () => {
  const repo = await makeRepoWithWorktrees(['wt-tarea-a1b2c3']);
  cleanup.push(repo.base);
  const worktree = await classifyRepoLayout(repo.worktrees['wt-tarea-a1b2c3']);
  assert.equal(worktree.kind, 'worktree');
  assert.equal(pathKey(worktree.mainPath), pathKey(repo.main));
  assert.deepEqual(await classifyRepoLayout(repo.main), { kind: 'main' });
  const plain = await makeTempDir('muver-f13-plain-');
  cleanup.push(plain);
  assert.deepEqual(await classifyRepoLayout(plain), { kind: 'none' });
  const spy = spyRunner();
  assert.deepEqual(await classifyRepoLayout(path.join(plain, 'no-existe'), { runner: spy.runner }), { kind: 'missing' });
  assert.equal(spy.calls.length, 0, 'sin git para una carpeta inexistente');
  assert.deepEqual(await classifyRepoLayout(null, { runner: spy.runner }), { kind: 'missing' });
  assert.equal(spy.calls.length, 0);
});

test('[F13-R26] runner espía: nombre lógico git, argumentos exactos, cwd y límite de tiempo', async () => {
  const spy = spyRunner({ stdout: '/r/main/.git/worktrees/x\n/r/main/.git\n' });
  const result = await classifyRepoLayout('/r/x', { runner: spy.runner, statFn: isDir });
  assert.deepEqual(result, { kind: 'worktree', mainPath: '/r/main' });
  assert.equal(spy.calls.length, 1);
  const [call] = spy.calls;
  assert.equal(call.file, 'git');
  assert.deepEqual(call.args, ['--no-optional-locks', 'rev-parse', '--git-dir', '--git-common-dir']);
  assert.equal(call.opts.cwd, '/r/x');
  assert.equal(call.opts.timeout, GIT_TIMEOUT_MS);
  assert.equal(call.opts.windowsHide, true);
});

test('[F13-R26] createGitRunner con execFileImpl espía: argv con GIT_SAFE_PREFIX delante, git del resolvedor y sin consultar filtros', async () => {
  const resolveCalls = [];
  const resolver = {
    resolve(name, opts) {
      resolveCalls.push({ name, cwd: opts && opts.cwd });
      return { ok: true, file: '/usr/bin/git', prefixArgs: [] };
    },
    isTrustedPath: () => true,
  };
  const execCalls = [];
  const execFileImpl = (file, argv, opts, cb) => {
    execCalls.push({ file, argv, opts });
    cb(null, '.git\n.git\n', '');
  };
  const runner = createGitRunner({ resolver, execFileImpl, platform: 'linux' });
  const result = await classifyRepoLayout('/proyecto/principal', { runner, statFn: isDir });
  assert.deepEqual(result, { kind: 'main' });
  assert.deepEqual(resolveCalls, [{ name: 'git', cwd: '/proyecto/principal' }]);
  assert.equal(execCalls.length, 1, 'una sola llamada: rev-parse no es status/diff, no se consultan filtros locales');
  assert.equal(execCalls[0].file, '/usr/bin/git');
  assert.deepEqual(execCalls[0].argv, [...GIT_SAFE_PREFIX, '--no-optional-locks', 'rev-parse', '--git-dir', '--git-common-dir']);
  assert.equal(execCalls[0].opts.shell, false);
  assert.equal(execCalls[0].opts.cwd, '/proyecto/principal');
});

test('[F13-R26] salida de git en Windows (C:/…): worktree con mainPath Windows; .git relativo → main', async () => {
  const wt = spyRunner({ stdout: 'C:/Users/u/CRM RAPIDO/.git/worktrees/audit-41fbca\r\nC:/Users/u/CRM RAPIDO/.git\r\n' });
  const result = await classifyRepoLayout('C:\\Users\\u\\.claude\\worktrees\\audit-41fbca', { runner: wt.runner, statFn: isDir });
  assert.equal(result.kind, 'worktree');
  assert.equal(pathKey(result.mainPath), pathKey('C:\\Users\\u\\CRM RAPIDO'));
  const main = spyRunner({ stdout: '.git\n.git\n' });
  assert.deepEqual(await classifyRepoLayout('C:\\Users\\u\\CRM RAPIDO', { runner: main.runner, statFn: isDir }), { kind: 'main' });
  const bare = spyRunner({ stdout: '/srv/x/.git/worktrees/w\n/srv/repo-bare\n' });
  assert.deepEqual(await classifyRepoLayout('/srv/w', { runner: bare.runner, statFn: isDir }), { kind: 'worktree', mainPath: '/srv/repo-bare' });
  const short = spyRunner({ stdout: '.git\n' });
  assert.deepEqual(await classifyRepoLayout('/srv/w', { runner: short.runner, statFn: isDir }), { kind: 'none' }, 'menos de dos líneas');
  const failing = spyRunner({ error: Object.assign(new Error('no es repo'), { code: 128 }) });
  assert.deepEqual(await classifyRepoLayout('/srv/w', { runner: failing.runner, statFn: isDir }), { kind: 'none' });
});

test('[F13-R27] createRepoLayoutCache: 10 min de caché, sin git para una carpeta inexistente', async () => {
  assert.equal(LAYOUT_TTL_MS, 600000);
  const clock = makeClock(Date.parse('2026-10-25T10:00:00Z'));
  const spy = spyRunner();
  let exists = true;
  const statFn = async (dir) => (exists ? { isDirectory: () => true } : noDir(dir));
  const cache = createRepoLayoutCache({ runner: spy.runner, now: clock.now, statFn });
  assert.deepEqual(await cache.get('/r/a'), { kind: 'main' });
  assert.equal(spy.calls.length, 1);
  clock.advance(9 * 60000);
  assert.deepEqual(await cache.get('/r/a/'), { kind: 'main' }, 'misma clave de ruta');
  assert.equal(spy.calls.length, 1, 'a los 9 min, sin llamadas');
  clock.advance(60000 + 1000);
  await cache.get('/r/a');
  assert.equal(spy.calls.length, 2, 'a los 10 min 1 s, una llamada');
  exists = false;
  assert.deepEqual(await cache.get('/r/b'), { kind: 'missing' });
  assert.deepEqual(await cache.get('/r/a'), { kind: 'missing' }, 'la existencia se comprueba siempre');
  assert.equal(spy.calls.length, 2, 'carpeta inexistente: cero llamadas');
  exists = true;
  const [x, y] = await Promise.all([cache.get('/r/c'), cache.get('/r/c')]);
  assert.deepEqual(x, y);
  assert.equal(spy.calls.length, 3, 'peticiones simultáneas deduplicadas');
});

test('[F13-R30] isLikelyWorktree: nombre -hex6 y sesión en claude/<carpeta>', () => {
  const merged = (p, branch) => ({ path: p, claude: { sessions: [{ id: 's1', gitBranch: branch }] } });
  assert.equal(isLikelyWorktree(merged('/home/u/.claude/worktrees/audit-y-medianoche-41fbca', 'claude/audit-y-medianoche-41fbca')), true);
  assert.equal(isLikelyWorktree(merged('C:\\Users\\u\\audit-y-medianoche-41fbca', 'claude/audit-y-medianoche-41fbca')), true);
  assert.equal(isLikelyWorktree(merged('/home/u/audit-y-medianoche-41fbca', 'main')), false);
  assert.equal(isLikelyWorktree(merged('/home/u/mi-app', 'claude/mi-app')), false);
  assert.equal(isLikelyWorktree({ path: '/home/u/x-41fbca', claude: null }), false);
  assert.equal(isLikelyWorktree({ path: null, claude: { sessions: [] } }), false);
});

test('[F13-R29] groupKeyFor y groupNameFor', () => {
  const key = groupKeyFor('/home/u/CRM RAPIDO');
  assert.match(key, /^g-[0-9a-f]{10}$/);
  assert.equal(groupKeyFor('/home/u/CRM RAPIDO/'), key, 'misma clave de ruta');
  assert.notEqual(groupKeyFor('/home/u/otro'), key);
  assert.equal(groupKeyFor('C:\\Users\\U\\CRM'), groupKeyFor('c:/users/u/crm'), 'Windows sin distinguir mayúsculas');
  assert.equal(groupNameFor('/home/u/CRM RAPIDO'), 'CRM RAPIDO');
  assert.equal(groupNameFor('/srv/repo.git'), 'repo');
  assert.equal(groupNameFor('C:\\srv\\Repo.GIT'), 'Repo');
  assert.ok(!key.includes('home'), 'la clave no contiene la ruta');
});
