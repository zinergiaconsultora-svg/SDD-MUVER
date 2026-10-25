// Lectura del estado git de un proyecto mediante execFile (sin shell, argumentos fijos).
// Feature 14: toda llamada git del panel pasa por el runner central (createGitRunner): resuelve `git` a una ruta
// absoluta de confianza (nunca la carpeta del proyecto), antepone -c core.fsmonitor=false y en Windows añade
// NoDefaultCurrentDirectoryInExePath=1 al entorno del hijo.
import { execFile } from 'node:child_process';

import { defaultResolver, BIN_ERRORS } from './trusted-bin.js';
import { lastSegment } from './path-key.js';

export const GIT_TIMEOUT_MS = 5000;

/** Lista cerrada de comandos git permitidos (R12). Ningún dato del cliente entra aquí. */
export const GIT_COMMANDS = Object.freeze([
  Object.freeze(['rev-parse', '--is-inside-work-tree']),
  Object.freeze(['rev-parse', '--abbrev-ref', 'HEAD']),
  Object.freeze(['log', '-1', '--format=%H%x1f%cI%x1f%s']),
  Object.freeze(['log', '-10', '--format=%H%x1f%cI%x1f%s']),
  // Fase 4 (F4-R61, mejora M4): sin tomar el bloqueo opcional del índice mientras Claude trabaja en el repo.
  Object.freeze(['--no-optional-locks', 'status', '--porcelain']),
  // Feature 13 (design.md §5.7): clasificación de worktrees (lib/repo-layout.js). getGitInfo no la usa.
  Object.freeze(['--no-optional-locks', 'rev-parse', '--git-dir', '--git-common-dir']),
]);

const [CMD_IS_REPO, CMD_BRANCH, CMD_LAST_COMMIT, CMD_RECENT_COMMITS, CMD_STATUS, REPO_LAYOUT] = GIT_COMMANDS;
/** Feature 13: `git --no-optional-locks rev-parse --git-dir --git-common-dir` (entrada de la lista cerrada). */
export const CMD_REPO_LAYOUT = REPO_LAYOUT;

/**
 * Opciones globales que se anteponen a TODA llamada git del panel (design.md §5.2, D7): sin core.fsmonitor del repo y,
 * desde la corrección de la revisión (MA2), sin verificar firmas en `git log` (log.showSignature ejecutaría
 * gpg.program del repo en cada sondeo). gpg.program NO se anula: rompería la firma de commits del humano.
 */
export const GIT_SAFE_PREFIX = Object.freeze(['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false']);

/**
 * Corrección revisión F14 (MA2): consulta de los filtros definidos en la configuración LOCAL del repo (con sus
 * include). Se hace antes de cada status/diff del panel para anularlos con -c (los filtros globales del humano, como
 * git-lfs, se respetan). No se aplica a `git add`/commit, donde los filtros son legítimos (y se avisa en el diálogo).
 */
export const GIT_LOCAL_FILTERS_ARGS = Object.freeze(['--no-optional-locks', 'config', '--local', '--includes', '--get-regexp', '^filter\\.']);
const MAX_NEUTRALIZED_FILTERS = 100;
const FILTER_KEY_RE = /^filter\.(.+)\.(clean|smudge|process|required)$/i;

/** Nombres de filtro de la salida de `git config --get-regexp ^filter\.` (clave y valor separados por espacio). */
export function parseFilterNames(stdout) {
  const names = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const key = line.split(/\s/)[0];
    const match = FILTER_KEY_RE.exec(key || '');
    if (match && !names.includes(match[1])) names.push(match[1]);
    if (names.length >= MAX_NEUTRALIZED_FILTERS) break;
  }
  return names;
}

/** Opciones -c que anulan cada filtro (sin clean/smudge/process y no obligatorio). */
export function neutralizeFilterArgs(names) {
  const out = [];
  for (const name of names) {
    out.push('-c', `filter.${name}.clean=`, '-c', `filter.${name}.smudge=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`);
  }
  return out;
}

/** true si la llamada lee contenido del árbol de trabajo (status o diff) y podría aplicar filtros. */
function readsWorktree(args) {
  return args.includes('status') || args.includes('diff');
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
    const env = platform === 'win32' ? { ...(opts.env || process.env), NoDefaultCurrentDirectoryInExePath: '1' } : opts.env;
    const options = { ...opts, shell: false };
    if (env) options.env = env;
    else delete options.env;
    const run = (gitArgs) => new Promise((resolve, reject) => {
      execFileImpl(resolved.file, [...GIT_SAFE_PREFIX, ...resolved.prefixArgs, ...gitArgs], options, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }));
        else resolve({ stdout, stderr });
      });
    });
    if (!readsWorktree(args)) return run(args);
    // Sin coincidencias, `git config --get-regexp` sale con código 1: se sigue sin anular nada.
    return run([...GIT_LOCAL_FILTERS_ARGS])
      .then(({ stdout }) => parseFilterNames(stdout), () => [])
      .then((names) => run([...neutralizeFilterArgs(names), ...args]));
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

  try {
    const { stdout } = await run(CMD_STATUS);
    const status = parseStatus(stdout);
    info.dirtyCount = status.dirtyCount;
    info.dirtyFiles = detail ? status.dirtyFiles : [];
  } catch {
    info.dirtyCount = null;
    info.dirtyFiles = [];
  }

  return info;
}
