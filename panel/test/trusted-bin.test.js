// Tests unitarios del resolvedor de ejecutables de confianza (lib/trusted-bin.js) — feature 14: R1, R2, R3, R4, R5.
// Todo con `platform`, `env` y funciones de sistema de ficheros inyectadas: no se toca el disco ni se lanza nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBinaryResolver,
  resolveTrustedBinary,
  isTrustedPath,
  parsePathEntries,
  BIN_ERRORS,
  CMD_SCRIPT_ERROR,
  NO_GIT_BASH_ERROR,
} from '../lib/trusted-bin.js';

/** fsOps de prueba: `files` son los ficheros existentes (ejecutables), `links` ruta → ruta real; cuenta los isFile. */
function fakeFs(files, { links = {}, notExecutable = [] } = {}) {
  const set = new Set(files);
  const counter = { isFile: 0 };
  return {
    counter,
    fsOps: {
      isFile: (p) => {
        counter.isFile += 1;
        return set.has(p);
      },
      isExecutable: (p) => !notExecutable.includes(p),
      realpath: (p) => (set.has(p) ? (links[p] ?? p) : null),
    },
  };
}

function linux(files, extra = {}) {
  const { fsOps, counter } = fakeFs(files, extra);
  const resolver = createBinaryResolver({
    platform: 'linux',
    env: { PATH: '/usr/local/bin:/usr/bin', HOME: '/home/u', ...(extra.env || {}) },
    execPath: '/opt/node/bin/node',
    homeDir: '/home/u',
    fsOps,
    getProjectDirs: () => extra.projects || [],
    bashBin: extra.bashBin ?? null,
  });
  return { resolver, counter };
}

const WIN_EXEC = 'C:\\Program Files\\nodejs\\node.exe';

function win(files, extra = {}) {
  const { fsOps, counter } = fakeFs(files, extra);
  const resolver = createBinaryResolver({
    platform: 'win32',
    env: {
      Path: 'C:\\Windows\\System32;C:\\Tools;C:\\Users\\U\\AppData\\Roaming\\npm',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\U\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\U',
      SystemRoot: 'C:\\Windows',
      ...(extra.env || {}),
    },
    execPath: WIN_EXEC,
    fsOps,
    getProjectDirs: () => extra.projects || [],
    bashBin: extra.bashBin ?? null,
  });
  return { resolver, counter };
}

// ---------- R1: orden de PATH, extensiones y rutas conocidas ----------

test('[F14-R1] linux: primera carpeta del PATH que tiene el programa (fichero ejecutable), ruta absoluta', () => {
  const { resolver } = linux(['/usr/local/bin/git', '/usr/bin/git', '/usr/bin/npm']);
  assert.deepEqual(resolver.resolve('git', { cwd: '/srv/p' }), { ok: true, file: '/usr/local/bin/git', prefixArgs: [] });
  assert.deepEqual(resolver.resolve('npm', { cwd: '/srv/p' }), { ok: true, file: '/usr/bin/npm', prefixArgs: [] });
  const noExec = linux(['/usr/local/bin/git', '/usr/bin/git'], { notExecutable: ['/usr/local/bin/git'] }).resolver;
  assert.equal(noExec.resolve('git', { cwd: '/srv/p' }).file, '/usr/bin/git', 'sin permiso de ejecución no cuenta');
});

test('[F14-R1] linux: node → execPath siempre (sin mirar PATH); bash → bashBin absoluto y luego PATH; claude → PATH y luego ~/.local/bin', () => {
  const { resolver } = linux(['/usr/bin/node', '/usr/bin/bash', '/opt/bash', '/home/u/.local/bin/claude', '/usr/bin/claude']);
  assert.deepEqual(resolver.resolve('node', { cwd: '/srv/p' }), { ok: true, file: '/opt/node/bin/node', prefixArgs: [] });
  assert.equal(resolver.resolve('bash', { cwd: '/srv/p' }).file, '/usr/bin/bash');
  assert.equal(linux(['/usr/bin/bash', '/opt/bash'], { bashBin: '/opt/bash' }).resolver.resolve('bash', { cwd: '/srv/p' }).file, '/opt/bash');
  assert.equal(linux(['/usr/bin/bash', 'bash-relativo'], { bashBin: 'bash-relativo' }).resolver.resolve('bash', { cwd: '/srv/p' }).file, '/usr/bin/bash', 'bashBin relativo se ignora');
  assert.equal(resolver.resolve('claude', { cwd: '/srv/p' }).file, '/usr/bin/claude', 'PATH antes que ~/.local/bin');
  assert.equal(linux(['/home/u/.local/bin/claude']).resolver.resolve('claude', { cwd: '/srv/p' }).file, '/home/u/.local/bin/claude');
});

test('[F14-R1] win32: .com antes que .exe, nombre con .exe tal cual, nunca .cmd/.bat ni sin extensión', () => {
  const { resolver } = win(['C:\\Tools\\tool.com', 'C:\\Tools\\tool.exe', 'C:\\Tools\\other.exe', 'C:\\Tools\\script.cmd', 'C:\\Tools\\plain', 'C:\\Tools\\batch.bat']);
  assert.deepEqual(resolver.resolve('tool', { cwd: 'C:\\p' }), { ok: true, file: 'C:\\Tools\\tool.com', prefixArgs: [] });
  assert.equal(resolver.resolve('tool.exe', { cwd: 'C:\\p' }).file, 'C:\\Tools\\tool.exe');
  assert.equal(resolver.resolve('other', { cwd: 'C:\\p' }).file, 'C:\\Tools\\other.exe');
  assert.deepEqual(resolver.resolve('script', { cwd: 'C:\\p' }), { ok: false, error: CMD_SCRIPT_ERROR('script') }, 'solo .cmd → error de la fase 4');
  assert.deepEqual(resolver.resolve('batch', { cwd: 'C:\\p' }), { ok: false, error: CMD_SCRIPT_ERROR('batch') });
  assert.deepEqual(resolver.resolve('plain', { cwd: 'C:\\p' }), { ok: false, error: BIN_ERRORS.notFound('plain') }, 'sin extensión no cuenta');
});

test('[F14-R1] win32: rutas conocidas de §3.2 (node, npm/npx, git, bash, claude y taskkill)', () => {
  const npmCli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const npxCli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js';
  const { resolver } = win([npmCli, npxCli, 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Tools\\node.exe']);
  const cwd = { cwd: 'C:\\p' };
  assert.deepEqual(resolver.resolve('node', cwd), { ok: true, file: WIN_EXEC, prefixArgs: [] }, 'node → execPath aunque haya otro en PATH');
  assert.deepEqual(resolver.resolve('node.exe', cwd), { ok: true, file: WIN_EXEC, prefixArgs: [] });
  assert.deepEqual(resolver.resolve('npm', cwd), { ok: true, file: WIN_EXEC, prefixArgs: [npmCli] });
  assert.deepEqual(resolver.resolve('npx', cwd), { ok: true, file: WIN_EXEC, prefixArgs: [npxCli] });
  assert.deepEqual(win([]).resolver.resolve('npm', cwd), { ok: false, error: CMD_SCRIPT_ERROR('npm') });
  assert.equal(resolver.resolve('git', cwd).file, 'C:\\Program Files\\Git\\cmd\\git.exe', 'git por %ProgramFiles% tras PATH');
  assert.equal(win(['C:\\Tools\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe']).resolver.resolve('git', cwd).file, 'C:\\Tools\\git.exe', 'PATH antes que las rutas conocidas');
  assert.equal(win(['C:\\Program Files (x86)\\Git\\cmd\\git.exe']).resolver.resolve('git', cwd).file, 'C:\\Program Files (x86)\\Git\\cmd\\git.exe');
  assert.equal(win(['C:\\Users\\U\\AppData\\Local\\Programs\\Git\\cmd\\git.exe']).resolver.resolve('git', cwd).file, 'C:\\Users\\U\\AppData\\Local\\Programs\\Git\\cmd\\git.exe');
  assert.equal(resolver.resolve('bash', cwd).file, 'C:\\Program Files\\Git\\bin\\bash.exe');
  assert.deepEqual(win(['C:\\Windows\\System32\\bash.exe', 'C:\\Tools\\bash.exe']).resolver.resolve('bash', cwd), { ok: false, error: NO_GIT_BASH_ERROR }, 'bash nunca del PATH ni de System32');
  assert.deepEqual(win([]).resolver.resolve('taskkill', cwd), { ok: true, file: 'C:\\Windows\\System32\\taskkill.exe', prefixArgs: [] }, 'taskkill sin comprobar existencia');
  const noRoot = win([], { env: { SystemRoot: undefined } }).resolver;
  assert.equal(noRoot.resolve('taskkill', cwd).file, 'C:\\Windows\\System32\\taskkill.exe');
});

test('[F14-R1] win32: claude en PATH, luego %USERPROFILE%\\.local\\bin y luego el cli.js junto a un claude.cmd del PATH', () => {
  const cwd = { cwd: 'C:\\p' };
  const cli = 'C:\\Users\\U\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
  assert.equal(win(['C:\\Tools\\claude.exe', 'C:\\Users\\U\\.local\\bin\\claude.exe']).resolver.resolve('claude', cwd).file, 'C:\\Tools\\claude.exe');
  assert.equal(win(['C:\\Users\\U\\.local\\bin\\claude.exe']).resolver.resolve('claude', cwd).file, 'C:\\Users\\U\\.local\\bin\\claude.exe');
  assert.deepEqual(win(['C:\\Users\\U\\AppData\\Roaming\\npm\\claude.cmd', cli]).resolver.resolve('claude', cwd), { ok: true, file: WIN_EXEC, prefixArgs: [cli] });
  assert.deepEqual(win(['C:\\Users\\U\\AppData\\Roaming\\npm\\claude.cmd']).resolver.resolve('claude', cwd), { ok: false, error: CMD_SCRIPT_ERROR('claude') });
});

// ---------- R2: filtrado de las entradas de PATH ----------

test('[F14-R2] parsePathEntries descarta vacías, ".", relativas, con % y (win32) sin unidad ni UNC; quita comillas y duplicados', () => {
  assert.deepEqual(parsePathEntries(':.:bin:/usr/bin', 'linux'), ['/usr/bin']);
  assert.deepEqual(parsePathEntries(';.;bin;\\herramientas;%X%\\bin;"C:\\Git\\cmd";C:\\Windows', 'win32'), ['C:\\Git\\cmd', 'C:\\Windows']);
  assert.deepEqual(parsePathEntries(' /usr/bin :/usr/bin/:/opt/%x:/bin', 'linux'), ['/usr/bin', '/bin']);
  assert.deepEqual(parsePathEntries('C:\\Windows;c:\\windows\\;\\\\srv\\share\\bin', 'win32'), ['C:\\Windows', '\\\\srv\\share\\bin']);
  assert.deepEqual(parsePathEntries(undefined, 'linux'), []);
});

test('[F14-R2] el resolvedor solo consulta las entradas absolutas del PATH (linux y win32)', () => {
  const seen = [];
  const fsOps = { isFile: (p) => { seen.push(p); return false; }, isExecutable: () => true, realpath: () => null };
  createBinaryResolver({ platform: 'linux', env: { PATH: ':.:bin:/usr/bin' }, homeDir: '/home/u', fsOps }).resolve('herramienta', { cwd: '/srv/p' });
  assert.deepEqual(seen, ['/usr/bin/herramienta']);
  seen.length = 0;
  createBinaryResolver({ platform: 'win32', env: { PATH: ';.;bin;\\herramientas;%X%\\bin;"C:\\Git\\cmd";C:\\Windows' }, fsOps }).resolve('herramienta', { cwd: 'C:\\p' });
  assert.deepEqual(seen, ['C:\\Git\\cmd\\herramienta.com', 'C:\\Git\\cmd\\herramienta.exe', 'C:\\Windows\\herramienta.com', 'C:\\Windows\\herramienta.exe', 'C:\\Git\\cmd\\herramienta.cmd', 'C:\\Git\\cmd\\herramienta.bat', 'C:\\Windows\\herramienta.cmd', 'C:\\Windows\\herramienta.bat']);
});

// ---------- R3: exclusión de carpetas ----------

test('[F14-R3] linux: se descartan el git del cwd, el de otro proyecto, el de una subcarpeta y un enlace a un proyecto', () => {
  const files = ['/srv/p/git', '/srv/otro/git', '/srv/tercero/bin/git', '/usr/local/bin/git', '/usr/bin/git'];
  const env = { PATH: '/srv/p:/srv/otro:/srv/tercero/bin:/usr/local/bin:/usr/bin' };
  const { resolver } = linux(files, { env, projects: ['/srv/otro', '/srv/tercero'], links: { '/usr/local/bin/git': '/srv/tercero/herramientas/git' } });
  assert.deepEqual(resolver.resolve('git', { cwd: '/srv/p' }), { ok: true, file: '/usr/bin/git', prefixArgs: [] });
  assert.deepEqual(resolver.excludedDirs({ cwd: '/srv/p' }), ['/srv/p', '/srv/otro', '/srv/tercero']);
});

test('[F14-R3] win32: sin distinguir mayúsculas, el git.exe de la raíz del proyecto (libuv lo buscaría en el cwd) se descarta', () => {
  const files = ['C:\\Proyectos\\App\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe'];
  const { resolver } = win(files, { env: { Path: 'C:\\Proyectos\\App;C:\\Windows' } });
  assert.equal(resolver.resolve('git', { cwd: 'c:\\proyectos\\app' }).file, 'C:\\Program Files\\Git\\cmd\\git.exe');
  const projects = win(files, { env: { Path: 'C:\\Proyectos\\App;C:\\Windows' }, projects: ['c:\\PROYECTOS\\app\\'] }).resolver;
  assert.equal(projects.resolve('git', { cwd: 'D:\\otro' }).file, 'C:\\Program Files\\Git\\cmd\\git.exe', 'otro proyecto del catálogo');
});

test('[F14-R3] proyecto contenedor (HOME, ancestro o raíz): solo se excluye su raíz, no sus subcarpetas', () => {
  const files = ['/home/u/claude', '/home/u/.local/bin/claude'];
  const env = { PATH: '/home/u:/home/u/.local/bin' };
  assert.equal(linux(files, { env, projects: ['/home/u'] }).resolver.resolve('claude', { cwd: '/srv/p' }).file, '/home/u/.local/bin/claude', 'HOME del catálogo');
  assert.equal(linux(files, { env }).resolver.resolve('claude', { cwd: '/home/u' }).file, '/home/u/.local/bin/claude', 'HOME como cwd');
  const ancestor = linux(['/home/claude', '/home/u/.local/bin/claude'], { env: { PATH: '/home:/home/u/.local/bin' }, projects: ['/home'] }).resolver;
  assert.equal(ancestor.resolve('claude', { cwd: '/srv/p' }).file, '/home/u/.local/bin/claude', 'ancestro de HOME: solo su raíz');
  assert.equal(linux(['/usr/bin/git', '/git'], { env: { PATH: '/:/usr/bin' }, projects: ['/'] }).resolver.resolve('git', { cwd: '/srv/p' }).file, '/usr/bin/git', 'raíz: solo /git');
  assert.deepEqual(linux(['/home/u/claude'], { env }).resolver.resolve('claude', { cwd: '/home/u' }), { ok: false, error: BIN_ERRORS.onlyInProject('claude') });
  const winHome = win(['C:\\Users\\U\\claude.exe', 'C:\\Users\\U\\.local\\bin\\claude.exe'], { env: { Path: 'C:\\Users\\U' }, projects: ['C:\\Users\\U'] }).resolver;
  assert.equal(winHome.resolve('claude', { cwd: 'C:\\p' }).file, 'C:\\Users\\U\\.local\\bin\\claude.exe');
  const notContainer = linux(['/srv/a/bin/git', '/usr/bin/git'], { env: { PATH: '/srv/a/bin:/usr/bin' }, projects: ['/srv/a'] }).resolver;
  assert.equal(notContainer.resolve('git', { cwd: '/x' }).file, '/usr/bin/git', 'de un proyecto normal se excluye el subárbol');
});

// ---------- R4: errores ----------

test('[F14-R4] sin candidatos → notFound; solo dentro de un proyecto → onlyInProject; nombre con separadores → invalidName', () => {
  const { resolver } = linux(['/srv/p/git'], { env: { PATH: '/srv/p:/usr/bin' } });
  assert.deepEqual(resolver.resolve('pytest', { cwd: '/srv/p' }), { ok: false, error: BIN_ERRORS.notFound('pytest') });
  assert.deepEqual(resolver.resolve('git', { cwd: '/srv/p' }), { ok: false, error: BIN_ERRORS.onlyInProject('git') });
  for (const bad of ['./git', 'bin/git', '..\\git', '', 'a b', 'x'.repeat(65)]) {
    assert.deepEqual(resolver.resolve(bad, { cwd: '/srv/p' }), { ok: false, error: BIN_ERRORS.invalidName(bad) }, bad);
  }
  assert.equal(BIN_ERRORS.notFound('git'), 'No se encontró «git» en el PATH del panel (se ignoran las rutas relativas y las carpetas de los proyectos): instálalo o revisa el PATH y reinicia el panel');
  assert.equal(BIN_ERRORS.onlyInProject('git'), '«git» solo está dentro de la carpeta de un proyecto y el panel no ejecuta programas de los proyectos: instálalo fuera de ellos o revisa el PATH');
  assert.equal(BIN_ERRORS.untrusted('git'), 'No se ejecuta «git»: el panel solo lanza programas con ruta absoluta fuera de las carpetas de los proyectos');
  assert.equal(BIN_ERRORS.invalidName('a/b'), 'Nombre de programa no válido: «a/b»');
});

test('[F14-R4][F14-R6] isTrustedPath: absoluta y fuera de las carpetas excluidas (por ruta y por ruta real)', () => {
  const { resolver } = linux(['/usr/local/bin/x', '/usr/bin/git'], { projects: ['/srv/otro'], links: { '/usr/local/bin/x': '/srv/otro/x' } });
  assert.equal(resolver.isTrustedPath('/usr/bin/git', { cwd: '/srv/p' }), true);
  assert.equal(resolver.isTrustedPath('git', { cwd: '/srv/p' }), false, 'nombre suelto');
  assert.equal(resolver.isTrustedPath('bin/git', { cwd: '/srv/p' }), false, 'relativa');
  assert.equal(resolver.isTrustedPath('/srv/p/git', { cwd: '/srv/p' }), false, 'en el cwd');
  assert.equal(resolver.isTrustedPath('/srv/p/sub/git', { cwd: '/srv/p' }), false, 'en una subcarpeta del cwd');
  assert.equal(resolver.isTrustedPath('/srv/otro/git', { cwd: '/srv/p' }), false, 'en otro proyecto');
  assert.equal(resolver.isTrustedPath('/usr/local/bin/x', { cwd: '/srv/p' }), false, 'enlace a un proyecto');
  const w = win([]).resolver;
  assert.equal(w.isTrustedPath('C:\\Program Files\\Git\\cmd\\git.exe', { cwd: 'C:\\p' }), true);
  assert.equal(w.isTrustedPath('C:\\P\\git.exe', { cwd: 'c:\\p' }), false);
  assert.equal(w.isTrustedPath('git.exe', { cwd: 'C:\\p' }), false);
  assert.equal(w.isTrustedPath('\\\\srv\\share\\git.exe', { cwd: 'C:\\p' }), true, 'UNC absoluta');
  assert.equal(w.isTrustedPath('C:/P/git.exe', { cwd: 'c:\\p' }), false, 'X:/ con barras normales también se reconoce');
  assert.equal(w.isTrustedPath('C:\\p\\git.exe', { cwd: 'C:/p' }), false, 'cwd con barras normales');
});

test('[F14-R1][F14-R4] resolveTrustedBinary e isTrustedPath usan el resolvedor indicado (o el por defecto)', () => {
  const { resolver } = linux(['/usr/bin/git']);
  assert.deepEqual(resolveTrustedBinary('git', { cwd: '/srv/p', resolver }), { ok: true, file: '/usr/bin/git', prefixArgs: [] });
  assert.equal(isTrustedPath('/usr/bin/git', { cwd: '/srv/p', resolver }), true);
  assert.equal(isTrustedPath('git', { cwd: '/srv/p' }), false, 'resolvedor por defecto: nombre suelto nunca');
  assert.equal(resolveTrustedBinary('a/b', { cwd: '/srv/p' }).ok, false);
});

// ---------- R5: caché ----------

test('[F14-R5] caché: la segunda resolución no consulta el disco y aplica la exclusión con el cwd de esa llamada', () => {
  const files = ['/srv/a/git', '/usr/bin/git'];
  const { resolver, counter } = linux(files, { env: { PATH: '/srv/a:/usr/bin' } });
  assert.equal(resolver.resolve('git', { cwd: '/srv/b' }).file, '/srv/a/git', 'con cwd /srv/b el de /srv/a vale');
  const afterFirst = counter.isFile;
  assert.ok(afterFirst > 0);
  assert.equal(resolver.resolve('git', { cwd: '/srv/a' }).file, '/usr/bin/git', 'con cwd /srv/a se descarta');
  assert.equal(counter.isFile, afterFirst, 'sin nuevas consultas al disco');
});

test('[F14-R5] caché: una búsqueda sin candidatos no se guarda (se vuelve a buscar)', () => {
  const present = new Set();
  let calls = 0;
  const fsOps = { isFile: (p) => { calls += 1; return present.has(p); }, isExecutable: () => true, realpath: (p) => p };
  const resolver = createBinaryResolver({ platform: 'linux', env: { PATH: '/usr/bin' }, homeDir: '/home/u', fsOps });
  assert.deepEqual(resolver.resolve('git', { cwd: '/srv/p' }), { ok: false, error: BIN_ERRORS.notFound('git') });
  const first = calls;
  present.add('/usr/bin/git');
  assert.equal(resolver.resolve('git', { cwd: '/srv/p' }).file, '/usr/bin/git', 'git instalado con el panel en marcha');
  assert.ok(calls > first);
  const settled = calls;
  resolver.resolve('git', { cwd: '/srv/p' });
  assert.equal(calls, settled, 'ahora sí se guarda');
});

test('[F14-R3][F14-R5] el catálogo se lee en cada llamada (instantánea vigente)', () => {
  let projects = [];
  const { fsOps } = fakeFs(['/srv/nuevo/git', '/usr/bin/git']);
  const resolver = createBinaryResolver({ platform: 'linux', env: { PATH: '/srv/nuevo:/usr/bin' }, homeDir: '/home/u', fsOps, getProjectDirs: () => projects });
  assert.equal(resolver.resolve('git', { cwd: '/x' }).file, '/srv/nuevo/git');
  projects = ['/srv/nuevo'];
  assert.equal(resolver.resolve('git', { cwd: '/x' }).file, '/usr/bin/git', 'proyecto añadido en caliente');
});
