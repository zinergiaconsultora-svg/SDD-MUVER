// Lectura del estado git de un proyecto mediante execFile (sin shell, argumentos fijos).
// Feature 14: toda llamada git del panel pasa por el runner central (createGitRunner): resuelve `git` a una ruta
// absoluta de confianza (nunca la carpeta del proyecto), antepone -c core.fsmonitor=false y en Windows añade
// NoDefaultCurrentDirectoryInExePath=1 al entorno del hijo.
import { execFile } from 'node:child_process';

import { defaultResolver, BIN_ERRORS } from './trusted-bin.js';
import { lastSegment } from './path-key.js';

export const GIT_TIMEOUT_MS = 5000;

/**
 * Expresión (feature 19, design.md §3.2) de las claves de la configuración que ejecutan programas. git la compara con
 * el nombre canónico de la clave (sección y variable en minúsculas, subsección tal cual).
 */
export const EXEC_CONFIG_RE =
  '^(filter\\..+\\.(clean|smudge|process)|gpg\\.(.+\\.)?program|gpg\\.ssh\\.defaultkeycommand'
  + '|core\\.(askpass|sshcommand|gitproxy)|credential\\.(.+\\.)?helper|remote\\..+\\.(receivepack|uploadpack|vcs)'
  + '|protocol\\..+\\.allow|url\\..+\\.(insteadof|pushinsteadof))$';

/** Un nombre de filtro admitido para anularlo por línea de órdenes sin romper el `-c filter.<n>.clean=` (design.md §3.3). */
export const FILTER_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

const MAX_EXEC_KEYS = 20;
const MAX_EXEC_KEY_CHARS = 200;

/** Lista cerrada de comandos git permitidos (R12). Ningún dato del cliente entra aquí. */
export const GIT_COMMANDS = Object.freeze([
  Object.freeze(['rev-parse', '--is-inside-work-tree']),
  Object.freeze(['rev-parse', '--abbrev-ref', 'HEAD']),
  Object.freeze(['log', '-1', '--format=%H%x1f%cI%x1f%s']),
  Object.freeze(['log', '-10', '--format=%H%x1f%cI%x1f%s']),
  // Fase 4 (F4-R61, mejora M4): sin tomar el bloqueo opcional del índice mientras Claude trabaja en el repo.
  // Feature 19 (D4): --ignore-submodules=dirty para no entrar en la configuración local de los submódulos.
  Object.freeze(['--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=dirty']),
  // Feature 19 (§3.2): lectura de las claves locales que ejecutan programas; la segunda es la alternativa para git < 2.26.
  Object.freeze(['--no-optional-locks', 'config', '--show-scope', '--name-only', '--get-regexp', EXEC_CONFIG_RE]),
  Object.freeze(['--no-optional-locks', 'config', '--name-only', '--get-regexp', EXEC_CONFIG_RE]),
]);

const [CMD_IS_REPO, CMD_BRANCH, CMD_LAST_COMMIT, CMD_RECENT_COMMITS, CMD_STATUS, CMD_EXEC_CONFIG, CMD_EXEC_CONFIG_NOSCOPE] = GIT_COMMANDS;

/**
 * Opciones globales que se anteponen a TODA llamada git del panel (feature 19, D1): sin core.fsmonitor del repo, sin
 * verificar firmas en `git log` (evita gpg.program) y sin el transporte `ext::` (una URL que es un programa). Los dos
 * primeros elementos siguen siendo `-c core.fsmonitor=false` (tests de la feature 14 que miran args[0]/args[1]).
 */
export const GIT_SAFE_PREFIX = Object.freeze([
  '-c', 'core.fsmonitor=false',
  '-c', 'log.showSignature=false',
  '-c', 'protocol.ext.allow=never',
]);

/**
 * Anulación de filtros por nombre (design.md §3.3): deja cada driver `clean`/`smudge`/`process` sin programa y pone
 * `required=false` para que git no falle. Se antepone a los argumentos de las lecturas `status`/`diff`.
 */
export function filterOverrideArgs(filters) {
  const out = [];
  for (const n of filters) {
    out.push('-c', `filter.${n}.clean=`, '-c', `filter.${n}.smudge=`, '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`);
  }
  return out;
}

/**
 * Lee la configuración local de un repo (feature 19, §3.2) → { filters, unsafeFilters, execKeys }:
 * - `execKeys`: claves locales/worktree que ejecutan programas (únicas, recortadas, ordenadas, como mucho 20).
 * - `filters`: nombres de filtro locales con un nombre admitido (`FILTER_NAME_RE`), únicos y ordenados.
 * - `unsafeFilters`: nombres de filtro locales con un nombre no admitido.
 * Si git no admite `--show-scope` (código 129) repite sin esa opción y trata todo como local; cualquier otro fallo o
 * la falta de coincidencias (código 1) devuelve las tres listas vacías (fallo abierto justificado, §3.2).
 */
export async function readRepoExecConfig(dir, { runner = defaultRunner, timeout = GIT_TIMEOUT_MS } = {}) {
  const empty = { filters: [], unsafeFilters: [], execKeys: [] };
  const run = (args) => runner('git', [...args], { cwd: dir, timeout, windowsHide: true });
  let lines;
  let scoped = true;
  try {
    lines = String((await run(CMD_EXEC_CONFIG)).stdout);
  } catch (err) {
    if (err && err.code === 129) {
      try {
        lines = String((await run(CMD_EXEC_CONFIG_NOSCOPE)).stdout);
        scoped = false;
      } catch {
        return empty;
      }
    } else {
      return empty;
    }
  }
  const execSet = new Set();
  const filterSet = new Set();
  const unsafeSet = new Set();
  for (const line of lines.split(/\r?\n/)) {
    if (line === '') continue;
    const tab = line.indexOf('\t');
    const scope = scoped && tab >= 0 ? line.slice(0, tab) : 'local';
    const key = scoped && tab >= 0 ? line.slice(tab + 1) : line;
    if (scope !== 'local' && scope !== 'worktree') continue;
    execSet.add(key.length > MAX_EXEC_KEY_CHARS ? key.slice(0, MAX_EXEC_KEY_CHARS) : key);
    if (key.startsWith('filter.')) {
      const name = key.slice('filter.'.length, key.lastIndexOf('.'));
      (FILTER_NAME_RE.test(name) ? filterSet : unsafeSet).add(name);
    }
  }
  return {
    filters: [...filterSet].sort(),
    unsafeFilters: [...unsafeSet].sort(),
    execKeys: [...execSet].sort().slice(0, MAX_EXEC_KEYS),
  };
}

function untrustedError(file) {
  return Object.assign(new Error(BIN_ERRORS.untrusted(lastSegment(String(file)))), { code: 'EUNTRUSTED' });
}

/**
 * Runner de git central: (file, args, opts) → Promise<{ stdout, stderr }>. Solo acepta el nombre lógico `git`, que
 * resuelve con el resolvedor (cwd = carpeta de la llamada) y comprueba con isTrustedPath antes de lanzar.
 */
export function createGitRunner({ resolver = defaultResolver, execFileImpl = execFile, platform = process.platform } = {}) {
  return (file, args, opts = {}) => {
    if (file !== 'git') return Promise.reject(untrustedError(file));
    const resolved = resolver.resolve('git', { cwd: opts.cwd });
    if (!resolved.ok) return Promise.reject(Object.assign(new Error(resolved.error), { code: 'ENOTFOUND_BIN' }));
    if (!resolver.isTrustedPath(resolved.file, { cwd: opts.cwd })) return Promise.reject(untrustedError(resolved.file));
    // Feature 19 (§3.5): las lecturas nunca descargan nada de un clon parcial (GIT_NO_LAZY_FETCH, git ≥ 2.45); en
    // Windows se conserva NoDefaultCurrentDirectoryInExePath=1. El entorno es siempre el recibido (o process.env) más
    // esas variables, sin quitar ninguna otra.
    const base = opts.env || process.env;
    const env = {
      ...base,
      GIT_NO_LAZY_FETCH: '1',
      ...(platform === 'win32' ? { NoDefaultCurrentDirectoryInExePath: '1' } : {}),
    };
    const options = { ...opts, shell: false, env };
    return new Promise((resolve, reject) => {
      execFileImpl(resolved.file, [...GIT_SAFE_PREFIX, ...resolved.prefixArgs, ...args], options, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }));
        else resolve({ stdout, stderr });
      });
    });
  };
}

/** Runner por defecto: resolvedor por defecto (excluye el cwd de la llamada) y execFile sin shell. */
export const defaultRunner = createGitRunner();

function absentInfo() {
  return { isRepo: false, branch: null, lastCommit: null, dirtyCount: null, recentCommits: [], dirtyFiles: [] };
}

function parseCommits(stdout) {
  return String(stdout)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [hash, date, ...rest] = line.split('\x1f');
      return { hash: hash.trim(), date: (date || '').trim(), message: rest.join('\x1f').trim() };
    });
}

function parseStatus(stdout) {
  const lines = String(stdout).split(/\r?\n/).filter((line) => line !== '');
  const files = lines.map((line) => {
    // Formato porcelain: "XY ruta" (o "XY origen -> destino" en renombrados).
    const rawPath = line.slice(3).trim();
    const arrow = rawPath.indexOf(' -> ');
    return arrow >= 0 ? rawPath.slice(arrow + 4).trim() : rawPath;
  });
  return { dirtyCount: lines.length, dirtyFiles: files };
}

/**
 * Lee el estado git de `dir`. Cualquier fallo del runner (git ausente, no repo, timeout)
 * devuelve la forma ausente. Un repo sin commits devuelve isRepo true y lastCommit null.
 */
export async function getGitInfo(dir, { runner = defaultRunner, detail = false } = {}) {
  const run = (args) => runner('git', [...args], { cwd: dir, timeout: GIT_TIMEOUT_MS, windowsHide: true });
  const info = absentInfo();

  try {
    const { stdout } = await run(CMD_IS_REPO);
    if (String(stdout).trim() !== 'true') return info;
  } catch {
    return info;
  }
  info.isRepo = true;

  try {
    const { stdout } = await run(CMD_BRANCH);
    info.branch = String(stdout).trim() || null;
  } catch {
    info.branch = null;
  }

  try {
    const { stdout } = await run(detail ? CMD_RECENT_COMMITS : CMD_LAST_COMMIT);
    const commits = parseCommits(stdout);
    info.lastCommit = commits[0] || null;
    info.recentCommits = detail ? commits.slice(0, 10) : [];
  } catch {
    // Repo sin commits: `git log` falla con código ≠ 0.
    info.lastCommit = null;
    info.recentCommits = [];
  }

  // Feature 19 (§5.1): se leen los filtros locales antes del status. Con un nombre de filtro no admitido no se
  // ejecuta ningún status/diff del repo; si no, el status lleva delante la anulación de los filtros locales.
  const cfg = await readRepoExecConfig(dir, { runner });
  if (cfg.unsafeFilters.length) {
    info.dirtyCount = null;
    info.dirtyFiles = [];
    return info;
  }

  try {
    const { stdout } = await run([...filterOverrideArgs(cfg.filters), ...CMD_STATUS]);
    const status = parseStatus(stdout);
    info.dirtyCount = status.dirtyCount;
    info.dirtyFiles = detail ? status.dirtyFiles : [];
  } catch {
    info.dirtyCount = null;
    info.dirtyFiles = [];
  }

  return info;
}
