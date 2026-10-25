// Clasificación de carpetas en repositorio principal / worktree / ninguno (feature 13, design.md §5.2).
// Usa SOLO `git --no-optional-locks rev-parse --git-dir --git-common-dir` (entrada CMD_REPO_LAYOUT de la lista cerrada
// GIT_COMMANDS) a través del runner central de la feature 14 (git de confianza, GIT_SAFE_PREFIX, sin shell). Nunca
// llama a execFile/spawn por su cuenta. Caché de 10 min por carpeta; una carpeta inexistente no lanza git.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { CMD_REPO_LAYOUT, GIT_TIMEOUT_MS, defaultRunner } from './git-info.js';
import { pathKey, lastSegment, isWindowsPath } from './path-key.js';

export const LAYOUT_TTL_MS = 600000;
const LIKELY_WORKTREE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{6}$/i;

async function isDirectory(dir, statFn) {
  try {
    const stats = await statFn(dir);
    return Boolean(stats && typeof stats.isDirectory === 'function' && stats.isDirectory());
  } catch {
    return false;
  }
}

/** Resuelve una línea de git contra `dir` (path.win32 si alguna de las dos tiene forma Windows: git imprime C:/…). */
function resolveAgainst(dir, line) {
  const win = isWindowsPath(dir) || isWindowsPath(line) || /^[A-Za-z]:/.test(line);
  return win ? path.win32.resolve(dir, line) : path.posix.resolve(dir, line);
}

/**
 * RepoLayout de una carpeta: { kind: 'main' } | { kind: 'worktree', mainPath } | { kind: 'none' } | { kind: 'missing' }.
 * `missing` sin lanzar git; `none` ante cualquier fallo de git o salida inesperada.
 */
export async function classifyRepoLayout(dir, { runner = defaultRunner, statFn = fsp.stat } = {}) {
  if (typeof dir !== 'string' || !dir || !(await isDirectory(dir, statFn))) return { kind: 'missing' };
  let stdout;
  try {
    ({ stdout } = await runner('git', [...CMD_REPO_LAYOUT], { cwd: dir, timeout: GIT_TIMEOUT_MS, windowsHide: true }));
  } catch {
    return { kind: 'none' };
  }
  const lines = String(stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { kind: 'none' };
  const gitDir = resolveAgainst(dir, lines[0]);
  const commonDir = resolveAgainst(dir, lines[1]);
  if (pathKey(gitDir) === pathKey(commonDir)) return { kind: 'main' };
  const win = isWindowsPath(commonDir);
  const mainPath = lastSegment(commonDir).toLowerCase() === '.git' ? (win ? path.win32.dirname(commonDir) : path.posix.dirname(commonDir)) : commonDir;
  return { kind: 'worktree', mainPath };
}

/** Caché de clasificaciones por clave de ruta (la existencia de la carpeta se comprueba siempre, sin caché). */
export function createRepoLayoutCache({ runner = defaultRunner, now = Date.now, ttlMs = LAYOUT_TTL_MS, statFn = fsp.stat } = {}) {
  const cache = new Map(); // pathKey → { value, at }
  const inflight = new Map();
  async function get(dir) {
    const key = pathKey(dir);
    if (!key || !(await isDirectory(dir, statFn))) return { kind: 'missing' };
    const cached = cache.get(key);
    if (cached && now() - cached.at < ttlMs) return cached.value;
    if (inflight.has(key)) return inflight.get(key);
    const pending = classifyRepoLayout(dir, { runner, statFn: async () => ({ isDirectory: () => true }) }).then((value) => {
      cache.set(key, { value, at: now() });
      inflight.delete(key);
      return value;
    });
    inflight.set(key, pending);
    return pending;
  }
  return { get };
}

/** Worktree probable (cuando git no responde): carpeta `<slug>-<hex6>` con alguna sesión en `claude/<carpeta>`. */
export function isLikelyWorktree(merged) {
  if (!merged || typeof merged.path !== 'string' || !merged.path) return false;
  const folder = lastSegment(merged.path);
  if (!LIKELY_WORKTREE_RE.test(folder)) return false;
  const sessions = merged.claude && Array.isArray(merged.claude.sessions) ? merged.claude.sessions : [];
  return sessions.some((s) => s && s.gitBranch === `claude/${folder}`);
}

/** Clave estable de grupo virtual: 'g-' + 10 hex del sha1 de la clave de ruta del principal (no revela la ruta). */
export function groupKeyFor(mainPath) {
  return `g-${crypto.createHash('sha1').update(String(pathKey(mainPath))).digest('hex').slice(0, 10)}`;
}

/** Nombre del grupo virtual: carpeta del principal sin `.git` final. */
export function groupNameFor(mainPath) {
  return lastSegment(mainPath).replace(/\.git$/i, '');
}
