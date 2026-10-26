// Lógica del panel en el navegador: autenticación (setup/login/logout/cambio de contraseña), carga, refresco,
// detalle, alta y baja; fase 3: proyectos de Claude Code (fijar, ocultar, ajustes, aviso); fase 4: pestaña
// "Trabajar" (Claude Code, botones SDD, tests, cambios, commit y push, salida en vivo con EventSource), diálogos de
// confirmación y de contraseña, y "Te necesitan". Usa render.js y work.js (puros), api-client.js y app-config.js.
import { REFRESH_INTERVAL_MS, API_BASE } from './app-config.js';
import { createApiClient } from './api-client.js';
import {
  renderProjectCard,
  renderProjectDetail,
  renderFormError,
  renderLoadError,
  escapeHtml,
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
  renderHiddenToggle,
  renderClaudeNotice,
  buildSettingsPayload,
  patchProject,
  togglePin,
  toggleHidden,
  buildProjectsUrl,
  splitHidden,
} from './render.js';
import {
  renderWorkView,
  describeAction,
  renderConfirmDialogBody,
  renderRunEvent,
  renderRunLog,
  renderRunList,
  renderPermissionPrompt,
  buildRetryPayload,
  renderChanges,
  renderDiff,
  renderAttention,
  suggestCommitMessage,
  buildRunPayload,
  buildExecSettingsPayload,
  withReauth,
  renderBroadWarning,
  renderHooksWarning,
  renderConfigWarning,
  STATE_LABELS,
  ACTIVE_STATES,
  MAX_LOG_EVENTS,
} from './work.js';

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
const claudeNoticeEl = document.getElementById('claude-notice');
const hiddenToggleEl = document.getElementById('hidden-toggle');
const attentionEl = document.getElementById('attention');
const confirmDialog = document.getElementById('confirm-dialog');
const confirmBody = document.getElementById('confirm-dialog-body');
const confirmExtra = document.getElementById('confirm-dialog-extra');
const reauthDialog = document.getElementById('reauth-dialog');
const reauthForm = document.getElementById('reauth-form');
const reauthPassword = document.getElementById('reauth-password');
const reauthError = document.getElementById('reauth-error');

let projects = [];
let loading = false;
let authenticated = false;
let refreshTimer = null;
let showHidden = false;
let claudeStatus = null;
let currentDetail = null; // detalle del proyecto abierto
let currentWork = null; // GET /api/projects/:id/work
let currentRun = null; // { runId, events, meta }
let runStream = null; // EventSource del run actual

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
  closeRunStream();
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
  loadClaudeStatus();
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
  // Se piden siempre todos (incluidos los ocultos) y se filtran aquí: así el recuento de ocultos es exacto.
  const { visible, hiddenCount } = splitHidden(projects, showHidden);
  hiddenToggleEl.innerHTML = renderHiddenToggle(hiddenCount, showHidden);
  if (visible.length === 0) {
    projectsEl.innerHTML = projects.length === 0
      ? '<p class="muted">No hay proyectos registrados. Abre un proyecto en Claude Code o añade el primero con el formulario de abajo.</p>'
      : '<p class="muted">Todos los proyectos están ocultos.</p>';
    return;
  }
  projectsEl.innerHTML = visible.map((p) => renderProjectCard(p, now)).join('');
}

/** Pide una vez el estado de Claude Code y pinta el aviso discreto si no se detecta (F3-R44). */
async function loadClaudeStatus() {
  if (claudeStatus) return;
  try {
    claudeStatus = await request(`${API_BASE}/claude/status`);
    claudeNoticeEl.innerHTML = renderClaudeNotice(claudeStatus);
  } catch (err) {
    if (err && err.status === 401) return;
    console.error('No se pudo consultar el estado de Claude Code:', err);
  }
}

async function load() {
  if (loading || !authenticated) return;
  loading = true;
  projectsEl.setAttribute('aria-busy', 'true');
  refreshButton.disabled = true;
  try {
    const data = await request(buildProjectsUrl(true));
    if (!Array.isArray(data)) throw new Error('Respuesta inesperada');
    projects = data;
    renderList();
    setLastUpdated(new Date());
    loadAttention();
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
  closeRunStream();
  detailView.hidden = true;
  detailView.innerHTML = '';
  listView.hidden = false;
  window.scrollTo({ top: 0 });
}

/** Pestañas Resumen / Trabajar del detalle (fase 4). */
function renderTabs(active) {
  const tab = (name, label) => `<button type="button" class="tab" role="tab" data-action="tab" data-tab="${name}" aria-selected="${active === name}">${label}</button>`;
  return `<div class="tabs" role="tablist">${tab('summary', 'Resumen')}${tab('work', 'Trabajar')}</div>`;
}

/** Inserta las pestañas tras la cabecera del detalle y separa el resumen (fase 3) del contenedor de "Trabajar". */
function mountTabs(active) {
  const section = detailView.querySelector('.detail');
  const header = section && section.querySelector('.detail-header');
  if (!section || !header) return;
  const summary = document.createElement('div');
  summary.id = 'tab-summary';
  while (header.nextSibling) summary.appendChild(header.nextSibling);
  header.insertAdjacentHTML('afterend', renderTabs(active));
  section.appendChild(summary);
  const workEl = document.createElement('div');
  workEl.id = 'tab-work';
  section.appendChild(workEl);
  summary.hidden = active !== 'summary';
  workEl.hidden = active !== 'work';
}

function selectTab(name) {
  for (const tab of detailView.querySelectorAll('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  const summary = detailView.querySelector('#tab-summary');
  const workEl = detailView.querySelector('#tab-work');
  if (summary) summary.hidden = name !== 'summary';
  if (workEl) workEl.hidden = name !== 'work';
  if (name === 'work') openWork();
  else closeRunStream();
}

async function showDetail(id, { tab = 'summary', runId = null } = {}) {
  try {
    const detail = await request(`${API_BASE}/projects/${encodeURIComponent(id)}`);
    closeRunStream();
    currentDetail = detail;
    detailView.innerHTML = renderProjectDetail(detail, Date.now());
    mountTabs(tab);
    listView.hidden = true;
    detailView.hidden = false;
    window.scrollTo({ top: 0 });
    if (tab === 'work') await openWork({ runId });
    const back = detailView.querySelector('[data-action="back"]');
    if (back && tab !== 'work') back.focus();
  } catch (err) {
    if (err && err.status === 401) return;
    console.error('No se pudo cargar el detalle:', err);
    window.alert(err.status === 404 ? 'El proyecto ya no está registrado.' : 'No se pudo cargar el detalle del proyecto.');
    if (err.status === 404) load();
  }
}

/** Fijar / ocultar desde la tarjeta (F3-R42, F3-R48). */
async function runCardToggle(id, action, button) {
  const project = projects.find((p) => p.id === id);
  if (!project) return;
  if (button) button.disabled = true;
  try {
    if (action === 'pin') await togglePin(project, { request });
    else await toggleHidden(project, { request });
    await load();
  } catch (err) {
    if (err && err.status === 401) return;
    console.error('No se pudo guardar el ajuste:', err);
    window.alert(err && err.status === 404 ? 'El proyecto ya no está en el panel.' : 'No se pudo guardar el cambio.');
    load();
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
}

function setSettingsMessage(html) {
  const slot = detailView.querySelector('#settings-error');
  if (slot) slot.innerHTML = html;
}

/** Guarda el formulario de ajustes del detalle con PATCH (F3-R46, F3-R47). */
async function submitSettings(event) {
  if (!event.target || event.target.id !== 'settings-form') return;
  event.preventDefault();
  const settingsForm = event.target;
  const id = settingsForm.dataset.id;
  const payload = buildSettingsPayload(Object.fromEntries(new FormData(settingsForm).entries()));
  setSettingsMessage('');
  const button = settingsForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await patchProject(id, payload, { request });
    await showDetail(id);
    setSettingsMessage('<p class="form-status" role="status">Ajustes guardados</p>');
    load();
  } catch (err) {
    if (err && err.status === 401) return;
    if (err && err.status >= 400 && err.status < 500) {
      setSettingsMessage(renderFormError(err.payload));
      const field = err.payload && err.payload.field ? settingsForm.elements[err.payload.field] : null;
      if (field && typeof field.focus === 'function') field.focus();
    } else {
      console.error('No se pudieron guardar los ajustes:', err);
      setSettingsMessage(renderFormError({ error: 'No se pudo contactar con el servidor del panel' }));
    }
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
}

async function deleteProject(id) {
  try {
    const done = await handleDelete(id, { confirm: (msg) => window.confirm(msg), request });
    if (!done) return;
    projects = projects.filter((p) => p.id !== id);
    renderList();
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
      const all = await request(buildProjectsUrl(true));
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

// ---------- Fase 4: diálogos de confirmación y de contraseña ----------

/** Abre un <dialog> modal y resuelve con su returnValue al cerrarse. */
function openDialog(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}

/**
 * Diálogo de confirmación con el texto de describeAction (ya escapado) y un HTML extra opcional. Feature 14:
 * `confirmLabel` cambia el texto del botón de confirmar mientras el diálogo está abierto (por defecto "Confirmar").
 */
async function confirmAction(text, { extraHtml = '', confirmLabel = null } = {}) {
  if (!confirmDialog || typeof confirmDialog.showModal !== 'function') {
    const plain = document.createElement('div');
    plain.innerHTML = text;
    return { confirmed: window.confirm(plain.textContent), values: {} };
  }
  confirmBody.innerHTML = renderConfirmDialogBody(text);
  confirmExtra.innerHTML = extraHtml;
  const okButton = document.getElementById('confirm-dialog-ok');
  const originalLabel = okButton ? okButton.textContent : null;
  if (okButton && confirmLabel) okButton.textContent = confirmLabel;
  const result = await openDialog(confirmDialog);
  if (okButton && originalLabel !== null) okButton.textContent = originalLabel;
  const values = {};
  for (const field of confirmExtra.querySelectorAll('[name]')) values[field.name] = field.value;
  confirmExtra.innerHTML = '';
  return { confirmed: result === 'confirm', values };
}

/** Pide la contraseña (R86): resuelve con la contraseña o null si se cancela. */
async function askPassword(message) {
  reauthForm.reset();
  reauthError.hidden = !message;
  reauthError.textContent = message || '';
  const pending = openDialog(reauthDialog);
  reauthPassword.focus();
  const result = await pending;
  const value = reauthPassword.value;
  reauthForm.reset();
  return result === 'confirm' && value ? value : null;
}

function reauth(password) {
  return request(`${API_BASE}/auth/reauth`, { method: 'POST', body: JSON.stringify({ password }) });
}

/** Ejecuta una petición de acción de ejecución repitiéndola una vez tras confirmar la contraseña si hace falta. */
function execRequest(url, init) {
  return withReauth(() => request(url, init), { askPassword, reauth });
}

function showActionError(err, fallback) {
  if (err && err.status === 401 && !(err.payload && err.payload.reauthRequired)) return; // sesión caducada: login
  window.alert(errorMessage(err, fallback));
}

// ---------- Fase 4: vista "Trabajar" ----------

function projectUrl(suffix = '') {
  return `${API_BASE}/projects/${encodeURIComponent(currentDetail.id)}${suffix}`;
}

function workEl(selector) {
  return detailView.querySelector(selector);
}

function closeRunStream() {
  if (runStream) {
    runStream.close();
    runStream = null;
  }
}

async function openWork({ runId = null } = {}) {
  const container = workEl('#tab-work');
  if (!container || !currentDetail) return;
  try {
    const [work, runs] = await Promise.all([request(projectUrl('/work')), request(projectUrl('/runs'))]);
    currentWork = work;
    container.innerHTML = renderWorkView(work, { runs, now: Date.now() });
    // Feature 14 (R19) / feature 19 (R16): aviso de comandos de ejecución libre dentro del grupo de permisos de Claude.
    const broadSlot = container.querySelector('#exec-broad-slot');
    if (broadSlot) broadSlot.innerHTML = renderBroadWarning(work.broadCommands);
    const target = runId || (work.activeRun && work.activeRun.runId);
    if (target) await openRun(target);
  } catch (err) {
    if (err && err.status === 401) return;
    console.error('No se pudo cargar la vista Trabajar:', err);
    container.innerHTML = renderLoadError();
  }
}

async function refreshHistory() {
  if (!currentDetail) return;
  try {
    const runs = await request(projectUrl('/runs'));
    const history = workEl('#run-history');
    if (history) history.innerHTML = renderRunList(runs, Date.now());
  } catch (err) {
    if (!err || err.status !== 401) console.error('No se pudo recargar el historial:', err);
  }
}

function setRunState(state) {
  const el = workEl('#run-state');
  if (el) el.innerHTML = STATE_LABELS[state] ? `<span class="badge state-${state}">${STATE_LABELS[state]}</span>` : '';
  const cancel = workEl('[data-action="cancel-run"]');
  if (cancel) cancel.hidden = !ACTIVE_STATES.includes(state);
}

function appendRunEvent(event) {
  if (!currentRun) return;
  currentRun.events.push(event);
  const log = workEl('#run-log');
  if (!log) return;
  if (currentRun.events.length > MAX_LOG_EVENTS) log.innerHTML = renderRunLog(currentRun.events);
  else {
    // El result no repite el último texto del asistente (corrección T36).
    const previous = currentRun.events.slice(0, -1).filter((e) => e.type === 'text').at(-1);
    log.insertAdjacentHTML('beforeend', renderRunEvent(event, { lastText: previous ? previous.text : null }));
  }
  log.scrollTop = log.scrollHeight;
  if (event.type === 'state') setRunState(event.state);
}

/** Pinta el aviso de permisos del run terminado (R84). */
function showPermissions(meta) {
  const slot = workEl('#run-permission');
  if (slot) slot.innerHTML = renderPermissionPrompt(meta);
}

async function finishRun(runId) {
  closeRunStream();
  try {
    const { run } = await request(`${API_BASE}/runs/${encodeURIComponent(runId)}`);
    if (currentRun && currentRun.runId === runId) currentRun.meta = run;
    setRunState(run.state);
    showPermissions(run);
  } catch (err) {
    if (!err || err.status !== 401) console.error('No se pudo leer el final de la ejecución:', err);
  }
  refreshHistory();
  loadAttention();
}

/** Conecta la salida en vivo de un run con EventSource (reconexión nativa con Last-Event-ID). */
function streamRun(runId) {
  closeRunStream();
  if (typeof EventSource !== 'function') return;
  const es = new EventSource(`${API_BASE}/runs/${encodeURIComponent(runId)}/events`);
  runStream = es;
  es.onmessage = (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    if (!currentRun || currentRun.runId !== runId) return;
    if (currentRun.events.some((e) => e.seq === event.seq)) return;
    appendRunEvent(event);
    if (event.type === 'end') finishRun(runId);
  };
}

/** Abre un run (del historial, de "Te necesitan" o recién lanzado) y, si está activo, su salida en vivo. */
async function openRun(runId) {
  closeRunStream();
  currentRun = { runId, events: [], meta: null };
  const log = workEl('#run-log');
  if (log) log.innerHTML = '';
  showPermissions(null);
  try {
    const { run, events } = await request(`${API_BASE}/runs/${encodeURIComponent(runId)}`);
    if (!currentRun || currentRun.runId !== runId) return;
    currentRun.meta = run;
    currentRun.events = events.slice();
    if (log) log.innerHTML = renderRunLog(events);
    setRunState(run.state);
    if (ACTIVE_STATES.includes(run.state)) streamRun(runId);
    else showPermissions(run);
    const panel = workEl('.run-panel');
    if (panel) panel.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    showActionError(err, 'No se pudo abrir la ejecución');
  }
}

function runContext(extra = {}) {
  return { projectName: currentDetail.name, allowedCommands: currentWork ? currentWork.allowedCommands : [], ...extra };
}

/** Feature 14: la API pide la confirmación expresa de comandos de ejecución libre (400 con needsAcknowledge). */
function isBroadRejection(err) {
  return Boolean(err && err.status === 400 && err.payload && err.payload.needsAcknowledge === true);
}

/** Diálogo de aviso de comando amplio: true solo si el humano pulsa "Autorizar de todos modos". */
async function confirmBroad(broadCommands) {
  const { confirmed } = await confirmAction(describeAction('allow-broad', runContext({ broadCommands })), { confirmLabel: 'Autorizar de todos modos' });
  return confirmed;
}

/**
 * Petición de ejecución que, si la API responde needsAcknowledge, muestra el aviso y solo la repite con
 * acknowledgeBroad: true si el humano lo confirma (null si no).
 */
async function execRequestWithBroad(url, method, payload) {
  try {
    return await execRequest(url, { method, body: JSON.stringify(payload) });
  } catch (err) {
    if (!isBroadRejection(err)) throw err;
    if (!(await confirmBroad(err.payload.broadCommands || []))) return null;
    return execRequest(url, { method, body: JSON.stringify({ ...payload, acknowledgeBroad: true }) });
  }
}

/** Lanza una acción que crea un run (POST que responde 202 con RunMeta) y conecta su salida. */
async function startRun(url, body) {
  const meta = await execRequest(url, { method: 'POST', body: JSON.stringify(body || {}) });
  if (!meta) return null; // el usuario canceló la confirmación de contraseña
  await openRun(meta.runId);
  refreshHistory();
  return meta;
}

async function submitPrompt(event) {
  event.preventDefault();
  const form = event.target;
  const payload = buildRunPayload(Object.fromEntries(new FormData(form).entries()));
  if (!payload.prompt.trim()) {
    window.alert('Escribe un mensaje para Claude');
    return;
  }
  const session = { ...payload.session };
  if (session.mode === 'resume' && currentWork) {
    const found = currentWork.sessions.find((s) => s.id === session.id);
    session.title = found ? found.title : session.id;
  }
  const { confirmed } = await confirmAction(describeAction('chat', runContext({ prompt: payload.prompt, session })));
  if (!confirmed) return;
  try {
    if (await startRun(projectUrl('/runs'), payload)) form.reset();
  } catch (err) {
    showActionError(err, 'No se pudo lanzar Claude Code');
  }
}

async function runSdd(kind) {
  const { confirmed } = await confirmAction(describeAction(kind, runContext()));
  if (!confirmed) return;
  try {
    await startRun(projectUrl(`/sdd/${kind}`), {});
  } catch (err) {
    showActionError(err, 'No se pudo lanzar Claude Code');
  }
}

async function approveSpecAction(target) {
  const featureId = /^\d+$/.test(target.dataset.featureId) ? Number(target.dataset.featureId) : target.dataset.featureId;
  const { confirmed } = await confirmAction(describeAction('approve-spec', runContext({ featureId, featureSlug: target.dataset.featureSlug })));
  if (!confirmed) return;
  try {
    const result = await execRequest(projectUrl('/sdd/approve-spec'), { method: 'POST', body: JSON.stringify({ featureId }) });
    if (!result) return;
    await openWork();
    // Spec aprobada: se ofrece lanzar "Implementar siguiente tarea" con una confirmación nueva.
    const next = await confirmAction(`Spec #${result.feature.id} aprobada. ${describeAction('implement', runContext())}`);
    if (next.confirmed) await startRun(projectUrl('/sdd/implement'), {});
  } catch (err) {
    showActionError(err, 'No se pudo aprobar la spec');
  }
}

async function runTestsAction() {
  const { confirmed } = await confirmAction(describeAction('tests', runContext({ effectiveTestCommand: currentWork.effectiveTestCommand })));
  if (!confirmed) return;
  try {
    await startRun(projectUrl('/tests'), {});
  } catch (err) {
    showActionError(err, 'No se pudieron lanzar los tests');
  }
}

async function showChanges() {
  const panel = workEl('#changes-panel');
  if (!panel) return;
  try {
    const changes = await request(projectUrl('/changes'));
    panel.innerHTML = renderChanges(changes);
    panel.hidden = false;
    panel.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    showActionError(err, 'No se pudieron leer los cambios');
  }
}

async function showDiff(file) {
  const view = workEl('#diff-view');
  if (!view) return;
  try {
    const diff = await request(`${projectUrl('/changes/diff')}?file=${encodeURIComponent(file)}`);
    view.innerHTML = renderDiff(diff);
  } catch (err) {
    showActionError(err, 'No se pudo leer el diff');
  }
}

async function commitPushAction() {
  let branch = '';
  let changes = {};
  try {
    changes = (await request(projectUrl('/changes'))) || {};
    branch = changes.branch || '';
  } catch (err) {
    showActionError(err, 'No se pudieron leer los cambios');
    return;
  }
  const message = suggestCommitMessage(currentWork);
  // Feature 14 (R25) / feature 19 (R12): aviso de hooks y, detrás, aviso de la configuración local que ejecuta programas.
  const extraHtml = `${renderHooksWarning(changes)}${renderConfigWarning(changes.execConfig)}<div class="field"><label for="commit-message">Mensaje del commit (puedes editarlo)</label><textarea id="commit-message" name="message" maxlength="2000" rows="3">${escapeHtml(message)}</textarea></div>`;
  const { confirmed, values } = await confirmAction(describeAction('commit-push', runContext({ message, branch })), { extraHtml });
  if (!confirmed) return;
  try {
    await startRun(projectUrl('/git/commit-push'), { message: values.message ?? message });
  } catch (err) {
    showActionError(err, 'No se pudo hacer commit y push');
  }
}

async function cancelCurrentRun() {
  if (!currentRun) return;
  try {
    await request(`${API_BASE}/runs/${encodeURIComponent(currentRun.runId)}/cancel`, { method: 'POST' });
  } catch (err) {
    if (err && err.status === 409) return finishRun(currentRun.runId);
    showActionError(err, 'No se pudo cancelar la ejecución');
  }
  return undefined;
}

/** "Permitir en este proyecto y reintentar" (R84): añade el comando y relanza el mismo prompt reanudando la sesión. */
async function allowCommandAction(command) {
  const run = currentRun && currentRun.meta;
  const promptEvent = currentRun && currentRun.events.find((e) => e.type === 'prompt');
  const { confirmed } = await confirmAction(describeAction('allow-command', runContext({ command })));
  if (!confirmed) return;
  try {
    const added = await execRequestWithBroad(projectUrl('/permissions'), 'POST', { command });
    if (!added) return;
    if (currentWork) currentWork.allowedCommands = added.allowedCommands;
    if (run && promptEvent) await startRun(projectUrl('/runs'), buildRetryPayload(run, promptEvent.text));
  } catch (err) {
    showActionError(err, 'No se pudo autorizar el comando');
  }
}

async function submitExecSettings(event) {
  event.preventDefault();
  const form = event.target;
  const payload = buildExecSettingsPayload(Object.fromEntries(new FormData(form).entries()));
  const slot = form.querySelector('#exec-settings-error');
  if (slot) slot.innerHTML = '';
  const { confirmed } = await confirmAction(describeAction('exec-settings', runContext({ count: payload.allowedCommands.length })));
  if (!confirmed) return;
  try {
    const saved = await execRequestWithBroad(projectUrl(), 'PATCH', payload);
    if (!saved) return;
    await openWork();
    const newSlot = workEl('#exec-settings-error');
    if (newSlot) newSlot.innerHTML = '<p class="form-status" role="status">Ajustes de ejecución guardados</p>';
  } catch (err) {
    if (err && err.status >= 400 && err.status < 500 && slot && !(err.status === 401 && !(err.payload && err.payload.reauthRequired))) slot.innerHTML = renderFormError(err.payload);
    else showActionError(err, 'No se pudieron guardar los ajustes de ejecución');
  }
}

function onWorkAction(action, target) {
  if (!currentDetail) return;
  if (action === 'implement' || action === 'approve-tests') runSdd(action);
  else if (action === 'approve-spec') approveSpecAction(target);
  else if (action === 'run-tests') runTestsAction();
  else if (action === 'show-changes') showChanges();
  else if (action === 'show-diff') showDiff(target.dataset.file);
  else if (action === 'commit-push') commitPushAction();
  else if (action === 'cancel-run') cancelCurrentRun();
  else if (action === 'open-run') openRun(target.dataset.runId);
  else if (action === 'allow-command') allowCommandAction(target.dataset.command);
}

// ---------- Fase 4: "Te necesitan" (portada) ----------

async function loadAttention() {
  if (!authenticated) return;
  try {
    const data = await request(`${API_BASE}/attention`);
    const html = renderAttention(data, Date.now());
    attentionEl.innerHTML = html;
    attentionEl.hidden = !html;
  } catch (err) {
    if (!err || err.status !== 401) console.error('No se pudo cargar "Te necesitan":', err);
  }
}

async function onAttentionClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id, runId } = target.dataset;
  if (action === 'open-work') showDetail(id, { tab: 'work' });
  else if (action === 'open-run') showDetail(id, { tab: 'work', runId });
  else if (action === 'dismiss-run') {
    target.disabled = true;
    try {
      await request(`${API_BASE}/runs/${encodeURIComponent(runId)}/dismiss`, { method: 'POST' });
    } catch (err) {
      showActionError(err, 'No se pudo descartar el aviso');
    }
    loadAttention();
  }
}

// ---------- Eventos ----------

function onProjectsClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === 'detail') showDetail(id);
  else if (action === 'delete') deleteProject(id);
  else if (action === 'pin' || action === 'hide') runCardToggle(id, action, target);
  else if (action === 'retry') load();
}

function onHiddenToggleClick(event) {
  const target = event.target.closest('[data-action="toggle-hidden"]');
  if (!target) return;
  showHidden = !showHidden;
  renderList();
}

function onDetailClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  if (action === 'back') showList();
  else if (action === 'tab') selectTab(target.dataset.tab);
  else onWorkAction(action, target);
}

function onDetailSubmit(event) {
  if (!event.target) return;
  if (event.target.id === 'settings-form') return submitSettings(event);
  if (event.target.id === 'prompt-form') return submitPrompt(event);
  if (event.target.id === 'exec-settings-form') return submitExecSettings(event);
  return undefined;
}

function onAuthClick(event) {
  const target = event.target.closest('[data-action="retry"]');
  if (target) boot();
}

projectsEl.addEventListener('click', onProjectsClick);
detailView.addEventListener('click', onDetailClick);
detailView.addEventListener('submit', onDetailSubmit);
attentionEl.addEventListener('click', onAttentionClick);
hiddenToggleEl.addEventListener('click', onHiddenToggleClick);
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
