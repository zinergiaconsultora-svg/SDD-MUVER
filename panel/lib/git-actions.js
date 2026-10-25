// "Ver cambios" y "Commit y push" (design.md §5.8). Todos los comandos git usan `git` con la opción global
// --no-optional-locks y argumentos de una lista fija; del cliente solo entran, como argumentos sueltos, la ruta ya
// validada contra la lista de cambios o el mensaje del commit. El push nunca se fuerza.
// Feature 14: las consultas pasan por el runner central (prefijo -c core.fsmonitor=false y git de confianza); los
// pasos de "Commit y push" llevan el prefijo explícito; el diff usa pathspec literal y no ejecuta drivers externos ni
// textconv; los hooks se ejecutan (decisión D8) pero GET /changes los lista para avisar; el push usa ssh en BatchMode.
import fs from 'node:fs';
import path from 'node:path';

import { defaultRunner, GIT_SAFE_PREFIX } from './git-info.js';

export const GIT_ACTION_ARGS = Object.freeze({
  isRepo: Object.freeze(['--no-optional-locks', 'rev-parse', '--is-inside-work-tree']),
  status: Object.freeze(['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
  hasHead: Object.freeze(['--no-optional-locks', 'rev-parse', '--verify', '-q', 'HEAD']),
  branch: Object.freeze(['--no-optional-locks', 'rev-parse', '--abbrev-ref', 'HEAD']),
  symbolicBranch: Object.freeze(['--no-optional-locks', 'symbolic-ref', '--short', '-q', 'HEAD']),
  upstream: Object.freeze(['--no-optional-locks', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
  statHead: Object.freeze(['--no-optional-locks', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--stat']),
  statCached: Object.freeze(['--no-optional-locks', 'diff', '--no-ext-diff', '--no-textconv', '--cached', '--stat']),
  // + ruta validada; --literal-pathspecs: un fichero llamado "*" o ":(glob)…" es solo ese fichero (N3).
  diffHead: Object.freeze(['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']),
  diffWorktree: Object.freeze(['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--']), // repo sin commits
  hooksDir: Object.freeze(['--no-optional-locks', 'rev-parse', '--git-path', 'hooks']),
  hooksPathConfig: Object.freeze(['--no-optional-locks', 'config', '--get', 'core.hooksPath']),
  add: Object.freeze(['--no-optional-locks', 'add', '-A']),
  commit: Object.freeze(['--no-optional-locks', 'commit', '-m']), // + mensaje
  push: Object.freeze(['--no-optional-locks', 'push']),
  pushSetUpstream: Object.freeze(['--no-optional-locks', 'push', '-u', 'origin']), // + rama
});

export const GIT_ACTION_TIMEOUT_MS = 15000;
export const MAX_CHANGED_FILES = 500;
export const MAX_STAT_BYTES = 20 * 1024;
export const MAX_DIFF_BYTES = 200 * 1024;
export const MAX_COMMIT_MESSAGE_CHARS = 2000;
export const GIT_STEP_ENV = Object.freeze({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
export const PUSH_SSH_COMMAND = 'ssh -o BatchMode=yes';
export const MAX_LISTED_HOOKS = 20;
const HOOK_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const MAX_BUFFER = 10 * 1024 * 1024;

const GIT_ERRORS = Object.freeze({
  notRepo: 'El proyecto no es un repositorio git',
  fileNotChanged: 'El fichero no está en la lista de cambios',
  messageRequired: 'Escribe el mensaje del commit',
  messageTooLong: 'El mensaje del commit supera los 2000 caracteres',
  nothingToCommit: 'No hay cambios que commitear',
  detachedHead: 'No se puede hacer push sin rama (HEAD separado)',
});

function git(dir, args, { runner = defaultRunner } = {}) {
  return runner('git', [...args], { cwd: dir, timeout: GIT_ACTION_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_BUFFER });
}

async function tryGit(dir, args, options) {
  try {
    const { stdout } = await git(dir, args, options);
    return { ok: true, stdout: String(stdout) };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/** Recorta a `maxBytes` bytes sin partir un carácter UTF-8. → { text, truncated }. */
export function clipBytes(text, maxBytes) {
  const buffer = Buffer.from(String(text), 'utf8');
  if (buffer.length <= maxBytes) return { text: String(text), truncated: false };
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true };
}

/** `git status --porcelain=v1 -z` → [{ path, status }]; en renombrados/copias se salta la ruta de origen. */
export function parsePorcelainZ(stdout) {
  const fields = String(stdout).split('\0');
  const files = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    files.push({ path: field.slice(3), status });
    if (/[RC]/.test(status)) i += 1;
  }
  return files;
}

async function isRepo(dir, options) {
  const r = await tryGit(dir, GIT_ACTION_ARGS.isRepo, options);
  return r.ok && r.stdout.trim() === 'true';
}

/** true si `dir` está dentro de un repositorio git. */
export function isGitRepo(dir, { runner } = {}) {
  return isRepo(dir, { runner });
}

async function currentBranch(dir, options) {
  const r = await tryGit(dir, GIT_ACTION_ARGS.branch, options);
  if (r.ok && r.stdout.trim()) return r.stdout.trim();
  // Repo sin commits: rev-parse no resuelve HEAD, pero symbolic-ref sí da la rama.
  const sym = await tryGit(dir, GIT_ACTION_ARGS.symbolicBranch, options);
  return sym.ok && sym.stdout.trim() ? sym.stdout.trim() : null;
}

async function hasHead(dir, options) {
  return (await tryGit(dir, GIT_ACTION_ARGS.hasHead, options)).ok;
}

/**
 * Hooks activos del repo (feature 14, design.md §5.4): ficheros (o enlaces) de la carpeta de hooks efectiva que no
 * terminan en .sample y tienen un nombre seguro, en orden alfabético y como mucho 20. Cualquier error → lista vacía.
 */
export async function listActiveHooks(dir, { runner, readdir = fs.promises.readdir } = {}) {
  const options = { runner };
  try {
    const hooksDir = await tryGit(dir, GIT_ACTION_ARGS.hooksDir, options);
    if (!hooksDir.ok || !hooksDir.stdout.trim()) return { hooks: [], hooksPathCustom: false };
    const entries = await readdir(path.resolve(dir, hooksDir.stdout.trim()), { withFileTypes: true });
    const hooks = entries
      .filter((e) => e && (e.isFile() || e.isSymbolicLink()) && !e.name.endsWith('.sample') && HOOK_NAME_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .slice(0, MAX_LISTED_HOOKS);
    const custom = await tryGit(dir, GIT_ACTION_ARGS.hooksPathConfig, options);
    return { hooks, hooksPathCustom: custom.ok && custom.stdout.trim() !== '' };
  } catch {
    return { hooks: [], hooksPathCustom: false };
  }
}

/** Lista de cambios (contrato §4.3) o { ok: false, status: 409, error } si no es un repo. */
export async function getChanges(dir, { runner } = {}) {
  const options = { runner };
  if (!(await isRepo(dir, options))) return { ok: false, status: 409, error: GIT_ERRORS.notRepo };
  const status = await tryGit(dir, GIT_ACTION_ARGS.status, options);
  const all = parsePorcelainZ(status.stdout);
  const branch = await currentBranch(dir, options);
  const head = await hasHead(dir, options);
  const stat = await tryGit(dir, head ? GIT_ACTION_ARGS.statHead : GIT_ACTION_ARGS.statCached, options);
  return {
    ok: true,
    branch,
    files: all.slice(0, MAX_CHANGED_FILES),
    stat: clipBytes(stat.stdout, MAX_STAT_BYTES).text,
    truncated: all.length > MAX_CHANGED_FILES,
    hasHead: head,
    ...(await listActiveHooks(dir, options)),
  };
}

/** Diff de un fichero de la lista de cambios actual (comparación exacta; si no está, no se ejecuta diff). */
export async function getFileDiff(dir, file, { runner, maxBytes = MAX_DIFF_BYTES } = {}) {
  if (typeof file !== 'string' || file === '') return { ok: false, status: 400, error: GIT_ERRORS.fileNotChanged };
  const changes = await getChanges(dir, { runner });
  if (!changes.ok) return changes;
  const entry = changes.files.find((f) => f.path === file);
  if (!entry) return { ok: false, status: 400, error: GIT_ERRORS.fileNotChanged };
  if (entry.status === '??') return { ok: true, file, diff: null, untracked: true, truncated: false };
  const args = [...(changes.hasHead ? GIT_ACTION_ARGS.diffHead : GIT_ACTION_ARGS.diffWorktree), entry.path];
  const result = await tryGit(dir, args, { runner });
  const clipped = clipBytes(result.stdout, maxBytes);
  return { ok: true, file, diff: clipped.text, untracked: false, truncated: clipped.truncated };
}

function messagePreview(message) {
  const chars = [...message];
  return chars.length > 120 ? chars.slice(0, 119).join('') + '…' : message;
}

/**
 * Plan de "Commit y push": valida el mensaje, que haya cambios y que haya rama; elige push o push -u origin <rama>.
 * → { ok: true, steps, display, branch } | { ok: false, status, error, field? }.
 */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** Entorno extra del push: ssh sin preguntas salvo que el humano ya haya configurado GIT_SSH_COMMAND o GIT_SSH. */
function sshEnv(env) {
  return nonEmpty(env && env.GIT_SSH_COMMAND) || nonEmpty(env && env.GIT_SSH) ? {} : { GIT_SSH_COMMAND: PUSH_SSH_COMMAND };
}

export async function planCommitPush(dir, message, { runner, env: panelEnv = process.env } = {}) {
  const options = { runner };
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || text.includes('\0')) return { ok: false, status: 400, error: GIT_ERRORS.messageRequired, field: 'message' };
  if ([...text].length > MAX_COMMIT_MESSAGE_CHARS) return { ok: false, status: 400, error: GIT_ERRORS.messageTooLong, field: 'message' };
  if (!(await isRepo(dir, options))) return { ok: false, status: 409, error: GIT_ERRORS.notRepo };
  const status = await tryGit(dir, GIT_ACTION_ARGS.status, options);
  if (parsePorcelainZ(status.stdout).length === 0) return { ok: false, status: 409, error: GIT_ERRORS.nothingToCommit };
  const branch = await currentBranch(dir, options);
  if (!branch || branch === 'HEAD' || branch.startsWith('-') || !BRANCH_RE.test(branch)) {
    return { ok: false, status: 409, error: GIT_ERRORS.detachedHead };
  }
  const upstream = await tryGit(dir, GIT_ACTION_ARGS.upstream, options);
  const pushArgs = upstream.ok ? [...GIT_ACTION_ARGS.push] : [...GIT_ACTION_ARGS.pushSetUpstream, branch];
  const pushDisplay = upstream.ok ? 'git push' : `git push -u origin ${branch}`;
  const commitDisplay = `git commit -m "${messagePreview(text)}"`;
  const env = { ...GIT_STEP_ENV };
  const pushEnv = { ...GIT_STEP_ENV, ...sshEnv(panelEnv) };
  const steps = [
    { file: 'git', prefixArgs: [], args: [...GIT_SAFE_PREFIX, ...GIT_ACTION_ARGS.add], display: 'git add -A', env },
    { file: 'git', prefixArgs: [], args: [...GIT_SAFE_PREFIX, ...GIT_ACTION_ARGS.commit, text], display: commitDisplay, env: { ...env } },
    { file: 'git', prefixArgs: [], args: [...GIT_SAFE_PREFIX, ...pushArgs], display: pushDisplay, env: pushEnv },
  ];
  return { ok: true, steps, display: steps.map((s) => s.display).join(' → '), branch, message: text };
}
