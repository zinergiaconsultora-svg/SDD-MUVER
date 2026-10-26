// Tests de lib/git-info.js — R2, R9, R10, R12; fase 4: F4-R61 (mejora M4: --no-optional-locks en status);
// feature 14: F14-R7, F14-R13 y F14-R21 (runner de git central con resolvedor, prefijo y entorno de Windows).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GIT_COMMANDS, GIT_SAFE_PREFIX, EXEC_CONFIG_RE, FILTER_NAME_RE, filterOverrideArgs, readRepoExecConfig, getGitInfo, createGitRunner } from '../lib/git-info.js';
import { createBinaryResolver, BIN_ERRORS } from '../lib/trusted-bin.js';
import { makeProjectDir, makeTempDir, hasGit, removeDir } from './helpers.js';

const gitAvailable = await hasGit();
const skipNoGit = gitAvailable ? false : 'git no está disponible en este sistema';

const ABSENT = { isRepo: false, branch: null, lastCommit: null, dirtyCount: null, recentCommits: [], dirtyFiles: [] };

test('[R9] repo con 1 commit y 1 fichero sin añadir', { skip: skipNoGit }, async () => {
  const dir = await makeProjectDir({ git: { commits: ['Primer commit'], dirtyFile: 'nuevo.txt' } });
  const info = await getGitInfo(dir);
  assert.equal(info.isRepo, true);
  assert.equal(info.branch, 'main');
  assert.match(info.lastCommit.hash, /^[0-9a-f]{40}$/);
  assert.ok(!Number.isNaN(Date.parse(info.lastCommit.date)), 'fecha parseable');
  assert.equal(info.lastCommit.message, 'Primer commit');
  assert.equal(info.dirtyCount, 1);
  await removeDir(dir);
});

test('[R2] detalle con 2 commits devuelve recentCommits y dirtyFiles', { skip: skipNoGit }, async () => {
  const dir = await makeProjectDir({ git: { commits: ['Uno', 'Dos'], dirtyFile: 'cambio.txt' } });
  const info = await getGitInfo(dir, { detail: true });
  assert.equal(info.recentCommits.length, 2);
  assert.deepEqual(info.recentCommits.map((c) => c.message), ['Dos', 'Uno']);
  assert.equal(info.recentCommits[0].hash, info.lastCommit.hash);
  assert.deepEqual(info.dirtyFiles, ['cambio.txt']);
  await removeDir(dir);
});

test('[R10] repo sin commits → isRepo true y lastCommit null', { skip: skipNoGit }, async () => {
  const dir = await makeProjectDir({ git: { commits: [] } });
  const info = await getGitInfo(dir, { detail: true });
  assert.equal(info.isRepo, true);
  assert.equal(info.lastCommit, null);
  assert.deepEqual(info.recentCommits, []);
  assert.equal(info.dirtyCount, 0);
  await removeDir(dir);
});

test('[R10] directorio sin .git → forma ausente', { skip: skipNoGit }, async () => {
  const dir = await makeTempDir();
  const info = await getGitInfo(dir, { detail: true });
  assert.equal(info.isRepo, false);
  assert.equal(info.branch, null);
  assert.equal(info.lastCommit, null);
  assert.equal(info.dirtyCount, null);
  assert.deepEqual(info.recentCommits, []);
  await removeDir(dir);
});

test('[R10] runner que falla con ENOENT → forma ausente sin lanzar', async () => {
  const runner = async () => {
    const err = new Error('spawn git ENOENT');
    err.code = 'ENOENT';
    throw err;
  };
  const info = await getGitInfo('/cualquier/dir', { runner, detail: true });
  assert.deepEqual(info, ABSENT);
});

test('[R12] runner espía: binario git, argumentos permitidos, cwd y timeout 5000', async () => {
  const calls = [];
  const allowed = new Set(GIT_COMMANDS.map((args) => JSON.stringify(args)));
  const runner = async (file, args, opts) => {
    calls.push({ file, args, opts });
    const key = JSON.stringify(args);
    if (key === JSON.stringify(['rev-parse', '--is-inside-work-tree'])) return { stdout: 'true\n' };
    if (key === JSON.stringify(['rev-parse', '--abbrev-ref', 'HEAD'])) return { stdout: 'main\n' };
    if (args[0] === 'log') return { stdout: `${'a'.repeat(40)}\x1f2026-10-20T17:03:11+02:00\x1fMensaje\n` };
    // F4-R61 + feature 19 (§3.4): el estado se consulta con --no-optional-locks y --ignore-submodules=dirty.
    if (key === JSON.stringify(['--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=dirty'])) return { stdout: ' M src/app.js\n?? nuevo.txt\n' };
    throw new Error('argumentos inesperados');
  };
  const dir = '/ruta/del/proyecto';
  const info = await getGitInfo(dir, { runner, detail: true });
  assert.ok(calls.length >= 4);
  for (const call of calls) {
    assert.equal(call.file, 'git');
    assert.ok(allowed.has(JSON.stringify(call.args)), `argumentos no permitidos: ${call.args.join(' ')}`);
    assert.equal(call.opts.cwd, dir);
    assert.equal(call.opts.timeout, 5000);
  }
  assert.equal(info.branch, 'main');
  assert.equal(info.dirtyCount, 2);
  assert.deepEqual(info.dirtyFiles, ['src/app.js', 'nuevo.txt']);
  assert.equal(info.lastCommit.date, '2026-10-20T17:03:11+02:00');
});

test('[R12][F4-R61] GIT_COMMANDS es la lista cerrada documentada en design.md (status con --no-optional-locks)', () => {
  // Feature 19 (§3.4, cambio declarado design.md §7.3): status con --ignore-submodules=dirty y las dos lecturas de config.
  assert.deepEqual(GIT_COMMANDS, [
    ['rev-parse', '--is-inside-work-tree'],
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['log', '-1', '--format=%H%x1f%cI%x1f%s'],
    ['log', '-10', '--format=%H%x1f%cI%x1f%s'],
    ['--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=dirty'],
    ['--no-optional-locks', 'config', '--show-scope', '--name-only', '--get-regexp', EXEC_CONFIG_RE],
    ['--no-optional-locks', 'config', '--name-only', '--get-regexp', EXEC_CONFIG_RE],
  ]);
});

test('[F4-R61] getGitInfo ejecuta git --no-optional-locks status --porcelain y nunca status sin esa opción', async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push(args);
    if (args.includes('--is-inside-work-tree')) return { stdout: 'true\n' };
    if (args.includes('--abbrev-ref')) return { stdout: 'main\n' };
    if (args[0] === 'log') return { stdout: '' };
    return { stdout: '' };
  };
  await getGitInfo('/x', { runner });
  const statusCalls = calls.filter((a) => a.includes('status'));
  // Feature 19 (cambio declarado §7.3): el status lleva --ignore-submodules=dirty.
  assert.deepEqual(statusCalls, [['--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=dirty']]);
});

// ---------- Feature 14: runner de git central (R7, R13, R21) ----------

/** Resolvedor de prueba: git en /usr/bin (y en la carpeta del proyecto, que debe descartarse). */
function testResolver({ platform = 'linux', files = ['/srv/p/git', '/usr/bin/git'], PATH = '/srv/p:/usr/bin' } = {}) {
  const set = new Set(files);
  return createBinaryResolver({ platform, env: { PATH }, homeDir: '/home/u', fsOps: { isFile: (f) => set.has(f), isExecutable: () => true, realpath: (f) => (set.has(f) ? f : null) } });
}

function spyExecFile(calls, result = { stdout: 'true\n', stderr: '' }) {
  return (file, args, opts, callback) => {
    calls.push({ file, args, opts });
    setImmediate(() => callback(null, result.stdout, result.stderr));
    return {};
  };
}

test('[F14-R7][F14-R21] createGitRunner: ruta absoluta del resolvedor, prefijo -c core.fsmonitor=false, cwd y sin shell', async () => {
  // Feature 19 (§3.1, cambio declarado §7.3): el prefijo añade log.showSignature=false y protocol.ext.allow=never;
  // los dos primeros elementos siguen siendo -c core.fsmonitor=false.
  assert.deepEqual(GIT_SAFE_PREFIX, ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-c', 'protocol.ext.allow=never']);
  assert.ok(Object.isFrozen(GIT_SAFE_PREFIX));
  const calls = [];
  const runner = createGitRunner({ resolver: testResolver(), execFileImpl: spyExecFile(calls), platform: 'linux' });
  const out = await runner('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: '/srv/p', timeout: 5000 });
  assert.equal(out.stdout, 'true\n');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, '/usr/bin/git', 'nunca el git de la carpeta del proyecto');
  assert.deepEqual(calls[0].args, ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-c', 'protocol.ext.allow=never', '--no-optional-locks', 'status', '--porcelain']);
  assert.equal(calls[0].opts.cwd, '/srv/p');
  assert.equal(calls[0].opts.timeout, 5000);
  assert.equal(calls[0].opts.shell, false);
  // Feature 19 (§3.5, cambio declarado §7.3): el entorno es process.env más GIT_NO_LAZY_FETCH=1 (antes en Linux no se añadía).
  assert.equal(calls[0].opts.env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(calls[0].opts.env.PATH, process.env.PATH, 'parte de process.env sin env explícito');
  // (La distinción linux/win32 de NoDefaultCurrentDirectoryInExePath se comprueba en [F14-R13] con un env explícito.)
  const info = await getGitInfo('/srv/p', { runner });
  assert.equal(info.isRepo, true);
  assert.ok(calls.every((c) => c.args[0] === '-c' && c.args[1] === 'core.fsmonitor=false'), 'todas las consultas de getGitInfo llevan el prefijo');
});

test('[F14-R7] createGitRunner rechaza cualquier programa que no sea git y los fallos de resolución, sin llamar a execFile', async () => {
  const calls = [];
  const runner = createGitRunner({ resolver: testResolver(), execFileImpl: spyExecFile(calls), platform: 'linux' });
  for (const file of ['node', '/usr/bin/git', 'git.exe', 'bash']) {
    await assert.rejects(runner(file, ['--version'], { cwd: '/srv/p' }), (err) => err.code === 'EUNTRUSTED' && err.message === BIN_ERRORS.untrusted(file.split('/').pop()), file);
  }
  const onlyInProject = createGitRunner({ resolver: testResolver({ files: ['/srv/p/git'] }), execFileImpl: spyExecFile(calls), platform: 'linux' });
  await assert.rejects(onlyInProject('git', ['status'], { cwd: '/srv/p' }), (err) => err.code === 'ENOTFOUND_BIN' && err.message === BIN_ERRORS.onlyInProject('git'));
  const notFound = createGitRunner({ resolver: testResolver({ files: [] }), execFileImpl: spyExecFile(calls), platform: 'linux' });
  await assert.rejects(notFound('git', ['status'], { cwd: '/srv/p' }), (err) => err.message === BIN_ERRORS.notFound('git'));
  const lying = { resolve: () => ({ ok: true, file: '/srv/p/git', prefixArgs: [] }), isTrustedPath: (f, o) => testResolver().isTrustedPath(f, o) };
  const guarded = createGitRunner({ resolver: lying, execFileImpl: spyExecFile(calls), platform: 'linux' });
  await assert.rejects(guarded('git', ['status'], { cwd: '/srv/p' }), (err) => err.code === 'EUNTRUSTED');
  assert.equal(calls.length, 0, 'execFile no se llamó nunca');
  assert.deepEqual(await getGitInfo('/srv/p', { runner: notFound, detail: true }), ABSENT, 'git no encontrado → forma ausente');
});

test('[F14-R13] createGitRunner en win32 añade NoDefaultCurrentDirectoryInExePath=1 al entorno sin cambiar el resto', async () => {
  const calls = [];
  const resolver = testResolver({ platform: 'win32', files: ['C:\\Git\\cmd\\git.exe'], PATH: 'C:\\Git\\cmd' });
  const runner = createGitRunner({ resolver, execFileImpl: spyExecFile(calls), platform: 'win32' });
  await runner('git', ['status'], { cwd: 'C:\\p', env: { A: '1', GIT_TERMINAL_PROMPT: '0' } });
  assert.equal(calls[0].file, 'C:\\Git\\cmd\\git.exe');
  // Feature 19 (§3.5, cambio declarado §7.3): además de NoDefaultCurrentDirectoryInExePath se añade GIT_NO_LAZY_FETCH=1.
  assert.deepEqual(calls[0].opts.env, { A: '1', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', NoDefaultCurrentDirectoryInExePath: '1' });
  await runner('git', ['status'], { cwd: 'C:\\p' });
  assert.equal(calls[1].opts.env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(calls[1].opts.env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(calls[1].opts.env.PATH, process.env.PATH, 'sin env explícito se parte de process.env');
  const linuxCalls = [];
  await createGitRunner({ resolver: testResolver(), execFileImpl: spyExecFile(linuxCalls), platform: 'linux' })('git', ['status'], { cwd: '/srv/p', env: { A: '1' } });
  // Feature 19 (§3.5): en Linux el entorno recibido se conserva y solo se añade GIT_NO_LAZY_FETCH=1.
  assert.deepEqual(linuxCalls[0].opts.env, { A: '1', GIT_NO_LAZY_FETCH: '1' });
});

test('[F14-R7] createGitRunner: un fallo de execFile llega como rechazo con stdout/stderr (getGitInfo lo trata como hoy)', async () => {
  const failing = (file, args, opts, callback) => {
    setImmediate(() => callback(Object.assign(new Error('fallo'), { code: 128 }), '', 'fatal: not a git repository'));
    return {};
  };
  const runner = createGitRunner({ resolver: testResolver(), execFileImpl: failing, platform: 'linux' });
  await assert.rejects(runner('git', ['status'], { cwd: '/srv/p' }), (err) => err.code === 128 && err.stderr === 'fatal: not a git repository');
  assert.deepEqual(await getGitInfo('/srv/p', { runner }), ABSENT);
});

// ---------- Feature 19: configuración de git sin ejecución en las lecturas ----------

test('[F19-R1] GIT_SAFE_PREFIX es la constante congelada exacta y el runner la antepone entera', async () => {
  assert.deepEqual([...GIT_SAFE_PREFIX], ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-c', 'protocol.ext.allow=never']);
  assert.ok(Object.isFrozen(GIT_SAFE_PREFIX));
  const calls = [];
  const runner = createGitRunner({ resolver: testResolver(), execFileImpl: spyExecFile(calls), platform: 'linux' });
  await runner('git', ['--no-optional-locks', 'status'], { cwd: '/srv/p' });
  assert.deepEqual(calls[0].args.slice(0, 6), ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-c', 'protocol.ext.allow=never']);
});

test('[F19-R2] createGitRunner: entorno con GIT_NO_LAZY_FETCH en linux y win32, conserva lo recibido, NoDefault solo en win32', async () => {
  const linux = [];
  await createGitRunner({ resolver: testResolver(), execFileImpl: spyExecFile(linux), platform: 'linux' })('git', ['status'], { cwd: '/srv/p', env: { MIA: 'z' } });
  assert.deepEqual(linux[0].opts.env, { MIA: 'z', GIT_NO_LAZY_FETCH: '1' });
  const linuxNoEnv = [];
  await createGitRunner({ resolver: testResolver(), execFileImpl: spyExecFile(linuxNoEnv), platform: 'linux' })('git', ['status'], { cwd: '/srv/p' });
  assert.equal(linuxNoEnv[0].opts.env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(linuxNoEnv[0].opts.env.PATH, process.env.PATH, 'sin env explícito parte de process.env');
  const win = [];
  const resolver = testResolver({ platform: 'win32', files: ['C:\\Git\\cmd\\git.exe'], PATH: 'C:\\Git\\cmd' });
  await createGitRunner({ resolver, execFileImpl: spyExecFile(win), platform: 'win32' })('git', ['status'], { cwd: 'C:\\p', env: { MIA: 'z' } });
  assert.deepEqual(win[0].opts.env, { MIA: 'z', GIT_NO_LAZY_FETCH: '1', NoDefaultCurrentDirectoryInExePath: '1' });
});

/** Runner falso para readRepoExecConfig: devuelve la salida (o lanza con un código) según la lista de argumentos. */
function cfgRunner({ scoped, noscope, scopedError, noscopeError } = {}) {
  const calls = [];
  const runner = async (file, args) => {
    calls.push(args);
    const hasShowScope = args.includes('--show-scope');
    if (hasShowScope) {
      if (scopedError) throw Object.assign(new Error('fallo'), scopedError);
      return { stdout: scoped };
    }
    if (noscopeError) throw Object.assign(new Error('fallo'), noscopeError);
    return { stdout: noscope };
  };
  return { runner, calls };
}

test('[F19-R4] readRepoExecConfig: solo local/worktree, alternativa sin --show-scope (129), sin coincidencias (1), error, duplicados y tope 20', async () => {
  const scoped = [
    'global\tgpg.program',
    'local\tfilter.lfs.process',
    'worktree\tcore.sshcommand',
    'command\tcredential.helper',
    'local\tfilter.b.clean',
    'local\tfilter.b.smudge',
    'local\tfilter.a=b.clean',
  ].join('\n') + '\n';
  const ok = cfgRunner({ scoped });
  const r = await readRepoExecConfig('/repo', { runner: ok.runner });
  assert.deepEqual(r.filters, ['b', 'lfs'], 'solo nombres de filtro admitidos locales, únicos y ordenados');
  assert.deepEqual(r.unsafeFilters, ['a=b']);
  assert.deepEqual(r.execKeys, ['core.sshcommand', 'filter.a=b.clean', 'filter.b.clean', 'filter.b.smudge', 'filter.lfs.process'], 'solo local/worktree, únicos, ordenados');

  // Código 129 en la primera llamada → segunda sin --show-scope, todo tratado como local.
  const fallback = cfgRunner({ scopedError: { code: 129 }, noscope: 'filter.m.clean\ngpg.program\n' });
  const rf = await readRepoExecConfig('/repo', { runner: fallback.runner });
  assert.equal(fallback.calls.length, 2);
  assert.ok(!fallback.calls[1].includes('--show-scope'));
  assert.deepEqual(rf.filters, ['m']);
  assert.deepEqual(rf.execKeys, ['filter.m.clean', 'gpg.program']);

  // Código 1 (sin coincidencias) → listas vacías; cualquier otro error → listas vacías.
  assert.deepEqual(await readRepoExecConfig('/repo', { runner: cfgRunner({ scopedError: { code: 1 } }).runner }), { filters: [], unsafeFilters: [], execKeys: [] });
  assert.deepEqual(await readRepoExecConfig('/repo', { runner: cfgRunner({ scopedError: { code: 'ENOENT' } }).runner }), { filters: [], unsafeFilters: [], execKeys: [] });
  // 129 y luego fallo en la segunda → listas vacías.
  assert.deepEqual(await readRepoExecConfig('/repo', { runner: cfgRunner({ scopedError: { code: 129 }, noscopeError: { code: 1 } }).runner }), { filters: [], unsafeFilters: [], execKeys: [] });

  // Duplicados una sola vez y como mucho 20 en execKeys.
  const many = Array.from({ length: 30 }, (_, i) => `local\tcredential.https://h${String(i).padStart(2, '0')}.helper`);
  const dups = cfgRunner({ scoped: [...many, ...many, 'local\tgpg.program', 'local\tgpg.program'].join('\n') + '\n' });
  const rd = await readRepoExecConfig('/repo', { runner: dups.runner });
  assert.equal(rd.execKeys.length, 20);
  assert.deepEqual(rd.execKeys, [...rd.execKeys].sort());
  assert.equal(new Set(rd.execKeys).size, rd.execKeys.length, 'sin duplicados');
});

test('[F19-R4] FILTER_NAME_RE y filterOverrideArgs: ocho opciones por filtro en orden', () => {
  assert.equal(FILTER_NAME_RE.test('lfs'), true);
  assert.equal(FILTER_NAME_RE.test('a.b_c-d'), true);
  assert.equal(FILTER_NAME_RE.test('a=b'), false);
  assert.equal(FILTER_NAME_RE.test(''), false);
  assert.deepEqual(filterOverrideArgs(['b', 'lfs']), [
    '-c', 'filter.b.clean=', '-c', 'filter.b.smudge=', '-c', 'filter.b.process=', '-c', 'filter.b.required=false',
    '-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false',
  ]);
  assert.deepEqual(filterOverrideArgs([]), []);
});

test('[F19-R8] GIT_COMMANDS: el status del listado lleva --ignore-submodules=dirty y las dos lecturas de config están al final', () => {
  assert.deepEqual(GIT_COMMANDS[4], ['--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=dirty']);
  assert.deepEqual(GIT_COMMANDS[5], ['--no-optional-locks', 'config', '--show-scope', '--name-only', '--get-regexp', EXEC_CONFIG_RE]);
  assert.deepEqual(GIT_COMMANDS[6], ['--no-optional-locks', 'config', '--name-only', '--get-regexp', EXEC_CONFIG_RE]);
});

/** Runner falso de getGitInfo con filtros locales en la lectura de configuración. */
function infoRunner({ scoped, calls = [] }) {
  return async (file, args) => {
    calls.push(args);
    if (args.includes('--is-inside-work-tree')) return { stdout: 'true\n' };
    if (args.includes('--abbrev-ref')) return { stdout: 'main\n' };
    if (args[0] === 'log') return { stdout: `${'a'.repeat(40)}\x1fF\x1fM\n` };
    if (args.includes('--show-scope')) return { stdout: scoped };
    if (args.includes('status')) return { stdout: ' M a.txt\n' };
    throw new Error(`inesperado: ${args.join(' ')}`);
  };
}

test('[F19-R5] getGitInfo antepone la anulación de filtros locales (orden alfabético) al status', async () => {
  const calls = [];
  const runner = infoRunner({ scoped: 'local\tfilter.lfs.process\nlocal\tfilter.b.clean\n', calls });
  await getGitInfo('/repo', { runner });
  const statusCall = calls.find((a) => a.includes('status'));
  assert.deepEqual(statusCall, [
    '-c', 'filter.b.clean=', '-c', 'filter.b.smudge=', '-c', 'filter.b.process=', '-c', 'filter.b.required=false',
    '-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false',
    '--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=dirty',
  ]);
});

test('[F19-R6] getGitInfo con un filtro de nombre no admitido no ejecuta status: dirtyCount null y dirtyFiles []', async () => {
  const calls = [];
  const runner = infoRunner({ scoped: 'local\tfilter.a=b.clean\n', calls });
  const info = await getGitInfo('/repo', { runner, detail: true });
  assert.equal(info.dirtyCount, null);
  assert.deepEqual(info.dirtyFiles, []);
  assert.ok(!calls.some((a) => a.includes('status')), 'no se ejecuta ningún status');
});
