// Registro de proyectos (panel/projects.json): carga, guardado atómico y validación de altas/bajas.
// Fase 3: projects.json es además la capa de ajustes (hidden, pinned) que se fusiona con los proyectos de Claude.
// Fase 4: ajustes de ejecución (allowedCommands, testCommand) y URLs restringidas a http(s) (mejora M5).
import fs from 'node:fs/promises';
import path from 'node:path';

import { isValidAllowedCommand, normalizeCommand, isValidModel, CLI_MODELS } from './claude-cli.js';
import { parseCommandLine } from './exec-utils.js';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Campos que admite PATCH /api/projects/:id (fase 3). */
export const PATCHABLE_FIELDS = Object.freeze(['name', 'appUrl', 'repoUrl', 'tags', 'hidden', 'pinned', 'allowedCommands', 'testCommand', 'summary', 'model']);

/** Campos de ejecución: un PATCH que los trae es una acción de ejecución (F4-R63). */
export const EXEC_FIELDS = Object.freeze(['allowedCommands', 'testCommand']);
export const MAX_ALLOWED_COMMANDS = 30;

export const EXEC_ERRORS = Object.freeze({
  invalidCommand: 'Comando no válido: solo letras, números, espacios y . _ : / = @ + - (máx. 200; no puede empezar por - ni terminar en :)',
  tooManyCommands: 'Como mucho 30 comandos autorizados',
  invalidTestCommand: (reason) => `Comando de tests no válido: ${reason}`,
  invalidUrl: 'La URL debe empezar por http:// o https://',
});

/** Feature 13 (design.md §4.3): textos de error del resumen y del modelo. */
export const SETTINGS_ERRORS = Object.freeze({
  summaryNotText: 'El resumen debe ser un texto',
  summaryTooLong: 'El resumen no puede superar 200 caracteres',
  invalidModel: 'Modelo no válido: elige Por defecto, Haiku, Sonnet u Opus',
});

const PATCH_ERRORS = Object.freeze({
  name: 'El nombre es obligatorio',
  appUrl: 'La URL de la app debe ser una cadena',
  repoUrl: 'La URL del repositorio debe ser una cadena',
  tags: 'Las etiquetas deben ser una lista de textos',
  hidden: 'hidden debe ser true o false',
  pinned: 'pinned debe ser true o false',
});

/** '' o una URL con esquema http: o https: (F4-R66). */
export function isHttpUrl(value) {
  if (value === '') return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Lista de comandos autorizados normalizada (recorte, colapso de espacios), válidos y sin duplicados. */
function cleanAllowedCommands(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!isValidAllowedCommand(c)) continue;
    const normalized = normalizeCommand(c);
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Normaliza una entrada de ajustes: hidden/pinned booleanos (false salvo true), tags de cadenas, URLs cadena.
 * Fase 4: allowedCommands y testCommand se normalizan si la entrada los trae (inválidos → [] / ''); si no los trae
 * no se añaden, para no reescribir projects.json con campos vacíos (los valores por defecto los da execSettingsOf).
 */
export function normalizeSettings(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const normalized = {
    ...source,
    appUrl: typeof source.appUrl === 'string' ? source.appUrl : '',
    repoUrl: typeof source.repoUrl === 'string' ? source.repoUrl : '',
    tags: Array.isArray(source.tags) ? source.tags.filter((t) => typeof t === 'string') : [],
    hidden: source.hidden === true,
    pinned: source.pinned === true,
  };
  if ('allowedCommands' in source) normalized.allowedCommands = cleanAllowedCommands(source.allowedCommands);
  if ('testCommand' in source) normalized.testCommand = typeof source.testCommand === 'string' ? source.testCommand : '';
  // Feature 13 (§3.1): el resumen guardado se conserva solo si es válido; si no, se quitan sus tres campos.
  const stored = storedSummaryOf(source);
  delete normalized.summary;
  delete normalized.summarySource;
  delete normalized.summaryAt;
  if (stored) {
    normalized.summary = stored.summary;
    normalized.summarySource = stored.summarySource;
    if (stored.summaryAt) normalized.summaryAt = stored.summaryAt;
  }
  if ('model' in source && !CLI_MODELS.includes(source.model)) delete normalized.model;
  return normalized;
}

/** Copia de la entrada con el resumen manual `value` y su hora, o sin resumen guardado si `value` es '' (pura). */
export function applySummaryChange(entry, value, nowIso) {
  const { summary, summarySource, summaryAt, ...rest } = entry || {};
  if (value === '') return rest;
  return { ...rest, summary: value, summarySource: 'manual', summaryAt: nowIso };
}

/** Copia de la entrada con el modelo recordado, o sin él con 'default' (pura). */
export function applyModelChange(entry, value) {
  const { model, ...rest } = entry || {};
  return value === 'default' ? rest : { ...rest, model: value };
}

/** Modelo recordado válido de una entrada o 'default'. */
export function modelOf(entry) {
  return entry && CLI_MODELS.includes(entry.model) ? entry.model : 'default';
}

/** Ajustes de ejecución efectivos de una entrada (o null): { allowedCommands: [], testCommand: '' } por defecto. */
export function execSettingsOf(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    allowedCommands: cleanAllowedCommands(source.allowedCommands),
    testCommand: typeof source.testCommand === 'string' ? source.testCommand.trim() : '',
  };
}

// ---------- Feature 13: resumen guardado (design.md §3.1, §5.8) ----------

export const STORED_SUMMARY_MAX_CHARS = 200;
export const SUMMARY_SOURCES_STORED = Object.freeze(['manual', 'claude']);

/** Texto con los espacios colapsados y recortado. */
export function collapseSpaces(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Resumen guardado de una entrada ({ summary, summarySource, summaryAt }) o null: `summary` de 1 a 200 caracteres;
 * un `summarySource` distinto de "claude" (o ausente, p. ej. editado a mano) se trata como "manual".
 */
export function storedSummaryOf(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.summary !== 'string') return null;
  const summary = collapseSpaces(entry.summary);
  const length = [...summary].length;
  if (length === 0 || length > STORED_SUMMARY_MAX_CHARS) return null;
  return {
    summary,
    summarySource: entry.summarySource === 'claude' ? 'claude' : 'manual',
    summaryAt: typeof entry.summaryAt === 'string' && entry.summaryAt ? entry.summaryAt : null,
  };
}

/** Carga el registro; si el fichero no existe devuelve { projects: [] }. */
export async function loadRegistry(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { projects: [] };
    throw err;
  }
  const parsed = JSON.parse(raw.replace(/^﻿/, ''));
  const projects = Array.isArray(parsed && parsed.projects) ? parsed.projects.map(normalizeSettings) : [];
  return { projects };
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Corrección T36: el registro VIVO es <datos>/projects.json (panel/data/, ignorado por git), para que fijar, ocultar,
 * altas y ajustes de ejecución no reescriban un fichero versionado. Al arrancar: si ya existe, se usa; si no, se copia
 * una vez el heredado panel/projects.json (sin borrarlo); si tampoco existe, se siembra con projects.example.json.
 * Devuelve 'existing' | 'migrated' | 'seeded' | 'none'. Nunca pisa un registro de datos existente.
 */
export async function prepareProjectsFile({ dataFile, legacyFile, exampleFile, log = console.log } = {}) {
  if (await fileExists(dataFile)) return 'existing';
  const source = (legacyFile && (await fileExists(legacyFile))) ? legacyFile : (exampleFile && (await fileExists(exampleFile))) ? exampleFile : null;
  if (!source) return 'none';
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  try {
    await fs.copyFile(source, dataFile, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    if (err && err.code === 'EEXIST') return 'existing';
    throw err;
  }
  if (source === legacyFile) {
    log(`Registro de proyectos migrado a ${dataFile}`);
    return 'migrated';
  }
  log(`Registro de proyectos creado en ${dataFile} a partir de projects.example.json`);
  return 'seeded';
}

/** Guarda el registro de forma atómica (escribe .tmp y renombra). */
export async function saveRegistry(file, registry) {
  const tmp = `${file}.tmp`;
  const content = JSON.stringify({ projects: registry.projects }, null, 2) + '\n';
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

/** Convierte un nombre en un id: minúsculas, sin acentos, no alfanuméricos → "-", sin guiones repetidos ni en extremos. */
export function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function reject(error, field) {
  return { ok: false, status: 400, error, field };
}

/**
 * Valida una alta. Comprueba en orden: name, path (cadena, absoluta, directorio), id (formato, unicidad).
 * Los mensajes de error nunca incluyen la ruta recibida.
 */
export async function validateNewProject(input, existing = [], { statFn = fs.stat } = {}) {
  const body = input && typeof input === 'object' ? input : {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return reject('El nombre es obligatorio', 'name');

  const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
  if (!rawPath) return reject('La ruta local es obligatoria', 'path');
  if (!path.isAbsolute(rawPath)) return reject('La ruta debe ser absoluta', 'path');
  const resolvedPath = path.resolve(rawPath);
  let stats;
  try {
    stats = await statFn(resolvedPath);
  } catch {
    return reject('La ruta no existe o no es un directorio', 'path');
  }
  if (!stats || typeof stats.isDirectory !== 'function' || !stats.isDirectory()) {
    return reject('La ruta no existe o no es un directorio', 'path');
  }

  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : slugify(name);
  if (!ID_PATTERN.test(id)) {
    return reject('El id solo admite minúsculas, dígitos y guiones (máx. 64 caracteres)', 'id');
  }
  if (existing.some((p) => p && p.id === id)) {
    return reject('Ya existe un proyecto con ese id', 'id');
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
    : [];

  const appUrl = typeof body.appUrl === 'string' ? body.appUrl.trim() : '';
  const repoUrl = typeof body.repoUrl === 'string' ? body.repoUrl.trim() : '';
  if (!isHttpUrl(appUrl)) return reject(EXEC_ERRORS.invalidUrl, 'appUrl');
  if (!isHttpUrl(repoUrl)) return reject(EXEC_ERRORS.invalidUrl, 'repoUrl');

  return {
    ok: true,
    project: {
      id,
      name,
      path: resolvedPath,
      appUrl,
      repoUrl,
      tags,
    },
  };
}

/** Elimina un proyecto por id. Devuelve { removed, registry } sin mutar el registro original. */
export function removeProject(registry, id) {
  const projects = registry.projects.filter((p) => p.id !== id);
  return { removed: projects.length !== registry.projects.length, registry: { projects } };
}

function patchAllowedCommands(value) {
  if (!Array.isArray(value) || !value.every((c) => isValidAllowedCommand(c))) return { ok: false, error: EXEC_ERRORS.invalidCommand };
  const list = cleanAllowedCommands(value);
  if (list.length > MAX_ALLOWED_COMMANDS) return { ok: false, error: EXEC_ERRORS.tooManyCommands };
  return { ok: true, value: list };
}

function patchTestCommand(value) {
  if (typeof value !== 'string') return { ok: false, error: EXEC_ERRORS.invalidTestCommand('vacío') };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: true, value: '' };
  const parsed = parseCommandLine(trimmed);
  return parsed.ok ? { ok: true, value: trimmed } : { ok: false, error: EXEC_ERRORS.invalidTestCommand(parsed.error) };
}

function patchValue(field, value) {
  if (field === 'name') return typeof value === 'string' && value.trim() ? { ok: true, value: value.trim() } : { ok: false };
  if (field === 'appUrl' || field === 'repoUrl') {
    if (typeof value !== 'string') return { ok: false };
    const trimmed = value.trim();
    return isHttpUrl(trimmed) ? { ok: true, value: trimmed } : { ok: false, error: EXEC_ERRORS.invalidUrl };
  }
  if (field === 'allowedCommands') return patchAllowedCommands(value);
  if (field === 'summary') {
    if (typeof value !== 'string') return { ok: false, error: SETTINGS_ERRORS.summaryNotText };
    const clean = collapseSpaces(value);
    return [...clean].length > STORED_SUMMARY_MAX_CHARS ? { ok: false, error: SETTINGS_ERRORS.summaryTooLong } : { ok: true, value: clean };
  }
  if (field === 'model') return isValidModel(value) ? { ok: true, value } : { ok: false, error: SETTINGS_ERRORS.invalidModel };
  if (field === 'testCommand') return patchTestCommand(value);
  if (field === 'tags') {
    if (!Array.isArray(value) || !value.every((t) => typeof t === 'string')) return { ok: false };
    return { ok: true, value: value.map((t) => t.trim()).filter(Boolean) };
  }
  return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
}

/**
 * Valida el cuerpo de un PATCH (design.md §5.4): solo PATCHABLE_FIELDS; el resto se ignora.
 * Devuelve { ok: true, changes } o { ok: false, status: 400, error, field? }.
 */
export function validatePatch(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const changes = {};
  for (const field of PATCHABLE_FIELDS) {
    if (source[field] === undefined) continue;
    const result = patchValue(field, source[field]);
    if (!result.ok) return reject(result.error || PATCH_ERRORS[field], field);
    changes[field] = result.value;
  }
  if (Object.keys(changes).length === 0) return { ok: false, status: 400, error: 'Nada que actualizar' };
  return { ok: true, changes };
}

/** Sustituye la entrada con el mismo id o la añade al final. No muta el registro recibido. */
export function upsertSettings(registry, entry) {
  const projects = registry.projects.slice();
  const index = projects.findIndex((p) => p && p.id === entry.id);
  if (index >= 0) projects[index] = entry;
  else projects.push(entry);
  return { projects };
}
