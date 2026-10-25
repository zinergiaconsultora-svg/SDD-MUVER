// Funciones PURAS de renderizado: reciben datos y devuelven cadenas HTML. Sin DOM, testeables en Node.

export const STATUS_LABELS = Object.freeze({
  atencion: 'Atención',
  en_curso: 'En curso',
  inactivo: 'Inactivo',
  ok: 'OK',
  no_encontrado: 'No encontrado',
});

const FEATURE_STATUS_LABELS = Object.freeze({
  pending: 'Pendiente',
  spec_ready: 'Spec lista',
  in_progress: 'En curso',
  done: 'Hecha',
});

/** Feature 13 (design.md §6.2): origen del resumen "de qué va". */
export const SUMMARY_SOURCE_LABELS = Object.freeze({
  manual: 'Escrito por ti',
  claude: 'Generado por Claude',
  package: 'De package.json',
  readme: 'Del README',
  'claude-md': 'De CLAUDE.md',
});
export const NO_SUMMARY_TEXT = 'Sin descripción';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Fecha relativa en español: "hoy", "ayer", "hace 3 días", "hace 1 mes"… */
export function relativeDate(isoDate, now = Date.now()) {
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return 'fecha desconocida';
  const diffMs = now - time;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
  const years = Math.floor(days / 365);
  return years === 1 ? 'hace 1 año' : `hace ${years} años`;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Tiempo relativo fino (F3-R50): "ahora mismo", "hace N min", "hace N h" y, desde 24 h, relativeDate. */
export function relativeTime(isoDate, now = Date.now()) {
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return 'fecha desconocida';
  const diffMs = now - time;
  if (diffMs < MINUTE_MS) return 'ahora mismo';
  if (diffMs < HOUR_MS) return `hace ${Math.floor(diffMs / MINUTE_MS)} min`;
  if (diffMs < DAY_MS) return `hace ${Math.floor(diffMs / HOUR_MS)} h`;
  return relativeDate(isoDate, now);
}

function statusBadge(status) {
  const safe = STATUS_LABELS[status] ? status : 'ok';
  return `<span class="badge status-${safe}">${escapeHtml(STATUS_LABELS[safe])}</span>`;
}

function renderGitBlock(git, now) {
  if (!git || !git.isRepo) return '<p class="muted">Sin repositorio git</p>';
  const branch = `<span class="branch" title="Rama actual">${escapeHtml(git.branch || 'HEAD')}</span>`;
  const commit = git.lastCommit
    ? `<p class="commit"><time datetime="${escapeHtml(git.lastCommit.date)}">${escapeHtml(relativeDate(git.lastCommit.date, now))}</time> · ${escapeHtml(git.lastCommit.message)}</p>`
    : '<p class="muted">Sin commits todavía</p>';
  const dirty = git.dirtyCount > 0
    ? `<p class="dirty">${git.dirtyCount} ${git.dirtyCount === 1 ? 'fichero' : 'ficheros'} sin commitear</p>`
    : '';
  return `<div class="git">${branch}${commit}${dirty}</div>`;
}

function renderCounts(counts) {
  const c = counts || { pending: 0, spec_ready: 0, in_progress: 0, done: 0 };
  return `<dl class="counts">
      <div><dt>Pendientes</dt><dd>${Number(c.pending) || 0}</dd></div>
      <div><dt>Spec lista</dt><dd>${Number(c.spec_ready) || 0}</dd></div>
      <div><dt>En curso</dt><dd>${Number(c.in_progress) || 0}</dd></div>
      <div><dt>Hechas</dt><dd>${Number(c.done) || 0}</dd></div>
    </dl>`;
}

function renderSddBlock(sdd, progress) {
  if (!sdd || !sdd.present) return '<p class="muted">Sin arnés SDD</p>';
  const parts = [];
  if (sdd.error) {
    parts.push(`<p class="warning">feature_list.json ilegible: ${escapeHtml(sdd.error)}</p>`);
  } else {
    parts.push(renderCounts(sdd.counts));
  }
  if (sdd.awaitingApproval && sdd.awaitingApproval.length > 0) {
    parts.push(`<p class="awaiting">Esperando aprobación humana (${sdd.awaitingApproval.length})</p>`);
  }
  if (sdd.inProgress) {
    parts.push(`<p class="in-progress">En curso: <strong>#${escapeHtml(sdd.inProgress.id)} ${escapeHtml(sdd.inProgress.slug)}</strong></p>`);
  }
  if (progress && progress.blocked) {
    parts.push(`<p class="blocked">Bloqueo: ${escapeHtml(progress.blockReason)}</p>`);
  }
  return `<div class="sdd">${parts.join('')}</div>`;
}

function renderTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  return `<ul class="tags">${tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
}

/** La URL si empieza por http:// o https://; si no, '' (nunca un href con javascript:, data:… — F4-R90). */
export function safeHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
}

export function renderOpenApp(appUrl) {
  const safe = safeHttpUrl(appUrl);
  if (safe) {
    return `<a class="btn primary" href="${escapeHtml(safe)}" target="_blank" rel="noopener">Abrir app</a>`;
  }
  return '<a class="btn primary" aria-disabled="true" title="Sin URL de la app configurada">Abrir app</a>';
}

// ---------- Fase 3: proyectos de Claude Code (F3-R41, F3-R42) ----------

/** Un proyecto sin `source` (datos de la fase 1) se trata como manual. */
function isManual(project) {
  return (project.source ?? 'manual') === 'manual';
}

function isFromClaude(project) {
  return project.source === 'claude' || project.source === 'both';
}

function renderSourceBadge(project) {
  return isFromClaude(project) ? '<span class="badge source-claude">Claude Code</span>' : '';
}

/** Línea "Última sesión: … · N sesiones" o "Sin sesiones"; '' sin datos de Claude. */
function renderClaudeActivity(claude, now) {
  if (!claude) return '';
  const count = Number(claude.sessionCount) || 0;
  if (count === 0) return '<p class="claude-activity">Sin sesiones</p>';
  return `<p class="claude-activity">Última sesión: ${escapeHtml(relativeTime(claude.lastActivityAt, now))} · ${count} ${count === 1 ? 'sesión' : 'sesiones'}</p>`;
}

export function renderPinButton(project, id) {
  const pinned = project.pinned === true;
  const label = pinned ? 'Desfijar' : 'Fijar';
  return `<button type="button" class="btn icon" data-action="pin" data-id="${id}" aria-pressed="${pinned}" aria-label="${label}" title="${label}">📌</button>`;
}

export function renderHideButton(project, id) {
  return `<button type="button" class="btn" data-action="hide" data-id="${id}">${project.hidden === true ? 'Mostrar' : 'Ocultar'}</button>`;
}

function cardClasses(project) {
  const classes = ['card', `status-${escapeHtml(project.status)}`];
  if (project.pinned === true) classes.push('pinned');
  if (project.hidden === true) classes.push('is-hidden');
  return classes.join(' ');
}

/** Resumen "de qué va" de la tarjeta: entero (regla "nada recortado") o "Sin descripción". */
function renderCardSummary(project) {
  return typeof project.summary === 'string' && project.summary
    ? `<p class="card-summary">${escapeHtml(project.summary)}</p>`
    : `<p class="card-summary is-empty">${NO_SUMMARY_TEXT}</p>`;
}

/**
 * Tarjeta de un proyecto del listado (R28, R29; fase 3: F3-R41, F3-R42). Feature 13 (§6.3): compacta, con el resumen
 * entero, la cabecera dentro del botón principal (abre el detalle) y las acciones de siempre (Abrir app, Repositorio,
 * fijar, ocultar, Eliminar) dentro del menú "⋯" en lugar del pie de botones grandes.
 */
export function renderProjectCard(project, now = Date.now(), { worktreeCount = 0 } = {}) {
  const id = escapeHtml(project.id);
  const activity = isFromClaude(project) ? renderClaudeActivity(project.claude, now) : '';
  const body = project.exists === false
    ? `${activity}<p class="missing">Ruta no encontrada</p>`
    : `${activity}${renderGitBlock(project.git, now)}${renderSddBlock(project.sdd, project.progress)}`;
  const repoUrl = safeHttpUrl(project.repoUrl);
  const repoLink = repoUrl
    ? `<a class="btn link" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener">Repositorio</a>`
    : '';
  const deleteButton = isManual(project)
    ? `<button type="button" class="btn danger" data-action="delete" data-id="${id}">Eliminar</button>`
    : '';
  const count = Number(worktreeCount) || 0;
  const tasks = count > 0 ? `<span class="row-chips"><span class="chip chip-worktrees">${count} ${count === 1 ? 'tarea en curso' : 'tareas en curso'}</span></span>` : '';

  return `<article class="${cardClasses(project)}" data-id="${id}">
    <button type="button" class="card-main" data-action="detail" data-id="${id}">
      <span class="card-header">
        <span class="card-title">${escapeHtml(project.name)}</span>
        ${renderSourceBadge(project)}
        ${statusBadge(project.status)}
      </span>
    </button>
    ${renderCardSummary(project)}
    ${tasks}
    ${renderTags(project.tags)}
    <div class="card-body">${body}</div>
    <div class="row-menu">
      <button type="button" class="btn icon row-menu-button" data-action="menu" aria-haspopup="true" aria-expanded="false" aria-controls="menu-${id}" aria-label="Más acciones de ${escapeHtml(project.name)}">⋯</button>
      <div class="row-menu-list" id="menu-${id}" role="menu" hidden>
        ${renderOpenApp(project.appUrl)}
        ${repoLink}
        ${renderPinButton(project, id)}
        ${renderHideButton(project, id)}
        ${deleteButton}
      </div>
    </div>
  </article>`;
}

/** Enlace "Mostrar ocultos (N)" / "Ocultar ocultos" (F3-R43); '' si no hay ocultos y no se están mostrando. */
export function renderHiddenToggle(hiddenCount, showing) {
  const count = Number(hiddenCount) || 0;
  if (!showing && count <= 0) return '';
  const text = showing ? 'Ocultar ocultos' : `Mostrar ocultos (${count})`;
  return `<button type="button" class="btn link" data-action="toggle-hidden">${text}</button>`;
}

/** Aviso discreto cuando el servidor no encuentra Claude Code (F3-R44). */
export function renderClaudeNotice(status) {
  if (!status || status.available !== false) return '';
  return '<p class="notice" role="status">Claude Code no detectado en este equipo: solo se muestran los proyectos añadidos a mano.</p>';
}

/** URL del listado (F3-R49). Feature 13: `fullWorktrees` añade worktrees=full (con "Mostrar tareas sueltas"). */
export function buildProjectsUrl(showHidden, { fullWorktrees = false } = {}) {
  const params = [];
  if (showHidden === true) params.push('includeHidden=1');
  if (fullWorktrees === true) params.push('worktrees=full');
  return params.length ? `/api/projects?${params.join('&')}` : '/api/projects';
}

/** Separa los ocultos conservando el orden (F3-R49). */
export function splitHidden(projects, showHidden) {
  const list = Array.isArray(projects) ? projects : [];
  const hiddenCount = list.filter((p) => p && p.hidden === true).length;
  const visible = showHidden === true ? list.slice() : list.filter((p) => !(p && p.hidden === true));
  return { visible, hiddenCount };
}

function renderSession(session, now) {
  const branch = session.gitBranch ? ` · <span class="branch">${escapeHtml(session.gitBranch)}</span>` : '';
  const count = session.messageCount === null || session.messageCount === undefined
    ? '—'
    : `${Number(session.messageCount)} ${Number(session.messageCount) === 1 ? 'mensaje' : 'mensajes'}`;
  return `<li><strong class="session-title">${escapeHtml(session.title)}</strong> <time datetime="${escapeHtml(session.lastActivityAt)}">${escapeHtml(relativeTime(session.lastActivityAt, now))}</time>${branch} · <span class="session-count">${count}</span></li>`;
}

function renderSessionList(sessions, now) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (list.length === 0) return '<p class="muted">Sin sesiones</p>';
  return `<ol class="sessions">${list.map((s) => renderSession(s, now)).join('')}</ol>`;
}

/** Formulario de ajustes del detalle (F3-R46). */
export function renderSettingsForm(project) {
  const p = project || {};
  const id = escapeHtml(p.id);
  const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
  // Feature 13 (R46): el campo se rellena solo con un resumen guardado; el automático sale como placeholder.
  const stored = p.summarySource === 'manual' || p.summarySource === 'claude';
  const storedSummary = stored && typeof p.summary === 'string' ? p.summary : '';
  const summaryPlaceholder = !stored && typeof p.summary === 'string' && p.summary ? p.summary : 'Ej.: CRM para gestionar los clientes de la consultora';
  return `<form id="settings-form" data-id="${id}" class="settings-form" novalidate>
    <div class="field">
      <label for="settings-name">Nombre</label>
      <input id="settings-name" name="name" type="text" required autocomplete="off" value="${escapeHtml(p.name)}">
    </div>
    <div class="field">
      <label for="settings-appUrl">URL de la app</label>
      <input id="settings-appUrl" name="appUrl" type="url" autocomplete="off" placeholder="http://localhost:3000" value="${escapeHtml(p.appUrl)}">
    </div>
    <div class="field">
      <label for="settings-repoUrl">URL del repositorio</label>
      <input id="settings-repoUrl" name="repoUrl" type="url" autocomplete="off" placeholder="https://github.com/usuario/repo" value="${escapeHtml(p.repoUrl)}">
    </div>
    <div class="field">
      <label for="settings-tags">Etiquetas separadas por comas</label>
      <input id="settings-tags" name="tags" type="text" autocomplete="off" placeholder="web, crm" value="${escapeHtml(tags)}">
    </div>
    <div class="field">
      <label for="settings-summary">De qué va (una frase)</label>
      <textarea id="settings-summary" name="summary" rows="2" maxlength="200" autocomplete="off" placeholder="${escapeHtml(summaryPlaceholder)}" data-initial="${escapeHtml(storedSummary)}">${escapeHtml(storedSummary)}</textarea>
    </div>
    <div id="settings-error" class="form-error-slot"></div>
    <div class="form-actions">
      <button type="submit" class="btn primary" id="settings-submit">Guardar ajustes</button>
    </div>
  </form>`;
}

/**
 * Cuerpo del PATCH de ajustes: siempre los cuatro campos, para que vaciar uno lo borre (F3-R47). Feature 13 (R46):
 * `summary` solo si cambió respecto a `summaryInitial` (vaciarlo envía '' y vuelve el resumen automático).
 */
export function buildSettingsPayload(formValues, { summaryInitial } = {}) {
  const v = formValues || {};
  const clean = (value) => (typeof value === 'string' ? value.trim() : '');
  const payload = {
    name: clean(v.name),
    appUrl: clean(v.appUrl),
    repoUrl: clean(v.repoUrl),
    tags: clean(v.tags).split(',').map((t) => t.trim()).filter(Boolean),
  };
  if (typeof v.summary === 'string' && clean(v.summary) !== clean(summaryInitial)) payload.summary = clean(v.summary);
  return payload;
}

/** PATCH /api/projects/:id (F3-R48). */
export async function patchProject(id, changes, { request }) {
  return request('/api/projects/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(changes) });
}

/** Fija o desfija un proyecto (F3-R48). */
export function togglePin(project, deps) {
  return patchProject(project.id, { pinned: !project.pinned }, deps);
}

/** Oculta o muestra un proyecto (F3-R48). */
export function toggleHidden(project, deps) {
  return patchProject(project.id, { hidden: !project.hidden }, deps);
}

function renderFeatureRow(feature) {
  const status = FEATURE_STATUS_LABELS[feature.status] ? feature.status : 'pending';
  return `<li class="feature">
      <span class="feature-id">#${escapeHtml(feature.id)}</span>
      <span class="feature-slug">${escapeHtml(feature.slug)}</span>
      <span class="badge status-${status}">${escapeHtml(FEATURE_STATUS_LABELS[status])}</span>
      <p class="feature-description">${escapeHtml(feature.description)}</p>
    </li>`;
}

/** Bloque "De qué va" del detalle (feature 13, R44). */
function renderAboutSection(detail) {
  const has = typeof detail.summary === 'string' && detail.summary;
  const text = has
    ? `<p class="about-summary">${escapeHtml(detail.summary)}</p>`
    : `<p class="about-summary is-empty">${NO_SUMMARY_TEXT}</p>`;
  const source = has && SUMMARY_SOURCE_LABELS[detail.summarySource] ? `<p class="muted about-source">Origen: ${escapeHtml(SUMMARY_SOURCE_LABELS[detail.summarySource])}</p>` : '';
  return `<section class="detail-section about">
      <h3>De qué va</h3>
      ${text}
      ${source}
      <div class="about-actions">
        <button type="button" class="btn" data-action="generate-summary">Generar con Claude</button>
        <span id="summary-status" class="summary-status" role="status"></span>
      </div>
    </section>`;
}

/** Sección "Tareas en curso" del detalle de un principal (feature 13, R45); '' sin worktrees. */
function renderWorktreesSection(worktrees, now) {
  const list = Array.isArray(worktrees) ? worktrees : [];
  if (!list.length) return '';
  const items = list.map((w) => {
    const id = escapeHtml(w.id);
    const session = w.lastSessionAt ? `Última sesión: ${escapeHtml(relativeTime(w.lastSessionAt, now))}` : 'Sin sesiones';
    const dirty = Number.isInteger(w.dirtyCount)
      ? (w.dirtyCount > 0 ? `<span class="dirty">${w.dirtyCount} ${w.dirtyCount === 1 ? 'fichero' : 'ficheros'} sin commitear</span>` : '<span class="muted">Sin cambios sin commitear</span>')
      : '';
    const hidden = w.hidden === true;
    return `<li class="worktree-item${hidden ? ' is-hidden' : ''}">
        <span class="worktree-name">${escapeHtml(w.name)}${hidden ? ' <span class="muted">(oculta)</span>' : ''}</span>
        ${w.branch ? `<span class="branch">${escapeHtml(w.branch)}</span>` : ''}
        <span class="muted">${session}</span>
        ${dirty}
        <span class="worktree-actions">
          <button type="button" class="btn" data-action="detail" data-id="${id}">Ver detalle</button>
          <button type="button" class="btn" data-action="toggle-worktree" data-id="${id}" data-hidden="${hidden}">${hidden ? 'Mostrar' : 'Ocultar'}</button>
        </span>
      </li>`;
  });
  return `<section class="detail-section worktrees">
      <h3>Tareas en curso</h3>
      <ul class="worktree-list">${items.join('')}</ul>
    </section>`;
}

/** Vista de detalle de un proyecto (R30). Feature 13: "De qué va", enlace al principal y "Tareas en curso". */
export function renderProjectDetail(detail, now = Date.now()) {
  const features = (detail.sdd && detail.sdd.features) || [];
  const featuresHtml = detail.sdd && detail.sdd.present
    ? (features.length ? `<ol class="features">${features.map(renderFeatureRow).join('')}</ol>` : '<p class="muted">Sin features en feature_list.json</p>')
    : '<p class="muted">Sin arnés SDD</p>';
  const progressText = detail.progress && detail.progress.text != null
    ? `<pre class="progress-text">${escapeHtml(detail.progress.text)}</pre>`
    : '<p class="muted">Sin progress/current.md</p>';
  const commits = (detail.git && detail.git.recentCommits) || [];
  const commitsHtml = detail.git && detail.git.isRepo
    ? (commits.length
      ? `<ul class="commits">${commits.map((c) => `<li><time datetime="${escapeHtml(c.date)}">${escapeHtml(relativeDate(c.date, now))}</time> <code>${escapeHtml(String(c.hash).slice(0, 7))}</code> ${escapeHtml(c.message)}</li>`).join('')}</ul>`
      : '<p class="muted">Sin commits todavía</p>')
    : '<p class="muted">Sin repositorio git</p>';
  const dirtyFiles = (detail.git && detail.git.dirtyFiles) || [];
  const dirtyHtml = dirtyFiles.length
    ? `<ul class="dirty-files">${dirtyFiles.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>`
    : '<p class="muted">Sin cambios sin commitear</p>';

  const claudeSection = detail.claude
    ? `<section class="detail-section">
      <h3>Sesiones de Claude Code</h3>
      ${renderSessionList(detail.claude.sessions, now)}
    </section>`
    : '';
  const settingsSection = `<section class="detail-section settings">
      <h3>Ajustes</h3>
      ${renderSettingsForm(detail)}
    </section>`;

  return `<section class="detail status-${escapeHtml(detail.status)}" data-id="${escapeHtml(detail.id)}">
    <header class="detail-header">
      <button type="button" class="btn" data-action="back">Volver</button>
      <h2>${escapeHtml(detail.name)}</h2>
      ${renderSourceBadge(detail)}
      ${statusBadge(detail.status)}
    </header>
    ${renderAboutSection(detail)}
    ${detail.parentId ? `<p class="parent-link"><button type="button" class="btn link" data-action="detail" data-id="${escapeHtml(detail.parentId)}">Tarea de ${escapeHtml(detail.parentName)}</button></p>` : ''}
    <p class="muted detail-id">id: ${escapeHtml(detail.id)}</p>
    ${detail.exists === false ? '<p class="missing">Ruta no encontrada</p>' : ''}
    ${detail.unresolved === true ? '<p class="missing">Ruta no resuelta</p>' : ''}
    ${renderWorktreesSection(detail.worktrees, now)}
    <section class="detail-section">
      <h3>Features</h3>
      ${featuresHtml}
    </section>
    <section class="detail-section">
      <h3>Progreso actual</h3>
      ${progressText}
    </section>
    <section class="detail-section">
      <h3>Últimos commits${detail.git && detail.git.branch ? ` <span class="branch">${escapeHtml(detail.git.branch)}</span>` : ''}</h3>
      ${commitsHtml}
    </section>
    <section class="detail-section">
      <h3>Cambios sin commitear</h3>
      ${dirtyHtml}
    </section>
    ${claudeSection}
    ${settingsSection}
  </section>`;
}

/** Error del formulario de alta (R32). */
export function renderFormError(payload) {
  const message = payload && typeof payload.error === 'string' && payload.error ? payload.error : 'No se pudo añadir el proyecto';
  const field = payload && typeof payload.field === 'string' ? ` data-field="${escapeHtml(payload.field)}"` : '';
  return `<p class="form-error" role="alert"${field}>${escapeHtml(message)}</p>`;
}

/** Error de carga del listado (R34). */
export function renderLoadError() {
  return `<div class="load-error" role="alert">
    <p>No se pudo cargar el estado de los proyectos</p>
    <button type="button" class="btn primary" data-action="retry">Reintentar</button>
  </div>`;
}

/** Construye el cuerpo del POST de alta a partir de los valores del formulario (R31). */
export function buildProjectPayload(formValues) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const payload = {};
  const name = clean(formValues.name);
  const projectPath = clean(formValues.path);
  const appUrl = clean(formValues.appUrl);
  const repoUrl = clean(formValues.repoUrl);
  const tags = clean(formValues.tags).split(',').map((t) => t.trim()).filter(Boolean);
  if (name) payload.name = name;
  if (projectPath) payload.path = projectPath;
  if (appUrl) payload.appUrl = appUrl;
  if (repoUrl) payload.repoUrl = repoUrl;
  if (tags.length) payload.tags = tags;
  return payload;
}

/** Baja de un proyecto con confirmación (R33). Devuelve true si se ejecutó la petición. */
export async function handleDelete(id, { confirm, request }) {
  if (!confirm('¿Eliminar el proyecto del panel? No se borra nada del disco.')) return false;
  await request('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' });
  return true;
}

// ---------- Fase 2: autenticación (F2-R37, F2-R38, F2-R41, F2-R42) ----------

const AUTH_MIN_LENGTH = 10;
const AUTH_MAX_LENGTH = 128;

/** Qué vista toca según GET /api/auth/status: 'setup' | 'login' | 'panel'. */
export function resolveAuthView(status) {
  const s = status || {};
  if (!s.configured) return 'setup';
  if (!s.authenticated) return 'login';
  return 'panel';
}

/** Formulario de creación de contraseña (setup) o de login. */
export function renderAuthForm(mode) {
  const isSetup = mode === 'setup';
  const title = isSetup ? 'Crear contraseña' : 'Iniciar sesión';
  const intro = isSetup
    ? '<p class="muted">Es la contraseña única del panel: la pedirá cada vez que entres desde el móvil o el PC. Guárdala en un lugar seguro.</p>'
    : '<p class="muted">Introduce la contraseña del panel para ver tus proyectos.</p>';
  const confirm = isSetup
    ? `<div class="field">
        <label for="auth-confirm">Repite la contraseña</label>
        <input id="auth-confirm" type="password" name="confirm" autocomplete="new-password" minlength="${AUTH_MIN_LENGTH}" maxlength="${AUTH_MAX_LENGTH}" required>
      </div>`
    : '';
  return `<form id="auth-form" data-mode="${isSetup ? 'setup' : 'login'}" novalidate>
    <h2>${title}</h2>
    ${intro}
    <div class="field">
      <label for="auth-password">Contraseña${isSetup ? ` (de ${AUTH_MIN_LENGTH} a ${AUTH_MAX_LENGTH} caracteres)` : ''}</label>
      <input id="auth-password" type="password" name="password" autocomplete="${isSetup ? 'new-password' : 'current-password'}" minlength="${AUTH_MIN_LENGTH}" maxlength="${AUTH_MAX_LENGTH}" required autofocus>
    </div>
    ${confirm}
    <div id="auth-error" class="form-error-slot"></div>
    <div class="form-actions">
      <button type="submit" class="btn primary" id="auth-submit">${isSetup ? 'Crear contraseña' : 'Entrar'}</button>
    </div>
  </form>`;
}

/** Error de autenticación con role="alert" (mismos estilos que renderFormError). */
export function renderAuthError(message) {
  return `<p class="form-error" role="alert">${escapeHtml(message)}</p>`;
}

/** Validación local antes de enviar una contraseña nueva (setup y cambio). */
export function validateNewPassword(password, confirm) {
  const value = typeof password === 'string' ? password : '';
  const length = [...value].length;
  if (length < AUTH_MIN_LENGTH) return { ok: false, error: 'La contraseña debe tener al menos 10 caracteres' };
  if (length > AUTH_MAX_LENGTH) return { ok: false, error: 'La contraseña debe tener entre 10 y 128 caracteres' };
  if (value !== confirm) return { ok: false, error: 'Las contraseñas no coinciden' };
  return { ok: true };
}

/** Formulario de cambio de contraseña. */
export function renderChangePasswordForm() {
  return `<form id="change-password-form" novalidate>
    <h2>Cambiar contraseña</h2>
    <p class="muted">Al cambiarla se cierran las demás sesiones abiertas (la de este navegador se mantiene).</p>
    <div class="field">
      <label for="change-current">Contraseña actual</label>
      <input id="change-current" type="password" name="currentPassword" autocomplete="current-password" required>
    </div>
    <div class="field">
      <label for="change-new">Nueva contraseña (de ${AUTH_MIN_LENGTH} a ${AUTH_MAX_LENGTH} caracteres)</label>
      <input id="change-new" type="password" name="newPassword" autocomplete="new-password" minlength="${AUTH_MIN_LENGTH}" maxlength="${AUTH_MAX_LENGTH}" required>
    </div>
    <div class="field">
      <label for="change-confirm">Repite la nueva contraseña</label>
      <input id="change-confirm" type="password" name="confirm" autocomplete="new-password" minlength="${AUTH_MIN_LENGTH}" maxlength="${AUTH_MAX_LENGTH}" required>
    </div>
    <div id="change-password-error" class="form-error-slot"></div>
    <div class="form-actions">
      <button type="button" class="btn" data-action="cancel-change">Cancelar</button>
      <button type="submit" class="btn primary" id="change-password-submit">Guardar contraseña</button>
    </div>
  </form>`;
}

/** Cuerpo de POST /api/auth/change-password (omite confirm). */
export function buildChangePasswordPayload(formValues) {
  const v = formValues || {};
  return {
    currentPassword: typeof v.currentPassword === 'string' ? v.currentPassword : '',
    newPassword: typeof v.newPassword === 'string' ? v.newPassword : '',
  };
}

/** Cierra la sesión en el servidor. Devuelve true cuando la petición se ha enviado. */
export async function handleLogout({ request }) {
  await request('/api/auth/logout', { method: 'POST' });
  return true;
}

/** Enlace a la URL pública del túnel para el encabezado; '' si no hay URL. */
export function renderPublicUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  const safe = escapeHtml(url);
  return `<a class="public-url" href="${safe}" target="_blank" rel="noopener">URL pública: ${safe}</a>`;
}
