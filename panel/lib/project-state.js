// Estado real de un proyecto en disco: feature_list.json, progress/current.md, git, semáforo, resumen y detalle.
import fs from 'node:fs/promises';
import path from 'node:path';

import { getGitInfo } from './git-info.js';

export const INACTIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const EMPTY_BLOCK_VALUES = new Set(['', '—', '-', '–', 'ninguno', '(ninguno)', 'no']);
const BLOCK_LINE_PREFIX = '- **Bloqueos / esperando:**';
const COUNTED_STATUSES = ['pending', 'spec_ready', 'in_progress', 'done'];

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function absentSdd() {
  return { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [], features: [] };
}

/** Lee <dir>/feature_list.json y resume su estado (R5–R7). Nunca lanza. */
export async function readFeatureList(dir) {
  const file = path.join(dir, 'feature_list.json');
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return absentSdd();
  }

  const result = { ...absentSdd(), present: true };
  let parsed;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch (err) {
    result.error = `JSON inválido: ${err.message}`;
    return result;
  }
  if (!parsed || !Array.isArray(parsed.features)) {
    result.error = 'feature_list.json no contiene un array "features"';
    return result;
  }

  const features = parsed.features.filter((f) => f && typeof f === 'object');
  const counts = Object.fromEntries(COUNTED_STATUSES.map((s) => [s, 0]));
  for (const f of features) {
    if (COUNTED_STATUSES.includes(f.status)) counts[f.status] += 1;
  }
  const first = features.find((f) => f.status === 'in_progress') || null;

  result.counts = counts;
  result.inProgress = first ? { id: first.id, slug: first.slug, description: first.description } : null;
  result.awaitingApproval = features.filter((f) => f.status === 'spec_ready').map((f) => ({ id: f.id, slug: f.slug }));
  result.features = features;
  return result;
}

/** Detecta un bloqueo declarado en el texto de progress/current.md (R8). */
export function detectBlock(text) {
  const lines = stripBom(String(text || '')).split(/\r?\n/);
  const line = lines.find((l) => l.trimStart().startsWith(BLOCK_LINE_PREFIX));
  if (line === undefined) return { blocked: false, blockReason: null };
  const value = line.trimStart().slice(BLOCK_LINE_PREFIX.length).trim();
  const blocked = !EMPTY_BLOCK_VALUES.has(value.toLowerCase());
  return { blocked, blockReason: blocked ? value : null };
}

/** Lee <dir>/progress/current.md (R8). Con detail incluye `text`. */
export async function readProgress(dir, { detail = false } = {}) {
  const file = path.join(dir, 'progress', 'current.md');
  let text = null;
  try {
    text = stripBom(await fs.readFile(file, 'utf8'));
  } catch {
    const absent = { present: false, blocked: false, blockReason: null };
    return detail ? { ...absent, text: null } : absent;
  }
  const info = { present: true, ...detectBlock(text) };
  return detail ? { ...info, text } : info;
}

/** Semáforo del proyecto (R13–R16), en el orden exacto de design.md §5. */
export function computeStatus({ exists, sdd, progress, git }, now = Date.now()) {
  if (!exists) return 'no_encontrado';
  if ((sdd && sdd.awaitingApproval && sdd.awaitingApproval.length > 0) || (progress && progress.blocked)) return 'atencion';
  if (sdd && sdd.inProgress !== null && sdd.inProgress !== undefined) return 'en_curso';
  if (git && git.isRepo && git.lastCommit) {
    const commitTime = Date.parse(git.lastCommit.date);
    if (!Number.isNaN(commitTime) && now - commitTime > INACTIVE_AFTER_MS) return 'inactivo';
  }
  return 'ok';
}

function publicFields(project) {
  return {
    id: project.id,
    name: project.name,
    appUrl: typeof project.appUrl === 'string' ? project.appUrl : '',
    repoUrl: typeof project.repoUrl === 'string' ? project.repoUrl : '',
    tags: Array.isArray(project.tags) ? project.tags : [],
  };
}

async function isDirectory(dir) {
  try {
    const stats = await fs.stat(dir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function notFound(project, detail) {
  const base = {
    ...publicFields(project),
    exists: false,
    status: 'no_encontrado',
    sdd: { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [] },
    progress: { present: false, blocked: false, blockReason: null },
    git: { isRepo: false, branch: null, lastCommit: null, dirtyCount: null },
  };
  if (!detail) return base;
  base.sdd.features = [];
  base.progress.text = null;
  base.git.recentCommits = [];
  base.git.dirtyFiles = [];
  return base;
}

async function build(project, { now = () => Date.now(), runner } = {}, detail) {
  const dir = typeof project.path === 'string' ? path.resolve(project.path) : '';
  if (!dir || !(await isDirectory(dir))) return notFound(project, detail);

  const gitOptions = { detail };
  if (runner) gitOptions.runner = runner;

  const [sddFull, progress, gitFull] = await Promise.all([
    readFeatureList(dir),
    readProgress(dir, { detail }),
    getGitInfo(dir, gitOptions),
  ]);

  const { features, ...sddSummary } = sddFull;
  const { recentCommits, dirtyFiles, ...gitSummary } = gitFull;
  const sdd = detail ? { ...sddSummary, features } : sddSummary;
  const git = detail ? { ...gitSummary, recentCommits, dirtyFiles } : gitSummary;

  const nowMs = typeof now === 'function' ? now() : now;
  const status = computeStatus({ exists: true, sdd, progress, git }, nowMs);

  return { ...publicFields(project), exists: true, status, sdd, progress, git };
}

/** Resumen del proyecto (§3.2). */
export function buildSummary(project, options) {
  return build(project, options, false);
}

/** Detalle del proyecto (§3.3). */
export function buildDetail(project, options) {
  return build(project, options, true);
}
