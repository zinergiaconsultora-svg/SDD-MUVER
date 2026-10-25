// Tests unitarios de lib/git-actions.js — F4: R55 (parsePorcelainZ), R59 y R60 (planCommitPush) y R60 (estático).
// Feature 14: F14-R21 (prefijo en los pasos), F14-R23 (diff literal sin drivers), F14-R24 (hooks), F14-R25
// (estático sin --no-verify) y F14-R26 (push con BatchMode). Ajuste declarado (design.md §8.3) de [F4-R60]/[F4-R58].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { GIT_ACTION_ARGS, GIT_STEP_ENV, parsePorcelainZ, planCommitPush, getFileDiff, listActiveHooks, listRepoConfigRisks } from '../lib/git-actions.js';
import { PANEL_DIR } from './helpers.js';

test('[F4-R55] parsePorcelainZ: modificado, nuevo, renombrado (salta el origen) y nombres con espacios', () => {
  const stdout = ' M src/a.js\0?? nuevo.txt\0R  nombre nuevo.txt\0viejo.txt\0A  carpeta/ñandú café.txt\0C  copia.txt\0orig.txt\0';
  assert.deepEqual(parsePorcelainZ(stdout), [
    { path: 'src/a.js', status: ' M' },
    { path: 'nuevo.txt', status: '??' },
    { path: 'nombre nuevo.txt', status: 'R ' },
    { path: 'carpeta/ñandú café.txt', status: 'A ' },
    { path: 'copia.txt', status: 'C ' },
  ]);
  assert.deepEqual(parsePorcelainZ(''), []);
});

/** Runner falso: responde a cada lista de argumentos de GIT_ACTION_ARGS. */
function fakeRunner({ status = ' M a.js\0', branch = 'main', upstream = true, calls = [] } = {}) {
  return async (file, args, opts) => {
    calls.push({ file, args, opts });
    const key = JSON.stringify(args);
    if (key === JSON.stringify(GIT_ACTION_ARGS.isRepo)) return { stdout: 'true\n' };
    if (key === JSON.stringify(GIT_ACTION_ARGS.status)) return { stdout: status };
    if (key === JSON.stringify(GIT_ACTION_ARGS.branch)) return { stdout: `${branch}\n` };
    if (key === JSON.stringify(GIT_ACTION_ARGS.hasHead)) return { stdout: 'abc\n' };
    if (key === JSON.stringify(GIT_ACTION_ARGS.upstream)) {
      if (upstream) return { stdout: 'origin/main\n' };
      throw Object.assign(new Error('sin upstream'), { code: 128 });
    }
    throw new Error(`argumentos inesperados: ${args.join(' ')}`);
  };
}

test('[F4-R60] planCommitPush: el mensaje "--amend; rm -rf /" llega intacto como un único argumento tras -m', async () => {
  const calls = [];
  const plan = await planCommitPush('/repo', '--amend; rm -rf /', { runner: fakeRunner({ calls }), env: {} });
  assert.equal(plan.ok, true);
  // Feature 14 (ajuste declarado, design.md §8.3): los pasos empiezan por el prefijo de seguridad (corrección revisión
  // F14: -c core.fsmonitor=false -c log.showSignature=false).
  assert.deepEqual(plan.steps.map((s) => [s.file, ...s.args]), [
    ['git', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '--no-optional-locks', 'add', '-A'],
    ['git', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '--no-optional-locks', 'commit', '-m', '--amend; rm -rf /'],
    ['git', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '--no-optional-locks', 'push'],
  ]);
  for (const step of plan.steps.slice(0, 2)) assert.deepEqual(step.env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
  // Feature 14 (ajuste declarado): el push lleva además GIT_SSH_COMMAND con BatchMode.
  assert.deepEqual(plan.steps[2].env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });
  assert.equal(plan.display, 'git add -A → git commit -m "--amend; rm -rf /" → git push');
  for (const call of calls) {
    assert.equal(call.file, 'git');
    assert.equal(call.args[0], '--no-optional-locks');
    assert.equal(call.opts.cwd, '/repo');
  }
});

test('[F4-R58] planCommitPush sin upstream → push -u origin <rama>', async () => {
  const plan = await planCommitPush('/repo', 'Mensaje', { runner: fakeRunner({ upstream: false, branch: 'feature/x' }) });
  assert.deepEqual(plan.steps[2].args, ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '--no-optional-locks', 'push', '-u', 'origin', 'feature/x']); // ajuste declarado F14 (y corrección revisión F14)
  assert.equal(plan.display, 'git add -A → git commit -m "Mensaje" → git push -u origin feature/x');
});

test('[F4-R59] planCommitPush: mensaje vacío, largo o con NUL; sin cambios; HEAD separado o rama rara', async () => {
  const runner = fakeRunner();
  const cases = [
    [undefined, 400, 'Escribe el mensaje del commit'],
    ['   ', 400, 'Escribe el mensaje del commit'],
    ['a\0b', 400, 'Escribe el mensaje del commit'],
    ['x'.repeat(2001), 400, 'El mensaje del commit supera los 2000 caracteres'],
  ];
  for (const [message, status, error] of cases) {
    const r = await planCommitPush('/repo', message, { runner });
    assert.deepEqual(r, { ok: false, status, error, field: 'message' }, String(message).slice(0, 20));
  }
  assert.equal((await planCommitPush('/repo', 'x'.repeat(2000), { runner })).ok, true);
  assert.deepEqual(await planCommitPush('/repo', 'ok', { runner: fakeRunner({ status: '' }) }), { ok: false, status: 409, error: 'No hay cambios que commitear' });
  assert.deepEqual(await planCommitPush('/repo', 'ok', { runner: fakeRunner({ branch: 'HEAD' }) }), { ok: false, status: 409, error: 'No se puede hacer push sin rama (HEAD separado)' });
  assert.deepEqual(await planCommitPush('/repo', 'ok', { runner: fakeRunner({ branch: '-rara' }) }), { ok: false, status: 409, error: 'No se puede hacer push sin rama (HEAD separado)' });
});

test('[F4-R57] getFileDiff con un fichero que no está en la lista no ejecuta git diff', async () => {
  const calls = [];
  for (const file of ['../secreto.txt', 'otro.js', undefined, '']) {
    const r = await getFileDiff('/repo', file, { runner: fakeRunner({ calls }) });
    assert.deepEqual(r, { ok: false, status: 400, error: 'El fichero no está en la lista de cambios' });
  }
  assert.ok(!calls.some((c) => c.args.includes('diff') && c.args.includes('--')), 'no se llamó a git diff -- <ruta>');
});

test('[F4-R60] estático: git-actions.js solo usa argumentos fijos, sin forzar nunca el push', async () => {
  const source = await fs.readFile(path.join(PANEL_DIR, 'lib', 'git-actions.js'), 'utf8');
  assert.ok(!source.includes('--force'), 'sin --force');
  assert.ok(!source.includes('--force-with-lease'));
  assert.ok(!/['"]-f['"]/.test(source), 'sin -f como argumento');
  assert.ok(!/['"]\+[A-Za-z]/.test(source), 'sin refspecs forzados (+rama)');
  assert.ok(!/shell:\s*true/.test(source));
  for (const args of Object.values(GIT_ACTION_ARGS)) {
    assert.equal(args[0], '--no-optional-locks');
    assert.ok(Object.isFrozen(args));
  }
});

// ---------- Feature 14 ----------

test('[F14-R23] GIT_ACTION_ARGS: diff con --literal-pathspecs, --no-ext-diff y --no-textconv; stat sin drivers; hooksDir y hooksPathConfig', () => {
  assert.deepEqual(GIT_ACTION_ARGS.diffHead, ['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
  assert.deepEqual(GIT_ACTION_ARGS.diffWorktree, ['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--']);
  assert.deepEqual(GIT_ACTION_ARGS.statHead, ['--no-optional-locks', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--stat']);
  assert.deepEqual(GIT_ACTION_ARGS.statCached, ['--no-optional-locks', 'diff', '--no-ext-diff', '--no-textconv', '--cached', '--stat']);
  assert.deepEqual(GIT_ACTION_ARGS.hooksDir, ['--no-optional-locks', 'rev-parse', '--git-path', 'hooks']);
  assert.deepEqual(GIT_ACTION_ARGS.hooksPathConfig, ['--no-optional-locks', 'config', '--get', 'core.hooksPath']);
});

test('[F14-R23] getFileDiff de un fichero llamado "*" usa la lista literal (la ruta va tras --)', async () => {
  const calls = [];
  const runner = async (file, args, opts) => {
    calls.push(args);
    const base = fakeRunner({ status: ' M *\0 M b.txt\0' });
    if (args.includes('diff') && args.includes('--') && !args.includes('--stat')) return { stdout: 'diff --git a/* b/*\n' };
    if (args.includes('--stat')) return { stdout: '' };
    return base(file, args, opts);
  };
  const r = await getFileDiff('/repo', '*', { runner });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.find((a) => a.includes('--literal-pathspecs')), [...GIT_ACTION_ARGS.diffHead, '*']);
});

test('[F14-R21][F14-R26] planCommitPush: los tres pasos con prefijo, display sin cambios y GIT_SSH_COMMAND solo en el push', async () => {
  const plan = await planCommitPush('/repo', 'Mensaje', { runner: fakeRunner(), env: {} });
  for (const step of plan.steps) assert.deepEqual(step.args.slice(0, 4), ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false']);
  assert.equal(plan.display, 'git add -A → git commit -m "Mensaje" → git push', 'display sin el prefijo');
  assert.deepEqual(plan.steps.map((s) => s.display), ['git add -A', 'git commit -m "Mensaje"', 'git push']);
  assert.deepEqual(plan.steps[0].env, { ...GIT_STEP_ENV });
  assert.deepEqual(plan.steps[1].env, { ...GIT_STEP_ENV });
  assert.equal(plan.steps[2].env.GIT_SSH_COMMAND, 'ssh -o BatchMode=yes');
  for (const step of plan.steps) {
    assert.equal(step.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(step.env.GCM_INTERACTIVE, 'never');
  }
  assert.ok(!('GIT_SSH_COMMAND' in plan.steps[0].env) && !('GIT_SSH_COMMAND' in plan.steps[1].env));
});

test('[F14-R26] planCommitPush respeta GIT_SSH_COMMAND o GIT_SSH del entorno del panel (no los toca)', async () => {
  for (const env of [{ GIT_SSH_COMMAND: 'ssh -i k' }, { GIT_SSH: 'plink' }]) {
    const plan = await planCommitPush('/repo', 'Mensaje', { runner: fakeRunner(), env });
    assert.deepEqual(plan.steps[2].env, { ...GIT_STEP_ENV }, JSON.stringify(env));
  }
  for (const env of [{ GIT_SSH_COMMAND: '' }, { GIT_SSH: '  ' }]) {
    const plan = await planCommitPush('/repo', 'Mensaje', { runner: fakeRunner(), env });
    assert.equal(plan.steps[2].env.GIT_SSH_COMMAND, 'ssh -o BatchMode=yes', 'vacíos no cuentan');
  }
});

test('[F14-R24] listActiveHooks: carpeta efectiva, sin .sample, nombres válidos, orden alfabético, máximo 20 y core.hooksPath', async () => {
  const entry = (name, kind = 'file') => ({ name, isFile: () => kind === 'file', isSymbolicLink: () => kind === 'link' });
  const runner = (hooksPath) => async (file, args) => {
    if (JSON.stringify(args) === JSON.stringify(GIT_ACTION_ARGS.hooksDir)) return { stdout: '.git/hooks\n' };
    if (JSON.stringify(args) === JSON.stringify(GIT_ACTION_ARGS.hooksPathConfig)) {
      if (hooksPath) return { stdout: `${hooksPath}\n` };
      throw Object.assign(new Error('sin valor'), { code: 1 });
    }
    throw new Error(`inesperado: ${args.join(' ')}`);
  };
  const seen = [];
  const readdir = async (dir, opts) => {
    seen.push([dir, opts]);
    return [entry('pre-push'), entry('pre-commit.sample'), entry('pre-commit'), entry('post-merge', 'link'), entry('carpeta', 'dir'), entry('mal nombre'), entry('<script>')];
  };
  const r = await listActiveHooks('/repo', { runner: runner(null), readdir });
  assert.deepEqual(r, { hooks: ['post-merge', 'pre-commit', 'pre-push'], hooksPathCustom: false });
  assert.equal(seen[0][0], path.resolve('/repo', '.git/hooks'));
  assert.equal(seen[0][1].withFileTypes, true);
  const custom = await listActiveHooks('/repo', { runner: runner('ganchos'), readdir });
  assert.equal(custom.hooksPathCustom, true);
  const many = await listActiveHooks('/repo', { runner: runner(null), readdir: async () => Array.from({ length: 30 }, (_, i) => entry(`h${String(i).padStart(2, '0')}`)) });
  assert.equal(many.hooks.length, 20);
  assert.equal(many.hooks[0], 'h00');
  const broken = await listActiveHooks('/repo', { runner: runner(null), readdir: async () => { throw new Error('ENOENT'); } });
  assert.deepEqual(broken, { hooks: [], hooksPathCustom: false });
});

test('[F14-R25] estático: git-actions.js no desactiva los hooks (sin --no-verify ni core.hooksPath vacío)', async () => {
  const source = await fs.readFile(path.join(PANEL_DIR, 'lib', 'git-actions.js'), 'utf8');
  assert.ok(!source.includes('--no-verify'), 'sin --no-verify');
  assert.ok(!source.includes('core.hooksPath='), 'sin -c core.hooksPath=');
});

// ---------- Corrección revisión F14 (M3): configuración del repo que se ejecuta en "Commit y push" ----------

test('[F14-R36] listRepoConfigRisks: commit.gpgsign, core.sshCommand, core.askPass, credential.helper, receivepack y filtros (config local y .gitattributes)', async () => {
  assert.equal(GIT_ACTION_ARGS.repoConfigRisks[0], '--no-optional-locks');
  assert.ok(GIT_ACTION_ARGS.repoConfigRisks.includes('--local'));
  const config = [
    'commit.gpgsign true', 'core.sshcommand ssh -i x', 'core.askpass /tmp/a.sh', 'credential.helper store',
    'remote.origin.receivepack /tmp/r.sh', 'filter.marca.clean /tmp/m.sh', 'filter.marca.required true',
  ].join('\n');
  const runner = async (file, args) => {
    if (JSON.stringify(args) === JSON.stringify(GIT_ACTION_ARGS.repoConfigRisks)) return { stdout: config + '\n' };
    throw new Error('inesperado');
  };
  const readFile = async (f) => {
    if (f === path.resolve('/repo', '.gitattributes')) return '*.bin filter=lfs diff=lfs\n# filter=comentario\n*.x filter=marca\n';
    throw Object.assign(new Error('no'), { code: 'ENOENT' });
  };
  const risks = await listRepoConfigRisks('/repo', { runner, readFile });
  assert.deepEqual(risks, { gpgSign: true, sshCommand: true, askPass: true, credentialHelper: true, receivePack: true, filters: ['lfs', 'marca'] });
  const none = await listRepoConfigRisks('/repo', { runner: async () => { throw Object.assign(new Error('sin valores'), { code: 1 }); }, readFile });
  assert.deepEqual(none, { gpgSign: false, sshCommand: false, askPass: false, credentialHelper: false, receivePack: false, filters: ['lfs', 'marca'] });
  const off = await listRepoConfigRisks('/repo', { runner: async () => ({ stdout: 'commit.gpgsign false\n' }), readFile: async () => '' });
  assert.equal(off.gpgSign, false);
});
