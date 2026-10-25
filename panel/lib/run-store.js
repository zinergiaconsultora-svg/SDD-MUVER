// Historial de runs en disco (design.md §3.4 y §5.5):
//   <datos>/runs/<projectId>/index.json      { version: 1, runs: [RunMeta, …] } (más reciente primero; .tmp + rename)
//   <datos>/runs/<projectId>/<runId>.jsonl   una línea JSON por evento
// Las escrituras del índice de un proyecto pasan por una cola de promesas; las de cada .jsonl, por otra por run.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ID_PATTERN } from './registry.js';

export const RUN_ID_RE = /^[a-z0-9]{6,12}-[0-9a-f]{8}$/;
export const DEFAULT_KEEP_RUNS = 200;
export const DEFAULT_LIST_LIMIT = 50;
export const ORPHAN_ERROR = 'Interrumpida al reiniciar el panel';
const ACTIVE_STATES = new Set(['queued', 'running']);

/** Id de run: base 36 del instante + "-" + 8 hex aleatorios. */
export function newRunId(now = Date.now) {
  return `${Number(now()).toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

export function createRunStore({ dataDir, now = Date.now, keepRuns = DEFAULT_KEEP_RUNS } = {}) {
  if (!dataDir) throw new Error('createRunStore: falta dataDir');
  const runsDir = path.join(dataDir, 'runs');
  const projectQueues = new Map();
  const runQueues = new Map();

  function projectDir(projectId) {
    if (typeof projectId !== 'string' || !ID_PATTERN.test(projectId)) throw new Error('Id de proyecto no válido para el historial');
    return path.join(runsDir, projectId);
  }

  function indexFile(projectId) {
    return path.join(projectDir(projectId), 'index.json');
  }

  function eventsFile(projectId, runId) {
    if (!RUN_ID_RE.test(String(runId))) throw new Error('Id de run no válido');
    return path.join(projectDir(projectId), `${runId}.jsonl`);
  }

  function enqueue(map, key, task) {
    const previous = map.get(key) || Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => {});
    map.set(key, settled);
    settled.then(() => {
      if (map.get(key) === settled) map.delete(key);
    });
    return next;
  }

  async function readIndex(projectId) {
    let raw;
    try {
      raw = await fs.readFile(indexFile(projectId), 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw err;
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed && parsed.runs) ? parsed.runs.filter((m) => m && typeof m === 'object' && RUN_ID_RE.test(String(m.runId))) : [];
    } catch {
      console.error('[panel] index.json de runs ilegible, se ignora:', projectId);
      return [];
    }
  }

  async function writeIndex(projectId, runs) {
    const file = indexFile(projectId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, runs }, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
  }

  async function projectIds() {
    let entries;
    try {
      entries = await fs.readdir(runsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((e) => e.isDirectory() && ID_PATTERN.test(e.name)).map((e) => e.name).sort();
  }

  return {
    async create(meta) {
      const projectId = meta.projectId;
      projectDir(projectId);
      return enqueue(projectQueues, projectId, async () => {
        await fs.mkdir(projectDir(projectId), { recursive: true });
        const runs = await readIndex(projectId);
        await writeIndex(projectId, [{ ...meta }, ...runs.filter((m) => m.runId !== meta.runId)]);
      });
    },

    appendEvent(projectId, runId, event) {
      const file = eventsFile(projectId, runId);
      return enqueue(runQueues, runId, async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, JSON.stringify(event) + '\n', 'utf8');
      });
    },

    /** Espera a que terminen las escrituras pendientes del .jsonl de un run. */
    flush(runId) {
      return (runQueues.get(runId) || Promise.resolve()).then(() => {});
    },

    updateMeta(projectId, runId, patch) {
      return enqueue(projectQueues, projectId, async () => {
        const runs = await readIndex(projectId);
        const index = runs.findIndex((m) => m.runId === runId);
        if (index < 0) return null;
        runs[index] = { ...runs[index], ...patch };
        await writeIndex(projectId, runs);
        return runs[index];
      });
    },

    async list(projectId, limit = DEFAULT_LIST_LIMIT) {
      return (await readIndex(projectId)).slice(0, limit);
    },

    async find(runId) {
      if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) return null;
      for (const projectId of await projectIds()) {
        const meta = (await readIndex(projectId)).find((m) => m.runId === runId);
        if (meta) return { projectId, meta };
      }
      return null;
    },

    async readEvents(projectId, runId) {
      let raw;
      try {
        raw = await fs.readFile(eventsFile(projectId, runId), 'utf8');
      } catch (err) {
        if (err && err.code === 'ENOENT') return [];
        throw err;
      }
      const events = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev && typeof ev === 'object') events.push(ev);
        } catch {
          // línea incompleta o rota: se ignora
        }
      }
      return events;
    },

    async recoverOrphans() {
      let recovered = 0;
      const endedAt = new Date(now()).toISOString();
      for (const projectId of await projectIds()) {
        await enqueue(projectQueues, projectId, async () => {
          const runs = await readIndex(projectId);
          let changed = false;
          for (const m of runs) {
            if (ACTIVE_STATES.has(m.state)) {
              m.state = 'failed';
              m.error = ORPHAN_ERROR;
              m.endedAt = endedAt;
              changed = true;
              recovered += 1;
            }
          }
          if (changed) await writeIndex(projectId, runs);
        });
      }
      return recovered;
    },

    rotate(projectId, activeIds = []) {
      const active = new Set(activeIds);
      return enqueue(projectQueues, projectId, async () => {
        const runs = await readIndex(projectId);
        if (runs.length <= keepRuns) return;
        const kept = [];
        const removed = [];
        runs.forEach((m, i) => (i < keepRuns || active.has(m.runId) ? kept : removed).push(m));
        for (const m of removed) {
          try {
            await fs.rm(eventsFile(projectId, m.runId), { force: true });
          } catch (err) {
            console.error('[panel] No se pudo borrar el historial de un run antiguo:', err && err.message ? err.message : err);
          }
        }
        await writeIndex(projectId, kept);
      });
    },

    async listAll() {
      const all = [];
      for (const projectId of await projectIds()) all.push(...(await readIndex(projectId)));
      return all;
    },
  };
}
