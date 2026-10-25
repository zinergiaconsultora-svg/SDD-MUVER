// Resolvedor de ejecutables de confianza (feature 14, design.md §3 y §5.1). El panel nunca lanza un programa por
// nombre suelto ni con una ruta dentro de la carpeta de un proyecto: los nombres se resuelven a rutas absolutas
// buscando solo en las entradas absolutas de PATH y en rutas conocidas, y se descartan los candidatos que están en el
// cwd de la llamada (también su ruta real, feature 15) o en las carpetas del catálogo (por ruta y por ruta real). En
// Windows libuv buscaría un nombre suelto primero en el cwd del hijo (M1). Las rutas Windows se componen con
// path.win32 para que los tests en Linux cubran esa lógica.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pathKey } from './path-key.js';

export const BIN_ERRORS = Object.freeze({
  invalidName: (name) => `Nombre de programa no válido: «${name}»`,
  notFound: (name) => `No se encontró «${name}» en el PATH del panel (se ignoran las rutas relativas y las carpetas de los proyectos): instálalo o revisa el PATH y reinicia el panel`,
  onlyInProject: (name) => `«${name}» solo está dentro de la carpeta de un proyecto y el panel no ejecuta programas de los proyectos: instálalo fuera de ellos o revisa el PATH`,
  untrusted: (name) => `No se ejecuta «${name}»: el panel solo lanza programas con ruta absoluta fuera de las carpetas de los proyectos`,
});

// Textos de la fase 4 que se conservan (exec-utils.js los reexporta).
export const CMD_SCRIPT_ERROR = (name) => `"${name}" es un script .cmd/.bat y el panel no usa shell: indica la ruta de un .exe o usa node <script>.js`;
export const NO_GIT_BASH_ERROR = 'No se encontró Git Bash: instala Git for Windows o configura el comando de tests';

const NAME_RE = /^[A-Za-z0-9._+-]{1,64}$/;
const WIN_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/; // X:\ (o X:/, que Windows también acepta)

export const defaultFsOps = Object.freeze({
  isFile(p) {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
  isExecutable(p) {
    if (process.platform === 'win32') return true;
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  realpath(p) {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return null;
    }
  },
});

/** true si `p` es absoluta según la plataforma (win32: X:\ o \\servidor; POSIX: /). */
function isAbsoluteFor(p, platform) {
  if (typeof p !== 'string' || p === '') return false;
  if (platform === 'win32') return WIN_ABSOLUTE_RE.test(p) || p.startsWith('\\\\');
  return p.startsWith('/');
}

/** Valor del PATH del entorno (en Windows la clave puede ser Path u otra combinación de mayúsculas). */
function rawPath(env, platform) {
  if (!env) return '';
  if (env.PATH !== undefined) return env.PATH;
  if (platform === 'win32') {
    if (env.Path !== undefined) return env.Path;
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path');
    return key ? env[key] : '';
  }
  return '';
}

/**
 * Entradas de PATH utilizables (design.md §3.3): sin espacios ni comillas que las rodeen; se descartan las vacías,
 * ".", las que contienen %, las relativas (win32: deben empezar por X:\ o \\) y las repetidas.
 */
export function parsePathEntries(raw, platform = process.platform) {
  const separator = platform === 'win32' ? ';' : ':';
  const out = [];
  const seen = new Set();
  for (const piece of String(raw ?? '').split(separator)) {
    let entry = piece.trim();
    if (entry.length >= 2 && entry.startsWith('"') && entry.endsWith('"')) entry = entry.slice(1, -1).trim();
    if (entry === '' || entry === '.' || entry.includes('%')) continue;
    if (!isAbsoluteFor(entry, platform)) continue;
    const key = pathKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Candidatos de Git Bash en Windows (orden de la fase 4), solo absolutos y nunca System32/Sysnative (bash de WSL). */
export function gitBashCandidates({ env = {}, bashBin = null } = {}) {
  const win = path.win32;
  const list = [
    bashBin,
    env.CLAUDE_CODE_GIT_BASH_PATH,
    env.ProgramFiles ? win.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe') : null,
    env['ProgramFiles(x86)'] ? win.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe') : null,
    env.LOCALAPPDATA ? win.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe') : null,
  ];
  return list.filter((candidate) => {
    if (typeof candidate !== 'string' || !candidate.trim()) return false;
    if (!isAbsoluteFor(candidate, 'win32')) return false;
    const key = pathKey(candidate) || '';
    return !key.includes('\\system32\\') && !key.includes('\\sysnative\\');
  });
}

/** Ruta absoluta de taskkill.exe (design.md §5.3): %SystemRoot%\System32\taskkill.exe. */
export function taskkillPath(env = process.env) {
  const root = (env && (env.SystemRoot || env.SYSTEMROOT)) || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'taskkill.exe');
}

/**
 * Crea un resolvedor. `getProjectDirs()` devuelve las carpetas del catálogo vigente (instantánea); `fsOps` permite
 * inyectar el sistema de ficheros en los tests.
 */
export function createBinaryResolver({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  panelDir = process.cwd(),
  homeDir,
  fsOps = defaultFsOps,
  getProjectDirs = () => [],
  bashBin = null,
} = {}) {
  const isWin = platform === 'win32';
  const p = isWin ? path.win32 : path.posix;
  const sep = isWin ? '\\' : '/';
  const home = homeDir ?? (isWin ? (env && env.USERPROFILE) || os.homedir() : (env && env.HOME) || os.homedir());
  const homeKey = pathKey(home);
  const cache = new Map(); // nombre → candidatos [{ file, prefixArgs, real, extra }]
  void panelDir; // reservado para CLAUDE_BIN relativo (lo resuelve claude-cli.js con la misma carpeta)

  const exists = (file) => Boolean(fsOps.isFile(file));
  const runnable = (file) => exists(file) && (isWin || Boolean(fsOps.isExecutable(file)));

  function isRootKey(key) {
    if (key === '/') return true;
    if (/^[a-z]:\\$/.test(key)) return true;
    if (key.startsWith('\\\\')) return key.slice(2).split('\\').filter(Boolean).length <= 2;
    return false;
  }

  /** Proyecto contenedor: raíz, la carpeta personal o un ancestro suyo. */
  function isContainerKey(key) {
    if (isRootKey(key)) return true;
    if (!homeKey) return false;
    return homeKey === key || homeKey.startsWith(key + sep);
  }

  /** Ruta real absoluta de una carpeta, o null si no existe, falla o no es absoluta (feature 15, design.md §5). */
  function realDir(dir) {
    if (!isAbsoluteFor(dir, platform)) return null;
    try {
      const real = fsOps.realpath(dir);
      return isAbsoluteFor(real, platform) ? real : null;
    } catch {
      return null;
    }
  }

  function excludedDirs({ cwd } = {}) {
    const out = [];
    const seen = new Set();
    let projects = [];
    try {
      projects = getProjectDirs() || [];
    } catch {
      projects = [];
    }
    // Feature 15 (M3): la ruta real del cwd va justo detrás del cwd (enlace simbólico o unión); los repetidos se descartan.
    for (const dir of [cwd, realDir(cwd), ...projects]) {
      if (!isAbsoluteFor(dir, platform)) continue;
      const key = pathKey(dir);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(dir);
    }
    return out;
  }

  function isExcluded(file, excluded) {
    if (typeof file !== 'string' || !file) return false;
    const fileKey = pathKey(file);
    const dirKey = pathKey(p.dirname(file));
    for (const dir of excluded) {
      const key = pathKey(dir);
      if (dirKey === key) return true; // directamente en la raíz del proyecto o del cwd
      if (!isContainerKey(key) && fileKey.startsWith(key.endsWith(sep) ? key : key + sep)) return true;
    }
    return false;
  }

  function isTrusted(file, { cwd } = {}) {
    if (!isAbsoluteFor(file, platform)) return false;
    const excluded = excludedDirs({ cwd });
    if (isExcluded(file, excluded)) return false;
    const real = fsOps.realpath(file);
    return !isExcluded(real || file, excluded);
  }

  function logicalName(name) {
    return name.toLowerCase().replace(/\.(exe|com)$/, '');
  }

  function fileNames(name) {
    if (!isWin) return [name];
    return /\.(exe|com)$/i.test(name) ? [name] : [`${name}.com`, `${name}.exe`];
  }

  function candidate(file, prefixArgs = [], extra = []) {
    return { file, prefixArgs, real: fsOps.realpath(file), extra: extra.map((e) => ({ file: e, real: fsOps.realpath(e) })) };
  }

  /** Rutas conocidas que se prueban después de PATH (design.md §3.2). */
  function knownPaths(logical, dirs) {
    const out = [];
    if (isWin && logical === 'git') {
      for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
        if (isAbsoluteFor(base, platform)) out.push(candidateIf(p.join(base, 'Git', 'cmd', 'git.exe')));
      }
      if (isAbsoluteFor(env.LOCALAPPDATA, platform)) out.push(candidateIf(p.join(env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe')));
    }
    if (logical === 'claude') {
      if (isWin) {
        if (isAbsoluteFor(env.USERPROFILE, platform)) out.push(candidateIf(p.join(env.USERPROFILE, '.local', 'bin', 'claude.exe')));
        for (const dir of dirs) {
          const cli = p.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
          if (exists(p.join(dir, 'claude.cmd')) && exists(cli)) out.push(candidate(execPath, [cli], [cli]));
        }
      } else {
        const base = (env && env.HOME) || home;
        if (isAbsoluteFor(base, platform)) out.push(candidateIf(p.join(base, '.local', 'bin', 'claude')));
      }
    }
    return out.filter(Boolean);
  }

  function candidateIf(file) {
    return runnable(file) ? candidate(file) : null;
  }

  /** Búsqueda en disco (se guarda en caché solo si encuentra algo). */
  function search(name) {
    const logical = logicalName(name);
    const dirs = parsePathEntries(rawPath(env, platform), platform);
    let list = [];
    if (logical === 'bash') {
      if (isWin) {
        list = gitBashCandidates({ env, bashBin }).filter(exists).map((file) => candidate(file));
      } else if (isAbsoluteFor(bashBin, platform)) {
        const own = candidateIf(bashBin);
        if (own) list.push(own);
      }
    }
    if (!(isWin && logical === 'bash')) {
      for (const dir of dirs) {
        for (const fileName of fileNames(name)) {
          const file = p.join(dir, fileName);
          if (runnable(file)) list.push(candidate(file));
        }
      }
      list.push(...knownPaths(logical, dirs));
    }
    const seen = new Set();
    list = list.filter((c) => {
      const key = `${pathKey(c.file)}|${c.prefixArgs.join('|')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (list.length) cache.set(name, list);
    return { list, dirs };
  }

  /** En Windows: ¿solo hay un .cmd/.bat del nombre en las carpetas de PATH? */
  function onlyScript(name, dirs) {
    if (!isWin) return false;
    const base = name.replace(/\.(cmd|bat|exe|com)$/i, '');
    return dirs.some((dir) => exists(p.join(dir, `${base}.cmd`)) || exists(p.join(dir, `${base}.bat`)));
  }

  function fixed(file, prefixArgs, name, cwd) {
    if (!isTrusted(file, { cwd })) return { ok: false, error: BIN_ERRORS.untrusted(name) };
    return { ok: true, file, prefixArgs };
  }

  function resolve(name, { cwd } = {}) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, error: BIN_ERRORS.invalidName(name) };
    const logical = logicalName(name);
    if (logical === 'node') return fixed(execPath, [], name, cwd);
    if (isWin && logical === 'taskkill') return fixed(taskkillPath(env), [], name, cwd);
    if (isWin && (logical === 'npm' || logical === 'npx')) {
      const cli = p.join(p.dirname(execPath), 'node_modules', 'npm', 'bin', `${logical}-cli.js`);
      if (!exists(cli)) return { ok: false, error: CMD_SCRIPT_ERROR(name) };
      if (!isTrusted(cli, { cwd })) return { ok: false, error: BIN_ERRORS.onlyInProject(name) };
      return fixed(execPath, [cli], name, cwd);
    }
    let candidates = cache.get(name);
    let dirs = null;
    if (!candidates) {
      const found = search(name);
      candidates = found.list;
      dirs = found.dirs;
    }
    const excluded = excludedDirs({ cwd });
    for (const c of candidates) {
      const paths = [c, ...c.extra];
      if (paths.some((x) => isExcluded(x.file, excluded) || (x.real && isExcluded(x.real, excluded)))) continue;
      return { ok: true, file: c.file, prefixArgs: [...c.prefixArgs] };
    }
    if (candidates.length > 0) return { ok: false, error: BIN_ERRORS.onlyInProject(name) };
    if (isWin && logical === 'bash') return { ok: false, error: NO_GIT_BASH_ERROR };
    if (onlyScript(name, dirs ?? parsePathEntries(rawPath(env, platform), platform))) return { ok: false, error: CMD_SCRIPT_ERROR(name) };
    return { ok: false, error: BIN_ERRORS.notFound(name) };
  }

  return { resolve, isTrustedPath: isTrusted, excludedDirs };
}

/** Resolvedor por defecto: sin catálogo (solo excluye el cwd de la llamada). La app crea el suyo (design.md §5.9). */
export const defaultResolver = createBinaryResolver();

export function resolveTrustedBinary(name, { cwd, resolver = defaultResolver } = {}) {
  return resolver.resolve(name, { cwd });
}

export function isTrustedPath(file, { cwd, resolver = defaultResolver } = {}) {
  return resolver.isTrustedPath(file, { cwd });
}
