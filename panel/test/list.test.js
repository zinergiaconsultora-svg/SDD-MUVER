// Tests de public/list.js (feature 13, design.md §6.2–§6.4): funciones PURAS de la vista Lista — preferencias,
// agrupación de worktrees, modelo de fila, marcado de fila y de grupo, búsqueda y filtros, "Antiguos", repintado por
// firma, candidatos del lote, textos de confirmación y estado del lote. F13-R33–R36, R38–R43, R47–R49.
// Regla "nada recortado": ningún texto se acorta con «…».
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIST_PREFS_KEY,
  DEFAULT_LIST_PREFS,
  FILTERS,
  SUMMARY_SOURCE_LABELS,
  loadListPrefs,
  saveListPrefs,
  normalizeSearch,
  groupProjects,
  buildRowModel,
  filterRows,
  splitOld,
  renderProjectRow,
  renderGroupCard,
  renderListBody,
  renderItemHtml,
  planRowUpdate,
  summaryCandidates,
  describeSummaryAction,
  renderBatchStatus,
  renderGroupDetail,
} from '../public/list.js';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();
const ELLIPSIS = '…';

/** Elemento de GET /api/projects con los campos de la feature 13 (por defecto un proyecto normal). */
function project(id, extra = {}) {
  return {
    id,
    name: id,
    appUrl: '',
    repoUrl: '',
    tags: [],
    exists: true,
    status: 'ok',
    sdd: { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [] },
    progress: { present: false, blocked: false, blockReason: null },
    git: { isRepo: true, branch: 'main', lastCommit: null, dirtyCount: 0 },
    source: 'manual',
    claude: null,
    hidden: false,
    pinned: false,
    lastActivityAt: ago(2 * HOUR),
    unresolved: false,
    summary: null,
    summarySource: null,
    summaryAt: null,
    isWorktree: false,
    parentId: null,
    parentName: null,
    groupKey: null,
    groupName: null,
    likelyWorktree: false,
    worktreeCount: 0,
    detailLevel: 'full',
    ...extra,
  };
}

const wt = (id, parent, extra = {}) => project(id, { isWorktree: true, parentId: parent.id, parentName: parent.name, source: 'claude', detailLevel: 'light', git: { isRepo: true, branch: `claude/${id}`, lastCommit: null, dirtyCount: null }, ...extra });

function sampleList() {
  const crm = project('crm-rapido', { name: 'CRM RAPIDO', source: 'both', summary: 'CRM para gestionar clientes.', summarySource: 'readme', worktreeCount: 2, lastActivityAt: ago(3 * DAY) });
  return [
    crm,
    wt('audit-41fbca', crm, { lastActivityAt: ago(1 * HOUR) }),
    wt('fix-aaaaaa', crm, { lastActivityAt: ago(5 * DAY) }),
    wt('oculto-bbbbbb', crm, { hidden: true, lastActivityAt: ago(10 * 60000) }),
    project('tarea-x-111111', { isWorktree: true, groupKey: 'g-0123456789', groupName: 'nightshift', lastActivityAt: ago(2 * DAY), status: 'en_curso' }),
    project('tarea-y-222222', { isWorktree: true, groupKey: 'g-0123456789', groupName: 'nightshift', lastActivityAt: ago(6 * HOUR), status: 'atencion' }),
    project('viejo-41fbcc', { likelyWorktree: true, exists: false, status: 'no_encontrado', lastActivityAt: ago(40 * DAY) }),
    project('playground', { lastActivityAt: null, summary: 'Pruebas varias.', summarySource: 'manual' }),
  ];
}

// ---------- Preferencias (R38) ----------

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

test('[F13-R38] loadListPrefs/saveListPrefs: ida y vuelta, JSON roto, valor no válido y almacenamiento que lanza', () => {
  assert.equal(LIST_PREFS_KEY, 'muver.listPrefs');
  assert.deepEqual(DEFAULT_LIST_PREFS, { view: 'list', filter: 'all', loose: false });
  assert.deepEqual(FILTERS, ['all', 'active', 'pinned', 'attention']);
  const storage = fakeStorage();
  assert.deepEqual(loadListPrefs(storage), DEFAULT_LIST_PREFS);
  saveListPrefs(storage, { view: 'cards', filter: 'pinned', loose: true });
  assert.deepEqual(JSON.parse(storage.data[LIST_PREFS_KEY]), { view: 'cards', filter: 'pinned', loose: true });
  assert.deepEqual(loadListPrefs(storage), { view: 'cards', filter: 'pinned', loose: true });
  assert.deepEqual(loadListPrefs(fakeStorage({ [LIST_PREFS_KEY]: '{ roto' })), DEFAULT_LIST_PREFS);
  assert.deepEqual(loadListPrefs(fakeStorage({ [LIST_PREFS_KEY]: JSON.stringify({ view: 'grande', filter: 'raro', loose: 'sí' }) })), DEFAULT_LIST_PREFS);
  assert.deepEqual(loadListPrefs(fakeStorage({ [LIST_PREFS_KEY]: JSON.stringify({ view: 'cards' }) })), { view: 'cards', filter: 'all', loose: false });
  const throwing = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.deepEqual(loadListPrefs(throwing), DEFAULT_LIST_PREFS);
  assert.doesNotThrow(() => saveListPrefs(throwing, { view: 'cards', filter: 'all', loose: false }));
  assert.deepEqual(loadListPrefs(null), DEFAULT_LIST_PREFS);
  assert.doesNotThrow(() => saveListPrefs(null, DEFAULT_LIST_PREFS));
});

// ---------- groupProjects (R33) ----------

test('[F13-R33] groupProjects: principal con sus tareas, grupo virtual, likelyWorktree y orden por actividad de la fila', () => {
  const rows = groupProjects(sampleList(), { loose: false, showHidden: false });
  assert.deepEqual(rows.map((r) => r.key), ['p:crm-rapido', 'g:g-0123456789', 'p:viejo-41fbcc', 'p:playground']);
  const crm = rows[0];
  assert.equal(crm.kind, 'project');
  assert.deepEqual(crm.worktrees.map((w) => w.id), ['audit-41fbca', 'fix-aaaaaa'], 'sin el oculto');
  assert.equal(crm.activityAt, ago(1 * HOUR), 'actividad de la fila = la más reciente de sus tareas');
  const group = rows[1];
  assert.equal(group.kind, 'group');
  assert.equal(group.name, 'nightshift');
  assert.deepEqual(group.worktrees.map((w) => w.id), ['tarea-x-111111', 'tarea-y-222222']);
  assert.equal(group.activityAt, ago(6 * HOUR));
  assert.equal(rows[3].activityAt, null, 'sin actividad al final');
  const withHidden = groupProjects(sampleList(), { loose: false, showHidden: true });
  assert.deepEqual(withHidden[0].worktrees.map((w) => w.id), ['audit-41fbca', 'fix-aaaaaa', 'oculto-bbbbbb']);
  const pinned = groupProjects([...sampleList(), project('fijado', { pinned: true, lastActivityAt: null })], { loose: false });
  assert.equal(pinned[0].key, 'p:fijado', 'los fijados primero');
  const orphan = groupProjects([wt('huerfano-cccccc', project('principal-oculto', { hidden: true }))], { loose: false, showHidden: false });
  assert.deepEqual(orphan, [], 'el worktree cuyo principal no es visible no sale');
});

test('[F13-R33] groupProjects con tareas sueltas: una fila por proyecto visible', () => {
  const rows = groupProjects(sampleList(), { loose: true, showHidden: false });
  assert.equal(rows.length, 7);
  assert.ok(rows.every((r) => r.kind === 'project'));
  assert.ok(rows.every((r) => r.worktrees.length === 0));
  assert.deepEqual(rows.map((r) => r.key), ['p:audit-41fbca', 'p:tarea-y-222222', 'p:tarea-x-111111', 'p:crm-rapido', 'p:fix-aaaaaa', 'p:viejo-41fbcc', 'p:playground']);
  assert.equal(rows[0].key, 'p:audit-41fbca', 'orden por actividad propia');
});

// ---------- buildRowModel (R34) ----------

const model = (rows, key, opts = {}) => buildRowModel(rows.find((r) => r.key === key), { now: NOW, attentionIds: [], ...opts });

test('[F13-R34] buildRowModel: semáforo, nombre, resumen entero, actividad y chips de un principal', () => {
  const rows = groupProjects(sampleList(), { loose: false });
  const m = model(rows, 'p:crm-rapido');
  assert.equal(m.kind, 'project');
  assert.equal(m.id, 'crm-rapido');
  assert.equal(m.name, 'CRM RAPIDO');
  assert.equal(m.status, 'ok');
  assert.equal(m.statusLabel, 'OK');
  assert.equal(m.summary, 'CRM para gestionar clientes.');
  assert.equal(m.summaryLabel, 'Del README');
  assert.equal(m.activityText, 'hace 1 h');
  assert.deepEqual(m.chips, [{ kind: 'worktrees', text: '2 tareas en curso' }, { kind: 'claude', text: 'Claude Code' }]);
  const long = 'Resumen largo '.repeat(11).trim() + ' final.';
  assert.ok([...long].length >= 160);
  const longModel = buildRowModel(groupProjects([project('a', { summary: long })], {})[0], { now: NOW });
  assert.equal(longModel.summary, long, 'el resumen llega entero');
  assert.ok(!renderProjectRow(longModel).includes(ELLIPSIS));
  assert.ok(renderProjectRow(longModel).includes(long));
});

test('[F13-R34] chips: 1 tarea, 3 tareas, Espera tu aprobación (propia o de una tarea), Tarea de…, Tarea (probable) y ausencia', () => {
  const main = project('main', { name: 'Main' });
  const one = groupProjects([main, wt('w1-aaaaaa', main)], {})[0];
  assert.deepEqual(buildRowModel(one, { now: NOW }).chips, [{ kind: 'worktrees', text: '1 tarea en curso' }]);
  const three = groupProjects([main, wt('w1-aaaaaa', main), wt('w2-aaaaaa', main), wt('w3-aaaaaa', main)], {})[0];
  assert.equal(buildRowModel(three, { now: NOW }).chips[0].text, '3 tareas en curso');
  const awaiting = { present: true, error: null, counts: null, inProgress: null, awaitingApproval: [{ id: 2, slug: 'x' }] };
  const own = groupProjects([project('a', { sdd: awaiting, status: 'atencion' })], {})[0];
  assert.deepEqual(buildRowModel(own, { now: NOW }).chips, [{ kind: 'approval', text: 'Espera tu aprobación' }]);
  const byTask = groupProjects([main, wt('w1-aaaaaa', main, { sdd: awaiting, status: 'atencion' })], {})[0];
  const byTaskModel = buildRowModel(byTask, { now: NOW });
  assert.deepEqual(byTaskModel.chips.map((c) => c.text), ['1 tarea en curso', 'Espera tu aprobación']);
  assert.equal(byTaskModel.needsYou, true, 'te necesita por una tarea');
  const loose = groupProjects([main, wt('w1-aaaaaa', main)], { loose: true }).find((r) => r.key === 'p:w1-aaaaaa');
  assert.deepEqual(buildRowModel(loose, { now: NOW }).chips, [{ kind: 'claude', text: 'Claude Code' }, { kind: 'parent', text: 'Tarea de Main' }]);
  const looseGroup = groupProjects([project('t-111111', { groupKey: 'g-1', groupName: 'CRM RAPIDO', isWorktree: true })], { loose: true })[0];
  assert.deepEqual(buildRowModel(looseGroup, { now: NOW }).chips, [{ kind: 'parent', text: 'Tarea de CRM RAPIDO' }]);
  const likely = groupProjects([project('v-41fbcc', { likelyWorktree: true })], {})[0];
  assert.deepEqual(buildRowModel(likely, { now: NOW }).chips, [{ kind: 'likely', text: 'Tarea (probable)' }]);
  const plain = buildRowModel(groupProjects([project('solo')], {})[0], { now: NOW });
  assert.deepEqual(plain.chips, []);
  assert.equal(plain.summary, null);
  assert.equal(plain.summaryLabel, '');
  assert.equal(plain.needsYou, false);
  const idle = buildRowModel(groupProjects([project('idle', { lastActivityAt: null })], {})[0], { now: NOW });
  assert.equal(idle.activityText, 'Sin actividad');
  assert.equal(buildRowModel(groupProjects([project('a')], {})[0], { now: NOW, attentionIds: ['a'] }).needsYou, true, 'run en la cola');
});

test('[F13-R34] grupo virtual: semáforo peor de sus tareas, resumen del grupo y búsqueda por tarea', () => {
  const rows = groupProjects(sampleList(), { loose: false });
  const g = model(rows, 'g:g-0123456789');
  assert.equal(g.kind, 'group');
  assert.equal(g.id, 'g-0123456789');
  assert.equal(g.status, 'atencion');
  assert.equal(g.statusLabel, 'Atención');
  assert.equal(g.summary, '2 tareas · el repositorio principal no está en el panel');
  assert.equal(g.needsYou, true);
  assert.deepEqual(g.tasks.map((t) => [t.id, t.name]), [['tarea-x-111111', 'tarea-x-111111'], ['tarea-y-222222', 'tarea-y-222222']]);
});

// ---------- renderProjectRow, renderGroupCard (R35) ----------

test('[F13-R35] renderProjectRow: botón principal, menú "⋯" de 44 px oculto, Abrir app deshabilitado y Eliminar solo en manuales', () => {
  const evil = project('evil', { name: '<script>alert(1)</script>', summary: '<script>x</script> resumen', source: 'manual', status: 'atencion' });
  const html = renderProjectRow(buildRowModel(groupProjects([evil], {})[0], { now: NOW }));
  assert.match(html, /^<li class="project-row status-atencion[^"]*" data-key="p:evil">/);
  assert.match(html, /<button type="button" class="row-main" data-action="detail" data-id="evil">/);
  assert.ok(html.includes('<span class="visually-hidden">Estado: Atención</span>'));
  assert.match(html, /<button type="button" class="btn icon row-menu-button" data-action="menu" aria-haspopup="true" aria-expanded="false" aria-controls="menu-evil" aria-label="Más acciones de &lt;script&gt;alert\(1\)&lt;\/script&gt;">⋯<\/button>/);
  assert.match(html, /<div class="row-menu-list" id="menu-evil" role="menu" hidden>/);
  assert.ok(html.includes('data-action="pin"'));
  assert.ok(html.includes('data-action="hide"'));
  assert.match(html, /<a[^>]*aria-disabled="true"[^>]*>\s*Abrir app\s*<\/a>/);
  assert.ok(html.includes('data-action="delete"'));
  assert.ok(!html.includes('<script>'), 'todo escapado');
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt; resumen'));
  const mainButton = html.slice(html.indexOf('class="row-main"'), html.indexOf('</button>'));
  assert.ok(!mainButton.includes('data-action="pin"'), 'sin acciones visibles dentro del botón principal');
  const claude = renderProjectRow(buildRowModel(groupProjects([project('c', { source: 'claude', appUrl: 'https://app.example' })], {})[0], { now: NOW }));
  assert.ok(!claude.includes('data-action="delete"'), 'sin Eliminar en proyectos de Claude');
  assert.ok(claude.includes('href="https://app.example"'));
  const empty = renderProjectRow(buildRowModel(groupProjects([project('e')], {})[0], { now: NOW }));
  assert.ok(empty.includes('<span class="row-summary is-empty">Sin descripción</span>'));
  assert.ok(empty.includes('<time class="row-time"'));
  const idle = renderProjectRow(buildRowModel(groupProjects([project('i', { lastActivityAt: null })], {})[0], { now: NOW }));
  assert.ok(idle.includes('Sin actividad'));
});

test('[F13-R35] fila y tarjeta de un grupo virtual: data-action="group", sin menú y escapado', () => {
  const rows = groupProjects(sampleList(), { loose: false });
  const g = model(rows, 'g:g-0123456789');
  const row = renderProjectRow(g);
  assert.match(row, /<li class="project-row status-atencion[^"]*" data-key="g:g-0123456789">/);
  assert.ok(row.includes('data-action="group" data-group="g-0123456789"'));
  assert.ok(!row.includes('data-action="menu"'));
  const card = renderGroupCard(g);
  assert.ok(card.includes('data-action="group" data-group="g-0123456789"'));
  assert.ok(card.includes('class="card-summary"'));
  assert.ok(card.includes('nightshift'));
  const evil = buildRowModel(groupProjects([project('t-1', { groupKey: 'g-1', groupName: '<b>x</b>', isWorktree: true })], {})[0], { now: NOW });
  assert.ok(!renderGroupCard(evil).includes('<b>x</b>'));
  assert.ok(!renderProjectRow(evil).includes('<b>x</b>'));
});

// ---------- renderGroupDetail (R36) ----------

test('[F13-R36] renderGroupDetail: nombre, aviso y lista de tareas con rama, actividad y Ver detalle', () => {
  const rows = groupProjects(sampleList(), { loose: false });
  const html = renderGroupDetail(model(rows, 'g:g-0123456789'), NOW);
  assert.ok(html.startsWith('<section class="detail group-detail"'));
  assert.ok(html.includes('data-action="back"'));
  assert.ok(html.includes('<h2>nightshift</h2>'));
  assert.ok(html.includes('<p class="muted">El repositorio principal de estas tareas no está en el panel.</p>'));
  assert.ok(html.includes('<ul class="worktree-list">'));
  for (const id of ['tarea-x-111111', 'tarea-y-222222']) {
    assert.ok(html.includes(`data-action="detail" data-id="${id}">Ver detalle</button>`), id);
  }
  assert.ok(html.includes('hace 2 días'));
  assert.ok(html.includes('hace 6 h'));
  assert.ok(html.includes('<span class="branch">main</span>'));
});

// ---------- filterRows (R39, R40) ----------

test('[F13-R39] filterRows: búsqueda sin mayúsculas ni acentos por nombre, resumen, etiqueta y tarea', () => {
  const list = [
    project('crm-rapido', { name: 'CRM RAPIDO', summary: 'Clientes y propuestas.', worktreeCount: 1 }),
    wt('audit-y-medianoche-41fbca', { id: 'crm-rapido', name: 'CRM RAPIDO' }),
    project('facturas', { summary: 'Gestor de facturacion para autonomos.' }),
    project('etiquetado', { tags: ['Logística'] }),
  ];
  const models = groupProjects(list, {}).map((r) => buildRowModel(r, { now: NOW }));
  const ids = (q) => filterRows(models, { filter: 'all', query: q, now: NOW }).map((m) => m.id);
  assert.deepEqual(ids('crm'), ['crm-rapido']);
  assert.deepEqual(ids('FACTURACIÓN'), ['facturas']);
  assert.deepEqual(ids('logistica'), ['etiquetado']);
  assert.deepEqual(ids('medianoche'), ['crm-rapido'], 'el nombre de una tarea agrupada encuentra su principal');
  assert.equal(ids('').length, 3);
  assert.equal(ids('   ').length, 3);
  assert.equal(normalizeSearch('  Facturación   Ágil '), 'facturacion agil');
});

test('[F13-R40] filterRows: Todos, Activos (7 días), Fijados y Te necesitan sobre la lista cargada', () => {
  const list = [
    project('seis', { lastActivityAt: ago(6 * DAY) }),
    project('ocho', { lastActivityAt: ago(8 * DAY) }),
    project('fijado', { pinned: true, lastActivityAt: null }),
    project('main', { lastActivityAt: ago(20 * DAY) }),
    wt('tarea-atencion-aaaaaa', { id: 'main', name: 'main' }, { status: 'atencion', lastActivityAt: ago(20 * DAY) }),
    project('fallido', { lastActivityAt: ago(9 * DAY) }),
  ];
  const models = groupProjects(list, {}).map((r) => buildRowModel(r, { now: NOW, attentionIds: ['fallido'] }));
  const ids = (filter) => filterRows(models, { filter, query: '', now: NOW }).map((m) => m.id).sort();
  assert.deepEqual(ids('all'), ['fallido', 'fijado', 'main', 'ocho', 'seis']);
  assert.deepEqual(ids('active'), ['seis']);
  assert.deepEqual(ids('pinned'), ['fijado']);
  assert.deepEqual(ids('attention'), ['fallido', 'main']);
});

// ---------- splitOld y renderListBody (R41, R42) ----------

test('[F13-R41] splitOld pliega lo de hace más de 30 días o sin actividad, nunca los fijados; solo con all/attention sin búsqueda', () => {
  const list = [
    project('reciente', { lastActivityAt: ago(29 * DAY) }),
    project('viejo', { lastActivityAt: ago(31 * DAY) }),
    project('nunca', { lastActivityAt: null }),
    project('fijado-viejo', { pinned: true, lastActivityAt: ago(90 * DAY) }),
  ];
  const models = groupProjects(list, {}).map((r) => buildRowModel(r, { now: NOW }));
  const split = splitOld(models, { filter: 'all', query: '', now: NOW });
  assert.deepEqual(split.recent.map((m) => m.id).sort(), ['fijado-viejo', 'reciente']);
  assert.deepEqual(split.old.map((m) => m.id).sort(), ['nunca', 'viejo']);
  assert.equal(splitOld(models, { filter: 'attention', query: '', now: NOW }).old.length, 2);
  for (const opts of [{ filter: 'pinned', query: '' }, { filter: 'active', query: '' }, { filter: 'all', query: 'vie' }]) {
    assert.equal(splitOld(models, { ...opts, now: NOW }).old.length, 0, JSON.stringify(opts));
  }
  const body = renderListBody({ ...split, view: 'list', oldOpen: false, now: NOW, projectsById: new Map(list.map((p) => [p.id, p])) });
  assert.ok(body.includes('<ul class="project-list">'));
  assert.ok(body.includes('<details class="old-projects"><summary>Antiguos (2)</summary>'));
  const open = renderListBody({ ...split, view: 'list', oldOpen: true, now: NOW, projectsById: new Map(list.map((p) => [p.id, p])) });
  assert.ok(open.includes('<details class="old-projects" open><summary>Antiguos (2)</summary>'));
  const cards = renderListBody({ ...split, view: 'cards', oldOpen: false, now: NOW, projectsById: new Map(list.map((p) => [p.id, p])) });
  assert.ok(cards.includes('<div class="cards">'));
  assert.ok(cards.includes('<article class="card'));
  const noOld = renderListBody({ recent: split.recent, old: [], view: 'list', oldOpen: false, now: NOW, projectsById: new Map() });
  assert.ok(!noOld.includes('old-projects'));
});

test('[F13-R42] renderListBody sin filas: mensaje y botón "Quitar filtros"', () => {
  const html = renderListBody({ recent: [], old: [], view: 'list', oldOpen: false, now: NOW, projectsById: new Map() });
  assert.ok(html.includes('<p class="muted empty-filter">Ningún proyecto coincide con el filtro o la búsqueda</p>'));
  assert.ok(html.includes('<button type="button" class="btn" data-action="clear-filters">Quitar filtros</button>'));
});

// ---------- planRowUpdate y renderItemHtml (R43) ----------

test('[F13-R43] planRowUpdate: sin cambios, una fila cambiada, nueva, desaparecida y cambio de orden', () => {
  const prev = new Map([['a', '<li>a</li>'], ['b', '<li>b</li>'], ['c', '<li>c</li>']]);
  const same = planRowUpdate(prev, [{ key: 'a', html: '<li>a</li>' }, { key: 'b', html: '<li>b</li>' }, { key: 'c', html: '<li>c</li>' }]);
  assert.deepEqual(same, { changed: false, toRender: [], toRemove: [], order: ['a', 'b', 'c'] });
  const one = planRowUpdate(prev, [{ key: 'a', html: '<li>a</li>' }, { key: 'b', html: '<li>b2</li>' }, { key: 'c', html: '<li>c</li>' }]);
  assert.deepEqual(one, { changed: true, toRender: ['b'], toRemove: [], order: ['a', 'b', 'c'] });
  const added = planRowUpdate(prev, [{ key: 'a', html: '<li>a</li>' }, { key: 'b', html: '<li>b</li>' }, { key: 'c', html: '<li>c</li>' }, { key: 'd', html: '<li>d</li>' }]);
  assert.deepEqual([added.changed, added.toRender, added.toRemove], [true, ['d'], []]);
  const removed = planRowUpdate(prev, [{ key: 'a', html: '<li>a</li>' }, { key: 'c', html: '<li>c</li>' }]);
  assert.deepEqual([removed.changed, removed.toRender, removed.toRemove, removed.order], [true, [], ['b'], ['a', 'c']]);
  const reordered = planRowUpdate(prev, [{ key: 'c', html: '<li>c</li>' }, { key: 'a', html: '<li>a</li>' }, { key: 'b', html: '<li>b</li>' }]);
  assert.deepEqual([reordered.changed, reordered.toRender, reordered.toRemove, reordered.order], [true, [], [], ['c', 'a', 'b']]);
  assert.deepEqual(planRowUpdate(new Map(), []), { changed: false, toRender: [], toRemove: [], order: [] });
});

test('[F13-R43] renderItemHtml es estable (misma firma para el mismo modelo) y cambia con el resumen', () => {
  const p = project('a', { summary: 'Uno.' });
  const m = buildRowModel(groupProjects([p], {})[0], { now: NOW });
  assert.equal(renderItemHtml(m, 'list', p, NOW), renderItemHtml(m, 'list', p, NOW));
  const p2 = { ...p, summary: 'Dos.' };
  const m2 = buildRowModel(groupProjects([p2], {})[0], { now: NOW });
  assert.notEqual(renderItemHtml(m, 'list', p, NOW), renderItemHtml(m2, 'list', p2, NOW));
  assert.ok(renderItemHtml(m, 'cards', p, NOW).startsWith('<article class="card'));
});

// ---------- summaryCandidates y describeSummaryAction (R47, R48) ----------

test('[F13-R48] summaryCandidates: proyectos visibles sin resumen, existentes y resueltos, sin antiguos plegados, hasta 50', () => {
  const list = [
    project('con', { summary: 'Ya tiene.' }),
    project('sin'),
    project('roto', { exists: false, status: 'no_encontrado' }),
    project('suelto', { unresolved: true }),
    project('t-111111', { groupKey: 'g-1', groupName: 'x', isWorktree: true }),
    project('antiguo', { lastActivityAt: ago(60 * DAY) }),
  ];
  const models = groupProjects(list, {}).map((r) => buildRowModel(r, { now: NOW }));
  const oldKeys = new Set(splitOld(models, { filter: 'all', query: '', now: NOW }).old.map((m) => m.key));
  assert.deepEqual(summaryCandidates(models, { oldOpen: false, oldKeys }), { ids: ['sin'], total: 1 });
  assert.deepEqual(summaryCandidates(models, { oldOpen: true, oldKeys }).ids.sort(), ['antiguo', 'sin']);
  const sixty = Array.from({ length: 60 }, (_, i) => project(`p-${String(i).padStart(2, '0')}`));
  const many = summaryCandidates(groupProjects(sixty, {}).map((r) => buildRowModel(r, { now: NOW })), { oldOpen: true, oldKeys: new Set() });
  assert.equal(many.total, 60);
  assert.equal(many.ids.length, 50);
});

test('[F13-R47] describeSummaryAction: individual con y sin resumen, lote de 3 y de 72, nombre escapado y Haiku', () => {
  const single = describeSummaryAction('summary', { projectName: 'CRM <b>', hasSummary: false });
  assert.equal(single, 'Se lanzará Claude Code en modo solo lectura en CRM &lt;b&gt; (puede leer ficheros; no puede editarlos ni ejecutar comandos) para escribir una frase sobre de qué va el proyecto, con el modelo Haiku (el más barato). Es una ejecución de Claude y consume uso de tu plan.');
  assert.ok(describeSummaryAction('summary', { projectName: 'X', hasSummary: true }).endsWith(' Sustituirá el resumen actual.'));
  const three = describeSummaryAction('summary-batch', { count: 3, total: 3 });
  assert.equal(three, 'Se lanzará Claude Code en modo solo lectura, uno detrás de otro, en 3 proyectos sin descripción para escribir su resumen, con el modelo Haiku. Cada proyecto es una ejecución de Claude y consume uso de tu plan.');
  assert.ok(describeSummaryAction('summary-batch', { count: 1, total: 1 }).includes('en 1 proyecto sin descripción'));
  const big = describeSummaryAction('summary-batch', { count: 50, total: 72 });
  assert.ok(big.includes('en 50 proyectos'));
  assert.ok(big.endsWith(' Hay 72 sin descripción: solo se procesan los primeros 50.'));
  assert.equal(describeSummaryAction('otra', {}), '');
});

// ---------- renderBatchStatus (R49) ----------

test('[F13-R49] renderBatchStatus: en marcha, terminado y cancelado', () => {
  assert.equal(renderBatchStatus(null), '');
  const counts = (c) => ({ queued: 0, running: 0, saved: 0, failed: 0, skipped: 0, cancelled: 0, ...c });
  const running = renderBatchStatus({ state: 'running', total: 5, counts: counts({ saved: 1, failed: 1, running: 1, queued: 2 }) });
  assert.ok(running.includes('Generando resúmenes: 2 de 5 · 1 fallido'));
  assert.ok(running.includes('<button type="button" class="btn" data-action="cancel-batch">Cancelar</button>'));
  assert.ok(!running.includes('close-batch'));
  const done = renderBatchStatus({ state: 'done', total: 5, counts: counts({ saved: 2, failed: 2, skipped: 1 }) });
  assert.ok(done.includes('Resúmenes generados: 2 de 5 · 2 fallidos · 1 omitido'));
  assert.ok(done.includes('data-action="close-batch">Cerrar</button>'));
  const cancelled = renderBatchStatus({ state: 'cancelled', total: 4, counts: counts({ saved: 1, cancelled: 3 }) });
  assert.ok(cancelled.includes('Generación cancelada: 1 de 4'));
  assert.ok(cancelled.includes('data-action="close-batch"'));
  const clean = renderBatchStatus({ state: 'done', total: 2, counts: counts({ saved: 2 }) });
  assert.ok(!clean.includes('fallido') && !clean.includes('omitido'));
});

test('[F13-R34][F13-R44] SUMMARY_SOURCE_LABELS con los textos de design.md §6.2', () => {
  assert.deepEqual(SUMMARY_SOURCE_LABELS, { manual: 'Escrito por ti', claude: 'Generado por Claude', package: 'De package.json', readme: 'Del README', 'claude-md': 'De CLAUDE.md' });
});
