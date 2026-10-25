// Rutas de la fase 4 (design.md §4 y §5.13): runs de Claude, botones SDD, tests, cambios, commit y push, permisos,
// historial, salida en vivo (SSE) y cola de atención. Toda acción de ejecución pasa por gateExec (D10).
// Feature 14: resolvedor de confianza en todos los lanzamientos (Claude se resuelve en cada run con el cwd del
// proyecto y el catálogo vigente), comandos amplios con confirmación expresa (acknowledgeBroad), hooks en
// GET /changes y "Aprobar spec" rechazado con un run activo.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { sendJson, sendEmpty, readJsonBody, getClientIp } from './http-utils.js';
import { findMerged } from './project-catalog.js';
import { createRunStore, RUN_ID_RE } from './run-store.js';
import { createRunManager } from './runs.js';
import { openSse } from './sse.js';
import { MAX_PROMPT_CHARS, SDD_PROMPTS, DEFAULT_ALLOWED_TOOLS, isValidAllowedCommand, normalizeCommand, isBroadCommand, resolveClaudeCommand, isValidModel, MODEL_LABELS } from './claude-cli.js';
import { execSettingsOf, loadRegistry, saveRegistry, upsertSettings, EXEC_FIELDS, MAX_ALLOWED_COMMANDS, modelOf, applyModelChange, SETTINGS_ERRORS } from './registry.js';
import { readFeatureList } from './project-state.js';
import { approveSpec, readHarness, resolveTestCommand } from './sdd-actions.js';
import { getChanges, getFileDiff, planCommitPush, isGitRepo } from './git-actions.js';
import { resolveExecutable } from './exec-utils.js';
import { defaultRunner } from './git-info.js';
import { defaultResolver } from './trusted-bin.js';
import { isTunnelRequest, isReauthFresh } from './reauth.js';
import { clipPrompt } from './audit.js';

export const RUNS_BODY_LIMIT = 131072;

export const WORK_ERRORS = Object.freeze({
  execDisabled: 'Acciones de ejecución desactivadas en este panel (PANEL_ALLOW_EXEC=0)',
  reauthRequired: 'Confirma tu contraseña para continuar',
  accessDenied: 'Acceso denegado: falta o no es válida la identificación de Cloudflare Access',
  accessMisconfigured: 'Cloudflare Access mal configurado en el panel',
  projectNotFound: 'Proyecto no encontrado',
  noDir: 'El proyecto no tiene una carpeta accesible en este PC',
  runActive: 'Ya hay una ejecución en marcha en este proyecto',
  tooManyRuns: (n) => `Se ha alcanzado el máximo de ejecuciones simultáneas (${n})`,
  promptRequired: 'Escribe un mensaje para Claude',
  promptTooLong: 'El mensaje supera los 20000 caracteres',
  invalidSession: 'Sesión de Claude no válida para este proyecto',
  noSdd: 'El proyecto no tiene arnés SDD (feature_list.json ausente o no válido)',
  featureIdRequired: 'Indica la feature a aprobar',
  notSpecReady: 'La feature no está en spec_ready',
  otherInProgress: (id, slug) => `Ya hay otra feature in_progress: #${id} ${slug}`,
  editFailed: 'No se pudo editar feature_list.json sin alterar el resto del fichero',
  noTestCommand: 'Configura el comando de tests del proyecto (Ajustes de ejecución → Comando de tests)',
  noGitBash: 'No se encontró Git Bash: instala Git for Windows o configura el comando de tests',
  notRepo: 'El proyecto no es un repositorio git',
  fileNotChanged: 'El fichero no está en la lista de cambios',
  messageRequired: 'Escribe el mensaje del commit',
  messageTooLong: 'El mensaje del commit supera los 2000 caracteres',
  nothingToCommit: 'No hay cambios que commitear',
  detachedHead: 'No se puede hacer push sin rama (HEAD separado)',
  runNotFound: 'Ejecución no encontrada',
  runFinished: 'La ejecución ya ha terminado',
  runStillActive: 'La ejecución sigue en marcha',
  invalidCommand: 'Comando no válido: solo letras, números, espacios y . _ : / = @ + - (máx. 200; no puede empezar por - ni terminar en :)',
  broadCommand: (list) => `${list.length > 1 ? 'Comandos' : 'Comando'} de ejecución libre: ${list.map((c) => `«${c}»`).join(', ')}. Permite a Claude ejecutar cualquier programa en este proyecto; confírmalo expresamente para autorizarlo`,
  tooManyCommands: 'Como mucho 30 comandos autorizados',
  notFound: 'Ruta no encontrada',
});

/** Feature 13 (design.md §3.7): opciones del selector de modelo de la vista Trabajar. */
export const MODEL_OPTIONS = Object.freeze(['default', 'haiku', 'sonnet', 'opus'].map((value) => Object.freeze({ value, label: MODEL_LABELS[value] })));

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const ATTENTION_STATES = new Set(['needs_permission', 'failed', 'timeout']);
const ATTENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ATTENTION_MAX_RUNS = 20;
const MAX_WORK_SESSIONS = 20;
const PROJECT_ROUTE = /^\/api\/projects\/([^/]+)\/(runs|work|tests|changes|changes\/diff|permissions|sdd\/implement|sdd\/approve-tests|sdd\/approve-spec|git\/commit-push)$/;
const RUN_ROUTE = /^\/api\/runs\/([^/]+)(?:\/(events|cancel|dismiss))?$/;

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function isDirectory(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Comandos amplios de `next` que no están ya en `current` (feature 14, §4.2), en el orden de `next`. */
export function newBroadCommands(next, current) {
  const saved = new Set((Array.isArray(current) ? current : []).map((c) => normalizeCommand(c)));
  return (Array.isArray(next) ? next : []).map((c) => normalizeCommand(c)).filter((c) => isBroadCommand(c) && !saved.has(c));
}

/** Comandos amplios guardados de un proyecto, en el orden de allowedCommands. */
export function broadCommandsOf(allowedCommands) {
  return (Array.isArray(allowedCommands) ? allowedCommands : []).filter((c) => isBroadCommand(c));
}

/** Cuerpo del 400 que pide la confirmación expresa de comandos amplios. */
export function broadCommandBody(list, field) {
  return { error: WORK_ERRORS.broadCommand(list), field, needsAcknowledge: true, broadCommands: [...list] };
}

/** Respuesta de error de un resultado { ok: false, status, error, field?, runId? }. */
function errorBody(result) {
  const body = { error: result.error };
  if (result.field) body.field = result.field;
  if (result.runId) body.runId = result.runId;
  if (result.reauthRequired) body.reauthRequired = true;
  return body;
}

export function createWorkApi({
  projectsFile,
  dataDir,
  now = Date.now,
  runner = defaultRunner,
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  exists = (file) => fs.existsSync(file),
  claudeCommand,
  claudeBin = 'claude',
  resolver = defaultResolver,
  panelDir = process.cwd(),
  bashBin = null,
  allowExec = true,
  maxRuns = 2,
  runTimeoutMs = 30 * 60000,
  outputLimitBytes,
  keepRuns,
  sseHeartbeatMs = 15000,
  trustProxy = true,
  accessConfigured = false,
  loadSources,
  listCatalog = async () => [],
  extraEnv = {},
  audit = { write: async () => {} },
} = {}) {
  if (!dataDir) throw new Error('createWorkApi: falta dataDir');
  if (!loadSources) throw new Error('createWorkApi: falta loadSources');

  const store = createRunStore({ dataDir, now, ...(keepRuns ? { keepRuns } : {}) });
  const runs = createRunManager({
    store,
    audit,
    now,
    maxRuns,
    runTimeoutMs,
    platform,
    env,
    extraEnv,
    resolver,
    ...(outputLimitBytes ? { outputLimitBytes } : {}),
  });
  const ready = store.recoverOrphans().catch((err) => {
    console.error('[panel] No se pudo revisar el historial de runs al arrancar:', err && err.message ? err.message : err);
  });
  const openStreams = new Set();

  // ---------- Puerta de ejecución (§4.5) ----------

  /**
   * Comprueba una acción de ejecución con sesión ya válida. Devuelve un contexto { respond(status, body, extra) } o
   * null si ya respondió (rechazo). Toda respuesta del contexto se audita.
   */
  async function gateExec(req, res, session, { projectId = null, action, detail: initialDetail } = {}) {
    let detail = initialDetail ? { ...initialDetail } : null;
    const ip = getClientIp(req, { trustProxy });
    const tunnel = isTunnelRequest(req);
    const base = { ip, tunnel, projectId, action };
    const write = (result, status, runId) => audit.write({
      ...base,
      result,
      ...(runId ? { runId } : {}),
      status,
      ...(detail && Object.keys(detail).length ? { detail } : {}),
    });
    const ctx = {
      ip,
      tunnel,
      auditContext: { ip, tunnel },
      setDetail(extra) {
        detail = { ...(detail || {}), ...extra };
      },
      async respond(res2, status, body, { runId } = {}) {
        let result = 'ok';
        if (status === 202) result = 'started';
        else if (status >= 500) result = 'error';
        else if (status >= 400) result = 'rejected';
        await write(result, status, runId);
        if (status === 204) return sendEmpty(res2, 204);
        return sendJson(res2, status, body);
      },
    };
    if (!allowExec) {
      await ctx.respond(res, 403, { error: WORK_ERRORS.execDisabled });
      return null;
    }
    // Con Cloudflare Access configurado la petición ya pasó la verificación del JWT (middleware de app.js).
    if (tunnel && !accessConfigured && !isReauthFresh(session && session.reauthAt, now())) {
      await ctx.respond(res, 401, { error: WORK_ERRORS.reauthRequired, reauthRequired: true });
      return null;
    }
    return ctx;
  }

  // ---------- Utilidades de proyecto ----------

  async function resolveProject(id) {
    const sources = await loadSources();
    const merged = findMerged(sources, id);
    return { sources, merged };
  }

  /** Carpeta del proyecto (del catálogo, nunca del cliente) si existe en este PC; si no, null. */
  async function projectDir(merged) {
    if (!merged || merged.unresolved || typeof merged.path !== 'string' || !merged.path) return null;
    const dir = path.resolve(merged.path);
    return (await isDirectory(dir)) ? dir : null;
  }

  async function readBody(req, res, limit) {
    try {
      return await readJsonBody(req, limit ? { limit } : {});
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.error || 'Cuerpo JSON inválido' });
      return null;
    }
  }

  function validatePrompt(prompt) {
    if (typeof prompt !== 'string' || prompt.trim() === '') return { ok: false, status: 400, error: WORK_ERRORS.promptRequired, field: 'prompt' };
    if ([...prompt].length > MAX_PROMPT_CHARS) return { ok: false, status: 400, error: WORK_ERRORS.promptTooLong, field: 'prompt' };
    return { ok: true };
  }

  async function knownSessionIds(merged) {
    const ids = new Set();
    for (const s of (merged.claude && merged.claude.sessions) || []) if (s && s.id) ids.add(s.id);
    for (const m of await store.list(merged.id, Number.MAX_SAFE_INTEGER)) if (m.claudeSessionId) ids.add(m.claudeSessionId);
    return ids;
  }

  async function validateSession(raw, merged, defaultMode) {
    const invalid = { ok: false, status: 400, error: WORK_ERRORS.invalidSession };
    if (raw === undefined || raw === null) return { ok: true, session: { mode: defaultMode, id: null } };
    if (typeof raw !== 'object' || Array.isArray(raw)) return invalid;
    if (raw.mode === 'new' || raw.mode === 'continue') return { ok: true, session: { mode: raw.mode, id: null } };
    if (raw.mode !== 'resume' || typeof raw.id !== 'string' || !SESSION_ID_RE.test(raw.id)) return invalid;
    if (!(await knownSessionIds(merged)).has(raw.id)) return invalid;
    return { ok: true, session: { mode: 'resume', id: raw.id } };
  }

  /** Ejecutable de Claude de confianza para un run en `dir` (feature 14, D5) o { error }. */
  function claudeFor(dir) {
    // Claude se resuelve en cada lanzamiento con el cwd del run y el catálogo vigente (con caché).
    const command = claudeCommand ?? resolveClaudeCommand(claudeBin, { platform, env, execPath, resolver, cwd: dir, panelDir });
    if (!command || command.error) return { error: command && command.error ? command.error : 'No se pudo ejecutar Claude Code: sin ejecutable' };
    return command;
  }

  /**
   * Modelo de un run (feature 13, §5.10): el del cuerpo si es válido, el recordado si no viene; null si el cuerpo trae
   * uno no válido (la ruta responde 400 sin lanzar nada).
   */
  function modelFor(body, merged) {
    if (body.model === undefined) return modelOf(merged.settingsEntry);
    return isValidModel(body.model) ? body.model : null;
  }

  /** Recuerda en el registro el modelo elegido si cambió (crea la entrada si el proyecto era solo de Claude). */
  async function rememberModel(merged, model) {
    try {
      const sources = await loadSources();
      const fresh = findMerged(sources, merged.id) ?? merged;
      if (modelOf(fresh.settingsEntry) === model) return;
      const registry = upsertSettings(sources.registry, applyModelChange(settingsEntryFor(fresh), model));
      await saveRegistry(projectsFile, registry);
    } catch (err) {
      console.error('[panel] No se pudo recordar el modelo del proyecto:', err && err.message ? err.message : err);
    }
  }

  /** Lanza un run de Claude ya validado el proyecto; responde por `ctx`. */
  async function launchClaudeRun(res, ctx, { merged, dir, prompt, session, action, label, model = 'default', remember = false }) {
    const command = claudeFor(dir);
    if (command.error) return ctx.respond(res, 409, { error: command.error });
    const { allowedCommands } = execSettingsOf(merged.settingsEntry);
    const started = await runs.startClaude({
      project: { id: merged.id, dir },
      prompt,
      session,
      action,
      label,
      allowedCommands,
      claudeCommand: command,
      auditContext: ctx.auditContext,
      model,
    });
    if (!started.ok) return ctx.respond(res, started.status, errorBody(started));
    if (remember) await rememberModel(merged, model);
    return ctx.respond(res, 202, started.meta, { runId: started.meta.runId });
  }

  /**
   * Feature 13 (§5.10): run de Claude en SOLO LECTURA (resúmenes) con el mismo resolvedor de confianza y el mismo
   * gestor de runs (profile 'readonly': Haiku, Read/Glob/Grep). No pasa por gateExec: lo hace quien lo llama.
   * → { ok: true, meta } | { ok: false, status, error, runId? }.
   */
  async function startReadOnlyClaude({ merged, dir, prompt, action, label, auditContext }) {
    const command = claudeFor(dir);
    if (command.error) return { ok: false, status: 409, error: command.error };
    return runs.startClaude({
      project: { id: merged.id, dir },
      prompt,
      session: { mode: 'new' },
      action,
      label,
      profile: 'readonly',
      claudeCommand: command,
      auditContext,
    });
  }

  // ---------- POST /api/projects/:id/runs ----------

  async function postRun(req, res, session, id) {
    const body = await readBody(req, res, RUNS_BODY_LIMIT);
    if (!body) return undefined;
    const detail = typeof body.prompt === 'string' ? { promptPreview: clipPrompt(body.prompt) } : {};
    if (body.session && typeof body.session === 'object' && typeof body.session.mode === 'string') detail.session = body.session.mode;
    if (isValidModel(body.model)) detail.model = body.model;
    const ctx = await gateExec(req, res, session, { projectId: id, action: 'run.chat', detail });
    if (!ctx) return undefined;
    if (body.model !== undefined && !isValidModel(body.model)) return ctx.respond(res, 400, { error: SETTINGS_ERRORS.invalidModel, field: 'model' });
    const { merged } = await resolveProject(id);
    if (!merged) return ctx.respond(res, 404, { error: WORK_ERRORS.projectNotFound });
    const dir = await projectDir(merged);
    if (!dir) return ctx.respond(res, 409, { error: WORK_ERRORS.noDir });
    const prompt = validatePrompt(body.prompt);
    if (!prompt.ok) return ctx.respond(res, prompt.status, errorBody(prompt));
    const sessionCheck = await validateSession(body.session, merged, 'new');
    if (!sessionCheck.ok) return ctx.respond(res, sessionCheck.status, errorBody(sessionCheck));
    const model = modelFor(body, merged);
    ctx.setDetail({ model });
    return launchClaudeRun(res, ctx, { merged, dir, prompt: body.prompt, session: sessionCheck.session, action: 'chat', label: 'Chat', model, remember: body.model !== undefined });
  }

  // ---------- Botones SDD (§5.7) ----------

  const SDD_RUNS = Object.freeze({
    implement: { prompt: SDD_PROMPTS.implement, action: 'implement', label: 'Implementar siguiente tarea', defaultMode: 'new' },
    'approve-tests': { prompt: SDD_PROMPTS.approveTests, action: 'approve-tests', label: 'Aprobar tests', defaultMode: 'continue' },
  });

  async function postSddRun(req, res, session, id, kind) {
    const spec = SDD_RUNS[kind];
    const body = await readBody(req, res);
    if (!body) return undefined;
    const detail = { promptPreview: spec.prompt, ...(body.session && typeof body.session.mode === 'string' ? { session: body.session.mode } : {}) };
    if (isValidModel(body.model)) detail.model = body.model;
    const ctx = await gateExec(req, res, session, { projectId: id, action: `run.${spec.action}`, detail });
    if (!ctx) return undefined;
    if (body.model !== undefined && !isValidModel(body.model)) return ctx.respond(res, 400, { error: SETTINGS_ERRORS.invalidModel, field: 'model' });
    const { merged } = await resolveProject(id);
    if (!merged) return ctx.respond(res, 404, { error: WORK_ERRORS.projectNotFound });
    const dir = await projectDir(merged);
    if (!dir) return ctx.respond(res, 409, { error: WORK_ERRORS.noDir });
    if (!(await readHarness(dir)).ok) return ctx.respond(res, 409, { error: WORK_ERRORS.noSdd });
    const sessionCheck = await validateSession(body.session, merged, spec.defaultMode);
    if (!sessionCheck.ok) return ctx.respond(res, sessionCheck.status, errorBody(sessionCheck));
    const model = modelFor(body, merged);
    ctx.setDetail({ model });
    return launchClaudeRun(res, ctx, { merged, dir, prompt: spec.prompt, session: sessionCheck.session, action: spec.action, label: spec.label, model, remember: body.model !== undefined });
  }

  function isValidFeatureId(value) {
    return Number.isInteger(value) || (typeof value === 'string' && value.trim() !== '');
  }

  async function postApproveSpec(req, res, session, id) {
    const body = await readBody(req, res);
    if (!body) return undefined;
    const ctx = await gateExec(req, res, session, { projectId: id, action: 'sdd.approve-spec', detail: isValidFeatureId(body.featureId) ? { featureId: body.featureId } : {} });
    if (!ctx) return undefined;
    const { merged } = await resolveProject(id);
    if (!merged) return ctx.respond(res, 404, { error: WORK_ERRORS.projectNotFound });
    const dir = await projectDir(merged);
    if (!dir) return ctx.respond(res, 409, { error: WORK_ERRORS.noDir });
    if (!(await readHarness(dir)).ok) return ctx.respond(res, 409, { error: WORK_ERRORS.noSdd });
    if (!isValidFeatureId(body.featureId)) return ctx.respond(res, 400, { error: WORK_ERRORS.featureIdRequired, field: 'featureId' });
    // Feature 14 (N4): con un run activo en el proyecto, Claude podría estar escribiendo feature_list.json.
    const active = runs.activeFor(merged.id);
    if (active) return ctx.respond(res, 409, { error: WORK_ERRORS.runActive, runId: active.runId });
    const result = await approveSpec(dir, body.featureId);
    if (!result.ok) return ctx.respond(res, result.status, { error: result.error });
    return ctx.respond(res, 200, { feature: result.feature });
  }

  // ---------- Ejecutar tests (§5.7, §5.3) ----------

  function testCommandFor(merged, dir) {
    const { testCommand } = execSettingsOf(merged.settingsEntry);
    return resolveTestCommand({ testCommand, projectDir: dir, platform, env, execPath, exists, bashBin, resolver });
  }

  async function postTests(req, res, session, id) {
    const body = await readBody(req, res);
    if (!body) return undefined;
    const ctx = await gateExec(req, res, session, { projectId: id, action: 'run.tests' });
    if (!ctx) return undefined;
    const { merged } = await resolveProject(id);
    if (!merged) return ctx.respond(res, 404, { error: WORK_ERRORS.projectNotFound });
    const dir = await projectDir(merged);
    if (!dir) return ctx.respond(res, 409, { error: WORK_ERRORS.noDir });
    const resolved = testCommandFor(merged, dir);
    if (!resolved.ok) return ctx.respond(res, resolved.status, { error: resolved.error });
    const display = resolved.steps.map((s) => s.display).join(' → ');
    ctx.setDetail({ command: display });
    const started = await runs.startCommand({
      project: { id: merged.id, dir },
      steps: resolved.steps,
      action: 'tests',
      label: 'Ejecutar tests',
      commandLabel: display,
      auditContext: ctx.auditContext,
    });
    if (!started.ok) return ctx.respond(res, started.status, errorBody(started));
    return ctx.respond(res, 202, started.meta, { runId: started.meta.runId });
  }

  // ---------- Cambios y commit y push (§5.8) ----------

  async function getProjectChanges(res, id) {
    const { merged } = await resolveProject(id);
    if (!merged) return sendJson(res, 404, { error: WORK_ERRORS.projectNotFound });
    const dir = await projectDir(merged);
    if (!dir) return sendJson(res, 409, { error: WORK_ERRORS.noDir });
    const changes = await getChanges(dir, { runner });
    if (!changes.ok) return sendJson(res, changes.status, { error: changes.error });
    return sendJson(res, 200, {
      branch: changes.branch,
      files: changes.files,
      stat: changes.stat,
      truncated: changes.truncated,
      hooks: changes.hooks || [],
      hooksPathCustom: changes.hooksPathCustom === true,
      repoConfig: changes.repoConfig, // corrección revisión F14 (M3)
    });
  }

  async function getProjectDiff(res, id, url) {
    const { merged } = await resolveProject(id);
    if (!merged) return sendJson(res, 404, { error: WORK_ERRORS.projectNotFound });
    const dir = await projectDir(merged);
    if (!dir) return sendJson(res, 409, { error: WORK_ERRORS.noDir });
    const diff = await getFileDiff(dir, url.searchParams.get('file'), { runner });
    if (!diff.ok) return sendJson(res, diff.status, { error: diff.error });
    return sendJson(res, 200, { file: diff.file, diff: diff.diff, untracked: diff.untracked, truncated: diff.truncated });
  }

  /** Pasos con el ejecutable resuelto por el resolvedor de confianza (cwd = carpeta del proyecto). */
  function resolveSteps(steps, dir) {
    const out = [];
    for (const step of steps) {
      const resolved = resolveExecutable(step.file, { platform, env, execPath, exists, bashBin, resolver, cwd: dir });
      if (resolved.error) return { ok: false, status: 409, error: resolved.error };
      out.push({ ...step, file: resolved.file, prefixArgs: [...resolved.prefixArgs, ...(step.prefixArgs || [])] });
    }
    return { ok: true, steps: out };
  }

  async function postCommitPush(req, res, session, id) {
    const body = await readBody(req, res);
    if (!body) return undefined;
    const preview = typeof body.message === 'string' ? { promptPreview: clipPrompt(body.message) } : {};
    const ctx = await gateExec(req, res, session, { projectId: id, action: 'git.commit-push', detail: preview });
    if (!ctx) return undefined;
    const { merged } = await resolveProject(id);
    if (!merged) return ctx.respond(res, 404, { error: WORK_ERRORS.projectNotFound });
    const dir = await projectDir(merged);
    if (!dir) return ctx.respond(res, 409, { error: WORK_ERRORS.noDir });
    const plan = await planCommitPush(dir, body.message, { runner, env });
    if (!plan.ok) return ctx.respond(res, plan.status, errorBody(plan));
    const resolved = resolveSteps(plan.steps, dir);
    if (!resolved.ok) return ctx.respond(res, resolved.status, { error: resolved.error });
    const started = await runs.startCommand({
      project: { id: merged.id, dir },
      steps: resolved.steps,
      action: 'commit-push',
      label: 'Commit y push',
      commandLabel: plan.display,
      auditContext: ctx.auditContext,
    });
    if (!started.ok) return ctx.respond(res, started.status, errorBody(started));
    return ctx.respond(res, 202, started.meta, { runId: started.meta.runId });
  }

  // ---------- Estado y vista "Trabajar" (§4.3) ----------

  function workStatus(req, res, session) {
    const tunnel = isTunnelRequest(req);
    return sendJson(res, 200, {
      execEnabled: allowExec,
      accessConfigured,
      tunnel,
      reauthFresh: !tunnel || accessConfigured || isReauthFresh(session && session.reauthAt, now()),
      maxRuns,
      activeRuns: runs.activeCount(),
      runTimeoutMin: runTimeoutMs / 60000,
    });
  }

  async function projectWork(res, id) {
    const { merged } = await resolveProject(id);
    if (!merged) return sendJson(res, 404, { error: WORK_ERRORS.projectNotFound });
    const dir = await projectDir(merged);
    const { allowedCommands, testCommand } = execSettingsOf(merged.settingsEntry);
    const sessions = ((merged.claude && merged.claude.sessions) || [])
      .slice(0, MAX_WORK_SESSIONS)
      .map((s) => ({ id: s.id, title: s.title, lastActivityAt: s.lastActivityAt }));
    const base = {
      projectId: merged.id,
      executable: Boolean(dir),
      execEnabled: allowExec,
      hasSdd: false,
      isRepo: false,
      specReady: [],
      inProgress: null,
      allowedCommands,
      testCommand,
      effectiveTestCommand: null,
      testCommandError: WORK_ERRORS.noDir,
      defaultTools: [...DEFAULT_ALLOWED_TOOLS],
      activeRun: runs.activeFor(merged.id),
      sessions,
      broadCommands: broadCommandsOf(allowedCommands),
      // Feature 13 (§3.7): modelo recordado y opciones del selector.
      model: modelOf(merged.settingsEntry),
      models: MODEL_OPTIONS.map((m) => ({ ...m })),
    };
    if (!dir) return sendJson(res, 200, base);
    const [sdd, repo] = await Promise.all([readFeatureList(dir), isGitRepo(dir, { runner })]);
    const hasSdd = sdd.present && !sdd.error;
    const tests = testCommandFor(merged, dir);
    return sendJson(res, 200, {
      ...base,
      hasSdd,
      isRepo: repo,
      specReady: hasSdd ? sdd.awaitingApproval : [],
      inProgress: hasSdd && sdd.inProgress ? { id: sdd.inProgress.id, slug: sdd.inProgress.slug } : null,
      effectiveTestCommand: tests.ok ? tests.steps.map((step) => step.display).join(' → ') : null,
      testCommandError: tests.ok ? null : tests.error,
    });
  }

  // ---------- Permisos por proyecto (§4.1) ----------

  /** Entrada de ajustes del proyecto (o una nueva si era solo de Claude). */
  function settingsEntryFor(merged) {
    return merged.settingsEntry ?? { id: merged.id, name: merged.name, path: merged.path, appUrl: '', repoUrl: '', tags: [], hidden: false, pinned: false };
  }

  async function postPermission(req, res, session, id) {
    const body = await readBody(req, res);
    if (!body) return undefined;
    const valid = isValidAllowedCommand(body.command);
    const command = valid ? normalizeCommand(body.command) : null;
    const ctx = await gateExec(req, res, session, { projectId: id, action: 'permissions.add', detail: command ? { addedCommand: command } : {} });
    if (!ctx) return undefined;
    const { sources, merged } = await resolveProject(id);
    if (!merged) return ctx.respond(res, 404, { error: WORK_ERRORS.projectNotFound });
    if (!valid) return ctx.respond(res, 400, { error: WORK_ERRORS.invalidCommand, field: 'command' });
    if (merged.unresolved || !merged.path) return ctx.respond(res, 409, { error: WORK_ERRORS.noDir });
    const entry = settingsEntryFor(merged);
    const current = execSettingsOf(entry).allowedCommands;
    if (current.includes(command)) return ctx.respond(res, 200, { allowedCommands: current });
    // Feature 14 (M2): un comando de ejecución libre exige la confirmación expresa del humano.
    if (isBroadCommand(command)) {
      if (body.acknowledgeBroad !== true) return ctx.respond(res, 400, broadCommandBody([command], 'command'));
      ctx.setDetail({ acknowledgedBroad: [command] });
    }
    if (current.length >= MAX_ALLOWED_COMMANDS) return ctx.respond(res, 400, { error: WORK_ERRORS.tooManyCommands, field: 'allowedCommands' });
    const allowedCommands = [...current, command];
    const registry = upsertSettings(sources.registry, { ...entry, allowedCommands });
    await saveRegistry(projectsFile, registry);
    return ctx.respond(res, 200, { allowedCommands });
  }

  /** true si un PATCH /api/projects/:id trae campos de ejecución (F4-R63). */
  function isExecPatch(body) {
    return Boolean(body) && typeof body === 'object' && EXEC_FIELDS.some((field) => body[field] !== undefined);
  }

  // ---------- Cola de atención (§4.3) ----------

  function hasDenials(meta) {
    return meta.state === 'succeeded' && Array.isArray(meta.permissionDenials) && meta.permissionDenials.length > 0;
  }

  async function attention(res) {
    const catalog = await listCatalog();
    const alertOf = (p) => {
      const features = (p.sdd && p.sdd.awaitingApproval) || [];
      const blockReason = p.progress && p.progress.blocked ? p.progress.blockReason : null;
      return { features, blockReason, key: JSON.stringify([features.map((f) => [f.id, f.slug]), blockReason]) };
    };
    // Feature 13 (R62, design.md §5.11): un worktree cuyo principal está en la lista no genera entrada propia; si su
    // alerta es distinta de la del principal, suma una "tarea en curso que espera" en la entrada del principal.
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const isGroupedTask = (p) => Boolean(p.parentId) && byId.has(p.parentId) && p.parentId !== p.id;
    const entries = new Map();
    for (const p of catalog) {
      if (p.status !== 'atencion' || isGroupedTask(p)) continue;
      const { features, blockReason } = alertOf(p);
      entries.set(p.id, { id: p.id, name: p.name, reason: features.length ? 'spec_ready' : 'bloqueo', features, blockReason, tasksAwaiting: 0 });
    }
    for (const p of catalog) {
      if (p.status !== 'atencion' || !isGroupedTask(p)) continue;
      const parent = byId.get(p.parentId);
      if (parent.status === 'atencion' && alertOf(parent).key === alertOf(p).key) continue;
      if (!entries.has(parent.id)) entries.set(parent.id, { id: parent.id, name: parent.name, reason: 'tareas', features: [], blockReason: null, tasksAwaiting: 0 });
      entries.get(parent.id).tasksAwaiting += 1;
    }
    const projects = catalog.filter((p) => entries.has(p.id)).map((p) => entries.get(p.id));
    const names = new Map((await loadSources()).registry.projects.map((p) => [p.id, p.name]));
    for (const p of catalog) names.set(p.id, p.name);
    const since = now() - ATTENTION_WINDOW_MS;
    const items = (await store.listAll())
      // Feature 13 (R61, D15): los runs de resumen nunca van a "Te necesitan" (se ven en el historial del proyecto).
      .filter((m) => m.action !== 'summary' && (ATTENTION_STATES.has(m.state) || hasDenials(m)) && !m.dismissed && Date.parse(m.endedAt) >= since)
      .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
      .slice(0, ATTENTION_MAX_RUNS)
      .map((m) => ({
        runId: m.runId,
        projectId: m.projectId,
        projectName: names.get(m.projectId) ?? m.projectId,
        label: m.label,
        state: m.state,
        // Corrección T36: un run terminado con éxito pero con comandos denegados es solo un aviso informativo.
        informative: !ATTENTION_STATES.has(m.state),
        endedAt: m.endedAt,
        permissionDenials: Array.isArray(m.permissionDenials) ? m.permissionDenials : [],
      }));
    return sendJson(res, 200, { projects, runs: items });
  }

  async function dismissRun(res, runId) {
    const run = await findRun(runId);
    if (!run) return sendJson(res, 404, { error: WORK_ERRORS.runNotFound });
    if (run.active) return sendJson(res, 409, { error: WORK_ERRORS.runStillActive });
    await store.updateMeta(run.meta.projectId, runId, { dismissed: true });
    return sendEmpty(res, 204);
  }

  // ---------- Historial y runs ----------

  async function listRuns(res, id) {
    const { merged } = await resolveProject(id);
    if (!merged) return sendJson(res, 404, { error: WORK_ERRORS.projectNotFound });
    const stored = await store.list(id);
    const active = runs.activeFor(id);
    const list = stored.map((m) => (active && m.runId === active.runId ? active : m));
    return sendJson(res, 200, list);
  }

  /** Run de memoria (activo) o de disco: { meta, events?, active } o null. */
  async function findRun(runId, { withEvents = false } = {}) {
    if (!RUN_ID_RE.test(runId)) return null;
    const live = runs.get(runId);
    if (live) return { meta: live.meta, events: live.events, active: true };
    const found = await store.find(runId);
    if (!found) return null;
    return { meta: found.meta, events: withEvents ? await store.readEvents(found.projectId, runId) : null, active: false };
  }

  async function getRun(res, runId) {
    const run = await findRun(runId, { withEvents: true });
    if (!run) return sendJson(res, 404, { error: WORK_ERRORS.runNotFound });
    return sendJson(res, 200, { run: run.meta, events: run.events });
  }

  async function cancelRun(req, res, runId) {
    const run = await findRun(runId);
    if (!run) return sendJson(res, 404, { error: WORK_ERRORS.runNotFound });
    const ip = getClientIp(req, { trustProxy });
    const tunnel = isTunnelRequest(req);
    const meta = run.active ? runs.cancel(runId) : null;
    if (!meta) {
      await audit.write({ ip, tunnel, projectId: run.meta.projectId, action: 'run.cancel', result: 'rejected', runId, status: 409 });
      return sendJson(res, 409, { error: WORK_ERRORS.runFinished });
    }
    await audit.write({ ip, tunnel, projectId: run.meta.projectId, action: 'run.cancel', result: 'ok', runId, status: 202 });
    return sendJson(res, 202, meta);
  }

  function lastEventId(req) {
    const raw = req.headers['last-event-id'];
    const value = Number.parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  async function streamRun(req, res, runId) {
    const run = await findRun(runId);
    if (!run) return sendJson(res, 404, { error: WORK_ERRORS.runNotFound });
    const after = lastEventId(req);
    const sse = openSse(res, { heartbeatMs: sseHeartbeatMs });
    openStreams.add(sse);
    let unsubscribe = () => {};
    const close = () => {
      unsubscribe();
      openStreams.delete(sse);
      sse.close();
    };
    req.on('close', close);
    const live = run.active
      ? runs.subscribe(runId, after, (event) => {
        sse.send(event);
        if (event.type === 'end') close();
      })
      : null;
    if (live) {
      unsubscribe = live.unsubscribe;
      for (const event of live.events) sse.send(event);
      if (live.ended) close();
      return undefined;
    }
    // Terminado (o terminó mientras se buscaba): se reenvía del disco y se cierra.
    const found = await store.find(runId);
    const events = found ? await store.readEvents(found.projectId, runId) : [];
    for (const event of events) if (event.seq > after) sse.send(event);
    close();
    return undefined;
  }

  // ---------- Encaminador ----------

  async function routeProject(req, res, session, id, action, url) {
    const method = req.method;
    if (action === 'runs' && method === 'POST') return postRun(req, res, session, id);
    if (action === 'runs' && method === 'GET') return listRuns(res, id);
    if (action === 'work' && method === 'GET') return projectWork(res, id);
    if (action === 'permissions' && method === 'POST') return postPermission(req, res, session, id);
    if (action === 'sdd/implement' && method === 'POST') return postSddRun(req, res, session, id, 'implement');
    if (action === 'sdd/approve-tests' && method === 'POST') return postSddRun(req, res, session, id, 'approve-tests');
    if (action === 'sdd/approve-spec' && method === 'POST') return postApproveSpec(req, res, session, id);
    if (action === 'tests' && method === 'POST') return postTests(req, res, session, id);
    if (action === 'changes' && method === 'GET') return getProjectChanges(res, id);
    if (action === 'changes/diff' && method === 'GET') return getProjectDiff(res, id, url);
    if (action === 'git/commit-push' && method === 'POST') return postCommitPush(req, res, session, id);
    return sendJson(res, 404, { error: WORK_ERRORS.notFound });
  }

  async function routeRun(req, res, session, runId, action) {
    const method = req.method;
    if (!action && method === 'GET') return getRun(res, runId);
    if (action === 'events' && method === 'GET') return streamRun(req, res, runId);
    if (action === 'cancel' && method === 'POST') return cancelRun(req, res, runId);
    if (action === 'dismiss' && method === 'POST') return dismissRun(res, runId);
    return sendJson(res, 404, { error: WORK_ERRORS.notFound });
  }

  /** Atiende las rutas de la fase 4; devuelve true si la petición era suya. */
  async function route(req, res, url, session) {
    await ready;
    const pathname = url.pathname;
    if (pathname === '/api/work/status' && req.method === 'GET') {
      workStatus(req, res, session);
      return true;
    }
    if (pathname === '/api/attention' && req.method === 'GET') {
      await attention(res);
      return true;
    }
    const projectMatch = PROJECT_ROUTE.exec(pathname);
    if (projectMatch) {
      const id = decodeSegment(projectMatch[1]);
      if (id === null) {
        sendJson(res, 404, { error: WORK_ERRORS.projectNotFound });
        return true;
      }
      await routeProject(req, res, session, id, projectMatch[2], url);
      return true;
    }
    const runMatch = RUN_ROUTE.exec(pathname);
    if (runMatch) {
      const runId = decodeSegment(runMatch[1]);
      await routeRun(req, res, session, runId ?? '', runMatch[2]);
      return true;
    }
    return false;
  }

  /** Cierre del servidor: cancela los runs activos y cierra los flujos SSE abiertos. */
  function close() {
    for (const sse of [...openStreams]) sse.close();
    openStreams.clear();
    return runs.cancelAll();
  }

  return { route, runs, store, ready, gateExec, isExecPatch, close, startReadOnlyClaude, findRun };
}
