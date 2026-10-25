// Generación de resúmenes con Claude Code en SOLO LECTURA (feature 13, design.md §5.5): ruta individual, lote en el
// servidor (de uno en uno), estado y cancelación. Reutiliza el gestor de runs de la fase 4 a través de
// workApi.startReadOnlyClaude (resolvedor de confianza + guardedSpawn de la feature 14, modelo Haiku, Read/Glob/Grep)
// y su puerta de ejecución (gateExec). No resuelve ejecutables ni lanza procesos por su cuenta. El texto devuelto se
// normaliza a UNA frase de como mucho 140 caracteres, cortada en límite de palabra y sin «…».
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { toOneSentence } from './project-summary.js';
import { findMerged } from './project-catalog.js';
import { saveRegistry, upsertSettings, storedSummaryOf, SETTINGS_ERRORS, ID_PATTERN } from './registry.js';
import { sendJson, readJsonBody, getClientIp } from './http-utils.js';
import { isTunnelRequest } from './reauth.js';
import { WORK_ERRORS } from './work-api.js';

export const SUMMARY_PROMPT = 'Lee este proyecto (README, package.json, CLAUDE.md y la estructura de carpetas) sin modificar nada. ' +
  'Responde SOLO con una frase en español de como máximo 140 caracteres que explique qué hace el proyecto y para quién. ' +
  'Sin comillas, sin Markdown y sin ningún otro texto.';
export const GENERATED_MAX_CHARS = 140;
export const BATCH_MAX = 50;

const QUOTE_PAIRS = Object.freeze([['"', '"'], ["'", "'"], ['«', '»'], ['“', '”']]);

/** Quita comillas envolventes (también anidadas). */
function stripQuotes(text) {
  let value = text.trim();
  for (let changed = true; changed;) {
    changed = false;
    for (const [open, close] of QUOTE_PAIRS) {
      if (value.length >= open.length + close.length && value.startsWith(open) && value.endsWith(close)) {
        value = value.slice(open.length, value.length - close.length).trim();
        changed = true;
      }
    }
  }
  return value;
}

/**
 * Texto devuelto por Claude → una frase (≤ 140 en palabra entera, sin «…») o null: sin vallas de código, primera
 * línea con contenido, sin viñeta, sin Markdown, sin prefijo "Resumen:" y sin comillas envolventes.
 */
export function normalizeGeneratedSummary(text) {
  if (typeof text !== 'string') return null;
  const line = text.split(/\r?\n/).filter((l) => !/^\s*```/.test(l)).find((l) => l.trim() !== '');
  if (line === undefined) return null;
  let value = line.trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
    .replace(/^resumen\s*:\s*/i, '');
  value = stripQuotes(value).replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return toOneSentence(value, GENERATED_MAX_CHARS);
}

// ---------- API (design.md §4.1, §5.5) ----------

export const SUMMARY_ERRORS = Object.freeze({
  summaryNotText: SETTINGS_ERRORS.summaryNotText,
  summaryTooLong: SETTINGS_ERRORS.summaryTooLong,
  batchIdsInvalid: 'Indica entre 1 y 50 proyectos',
  batchActive: 'Ya hay una generación de resúmenes en marcha',
  noBatch: 'No hay ninguna generación de resúmenes en marcha',
  invalidResult: 'Claude no devolvió un resumen válido',
  runEnded: (state) => `La ejecución terminó en estado ${state}`,
  noSlot: 'Sin hueco para ejecutar durante 10 minutos',
  manualKept: 'Se conserva el resumen escrito a mano',
});

const GENERATE_ROUTE = /^\/api\/projects\/([^/]+)\/summary\/generate$/;
const ITEM_STATES = Object.freeze(['queued', 'running', 'saved', 'failed', 'skipped', 'cancelled']);

/** Ids del lote sin duplicados (en orden) o null si la lista no es válida (1–50 textos con formato de id). */
export function validateBatchIds(ids) {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && ID_PATTERN.test(id))) return null;
  const unique = [...new Set(ids)];
  return unique.length >= 1 && unique.length <= BATCH_MAX ? unique : null;
}

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

/** Carpeta del proyecto (del catálogo, nunca del cliente) si existe en este PC; si no, null. */
async function projectDir(merged) {
  if (!merged || merged.unresolved || typeof merged.path !== 'string' || !merged.path) return null;
  const dir = path.resolve(merged.path);
  return (await isDirectory(dir)) ? dir : null;
}

function defaultEntry(merged) {
  return { id: merged.id, name: merged.name, path: merged.path, appUrl: '', repoUrl: '', tags: [], hidden: false, pinned: false };
}

/**
 * Rutas de resúmenes con Claude: createSummaryApi(deps) → { route, currentBatch, close, afterRun, saveGenerated }.
 * Usa workApi.gateExec, workApi.startReadOnlyClaude, workApi.runs y workApi.store.
 */
export function createSummaryApi({
  projectsFile,
  loadSources,
  workApi,
  audit = { write: async () => {} },
  now = Date.now,
  retryDelayMs = 5000,
  retryMaxMs = 600000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  trustProxy = true,
} = {}) {
  if (!projectsFile || !loadSources || !workApi) throw new Error('createSummaryApi: faltan dependencias');
  const { runs, store } = workApi;
  let writeQueue = Promise.resolve();
  let batch = null; // último lote (solo en memoria)
  const iso = () => new Date(now()).toISOString();

  async function readBody(req, res) {
    try {
      return await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.error || 'Cuerpo JSON inválido' });
      return null;
    }
  }

  /** Último evento result del run (de disco). */
  async function lastResult(meta) {
    const events = await store.readEvents(meta.projectId, meta.runId);
    return events.filter((e) => e && e.type === 'result').at(-1) || null;
  }

  /**
   * Guarda el resumen generado (serializado en una cola propia; relee el registro justo antes de escribir). No pisa un
   * resumen manual guardado después de empezar el run (R16). → { state: 'saved', error: null | manualKept }.
   */
  function saveGenerated(id, text, startedAt) {
    const task = writeQueue.then(async () => {
      const sources = await loadSources();
      const merged = findMerged(sources, id);
      if (!merged || merged.unresolved || !merged.path) return { state: 'failed', error: WORK_ERRORS.projectNotFound };
      const entry = merged.settingsEntry ?? defaultEntry(merged);
      const stored = storedSummaryOf(entry);
      if (stored && stored.summarySource === 'manual' && stored.summaryAt && Date.parse(stored.summaryAt) >= Date.parse(startedAt)) {
        return { state: 'saved', error: SUMMARY_ERRORS.manualKept };
      }
      const next = { ...entry, summary: text, summarySource: 'claude', summaryAt: new Date(now()).toISOString() };
      await saveRegistry(projectsFile, upsertSettings(sources.registry, next));
      return { state: 'saved', error: null };
    });
    writeQueue = task.catch(() => {});
    return task;
  }

  /** Espera el final del run y guarda el resumen si es válido. → { state: 'saved'|'failed'|'cancelled', error }. */
  async function afterRun(meta) {
    try {
      let final = runs.waitFor(meta.runId);
      final = final ? await final : null;
      if (!final) {
        const found = await store.find(meta.runId);
        final = found ? found.meta : null;
      }
      if (!final) return { state: 'failed', error: SUMMARY_ERRORS.runEnded('failed') };
      if (final.state === 'cancelled') return { state: 'cancelled', error: SUMMARY_ERRORS.runEnded('cancelled') };
      if (final.state !== 'succeeded') return { state: 'failed', error: SUMMARY_ERRORS.runEnded(final.state) };
      const result = await lastResult(final);
      const text = result && result.ok ? normalizeGeneratedSummary(result.text) : null;
      if (!text) return { state: 'failed', error: SUMMARY_ERRORS.invalidResult };
      return await saveGenerated(final.projectId, text, final.startedAt);
    } catch (err) {
      console.error('[panel] No se pudo guardar el resumen generado:', err && err.message ? err.message : err);
      return { state: 'failed', error: SUMMARY_ERRORS.invalidResult };
    }
  }

  /** Proyecto y carpeta para generar: { merged, dir } o { status, error }. */
  async function target(id) {
    const merged = findMerged(await loadSources(), id);
    if (!merged) return { status: 404, error: WORK_ERRORS.projectNotFound };
    const dir = await projectDir(merged);
    if (!dir) return { status: 409, error: WORK_ERRORS.noDir };
    return { merged, dir };
  }

  function startFor(found, auditContext) {
    return workApi.startReadOnlyClaude({ merged: found.merged, dir: found.dir, prompt: SUMMARY_PROMPT, action: 'summary', label: 'Generar resumen', auditContext });
  }

  // ---------- POST /api/projects/:id/summary/generate ----------

  async function postGenerate(req, res, session, id) {
    // El cuerpo se lee y se ignora: ni prompt ni modelo del cliente.
    if ((await readBody(req, res)) === null) return undefined;
    const ctx = await workApi.gateExec(req, res, session, { projectId: id, action: 'summary.generate' });
    if (!ctx) return undefined;
    const found = await target(id);
    if (found.error) return ctx.respond(res, found.status, { error: found.error });
    const started = await startFor(found, ctx.auditContext);
    if (!started.ok) {
      const body = { error: started.error };
      if (started.runId) body.runId = started.runId;
      return ctx.respond(res, started.status, body);
    }
    await ctx.respond(res, 202, started.meta, { runId: started.meta.runId });
    afterRun(started.meta);
    return undefined;
  }

  // ---------- Lote (design.md §3.6, §5.5) ----------

  /** Estado público del lote (§3.6). */
  function snapshot(b) {
    if (!b) return null;
    const counts = Object.fromEntries(ITEM_STATES.map((st) => [st, 0]));
    for (const item of b.items) counts[item.state] += 1;
    return {
      batchId: b.batchId,
      state: b.state,
      startedAt: b.startedAt,
      endedAt: b.endedAt,
      total: b.items.length,
      counts,
      items: b.items.map((i) => ({ id: i.id, name: i.name, state: i.state, runId: i.runId, error: i.error })),
    };
  }

  /** Arranca el run de un elemento con reintentos mientras falte hueco (429). */
  async function startWithRetry(b, found, auditContext) {
    let waited = 0;
    for (;;) {
      const started = await startFor(found, auditContext);
      if (started.ok || started.status !== 429 || b.cancelRequested || waited >= retryMaxMs) return started;
      await sleep(retryDelayMs);
      waited += retryDelayMs;
      if (b.cancelRequested) return started;
    }
  }

  /** Procesa el lote de uno en uno y en orden; nunca lanza. */
  async function processBatch(b, auditContext) {
    for (const item of b.items) {
      try {
        if (b.cancelRequested) {
          item.state = 'cancelled';
          continue;
        }
        const found = await target(item.id);
        if (found.error) {
          item.state = 'skipped';
          item.error = found.error;
          continue;
        }
        const started = await startWithRetry(b, found, auditContext);
        if (!started.ok) {
          if (b.cancelRequested) item.state = 'cancelled';
          else if (started.status === 429) {
            item.state = 'skipped';
            item.error = SUMMARY_ERRORS.noSlot;
          } else if (started.status === 409) {
            item.state = 'skipped';
            item.error = started.error;
          } else {
            item.state = 'failed';
            item.error = started.error;
          }
          continue;
        }
        item.state = 'running';
        item.runId = started.meta.runId;
        b.currentRunId = started.meta.runId;
        // Cancelación pedida mientras arrancaba: se cancela ya el run recién lanzado.
        if (b.cancelRequested) runs.cancel(item.runId);
        await audit.write({ ...auditContext, projectId: item.id, action: 'summary.generate', result: 'started', runId: item.runId, detail: { batchId: b.batchId } });
        const outcome = await afterRun(started.meta);
        b.currentRunId = null;
        item.state = outcome.state;
        item.error = outcome.error;
      } catch (err) {
        console.error('[panel] Fallo en el lote de resúmenes:', err && err.message ? err.message : err);
        item.state = 'failed';
        item.error = SUMMARY_ERRORS.invalidResult;
      }
    }
    b.state = b.cancelRequested ? 'cancelled' : 'done';
    b.endedAt = iso();
  }

  async function postBatch(req, res, session) {
    const body = await readBody(req, res);
    if (body === null) return undefined;
    const ids = validateBatchIds(body.ids);
    if (!ids) return sendJson(res, 400, { error: SUMMARY_ERRORS.batchIdsInvalid, field: 'ids' });
    if (batch && batch.state === 'running') return sendJson(res, 409, { error: SUMMARY_ERRORS.batchActive });
    const ctx = await workApi.gateExec(req, res, session, { action: 'summary.batch', detail: { count: ids.length } });
    if (!ctx) return undefined;
    // Comprobación repetida tras la puerta (otra petición pudo crear un lote mientras tanto).
    if (batch && batch.state === 'running') return ctx.respond(res, 409, { error: SUMMARY_ERRORS.batchActive });
    const sources = await loadSources();
    const b = {
      batchId: `b-${now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
      state: 'running',
      startedAt: iso(),
      endedAt: null,
      cancelRequested: false,
      currentRunId: null,
      items: ids.map((id) => {
        const merged = findMerged(sources, id);
        return { id, name: merged ? merged.name : id, state: 'queued', runId: null, error: null };
      }),
    };
    batch = b;
    await ctx.respond(res, 202, { batch: snapshot(b) });
    processBatch(b, ctx.auditContext);
    return undefined;
  }

  async function cancelBatch(req, res) {
    if (!batch || batch.state !== 'running') return sendJson(res, 409, { error: SUMMARY_ERRORS.noBatch });
    batch.cancelRequested = true;
    if (batch.currentRunId) runs.cancel(batch.currentRunId);
    await audit.write({ ip: getClientIp(req, { trustProxy }), tunnel: isTunnelRequest(req), projectId: null, action: 'summary.batch.cancel', result: 'ok', status: 202, detail: { batchId: batch.batchId } });
    return sendJson(res, 202, { batch: snapshot(batch) });
  }

  /** Atiende las rutas de resúmenes; devuelve true si la petición era suya. */
  async function route(req, res, url, session) {
    const pathname = url.pathname;
    const method = req.method;
    const match = GENERATE_ROUTE.exec(pathname);
    if (match) {
      const id = decodeSegment(match[1]);
      if (id === null) sendJson(res, 404, { error: WORK_ERRORS.projectNotFound });
      else if (method === 'POST') await postGenerate(req, res, session, id);
      else sendJson(res, 404, { error: WORK_ERRORS.notFound });
      return true;
    }
    if (pathname === '/api/summaries/generate' && method === 'POST') {
      await postBatch(req, res, session);
      return true;
    }
    if (pathname === '/api/summaries/batch' && method === 'GET') {
      sendJson(res, 200, { batch: snapshot(batch) });
      return true;
    }
    if (pathname === '/api/summaries/batch/cancel' && method === 'POST') {
      await cancelBatch(req, res);
      return true;
    }
    return false;
  }

  /** Cierre del servidor: marca la cancelación del lote en marcha (los runs los cancela workApi.close). */
  function close() {
    if (batch && batch.state === 'running') batch.cancelRequested = true;
  }

  return { route, close, afterRun, saveGenerated, currentBatch: () => snapshot(batch) };
}
