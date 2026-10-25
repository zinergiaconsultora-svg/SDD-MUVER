// Funciones PURAS de la vista "Trabajar" (fase 4, design.md §6.2–§6.4): reciben datos y devuelven cadenas HTML o
// cuerpos de petición. Sin DOM: se prueban en Node. El cableado con el navegador vive en app.js.
import { escapeHtml, relativeTime } from './render.js';

export const STATE_LABELS = Object.freeze({
  queued: 'En cola',
  running: 'En marcha',
  succeeded: 'Terminada',
  failed: 'Fallida',
  cancelled: 'Cancelada',
  timeout: 'Tiempo agotado',
  needs_permission: 'Necesita permiso',
});

export const ACTIVE_STATES = Object.freeze(['queued', 'running']);

/** Feature 13 (§6.7): etiquetas del modelo (mismo texto que MODEL_LABELS de lib/claude-cli.js). */
export const MODEL_LABELS = Object.freeze({ default: 'Por defecto', haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' });
export const MAX_LOG_EVENTS = 2000;
const PROMPT_PREVIEW_IN_DIALOG = 300;
const DEFAULT_COMMANDS = ['git status', 'git diff', 'git log'];

const READ_ONLY_NOTICES = Object.freeze({
  disabled: '<p class="notice">Las acciones de ejecución están desactivadas en este panel (PANEL_ALLOW_EXEC=0).</p>',
  noDir: '<p class="notice">Este proyecto no tiene una carpeta accesible en este PC: no se puede trabajar en él desde el panel.</p>',
});

function stateBadge(state) {
  const safe = STATE_LABELS[state] ? state : 'failed';
  return `<span class="badge state-${safe}">${escapeHtml(STATE_LABELS[safe])}</span>`;
}

/** "1,5 s" o "1 min 5 s". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} s`;
}

/** "0,0123 US$" (entre 2 y 4 decimales). */
export function formatCost(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return '';
  return `${usd.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} US$`;
}

/** "a", "a y b", "a, b y c". */
function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
}

function commandsText(allowedCommands) {
  const extra = Array.isArray(allowedCommands) ? allowedCommands.filter((c) => typeof c === 'string' && c) : [];
  return joinList([...DEFAULT_COMMANDS, ...extra]);
}

// ---------- Vista "Trabajar" (R80, R81) ----------

/** Selector de sesión: nueva, continuar la última y las sesiones recientes del proyecto. */
export function renderSessionSelect(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const options = [
    '<option value="new" selected>Nueva conversación</option>',
    '<option value="continue">Continuar la última sesión</option>',
    ...list.map((s) => `<option value="resume:${escapeHtml(s.id)}">Retomar «${escapeHtml(s.title || s.id)}»</option>`),
  ];
  return `<select id="work-session" name="session">${options.join('')}</select>`;
}

/** Feature 13 (R59): selector "Modelo" con las opciones de GET …/work y el recordado seleccionado. */
export function renderModelSelect(models, selected) {
  const list = Array.isArray(models) ? models : [];
  const options = list.map((m) => `<option value="${escapeHtml(m.value)}"${m.value === selected ? ' selected' : ''}>${escapeHtml(m.label)}</option>`);
  return `<label for="work-model">Modelo</label><select id="work-model" name="model">${options.join('')}</select>`;
}

function renderPromptForm(work) {
  const model = Array.isArray(work.models) && work.models.length
    ? `<div class="field">
        ${renderModelSelect(work.models, work.model || 'default')}
      </div>`
    : '';
  return `<form id="prompt-form" class="prompt-form" novalidate>
      <div class="field">
        <label for="work-prompt">Mensaje para Claude Code</label>
        <textarea id="work-prompt" name="prompt" rows="4" maxlength="20000" required placeholder="¿Qué quieres que haga Claude en este proyecto?"></textarea>
      </div>
      <div class="field">
        <label for="work-session">Sesión</label>
        ${renderSessionSelect(work.sessions)}
      </div>
      ${model}
      <div class="form-actions">
        <button type="submit" class="btn primary" data-action="send-prompt">Enviar</button>
      </div>
    </form>`;
}

function renderActions(work, canExec) {
  const buttons = [];
  if (canExec && work.hasSdd) {
    buttons.push('<button type="button" class="btn primary" data-action="implement">Implementar siguiente tarea</button>');
    buttons.push('<button type="button" class="btn" data-action="approve-tests">Aprobar tests</button>');
  }
  if (canExec && work.hasSdd) {
    for (const f of Array.isArray(work.specReady) ? work.specReady : []) {
      buttons.push(`<button type="button" class="btn" data-action="approve-spec" data-feature-id="${escapeHtml(f.id)}" data-feature-slug="${escapeHtml(f.slug)}">Aprobar spec #${escapeHtml(f.id)} ${escapeHtml(f.slug)}</button>`);
    }
  }
  if (canExec && work.effectiveTestCommand) buttons.push('<button type="button" class="btn" data-action="run-tests">Ejecutar tests</button>');
  if (work.isRepo) buttons.push('<button type="button" class="btn" data-action="show-changes">Ver cambios</button>');
  if (canExec && work.isRepo) buttons.push('<button type="button" class="btn" data-action="commit-push">Commit y push</button>');
  const testsHint = canExec && !work.effectiveTestCommand && work.testCommandError
    ? `<p class="muted tests-hint">${escapeHtml(work.testCommandError)}</p>`
    : '';
  if (!buttons.length) return testsHint;
  return `<div class="work-actions">${buttons.join('')}</div>${testsHint}`;
}

/** Formulario "Ajustes de ejecución": comandos autorizados (uno por línea) y comando de tests. */
export function renderExecSettingsForm(work) {
  const commands = Array.isArray(work.allowedCommands) ? work.allowedCommands.join('\n') : '';
  return `<form id="exec-settings-form" class="exec-settings" novalidate>
      <div class="field">
        <label for="exec-allowed">Comandos que Claude puede ejecutar (uno por línea; además de git status, git diff y git log)</label>
        <textarea id="exec-allowed" name="allowedCommands" rows="4" autocomplete="off" placeholder="npm test" aria-describedby="exec-allowed-help">${escapeHtml(commands)}</textarea>
        <p id="exec-allowed-help" class="muted field-help">Comandos que Claude podrá ejecutar por su cuenta (uno por línea). No es el comando de tests.</p>
      </div>
      <div class="field">
        <label for="exec-test">Comando de tests (vacío = bash init.sh si existe)</label>
        <input id="exec-test" name="testCommand" type="text" autocomplete="off" placeholder="npm test" aria-describedby="exec-test-help" value="${escapeHtml(work.testCommand || '')}">
        <p id="exec-test-help" class="muted field-help">Lo que ejecuta el botón Ejecutar tests, p. ej. npm test</p>
      </div>
      <div id="exec-settings-error" class="form-error-slot"></div>
      <div class="form-actions">
        <button type="submit" class="btn">Guardar ajustes de ejecución</button>
      </div>
    </form>`;
}

/** Vista "Trabajar" de un proyecto. */
export function renderWorkView(work, { runs = [], now = Date.now() } = {}) {
  const w = work || {};
  const canExec = w.execEnabled === true && w.executable === true;
  let notice = '';
  if (w.execEnabled !== true) notice = READ_ONLY_NOTICES.disabled;
  else if (w.executable !== true) notice = READ_ONLY_NOTICES.noDir;
  return `<div class="work" data-id="${escapeHtml(w.projectId)}">
    ${notice}
    ${canExec ? renderPromptForm(w) : ''}
    ${renderActions(w, canExec)}
    <section class="run-panel" aria-labelledby="run-panel-title">
      <div class="run-panel-header">
        <h3 id="run-panel-title">Ejecución</h3>
        <span id="run-state" class="run-state"></span>
        <span id="run-model" class="run-model-slot"></span>
        <button type="button" class="btn danger" data-action="cancel-run" hidden>Cancelar</button>
      </div>
      <div id="run-permission" class="run-permission"></div>
      <div id="run-log" class="run-log" aria-live="polite"></div>
    </section>
    <section id="changes-panel" class="changes-panel" hidden></section>
    <section class="detail-section">
      <h3>Historial</h3>
      <div id="run-history">${renderRunList(runs, now)}</div>
    </section>
    ${canExec ? `<section class="detail-section"><h3>Ajustes de ejecución</h3>${renderExecSettingsForm(w)}</section>` : ''}
  </div>`;
}

// ---------- Confirmación (R82) ----------

function sessionText(session) {
  const mode = session && session.mode;
  if (mode === 'continue') return 'Continuar la última sesión';
  if (mode === 'resume') return `Retomar «${escapeHtml(session.title || session.id || '')}»`;
  return 'Nueva conversación';
}

function promptPreview(prompt) {
  const chars = [...String(prompt ?? '')];
  return chars.length > PROMPT_PREVIEW_IN_DIALOG ? chars.slice(0, PROMPT_PREVIEW_IN_DIALOG).join('') + '…' : chars.join('');
}

/** Feature 13 (R59): frase del modelo para el diálogo ('' sin ctx.model: texto de la fase 4). */
function modelText(model) {
  if (model === undefined || model === null) return '';
  if (model === 'default') return ' Modelo: el configurado en Claude Code.';
  return MODEL_LABELS[model] ? ` Modelo: ${MODEL_LABELS[model]}.` : '';
}

/** Texto (HTML ya escapado) del diálogo de confirmación de cada acción (design.md §6.3). */
export function describeAction(action, ctx = {}) {
  const name = escapeHtml(ctx.projectName);
  const tools = escapeHtml(commandsText(ctx.allowedCommands));
  const model = modelText(ctx.model);
  switch (action) {
    case 'chat':
      return `Se lanzará Claude Code en ${name} con el mensaje: «${escapeHtml(promptPreview(ctx.prompt))}». Sesión: ${sessionText(ctx.session)}. Claude puede editar ficheros y ejecutar solo: ${tools}.${model}`;
    case 'implement':
      return `Se lanzará Claude Code en ${name} con «implementa la siguiente tarea pendiente» (nueva conversación). Claude puede editar ficheros y ejecutar solo: ${tools}.${model}`;
    case 'approve-tests':
      return `Se lanzará Claude Code en ${name} con «tests aprobados, lanza al reviewer» continuando la última sesión. Claude puede editar ficheros y ejecutar solo: ${tools}.${model}`;
    case 'approve-spec':
      return `Se cambiará la feature #${escapeHtml(ctx.featureId)} ${escapeHtml(ctx.featureSlug)} de spec_ready a in_progress en feature_list.json de ${name}. Después podrás lanzar «Implementar siguiente tarea».`;
    case 'tests':
      return `Se ejecutará en ${name}: ${escapeHtml(ctx.effectiveTestCommand)}`;
    case 'commit-push':
      return `Se ejecutará en ${name}: git add -A → git commit -m «${escapeHtml(ctx.message)}» → git push (rama ${escapeHtml(ctx.branch)}). Nunca se fuerza el push.`;
    case 'allow-command':
      return `Se autorizará «${escapeHtml(ctx.command)}» en ${name} para Claude y se reintentará la ejecución.`;
    case 'exec-settings':
      return `Se guardarán los comandos autorizados (${Number(ctx.count) || 0}) y el comando de tests de ${name}.`;
    case 'allow-broad':
      return BROAD_TEXTS.broadConfirm(ctx.broadCommands, ctx.projectName);
    default:
      return '';
  }
}

// ---------- Feature 14: avisos de comandos amplios y de hooks (design.md §6) ----------

/** «a», «b» con cada comando escapado. */
function quotedList(cmds) {
  return (Array.isArray(cmds) ? cmds : []).map((c) => `«${escapeHtml(c)}»`).join(', ');
}

export const BROAD_TEXTS = Object.freeze({
  broadConfirm: (cmds, name) => `Esto permite a Claude ejecutar cualquier programa en este proyecto: ${quotedList(cmds)}. Equivale a darle una terminal libre en ${escapeHtml(name)}. ¿Quieres autorizarlo de todos modos?`,
  broadSaved: (cmds) => `Atención: ${quotedList(cmds)} permite${Array.isArray(cmds) && cmds.length > 1 ? 'n' : ''} a Claude ejecutar cualquier programa en este proyecto.`,
});

/** Aviso de "Ajustes de ejecución" mientras haya comandos amplios guardados ('' si no hay). */
export function renderBroadWarning(cmds) {
  if (!Array.isArray(cmds) || cmds.length === 0) return '';
  return `<p class="warning" role="status">${BROAD_TEXTS.broadSaved(cmds)}</p>`;
}

/** Aviso del diálogo de "Commit y push" si el repo tiene hooks activos ('' si no hay). */
export function renderHooksWarning({ hooks, hooksPathCustom } = {}) {
  if (!Array.isArray(hooks) || hooks.length === 0) return '';
  const names = hooks.map((h) => escapeHtml(h)).join(', ');
  const custom = hooksPathCustom ? ' La carpeta de hooks está configurada con core.hooksPath.' : '';
  return `<p class="warning" role="status">Atención: este repositorio tiene hooks de git activos (${names}) que se ejecutarán al hacer commit y push y pueden ejecutar cualquier programa. Revísalos si no los has creado tú.${custom}</p>`;
}

/**
 * Corrección revisión F14 (M3): aviso del diálogo de "Commit y push" si la configuración del repo ejecutará programas
 * (además de los hooks). '' si no hay nada.
 */
export function renderRepoConfigWarning(risks) {
  const r = risks && typeof risks === 'object' ? risks : {};
  const items = [];
  if (r.gpgSign) items.push('firma de commits (commit.gpgsign ejecuta gpg.program)');
  if (r.sshCommand) items.push('core.sshCommand propio del repositorio');
  if (r.askPass) items.push('core.askPass');
  if (r.credentialHelper) items.push('credential.helper del repositorio');
  if (r.receivePack) items.push('remote.*.receivepack/uploadpack');
  if (Array.isArray(r.filters) && r.filters.length) items.push(`filtros de .gitattributes (${r.filters.map((f) => escapeHtml(f)).join(', ')})`);
  if (!items.length) return '';
  return `<p class="warning" role="status">Atención: la configuración de este repositorio ejecutará programas al hacer commit y push: ${items.join('; ')}. Revísala si no la has configurado tú.</p>`;
}

/** Cuerpo del diálogo de confirmación (el texto ya viene escapado por describeAction). */
export function renderConfirmDialogBody(text) {
  return `<p class="confirm-text">${text}</p>`;
}

// ---------- Eventos y salida en vivo (R83) ----------

/**
 * HTML de un evento del run según su tipo; todo el texto escapado. `lastText` = último texto del asistente: el
 * result no lo repite si es idéntico (corrección T36: el CLI real repite el texto final en el result).
 */
export function renderRunEvent(event, { lastText = null } = {}) {
  if (!event || typeof event !== 'object') return '';
  const e = event;
  switch (e.type) {
    case 'prompt':
      return `<div class="ev ev-prompt"><span class="ev-label">Mensaje:</span> ${escapeHtml(e.text)}</div>`;
    case 'state':
      return `<div class="ev ev-state">${stateBadge(e.state)}</div>`;
    case 'session':
      return `<div class="ev ev-notice">Sesión de Claude: ${escapeHtml(e.sessionId)}${e.model ? ` (${escapeHtml(e.model)})` : ''}</div>`;
    case 'text':
      return `<div class="ev ev-text">${escapeHtml(e.text)}</div>`;
    case 'tool':
      return `<div class="ev ev-tool"><span class="tool-name">${escapeHtml(e.name)}</span>${e.summary ? ` <code>${escapeHtml(e.summary)}</code>` : ''}</div>`;
    case 'tool_error':
      return `<div class="ev ev-error">Error de herramienta: ${escapeHtml(e.preview)}</div>`;
    case 'permission_denied':
      return `<div class="ev ev-error">Permiso denegado: ${escapeHtml(e.tool)}${e.detail ? `: ${escapeHtml(e.detail)}` : ''}</div>`;
    case 'step':
      return `<div class="ev ev-step">Paso ${Number(e.index) || 0}/${Number(e.total) || 0}: <code>${escapeHtml(e.command)}</code></div>`;
    case 'output':
      return `<div class="ev ev-output${e.stream === 'stderr' ? ' stderr' : ''}">${escapeHtml(e.text)}</div>`;
    case 'notice':
      return `<div class="ev ev-notice">${escapeHtml(e.message)}</div>`;
    case 'result': {
      const parts = [e.ok ? 'Resultado: correcto' : 'Resultado: con error'];
      if (Number.isFinite(e.costUsd)) parts.push(`coste ${formatCost(e.costUsd)}`);
      if (Number.isFinite(e.durationMs)) parts.push(formatDuration(e.durationMs));
      if (Number.isFinite(e.numTurns)) parts.push(`${e.numTurns} ${e.numTurns === 1 ? 'turno' : 'turnos'}`);
      const showText = e.text && e.text !== lastText;
      return `<div class="ev ev-result${e.ok ? '' : ' is-error'}"><strong>${escapeHtml(parts.join(' · '))}</strong>${showText ? `<div class="ev-result-text">${escapeHtml(e.text)}</div>` : ''}</div>`;
    }
    case 'error':
      return `<div class="ev ev-error">${escapeHtml(e.message)}</div>`;
    case 'end': {
      const duration = formatDuration(e.durationMs);
      return `<div class="ev ev-end">Fin: ${stateBadge(e.state)}${duration ? ` · ${escapeHtml(duration)}` : ''}</div>`;
    }
    default:
      return '';
  }
}

/** Registro completo: como mucho los últimos 2000 eventos (con aviso si hay más). */
export function renderRunLog(events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return '';
  const shown = list.slice(-MAX_LOG_EVENTS);
  const notice = list.length > MAX_LOG_EVENTS ? `<div class="ev ev-notice">Se muestran los últimos ${MAX_LOG_EVENTS} eventos.</div>` : '';
  let lastText = null;
  for (const e of list.slice(0, list.length - shown.length)) if (e && e.type === 'text') lastText = e.text;
  const html = shown.map((e) => {
    const out = renderRunEvent(e, { lastText });
    if (e && e.type === 'text') lastText = e.text;
    return out;
  });
  return notice + html.join('');
}

// ---------- Historial (R88) ----------

/** Feature 13 (R60): nombre del modelo de un run; null = por defecto; sin campo (run antiguo) = ''. */
export function modelLabel(model) {
  if (model === undefined) return '';
  if (model === null) return 'Modelo por defecto';
  return MODEL_LABELS[model] && model !== 'default' ? MODEL_LABELS[model] : 'Modelo por defecto';
}

/** Etiqueta del modelo en la cabecera de la ejecución y en el historial ('' para runs anteriores a la feature 13). */
export function renderRunHeader(meta) {
  if (!meta || typeof meta !== 'object' || !('model' in meta)) return '';
  return `<span class="run-model">${escapeHtml(modelLabel(meta.model))}</span>`;
}

/** Historial de runs con etiqueta, estado, fecha relativa, duración, coste y botón para reabrir. */
export function renderRunList(runs, now = Date.now()) {
  const list = Array.isArray(runs) ? runs : [];
  if (!list.length) return '<p class="muted">Sin ejecuciones todavía</p>';
  const items = list.map((run) => {
    const extra = [formatDuration(run.durationMs), formatCost(run.costUsd)].filter(Boolean).map(escapeHtml);
    return `<li class="run-item">
        <span class="run-label">${escapeHtml(run.label)}</span>
        ${renderRunHeader(run)}
        ${stateBadge(run.state)}
        <time datetime="${escapeHtml(run.startedAt)}">${escapeHtml(relativeTime(run.startedAt, now))}</time>
        ${extra.length ? `<span class="run-meta">${extra.join(' · ')}</span>` : ''}
        <button type="button" class="btn" data-action="open-run" data-run-id="${escapeHtml(run.runId)}">Ver</button>
      </li>`;
  });
  return `<ul class="run-list">${items.join('')}</ul>`;
}

// ---------- Permisos (R84) ----------

function allowButtons(denial) {
  const suggestions = Array.isArray(denial.suggestions) ? denial.suggestions : (denial.suggestion ? [denial.suggestion] : []);
  return suggestions
    .map((c) => {
      // Texto de R84; con varios comandos propuestos se nombra cada uno para distinguir los botones.
      const label = suggestions.length > 1 ? `Permitir «${escapeHtml(c)}» en este proyecto y reintentar` : 'Permitir en este proyecto y reintentar';
      return ` <button type="button" class="btn primary" data-action="allow-command" data-command="${escapeHtml(c)}">${label}</button>`;
    })
    .join('');
}

function denialText(prefix, d) {
  return `${prefix}${escapeHtml(d.tool)}${d.detail ? `: ${escapeHtml(d.detail)}` : ''}`;
}

/**
 * Aviso de permisos (R84). needs_permission: "Claude necesita permiso para: …". Corrección T36: un run terminado
 * (succeeded) con denegaciones muestra "N comandos denegados durante la ejecución". En ambos, un botón
 * "Permitir … y reintentar" por cada comando propuesto.
 */
export function renderPermissionPrompt(run) {
  const denials = run && Array.isArray(run.permissionDenials) ? run.permissionDenials : [];
  if (!run || !denials.length || !['needs_permission', 'succeeded'].includes(run.state)) return '';
  const blocked = run.state === 'needs_permission';
  const items = denials.map((d) => `<li><p>${denialText(blocked ? 'Claude necesita permiso para: ' : 'Comando denegado: ', d)}</p>${allowButtons(d)}</li>`);
  const header = blocked ? '' : `<p><strong>${denials.length} ${denials.length === 1 ? 'comando denegado' : 'comandos denegados'} durante la ejecución</strong></p>`;
  return `<div class="permission-prompt${blocked ? '' : ' is-info'}" role="${blocked ? 'alert' : 'status'}">${header}<ul>${items.join('')}</ul></div>`;
}

/** Cuerpo del reintento: mismo prompt reanudando la sesión de Claude del run (o la última si no hay id). */
export function buildRetryPayload(run, originalPrompt) {
  const id = run && run.claudeSessionId;
  return { prompt: originalPrompt, session: id ? { mode: 'resume', id } : { mode: 'continue' } };
}

// ---------- Cambios y diff (R85) ----------

export function renderChanges(changes) {
  const c = changes || {};
  const files = Array.isArray(c.files) ? c.files : [];
  const header = `<h3>Cambios${c.branch ? ` <span class="branch">${escapeHtml(c.branch)}</span>` : ''}</h3>`;
  if (!files.length) return `${header}<p class="muted">Sin cambios</p>`;
  const items = files.map((f) => `<li><code class="file-status">${escapeHtml(f.status)}</code> <button type="button" class="btn link" data-action="show-diff" data-file="${escapeHtml(f.path)}">${escapeHtml(f.path)}</button></li>`);
  return `${header}
    ${c.truncated ? '<p class="notice">Hay más de 500 ficheros cambiados: se muestran los 500 primeros.</p>' : ''}
    <ul class="changes-list">${items.join('')}</ul>
    ${c.stat ? `<pre class="diff-stat">${escapeHtml(c.stat)}</pre>` : ''}
    <div id="diff-view"></div>`;
}

function diffLineClass(line) {
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++ ') || line.startsWith('--- ')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return '';
}

/** Diff coloreado por líneas (add, del, hunk, meta), escapado. */
export function renderDiff({ diff, truncated, untracked } = {}) {
  if (untracked) return '<p class="muted">Fichero nuevo sin seguimiento: no hay diff que mostrar.</p>';
  const lines = String(diff ?? '').split('\n').map((line) => {
    const cls = diffLineClass(line);
    return cls ? `<span class="${cls}">${escapeHtml(line)}</span>` : `<span>${escapeHtml(line)}</span>`;
  });
  return `<pre class="diff">${lines.join('\n')}</pre>${truncated ? '<p class="notice">Diff recortado a 200 KB</p>' : ''}`;
}

// ---------- "Te necesitan" (R87) ----------

export function renderAttention(attention, now = Date.now()) {
  const a = attention || {};
  const projects = Array.isArray(a.projects) ? a.projects : [];
  const runs = Array.isArray(a.runs) ? a.runs : [];
  if (!projects.length && !runs.length) return '';
  const projectItems = projects.map((p) => {
    const reasons = [];
    if (Array.isArray(p.features) && p.features.length) {
      reasons.push(`Spec lista para aprobar: ${p.features.map((f) => `#${escapeHtml(f.id)} ${escapeHtml(f.slug)}`).join(', ')}`);
    }
    if (p.blockReason) reasons.push(`Bloqueo: ${escapeHtml(p.blockReason)}`);
    // Feature 13 (R62): las tareas en curso (worktrees) del principal con una alerta distinta, en una sola línea.
    const tasks = Number(p.tasksAwaiting) || 0;
    if (tasks > 0) reasons.push(tasks === 1 ? '1 tarea en curso espera tu aprobación' : `${tasks} tareas en curso esperan tu aprobación`);
    return `<li class="attention-item">
        <strong>${escapeHtml(p.name)}</strong>
        <p>${reasons.join(' · ')}</p>
        <button type="button" class="btn primary" data-action="open-work" data-id="${escapeHtml(p.id)}">Trabajar</button>
      </li>`;
  });
  const runItems = runs.map((r) => {
    const count = Array.isArray(r.permissionDenials) ? r.permissionDenials.length : 0;
    const info = r.informative ? ` <span class="muted">${count} ${count === 1 ? 'comando denegado' : 'comandos denegados'}</span>` : '';
    return `<li class="attention-item${r.informative ? ' attention-info' : ''}">
        <strong>${escapeHtml(r.projectName)}</strong> · ${escapeHtml(r.label)} ${stateBadge(r.state)}${info}
        <time datetime="${escapeHtml(r.endedAt)}">${escapeHtml(relativeTime(r.endedAt, now))}</time>
        <div class="attention-actions">
          <button type="button" class="btn" data-action="open-run" data-run-id="${escapeHtml(r.runId)}" data-id="${escapeHtml(r.projectId)}">Ver ejecución</button>
          <button type="button" class="btn" data-action="dismiss-run" data-run-id="${escapeHtml(r.runId)}">Descartar</button>
        </div>
      </li>`;
  });
  return `<h2>Te necesitan</h2><ul class="attention-list">${[...projectItems, ...runItems].join('')}</ul>`;
}

// ---------- Cuerpos de petición ----------

/** Mensaje de commit propuesto (R89). */
export function suggestCommitMessage(work) {
  const slug = work && work.inProgress && work.inProgress.slug;
  return slug ? `Avance de ${slug} desde el Puesto de Mando` : 'Cambios desde el Puesto de Mando';
}

/** Cuerpo de POST /runs a partir del formulario (prompt + valor del selector de sesión). */
export function buildRunPayload(formValues) {
  const v = formValues || {};
  const value = typeof v.session === 'string' ? v.session : 'new';
  let session = { mode: 'new' };
  if (value === 'continue') session = { mode: 'continue' };
  else if (value.startsWith('resume:')) session = { mode: 'resume', id: value.slice('resume:'.length) };
  const payload = { prompt: typeof v.prompt === 'string' ? v.prompt : '', session };
  // Feature 13 (R59): el modelo elegido; sin él, el cuerpo de la fase 4.
  if (typeof v.model === 'string' && v.model) payload.model = v.model;
  return payload;
}

/** Cuerpo de "Implementar siguiente tarea" / "Aprobar tests" con los campos presentes (feature 13). */
export function buildSddPayload({ session, model } = {}) {
  const payload = {};
  if (session) payload.session = session;
  if (typeof model === 'string' && model) payload.model = model;
  return payload;
}

/** Cuerpo del PATCH de ajustes de ejecución (comandos uno por línea). */
export function buildExecSettingsPayload(formValues) {
  const v = formValues || {};
  const allowedCommands = String(v.allowedCommands ?? '').split(/\r?\n/).map((c) => c.trim()).filter(Boolean);
  return { allowedCommands, testCommand: typeof v.testCommand === 'string' ? v.testCommand.trim() : '' };
}

// ---------- Reconfirmación de contraseña (R86) ----------

/** true si el error es el 401 que pide confirmar la contraseña. */
export function isReauthError(err) {
  return Boolean(err && err.status === 401 && err.payload && err.payload.reauthRequired === true);
}

/**
 * Ejecuta `action`; si responde que hay que confirmar la contraseña, la pide (askPassword(mensajeDeError|null) →
 * contraseña o null si se cancela), llama a reauth(contraseña) y repite la acción UNA vez. Cancelar → null.
 */
export async function withReauth(action, { askPassword, reauth }) {
  try {
    return await action();
  } catch (err) {
    if (!isReauthError(err)) throw err;
  }
  let message = null;
  for (;;) {
    const password = await askPassword(message);
    if (password === null || password === undefined) return null;
    try {
      await reauth(password);
      break;
    } catch (err) {
      if (!err || !err.status || err.status >= 500) throw err;
      message = (err.payload && err.payload.error) || err.message || 'Contraseña incorrecta';
    }
  }
  return action();
}
