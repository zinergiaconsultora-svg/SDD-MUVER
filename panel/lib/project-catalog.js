// Catálogo de proyectos (design.md §5.3): fusión de la capa de ajustes (projects.json) con los proyectos
// descubiertos en Claude Code, asignación de ids estables, estado de disco (fase 1), ocultos y orden.
import { buildSummary, buildDetail } from './project-state.js';
import { normalizeSettings, slugify } from './registry.js';
import { pathKey, lastSegment } from './path-key.js';

export const MAX_DETAIL_SESSIONS = 20;
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

/** Catálogo completo de GET /api/projects (sin ocultos salvo includeHidden), ordenado. */
export async function buildCatalog({ registry, discovery, includeHidden = false, now, runner } = {}) {
  const merged = mergedCatalog(registry, discovery).filter((m) => includeHidden || !m.hidden);
  const summaries = await Promise.all(
    merged.map(async (m) => toSummary(m, await buildSummary(stateInput(m), stateOptions({ now, runner })))),
  );
  return sortCatalog(summaries);
}

/** Busca un proyecto del catálogo (incluidos los ocultos) por id. */
export function findMerged({ registry, discovery }, id) {
  return mergedCatalog(registry, discovery).find((m) => m.id === id) || null;
}

/** Resumen de un único proyecto ya fusionado (p. ej. tras un PATCH). */
export async function buildCatalogSummary(merged, { now, runner } = {}) {
  return toSummary(merged, await buildSummary(stateInput(merged), stateOptions({ now, runner })));
}

/** Detalle de GET /api/projects/:id: detalle de la fase 1 + campos nuevos + claude.sessions (máx. 20). */
export async function buildCatalogDetail(merged, { now, runner } = {}) {
  return toSummary(merged, await buildDetail(stateInput(merged), stateOptions({ now, runner })), { withSessions: true });
}
