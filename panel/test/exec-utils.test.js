// Tests de lib/exec-utils.js — F4: R28, R31, R52, R53, R54.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCommandLine,
  formatCommandLine,
  resolveExecutable,
  findGitBash,
  killProcessTree,
  createLineSplitter,
  stripAnsi,
} from '../lib/exec-utils.js';

// ---------- R53: parseCommandLine ----------

test('[F4-R53] parseCommandLine: casos válidos', () => {
  assert.deepEqual(parseCommandLine('npm test'), { ok: true, args: ['npm', 'test'] });
  assert.deepEqual(parseCommandLine('node "mi script.js" --x'), { ok: true, args: ['node', 'mi script.js', '--x'] });
  assert.deepEqual(parseCommandLine('echo "a \\"b\\""'), { ok: true, args: ['echo', 'a "b"'] });
  assert.deepEqual(parseCommandLine('echo a|b; rm x'), { ok: true, args: ['echo', 'a|b;', 'rm', 'x'] });
  assert.deepEqual(parseCommandLine("  a\t'b'  $HOME > out & c  "), { ok: true, args: ['a', "'b'", '$HOME', '>', 'out', '&', 'c'] });
  assert.deepEqual(parseCommandLine('C:\\tools\\x.exe "C:\\a b\\c"'), { ok: true, args: ['C:\\tools\\x.exe', 'C:\\a b\\c'] });
  assert.deepEqual(parseCommandLine('x "" y'), { ok: true, args: ['x', '', 'y'] });
  assert.deepEqual(parseCommandLine('x "a\\\\b"'), { ok: true, args: ['x', 'a\\b'] });
  assert.deepEqual(parseCommandLine('pre"fijo junto"post'), { ok: true, args: ['prefijo juntopost'] });
});

test('[F4-R53] parseCommandLine: cada error', () => {
  assert.deepEqual(parseCommandLine(''), { ok: false, error: 'vacío' });
  assert.deepEqual(parseCommandLine('   \t '), { ok: false, error: 'vacío' });
  assert.deepEqual(parseCommandLine(undefined), { ok: false, error: 'vacío' });
  assert.deepEqual(parseCommandLine('echo "sin cerrar'), { ok: false, error: 'comillas sin cerrar' });
  assert.deepEqual(parseCommandLine('echo a\nrm b'), { ok: false, error: 'contiene saltos de línea o NUL' });
  assert.deepEqual(parseCommandLine('echo a\rb'), { ok: false, error: 'contiene saltos de línea o NUL' });
  assert.deepEqual(parseCommandLine('echo a\0b'), { ok: false, error: 'contiene saltos de línea o NUL' });
  assert.deepEqual(parseCommandLine('a'.repeat(301)), { ok: false, error: 'más de 300 caracteres' });
  assert.equal(parseCommandLine('a'.repeat(300)).ok, true);
  assert.deepEqual(parseCommandLine(Array(51).fill('x').join(' ')), { ok: false, error: 'más de 50 argumentos' });
  assert.equal(parseCommandLine(Array(50).fill('x').join(' ')).ok, true);
});

test('[F4-R53] formatCommandLine entrecomilla los argumentos con espacios, vacíos o comillas', () => {
  assert.equal(formatCommandLine(['npm', 'test']), 'npm test');
  assert.equal(formatCommandLine(['node', 'mi script.js', '']), 'node "mi script.js" ""');
  assert.equal(formatCommandLine(['echo', 'a "b"']), 'echo "a \\"b\\""');
});

// ---------- R54: resolveExecutable ----------

const WIN_EXEC = 'C:\\Program Files\\nodejs\\node.exe';
const NPM_CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
const NPX_CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js';
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

function winOptions(files, extra = {}) {
  const set = new Set(files);
  return {
    platform: 'win32',
    env: { PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd;C:\\Users\\U\\AppData\\Roaming\\npm', ProgramFiles: 'C:\\Program Files' },
    execPath: WIN_EXEC,
    exists: (f) => set.has(f),
    bashBin: null,
    ...extra,
  };
}

test('[F4-R54] resolveExecutable en Windows: node, npm, npx, bash, git (.exe) y yarn (solo .cmd → error)', () => {
  const files = [NPM_CLI, NPX_CLI, GIT_BASH, 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Users\\U\\AppData\\Roaming\\npm\\yarn.cmd'];
  const o = winOptions(files);
  assert.deepEqual(resolveExecutable('node', o), { file: WIN_EXEC, prefixArgs: [] });
  assert.deepEqual(resolveExecutable('node.exe', o), { file: WIN_EXEC, prefixArgs: [] });
  assert.deepEqual(resolveExecutable('npm', o), { file: WIN_EXEC, prefixArgs: [NPM_CLI] });
  assert.deepEqual(resolveExecutable('npx', o), { file: WIN_EXEC, prefixArgs: [NPX_CLI] });
  assert.deepEqual(resolveExecutable('bash', o), { file: GIT_BASH, prefixArgs: [] });
  assert.deepEqual(resolveExecutable('git', o), { file: 'C:\\Program Files\\Git\\cmd\\git.exe', prefixArgs: [] });
  assert.deepEqual(resolveExecutable('git.exe', o), { file: 'C:\\Program Files\\Git\\cmd\\git.exe', prefixArgs: [] });
  assert.deepEqual(resolveExecutable('yarn', o), { error: '"yarn" es un script .cmd/.bat y el panel no usa shell: indica la ruta de un .exe o usa node <script>.js' });
  assert.deepEqual(resolveExecutable('C:\\x\\run.bat', o), { error: '"C:\\x\\run.bat" es un script .cmd/.bat y el panel no usa shell: indica la ruta de un .exe o usa node <script>.js' });
  assert.deepEqual(resolveExecutable('C:\\x\\tool.exe', o), { file: 'C:\\x\\tool.exe', prefixArgs: [] });
  assert.deepEqual(resolveExecutable('pytest', o), { file: 'pytest', prefixArgs: [] }, 'no encontrado: tal cual (fallará con ENOENT)');
});

test('[F4-R54] resolveExecutable en Windows: .com antes que .exe, npm sin npm-cli.js y bash sin Git Bash', () => {
  const o = winOptions(['C:\\Users\\U\\AppData\\Roaming\\npm\\tool.com', 'C:\\Users\\U\\AppData\\Roaming\\npm\\tool.exe']);
  assert.deepEqual(resolveExecutable('tool', o), { file: 'C:\\Users\\U\\AppData\\Roaming\\npm\\tool.com', prefixArgs: [] });
  assert.equal(resolveExecutable('npm', o).error, '"npm" es un script .cmd/.bat y el panel no usa shell: indica la ruta de un .exe o usa node <script>.js');
  assert.deepEqual(resolveExecutable('bash', o), { error: 'No se encontró Git Bash: instala Git for Windows o configura el comando de tests' });
  const withPathKey = resolveExecutable('git', { ...o, env: { Path: 'D:\\git\\bin' }, exists: (f) => f === 'D:\\git\\bin\\git.exe' });
  assert.deepEqual(withPathKey, { file: 'D:\\git\\bin\\git.exe', prefixArgs: [] });
});

test('[F4-R54] resolveExecutable fuera de Windows: bash → bashBin o bash, .js → node, resto tal cual', () => {
  const o = { platform: 'linux', env: {}, execPath: '/usr/bin/node', exists: () => false, bashBin: null };
  assert.deepEqual(resolveExecutable('bash', o), { file: 'bash', prefixArgs: [] });
  assert.deepEqual(resolveExecutable('bash', { ...o, bashBin: '/opt/bash' }), { file: '/opt/bash', prefixArgs: [] });
  assert.deepEqual(resolveExecutable('scripts/x.mjs', o), { file: '/usr/bin/node', prefixArgs: ['scripts/x.mjs'] });
  assert.deepEqual(resolveExecutable('npm', o), { file: 'npm', prefixArgs: [] });
  assert.deepEqual(resolveExecutable('node', o), { file: 'node', prefixArgs: [] });
});

// ---------- R52: findGitBash ----------

test('[F4-R52] findGitBash prueba en orden y descarta System32/Sysnative', () => {
  const env = {
    CLAUDE_CODE_GIT_BASH_PATH: 'D:\\Git\\bin\\bash.exe',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\U\\AppData\\Local',
  };
  const all = ['E:\\bash.exe', 'D:\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe', 'C:\\Users\\U\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'];
  const order = [];
  for (let i = 0; i < all.length; i++) {
    const available = new Set(all.slice(i));
    const found = findGitBash({ env, bashBin: 'E:\\bash.exe', exists: (f) => available.has(f) });
    order.push(found);
  }
  assert.deepEqual(order, all, 'cada posición gana cuando las anteriores no existen');
  assert.equal(findGitBash({ env: { CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Windows\\System32\\bash.exe' }, exists: () => true }), null, 'el bash de WSL se ignora');
  assert.equal(findGitBash({ env: {}, bashBin: 'C:\\WINDOWS\\Sysnative\\bash.exe', exists: () => true }), null);
  assert.equal(findGitBash({ env, exists: () => false }), null);
});

// ---------- R28: killProcessTree ----------

test('[F4-R28] killProcessTree en Windows: taskkill /PID <pid> /T /F sin shell', () => {
  const calls = [];
  killProcessTree({ pid: 4321 }, { platform: 'win32', execFileImpl: (file, args, opts) => calls.push({ file, args, opts }) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'taskkill');
  assert.deepEqual(calls[0].args, ['/PID', '4321', '/T', '/F']);
  assert.equal(calls[0].opts.windowsHide, true);
  assert.ok(!calls[0].opts.shell);
});

test('[F4-R28] killProcessTree en Linux: SIGTERM al grupo y SIGKILL a los 5 s si sigue vivo', () => {
  const kills = [];
  const timers = [];
  const child = { pid: 777, exitCode: null, signalCode: null, once() {} };
  killProcessTree(child, {
    platform: 'linux',
    killImpl: (pid, signal) => kills.push([pid, signal]),
    setTimeoutImpl: (fn, ms) => {
      timers.push({ fn, ms });
      return { unref() {} };
    },
  });
  assert.deepEqual(kills, [[-777, 'SIGTERM']]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5000);
  timers[0].fn();
  assert.deepEqual(kills, [[-777, 'SIGTERM'], [-777, 'SIGKILL']]);
});

test('[F4-R28] killProcessTree en Linux: si el hijo ya salió no hay SIGKILL; ESRCH no lanza', () => {
  const kills = [];
  let onExit = null;
  const timers = [];
  const child = { pid: 778, exitCode: null, signalCode: null, once(event, fn) { if (event === 'exit') onExit = fn; } };
  killProcessTree(child, { platform: 'linux', killImpl: (pid, sig) => kills.push([pid, sig]), setTimeoutImpl: (fn) => { timers.push(fn); return {}; } });
  onExit();
  timers[0]();
  assert.deepEqual(kills, [[-778, 'SIGTERM']]);

  const esrch = () => {
    const err = new Error('no existe');
    err.code = 'ESRCH';
    throw err;
  };
  assert.doesNotThrow(() => killProcessTree({ pid: 1, once() {} }, { platform: 'linux', killImpl: esrch, setTimeoutImpl: () => ({}) }));
});

// ---------- R31: createLineSplitter ----------

test('[F4-R31] createLineSplitter: línea de 250 bytes en tres trozos con máximo 100 → descartada una vez; la siguiente llega intacta', () => {
  const lines = [];
  let discards = 0;
  const splitter = createLineSplitter({ maxLineBytes: 100, onLine: (l) => lines.push(l), onDiscard: () => { discards += 1; } });
  splitter.push(Buffer.from('corta 1\n' + 'x'.repeat(90)));
  splitter.push(Buffer.from('x'.repeat(90)));
  splitter.push(Buffer.from('x'.repeat(70) + '\ncorta 2\r\nfinal sin salto'));
  splitter.end();
  assert.deepEqual(lines, ['corta 1', 'corta 2', 'final sin salto']);
  assert.equal(discards, 1);
});

test('[F4-R31] createLineSplitter: UTF-8 partido entre trozos y línea larga completa en un solo trozo', () => {
  const lines = [];
  let discards = 0;
  const splitter = createLineSplitter({ maxLineBytes: 10, onLine: (l) => lines.push(l), onDiscard: () => { discards += 1; } });
  const bytes = Buffer.from('ñandú\n');
  splitter.push(bytes.subarray(0, 1));
  splitter.push(bytes.subarray(1));
  splitter.push(Buffer.from('0123456789ABCDEF\nok\n'));
  splitter.end();
  assert.deepEqual(lines, ['ñandú', 'ok']);
  assert.equal(discards, 1);
});

test('[F4-R50] stripAnsi elimina colores y secuencias OSC', () => {
  assert.equal(stripAnsi('\x1b[32mtodo bien\x1b[0m'), 'todo bien');
  assert.equal(stripAnsi('\x1b[1;31mrojo\x1b[22m y \x1b]0;título\x07normal'), 'rojo y normal');
  assert.equal(stripAnsi('\x1b[?25lsin cursor\x1b[2K'), 'sin cursor');
});
