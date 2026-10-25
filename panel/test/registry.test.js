// Tests de lib/registry.js — R17, R18, R19, R21
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { slugify, validateNewProject, loadRegistry, saveRegistry, removeProject } from '../lib/registry.js';
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
  assert.deepEqual(await loadRegistry(file), registry);
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
