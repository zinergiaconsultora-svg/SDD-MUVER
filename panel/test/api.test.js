// Tests de integración HTTP de lib/app.js — R1–R4, R17–R26 (fase 2: autenticados con cookie, F2-R16)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeProjectDir, makeTempDir, writeRegistry, startApp, request, hasGit, removeDir } from './helpers.js';

const gitAvailable = await hasGit();
const skipNoGit = gitAvailable ? false : 'git no está disponible en este sistema';

const FEATURES = {
  features: [
    { id: 1, slug: 'alta-cliente', description: 'Alta de cliente', status: 'done', sdd: true },
    { id: 2, slug: 'listado', description: 'Listado', status: 'spec_ready', sdd: true },
  ],
};
const CURRENT_MD = '# Progreso actual\n\n- **Bloqueos / esperando:** —\n';

let base;
let withHarness;
let withoutHarness;
let registryFile;
let app;
let baseUrl;
let cookie;

const PASSWORD = 'contraseña-de-la-fase-2';

/** request() autenticado: añade la cookie de sesión del before() (F2-R16). */
function authed(urlPath, init = {}) {
  return request(baseUrl, urlPath, { cookie, ...init });
}

before(async () => {
  base = await makeTempDir('muver-api-');
  registryFile = path.join(base, 'registro', 'projects.json');
  withHarness = await makeProjectDir({
    featureList: FEATURES,
    currentMd: CURRENT_MD,
    git: gitAvailable ? { commits: ['Primer commit', 'Segundo commit'], dirtyFile: 'modificado.txt' } : undefined,
  });
  withoutHarness = await makeTempDir('muver-plain-');
  await writeRegistry(registryFile, [
    { id: 'con-arnes', name: 'Con arnés', path: withHarness, appUrl: 'http://localhost:3000', repoUrl: 'https://example.test/repo', tags: ['web'] },
    { id: 'sin-arnes', name: 'Sin arnés', path: withoutHarness, appUrl: '', repoUrl: '', tags: [] },
  ]);
  app = await startApp({ projectsFile: registryFile, password: PASSWORD });
  baseUrl = app.baseUrl;
  cookie = await app.login();
});

after(async () => {
  if (app) await app.close();
  await removeDir(app.dataDir);
  await removeDir(base);
  await removeDir(withHarness);
  await removeDir(withoutHarness);
});

const SUMMARY_KEYS = ['id', 'name', 'appUrl', 'repoUrl', 'tags', 'exists', 'status', 'sdd', 'progress', 'git'];

// ---------- A. Lectura ----------

test('[R1] GET /api/projects devuelve el listado en orden con los campos del contrato', async () => {
  const r = await authed('/api/projects');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.ok(Array.isArray(r.json));
  assert.equal(r.json.length, 2);
  assert.deepEqual(r.json.map((p) => p.id), ['con-arnes', 'sin-arnes']);
  for (const p of r.json) {
    for (const key of SUMMARY_KEYS) assert.ok(key in p, `falta el campo ${key}`);
    assert.equal('path' in p, false, 'el listado no expone path');
  }
  assert.equal(r.json[0].sdd.present, true);
  assert.equal(r.json[0].status, 'atencion');
  assert.equal(r.json[1].sdd.present, false);
  assert.equal(r.json[1].status, 'ok');
});

test('[R2] GET /api/projects/:id devuelve detalle con features, progreso, commits y ficheros sucios', { skip: skipNoGit }, async () => {
  const r = await authed('/api/projects/con-arnes');
  assert.equal(r.status, 200);
  assert.equal(r.json.sdd.features.length, 2);
  assert.equal(r.json.progress.text, CURRENT_MD);
  assert.equal(r.json.git.branch, 'main');
  assert.equal(r.json.git.recentCommits.length, 2);
  assert.deepEqual(r.json.git.recentCommits.map((c) => c.message), ['Segundo commit', 'Primer commit']);
  for (const c of r.json.git.recentCommits) {
    assert.match(c.hash, /^[0-9a-f]{40}$/);
    assert.ok(!Number.isNaN(Date.parse(c.date)));
  }
  assert.deepEqual(r.json.git.dirtyFiles, ['modificado.txt']);
  assert.equal('path' in r.json, false);
});

test('[R3] GET /api/projects/:id inexistente → 404', async () => {
  const r = await authed('/api/projects/no-existe');
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: 'Proyecto no encontrado' });
});

test('[R4] rutas /api desconocidas → 404 "Ruta no encontrada" y el servidor sigue vivo', async () => {
  const r1 = await authed('/api/nada');
  assert.equal(r1.status, 404);
  assert.deepEqual(r1.json, { error: 'Ruta no encontrada' });
  const r2 = await authed('/api/projects', { method: 'PUT' });
  assert.equal(r2.status, 404);
  assert.deepEqual(r2.json, { error: 'Ruta no encontrada' });
  const r3 = await authed('/api/projects');
  assert.equal(r3.status, 200);
});

// ---------- D. Alta y baja ----------

test('[R17] POST /api/projects válido → 201, id derivado, persistencia y aparece en el listado', async () => {
  const dir = await makeTempDir('muver-nuevo-');
  const r = await authed('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mi Proyecto', path: dir, appUrl: 'http://localhost:5173', tags: ['web'] }),
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json, { id: 'mi-proyecto', name: 'Mi Proyecto', path: path.resolve(dir), appUrl: 'http://localhost:5173', repoUrl: '', tags: ['web'] });

  const saved = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  assert.ok(saved.projects.some((p) => p.id === 'mi-proyecto'));
  assert.equal(saved.projects.at(-1).id, 'mi-proyecto', 'se añade al final');

  const list = await authed('/api/projects');
  assert.deepEqual(list.json.map((p) => p.id), ['con-arnes', 'sin-arnes', 'mi-proyecto']);
  await removeDir(dir);
});

test('[R18] POST con path inexistente / fichero / relativa → 400 field path sin exponer la ruta ni tocar el registro', async () => {
  const before = await fs.readFile(registryFile, 'utf8');
  const file = path.join(base, 'un-fichero.txt');
  await fs.writeFile(file, 'x');
  const bodies = [
    { name: 'A', path: path.join(base, 'no-existe-123') },
    { name: 'B', path: file },
    { name: 'C', path: 'relativa/ruta' },
  ];
  for (const body of bodies) {
    const r = await authed('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(r.status, 400, `cuerpo ${JSON.stringify(body)}`);
    assert.equal(r.json.field, 'path');
    assert.equal(typeof r.json.error, 'string');
    assert.ok(!r.json.error.includes(body.path), 'no debe incluir la ruta enviada');
    assert.ok(!r.json.error.includes(base), 'no debe incluir rutas del servidor');
  }
  assert.equal(await fs.readFile(registryFile, 'utf8'), before);
});

test('[R19] POST sin name / sin path / id inválido / id duplicado → 400 con field correcto', async () => {
  const cases = [
    [{ path: withoutHarness }, 'name'],
    [{ name: 'Sin ruta' }, 'path'],
    [{ name: 'Id raro', path: withoutHarness, id: 'con espacios' }, 'id'],
    [{ name: 'Dup', path: withoutHarness, id: 'sin-arnes' }, 'id'],
  ];
  for (const [body, field] of cases) {
    const r = await authed('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(r.status, 400, `cuerpo ${JSON.stringify(body)}`);
    assert.equal(r.json.field, field);
    assert.equal(typeof r.json.error, 'string');
  }
});

test('[R20] POST con JSON roto → 400 "Cuerpo JSON inválido" y servidor vivo; cuerpo > 64 KB también', async () => {
  const r = await authed('/api/projects', { method: 'POST', body: '{ roto' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: 'Cuerpo JSON inválido' });
  const big = await authed('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'x'.repeat(70 * 1024), path: withoutHarness }),
  });
  assert.equal(big.status, 400);
  assert.deepEqual(big.json, { error: 'Cuerpo JSON inválido' });
  const alive = await authed('/api/projects');
  assert.equal(alive.status, 200);
});

test('[R21] DELETE /api/projects/:id → 204, desaparece del listado y el disco del proyecto sigue intacto', async () => {
  const dir = await makeTempDir('muver-borrar-');
  const marker = path.join(dir, 'importante.txt');
  await fs.writeFile(marker, 'no borrar');
  const created = await authed('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Para borrar', path: dir }) });
  assert.equal(created.status, 201);

  const r = await authed('/api/projects/para-borrar', { method: 'DELETE' });
  assert.equal(r.status, 204);
  assert.equal(r.text, '');

  const list = await authed('/api/projects');
  assert.ok(!list.json.some((p) => p.id === 'para-borrar'));
  const saved = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  assert.ok(!saved.projects.some((p) => p.id === 'para-borrar'));
  assert.equal(await fs.readFile(marker, 'utf8'), 'no borrar');
  await removeDir(dir);
});

test('[R22] DELETE /api/projects/:id inexistente → 404', async () => {
  const r = await authed('/api/projects/no-existe', { method: 'DELETE' });
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: 'Proyecto no encontrado' });
});

// ---------- E. Estáticos, manifest y escucha ----------

test('[R24] estáticos: /, /styles.css, /app.js, /manifest.webmanifest → 200 con Content-Type', async () => {
  const cases = [
    ['/', /^text\/html/],
    ['/styles.css', /^text\/css/],
    ['/app.js', /^(text|application)\/javascript/],
    ['/manifest.webmanifest', /^application\/manifest\+json/],
  ];
  for (const [urlPath, mime] of cases) {
    const r = await authed(urlPath);
    assert.equal(r.status, 200, urlPath);
    assert.match(r.headers.get('content-type'), mime, urlPath);
    assert.ok(r.text.length > 0);
  }
  const index = await authed('/');
  assert.ok(index.text.includes('Puesto de Mando MUVER'));
});

test('[R25] estáticos inexistentes o fuera de public/ → 404 sin revelar rutas', async () => {
  for (const urlPath of ['/no-existe.html', '/../package.json', '/%2e%2e/server.js', '/..%2fpackage.json']) {
    const r = await authed(urlPath);
    assert.equal(r.status, 404, urlPath);
    assert.ok(!r.text.includes('panel/'), urlPath);
    assert.ok(!r.text.includes('panel\\'), urlPath);
    assert.ok(!/(^|\s)\/[a-z]+\//i.test(r.text), `cuerpo con ruta absoluta: ${r.text}`);
    assert.ok(!/[A-Z]:\\/.test(r.text), urlPath);
    assert.ok(!r.text.includes('"type": "module"'), 'no debe servir package.json');
  }
});

test('[R26] manifest con los campos exigidos e icono SVG servido desde public/', async () => {
  const r = await authed('/manifest.webmanifest');
  assert.equal(r.status, 200);
  const manifest = r.json;
  assert.equal(typeof manifest.name, 'string');
  assert.equal(typeof manifest.short_name, 'string');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(typeof manifest.background_color, 'string');
  assert.equal(typeof manifest.theme_color, 'string');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  const svgIcon = manifest.icons.find((i) => i.type === 'image/svg+xml');
  assert.ok(svgIcon, 'debe haber al menos un icono SVG');
  const icon = await authed(svgIcon.src);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /^image\/svg\+xml/);
});

test('[R23] la app escucha en 0.0.0.0 con puerto 0', async () => {
  const other = await startApp({ projectsFile: registryFile });
  const address = other.server.address();
  assert.equal(address.address, '0.0.0.0');
  assert.ok(address.port > 0);
  await other.close();
  await removeDir(other.dataDir);
});

test('[R4] excepción inesperada del handler → 500 "Error interno" sin cerrar el proceso', async () => {
  // Comparte dataDir con la app principal para que la cookie del before() sea válida; la excepción se provoca tras el
  // middleware con un projectsFile que es un directorio (loadRegistry lanza EISDIR al leerlo).
  const broken = await startApp({ projectsFile: base, dataDir: app.dataDir });
  const r = await request(broken.baseUrl, '/api/projects', { cookie });
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: 'Error interno' });
  const alive = await request(broken.baseUrl, '/api/nada', { cookie });
  assert.equal(alive.status, 404);
  await broken.close();
});
