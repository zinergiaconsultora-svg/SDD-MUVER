// Tests de lib/run-store.js — F4: R32 (unitario), R34, R35, R37.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createRunStore, newRunId, RUN_ID_RE } from '../lib/run-store.js';
import { makeTempDir, removeDir, makeClock } from './helpers.js';

const T0 = Date.parse('2026-10-25T10:00:00.000Z');

function meta(runId, projectId, extra = {}) {
  return {
    runId,
    projectId,
    kind: 'claude',
    action: 'chat',
    label: 'Chat',
    promptPreview: 'hola',
    command: null,
    session: { mode: 'new', id: null },
    state: 'queued',
    startedAt: new Date(T0).toISOString(),
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
    ...extra,
  };
}

function idFor(n) {
  return `run${String(n).padStart(4, '0')}-${String(n).padStart(8, '0')}`;
}

test('[F4-R34] newRunId cumple RUN_ID_RE y no se repite', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const id = newRunId(() => T0);
    assert.match(id, RUN_ID_RE);
    ids.add(id);
  }
  assert.equal(ids.size, 50);
  for (const bad of ['..%2Fx', '../x', 'ABC-12345678', 'abc-1234567g', '']) assert.equal(RUN_ID_RE.test(bad), false, bad);
});

test('[F4-R34] create + appendEvent + updateMeta + readEvents sobre un directorio temporal', async () => {
  const dataDir = await makeTempDir('muver-store-');
  const store = createRunStore({ dataDir, now: () => T0 });
  const id = idFor(1);
  await store.create(meta(id, 'proyecto-a'));
  await Promise.all([
    store.appendEvent('proyecto-a', id, { seq: 1, at: 'x', type: 'prompt', text: 'hola' }),
    store.appendEvent('proyecto-a', id, { seq: 2, at: 'x', type: 'state', state: 'queued' }),
    store.appendEvent('proyecto-a', id, { seq: 3, at: 'x', type: 'state', state: 'running' }),
  ]);
  const updated = await store.updateMeta('proyecto-a', id, { state: 'running' });
  assert.equal(updated.state, 'running');
  const events = await store.readEvents('proyecto-a', id);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
  assert.equal(events[0].text, 'hola');

  const raw = await fs.readFile(path.join(dataDir, 'runs', 'proyecto-a', `${id}.jsonl`), 'utf8');
  assert.equal(raw.split('\n').filter(Boolean).length, 3);
  const index = JSON.parse(await fs.readFile(path.join(dataDir, 'runs', 'proyecto-a', 'index.json'), 'utf8'));
  assert.equal(index.version, 1);
  assert.equal(index.runs[0].state, 'running');
  const files = await fs.readdir(path.join(dataDir, 'runs', 'proyecto-a'));
  assert.ok(!files.some((f) => f.endsWith('.tmp')), 'sin .tmp residual');

  await fs.appendFile(path.join(dataDir, 'runs', 'proyecto-a', `${id}.jsonl`), '{ roto\n');
  assert.equal((await store.readEvents('proyecto-a', id)).length, 3, 'las líneas rotas se ignoran');
  assert.deepEqual(await store.readEvents('proyecto-a', idFor(99)), []);
  await assert.rejects(store.create(meta(idFor(2), '../fuera')));
  await removeDir(dataDir);
});

test('[F4-R35] list con 60 metas devuelve 50, la más reciente primero', async () => {
  const dataDir = await makeTempDir('muver-store-');
  const store = createRunStore({ dataDir, now: () => T0 });
  for (let i = 1; i <= 60; i++) await store.create(meta(idFor(i), 'p'));
  const list = await store.list('p');
  assert.equal(list.length, 50);
  assert.equal(list[0].runId, idFor(60));
  assert.equal(list[49].runId, idFor(11));
  assert.equal((await store.list('p', 5)).length, 5);
  assert.deepEqual(await store.list('otro'), []);
  await removeDir(dataDir);
});

test('[F4-R36] find con id válido, inexistente y con formato inválido', async () => {
  const dataDir = await makeTempDir('muver-store-');
  const store = createRunStore({ dataDir, now: () => T0 });
  await store.create(meta(idFor(1), 'uno'));
  await store.create(meta(idFor(2), 'dos'));
  const found = await store.find(idFor(2));
  assert.equal(found.projectId, 'dos');
  assert.equal(found.meta.runId, idFor(2));
  assert.equal(await store.find(idFor(3)), null);
  assert.equal(await store.find('../../etc/passwd'), null);
  assert.equal(await store.find('..%2Fx'), null);
  await removeDir(dataDir);
});

test('[F4-R37] rotate con keepRuns: 3 y 5 runs → 3 en el índice y sus 3 .jsonl; nunca borra un activo', async () => {
  const dataDir = await makeTempDir('muver-store-');
  const store = createRunStore({ dataDir, now: () => T0, keepRuns: 3 });
  for (let i = 1; i <= 5; i++) {
    await store.create(meta(idFor(i), 'p'));
    await store.appendEvent('p', idFor(i), { seq: 1, type: 'state', state: 'queued' });
  }
  await store.rotate('p', []);
  const list = await store.list('p');
  assert.deepEqual(list.map((m) => m.runId), [idFor(5), idFor(4), idFor(3)]);
  const files = (await fs.readdir(path.join(dataDir, 'runs', 'p'))).filter((f) => f.endsWith('.jsonl')).sort();
  assert.deepEqual(files, [idFor(3), idFor(4), idFor(5)].map((id) => `${id}.jsonl`));

  for (let i = 6; i <= 7; i++) await store.create(meta(idFor(i), 'p'));
  await store.rotate('p', [idFor(3)]);
  assert.deepEqual((await store.list('p')).map((m) => m.runId), [idFor(7), idFor(6), idFor(5), idFor(3)], 'el activo se conserva');
  await removeDir(dataDir);
});

test('[F4-R32] recoverOrphans marca queued/running como failed con endedAt = ahora', async () => {
  const dataDir = await makeTempDir('muver-store-');
  const clock = makeClock(T0);
  const store = createRunStore({ dataDir, now: clock.now });
  await store.create(meta(idFor(1), 'p', { state: 'succeeded', endedAt: new Date(T0).toISOString() }));
  await store.create(meta(idFor(2), 'p', { state: 'running' }));
  await store.create(meta(idFor(3), 'q', { state: 'queued' }));
  clock.advance(60000);
  const fresh = createRunStore({ dataDir, now: clock.now });
  const recovered = await fresh.recoverOrphans();
  assert.equal(recovered, 2);
  const p = await fresh.list('p');
  assert.equal(p.find((m) => m.runId === idFor(1)).state, 'succeeded');
  const orphan = p.find((m) => m.runId === idFor(2));
  assert.equal(orphan.state, 'failed');
  assert.equal(orphan.error, 'Interrumpida al reiniciar el panel');
  assert.equal(orphan.endedAt, new Date(T0 + 60000).toISOString());
  assert.equal((await fresh.list('q'))[0].state, 'failed');
  assert.equal(await createRunStore({ dataDir: path.join(dataDir, 'no-existe'), now: clock.now }).recoverOrphans(), 0);
  await removeDir(dataDir);
});

test('[F4-R78] listAll devuelve las metas de todos los proyectos', async () => {
  const dataDir = await makeTempDir('muver-store-');
  const store = createRunStore({ dataDir, now: () => T0 });
  await store.create(meta(idFor(1), 'uno'));
  await store.create(meta(idFor(2), 'dos'));
  const all = await store.listAll();
  assert.deepEqual(all.map((m) => m.runId).sort(), [idFor(1), idFor(2)]);
  await removeDir(dataDir);
});
