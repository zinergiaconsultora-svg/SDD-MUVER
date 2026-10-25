// Tests de integración HTTP de la fase 3 (lib/app.js + project-catalog + claude-discovery) —
// F3: R2, R3, R4, R6, R10, R25, R28–R31, R33–R40. claudeHome siempre temporal (fixtures), nunca el real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeProjectDir, makeTempDir, writeRegistry, startApp, request, hasGit, removeDir, PANEL_DIR, git } from './helpers.js';
import { makeClaudeHome, makeBaseClaudeHome, sessionLine, encodeForFixture, WINDOWS_FLYDER } from './claude-fixtures.js';
import { slugify } from '../lib/registry.js';

const gitAvailable = await hasGit();
const PASSWORD = 'contraseña-de-la-fase-3';
const NOW = Date.parse('2026-10-25T10:00:00.000Z');
const SESSION_KEYS = ['id', 'title', 'startedAt', 'lastActivityAt', 'messageCount', 'gitBranch', 'truncated'];
const NEW_KEYS = ['source', 'claude', 'hidden', 'pinned', 'lastActivityAt', 'unresolved'];
const PHASE1_KEYS = ['id', 'name', 'appUrl', 'repoUrl', 'tags', 'exists', 'status', 'sdd', 'progress', 'git'];

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

/** Arranca una app con su registro y su claudeHome; devuelve { app, registryFile, authed(url, init), anon(url, init) }. */
async function setup({ entries = [], claudeHome, now = () => NOW } = {}) {
  const base = await tempDir('muver-f3-');
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, entries);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD, claudeHome, now });
  apps.push(app);
  cleanup.push(app.dataDir);
  const cookie = await app.login();
  return {
    app,
    registryFile,
    authed: (urlPath, init = {}) => request(app.baseUrl, urlPath, { cookie, ...init }),
    anon: (urlPath, init = {}) => request(app.baseUrl, urlPath, init),
    cookie,
  };
}

/** Fixture base (design.md §6.1) con proy-a y roto apuntando a directorios reales. */
async function baseFixture() {
  const projADir = await tempDir('muver-proy-a-');
  const rotoDir = await tempDir('muver-roto-');
  const home = await makeBaseClaudeHome({ projADir, rotoDir });
  cleanup.push(home.claudeHome);
  return { ...home, projAId: slugify(path.basename(projADir)), rotoId: slugify(path.basename(rotoDir)) };
}

async function readRegistryFile(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

// ---------- Bloque A: lectura ----------

test('[F3-R2] sin Claude: solo los proyectos de projects.json, source manual, claude null y sin console.error', async () => {
  const a = await tempDir('muver-man-a-');
  const b = await tempDir('muver-man-b-');
  const { authed } = await setup({ entries: [
    { id: 'uno', name: 'Uno', path: a, appUrl: '', repoUrl: '', tags: [] },
    { id: 'dos', name: 'Dos', path: b, appUrl: '', repoUrl: '', tags: [] },
  ] });
  const original = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  let r;
  try {
    r = await authed('/api/projects');
  } finally {
    console.error = original;
  }
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
  assert.deepEqual(r.json.map((p) => p.id).sort(), ['dos', 'uno']);
  for (const p of r.json) {
    assert.equal(p.source, 'manual');
    assert.equal(p.claude, null);
  }
  assert.equal(calls.length, 0, 'sin console.error');
});

test('[F3-R3] GET /api/claude/status disponible: recuentos exactos y lastScanAt = now', async () => {
  const { claudeHome, projectsDir } = await makeClaudeHome({
    projects: {
      '-tmp-muver-st-a': {
        s1: [sessionLine({ text: 'a1', cwd: '/tmp/muver-st-a' })],
        s2: [sessionLine({ text: 'a2', cwd: '/tmp/muver-st-a' })],
      },
      '-tmp-muver-st-b': { s3: [sessionLine({ text: 'b1', cwd: '/tmp/muver-st-b' })] },
    },
  });
  cleanup.push(claudeHome);
  const { authed } = await setup({ claudeHome });
  const r = await authed('/api/claude/status');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { available: true, claudeHome, projectsDir, projectCount: 2, sessionCount: 3, lastScanAt: new Date(NOW).toISOString() });
});

test('[F3-R4] GET /api/claude/status sin Claude → available false con recuentos 0', async () => {
  const claudeHome = await tempDir('muver-claude-nada-');
  const { authed } = await setup({ claudeHome });
  const r = await authed('/api/claude/status');
  assert.equal(r.status, 200);
  const { lastScanAt, ...rest } = r.json;
  assert.deepEqual(rest, { available: false, claudeHome, projectsDir: path.join(claudeHome, '.claude', 'projects'), projectCount: 0, sessionCount: 0 });
  assert.ok(!Number.isNaN(Date.parse(lastScanAt)));
});

test('[F3-R6] sin cookie → 401 en /api/claude/status y /api/projects?includeHidden=1', async () => {
  const { anon } = await setup({});
  for (const url of ['/api/claude/status', '/api/projects?includeHidden=1']) {
    const r = await anon(url);
    assert.equal(r.status, 401, url);
    assert.deepEqual(r.json, { error: 'No autenticado' });
  }
});

test('[F3-R10] proyecto no resuelto en el listado con exists false y status no_encontrado', async () => {
  const fx = await baseFixture();
  const { authed } = await setup({ claudeHome: fx.claudeHome });
  const r = await authed('/api/projects');
  const viejo = r.json.find((p) => p.id === 'c-users-usuario-viejo');
  assert.ok(viejo, 'el no resuelto está en el listado');
  assert.equal(viejo.exists, false);
  assert.equal(viejo.status, 'no_encontrado');
  assert.equal(viejo.unresolved, true);
  assert.equal(viejo.name, 'C--Users-Usuario-viejo');
  assert.equal(viejo.source, 'claude');
});

test('[F3-R25] lastActivityAt de un manual = fecha del último commit; sin git → null', { skip: gitAvailable ? false : 'git no disponible' }, async () => {
  const withGit = await makeProjectDir({ git: { commits: ['Único commit'] } });
  cleanup.push(withGit);
  const plain = await tempDir('muver-plain-');
  const { stdout } = await git(withGit, ['log', '-1', '--format=%cI']);
  const { authed } = await setup({ entries: [
    { id: 'con-git', name: 'Con git', path: withGit },
    { id: 'sin-git', name: 'Sin git', path: plain },
  ] });
  const r = await authed('/api/projects');
  const conGit = r.json.find((p) => p.id === 'con-git');
  const sinGit = r.json.find((p) => p.id === 'sin-git');
  assert.equal(conGit.source, 'manual');
  assert.equal(conGit.lastActivityAt, new Date(stdout.trim()).toISOString());
  assert.equal(sinGit.lastActivityAt, null);
  assert.deepEqual(r.json.map((p) => p.id), ['con-git', 'sin-git']);
});

test('[F3-R28] campos nuevos presentes y sin path en proyectos both, manual y claude', async () => {
  const fx = await baseFixture();
  const manualDir = await tempDir('muver-manual-');
  const { authed } = await setup({
    claudeHome: fx.claudeHome,
    entries: [
      { id: 'flyder', name: 'Flyder', path: WINDOWS_FLYDER, appUrl: '', repoUrl: '', tags: [] },
      { id: 'manual', name: 'Manual', path: manualDir, appUrl: '', repoUrl: '', tags: [] },
    ],
  });
  const r = await authed('/api/projects');
  const bySource = Object.fromEntries(['both', 'manual', 'claude'].map((s) => [s, r.json.find((p) => p.source === s)]));
  for (const [source, p] of Object.entries(bySource)) {
    assert.ok(p, `hay un proyecto ${source}`);
    for (const key of [...PHASE1_KEYS, ...NEW_KEYS]) assert.ok(key in p, `${source}: falta ${key}`);
    assert.equal('path' in p, false, `${source}: no expone path`);
  }
  assert.equal(bySource.both.id, 'flyder');
  assert.deepEqual(bySource.both.claude, { sessionCount: 1, lastActivityAt: '2026-10-24T09:12:40.000Z', lastPrompt: 'implementa la siguiente tarea pendiente' });
  assert.equal(bySource.manual.claude, null);
  assert.equal(r.json.filter((p) => p.source === 'both').length, 1, 'flyder no aparece duplicado');
  for (const p of r.json) assert.ok(!JSON.stringify(p).includes(fx.claudeHome), 'no se exponen rutas de claudeHome');
});

test('[F3-R29] orden del catálogo con fixtures: fijado, actividad desc y null al final', async () => {
  const fx = await baseFixture();
  const manualDir = await tempDir('muver-fijado-');
  const { authed } = await setup({
    claudeHome: fx.claudeHome,
    entries: [
      { id: 'flyder', name: 'Flyder', path: WINDOWS_FLYDER },
      { id: 'manual-fijado', name: 'Manual fijado', path: manualDir, pinned: true },
    ],
  });
  const r = await authed('/api/projects');
  assert.deepEqual(r.json.map((p) => p.id), ['manual-fijado', 'flyder', fx.rotoId, fx.projAId, 'c-users-usuario-viejo']);
});

test('[F3-R30] includeHidden: ausente / 0 excluyen ocultos; 1 los incluye con hidden true', async () => {
  const a = await tempDir('muver-vis-');
  const b = await tempDir('muver-oculto-');
  const { authed } = await setup({ entries: [
    { id: 'visible', name: 'Visible', path: a },
    { id: 'oculto', name: 'Oculto', path: b, hidden: true },
  ] });
  for (const url of ['/api/projects', '/api/projects?includeHidden=0']) {
    const r = await authed(url);
    assert.deepEqual(r.json.map((p) => p.id), ['visible'], url);
  }
  const all = await authed('/api/projects?includeHidden=1');
  assert.deepEqual(all.json.map((p) => p.id).sort(), ['oculto', 'visible']);
  assert.equal(all.json.find((p) => p.id === 'oculto').hidden, true);
  assert.equal(all.json.find((p) => p.id === 'visible').hidden, false);
});

test('[F3-R31] detalle: 22 sesiones → 20 ordenadas con 7 campos; manual con claude null; oculto responde 200', async () => {
  const projDir = await tempDir('muver-muchas-');
  const sessions = {};
  for (let i = 0; i < 22; i++) {
    const ts = new Date(Date.UTC(2026, 9, 1 + i)).toISOString();
    sessions[`ses-${String(i).padStart(2, '0')}`] = [sessionLine({ text: `sesión ${i}`, cwd: projDir, timestamp: ts, gitBranch: 'main' })];
  }
  const { claudeHome } = await makeClaudeHome({ projects: { [encodeForFixture(projDir)]: sessions } });
  cleanup.push(claudeHome);
  const manualDir = await tempDir('muver-man-');
  const hiddenDir = await tempDir('muver-hid-');
  const { authed } = await setup({
    claudeHome,
    entries: [
      { id: 'manual', name: 'Manual', path: manualDir },
      { id: 'escondido', name: 'Escondido', path: hiddenDir, hidden: true },
    ],
  });
  const id = slugify(path.basename(projDir));
  const r = await authed(`/api/projects/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'claude');
  assert.equal(r.json.claude.sessionCount, 22);
  assert.equal(r.json.claude.sessions.length, 20);
  assert.equal(r.json.claude.sessions[0].id, 'ses-21');
  assert.equal(r.json.claude.sessions[19].id, 'ses-02');
  for (const s of r.json.claude.sessions) assert.deepEqual(Object.keys(s).sort(), [...SESSION_KEYS].sort());
  for (const key of ['sdd', 'progress', 'git']) assert.ok(key in r.json);
  assert.ok(Array.isArray(r.json.git.recentCommits), 'detalle de la fase 1');
  assert.equal('path' in r.json, false);

  const manual = await authed('/api/projects/manual');
  assert.equal(manual.status, 200);
  assert.equal(manual.json.claude, null);
  assert.equal(manual.json.source, 'manual');

  const hidden = await authed('/api/projects/escondido');
  assert.equal(hidden.status, 200);
  assert.equal(hidden.json.hidden, true);
});

test('[F3-R33] projects.json real copiado sin Claude: las 4 entradas iniciales no_encontrado y manual', async () => {
  const base = await tempDir('muver-real-');
  const registryFile = path.join(base, 'projects.json');
  await fs.copyFile(path.join(PANEL_DIR, 'projects.json'), registryFile);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD });
  apps.push(app);
  cleanup.push(app.dataDir);
  const cookie = await app.login();
  const r = await request(app.baseUrl, '/api/projects', { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((p) => p.id).sort(), ['app-finanzas-restaurante', 'app-flyder', 'appcc-real', 'crm-zinergia']);
  for (const p of r.json) {
    assert.equal(p.exists, false);
    assert.equal(p.status, 'no_encontrado');
    assert.equal(p.source, 'manual');
    assert.equal(p.claude, null);
  }
});

// ---------- Bloque B: escritura ----------

test('[F3-R34] PATCH sobre un proyecto both actualiza solo los campos enviados', async () => {
  const fx = await baseFixture();
  const { authed, registryFile } = await setup({
    claudeHome: fx.claudeHome,
    entries: [{ id: 'flyder', name: 'Flyder', path: WINDOWS_FLYDER, appUrl: 'http://localhost:3000', repoUrl: '', tags: [] }],
  });
  const r = await authed('/api/projects/flyder', { method: 'PATCH', body: JSON.stringify({ pinned: true, tags: ['crm'] }) });
  assert.equal(r.status, 200);
  assert.equal(r.json.id, 'flyder');
  assert.equal(r.json.pinned, true);
  assert.deepEqual(r.json.tags, ['crm']);
  assert.equal(r.json.source, 'both');
  assert.equal(r.json.appUrl, 'http://localhost:3000');
  assert.equal('path' in r.json, false);
  const saved = (await readRegistryFile(registryFile)).projects;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].pinned, true);
  assert.deepEqual(saved[0].tags, ['crm']);
  assert.equal(saved[0].name, 'Flyder');
  assert.equal(saved[0].path, WINDOWS_FLYDER);
  assert.equal(saved[0].appUrl, 'http://localhost:3000');
  assert.deepEqual(await fs.readdir(path.dirname(registryFile)), ['projects.json'], 'escritura atómica sin .tmp residual');
});

test('[F3-R35] PATCH sobre un proyecto solo de Claude crea la entrada de ajustes y pasa a both; no resuelto → 400', async () => {
  const fx = await baseFixture();
  const { authed, registryFile } = await setup({ claudeHome: fx.claudeHome });
  const r = await authed(`/api/projects/${fx.projAId}`, { method: 'PATCH', body: JSON.stringify({ appUrl: 'http://localhost:5173' }) });
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'both');
  assert.equal(r.json.appUrl, 'http://localhost:5173');
  assert.equal(r.json.id, fx.projAId);
  const saved = (await readRegistryFile(registryFile)).projects;
  assert.deepEqual(saved, [{ id: fx.projAId, name: path.basename(fx.projADir), path: fx.projADir, appUrl: 'http://localhost:5173', repoUrl: '', tags: [], hidden: false, pinned: false }]);
  const list = await authed('/api/projects');
  const again = list.json.filter((p) => p.id === fx.projAId);
  assert.equal(again.length, 1);
  assert.equal(again[0].source, 'both');
  assert.equal(list.json.filter((p) => p.name === path.basename(fx.projADir)).length, 1, 'sin duplicados');

  const before = await fs.readFile(registryFile, 'utf8');
  const unresolved = await authed('/api/projects/c-users-usuario-viejo', { method: 'PATCH', body: JSON.stringify({ pinned: true }) });
  assert.equal(unresolved.status, 400);
  assert.deepEqual(unresolved.json, { error: 'No se puede guardar ajustes de un proyecto sin ruta resuelta' });
  assert.equal(await fs.readFile(registryFile, 'utf8'), before);
});

test('[F3-R36] PATCH con cuerpos inválidos → 400 con error y field, projects.json intacto', async () => {
  const dir = await tempDir('muver-p36-');
  const { authed, registryFile } = await setup({ entries: [{ id: 'p', name: 'P', path: dir }] });
  const statBefore = await fs.stat(registryFile);
  const before = await fs.readFile(registryFile, 'utf8');
  const cases = [
    [{ name: '' }, 'El nombre es obligatorio', 'name'],
    [{ appUrl: 3 }, 'La URL de la app debe ser una cadena', 'appUrl'],
    [{ repoUrl: false }, 'La URL del repositorio debe ser una cadena', 'repoUrl'],
    [{ tags: [1] }, 'Las etiquetas deben ser una lista de textos', 'tags'],
    [{ hidden: 'sí' }, 'hidden debe ser true o false', 'hidden'],
    [{ pinned: null }, 'pinned debe ser true o false', 'pinned'],
  ];
  for (const [body, error, field] of cases) {
    const r = await authed('/api/projects/p', { method: 'PATCH', body: JSON.stringify(body) });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.json, { error, field });
  }
  for (const body of [{}, { path: '/otra' }]) {
    const r = await authed('/api/projects/p', { method: 'PATCH', body: JSON.stringify(body) });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: 'Nada que actualizar' });
  }
  const broken = await authed('/api/projects/p', { method: 'PATCH', body: '{ roto' });
  assert.equal(broken.status, 400);
  assert.deepEqual(broken.json, { error: 'Cuerpo JSON inválido' });
  assert.equal(await fs.readFile(registryFile, 'utf8'), before);
  assert.equal((await fs.stat(registryFile)).mtimeMs, statBefore.mtimeMs);
});

test('[F3-R37] PATCH a id inexistente → 404; PATCH { hidden: false } a un oculto → 200 y vuelve al listado', async () => {
  const dir = await tempDir('muver-p37-');
  const { authed } = await setup({ entries: [{ id: 'oculto', name: 'Oculto', path: dir, hidden: true }] });
  const missing = await authed('/api/projects/no-existe', { method: 'PATCH', body: JSON.stringify({ pinned: true }) });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { error: 'Proyecto no encontrado' });
  assert.deepEqual((await authed('/api/projects')).json, []);
  const r = await authed('/api/projects/oculto', { method: 'PATCH', body: JSON.stringify({ hidden: false }) });
  assert.equal(r.status, 200);
  assert.equal(r.json.hidden, false);
  assert.deepEqual((await authed('/api/projects')).json.map((p) => p.id), ['oculto']);
});

test('[F3-R38] anti-CSRF en toda mutación: PATCH/PUT sin cabecera → 403; PATCH sin cookie → 401; POST/DELETE siguen en 403', async () => {
  const dir = await tempDir('muver-p38-');
  const { authed, anon, registryFile } = await setup({ entries: [{ id: 'p', name: 'P', path: dir }] });
  const before = await fs.readFile(registryFile, 'utf8');
  const csrfError = { error: 'Cabecera X-Requested-With requerida' };
  for (const method of ['PATCH', 'PUT']) {
    const r = await authed('/api/projects/p', { method, body: JSON.stringify({ pinned: true }), csrf: false });
    assert.equal(r.status, 403, method);
    assert.deepEqual(r.json, csrfError);
  }
  const noCookie = await anon('/api/projects/p', { method: 'PATCH', body: JSON.stringify({ pinned: true }) });
  assert.equal(noCookie.status, 401);
  assert.deepEqual(noCookie.json, { error: 'No autenticado' });
  const post = await authed('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'X', path: dir }), csrf: false });
  assert.equal(post.status, 403);
  const del = await authed('/api/projects/p', { method: 'DELETE', csrf: false });
  assert.equal(del.status, 403);
  const putWithHeader = await authed('/api/projects/p', { method: 'PUT', body: '{}' });
  assert.equal(putWithHeader.status, 404);
  assert.deepEqual(putWithHeader.json, { error: 'Ruta no encontrada' });
  assert.equal(await fs.readFile(registryFile, 'utf8'), before);
});

test('[F3-R39] DELETE: claude → 409, both → 409 con fichero intacto, manual → 204', async () => {
  const fx = await baseFixture();
  const manualDir = await tempDir('muver-p39-');
  const { authed, registryFile } = await setup({
    claudeHome: fx.claudeHome,
    entries: [
      { id: 'flyder', name: 'Flyder', path: WINDOWS_FLYDER },
      { id: 'manual', name: 'Manual', path: manualDir },
    ],
  });
  const before = await fs.readFile(registryFile, 'utf8');
  const conflict = { error: 'Este proyecto lo detecta Claude Code: no se puede eliminar, ocúltalo' };
  for (const id of [fx.projAId, 'flyder']) {
    const r = await authed(`/api/projects/${id}`, { method: 'DELETE' });
    assert.equal(r.status, 409, id);
    assert.deepEqual(r.json, conflict);
  }
  assert.equal(await fs.readFile(registryFile, 'utf8'), before);
  const ok = await authed('/api/projects/manual', { method: 'DELETE' });
  assert.equal(ok.status, 204);
  const saved = (await readRegistryFile(registryFile)).projects;
  assert.deepEqual(saved.map((p) => p.id), ['flyder']);
  const missing = await authed('/api/projects/no-existe', { method: 'DELETE' });
  assert.equal(missing.status, 404);
});

test('[F3-R40] POST con la ruta de un proyecto de Claude → 201 y un único proyecto both con el id nuevo', async () => {
  const fx = await baseFixture();
  const { authed } = await setup({ claudeHome: fx.claudeHome });
  const before = await authed('/api/projects');
  assert.ok(before.json.some((p) => p.id === fx.projAId));
  const r = await authed('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Mi Flyder', path: fx.projADir }) });
  assert.equal(r.status, 201);
  assert.equal(r.json.id, 'mi-flyder');
  const list = await authed('/api/projects');
  const matches = list.json.filter((p) => p.id === 'mi-flyder' || p.id === fx.projAId);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'mi-flyder');
  assert.equal(matches[0].source, 'both');
  assert.equal(matches[0].claude.sessionCount, 2);
});
