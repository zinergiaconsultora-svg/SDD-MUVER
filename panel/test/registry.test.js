// Tests de lib/registry.js — R17, R18, R19, R21; fase 3: F3-R32, F3-R34, F3-R36; fase 4: F4-R62, F4-R66
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  slugify,
  validateNewProject,
  loadRegistry,
  saveRegistry,
  removeProject,
  normalizeSettings,
  validatePatch,
  upsertSettings,
  PATCHABLE_FIELDS,
  isHttpUrl,
  execSettingsOf,
} from '../lib/registry.js';
import { makeTempDir, removeDir } from './helpers.js';

const existing = [{ id: 'crm-zinergia', name: 'CRM', path: '/x', appUrl: '', repoUrl: '', tags: [] }];

test('[R17] slugify deriva ids válidos', () => {
  assert.equal(slugify('Mi Proyecto'), 'mi-proyecto');
  assert.equal(slugify('Añade  café  ñu'), 'anade-cafe-nu');
  assert.equal(slugify('--hola---mundo--'), 'hola-mundo');
  assert.equal(slugify('  App Finanzas (v2) '), 'app-finanzas-v2');
});

test('[R19] validateNewProject rechaza sin name', async () => {
  const dir = await makeTempDir();
  const r = await validateNewProject({ path: dir }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.field, 'name');
  await removeDir(dir);
});

test('[R19] validateNewProject rechaza sin path', async () => {
  const r = await validateNewProject({ name: 'Algo' }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'path');
});

test('[R18] validateNewProject rechaza ruta relativa', async () => {
  const r = await validateNewProject({ name: 'Algo', path: 'relativa/ruta' }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'path');
  assert.ok(!r.error.includes('relativa/ruta'), 'el mensaje no debe incluir la ruta recibida');
});

test('[R18] validateNewProject rechaza ruta inexistente', async () => {
  const dir = await makeTempDir();
  const missing = path.join(dir, 'no-existe');
  const r = await validateNewProject({ name: 'Algo', path: missing }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'path');
  assert.ok(!r.error.includes(missing));
  await removeDir(dir);
});

test('[R18] validateNewProject rechaza ruta a un fichero', async () => {
  const dir = await makeTempDir();
  const file = path.join(dir, 'fichero.txt');
  await fs.writeFile(file, 'x');
  const r = await validateNewProject({ name: 'Algo', path: file }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'path');
  await removeDir(dir);
});

test('[R19] validateNewProject rechaza id con espacios', async () => {
  const dir = await makeTempDir();
  const r = await validateNewProject({ name: 'Algo', path: dir, id: 'con espacios' }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'id');
  await removeDir(dir);
});

test('[R19] validateNewProject rechaza id duplicado', async () => {
  const dir = await makeTempDir();
  const r = await validateNewProject({ name: 'Algo', path: dir, id: 'crm-zinergia' }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'id');
  await removeDir(dir);
});

test('[R17] validateNewProject acepta un directorio y normaliza', async () => {
  const dir = await makeTempDir();
  const unnormalized = path.join(dir, '.', 'sub', '..');
  const r = await validateNewProject(
    { name: 'Mi Proyecto', path: unnormalized, tags: 'no-array', appUrl: 42, repoUrl: null },
    existing,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.project, {
    id: 'mi-proyecto',
    name: 'Mi Proyecto',
    path: path.resolve(dir),
    appUrl: '',
    repoUrl: '',
    tags: [],
  });
  await removeDir(dir);
});

test('[R17] loadRegistry sin fichero devuelve lista vacía', async () => {
  const dir = await makeTempDir();
  const reg = await loadRegistry(path.join(dir, 'projects.json'));
  assert.deepEqual(reg, { projects: [] });
  await removeDir(dir);
});

test('[R17] saveRegistry + loadRegistry ida y vuelta (y sin fichero temporal residual)', async () => {
  const dir = await makeTempDir();
  const file = path.join(dir, 'projects.json');
  const registry = { projects: [{ id: 'a', name: 'A', path: dir, appUrl: '', repoUrl: '', tags: ['x'] }] };
  await saveRegistry(file, registry);
  const raw = await fs.readFile(file, 'utf8');
  assert.ok(raw.includes('\n  "projects"'), 'indentación de 2 espacios');
  // Fase 3 (F3-R32): loadRegistry normaliza las entradas y añade hidden/pinned = false si faltan.
  assert.deepEqual(await loadRegistry(file), { projects: registry.projects.map((p) => ({ ...p, hidden: false, pinned: false })) });
  const entries = await fs.readdir(dir);
  assert.deepEqual(entries, ['projects.json']);
  await removeDir(dir);
});

test('[R21] removeProject elimina solo la entrada indicada', () => {
  const registry = { projects: [{ id: 'a' }, { id: 'b' }] };
  const r1 = removeProject(registry, 'a');
  assert.equal(r1.removed, true);
  assert.deepEqual(r1.registry.projects.map((p) => p.id), ['b']);
  const r2 = removeProject(registry, 'zzz');
  assert.equal(r2.removed, false);
  assert.equal(r2.registry.projects.length, 2);
});

// ---------- Fase 3: capa de ajustes (F3-R32, F3-R34, F3-R36) ----------

test('[F3-R32] normalizeSettings y loadRegistry: hidden/pinned ausentes o no booleanos → false; true se conserva', async () => {
  assert.deepEqual(normalizeSettings({}), { appUrl: '', repoUrl: '', tags: [], hidden: false, pinned: false });
  assert.equal(normalizeSettings({ hidden: 'sí' }).hidden, false);
  assert.equal(normalizeSettings({ pinned: true }).pinned, true);
  assert.deepEqual(normalizeSettings({ id: 'a', tags: ['x', 3, null, 'y'], appUrl: 5 }).tags, ['x', 'y']);
  assert.equal(normalizeSettings({ appUrl: 5 }).appUrl, '');

  const dir = await makeTempDir();
  const file = path.join(dir, 'projects.json');
  await fs.writeFile(file, JSON.stringify({ projects: [{ id: 'a' }, { id: 'b', hidden: 'sí' }, { id: 'c', pinned: true }] }));
  const reg = await loadRegistry(file);
  assert.deepEqual(reg.projects.map((p) => [p.id, p.hidden, p.pinned]), [['a', false, false], ['b', false, false], ['c', false, true]]);
  await removeDir(dir);
});

test('[F3-R32] saveRegistry tras upsertSettings conserva pinned: true en el fichero', async () => {
  const dir = await makeTempDir();
  const file = path.join(dir, 'projects.json');
  await fs.writeFile(file, JSON.stringify({ projects: [{ id: 'a', name: 'A', path: dir }] }));
  const reg = await loadRegistry(file);
  await saveRegistry(file, upsertSettings(reg, { ...reg.projects[0], pinned: true }));
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.projects[0].pinned, true);
  assert.equal(saved.projects[0].hidden, false);
  assert.equal((await loadRegistry(file)).projects[0].pinned, true);
  await removeDir(dir);
});

test('[F3-R34] upsertSettings sustituye por id o añade al final sin mutar el registro', () => {
  const registry = { projects: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
  const replaced = upsertSettings(registry, { id: 'a', name: 'A2' });
  assert.deepEqual(replaced.projects, [{ id: 'a', name: 'A2' }, { id: 'b', name: 'B' }]);
  const added = upsertSettings(registry, { id: 'c', name: 'C' });
  assert.deepEqual(added.projects.map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(registry.projects, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'el original no cambia');
});

test('[F3-R34] validatePatch acepta cada campo válido, recorta e ignora campos ajenos', () => {
  // Fase 4 (F4-R62): se añaden allowedCommands y testCommand a la lista de campos admitidos.
  assert.deepEqual(PATCHABLE_FIELDS, ['name', 'appUrl', 'repoUrl', 'tags', 'hidden', 'pinned', 'allowedCommands', 'testCommand']);
  const r = validatePatch({ name: '  Nuevo  ', appUrl: ' http://localhost:5173 ', repoUrl: '', tags: [' web ', '', 'crm'], hidden: false, pinned: true, path: '/otra', id: 'x' });
  assert.deepEqual(r, { ok: true, changes: { name: 'Nuevo', appUrl: 'http://localhost:5173', repoUrl: '', tags: ['web', 'crm'], hidden: false, pinned: true } });
  assert.deepEqual(validatePatch({ pinned: false }), { ok: true, changes: { pinned: false } });
});

test('[F3-R36] validatePatch rechaza cada campo inválido con el texto y field de design.md §4.3', () => {
  const cases = [
    [{ name: '' }, 'El nombre es obligatorio', 'name'],
    [{ name: '   ' }, 'El nombre es obligatorio', 'name'],
    [{ name: 5 }, 'El nombre es obligatorio', 'name'],
    [{ appUrl: 5 }, 'La URL de la app debe ser una cadena', 'appUrl'],
    [{ repoUrl: null }, 'La URL del repositorio debe ser una cadena', 'repoUrl'],
    [{ tags: 'web' }, 'Las etiquetas deben ser una lista de textos', 'tags'],
    [{ tags: ['web', 3] }, 'Las etiquetas deben ser una lista de textos', 'tags'],
    [{ hidden: 'true' }, 'hidden debe ser true o false', 'hidden'],
    [{ pinned: 1 }, 'pinned debe ser true o false', 'pinned'],
  ];
  for (const [body, error, field] of cases) {
    assert.deepEqual(validatePatch(body), { ok: false, status: 400, error, field }, JSON.stringify(body));
  }
  for (const body of [{}, { path: '/otra' }, { id: 'x' }]) {
    assert.deepEqual(validatePatch(body), { ok: false, status: 400, error: 'Nada que actualizar' }, JSON.stringify(body));
  }
});

// ---------- Fase 4: ajustes de ejecución y URLs http(s) (F4-R62, F4-R66) ----------

const URL_ERROR = 'La URL debe empezar por http:// o https://';

test('[F4-R62] validatePatch: allowedCommands válidos (recorte, colapso de espacios, sin duplicados) y testCommand', () => {
  const r = validatePatch({ allowedCommands: [' npm test ', 'npm   run build', 'npm test'], testCommand: '  node "mi script.js" --x  ' });
  assert.deepEqual(r, { ok: true, changes: { allowedCommands: ['npm test', 'npm run build'], testCommand: 'node "mi script.js" --x' } });
  assert.deepEqual(validatePatch({ allowedCommands: [], testCommand: '' }), { ok: true, changes: { allowedCommands: [], testCommand: '' } });
  assert.deepEqual(validatePatch({ testCommand: '   ' }), { ok: true, changes: { testCommand: '' } });
});

test('[F4-R62] validatePatch: allowedCommands y testCommand inválidos con field y texto de design.md §4.4', () => {
  const invalidCommand = 'Comando no válido: solo letras, números, espacios y . _ : / = @ + - (máx. 200)';
  const cases = [
    [{ allowedCommands: ['npm test && rm'] }, invalidCommand, 'allowedCommands'],
    [{ allowedCommands: ['a(b)'] }, invalidCommand, 'allowedCommands'],
    [{ allowedCommands: [''] }, invalidCommand, 'allowedCommands'],
    [{ allowedCommands: 'npm test' }, invalidCommand, 'allowedCommands'],
    [{ allowedCommands: [5] }, invalidCommand, 'allowedCommands'],
    [{ allowedCommands: Array.from({ length: 31 }, (_, i) => `cmd${i}`) }, 'Como mucho 30 comandos autorizados', 'allowedCommands'],
    [{ testCommand: '"sin cerrar' }, 'Comando de tests no válido: comillas sin cerrar', 'testCommand'],
    [{ testCommand: 'a\nb' }, 'Comando de tests no válido: contiene saltos de línea o NUL', 'testCommand'],
    [{ testCommand: 5 }, 'Comando de tests no válido: vacío', 'testCommand'],
  ];
  for (const [body, error, field] of cases) {
    assert.deepEqual(validatePatch(body), { ok: false, status: 400, error, field }, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(validatePatch({ allowedCommands: Array.from({ length: 30 }, (_, i) => `cmd${i}`) }).ok, true, '30 entradas se admiten');
});

test('[F4-R66] isHttpUrl y validatePatch con URLs que no son http(s)', () => {
  for (const ok of ['', 'https://ok.example', 'http://localhost:3000', 'HTTPS://X.example/a?b']) assert.equal(isHttpUrl(ok), true, ok);
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:x', 'ftp://x', 'no es url', 'data:text/html,x', 5]) assert.equal(isHttpUrl(bad), false, String(bad));
  assert.deepEqual(validatePatch({ appUrl: 'javascript:alert(1)' }), { ok: false, status: 400, error: URL_ERROR, field: 'appUrl' });
  assert.deepEqual(validatePatch({ repoUrl: 'ftp://x' }), { ok: false, status: 400, error: URL_ERROR, field: 'repoUrl' });
  assert.deepEqual(validatePatch({ repoUrl: 'no es url' }), { ok: false, status: 400, error: URL_ERROR, field: 'repoUrl' });
  assert.deepEqual(validatePatch({ appUrl: '', repoUrl: ' https://ok.example ' }), { ok: true, changes: { appUrl: '', repoUrl: 'https://ok.example' } });
});

test('[F4-R66] validateNewProject rechaza appUrl/repoUrl que no son http(s) y acepta vacías o https', async () => {
  const dir = await makeTempDir();
  for (const [field, value] of [['appUrl', 'javascript:alert(1)'], ['repoUrl', 'ftp://x'], ['appUrl', 'no es url']]) {
    const r = await validateNewProject({ name: 'Nuevo', path: dir, [field]: value }, []);
    assert.deepEqual(r, { ok: false, status: 400, error: URL_ERROR, field }, `${field}=${value}`);
  }
  const ok = await validateNewProject({ name: 'Nuevo', path: dir, appUrl: '', repoUrl: 'https://ok.example' }, []);
  assert.equal(ok.ok, true);
  assert.equal(ok.project.repoUrl, 'https://ok.example');
  await removeDir(dir);
});

test('[F4-R62] normalizeSettings conserva allowedCommands/testCommand válidos y execSettingsOf da los valores por defecto', () => {
  const n = normalizeSettings({ id: 'a', allowedCommands: ['npm test', 'a(b)', 3], testCommand: 'npm test' });
  assert.deepEqual(n.allowedCommands, ['npm test']);
  assert.equal(n.testCommand, 'npm test');
  assert.deepEqual(normalizeSettings({ allowedCommands: 'x', testCommand: 7 }).allowedCommands, []);
  assert.equal(normalizeSettings({ allowedCommands: 'x', testCommand: 7 }).testCommand, '');
  assert.deepEqual(execSettingsOf(null), { allowedCommands: [], testCommand: '' });
  assert.deepEqual(execSettingsOf({ id: 'a' }), { allowedCommands: [], testCommand: '' });
  assert.deepEqual(execSettingsOf({ allowedCommands: ['npm test', 'npm test', 'x;y'], testCommand: ' make ' }), { allowedCommands: ['npm test'], testCommand: 'make' });
});
