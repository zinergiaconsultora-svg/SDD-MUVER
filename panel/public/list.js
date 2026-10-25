// Funciones PURAS de la vista Lista (feature 13, design.md §6.2–§6.4): preferencias por dispositivo, agrupación de
// worktrees bajo su principal, modelo y marcado de cada fila, búsqueda y filtros locales, bloque "Antiguos",
// repintado por firma (HTML), candidatos y textos del lote de resúmenes y estado del lote. Sin DOM: se prueban en
// Node. Regla "nada recortado": ningún texto se acorta con «…»; la fila crece si hace falta.
import { escapeHtml, relativeTime, STATUS_LABELS, SUMMARY_SOURCE_LABELS, NO_SUMMARY_TEXT, renderProjectCard, renderPinButton, renderHideButton, renderOpenApp } from './render.js';

export { SUMMARY_SOURCE_LABELS, NO_SUMMARY_TEXT };

export const LIST_PREFS_KEY = 'muver.listPrefs';
export const DEFAULT_LIST_PREFS = Object.freeze({ view: 'list', filter: 'all', loose: false });
export const VIEWS = Object.freeze(['list', 'cards']);
export const FILTERS = Object.freeze(['all', 'active', 'pinned', 'attention']);
export const ACTIVE_DAYS = 7;
export const OLD_DAYS = 30;
export const BATCH_LIMIT = 50;
export const NO_ACTIVITY_TEXT = 'Sin actividad';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Prioridad del semáforo de un grupo virtual (la peor de sus tareas gana). */
const STATUS_PRIORITY = Object.freeze(['atencion', 'en_curso', 'ok', 'inactivo', 'no_encontrado']);

// ---------- Preferencias (R38) ----------

/** Preferencias de la lista guardadas en el navegador; cualquier error o valor no válido → valores por defecto. */
export function loadListPrefs(storage) {
  let saved = null;
  try {
    const raw = storage ? storage.getItem(LIST_PREFS_KEY) : null;
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const s = saved && typeof saved === 'object' ? saved : {};
  return {
    view: VIEWS.includes(s.view) ? s.view : DEFAULT_LIST_PREFS.view,
    filter: FILTERS.includes(s.filter) ? s.filter : DEFAULT_LIST_PREFS.filter,
    loose: typeof s.loose === 'boolean' ? s.loose : DEFAULT_LIST_PREFS.loose,
  };
}

/** Guarda las preferencias (validadas); los errores del almacenamiento se ignoran. */
export function saveListPrefs(storage, prefs) {
  const p = prefs || {};
  const clean = {
    view: VIEWS.includes(p.view) ? p.view : DEFAULT_LIST_PREFS.view,
    filter: FILTERS.includes(p.filter) ? p.filter : DEFAULT_LIST_PREFS.filter,
    loose: p.loose === true,
  };
  try {
    if (storage) storage.setItem(LIST_PREFS_KEY, JSON.stringify(clean));
  } catch {
    // Almacenamiento bloqueado o lleno: la preferencia solo dura esta visita.
  }
}

// ---------- Utilidades ----------

/** Minúsculas, sin acentos y con los espacios colapsados (búsqueda sin distinguir mayúsculas ni acentos). */
export function normalizeSearch(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toMs(value) {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

/** Fecha ISO más reciente de la lista (null si ninguna es válida). */
function latest(dates) {
  const times = dates.map(toMs).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function compareRows(a, b) {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  const ta = toMs(a.activityAt);
  const tb = toMs(b.activityAt);
  if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
  if (!Number.isNaN(ta) && ta !== tb) return tb - ta;
  const byName = String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es');
  if (byName !== 0) return byName;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

// ---------- Agrupación (R33) ----------

function projectRow(p, worktrees) {
  return {
    key: `p:${p.id}`,
    kind: 'project',
    project: p,
    worktrees,
    name: p.name,
    activityAt: latest([p.lastActivityAt, ...worktrees.map((w) => w.lastActivityAt)]),
    pinned: p.pinned === true,
  };
}

/**
 * Filas de la lista: sin `loose`, los proyectos de nivel superior con sus tareas en curso (worktrees visibles) y un
 * grupo virtual por cada principal ausente; con `loose`, una fila por proyecto visible. Orden: fijados → actividad
 * de la fila desc (sin actividad al final) → nombre → clave.
 */
export function groupProjects(projects, { loose = false, showHidden = false } = {}) {
  const list = (Array.isArray(projects) ? projects : []).filter((p) => p && (showHidden || p.hidden !== true));
  let rows;
  if (loose) {
    rows = list.map((p) => projectRow(p, []));
  } else {
    const visibleIds = new Set(list.map((p) => p.id));
    const children = new Map();
    const groups = new Map();
    const top = [];
    for (const p of list) {
      if (p.parentId) {
        if (!visibleIds.has(p.parentId)) continue; // su principal no es visible: no sale
        if (!children.has(p.parentId)) children.set(p.parentId, []);
        children.get(p.parentId).push(p);
      } else if (p.groupKey) {
        if (!groups.has(p.groupKey)) groups.set(p.groupKey, []);
        groups.get(p.groupKey).push(p);
      } else {
        top.push(p);
      }
    }
    rows = top.map((p) => projectRow(p, children.get(p.id) || []));
    for (const [groupKey, worktrees] of groups) {
      rows.push({
        key: `g:${groupKey}`,
        kind: 'group',
        groupKey,
        project: null,
        worktrees,
        name: worktrees[0].groupName || groupKey,
        activityAt: latest(worktrees.map((w) => w.lastActivityAt)),
        pinned: false,
      });
    }
  }
  return rows.sort(compareRows);
}

// ---------- Modelo de fila (R34) ----------

function worstStatus(list) {
  let best = null;
  for (const p of list) {
    const idx = STATUS_PRIORITY.indexOf(p.status);
    if (idx >= 0 && (best === null || idx < best)) best = idx;
  }
  return best === null ? 'ok' : STATUS_PRIORITY[best];
}

const awaiting = (p) => Boolean(p && p.sdd && Array.isArray(p.sdd.awaitingApproval) && p.sdd.awaitingApproval.length > 0);
const tasksText = (n) => `${n} ${n === 1 ? 'tarea en curso' : 'tareas en curso'}`;

function chipsFor(row) {
  const p = row.project;
  const chips = [];
  if (row.kind === 'project' && row.worktrees.length > 0) chips.push({ kind: 'worktrees', text: tasksText(row.worktrees.length) });
  if ((p && awaiting(p)) || row.worktrees.some(awaiting)) chips.push({ kind: 'approval', text: 'Espera tu aprobación' });
  if (p && (p.source === 'claude' || p.source === 'both')) chips.push({ kind: 'claude', text: 'Claude Code' });
  if (p && (p.parentId || p.groupKey)) chips.push({ kind: 'parent', text: `Tarea de ${p.parentName || p.groupName || ''}` });
  if (p && p.likelyWorktree === true) chips.push({ kind: 'likely', text: 'Tarea (probable)' });
  return chips;
}

/** Modelo de una fila (proyecto o grupo virtual) a partir de la fila agrupada. */
export function buildRowModel(row, { now = Date.now(), attentionIds = [] } = {}) {
  const ids = attentionIds instanceof Set ? attentionIds : new Set(Array.isArray(attentionIds) ? attentionIds : []);
  const p = row.project;
  const isGroup = row.kind === 'group';
  const status = isGroup ? worstStatus(row.worktrees) : (STATUS_LABELS[p.status] ? p.status : 'ok');
  const n = row.worktrees.length;
  const summary = isGroup ? `${n} ${n === 1 ? 'tarea' : 'tareas'} · el repositorio principal no está en el panel` : (typeof p.summary === 'string' && p.summary ? p.summary : null);
  const members = isGroup ? row.worktrees : [p, ...row.worktrees];
  const needsYou = members.some((m) => m.status === 'atencion' || ids.has(m.id));
  const tags = !isGroup && Array.isArray(p.tags) ? p.tags : [];
  const tasks = row.worktrees.map((w) => ({
    id: w.id,
    name: w.name,
    branch: w.git && w.git.branch ? w.git.branch : null,
    activityAt: w.lastActivityAt ?? null,
    status: w.status,
  }));
  return {
    key: row.key,
    kind: row.kind,
    id: isGroup ? row.groupKey : p.id,
    name: row.name,
    status,
    statusLabel: STATUS_LABELS[status],
    summary,
    summaryLabel: !isGroup && p.summarySource && SUMMARY_SOURCE_LABELS[p.summarySource] ? SUMMARY_SOURCE_LABELS[p.summarySource] : '',
    activityAt: row.activityAt,
    activityText: row.activityAt ? relativeTime(row.activityAt, now) : NO_ACTIVITY_TEXT,
    chips: chipsFor(row),
    needsYou,
    pinned: row.pinned === true,
    hidden: !isGroup && p.hidden === true,
    appUrl: !isGroup ? p.appUrl || '' : '',
    manual: !isGroup && (p.source ?? 'manual') === 'manual',
    exists: isGroup ? true : p.exists !== false,
    unresolved: !isGroup && p.unresolved === true,
    worktreeCount: n,
    tasks,
    tags,
    searchText: normalizeSearch([row.name, summary || '', ...tags, ...row.worktrees.map((w) => w.name)].join(' ')),
  };
}

// ---------- Búsqueda, filtros y antiguos (R39–R41) ----------

/** Filas que cumplen la búsqueda (nombre, resumen, etiquetas, tareas) y el filtro; sin pedir nada al servidor. */
export function filterRows(models, { filter = 'all', query = '', now = Date.now() } = {}) {
  const q = normalizeSearch(query);
  return (Array.isArray(models) ? models : []).filter((m) => {
    if (q && !m.searchText.includes(q)) return false;
    if (filter === 'active') {
      const t = toMs(m.activityAt);
      return !Number.isNaN(t) && now - t <= ACTIVE_DAYS * DAY_MS;
    }
    if (filter === 'pinned') return m.pinned === true;
    if (filter === 'attention') return m.needsYou === true;
    return true;
  });
}

/** Separa las filas antiguas (sin fijar y sin actividad en 30 días) solo con all/attention y sin búsqueda. */
export function splitOld(models, { filter = 'all', query = '', now = Date.now() } = {}) {
  const list = Array.isArray(models) ? models : [];
  if (!['all', 'attention'].includes(filter) || normalizeSearch(query)) return { recent: list.slice(), old: [] };
  const recent = [];
  const old = [];
  for (const m of list) {
    const t = toMs(m.activityAt);
    const isOld = !m.pinned && (Number.isNaN(t) || now - t > OLD_DAYS * DAY_MS);
    (isOld ? old : recent).push(m);
  }
  return { recent, old };
}

// ---------- Marcado (R35) ----------

function renderChips(chips) {
  if (!chips.length) return '';
  return `<span class="row-chips">${chips.map((c) => `<span class="chip chip-${escapeHtml(c.kind)}">${escapeHtml(c.text)}</span>`).join('')}</span>`;
}

function renderTime(model) {
  return model.activityAt
    ? `<time class="row-time" datetime="${escapeHtml(model.activityAt)}">${escapeHtml(model.activityText)}</time>`
    : `<span class="row-time">${escapeHtml(NO_ACTIVITY_TEXT)}</span>`;
}

function renderSummary(model, cls) {
  return model.summary
    ? `<span class="${cls}">${escapeHtml(model.summary)}</span>`
    : `<span class="${cls} is-empty">${NO_SUMMARY_TEXT}</span>`;
}

function rowClasses(model) {
  const classes = ['project-row', `status-${model.status}`];
  if (model.pinned) classes.push('pinned');
  if (model.hidden) classes.push('is-hidden');
  return classes.join(' ');
}

/** Menú "⋯" con las acciones de la fila (fijar, ocultar, abrir app y, solo en manuales, eliminar). */
function renderRowMenu(model) {
  const id = escapeHtml(model.id);
  const project = { pinned: model.pinned, hidden: model.hidden };
  const del = model.manual ? `<button type="button" class="btn danger" data-action="delete" data-id="${id}">Eliminar</button>` : '';
  return `<div class="row-menu">
      <button type="button" class="btn icon row-menu-button" data-action="menu" aria-haspopup="true" aria-expanded="false" aria-controls="menu-${id}" aria-label="Más acciones de ${escapeHtml(model.name)}">⋯</button>
      <div class="row-menu-list" id="menu-${id}" role="menu" hidden>
        ${renderPinButton(project, id)}
        ${renderHideButton(project, id)}
        ${renderOpenApp(model.appUrl)}
        ${del}
      </div>
    </div>`;
}

/** Fila de la vista Lista: todo el bloque es un botón que abre el detalle (o el grupo) y, aparte, el menú "⋯". */
export function renderProjectRow(model) {
  const isGroup = model.kind === 'group';
  const id = escapeHtml(model.id);
  const action = isGroup ? `data-action="group" data-group="${id}"` : `data-action="detail" data-id="${id}"`;
  return `<li class="${rowClasses(model)}" data-key="${escapeHtml(model.key)}">
    <button type="button" class="row-main" ${action}>
      <span class="dot status-${model.status}" aria-hidden="true"></span><span class="visually-hidden">Estado: ${escapeHtml(model.statusLabel)}</span>
      <span class="row-name">${escapeHtml(model.name)}</span>
      ${renderChips(model.chips)}
      ${renderTime(model)}
      ${renderSummary(model, 'row-summary')}
    </button>
    ${isGroup ? '' : renderRowMenu(model)}
  </li>`;
}

/** Tarjeta compacta de un grupo virtual (vista Tarjetas). */
export function renderGroupCard(model) {
  return `<article class="card group-card status-${model.status}" data-key="${escapeHtml(model.key)}">
    <button type="button" class="card-main" data-action="group" data-group="${escapeHtml(model.id)}">
      <span class="card-header">
        <span class="card-title">${escapeHtml(model.name)}</span>
        <span class="badge status-${model.status}">${escapeHtml(model.statusLabel)}</span>
      </span>
    </button>
    <p class="card-summary">${escapeHtml(model.summary)}</p>
    ${renderChips(model.chips)}
  </article>`;
}

/** HTML de una fila o tarjeta: también es su firma para el repintado (D10). */
export function renderItemHtml(model, view, project, now = Date.now()) {
  if (view === 'cards') {
    return model.kind === 'group' || !project ? renderGroupCard(model) : renderProjectCard(project, now, { worktreeCount: model.worktreeCount, rowKey: model.key });
  }
  return renderProjectRow(model);
}

function renderContainer(models, view, now, projectsById) {
  const items = models.map((m) => renderItemHtml(m, view, projectsById && projectsById.get(m.id), now)).join('');
  return view === 'cards' ? `<div class="cards">${items}</div>` : `<ul class="project-list">${items}</ul>`;
}

/** Cuerpo completo de la lista (o tarjetas), con el bloque plegable "Antiguos (N)" y el mensaje de vacío. */
export function renderListBody({ recent = [], old = [], view = 'list', oldOpen = false, now = Date.now(), projectsById = new Map() } = {}) {
  if (!recent.length && !old.length) {
    return '<p class="muted empty-filter">Ningún proyecto coincide con el filtro o la búsqueda</p><button type="button" class="btn" data-action="clear-filters">Quitar filtros</button>';
  }
  const main = renderContainer(recent, view, now, projectsById);
  const oldBlock = old.length
    ? `<details class="old-projects"${oldOpen ? ' open' : ''}><summary>Antiguos (${old.length})</summary>${renderContainer(old, view, now, projectsById)}</details>`
    : '';
  return main + oldBlock;
}

// ---------- Repintado por firma (R43) ----------

/** Qué filas repintar, quitar y en qué orden; `changed` falso si mismas claves, mismo orden y mismo HTML. */
export function planRowUpdate(prev, next) {
  const before = prev instanceof Map ? prev : new Map();
  const list = Array.isArray(next) ? next : [];
  const order = list.map((item) => item.key);
  const nextKeys = new Set(order);
  const toRender = list.filter((item) => before.get(item.key) !== item.html).map((item) => item.key);
  const toRemove = [...before.keys()].filter((key) => !nextKeys.has(key));
  const prevOrder = [...before.keys()];
  const sameOrder = prevOrder.length === order.length && prevOrder.every((key, i) => key === order[i]);
  return { changed: toRender.length > 0 || toRemove.length > 0 || !sameOrder, toRender, toRemove, order };
}

// ---------- Lote de resúmenes (R47–R49) ----------

/** Candidatos del lote: filas de proyecto visibles sin resumen, existentes y resueltas, sin antiguos plegados. */
export function summaryCandidates(models, { oldOpen = false, oldKeys = new Set() } = {}) {
  const old = oldKeys instanceof Set ? oldKeys : new Set(oldKeys || []);
  const ids = (Array.isArray(models) ? models : [])
    .filter((m) => m.kind === 'project' && !m.summary && m.exists !== false && m.unresolved !== true && (oldOpen || !old.has(m.key)))
    .map((m) => m.id);
  return { ids: ids.slice(0, BATCH_LIMIT), total: ids.length };
}

/** Texto (HTML escapado) del diálogo de confirmación de generar resúmenes (§6.4). */
export function describeSummaryAction(kind, ctx = {}) {
  if (kind === 'summary') {
    const replace = ctx.hasSummary ? ' Sustituirá el resumen actual.' : '';
    return `Se lanzará Claude Code en modo solo lectura en ${escapeHtml(ctx.projectName)} (puede leer ficheros; no puede editarlos ni ejecutar comandos) para escribir una frase sobre de qué va el proyecto, con el modelo Haiku (el más barato). Es una ejecución de Claude y consume uso de tu plan.${replace}`;
  }
  if (kind === 'summary-batch') {
    const n = Number(ctx.count) || 0;
    const total = Number(ctx.total) || n;
    const extra = total > BATCH_LIMIT ? ` Hay ${total} sin descripción: solo se procesan los primeros ${BATCH_LIMIT}.` : '';
    return `Se lanzará Claude Code en modo solo lectura, uno detrás de otro, en ${n} ${n === 1 ? 'proyecto' : 'proyectos'} sin descripción para escribir su resumen, con el modelo Haiku. Cada proyecto es una ejecución de Claude y consume uso de tu plan.${extra}`;
  }
  return '';
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Estado del lote: en marcha (con "Cancelar") o terminado/cancelado (con "Cerrar"); '' sin lote. */
export function renderBatchStatus(batch) {
  if (!batch) return '';
  const c = batch.counts || {};
  const total = Number(batch.total) || 0;
  const saved = Number(c.saved) || 0;
  const failed = Number(c.failed) || 0;
  const skipped = Number(c.skipped) || 0;
  const cancelled = Number(c.cancelled) || 0;
  const extras = `${failed ? ` · ${plural(failed, 'fallido', 'fallidos')}` : ''}${skipped ? ` · ${plural(skipped, 'omitido', 'omitidos')}` : ''}`;
  if (batch.state === 'running') {
    const finished = saved + failed + skipped + cancelled;
    return `<p class="batch-text">Generando resúmenes: ${finished} de ${total}${extras}</p><button type="button" class="btn" data-action="cancel-batch">Cancelar</button>`;
  }
  const head = batch.state === 'cancelled' ? `Generación cancelada: ${saved} de ${total}` : `Resúmenes generados: ${saved} de ${total}`;
  return `<p class="batch-text">${head}${extras}</p><button type="button" class="btn" data-action="close-batch">Cerrar</button>`;
}

// ---------- Detalle de un grupo virtual (R36) ----------

/** Detalle de un grupo virtual (sin petición al servidor): sus tareas con rama, actividad y "Ver detalle". */
export function renderGroupDetail(model, now = Date.now()) {
  const items = (model.tasks || []).map((t) => {
    const when = t.activityAt
      ? `<time datetime="${escapeHtml(t.activityAt)}">${escapeHtml(relativeTime(t.activityAt, now))}</time>`
      : `<span class="muted">${NO_ACTIVITY_TEXT}</span>`;
    return `<li class="worktree-item">
        <span class="worktree-name">${escapeHtml(t.name)}</span>
        ${t.branch ? `<span class="branch">${escapeHtml(t.branch)}</span>` : ''}
        ${when}
        <button type="button" class="btn" data-action="detail" data-id="${escapeHtml(t.id)}">Ver detalle</button>
      </li>`;
  });
  return `<section class="detail group-detail" data-group="${escapeHtml(model.id)}">
    <header class="detail-header">
      <button type="button" class="btn" data-action="back">Volver</button>
      <h2>${escapeHtml(model.name)}</h2>
    </header>
    <p class="muted">El repositorio principal de estas tareas no está en el panel.</p>
    <ul class="worktree-list">${items.join('')}</ul>
  </section>`;
}
