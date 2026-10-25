// Registro de proyectos (panel/projects.json): carga, guardado atómico y validación de altas/bajas.
import fs from 'node:fs/promises';
import path from 'node:path';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
  const projects = Array.isArray(parsed && parsed.projects) ? parsed.projects : [];
  return { projects };
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

  return {
    ok: true,
    project: {
      id,
      name,
      path: resolvedPath,
      appUrl: typeof body.appUrl === 'string' ? body.appUrl.trim() : '',
      repoUrl: typeof body.repoUrl === 'string' ? body.repoUrl.trim() : '',
      tags,
    },
  };
}

/** Elimina un proyecto por id. Devuelve { removed, registry } sin mutar el registro original. */
export function removeProject(registry, id) {
  const projects = registry.projects.filter((p) => p.id !== id);
  return { removed: projects.length !== registry.projects.length, registry: { projects } };
}
