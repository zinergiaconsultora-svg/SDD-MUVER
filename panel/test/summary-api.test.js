// Tests de integración de la feature 13 (design.md §3–§5, con startApp): resumen en el catálogo, worktrees agrupados,
// modo ligero, PATCH de resumen y modelo, generación de resúmenes en solo lectura (individual y en lote) y "Te
// necesitan". Siempre con el CLI de Claude FALSO (escenario por fichero `.fake-claude-scenario`), claudeHome y datos
// temporales y repos git reales en temporales con `git worktree add`; nunca el `claude` real ni el ~/.claude del equipo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeProjectDir, makeTempDir, writeRegistry, startApp, request, removeDir, hasGit } from './helpers.js';
import { waitForRun, readFakeLog, fileExists, waitFor, tunnelHeaders } from './work-helpers.js';
import { makeRepoWithWorktrees, writeScenario, waitForBatch, waitForRegistry } from './summary-helpers.js';
import { makeClaudeHome, sessionLine, encodeForFixture } from './claude-fixtures.js';
import { defaultRunner } from '../lib/git-info.js';

const PASSWORD = 'contraseña-de-la-feature-13';
const gitAvailable = await hasGit();
const skipNoGit = gitAvailable ? false : 'git no está disponible en este sistema';

const cleanup = [];
const apps = [];
after(async () => {
  for (const app of apps) await app.close();
  for (const dir of cleanup) await removeDir(dir);
});

async function tempDir(prefix) {
  const dir = await makeTempDir(prefix);
  cleanup.push(dir);
  return dir;
}

/** Carpeta de proyecto temporal con ficheros. */
async function projectWith(files = {}) {
  const dir = await makeProjectDir();
  cleanup.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

/** Arranca la app con un registro temporal; devuelve helpers autenticados. */
async function setup({ entries = [], ...options } = {}) {
  const base = await tempDir('muver-f13-api-');
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, entries);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD, ...options });
  apps.push(app);
  cleanup.push(app.dataDir);
  const cookie = await app.login();
  const authed = (urlPath, init = {}) => request(app.baseUrl, urlPath, { cookie, ...init });
  const post = (urlPath, body, init = {}) => authed(urlPath, { method: 'POST', body: JSON.stringify(body ?? {}), ...init });
  const patch = (urlPath, body) => authed(urlPath, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
  const readRegistry = async () => JSON.parse(await fs.readFile(registryFile, 'utf8'));
  return { app, cookie, authed, post, patch, registryFile, readRegistry };
}

const byId = (list, id) => list.find((p) => p.id === id);

/** Runner espía sobre el runner central real: registra (cwd, args) de cada llamada git. */
function spyRunner() {
  const calls = [];
  const runner = (file, args, opts) => {
    calls.push({ file, args: [...args], cwd: opts && opts.cwd });
    return defaultRunner(file, args, opts);
  };
  return { runner, calls };
}

// ======================= Bloque A: resumen y agrupación en el catálogo (R8, R28–R32) =======================

test('[F13-R8] GET /api/projects y /:id incluyen summary, summarySource y summaryAt', async () => {
  const pkgDir = await projectWith({ 'package.json': JSON.stringify({ description: 'Gestor de facturas para autónomos. Con informes.' }) });
  const manualDir = await projectWith({ 'package.json': JSON.stringify({ description: 'No se usa' }) });
  const claudeDir = await projectWith({});
  const goneDir = path.join(await tempDir('muver-f13-gone-'), 'no-existe');
  const { claudeHome } = await makeClaudeHome({
    projects: { [encodeForFixture(claudeDir)]: { s1: [sessionLine({ text: 'hola', timestamp: '2026-10-24T10:00:00.000Z', cwd: claudeDir })] } },
  });
  cleanup.push(claudeHome);
  const { authed } = await setup({
    claudeHome,
    entries: [
      { id: 'pkg', name: 'Pkg', path: pkgDir },
      { id: 'man', name: 'Man', path: manualDir, summary: 'CRM para la consultora', summarySource: 'manual', summaryAt: '2026-10-25T10:00:00.000Z' },
      { id: 'gone', name: 'Gone', path: goneDir },
    ],
  });
  const r = await authed('/api/projects');
  assert.equal(r.status, 200, r.text);
  const pkg = byId(r.json, 'pkg');
  assert.deepEqual([pkg.summary, pkg.summarySource, pkg.summaryAt], ['Gestor de facturas para autónomos.', 'package', null]);
  const man = byId(r.json, 'man');
  assert.deepEqual([man.summary, man.summarySource, man.summaryAt], ['CRM para la consultora', 'manual', '2026-10-25T10:00:00.000Z']);
  const gone = byId(r.json, 'gone');
  assert.deepEqual([gone.summary, gone.summarySource, gone.summaryAt], [null, null, null]);
  const claudeOnly = r.json.find((p) => p.source === 'claude');
  assert.ok(claudeOnly, 'proyecto solo de Claude');
  assert.deepEqual([claudeOnly.summary, claudeOnly.summarySource, claudeOnly.summaryAt], [null, null, null]);
  for (const p of r.json) {
    for (const key of ['summary', 'summarySource', 'summaryAt', 'isWorktree', 'parentId', 'parentName', 'groupKey', 'groupName', 'likelyWorktree', 'worktreeCount', 'detailLevel']) {
      assert.ok(key in p, `${p.id}: falta ${key}`);
    }
    assert.equal(p.detailLevel, 'full');
  }
  const detail = await authed('/api/projects/pkg');
  assert.equal(detail.status, 200);
  assert.deepEqual([detail.json.summary, detail.json.summarySource, detail.json.summaryAt], ['Gestor de facturas para autónomos.', 'package', null]);
  assert.deepEqual(detail.json.worktrees, []);
  const detailMan = await authed('/api/projects/man');
  assert.equal(detailMan.json.summarySource, 'manual');
});

test('[F13-R28] worktrees con su principal en el catálogo: parentId y worktreeCount (sin contar el oculto)', { skip: skipNoGit }, async () => {
  const repo = await makeRepoWithWorktrees(['wt-uno-a1b2c3', 'wt-dos-d4e5f6']);
  cleanup.push(repo.base);
  const { authed } = await setup({
    entries: [
      { id: 'principal', name: 'CRM Principal', path: repo.main },
      { id: 'wt-uno', name: 'wt-uno-a1b2c3', path: repo.worktrees['wt-uno-a1b2c3'] },
      { id: 'wt-dos', name: 'wt-dos-d4e5f6', path: repo.worktrees['wt-dos-d4e5f6'], hidden: true },
    ],
  });
  const r = await authed('/api/projects?includeHidden=1');
  assert.equal(r.status, 200, r.text);
  const main = byId(r.json, 'principal');
  assert.equal(main.isWorktree, false);
  assert.equal(main.parentId, null);
  assert.equal(main.worktreeCount, 1);
  for (const id of ['wt-uno', 'wt-dos']) {
    const wt = byId(r.json, id);
    assert.equal(wt.isWorktree, true, id);
    assert.equal(wt.parentId, 'principal', id);
    assert.equal(wt.parentName, 'CRM Principal', id);
    assert.equal(wt.groupKey, null, id);
    assert.equal(wt.worktreeCount, 0, id);
  }
  const visible = await authed('/api/projects');
  assert.equal(byId(visible.json, 'wt-dos'), undefined, 'el oculto no sale sin includeHidden');
  assert.equal(byId(visible.json, 'principal').worktreeCount, 1);
  assert.ok(!r.text.includes(repo.base), 'sin rutas absolutas');
});

test('[F13-R29] worktrees cuyo principal no está en el catálogo: mismo groupKey y groupName, sin la ruta del principal', { skip: skipNoGit }, async () => {
  const repo = await makeRepoWithWorktrees(['tarea-a-111111', 'tarea-b-222222'], { mainName: 'crm-principal' });
  cleanup.push(repo.base);
  const { authed } = await setup({
    entries: [
      { id: 'tarea-a', name: 'tarea-a-111111', path: repo.worktrees['tarea-a-111111'] },
      { id: 'tarea-b', name: 'tarea-b-222222', path: repo.worktrees['tarea-b-222222'] },
    ],
  });
  const r = await authed('/api/projects');
  const a = byId(r.json, 'tarea-a');
  const b = byId(r.json, 'tarea-b');
  assert.match(a.groupKey, /^g-[0-9a-f]{10}$/);
  assert.equal(a.groupKey, b.groupKey);
  assert.equal(a.groupName, 'crm-principal');
  assert.equal(b.groupName, 'crm-principal');
  assert.equal(a.parentId, null);
  assert.equal(a.isWorktree, true);
  assert.ok(!r.text.includes(repo.main), 'la respuesta no contiene la ruta del principal');
  assert.ok(!r.text.includes(repo.base), 'ni la carpeta que lo contiene');
});

test('[F13-R30] likelyWorktree: carpeta inexistente -hex6 con sesión en claude/<carpeta>', async () => {
  const root = await tempDir('muver-f13-likely-');
  const likely = path.join(root, 'x', 'audit-y-medianoche-41fbca');
  const onMain = path.join(root, 'y', 'otra-tarea-41fbcb');
  const plain = path.join(root, 'z', 'mi-app');
  const session = (cwd, gitBranch) => ({ s1: [sessionLine({ text: 'hola', timestamp: '2026-10-24T10:00:00.000Z', cwd, gitBranch })] });
  const { claudeHome } = await makeClaudeHome({
    projects: {
      [encodeForFixture(likely)]: session(likely, 'claude/audit-y-medianoche-41fbca'),
      [encodeForFixture(onMain)]: session(onMain, 'main'),
      [encodeForFixture(plain)]: session(plain, 'claude/mi-app'),
    },
  });
  cleanup.push(claudeHome);
  const { authed } = await setup({ claudeHome });
  const r = await authed('/api/projects');
  assert.equal(r.status, 200, r.text);
  const yes = byId(r.json, 'audit-y-medianoche-41fbca');
  assert.equal(yes.likelyWorktree, true);
  assert.equal(yes.parentId, null);
  assert.equal(yes.groupKey, null);
  assert.equal(yes.isWorktree, false);
  assert.equal(byId(r.json, 'otra-tarea-41fbcb').likelyWorktree, false);
  assert.equal(byId(r.json, 'mi-app').likelyWorktree, false);
});

test('[F13-R31] modo ligero: sin worktrees=full no se lanza git en los worktrees agrupados; con worktrees=full sí', { skip: skipNoGit }, async () => {
  const repo = await makeRepoWithWorktrees(['wt-uno-a1b2c3', 'wt-dos-d4e5f6']);
  cleanup.push(repo.base);
  const spy = spyRunner();
  const { authed } = await setup({
    runner: spy.runner,
    entries: [
      { id: 'principal', name: 'Principal', path: repo.main },
      { id: 'wt-uno', name: 'wt-uno-a1b2c3', path: repo.worktrees['wt-uno-a1b2c3'] },
      { id: 'wt-dos', name: 'wt-dos-d4e5f6', path: repo.worktrees['wt-dos-d4e5f6'] },
    ],
  });
  const wtDirs = Object.values(repo.worktrees);
  const first = await authed('/api/projects');
  assert.equal(first.status, 200, first.text);
  spy.calls.length = 0;
  const second = await authed('/api/projects');
  const inWorktrees = spy.calls.filter((c) => wtDirs.includes(c.cwd));
  assert.deepEqual(inWorktrees, [], 'ningún git en los worktrees (clasificación en caché)');
  assert.ok(spy.calls.some((c) => c.cwd === repo.main), 'el principal sí se calcula completo');
  for (const id of ['wt-uno', 'wt-dos']) {
    const wt = byId(second.json, id);
    assert.equal(wt.detailLevel, 'light');
    assert.deepEqual(wt.git, { isRepo: true, branch: null, lastCommit: null, dirtyCount: null });
    assert.equal(wt.exists, true);
    assert.equal(wt.status, 'ok');
  }
  assert.equal(byId(second.json, 'principal').detailLevel, 'full');
  spy.calls.length = 0;
  const full = await authed('/api/projects?worktrees=full');
  for (const dir of wtDirs) {
    const calls = spy.calls.filter((c) => c.cwd === dir);
    assert.ok(calls.some((c) => c.args.includes('status')), 'git status de la fase 1 en el worktree');
    assert.ok(calls.every((c) => !c.args.includes('--git-common-dir')), 'la clasificación sigue en caché');
  }
  for (const id of ['wt-uno', 'wt-dos']) {
    const wt = byId(full.json, id);
    assert.equal(wt.detailLevel, 'full');
    assert.equal(wt.git.branch, `claude/${wt.name}`);
  }
});

test('[F13-R32] detalle del principal con worktrees[] (dirtyCount real y oculto marcado) y detalle del worktree con parentName', { skip: skipNoGit }, async () => {
  const repo = await makeRepoWithWorktrees(['wt-uno-a1b2c3', 'wt-dos-d4e5f6']);
  cleanup.push(repo.base);
  await fs.writeFile(path.join(repo.worktrees['wt-uno-a1b2c3'], 'nuevo.txt'), 'sin commitear\n');
  const { authed } = await setup({
    entries: [
      { id: 'principal', name: 'CRM Principal', path: repo.main },
      { id: 'wt-uno', name: 'wt-uno-a1b2c3', path: repo.worktrees['wt-uno-a1b2c3'] },
      { id: 'wt-dos', name: 'wt-dos-d4e5f6', path: repo.worktrees['wt-dos-d4e5f6'], hidden: true },
    ],
  });
  const r = await authed('/api/projects/principal');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.worktreeCount, 1);
  assert.equal(r.json.worktrees.length, 2);
  const [dos, uno] = r.json.worktrees; // sin sesiones: orden por nombre (wt-dos < wt-uno)
  assert.deepEqual(Object.keys(uno).sort(), ['branch', 'dirtyCount', 'exists', 'hidden', 'id', 'lastActivityAt', 'lastSessionAt', 'name', 'status', 'summary'].sort());
  assert.equal(uno.id, 'wt-uno');
  assert.equal(uno.branch, 'claude/wt-uno-a1b2c3');
  assert.equal(uno.dirtyCount, 1);
  assert.equal(uno.hidden, false);
  assert.equal(uno.exists, true);
  assert.equal(uno.lastSessionAt, null);
  assert.equal(uno.summary, 'Repositorio principal de prueba para los worktrees.');
  assert.equal(dos.id, 'wt-dos');
  assert.equal(dos.hidden, true);
  assert.equal(dos.dirtyCount, 0);
  const wt = await authed('/api/projects/wt-uno');
  assert.equal(wt.json.parentId, 'principal');
  assert.equal(wt.json.parentName, 'CRM Principal');
  assert.equal(wt.json.isWorktree, true);
  assert.deepEqual(wt.json.worktrees, []);
  assert.ok(!r.text.includes(repo.base), 'sin rutas absolutas');
});

// ======================= Bloque B: resumen y modelo por PATCH (R9, R10, R57) =======================

const { normalizeSettings, applySummaryChange, applyModelChange, modelOf, storedSummaryOf } = await import('../lib/registry.js');

test('[F13-R9] PATCH summary en un proyecto manual: espacios colapsados, manual y hora actual (sin puerta de ejecución)', async () => {
  const dir = await projectWith({ 'package.json': JSON.stringify({ description: 'Desde package.json.' }) });
  const { patch, readRegistry } = await setup({ allowExec: false, entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  const before = Date.now();
  const r = await patch('/api/projects/proy', { summary: '  CRM   de  clientes\n para la consultora ' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.summary, 'CRM de clientes para la consultora');
  assert.equal(r.json.summarySource, 'manual');
  const at = Date.parse(r.json.summaryAt);
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, 'summaryAt con la hora actual');
  const entry = (await readRegistry()).projects.find((p) => p.id === 'proy');
  assert.equal(entry.summary, 'CRM de clientes para la consultora');
  assert.equal(entry.summarySource, 'manual');
  assert.equal(entry.summaryAt, r.json.summaryAt);
});

test('[F13-R9] PATCH summary en un proyecto solo de Claude crea su entrada en projects.json', async () => {
  const dir = await projectWith({});
  const { claudeHome } = await makeClaudeHome({
    projects: { [encodeForFixture(dir)]: { s1: [sessionLine({ text: 'hola', timestamp: '2026-10-24T10:00:00.000Z', cwd: dir })] } },
  });
  cleanup.push(claudeHome);
  const { authed, patch, readRegistry } = await setup({ claudeHome, allowExec: false });
  const list = await authed('/api/projects');
  const id = list.json[0].id;
  const r = await patch(`/api/projects/${id}`, { summary: 'Proyecto de prueba de Claude' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.summarySource, 'manual');
  const entry = (await readRegistry()).projects.find((p) => p.id === id);
  assert.ok(entry, 'entrada creada');
  assert.equal(entry.summary, 'Proyecto de prueba de Claude');
  assert.equal(entry.path, dir);
});

test('[F13-R10] PATCH summary vacío vuelve al automático; no texto o > 200 → 400 sin escribir; summarySource/summaryAt ignorados', async () => {
  const dir = await projectWith({ 'package.json': JSON.stringify({ description: 'Desde package.json.' }) });
  const { patch, registryFile, readRegistry } = await setup({ entries: [{ id: 'proy', name: 'Proy', path: dir, summary: 'Manual', summarySource: 'manual', summaryAt: '2026-10-25T10:00:00.000Z' }] });
  const cleared = await patch('/api/projects/proy', { summary: '' });
  assert.equal(cleared.status, 200, cleared.text);
  assert.deepEqual([cleared.json.summary, cleared.json.summarySource, cleared.json.summaryAt], ['Desde package.json.', 'package', null]);
  const entry = (await readRegistry()).projects.find((p) => p.id === 'proy');
  for (const key of ['summary', 'summarySource', 'summaryAt']) assert.ok(!(key in entry), `sin ${key}`);
  const raw = await fs.readFile(registryFile);
  const notText = await patch('/api/projects/proy', { summary: 5 });
  assert.equal(notText.status, 400);
  assert.deepEqual(notText.json, { error: 'El resumen debe ser un texto', field: 'summary' });
  const tooLong = await patch('/api/projects/proy', { summary: 'x'.repeat(201) });
  assert.equal(tooLong.status, 400);
  assert.deepEqual(tooLong.json, { error: 'El resumen no puede superar 200 caracteres', field: 'summary' });
  assert.ok((await fs.readFile(registryFile)).equals(raw), 'projects.json sin cambios');
  const ok200 = await patch('/api/projects/proy', { summary: 'y'.repeat(200) });
  assert.equal(ok200.status, 200, '200 caracteres exactos valen');
  const before = Date.now();
  const spoofed = await patch('/api/projects/proy', { summary: 'x', summarySource: 'claude', summaryAt: '2000-01-01' });
  assert.equal(spoofed.status, 200);
  assert.equal(spoofed.json.summarySource, 'manual');
  assert.ok(Date.parse(spoofed.json.summaryAt) >= before - 1000, 'hora actual, no la del cuerpo');
});

test('[F13-R57] PATCH model: válido se recuerda, default lo quita e inválidos → 400 sin escribir', async () => {
  const dir = await projectWith({});
  const { patch, registryFile, readRegistry } = await setup({ entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  const ok = await patch('/api/projects/proy', { model: 'sonnet' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await readRegistry()).projects[0].model, 'sonnet');
  const raw = await fs.readFile(registryFile);
  for (const model of ['gpt-4', 3, 'haiku --verbose', '', null]) {
    const r = await patch('/api/projects/proy', { model });
    if (model === null) continue; // null equivale a no enviar el campo
    assert.equal(r.status, 400, `model ${JSON.stringify(model)}`);
    assert.deepEqual(r.json, { error: 'Modelo no válido: elige Por defecto, Haiku, Sonnet u Opus', field: 'model' });
  }
  assert.ok((await fs.readFile(registryFile)).equals(raw), 'registro sin cambios');
  const back = await patch('/api/projects/proy', { model: 'default' });
  assert.equal(back.status, 200);
  assert.ok(!('model' in (await readRegistry()).projects[0]), 'default quita el campo');
});

test('[F13-R9][F13-R10][F13-R57] normalizeSettings, applySummaryChange, applyModelChange, modelOf y storedSummaryOf', () => {
  const base = { id: 'a', name: 'A', path: '/a' };
  const kept = normalizeSettings({ ...base, summary: 'Hola', summarySource: 'claude', summaryAt: '2026-10-25T10:00:00.000Z', model: 'opus' });
  assert.deepEqual([kept.summary, kept.summarySource, kept.summaryAt, kept.model], ['Hola', 'claude', '2026-10-25T10:00:00.000Z', 'opus']);
  const odd = normalizeSettings({ ...base, summary: 'A mano', summarySource: 'raro' });
  assert.equal(odd.summarySource, 'manual');
  assert.ok(!('summaryAt' in odd));
  for (const bad of [{ summary: '' }, { summary: 5 }, { summary: 'x'.repeat(201) }, { summarySource: 'manual', summaryAt: 'x' }]) {
    const n = normalizeSettings({ ...base, ...bad });
    for (const key of ['summary', 'summarySource', 'summaryAt']) assert.ok(!(key in n), `${JSON.stringify(bad)}: sin ${key}`);
  }
  assert.ok(!('model' in normalizeSettings({ ...base, model: 'gpt-4' })));
  assert.ok(!('model' in normalizeSettings({ ...base, model: 'default' })));
  const plain = normalizeSettings(base);
  for (const key of ['summary', 'summarySource', 'summaryAt', 'model']) assert.ok(!(key in plain), `no se añade ${key}`);
  assert.deepEqual(applySummaryChange({ ...base, summary: 'v', summarySource: 'claude', summaryAt: 'x' }, ''), base);
  assert.deepEqual(applySummaryChange(base, 'Nuevo', '2026-10-25T12:00:00.000Z'), { ...base, summary: 'Nuevo', summarySource: 'manual', summaryAt: '2026-10-25T12:00:00.000Z' });
  assert.deepEqual(applyModelChange({ ...base, model: 'opus' }, 'default'), base);
  assert.deepEqual(applyModelChange(base, 'haiku'), { ...base, model: 'haiku' });
  assert.equal(modelOf({ model: 'sonnet' }), 'sonnet');
  assert.equal(modelOf({ model: 'gpt-4' }), 'default');
  assert.equal(modelOf(null), 'default');
  assert.equal(storedSummaryOf({ summary: '   ' }), null);
});

// ======================= Bloque E: "Te necesitan" sin los runs de resumen (R61) =======================

test('[F13-R61] /api/attention excluye los runs de resumen (también fallidos); el historial del proyecto los trae', async () => {
  const dir = await projectWith({});
  await writeScenario(dir, 'error');
  const chatDir = await projectWith({});
  const { app, cookie, authed, post } = await setup({ entries: [{ id: 'sum', name: 'Sum', path: dir }, { id: 'chat', name: 'Chat', path: chatDir }] });
  const gen = await post('/api/projects/sum/summary/generate', {});
  assert.equal(gen.status, 202, gen.text);
  const genFinal = await waitForRun(app, cookie, gen.json.runId);
  assert.equal(genFinal.run.state, 'failed');
  const chat = await post('/api/projects/chat/runs', { prompt: 'Falla [[error]]' });
  assert.equal(chat.status, 202, chat.text);
  await waitForRun(app, cookie, chat.json.runId);
  const attention = await authed('/api/attention');
  assert.equal(attention.status, 200);
  assert.deepEqual(attention.json.runs.map((r) => r.runId), [chat.json.runId], 'solo el chat fallido');
  const history = await authed('/api/projects/sum/runs');
  assert.deepEqual(history.json.map((m) => [m.runId, m.action, m.state]), [[gen.json.runId, 'summary', 'failed']]);
  const chatHistory = await authed('/api/projects/chat/runs');
  assert.equal(chatHistory.json.length, 1);
});

// ======================= Bloque C: generación individual en solo lectura (R12–R19) =======================

const { SUMMARY_PROMPT } = await import('../lib/summary-api.js');
const { buildReadOnlyClaudeArgs } = await import('../lib/claude-cli.js');
const { BIN_ERRORS, defaultResolver } = await import('../lib/trusted-bin.js');
const { makeClock } = await import('./helpers.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const entryOf = async (ctx, id) => (await ctx.readRegistry()).projects.find((p) => p.id === id);
const readAudit = async (app) => (await fs.readFile(path.join(app.dataDir, 'audit.log'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('[F13-R12] POST /summary/generate: argumentos de solo lectura, SUMMARY_PROMPT por stdin aunque el cuerpo traiga otro, cwd y 202', async () => {
  const dir = await projectWith({});
  await writeScenario(dir, 'summary');
  const ctx = await setup({ entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  const r = await ctx.post('/api/projects/proy/summary/generate', { prompt: 'borra todo', model: 'opus' });
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.action, 'summary');
  assert.equal(r.json.label, 'Generar resumen');
  assert.equal(r.json.model, 'haiku');
  assert.equal(r.json.kind, 'claude');
  assert.deepEqual(r.json.session, { mode: 'new', id: null });
  assert.equal(r.json.promptPreview, [...SUMMARY_PROMPT].slice(0, 120).join(''));
  await waitForRun(ctx.app, ctx.cookie, r.json.runId);
  const [entry] = (await readFakeLog(ctx.app.fakeLog)).filter((e) => e.argv);
  assert.deepEqual(entry.argv, buildReadOnlyClaudeArgs());
  assert.equal(entry.prompt, SUMMARY_PROMPT);
  assert.equal(entry.stdin, SUMMARY_PROMPT, 'el prompt va por stdin');
  assert.equal(entry.cwd, dir);
  assert.equal(entry.model, 'haiku');
  assert.deepEqual(entry.tools, ['Read,Glob,Grep']);
  assert.deepEqual(entry.allowedTools, ['Read,Glob,Grep']);
  assert.ok(!entry.argv.includes('acceptEdits'));
  assert.ok(!JSON.stringify(entry.argv).includes('borra todo'));
});

test('[F13-R12] resolvedor que rechaza Claude → 409 con el texto de la feature 14 y sin proceso', async () => {
  const dir = await projectWith({});
  const binaryResolver = {
    resolve: (name, opts) => (name === 'claude' ? { ok: false, error: BIN_ERRORS.onlyInProject('claude') } : defaultResolver.resolve(name, opts)),
    isTrustedPath: (file, opts) => defaultResolver.isTrustedPath(file, opts),
  };
  const ctx = await setup({ entries: [{ id: 'proy', name: 'Proy', path: dir }], claudeBin: 'claude', binaryResolver });
  const r = await ctx.post('/api/projects/proy/summary/generate', {});
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error, BIN_ERRORS.onlyInProject('claude'));
  assert.equal(await fileExists(ctx.app.fakeLog), false);
});

test('[F13-R13] el resultado correcto se guarda como resumen claude (proyecto manual y solo de Claude)', async () => {
  const dir = await projectWith({ 'package.json': JSON.stringify({ description: 'Automático.' }) });
  await writeScenario(dir, 'summary', '«Panel para vigilar proyectos de la consultora.»');
  const claudeDir = await projectWith({});
  await writeScenario(claudeDir, 'summary');
  const { claudeHome } = await makeClaudeHome({
    projects: { [encodeForFixture(claudeDir)]: { s1: [sessionLine({ text: 'hola', timestamp: '2026-10-24T10:00:00.000Z', cwd: claudeDir })] } },
  });
  cleanup.push(claudeHome);
  const ctx = await setup({ claudeHome, entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  const r = await ctx.post('/api/projects/proy/summary/generate', {});
  assert.equal(r.status, 202, r.text);
  const final = await waitForRun(ctx.app, ctx.cookie, r.json.runId);
  assert.equal(final.run.state, 'succeeded');
  const reg = await waitForRegistry(ctx.registryFile, (x) => x.projects.some((p) => p.id === 'proy' && p.summarySource === 'claude'));
  const saved = reg.projects.find((p) => p.id === 'proy');
  assert.equal(saved.summary, 'Panel para vigilar proyectos de la consultora.');
  assert.ok(Date.parse(saved.summaryAt) >= Date.parse(final.run.startedAt));
  const detail = await ctx.authed('/api/projects/proy');
  assert.deepEqual([detail.json.summary, detail.json.summarySource], ['Panel para vigilar proyectos de la consultora.', 'claude']);

  const list = await ctx.authed('/api/projects');
  const claudeId = list.json.find((p) => p.source === 'claude').id;
  const g = await ctx.post(`/api/projects/${claudeId}/summary/generate`, {});
  assert.equal(g.status, 202, g.text);
  await waitForRun(ctx.app, ctx.cookie, g.json.runId);
  const reg2 = await waitForRegistry(ctx.registryFile, (x) => x.projects.some((p) => p.id === claudeId));
  const created = reg2.projects.find((p) => p.id === claudeId);
  assert.equal(created.summary, 'Un CRM de prueba para gestionar clientes.');
  assert.equal(created.summarySource, 'claude');
  assert.equal(created.path, claudeDir);
});

test('[F13-R15] error, cancelación y resultado en blanco no tocan projects.json', async () => {
  const errDir = await projectWith({});
  await writeScenario(errDir, 'error');
  const hangDir = await projectWith({});
  await writeScenario(hangDir, 'hang');
  const blankDir = await projectWith({});
  await writeScenario(blankDir, 'blank');
  const ctx = await setup({
    maxRuns: 5,
    entries: [{ id: 'err', name: 'Err', path: errDir }, { id: 'hang', name: 'Hang', path: hangDir }, { id: 'blank', name: 'Blank', path: blankDir }],
  });
  const before = await fs.readFile(ctx.registryFile);
  const err = await ctx.post('/api/projects/err/summary/generate', {});
  const blank = await ctx.post('/api/projects/blank/summary/generate', {});
  const hang = await ctx.post('/api/projects/hang/summary/generate', {});
  for (const r of [err, blank, hang]) assert.equal(r.status, 202, r.text);
  await waitForRun(ctx.app, ctx.cookie, hang.json.runId, { states: ['running'] });
  const cancel = await ctx.post(`/api/runs/${hang.json.runId}/cancel`, {});
  assert.equal(cancel.status, 202);
  assert.equal((await waitForRun(ctx.app, ctx.cookie, err.json.runId)).run.state, 'failed');
  assert.equal((await waitForRun(ctx.app, ctx.cookie, blank.json.runId)).run.state, 'succeeded');
  assert.equal((await waitForRun(ctx.app, ctx.cookie, hang.json.runId)).run.state, 'cancelled');
  await sleep(300);
  assert.ok((await fs.readFile(ctx.registryFile)).equals(before), 'projects.json byte a byte igual');
});

test('[F13-R16] un resumen manual guardado durante la generación se conserva', async () => {
  const dir = await projectWith({});
  await writeScenario(dir, 'summary_slow');
  const ctx = await setup({ entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  const r = await ctx.post('/api/projects/proy/summary/generate', {});
  assert.equal(r.status, 202, r.text);
  await sleep(50);
  const p = await ctx.patch('/api/projects/proy', { summary: 'Escrito por el humano' });
  assert.equal(p.status, 200, p.text);
  const final = await waitForRun(ctx.app, ctx.cookie, r.json.runId);
  assert.equal(final.run.state, 'succeeded');
  await sleep(300);
  const entry = await entryOf(ctx, 'proy');
  assert.equal(entry.summary, 'Escrito por el humano');
  assert.equal(entry.summarySource, 'manual');
});

test('[F13-R17] allowExec: false → 403 sin proceso; por el túnel sin confirmación reciente → 401 reauthRequired', async () => {
  const dir = await projectWith({});
  await writeScenario(dir, 'summary');
  const off = await setup({ allowExec: false, entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  for (const [url, body] of [['/api/projects/proy/summary/generate', {}], ['/api/summaries/generate', { ids: ['proy'] }]]) {
    const r = await off.post(url, body);
    assert.equal(r.status, 403, `${url}: ${r.text}`);
    assert.equal(r.json.error, 'Acciones de ejecución desactivadas en este panel (PANEL_ALLOW_EXEC=0)');
  }
  assert.equal(await fileExists(off.app.fakeLog), false);
  const clock = makeClock(Date.now());
  const tunnel = await setup({ now: clock.now, entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  clock.advance(16 * 60000);
  for (const [url, body] of [['/api/projects/proy/summary/generate', {}], ['/api/summaries/generate', { ids: ['proy'] }]]) {
    const r = await tunnel.post(url, body, { headers: tunnelHeaders() });
    assert.equal(r.status, 401, `${url}: ${r.text}`);
    assert.equal(r.json.reauthRequired, true);
  }
  assert.equal(await fileExists(tunnel.app.fakeLog), false);
});

test('[F13-R18] 404 sin proyecto, 409 sin carpeta, 409 con run activo y 429 con el máximo de runs, sin procesos nuevos', async () => {
  const dir = await projectWith({});
  const other = await projectWith({});
  const gone = path.join(await tempDir('muver-f13-gone-'), 'no-existe');
  const ctx = await setup({ maxRuns: 1, entries: [{ id: 'proy', name: 'Proy', path: dir }, { id: 'otro', name: 'Otro', path: other }, { id: 'gone', name: 'Gone', path: gone }] });
  const missing = await ctx.post('/api/projects/no-existe/summary/generate', {});
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, 'Proyecto no encontrado');
  const noDir = await ctx.post('/api/projects/gone/summary/generate', {});
  assert.equal(noDir.status, 409);
  assert.equal(noDir.json.error, 'El proyecto no tiene una carpeta accesible en este PC');
  const hang = await ctx.post('/api/projects/proy/runs', { prompt: 'Espera [[hang]]' });
  assert.equal(hang.status, 202, hang.text);
  await waitForRun(ctx.app, ctx.cookie, hang.json.runId, { states: ['running'] });
  const launches = async () => (await readFakeLog(ctx.app.fakeLog)).filter((e) => e.argv).length;
  await waitFor(async () => (await launches()) === 1, { message: 'arranque del run hang' });
  const busy = await ctx.post('/api/projects/proy/summary/generate', {});
  assert.equal(busy.status, 409);
  assert.equal(busy.json.error, 'Ya hay una ejecución en marcha en este proyecto');
  const full = await ctx.post('/api/projects/otro/summary/generate', {});
  assert.equal(full.status, 429);
  assert.equal(full.json.error, 'Se ha alcanzado el máximo de ejecuciones simultáneas (1)');
  assert.equal(await launches(), 1, 'solo el run hang');
  await ctx.post(`/api/runs/${hang.json.runId}/cancel`, {});
  await waitForRun(ctx.app, ctx.cookie, hang.json.runId);
});

test('[F13-R19] audit.log: línea de la puerta summary.generate con runId y fin de run, sin el prompt completo', async () => {
  const dir = await projectWith({});
  await writeScenario(dir, 'summary');
  const ctx = await setup({ entries: [{ id: 'proy', name: 'Proy', path: dir }] });
  const r = await ctx.post('/api/projects/proy/summary/generate', {});
  await waitForRun(ctx.app, ctx.cookie, r.json.runId);
  await waitFor(async () => (await readAudit(ctx.app)).some((a) => a.action === 'run.end' && a.runId === r.json.runId), { message: 'run.end en audit.log' });
  const audit = await readAudit(ctx.app);
  const gate = audit.find((a) => a.action === 'summary.generate');
  assert.ok(gate, 'línea de la puerta');
  assert.equal(gate.result, 'started');
  assert.equal(gate.runId, r.json.runId);
  assert.equal(gate.projectId, 'proy');
  const end = audit.find((a) => a.action === 'run.end' && a.runId === r.json.runId);
  assert.equal(end.result, 'ok');
  for (const line of audit) assert.ok(!JSON.stringify(line).includes(SUMMARY_PROMPT.slice(0, 121)), 'sin más de 120 caracteres del prompt');
});

// ======================= Bloque D: generación en lote (R17, R19–R25) =======================

const { createSummaryApi } = await import('../lib/summary-api.js');
const { Readable } = await import('node:stream');

/** Proyectos con escenario por fichero; devuelve { entries, dirs }. */
async function scenarioProjects(spec) {
  const entries = [];
  const dirs = {};
  for (const [id, scenario, text] of spec) {
    const dir = await projectWith({});
    if (scenario) await writeScenario(dir, scenario, text);
    dirs[id] = dir;
    entries.push({ id, name: id.toUpperCase(), path: dir });
  }
  return { entries, dirs };
}

test('[F13-R20] POST /api/summaries/generate: 202 con el estado del lote y duplicados quitados', async () => {
  const { entries } = await scenarioProjects([['a', 'summary'], ['b', 'summary']]);
  const ctx = await setup({ entries });
  const r = await ctx.post('/api/summaries/generate', { ids: ['a', 'b', 'a'] });
  assert.equal(r.status, 202, r.text);
  const { batch } = r.json;
  assert.match(batch.batchId, /^b-[0-9a-z]+-[0-9a-f]{4}$/);
  assert.equal(batch.state, 'running');
  assert.equal(batch.total, 2);
  assert.equal(batch.endedAt, null);
  assert.ok(!Number.isNaN(Date.parse(batch.startedAt)));
  assert.deepEqual(Object.keys(batch.counts).sort(), ['cancelled', 'failed', 'queued', 'running', 'saved', 'skipped']);
  assert.equal(Object.values(batch.counts).reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(batch.items.map((i) => [i.id, i.name]), [['a', 'A'], ['b', 'B']]);
  for (const item of batch.items) assert.deepEqual(Object.keys(item).sort(), ['error', 'id', 'name', 'runId', 'state']);
  const done = await waitForBatch(ctx.app, ctx.cookie);
  assert.equal(done.state, 'done');
  assert.ok(done.endedAt);
  assert.deepEqual(done.items.map((i) => i.state), ['saved', 'saved']);
  assert.equal(done.counts.saved, 2);
});

test('[F13-R21] ids inválidos → 400; un segundo lote mientras otro sigue → 409', async () => {
  const { entries } = await scenarioProjects([['a', 'hang'], ['b', 'summary']]);
  const ctx = await setup({ entries });
  const many = Array.from({ length: 51 }, (_, i) => `p-${i}`);
  for (const ids of ['a', [], many, ['../x'], [5], undefined]) {
    const r = await ctx.post('/api/summaries/generate', ids === undefined ? {} : { ids });
    assert.equal(r.status, 400, JSON.stringify(ids));
    assert.deepEqual(r.json, { error: 'Indica entre 1 y 50 proyectos', field: 'ids' });
  }
  const fifty = Array.from({ length: 50 }, (_, i) => `q-${i}`);
  const first = await ctx.post('/api/summaries/generate', { ids: ['a', 'b'] });
  assert.equal(first.status, 202, first.text);
  const second = await ctx.post('/api/summaries/generate', { ids: fifty });
  assert.equal(second.status, 409);
  assert.deepEqual(second.json, { error: 'Ya hay una generación de resúmenes en marcha' });
  const cancel = await ctx.post('/api/summaries/batch/cancel', {});
  assert.equal(cancel.status, 202);
  await waitForBatch(ctx.app, ctx.cookie);
});

test('[F13-R22] el lote procesa de uno en uno y en orden: saved, failed, saved', async () => {
  const { entries } = await scenarioProjects([['a', 'summary', 'Primer proyecto de prueba.'], ['b', 'error'], ['c', 'summary', 'Tercer proyecto de prueba.']]);
  const ctx = await setup({ entries, maxRuns: 5 });
  const r = await ctx.post('/api/summaries/generate', { ids: ['a', 'b', 'c'] });
  assert.equal(r.status, 202, r.text);
  const done = await waitForBatch(ctx.app, ctx.cookie);
  assert.deepEqual(done.items.map((i) => i.state), ['saved', 'failed', 'saved']);
  assert.equal(done.items[1].error, 'La ejecución terminó en estado failed');
  const metas = [];
  for (const item of done.items) metas.push((await waitForRun(ctx.app, ctx.cookie, item.runId)).run);
  for (let i = 1; i < metas.length; i++) {
    assert.ok(Date.parse(metas[i].startedAt) >= Date.parse(metas[i - 1].endedAt), `el run ${i} empieza tras el fin del anterior`);
  }
  const log = (await readFakeLog(ctx.app.fakeLog)).filter((e) => e.argv);
  assert.equal(log.length, 3);
  for (let i = 1; i < log.length; i++) assert.ok(log[i].at >= log[i - 1].at, 'arranques en orden');
  const reg = await ctx.readRegistry();
  assert.equal(reg.projects.find((p) => p.id === 'a').summary, 'Primer proyecto de prueba.');
  assert.equal(reg.projects.find((p) => p.id === 'c').summary, 'Tercer proyecto de prueba.');
  assert.ok(!('summary' in reg.projects.find((p) => p.id === 'b')));
});

test('[F13-R23] skipped: inexistente, sin carpeta y run activo', async () => {
  const { entries } = await scenarioProjects([['busy', null], ['ok', 'summary']]);
  entries.push({ id: 'gone', name: 'GONE', path: path.join(await tempDir('muver-f13-gone-'), 'no-existe') });
  const ctx = await setup({ entries, maxRuns: 5 });
  const hang = await ctx.post('/api/projects/busy/runs', { prompt: 'Espera [[hang]]' });
  assert.equal(hang.status, 202, hang.text);
  await waitForRun(ctx.app, ctx.cookie, hang.json.runId, { states: ['running'] });
  const r = await ctx.post('/api/summaries/generate', { ids: ['no-existe', 'gone', 'busy', 'ok'] });
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.batch.items[0].name, 'no-existe', 'sin catálogo, el nombre es el id');
  const done = await waitForBatch(ctx.app, ctx.cookie);
  assert.deepEqual(done.items.map((i) => [i.id, i.state, i.error]), [
    ['no-existe', 'skipped', 'Proyecto no encontrado'],
    ['gone', 'skipped', 'El proyecto no tiene una carpeta accesible en este PC'],
    ['busy', 'skipped', 'Ya hay una ejecución en marcha en este proyecto'],
    ['ok', 'saved', null],
  ]);
  assert.equal(done.counts.skipped, 3);
  await ctx.post(`/api/runs/${hang.json.runId}/cancel`, {});
  await waitForRun(ctx.app, ctx.cookie, hang.json.runId);
});

/** Petición y respuesta falsas para llamar a summaryApi.route sin servidor. */
function fakeExchange(method, pathname, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = {};
  const res = {
    status: null,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(status) { this.status = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
  return { req, res, url: new URL(`http://localhost${pathname}`) };
}

/** workApi falso: puerta abierta (o cerrada), Claude que responde 429 `busyTimes` veces y runs que terminan bien. */
function fakeWorkApi({ busyTimes = Infinity, gateOpen = true } = {}) {
  const calls = { start: 0, gate: 0 };
  const metas = new Map();
  const api = {
    calls,
    gateOpen,
    async gateExec(req, res, session, opts) {
      calls.gate += 1;
      if (!api.gateOpen) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'cerrada' }));
        return null;
      }
      return { auditContext: {}, setDetail() {}, async respond(r, status, body) { r.writeHead(status); r.end(JSON.stringify(body)); } };
    },
    async startReadOnlyClaude({ merged }) {
      calls.start += 1;
      if (calls.start <= busyTimes) return { ok: false, status: 429, error: 'Se ha alcanzado el máximo de ejecuciones simultáneas (1)' };
      const meta = { runId: `r${calls.start}`, projectId: merged.id, state: 'succeeded', startedAt: new Date(0).toISOString() };
      metas.set(meta.runId, meta);
      return { ok: true, meta };
    },
    runs: { waitFor: (id) => Promise.resolve(metas.get(id) || null), cancel: () => null },
    store: { readEvents: async () => [{ type: 'result', ok: true, text: 'Resumen falso.' }], find: async () => null },
  };
  return api;
}

async function fakeSummaryApi(workApi, { retryDelayMs = 5000, retryMaxMs = 600000 } = {}) {
  const dir = await projectWith({});
  const base = await tempDir('muver-f13-fake-');
  const projectsFile = path.join(base, 'projects.json');
  await writeRegistry(projectsFile, [{ id: 'p', name: 'P', path: dir }]);
  const { loadRegistry } = await import('../lib/registry.js');
  const slept = [];
  const api = createSummaryApi({
    projectsFile,
    workApi,
    loadSources: async () => ({ registry: await loadRegistry(projectsFile), discovery: { projects: [] } }),
    retryDelayMs,
    retryMaxMs,
    // Temporizador inyectado: no espera de verdad, pero cede el turno (setImmediate) para no bloquear el bucle.
    sleep: async (ms) => {
      slept.push(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
  });
  return { api, slept, projectsFile };
}

async function routeBatch(api, body) {
  const ex = fakeExchange('POST', '/api/summaries/generate', body);
  assert.equal(await api.route(ex.req, ex.res, ex.url, {}), true);
  return ex.res;
}

test('[F13-R23] reintento por PANEL_MAX_RUNS cada 5 s: arranca al liberarse el hueco; ocupado 10 min → skipped', async () => {
  const freed = fakeWorkApi({ busyTimes: 2 });
  const one = await fakeSummaryApi(freed);
  assert.equal((await routeBatch(one.api, { ids: ['p'] })).status, 202);
  await waitFor(() => one.api.currentBatch() && one.api.currentBatch().state !== 'running', { message: 'lote 1' });
  assert.deepEqual(one.slept, [5000, 5000]);
  assert.equal(one.api.currentBatch().items[0].state, 'saved');
  assert.equal(freed.calls.start, 3);

  const busy = fakeWorkApi({ busyTimes: Infinity });
  const two = await fakeSummaryApi(busy);
  assert.equal((await routeBatch(two.api, { ids: ['p'] })).status, 202);
  await waitFor(() => two.api.currentBatch() && two.api.currentBatch().state !== 'running', { message: 'lote 2' });
  assert.equal(two.slept.length, 120, '10 min / 5 s');
  assert.ok(two.slept.every((ms) => ms === 5000));
  const [item] = two.api.currentBatch().items;
  assert.deepEqual([item.state, item.error], ['skipped', 'Sin hueco para ejecutar durante 10 minutos']);
});

test('[F13-R25] cancelar el lote no pasa por la puerta de ejecución', async () => {
  const work = fakeWorkApi({ busyTimes: Infinity });
  const { api } = await fakeSummaryApi(work, { retryDelayMs: 5000, retryMaxMs: Number.MAX_SAFE_INTEGER });
  // Con sleep inmediato y sin tope el lote reintentaría sin fin: se cancela enseguida.
  assert.equal((await routeBatch(api, { ids: ['p'] })).status, 202);
  work.gateOpen = false;
  const gates = work.calls.gate;
  const ex = fakeExchange('POST', '/api/summaries/batch/cancel', {});
  await api.route(ex.req, ex.res, ex.url, {});
  assert.equal(ex.res.status, 202);
  assert.equal(work.calls.gate, gates, 'sin gateExec');
  await waitFor(() => api.currentBatch().state === 'cancelled', { message: 'lote cancelado' });
  assert.equal(api.currentBatch().items[0].state, 'cancelled');
});

test('[F13-R24] GET /api/summaries/batch antes, durante y después', async () => {
  const { entries } = await scenarioProjects([['a', 'summary_slow']]);
  const ctx = await setup({ entries });
  const before = await ctx.authed('/api/summaries/batch');
  assert.equal(before.status, 200);
  assert.deepEqual(before.json, { batch: null });
  await ctx.post('/api/summaries/generate', { ids: ['a'] });
  const during = await ctx.authed('/api/summaries/batch');
  assert.equal(during.json.batch.state, 'running');
  const done = await waitForBatch(ctx.app, ctx.cookie);
  assert.equal(done.state, 'done');
  const afterDone = await ctx.authed('/api/summaries/batch');
  assert.deepEqual(afterDone.json.batch, done);
});

test('[F13-R25] POST /api/summaries/batch/cancel: cancela el run en curso y los pendientes; sin lote → 409 (también sin ejecución)', async () => {
  const { entries } = await scenarioProjects([['a', 'hang'], ['b', 'summary']]);
  const ctx = await setup({ entries });
  const r = await ctx.post('/api/summaries/generate', { ids: ['a', 'b'] });
  assert.equal(r.status, 202);
  await waitFor(async () => {
    const b = (await ctx.authed('/api/summaries/batch')).json.batch;
    return b.items[0].runId && b.items[0].state === 'running';
  }, { message: 'primer elemento en marcha' });
  const runId = (await ctx.authed('/api/summaries/batch')).json.batch.items[0].runId;
  await waitForRun(ctx.app, ctx.cookie, runId, { states: ['running'] });
  await waitFor(async () => (await readFakeLog(ctx.app.fakeLog)).some((e) => e.argv), { message: 'arranque del primero' });
  const cancel = await ctx.post('/api/summaries/batch/cancel', {});
  assert.equal(cancel.status, 202, cancel.text);
  assert.ok(cancel.json.batch);
  const done = await waitForBatch(ctx.app, ctx.cookie);
  assert.equal(done.state, 'cancelled');
  assert.deepEqual(done.items.map((i) => i.state), ['cancelled', 'cancelled']);
  assert.equal((await waitForRun(ctx.app, ctx.cookie, runId)).run.state, 'cancelled');
  assert.equal((await readFakeLog(ctx.app.fakeLog)).filter((e) => e.argv).length, 1, 'no se lanza el segundo');
  const none = await ctx.post('/api/summaries/batch/cancel', {});
  assert.equal(none.status, 409);
  assert.deepEqual(none.json, { error: 'No hay ninguna generación de resúmenes en marcha' });
  const off = await setup({ allowExec: false, entries });
  const offCancel = await off.post('/api/summaries/batch/cancel', {});
  assert.equal(offCancel.status, 409, 'cancelar no pasa por la puerta (409 sin lote, no 403)');
});

test('[F13-R19] audit.log del lote: summary.batch con detail.count, summary.generate por elemento con runId y fin de cada run', async () => {
  const { entries } = await scenarioProjects([['a', 'summary'], ['b', 'summary']]);
  const ctx = await setup({ entries });
  const r = await ctx.post('/api/summaries/generate', { ids: ['a', 'b'] });
  const done = await waitForBatch(ctx.app, ctx.cookie);
  await waitFor(async () => (await readAudit(ctx.app)).filter((a) => a.action === 'run.end').length === 2, { message: 'fin de los dos runs' });
  const audit = await readAudit(ctx.app);
  const gate = audit.find((a) => a.action === 'summary.batch');
  assert.equal(gate.result, 'started');
  assert.deepEqual(gate.detail, { count: 2 });
  const perItem = audit.filter((a) => a.action === 'summary.generate');
  assert.deepEqual(perItem.map((a) => [a.projectId, a.runId, a.result, a.detail.batchId]), done.items.map((i) => [i.id, i.runId, 'started', r.json.batch.batchId]));
  const ends = audit.filter((a) => a.action === 'run.end').map((a) => a.runId).sort();
  assert.deepEqual(ends, done.items.map((i) => i.runId).sort());
  for (const line of audit) assert.ok(!JSON.stringify(line).includes(SUMMARY_PROMPT.slice(0, 121)));
});

// ======================= Ajuste de la revisión visual: "Te necesitan" agrupado (R62) =======================

test('[F13-R62] /api/attention: los worktrees con principal en la lista no repiten su alerta; distinta → tasksAwaiting; runs intactos', { skip: skipNoGit }, async () => {
  const spec = (slug) => JSON.stringify({ features: [{ id: 1, slug, status: 'spec_ready', description: 'x' }] });
  const repo = await makeRepoWithWorktrees(['igual-uno-aaaaaa', 'igual-dos-bbbbbb', 'distinta-cccccc']);
  cleanup.push(repo.base);
  await fs.writeFile(path.join(repo.main, 'feature_list.json'), spec('alta-cliente'));
  await fs.writeFile(path.join(repo.worktrees['igual-uno-aaaaaa'], 'feature_list.json'), spec('alta-cliente'));
  await fs.writeFile(path.join(repo.worktrees['igual-dos-bbbbbb'], 'feature_list.json'), spec('alta-cliente'));
  await fs.writeFile(path.join(repo.worktrees['distinta-cccccc'], 'feature_list.json'), spec('facturas'));
  const other = await makeRepoWithWorktrees(['huerfana-dddddd'], { mainName: 'fuera' });
  cleanup.push(other.base);
  await fs.writeFile(path.join(other.worktrees['huerfana-dddddd'], 'feature_list.json'), spec('otra'));
  const ctx = await setup({
    entries: [
      { id: 'crm', name: 'CRM', path: repo.main },
      { id: 'igual-uno', name: 'igual-uno', path: repo.worktrees['igual-uno-aaaaaa'] },
      { id: 'igual-dos', name: 'igual-dos', path: repo.worktrees['igual-dos-bbbbbb'] },
      { id: 'distinta', name: 'distinta', path: repo.worktrees['distinta-cccccc'] },
      { id: 'huerfana', name: 'huerfana', path: other.worktrees['huerfana-dddddd'] },
    ],
  });
  const run = await ctx.post('/api/projects/igual-uno/runs', { prompt: 'Falla [[error]]' });
  assert.equal(run.status, 202, run.text);
  await waitForRun(ctx.app, ctx.cookie, run.json.runId);
  const r = await ctx.authed('/api/attention');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.projects.map((p) => [p.id, p.reason, p.tasksAwaiting]).sort(), [['crm', 'spec_ready', 1], ['huerfana', 'spec_ready', 0]]);
  assert.deepEqual(r.json.runs.map((x) => x.runId), [run.json.runId], 'el run del worktree sigue apareciendo');

  // Principal sin alerta propia: aparece solo por sus tareas.
  await fs.writeFile(path.join(repo.main, 'feature_list.json'), JSON.stringify({ features: [] }));
  const only = await ctx.authed('/api/attention');
  const crm = only.json.projects.find((p) => p.id === 'crm');
  assert.deepEqual([crm.reason, crm.features, crm.blockReason, crm.tasksAwaiting], ['tareas', [], null, 3]);
});
