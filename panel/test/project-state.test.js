// Tests de lib/project-state.js — R1, R2, R5, R6, R7, R8, R11, R13, R14, R15, R16
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  readFeatureList,
  readProgress,
  detectBlock,
  computeStatus,
  INACTIVE_AFTER_MS,
  buildSummary,
  buildDetail,
} from '../lib/project-state.js';
import { makeProjectDir, makeTempDir, hasGit, removeDir } from './helpers.js';

const gitAvailable = await hasGit();
const skipNoGit = gitAvailable ? false : 'git no está disponible en este sistema';

const FOUR_FEATURES = {
  features: [
    { id: 1, slug: 'uno', description: 'Pendiente', status: 'pending', sdd: true },
    { id: 2, slug: 'dos', description: 'Spec lista', status: 'spec_ready', sdd: true },
    { id: 3, slug: 'tres', description: 'En curso', status: 'in_progress', sdd: true },
    { id: 4, slug: 'cuatro', description: 'Hecha', status: 'done', sdd: false },
    { id: 5, slug: 'cinco', description: 'Estado raro', status: 'desconocido', sdd: true },
  ],
};

const BLOCK_LINE = (value) => `# Progreso actual\n\n- **Feature en curso:** #1\n- **Bloqueos / esperando:** ${value}\n\n## Notas\n`;

// ---------- readFeatureList (R5, R6, R7) ----------

test('[R5] readFeatureList cuenta estados y detecta inProgress/awaitingApproval', async () => {
  const dir = await makeProjectDir({ featureList: FOUR_FEATURES });
  const sdd = await readFeatureList(dir);
  assert.equal(sdd.present, true);
  assert.equal(sdd.error, null);
  assert.deepEqual(sdd.counts, { pending: 1, spec_ready: 1, in_progress: 1, done: 1 });
  assert.deepEqual(sdd.inProgress, { id: 3, slug: 'tres', description: 'En curso' });
  assert.deepEqual(sdd.awaitingApproval, [{ id: 2, slug: 'dos' }]);
  assert.equal(sdd.features.length, 5);
  await removeDir(dir);
});

test('[R6] readFeatureList sin fichero → present false', async () => {
  const dir = await makeTempDir();
  const sdd = await readFeatureList(dir);
  assert.deepEqual(sdd, { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [], features: [] });
  await removeDir(dir);
});

test('[R7] readFeatureList con JSON roto → present true + error', async () => {
  const dir = await makeProjectDir({ featureList: '{ esto no es json' });
  const sdd = await readFeatureList(dir);
  assert.equal(sdd.present, true);
  assert.equal(typeof sdd.error, 'string');
  assert.ok(sdd.error.length > 0);
  assert.equal(sdd.counts, null);
  assert.equal(sdd.inProgress, null);
  assert.deepEqual(sdd.awaitingApproval, []);
  await removeDir(dir);
});

test('[R7] readFeatureList sin array features → present true + error', async () => {
  const dir = await makeProjectDir({ featureList: { otra: 'cosa' } });
  const sdd = await readFeatureList(dir);
  assert.equal(sdd.present, true);
  assert.equal(typeof sdd.error, 'string');
  assert.equal(sdd.counts, null);
  await removeDir(dir);
});

// ---------- detectBlock / readProgress (R8) ----------

test('[R8] detectBlock: valor "—" no bloquea', () => {
  assert.deepEqual(detectBlock(BLOCK_LINE('—')), { blocked: false, blockReason: null });
});

test('[R8] detectBlock: valor vacío no bloquea', () => {
  assert.deepEqual(detectBlock(BLOCK_LINE('')), { blocked: false, blockReason: null });
  assert.deepEqual(detectBlock(BLOCK_LINE('ninguno')), { blocked: false, blockReason: null });
  assert.deepEqual(detectBlock(BLOCK_LINE('(Ninguno)')), { blocked: false, blockReason: null });
});

test('[R8] detectBlock: texto de bloqueo bloquea con blockReason', () => {
  assert.deepEqual(detectBlock(BLOCK_LINE('esperando aprobación de tests')), {
    blocked: true,
    blockReason: 'esperando aprobación de tests',
  });
});

test('[R8] detectBlock: sin la línea de bloqueos no bloquea', () => {
  assert.deepEqual(detectBlock('# Progreso\n\nnada relevante\n'), { blocked: false, blockReason: null });
});

test('[R8] readProgress con fichero y con BOM', async () => {
  const dir = await makeProjectDir({ currentMd: '﻿' + BLOCK_LINE('esperando al humano') });
  const progress = await readProgress(dir, { detail: true });
  assert.equal(progress.present, true);
  assert.equal(progress.blocked, true);
  assert.equal(progress.blockReason, 'esperando al humano');
  assert.ok(progress.text.startsWith('# Progreso actual'), 'el texto no debe empezar por BOM');
  await removeDir(dir);
});

test('[R8] readProgress sin fichero → present false', async () => {
  const dir = await makeTempDir();
  assert.deepEqual(await readProgress(dir, { detail: true }), { present: false, blocked: false, blockReason: null, text: null });
  assert.deepEqual(await readProgress(dir), { present: false, blocked: false, blockReason: null });
  await removeDir(dir);
});

// ---------- computeStatus (R13–R16) ----------

const NOW = Date.parse('2026-10-25T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function state({ exists = true, awaiting = [], inProgress = null, blocked = false, isRepo = true, lastCommitAgo = DAY } = {}) {
  return {
    exists,
    sdd: { present: true, error: null, counts: null, inProgress, awaitingApproval: awaiting },
    progress: { present: true, blocked, blockReason: blocked ? 'algo' : null },
    git: {
      isRepo,
      branch: isRepo ? 'main' : null,
      lastCommit: isRepo && lastCommitAgo !== null ? { hash: 'x', date: iso(lastCommitAgo), message: 'm' } : null,
      dirtyCount: isRepo ? 0 : null,
    },
  };
}

test('[R13] atencion: solo spec_ready', () => {
  assert.equal(computeStatus(state({ awaiting: [{ id: 1, slug: 'a' }] }), NOW), 'atencion');
});

test('[R13] atencion: solo bloqueo', () => {
  assert.equal(computeStatus(state({ blocked: true }), NOW), 'atencion');
});

test('[R13] atencion tiene prioridad sobre en_curso y commit reciente', () => {
  const s = state({ awaiting: [{ id: 1, slug: 'a' }], inProgress: { id: 2, slug: 'b', description: 'c' }, lastCommitAgo: 60_000 });
  assert.equal(computeStatus(s, NOW), 'atencion');
});

test('[R14] en_curso gana a inactivo (commit de hace 30 días)', () => {
  const s = state({ inProgress: { id: 2, slug: 'b', description: 'c' }, lastCommitAgo: 30 * DAY });
  assert.equal(computeStatus(s, NOW), 'en_curso');
});

test('[R15] inactivo a 15 días; ok a 14 días exactos y a 13 días', () => {
  assert.equal(INACTIVE_AFTER_MS, 14 * DAY);
  assert.equal(computeStatus(state({ lastCommitAgo: 15 * DAY }), NOW), 'inactivo');
  assert.equal(computeStatus(state({ lastCommitAgo: 14 * DAY }), NOW), 'ok');
  assert.equal(computeStatus(state({ lastCommitAgo: 13 * DAY }), NOW), 'ok');
});

test('[R16] ok sin arnés y sin git', () => {
  const s = state({ isRepo: false });
  s.sdd = { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [] };
  s.progress = { present: false, blocked: false, blockReason: null };
  assert.equal(computeStatus(s, NOW), 'ok');
});

test('[R16] ok con arnés todo done y commit de ayer', () => {
  const s = state({ lastCommitAgo: DAY });
  s.sdd.counts = { pending: 0, spec_ready: 0, in_progress: 0, done: 3 };
  assert.equal(computeStatus(s, NOW), 'ok');
});

test('[R16] ok en repo sin commits', () => {
  assert.equal(computeStatus(state({ lastCommitAgo: null }), NOW), 'ok');
});

test('[R11] computeStatus: !exists → no_encontrado con prioridad absoluta', () => {
  assert.equal(computeStatus(state({ exists: false, awaiting: [{ id: 1, slug: 'a' }] }), NOW), 'no_encontrado');
});

// ---------- buildSummary / buildDetail (R1, R2, R6, R11) ----------

const SUMMARY_KEYS = ['id', 'name', 'appUrl', 'repoUrl', 'tags', 'exists', 'status', 'sdd', 'progress', 'git'];

test('[R1][R2] buildSummary/buildDetail de un proyecto completo respetan el contrato y no exponen path', { skip: skipNoGit }, async () => {
  const dir = await makeProjectDir({
    featureList: FOUR_FEATURES,
    currentMd: BLOCK_LINE('—'),
    git: { commits: ['Uno', 'Dos'], dirtyFile: 'sucio.txt' },
  });
  const project = { id: 'p1', name: 'Proyecto 1', path: dir, appUrl: 'http://localhost:3000', repoUrl: 'https://example.test/r', tags: ['web'] };

  const summary = await buildSummary(project, { now: () => NOW });
  assert.deepEqual(Object.keys(summary).sort(), [...SUMMARY_KEYS].sort());
  assert.equal('path' in summary, false);
  assert.equal(summary.exists, true);
  assert.equal(summary.status, 'atencion');
  assert.deepEqual(Object.keys(summary.sdd).sort(), ['awaitingApproval', 'counts', 'error', 'inProgress', 'present'].sort());
  assert.deepEqual(Object.keys(summary.progress).sort(), ['blockReason', 'blocked', 'present'].sort());
  assert.deepEqual(Object.keys(summary.git).sort(), ['branch', 'dirtyCount', 'isRepo', 'lastCommit'].sort());
  assert.equal(summary.git.branch, 'main');
  assert.equal(summary.git.dirtyCount, 1);
  assert.equal(summary.git.lastCommit.message, 'Dos');

  const detail = await buildDetail(project, { now: () => NOW });
  assert.equal('path' in detail, false);
  assert.equal(detail.sdd.features.length, 5);
  assert.ok(detail.progress.text.includes('Bloqueos / esperando'));
  assert.equal(detail.git.recentCommits.length, 2);
  assert.deepEqual(detail.git.dirtyFiles, ['sucio.txt']);
  await removeDir(dir);
});

test('[R6] buildSummary sobre directorio vacío → sdd.present false y status ok', async () => {
  const dir = await makeTempDir();
  const summary = await buildSummary({ id: 'v', name: 'Vacío', path: dir, appUrl: '', repoUrl: '', tags: [] }, { now: () => NOW });
  assert.equal(summary.exists, true);
  assert.deepEqual(summary.sdd, { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [] });
  assert.deepEqual(summary.progress, { present: false, blocked: false, blockReason: null });
  assert.equal(summary.status, 'ok');
  await removeDir(dir);
});

test('[R7] buildSummary con feature_list.json roto no lanza y calcula el semáforo', async () => {
  const dir = await makeProjectDir({ featureList: '{ esto no es json' });
  const summary = await buildSummary({ id: 'r', name: 'Roto', path: dir, appUrl: '', repoUrl: '', tags: [] }, { now: () => NOW, runner: failingRunner });
  assert.equal(summary.sdd.present, true);
  assert.equal(typeof summary.sdd.error, 'string');
  assert.equal(summary.status, 'ok');
  await removeDir(dir);
});

async function failingRunner() {
  const err = new Error('spawn git ENOENT');
  err.code = 'ENOENT';
  throw err;
}

test('[R11] buildSummary con ruta inexistente → no_encontrado y runner nunca invocado', async () => {
  const base = await makeTempDir();
  const missing = path.join(base, 'no-existe');
  let runnerCalls = 0;
  const runner = async () => {
    runnerCalls++;
    assert.fail('el runner no debe invocarse para una ruta inexistente');
  };
  const summary = await buildSummary({ id: 'x', name: 'X', path: missing, appUrl: '', repoUrl: '', tags: [] }, { now: () => NOW, runner });
  assert.equal(summary.exists, false);
  assert.equal(summary.status, 'no_encontrado');
  assert.equal(summary.sdd.present, false);
  assert.equal(summary.progress.present, false);
  assert.equal(summary.git.isRepo, false);
  assert.equal(runnerCalls, 0);

  const file = path.join(base, 'fichero.txt');
  await fs.writeFile(file, 'x');
  const detail = await buildDetail({ id: 'y', name: 'Y', path: file, appUrl: '', repoUrl: '', tags: [] }, { now: () => NOW, runner });
  assert.equal(detail.exists, false);
  assert.equal(detail.status, 'no_encontrado');
  assert.deepEqual(detail.sdd.features, []);
  assert.equal(detail.progress.text, null);
  assert.deepEqual(detail.git.recentCommits, []);
  assert.deepEqual(detail.git.dirtyFiles, []);
  assert.equal(runnerCalls, 0);
  await removeDir(base);
});
