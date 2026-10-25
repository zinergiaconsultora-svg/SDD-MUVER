// Tests unitarios de lib/git-actions.js — F4: R55 (parsePorcelainZ), R59 y R60 (planCommitPush) y R60 (estático).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { GIT_ACTION_ARGS, parsePorcelainZ, planCommitPush, getFileDiff } from '../lib/git-actions.js';
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
  const plan = await planCommitPush('/repo', '--amend; rm -rf /', { runner: fakeRunner({ calls }) });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((s) => [s.file, ...s.args]), [
    ['git', '--no-optional-locks', 'add', '-A'],
    ['git', '--no-optional-locks', 'commit', '-m', '--amend; rm -rf /'],
    ['git', '--no-optional-locks', 'push'],
  ]);
  for (const step of plan.steps) assert.deepEqual(step.env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
  assert.equal(plan.display, 'git add -A → git commit -m "--amend; rm -rf /" → git push');
  for (const call of calls) {
    assert.equal(call.file, 'git');
    assert.equal(call.args[0], '--no-optional-locks');
    assert.equal(call.opts.cwd, '/repo');
  }
});

test('[F4-R58] planCommitPush sin upstream → push -u origin <rama>', async () => {
  const plan = await planCommitPush('/repo', 'Mensaje', { runner: fakeRunner({ upstream: false, branch: 'feature/x' }) });
  assert.deepEqual(plan.steps[2].args, ['--no-optional-locks', 'push', '-u', 'origin', 'feature/x']);
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
