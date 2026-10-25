// Lógica del panel en el navegador: carga, refresco, detalle, alta y baja. Usa render.js (puro) y app-config.js.
import { REFRESH_INTERVAL_MS, API_BASE } from './app-config.js';
import {
  renderProjectCard,
  renderProjectDetail,
  renderFormError,
  renderLoadError,
  buildProjectPayload,
  handleDelete,
} from './render.js';

const projectsEl = document.getElementById('projects');
const listView = document.getElementById('list-view');
const detailView = document.getElementById('detail');
const lastUpdatedEl = document.getElementById('last-updated');
const form = document.getElementById('add-project-form');
const formErrorEl = document.getElementById('form-error');
const submitButton = document.getElementById('add-project-submit');
const refreshButton = document.getElementById('refresh-button');

let projects = [];
let loading = false;

const timeFormatter = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** fetch que lanza un error con el cuerpo JSON cuando la respuesta no es 2xx. */
async function request(url, init = {}) {
  const headers = { Accept: 'application/json', ...(init.headers || {}) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...init, headers });
  let payload = null;
  if (res.status !== 204) {
    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `Error HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload || { error: err.message };
    throw err;
  }
  return payload;
}

function setLastUpdated(date) {
  lastUpdatedEl.textContent = timeFormatter.format(date);
  lastUpdatedEl.setAttribute('datetime', date.toISOString());
}

function renderList() {
  const now = Date.now();
  if (projects.length === 0) {
    projectsEl.innerHTML = '<p class="muted">No hay proyectos registrados. Añade el primero con el formulario de abajo.</p>';
    return;
  }
  projectsEl.innerHTML = projects.map((p) => renderProjectCard(p, now)).join('');
}

async function load() {
  if (loading) return;
  loading = true;
  projectsEl.setAttribute('aria-busy', 'true');
  refreshButton.disabled = true;
  try {
    const data = await request(`${API_BASE}/projects`);
    if (!Array.isArray(data)) throw new Error('Respuesta inesperada');
    projects = data;
    renderList();
    setLastUpdated(new Date());
  } catch (err) {
    console.error('No se pudo cargar el listado:', err);
    projectsEl.innerHTML = renderLoadError();
  } finally {
    loading = false;
    projectsEl.setAttribute('aria-busy', 'false');
    refreshButton.disabled = false;
  }
}

function showList() {
  detailView.hidden = true;
  detailView.innerHTML = '';
  listView.hidden = false;
  window.scrollTo({ top: 0 });
}

async function showDetail(id) {
  try {
    const detail = await request(`${API_BASE}/projects/${encodeURIComponent(id)}`);
    detailView.innerHTML = renderProjectDetail(detail, Date.now());
    listView.hidden = true;
    detailView.hidden = false;
    window.scrollTo({ top: 0 });
    const back = detailView.querySelector('[data-action="back"]');
    if (back) back.focus();
  } catch (err) {
    console.error('No se pudo cargar el detalle:', err);
    window.alert(err.status === 404 ? 'El proyecto ya no está registrado.' : 'No se pudo cargar el detalle del proyecto.');
    if (err.status === 404) load();
  }
}

async function deleteProject(id) {
  try {
    const done = await handleDelete(id, { confirm: (msg) => window.confirm(msg), request });
    if (!done) return;
    projects = projects.filter((p) => p.id !== id);
    const card = projectsEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (card) card.remove();
    if (projects.length === 0) renderList();
  } catch (err) {
    console.error('No se pudo eliminar:', err);
    window.alert(err.status === 404 ? 'El proyecto ya no está registrado.' : 'No se pudo eliminar el proyecto.');
    if (err.status === 404) load();
  }
}

function clearFormError() {
  formErrorEl.innerHTML = '';
}

function showFormError(payload) {
  formErrorEl.innerHTML = renderFormError(payload);
  const field = payload && payload.field ? form.elements[payload.field] : null;
  if (field && typeof field.focus === 'function') field.focus();
}

async function submitForm(event) {
  event.preventDefault();
  clearFormError();
  const formData = new FormData(form);
  const payload = buildProjectPayload(Object.fromEntries(formData.entries()));
  submitButton.disabled = true;
  try {
    const created = await request(`${API_BASE}/projects`, { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    // Pedimos el estado real del proyecto recién creado para pintar su tarjeta sin recargar la página.
    let summary;
    try {
      const all = await request(`${API_BASE}/projects`);
      summary = Array.isArray(all) ? all.find((p) => p.id === created.id) : null;
      if (Array.isArray(all)) projects = all;
    } catch {
      summary = null;
    }
    if (!summary) {
      summary = { ...created, exists: true, status: 'ok', sdd: { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [] }, progress: { present: false, blocked: false, blockReason: null }, git: { isRepo: false, branch: null, lastCommit: null, dirtyCount: null } };
      delete summary.path;
      projects.push(summary);
    }
    renderList();
    setLastUpdated(new Date());
    const card = projectsEl.querySelector(`.card[data-id="${CSS.escape(created.id)}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) {
      showFormError(err.payload);
    } else {
      console.error('Fallo al añadir el proyecto:', err);
      showFormError({ error: 'No se pudo contactar con el servidor del panel' });
    }
  } finally {
    submitButton.disabled = false;
  }
}

function onProjectsClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === 'detail') showDetail(id);
  else if (action === 'delete') deleteProject(id);
  else if (action === 'retry') load();
}

function onDetailClick(event) {
  const target = event.target.closest('[data-action="back"]');
  if (target) showList();
}

projectsEl.addEventListener('click', onProjectsClick);
detailView.addEventListener('click', onDetailClick);
form.addEventListener('submit', submitForm);
form.addEventListener('input', clearFormError);
refreshButton.addEventListener('click', () => load());

load();
setInterval(() => {
  // No pisamos la vista de detalle mientras el usuario la está leyendo; el listado se refresca igualmente.
  load();
}, REFRESH_INTERVAL_MS);
