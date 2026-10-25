// Catálogo de proyectos (design.md §5.3): fusión de la capa de ajustes (projects.json) con los proyectos
// descubiertos en Claude Code, asignación de ids estables, estado de disco (fase 1), ocultos y orden.
// Feature 13 (design.md §4.4, §5.3): resumen "de qué va" (guardado o automático), clasificación de worktrees con la
// caché de lib/repo-layout.js (parentId/groupKey/worktreeCount), modo ligero para los worktrees agrupados y
// worktrees[] en el detalle del principal.
import fsp from 'node:fs/promises';
import path from 'node:path';

import { buildSummary, buildDetail, readFeatureList, readProgress, computeStatus } from './project-state.js';
import { normalizeSettings, slugify } from './registry.js';
import { pathKey, lastSegment } from './path-key.js';
import { getGitInfo } from './git-info.js';
import { createRepoLayoutCache, isLikelyWorktree, groupKeyFor, groupNameFor } from './repo-layout.js';
import { createSummaryReader, resolveSummary } from './project-summary.js';

export const MAX_DETAIL_SESSIONS = 20;
export const MAX_DETAIL_WORKTREES = 30;
const DEFAULT_ID = 'proyecto';

function claudeInfo(d) {
  return { sessionCount: d.sessionCount, lastActivityAt: d.lastActivityAt, lastPrompt: d.lastPrompt, sessions: d.sessions };
}

/**
 * Fusiona ajustes y descubiertos por clave de ruta (puro).
 * Devuelve MergedProject[]: ajustes en su orden (both/manual) y después los descubiertos sin ajustes (claude, id null).
 */
export function mergeProjects(settings, discovered) {
  const index = new Map();
  for (const d of discovered || []) {
    const key = d.unresolved ? null : pathKey(d.path);
    if (key && !index.has(key)) index.set(key, d);
  }
  const consumed = new Set();
  const merged = [];

  for (const raw of settings || []) {
    const entry = normalizeSettings(raw);
    const key = pathKey(entry.path);
    const match = key && index.has(key) && !consumed.has(key) ? index.get(key) : null;
    if (match) consumed.add(key);
    merged.push({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      appUrl: entry.appUrl,
      repoUrl: entry.repoUrl,
      tags: entry.tags,
      hidden: entry.hidden,
      pinned: entry.pinned,
      source: match ? 'both' : 'manual',
      claude: match ? claudeInfo(match) : null,
      unresolved: false,
      settingsEntry: raw,
      pathKey: key,
    });
  }

  for (const d of discovered || []) {
    const key = d.unresolved ? null : pathKey(d.path);
    if (key && consumed.has(key)) continue;
    if (key) consumed.add(key);
    merged.push({
      id: null,
      name: d.unresolved ? d.encodedName : lastSegment(d.path),
      path: d.unresolved ? null : d.path,
      appUrl: '',
      repoUrl: '',
      tags: [],
      hidden: false,
      pinned: false,
      source: 'claude',
      claude: claudeInfo(d),
      unresolved: Boolean(d.unresolved),
      settingsEntry: null,
      pathKey: key,
    });
  }
  return merged;
}

function idSortKey(m) {
  return m.pathKey ?? `unresolved:${m.name}`;
}

/**
 * Asigna id a los proyectos de Claude (id null): slugify del nombre, con -2, -3… si ya está cogido. Los ids
 * manuales tienen prioridad y los sufijos se reparten en orden alfabético de clave de ruta (estables entre escaneos).
 */
export function assignIds(merged) {
  const taken = new Set(merged.filter((m) => m.id !== null && m.id !== undefined).map((m) => m.id));
  const pending = merged.filter((m) => m.id === null || m.id === undefined);
  pending.sort((a, b) => (idSortKey(a) < idSortKey(b) ? -1 : idSortKey(a) > idSortKey(b) ? 1 : 0));
  const assigned = new Map();
  for (const m of pending) {
    const base = slugify(m.name) || DEFAULT_ID;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    assigned.set(m, id);
  }
  return merged.map((m) => (assigned.has(m) ? { ...m, id: assigned.get(m) } : m));
}

function toMs(value) {
  if (typeof value !== 'string') return NaN;
  return Date.parse(value);
}

/** Actividad del proyecto: la más reciente entre la última sesión de Claude y el último commit; null si no hay. */
export function projectActivity(merged, summary) {
  const times = [toMs(merged && merged.claude ? merged.claude.lastActivityAt : null), toMs(summary && summary.git && summary.git.lastCommit ? summary.git.lastCommit.date : null)]
    .filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/** Resumen (§3.4) o, con withSessions, detalle (§3.5) a partir del estado de disco de la fase 1. */
export function toSummary(merged, summary, { withSessions = false } = {}) {
  const claude = merged.claude
    ? {
        sessionCount: merged.claude.sessionCount,
        lastActivityAt: merged.claude.lastActivityAt,
        lastPrompt: merged.claude.lastPrompt,
        ...(withSessions ? { sessions: merged.claude.sessions.slice(0, MAX_DETAIL_SESSIONS) } : {}),
      }
    : null;
  return {
    ...summary,
    source: merged.source,
    claude,
    hidden: merged.hidden,
    pinned: merged.pinned,
    lastActivityAt: projectActivity(merged, summary),
    unresolved: merged.unresolved,
  };
}

function compareActivity(a, b) {
  const ta = toMs(a.lastActivityAt);
  const tb = toMs(b.lastActivityAt);
  const aMissing = Number.isNaN(ta);
  const bMissing = Number.isNaN(tb);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return tb - ta;
}

/** Orden del catálogo: fijados → actividad desc (null al final) → nombre (es) → id. Devuelve una copia. */
export function sortCatalog(list) {
  return list.slice().sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    const byActivity = compareActivity(a, b);
    if (byActivity !== 0) return byActivity;
    const byName = String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es');
    if (byName !== 0) return byName;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

function stateOptions({ now, runner } = {}) {
  const options = {};
  if (now) options.now = now;
  if (runner) options.runner = runner;
  return options;
}

function stateInput(merged) {
  return { id: merged.id, name: merged.name, path: merged.path, appUrl: merged.appUrl, repoUrl: merged.repoUrl, tags: merged.tags };
}

function mergedCatalog(registry, discovery) {
  return assignIds(mergeProjects(registry.projects, discovery ? discovery.projects : []));
}

// ---------- Feature 13: clasificación, resumen y modo ligero ----------

/** Carpeta absoluta del proyecto (sin comprobar que exista) o null si no tiene ruta resuelta. */
function projectDirOf(merged) {
  if (!merged || merged.unresolved || typeof merged.path !== 'string' || !merged.path.trim()) return null;
  return path.resolve(merged.path);
}

async function isDirectory(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Anota cada elemento (puro): isWorktree, parentId/parentName (principal en el catálogo, aunque esté oculto),
 * groupKey/groupName (principal fuera del catálogo), likelyWorktree (git no respondió) y worktreeCount (hijos no
 * ocultos). `layouts`: Map elemento → RepoLayout. Devuelve copias; no expone rutas nuevas.
 */
export function annotateLayouts(list, layouts) {
  const index = new Map();
  for (const m of list) {
    const key = m && typeof m.path === 'string' && !m.unresolved ? pathKey(m.path) : null;
    if (key && !index.has(key)) index.set(key, m);
  }
  const annotated = list.map((m) => {
    const layout = (layouts && layouts.get(m)) || { kind: 'missing' };
    const fields = { isWorktree: false, parentId: null, parentName: null, groupKey: null, groupName: null, likelyWorktree: false, worktreeCount: 0 };
    if (layout.kind === 'worktree') {
      fields.isWorktree = true;
      const parent = index.get(pathKey(layout.mainPath));
      if (parent && parent !== m) {
        fields.parentId = parent.id;
        fields.parentName = parent.name;
      } else if (!parent) {
        fields.groupKey = groupKeyFor(layout.mainPath);
        fields.groupName = groupNameFor(layout.mainPath);
      }
    } else if (layout.kind === 'missing' || layout.kind === 'none') {
      fields.likelyWorktree = isLikelyWorktree(m);
    }
    return { ...m, ...fields };
  });
  const counts = new Map();
  for (const a of annotated) {
    if (a.parentId && a.hidden !== true) counts.set(a.parentId, (counts.get(a.parentId) || 0) + 1);
  }
  return annotated.map((a) => ({ ...a, worktreeCount: counts.get(a.id) || 0 }));
}

/** Rama de la sesión de Claude más reciente que la tenga (o null). */
function sessionBranch(merged) {
  const sessions = merged && merged.claude && Array.isArray(merged.claude.sessions) ? merged.claude.sessions : [];
  let best = null;
  for (const s of sessions) {
    if (!s || typeof s.gitBranch !== 'string' || !s.gitBranch) continue;
    const t = toMs(s.lastActivityAt);
    if (!best || (!Number.isNaN(t) && (Number.isNaN(best.t) || t > best.t))) best = { branch: s.gitBranch, t };
  }
  return best ? best.branch : null;
}

/**
 * Resumen ligero de un worktree agrupado (§3.3): arnés y progreso del disco, rama de la última sesión de Claude y
 * ningún git. Carpeta inexistente → la forma no_encontrado de la fase 1 (buildSummary no lanza git en ese caso).
 */
export async function buildLightSummary(merged, { now } = {}) {
  const dir = projectDirOf(merged);
  if (!dir || !(await isDirectory(dir))) return buildSummary(stateInput(merged), stateOptions({ now }));
  const [sddFull, progress] = await Promise.all([readFeatureList(dir), readProgress(dir)]);
  const { features, ...sdd } = sddFull;
  const git = { isRepo: true, branch: sessionBranch(merged), lastCommit: null, dirtyCount: null };
  const nowMs = typeof now === 'function' ? now() : Date.now();
  const input = stateInput(merged);
  return {
    id: input.id,
    name: input.name,
    appUrl: typeof input.appUrl === 'string' ? input.appUrl : '',
    repoUrl: typeof input.repoUrl === 'string' ? input.repoUrl : '',
    tags: Array.isArray(input.tags) ? input.tags : [],
    exists: true,
    status: computeStatus({ exists: true, sdd, progress, git }, nowMs),
    sdd,
    progress,
    git,
  };
}

function catalogFields(annotated, summaryInfo, detailLevel) {
  return {
    summary: summaryInfo.summary,
    summarySource: summaryInfo.summarySource,
    summaryAt: summaryInfo.summaryAt,
    isWorktree: annotated.isWorktree === true,
    parentId: annotated.parentId ?? null,
    parentName: annotated.parentName ?? null,
    groupKey: annotated.groupKey ?? null,
    groupName: annotated.groupName ?? null,
    likelyWorktree: annotated.likelyWorktree === true,
    worktreeCount: annotated.worktreeCount || 0,
    detailLevel,
  };
}

/** Caché de clasificación y lector de resúmenes: los de la app o unos de usar y tirar (llamadas antiguas y tests). */
function helpersFor({ runner, now, layoutCache, summaryReader } = {}) {
  return {
    layoutCache: layoutCache ?? createRepoLayoutCache({ ...(runner ? { runner } : {}), ...(now ? { now } : {}) }),
    summaryReader: summaryReader ?? createSummaryReader({ ttlMs: 0 }),
  };
}

/** Clasifica (en paralelo, con la caché) y anota todo el catálogo fusionado. */
async function annotateCatalog(all, layoutCache) {
  const layouts = new Map();
  await Promise.all(all.map(async (m) => {
    const dir = projectDirOf(m);
    layouts.set(m, dir ? await layoutCache.get(dir) : { kind: 'missing' });
  }));
  return annotateLayouts(all, layouts);
}

const isGrouped = (a) => Boolean(a.parentId || a.groupKey);

/** Elemento §3.3 de un proyecto anotado (estado de disco completo o ligero + resumen + campos nuevos). */
async function catalogItem(a, { now, runner, summaryReader, fullWorktrees }) {
  const light = isGrouped(a) && !fullWorktrees;
  const state = light ? await buildLightSummary(a, { now }) : await buildSummary(stateInput(a), stateOptions({ now, runner }));
  const summaryInfo = await resolveSummary(a.settingsEntry, projectDirOf(a), summaryReader);
  return { ...toSummary(a, state), ...catalogFields(a, summaryInfo, light ? 'light' : 'full') };
}

/** Catálogo completo de GET /api/projects (sin ocultos salvo includeHidden), ordenado. */
export async function buildCatalog({ registry, discovery, includeHidden = false, now, runner, layoutCache, summaryReader, fullWorktrees = false } = {}) {
  const helpers = helpersFor({ runner, now, layoutCache, summaryReader });
  const annotated = await annotateCatalog(mergedCatalog(registry, discovery), helpers.layoutCache);
  const visible = annotated.filter((a) => includeHidden || !a.hidden);
  const items = await Promise.all(visible.map((a) => catalogItem(a, { now, runner, summaryReader: helpers.summaryReader, fullWorktrees })));
  return sortCatalog(items);
}

/** Busca un proyecto del catálogo (incluidos los ocultos) por id. */
export function findMerged({ registry, discovery }, id) {
  return mergedCatalog(registry, discovery).find((m) => m.id === id) || null;
}

/** Anotación de `merged` dentro del catálogo de `sources` (o sola si no hay sources) y el catálogo anotado. */
async function annotateOne(merged, sources, layoutCache) {
  const all = sources ? mergedCatalog(sources.registry, sources.discovery) : [merged];
  if (!all.some((m) => m.id === merged.id)) all.push(merged);
  const annotated = await annotateCatalog(all, layoutCache);
  // Se conserva el objeto fusionado recibido (p. ej. tras un PATCH) con los campos de la anotación.
  const own = annotated.find((a) => a.id === merged.id);
  const fields = catalogFields(own, { summary: null, summarySource: null, summaryAt: null }, 'full');
  return { self: { ...merged, isWorktree: fields.isWorktree, parentId: fields.parentId, parentName: fields.parentName, groupKey: fields.groupKey, groupName: fields.groupName, likelyWorktree: fields.likelyWorktree, worktreeCount: fields.worktreeCount }, annotated };
}

/** Resumen de un único proyecto ya fusionado (p. ej. tras un PATCH). */
export async function buildCatalogSummary(merged, { now, runner, layoutCache, summaryReader, sources } = {}) {
  const helpers = helpersFor({ runner, now, layoutCache, summaryReader });
  const { self } = await annotateOne(merged, sources, helpers.layoutCache);
  return catalogItem(self, { now, runner, summaryReader: helpers.summaryReader, fullWorktrees: true });
}

/** worktrees[] del detalle de un principal (§3.4): ocultos incluidos, por última sesión; git real en los 30 primeros. */
async function detailWorktrees(self, annotated, { now, runner, summaryReader }) {
  const children = annotated.filter((a) => a.parentId === self.id && a.id !== self.id);
  const sessionAt = (a) => (a.claude && typeof a.claude.lastActivityAt === 'string' ? a.claude.lastActivityAt : null);
  children.sort((a, b) => {
    const ta = toMs(sessionAt(a));
    const tb = toMs(sessionAt(b));
    if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
    if (!Number.isNaN(ta) && ta !== tb) return tb - ta;
    const byName = String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es');
    return byName !== 0 ? byName : String(a.id).localeCompare(String(b.id));
  });
  return Promise.all(children.map(async (child, index) => {
    const dir = projectDirOf(child);
    const light = await buildLightSummary(child, { now });
    let branch = sessionBranch(child);
    let dirtyCount = null;
    let lastCommit = null;
    if (index < MAX_DETAIL_WORKTREES && light.exists && dir) {
      const info = await getGitInfo(dir, runner ? { runner } : {});
      if (info.isRepo) {
        branch = info.branch ?? branch;
        dirtyCount = info.dirtyCount;
        lastCommit = info.lastCommit;
      }
    }
    const summaryInfo = await resolveSummary(child.settingsEntry, dir, summaryReader);
    return {
      id: child.id,
      name: child.name,
      branch,
      lastSessionAt: sessionAt(child),
      lastActivityAt: projectActivity(child, { git: { lastCommit } }),
      dirtyCount,
      exists: light.exists,
      hidden: child.hidden === true,
      status: light.status,
      summary: summaryInfo.summary,
    };
  }));
}

/** Detalle de GET /api/projects/:id: detalle de la fase 1 + campos de §3.3 + claude.sessions (máx. 20) + worktrees. */
export async function buildCatalogDetail(merged, { now, runner, layoutCache, summaryReader, sources } = {}) {
  const helpers = helpersFor({ runner, now, layoutCache, summaryReader });
  const { self, annotated } = await annotateOne(merged, sources, helpers.layoutCache);
  const state = await buildDetail(stateInput(self), stateOptions({ now, runner }));
  const summaryInfo = await resolveSummary(self.settingsEntry, projectDirOf(self), helpers.summaryReader);
  const worktrees = self.worktreeCount > 0 || annotated.some((a) => a.parentId === self.id)
    ? await detailWorktrees(self, annotated, { now, runner, summaryReader: helpers.summaryReader })
    : [];
  return { ...toSummary(self, state, { withSessions: true }), ...catalogFields(self, summaryInfo, 'full'), worktrees };
}
