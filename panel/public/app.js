// Lógica del panel en el navegador: autenticación (setup/login/logout/cambio de contraseña), carga, refresco,
// detalle, alta y baja. Usa render.js (puro), api-client.js y app-config.js.
import { REFRESH_INTERVAL_MS, API_BASE } from './app-config.js';
import { createApiClient } from './api-client.js';
import {
  renderProjectCard,
  renderProjectDetail,
  renderFormError,
  renderLoadError,
  buildProjectPayload,
  handleDelete,
  resolveAuthView,
  renderAuthForm,
  renderAuthError,
  validateNewPassword,
  renderChangePasswordForm,
  buildChangePasswordPayload,
  handleLogout,
  renderPublicUrl,
} from './render.js';

const projectsEl = document.getElementById('projects');
const listView = document.getElementById('list-view');
const detailView = document.getElementById('detail');
const authView = document.getElementById('auth-view');
const changePasswordView = document.getElementById('change-password-view');
const sessionActions = document.getElementById('session-actions');
const publicUrlEl = document.getElementById('public-url');
const lastUpdatedEl = document.getElementById('last-updated');
const form = document.getElementById('add-project-form');
const formErrorEl = document.getElementById('form-error');
const submitButton = document.getElementById('add-project-submit');
const refreshButton = document.getElementById('refresh-button');
const logoutButton = document.getElementById('logout-button');
const changePasswordButton = document.getElementById('change-password-button');

let projects = [];
let loading = false;
let authenticated = false;
let refreshTimer = null;

const timeFormatter = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Un 401 fuera del login significa que la sesión ya no vale: volvemos al login y paramos el refresco. */
const request = createApiClient({
  onUnauthorized: () => {
    authenticated = false;
    stopRefresh();
    showAuth('login');
  },
});

// ---------- Vistas ----------

function stopRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function hideAll() {
  listView.hidden = true;
  detailView.hidden = true;
  detailView.innerHTML = '';
  authView.hidden = true;
  changePasswordView.hidden = true;
  changePasswordView.innerHTML = '';
}

function showAuth(mode) {
  hideAll();
  sessionActions.hidden = true;
  authView.innerHTML = renderAuthForm(mode);
  authView.hidden = false;
  const field = authView.querySelector('input[name="password"]');
  if (field) field.focus();
  window.scrollTo({ top: 0 });
}

function showPanel() {
  authenticated = true;
  hideAll();
  authView.innerHTML = '';
  listView.hidden = false;
  sessionActions.hidden = false;
  load();
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      // No pisamos la vista de detalle mientras el usuario la está leyendo; el listado se refresca igualmente.
      load();
    }, REFRESH_INTERVAL_MS);
  }
}

function showChangePassword() {
  hideAll();
  changePasswordView.innerHTML = renderChangePasswordForm();
  changePasswordView.hidden = false;
  const field = changePasswordView.querySelector('input[name="currentPassword"]');
  if (field) field.focus();
  window.scrollTo({ top: 0 });
}

function setAuthError(container, message) {
  const slot = container.querySelector('.form-error-slot');
  if (slot) slot.innerHTML = message ? renderAuthError(message) : '';
}

function setAuthStatus(container, message) {
  const slot = container.querySelector('.form-error-slot');
  if (slot) slot.innerHTML = `<p class="form-status" role="status">${message}</p>`;
}

function errorMessage(err, fallback) {
  if (err && err.status && err.status >= 400 && err.status < 500) {
    return (err.payload && err.payload.error) || fallback;
  }
  console.error(fallback, err);
  return 'No se pudo contactar con el servidor del panel';
}

// ---------- Autenticación ----------

async function boot() {
  try {
    const status = await request(`${API_BASE}/auth/status`);
    publicUrlEl.innerHTML = renderPublicUrl(status && status.publicUrl ? status.publicUrl : null);
    const view = resolveAuthView(status);
    if (view === 'panel') showPanel();
    else showAuth(view);
  } catch (err) {
    console.error('No se pudo consultar el estado de autenticación:', err);
    hideAll();
    authView.innerHTML = renderLoadError();
    authView.hidden = false;
  }
}

async function submitAuth(event) {
  event.preventDefault();
  const authForm = event.target;
  const mode = authForm.dataset.mode;
  const values = Object.fromEntries(new FormData(authForm).entries());
  setAuthError(authView, '');
  if (mode === 'setup') {
    const valid = validateNewPassword(values.password, values.confirm);
    if (!valid.ok) return setAuthError(authView, valid.error);
  } else if (!values.password) {
    return setAuthError(authView, 'Falta la contraseña');
  }
  const button = authForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await request(`${API_BASE}/auth/${mode === 'setup' ? 'setup' : 'login'}`, { method: 'POST', body: JSON.stringify({ password: values.password }) });
    showPanel();
  } catch (err) {
    setAuthError(authView, errorMessage(err, mode === 'setup' ? 'No se pudo crear la contraseña' : 'No se pudo iniciar sesión'));
    const field = authForm.querySelector('input[name="password"]');
    if (field) field.focus();
  } finally {
    if (button) button.disabled = false;
  }
}

async function logout() {
  logoutButton.disabled = true;
  try {
    await handleLogout({ request });
  } catch (err) {
    console.error('No se pudo cerrar la sesión en el servidor:', err);
  } finally {
    logoutButton.disabled = false;
  }
  authenticated = false;
  stopRefresh();
  showAuth('login');
}

async function submitChangePassword(event) {
  event.preventDefault();
  const changeForm = event.target;
  const values = Object.fromEntries(new FormData(changeForm).entries());
  setAuthError(changePasswordView, '');
  const valid = validateNewPassword(values.newPassword, values.confirm);
  if (!valid.ok) return setAuthError(changePasswordView, valid.error);
  const button = changeForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await request(`${API_BASE}/auth/change-password`, { method: 'POST', body: JSON.stringify(buildChangePasswordPayload(values)) });
    changeForm.reset();
    setAuthStatus(changePasswordView, 'Contraseña cambiada');
  } catch (err) {
    if (err && err.status === 401) return; // onUnauthorized ya ha vuelto al login
    setAuthError(changePasswordView, errorMessage(err, 'No se pudo cambiar la contraseña'));
    const fieldName = err && err.payload && err.payload.field;
    const field = fieldName ? changeForm.elements[fieldName] : null;
    if (field && typeof field.focus === 'function') field.focus();
  } finally {
    if (button) button.disabled = false;
  }
}

function onChangePasswordClick(event) {
  const target = event.target.closest('[data-action="cancel-change"]');
  if (target) showPanel();
}

// ---------- Listado y detalle ----------

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
  if (loading || !authenticated) return;
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
    if (err && err.status === 401) return; // onUnauthorized ya ha mostrado el login
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
    if (err && err.status === 401) return;
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
    if (err && err.status === 401) return;
    console.error('No se pudo eliminar:', err);
    window.alert(err.status === 404 ? 'El proyecto ya no está registrado.' : 'No se pudo eliminar el proyecto.');
    if (err.status === 404) load();
  }
}

// ---------- Alta ----------

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
    if (err && err.status === 401) return;
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

// ---------- Eventos ----------

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

function onAuthClick(event) {
  const target = event.target.closest('[data-action="retry"]');
  if (target) boot();
}

projectsEl.addEventListener('click', onProjectsClick);
detailView.addEventListener('click', onDetailClick);
authView.addEventListener('submit', submitAuth);
authView.addEventListener('click', onAuthClick);
changePasswordView.addEventListener('submit', submitChangePassword);
changePasswordView.addEventListener('click', onChangePasswordClick);
form.addEventListener('submit', submitForm);
form.addEventListener('input', clearFormError);
refreshButton.addEventListener('click', () => load());
logoutButton.addEventListener('click', logout);
changePasswordButton.addEventListener('click', showChangePassword);

boot();
