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

function renderOpenApp(appUrl) {
  if (appUrl) {
    return `<a class="btn primary" href="${escapeHtml(appUrl)}" target="_blank" rel="noopener">Abrir app</a>`;
  }
  return '<a class="btn primary" aria-disabled="true" title="Sin URL de la app configurada">Abrir app</a>';
}

/** Tarjeta de un proyecto del listado (R28, R29). */
export function renderProjectCard(project, now = Date.now()) {
  const id = escapeHtml(project.id);
  const body = project.exists === false
    ? '<p class="missing">Ruta no encontrada</p>'
    : `${renderGitBlock(project.git, now)}${renderSddBlock(project.sdd, project.progress)}`;
  const repoLink = project.repoUrl
    ? `<a class="btn link" href="${escapeHtml(project.repoUrl)}" target="_blank" rel="noopener">Repositorio</a>`
    : '';

  return `<article class="card status-${escapeHtml(project.status)}" data-id="${id}">
    <header class="card-header">
      <h2>${escapeHtml(project.name)}</h2>
      ${statusBadge(project.status)}
    </header>
    ${renderTags(project.tags)}
    <div class="card-body">${body}</div>
    <footer class="card-actions">
      ${renderOpenApp(project.appUrl)}
      <button type="button" class="btn" data-action="detail" data-id="${id}">Detalle</button>
      ${repoLink}
      <button type="button" class="btn danger" data-action="delete" data-id="${id}">Eliminar</button>
    </footer>
  </article>`;
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

/** Vista de detalle de un proyecto (R30). */
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

  return `<section class="detail status-${escapeHtml(detail.status)}" data-id="${escapeHtml(detail.id)}">
    <header class="detail-header">
      <button type="button" class="btn" data-action="back">Volver</button>
      <h2>${escapeHtml(detail.name)}</h2>
      ${statusBadge(detail.status)}
    </header>
    ${detail.exists === false ? '<p class="missing">Ruta no encontrada</p>' : ''}
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
