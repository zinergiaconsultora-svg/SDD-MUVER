// Gestor de runs en memoria (design.md §5.4): máquina de estados, límites (uno por proyecto y `maxRuns` en total),
// límite de tiempo, límite de salida, cancelación del árbol de procesos y suscriptores para la salida en vivo (SSE).
//
//             spawn OK                exit
//  queued ─────────────▶ running ─────────────▶ succeeded | failed | needs_permission
//    │  spawn 'error'       │ cancel()  ─────▶ cancelled
//    └────────▶ failed      │ timeout   ─────▶ timeout
import { spawn } from 'node:child_process';

import { buildClaudeArgs, createStreamMapper } from './claude-cli.js';
import { killProcessTree, KILL_GRACE_MS, MAX_LINE_BYTES } from './exec-utils.js';
import { runSteps, waitForChild, pipeOutput, outputEvent } from './command-runner.js';
import { newRunId } from './run-store.js';

export const ACTIVE_STATES = Object.freeze(['queued', 'running']);
export const FINAL_STATES = Object.freeze(['succeeded', 'failed', 'cancelled', 'timeout', 'needs_permission']);
export const DEFAULT_OUTPUT_LIMIT_BYTES = 5 * 1024 * 1024;
export const PROMPT_PREVIEW_CHARS = 120;
const LIMITED_TYPES = new Set(['text', 'output', 'tool', 'tool_error']);

export const RUN_ERRORS = Object.freeze({
  runActive: 'Ya hay una ejecución en marcha en este proyecto',
  tooManyRuns: (n) => `Se ha alcanzado el máximo de ejecuciones simultáneas (${n})`,
});

export const NOTICES = Object.freeze({
  truncated: (mb) => `Salida truncada: se alcanzó el límite de ${mb} MB`,
  lineDiscarded: 'Línea de salida descartada por superar 1 MB',
  timeout: (min) => `Tiempo máximo alcanzado (${min} min): se detiene la ejecución`,
});

/** Número con un decimal si no es entero (5 → "5"; 0.0095 → "0.0"). */
function formatAmount(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Primeros 120 puntos de código. */
export function clipPreview(text) {
  return [...String(text ?? '')].slice(0, PROMPT_PREVIEW_CHARS).join('');
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createRunManager({
  store,
  audit = { write: async () => {} },
  now = Date.now,
  maxRuns = 2,
  runTimeoutMs = 30 * 60000,
  outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
  platform = process.platform,
  spawnImpl = spawn,
  killTree = killProcessTree,
  env = process.env,
  extraEnv = {},
  graceMs = KILL_GRACE_MS,
  maxLineBytes = MAX_LINE_BYTES,
} = {}) {
  if (!store) throw new Error('createRunManager: falta store');
  const records = new Map(); // runId → registro de los runs activos (o terminando)

  const iso = () => new Date(now()).toISOString();
  const liveRecords = () => [...records.values()].filter((rec) => !rec.finished);

  function activeFor(projectId) {
    const rec = liveRecords().find((r) => r.meta.projectId === projectId);
    return rec ? copy(rec.meta) : null;
  }

  function activeCount() {
    return liveRecords().length;
  }

  function checkLimits(projectId) {
    const busy = liveRecords().find((r) => r.meta.projectId === projectId);
    if (busy) return { ok: false, status: 409, error: RUN_ERRORS.runActive, runId: busy.meta.runId };
    if (liveRecords().length >= maxRuns) return { ok: false, status: 429, error: RUN_ERRORS.tooManyRuns(maxRuns) };
    return null;
  }

  function register(meta, { cwd, auditContext }) {
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const rec = {
      meta,
      cwd,
      auditContext: auditContext || {},
      startedMs: now(),
      seq: 0,
      events: [],
      subscribers: new Set(),
      child: null,
      cancelRequested: false,
      timedOut: false,
      launchError: null,
      exitCode: null,
      result: null,
      claudeSessionId: null,
      denials: () => [],
      finishing: false,
      finished: false,
      timer: null,
      cancelTimer: null,
      splitters: [],
      done,
      resolveDone,
    };
    records.set(meta.runId, rec);
    return rec;
  }

  function baseMeta({ projectId, kind, action, label, promptPreview, command, session }) {
    return {
      runId: newRunId(now),
      projectId,
      kind,
      action,
      label,
      promptPreview,
      command,
      session,
      state: 'queued',
      startedAt: iso(),
      endedAt: null,
      durationMs: null,
      exitCode: null,
      claudeSessionId: null,
      costUsd: null,
      numTurns: null,
      permissionDenials: [],
      error: null,
      truncated: false,
      outputBytes: 0,
      dismissed: false,
    };
  }

  /** Añade un evento (seq, at), lo guarda y lo entrega a los suscriptores. Aplica el límite de salida. */
  function emit(rec, partial, { deliver = true, internal = false } = {}) {
    if (rec.finishing && !internal) return null;
    if (LIMITED_TYPES.has(partial.type)) {
      if (rec.meta.truncated) return null;
      const size = Buffer.byteLength(JSON.stringify(partial));
      if (rec.meta.outputBytes + size > outputLimitBytes) {
        rec.meta.truncated = true;
        emit(rec, { type: 'notice', message: NOTICES.truncated(formatAmount(outputLimitBytes / (1024 * 1024))) });
        return null;
      }
      rec.meta.outputBytes += size;
    }
    const event = { seq: ++rec.seq, at: iso(), ...partial };
    rec.events.push(event);
    store.appendEvent(rec.meta.projectId, rec.meta.runId, event).catch((err) => {
      console.error('[panel] No se pudo guardar un evento del run:', err && err.message ? err.message : err);
    });
    if (deliver) for (const fn of rec.subscribers) fn(event);
    return event;
  }

  function setState(rec, state) {
    rec.meta.state = state;
    emit(rec, { type: 'state', state });
  }

  function startTimer(rec) {
    rec.timer = setTimeout(() => {
      if (rec.finishing) return;
      rec.timedOut = true;
      emit(rec, { type: 'notice', message: NOTICES.timeout(formatAmount(runTimeoutMs / 60000)) });
      stopProcess(rec);
    }, runTimeoutMs);
    if (typeof rec.timer.unref === 'function') rec.timer.unref();
  }

  function stopProcess(rec) {
    if (rec.child && Number.isInteger(rec.child.pid) && rec.child.exitCode === null && rec.child.signalCode === null) {
      killTree(rec.child, { platform });
    }
    if (!rec.cancelTimer) {
      // Si el proceso no llega a salir (o no llegó a lanzarse), se cierra el run igualmente.
      rec.cancelTimer = setTimeout(() => finalize(rec), graceMs + 1000);
      if (typeof rec.cancelTimer.unref === 'function') rec.cancelTimer.unref();
    }
  }

  function spawnOptions(cwd, extra = {}, { stdin = 'ignore' } = {}) {
    return {
      cwd,
      env: { ...env, ...extraEnv, ...extra },
      stdio: [stdin, 'pipe', 'pipe'],
      windowsHide: true,
      detached: platform !== 'win32',
      shell: false,
    };
  }

  function computeState(rec) {
    if (rec.cancelRequested) return 'cancelled';
    if (rec.timedOut) return 'timeout';
    if (rec.launchError) return 'failed';
    // Corrección T36: con el CLI real una denegación no detiene el trabajo. Si el result es éxito el run es
    // succeeded (las denegaciones quedan en permissionDenials como aviso); needs_permission solo sin éxito.
    if (rec.exitCode === 0 && (rec.meta.kind !== 'claude' || (rec.result && rec.result.ok))) return 'succeeded';
    if (rec.meta.kind === 'claude' && rec.denials().length > 0) return 'needs_permission';
    return 'failed';
  }

  /** Cierre del run: estado final, eventos state + end, índice, auditoría, suscriptores y rotación. */
  async function finalize(rec) {
    if (rec.finishing) return rec.done;
    for (const splitter of rec.splitters) splitter.end(); // última línea sin salto, antes de cerrar
    rec.finishing = true;
    clearTimeout(rec.timer);
    clearTimeout(rec.cancelTimer);
    const state = computeState(rec);
    const durationMs = Math.max(0, now() - rec.startedMs);
    const final = {
      state,
      endedAt: iso(),
      durationMs,
      exitCode: Number.isInteger(rec.exitCode) ? rec.exitCode : null,
      error: rec.launchError ?? rec.meta.error,
      truncated: rec.meta.truncated,
      outputBytes: rec.meta.outputBytes,
    };
    if (rec.meta.kind === 'claude') {
      final.claudeSessionId = rec.claudeSessionId;
      final.costUsd = rec.result ? rec.result.costUsd : null;
      final.numTurns = rec.result ? rec.result.numTurns : null;
      final.permissionDenials = rec.denials();
    }
    const stateEvent = emit(rec, { type: 'state', state }, { deliver: false, internal: true });
    const endEvent = emit(rec, { type: 'end', state, exitCode: final.exitCode, durationMs }, { deliver: false, internal: true });
    try {
      await store.flush(rec.meta.runId);
      await store.updateMeta(rec.meta.projectId, rec.meta.runId, final);
    } catch (err) {
      console.error('[panel] No se pudo guardar el final del run:', err && err.message ? err.message : err);
    }
    Object.assign(rec.meta, final);
    rec.finished = true;
    for (const fn of rec.subscribers) {
      fn(stateEvent);
      fn(endEvent);
    }
    rec.subscribers.clear();
    records.delete(rec.meta.runId);
    await audit.write({ ...rec.auditContext, projectId: rec.meta.projectId, action: 'run.end', result: state === 'succeeded' ? 'ok' : 'error', runId: rec.meta.runId, detail: { state } });
    try {
      await store.rotate(rec.meta.projectId, liveRecords().filter((r) => r.meta.projectId === rec.meta.projectId).map((r) => r.meta.runId));
    } catch (err) {
      console.error('[panel] No se pudo rotar el historial de runs:', err && err.message ? err.message : err);
    }
    rec.resolveDone(copy(rec.meta));
    return rec.done;
  }

  async function persistNew(rec) {
    try {
      await store.create(copy(rec.meta));
    } catch (err) {
      records.delete(rec.meta.runId);
      throw err;
    }
  }

  function handleClaudeEvent(rec, event) {
    if (event.type === 'session' && event.sessionId) rec.claudeSessionId = event.sessionId;
    if (event.type === 'result') {
      rec.result = event;
      if (event.sessionId) rec.claudeSessionId = event.sessionId;
    }
    emit(rec, event);
  }

  /**
   * Envía el prompt por stdin (UTF-8) y lo cierra. Un EPIPE (el proceso ya salió o no llegó a arrancar) u otro
   * error de stdin no tumba el panel: el resultado del run lo decide la salida del proceso.
   */
  function writePrompt(child, prompt) {
    if (!child.stdin) return;
    child.stdin.on('error', (err) => {
      if (err && err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
        console.error('[panel] No se pudo enviar el mensaje a Claude Code:', err.code || err.message);
      }
    });
    child.stdin.end(String(prompt), 'utf8');
  }

  function launchClaude(rec, { file, prefixArgs, args, prompt }) {
    const mapper = createStreamMapper({ cwd: rec.cwd });
    rec.denials = () => mapper.denials();
    let child;
    try {
      // stdin en 'pipe' solo para Claude: el prompt va por ahí (nunca en argv). Los comandos siguen con 'ignore'.
      child = spawnImpl(file, [...prefixArgs, ...args], spawnOptions(rec.cwd, {}, { stdin: 'pipe' }));
    } catch (err) {
      rec.launchError = `No se pudo ejecutar Claude Code: ${err && (err.code || err.message)}`;
      emit(rec, { type: 'error', message: rec.launchError });
      finalize(rec);
      return;
    }
    rec.child = child;
    writePrompt(child, prompt);
    startTimer(rec);
    let spawned = false;
    child.once('spawn', () => {
      spawned = true;
      if (!rec.finishing && rec.meta.state === 'queued') setState(rec, 'running');
    });
    const done = waitForChild(child);
    rec.splitters = pipeOutput(child, {
      maxLineBytes,
      emit: (ev) => emit(rec, ev),
      onDiscard: () => emit(rec, { type: 'notice', message: NOTICES.lineDiscarded }),
      onLine: (stream, line) => {
        if (stream === 'stderr') emit(rec, outputEvent('stderr', line));
        else for (const ev of mapper.push(line)) handleClaudeEvent(rec, ev);
      },
    });
    done.then(({ code, error }) => {
      if (error && !spawned) {
        rec.launchError = `No se pudo ejecutar Claude Code: ${error.code || error.message}`;
        emit(rec, { type: 'error', message: rec.launchError });
      }
      rec.exitCode = code;
      return finalize(rec);
    });
  }

  /**
   * Lanza un run de Claude. → { ok: true, meta } | { ok: false, status, error, runId? }.
   * `session` = { mode: 'new'|'continue'|'resume', id? }; `claudeCommand` = { file, prefixArgs }.
   */
  async function startClaude({ project, prompt, session, action = 'chat', label = 'Chat', allowedCommands = [], claudeCommand, auditContext }) {
    const limit = checkLimits(project.id);
    if (limit) return limit;
    const args = buildClaudeArgs({ session, allowedCommands });
    const meta = baseMeta({
      projectId: project.id,
      kind: 'claude',
      action,
      label,
      promptPreview: clipPreview(prompt),
      command: null,
      session: { mode: session.mode, id: session.mode === 'resume' ? session.id : null },
    });
    const rec = register(meta, { cwd: project.dir, auditContext });
    await persistNew(rec);
    emit(rec, { type: 'prompt', text: String(prompt) });
    emit(rec, { type: 'state', state: 'queued' });
    launchClaude(rec, { file: claudeCommand.file, prefixArgs: claudeCommand.prefixArgs || [], args, prompt });
    return { ok: true, meta: copy(rec.meta) };
  }

  /** Lanza un run de comando (tests o commit y push) con sus pasos en serie. */
  async function startCommand({ project, steps, action, label, commandLabel, auditContext }) {
    const limit = checkLimits(project.id);
    if (limit) return limit;
    const meta = baseMeta({ projectId: project.id, kind: 'command', action, label, promptPreview: null, command: commandLabel, session: null });
    const rec = register(meta, { cwd: project.dir, auditContext });
    await persistNew(rec);
    emit(rec, { type: 'state', state: 'queued' });
    startTimer(rec);
    setState(rec, 'running');
    runSteps(steps, {
      maxLineBytes,
      emit: (ev) => emit(rec, ev),
      onDiscard: () => emit(rec, { type: 'notice', message: NOTICES.lineDiscarded }),
      isStopped: () => rec.cancelRequested || rec.timedOut,
      spawnStep: (step) => {
        const child = spawnImpl(step.file, [...(step.prefixArgs || []), ...step.args], spawnOptions(rec.cwd, step.env || {}));
        rec.child = child;
        return child;
      },
    }).then(({ exitCode, error }) => {
      if (error) {
        rec.launchError = error;
        emit(rec, { type: 'error', message: error });
      }
      rec.exitCode = exitCode;
      return finalize(rec);
    }, (err) => {
      rec.launchError = `No se pudo ejecutar el comando: ${err && (err.code || err.message)}`;
      emit(rec, { type: 'error', message: rec.launchError });
      return finalize(rec);
    });
    return { ok: true, meta: copy(rec.meta) };
  }

  /** Cancela un run activo: null si no está activo (terminado o inexistente). */
  function cancel(runId) {
    const rec = records.get(runId);
    if (!rec || rec.finishing) return null;
    rec.cancelRequested = true;
    stopProcess(rec);
    return copy(rec.meta);
  }

  /** Registro en memoria de un run activo: { meta, events } o null. */
  function get(runId) {
    const rec = records.get(runId);
    return rec ? { meta: copy(rec.meta), events: rec.events.slice() } : null;
  }

  /**
   * Eventos con seq > afterSeq y suscripción a los siguientes. Devuelve null si el run no está en memoria; si no,
   * { events, unsubscribe, ended } (ended: ya se produjo el evento end).
   */
  function subscribe(runId, afterSeq, fn) {
    const rec = records.get(runId);
    if (!rec) return null;
    const events = rec.events.filter((e) => e.seq > afterSeq);
    const ended = rec.events.some((e) => e.type === 'end');
    if (!ended) rec.subscribers.add(fn);
    return { events, ended, unsubscribe: () => rec.subscribers.delete(fn) };
  }

  /** Cancela todos los runs activos (cierre del servidor o señal). Devuelve una promesa que espera a su cierre. */
  function cancelAll() {
    const pending = liveRecords().map((rec) => {
      cancel(rec.meta.runId);
      return rec.done;
    });
    return Promise.all(pending);
  }

  return { startClaude, startCommand, cancel, get, subscribe, activeFor, activeCount, cancelAll };
}
