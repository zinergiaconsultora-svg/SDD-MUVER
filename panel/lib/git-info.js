// Lectura del estado git de un proyecto mediante execFile (sin shell, argumentos fijos).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const GIT_TIMEOUT_MS = 5000;

/** Lista cerrada de comandos git permitidos (R12). Ningún dato del cliente entra aquí. */
export const GIT_COMMANDS = Object.freeze([
  Object.freeze(['rev-parse', '--is-inside-work-tree']),
  Object.freeze(['rev-parse', '--abbrev-ref', 'HEAD']),
  Object.freeze(['log', '-1', '--format=%H%x1f%cI%x1f%s']),
  Object.freeze(['log', '-10', '--format=%H%x1f%cI%x1f%s']),
  // Fase 4 (F4-R61, mejora M4): sin tomar el bloqueo opcional del índice mientras Claude trabaja en el repo.
  Object.freeze(['--no-optional-locks', 'status', '--porcelain']),
]);

const [CMD_IS_REPO, CMD_BRANCH, CMD_LAST_COMMIT, CMD_RECENT_COMMITS, CMD_STATUS] = GIT_COMMANDS;

/** Runner por defecto: execFile prometificado. */
export function defaultRunner(file, args, opts) {
  return execFileAsync(file, args, opts);
}

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
