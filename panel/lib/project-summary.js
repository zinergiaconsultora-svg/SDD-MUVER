// Resumen automático "de qué va" un proyecto (feature 13, design.md §5.1): sin coste y SOLO LECTURA.
// Orígenes en orden: description de package.json → primer párrafo de texto del README → primer párrafo de CLAUDE.md.
// Cada fichero se lee como mucho 16 KB; nunca lanza; caché en memoria de 5 min por carpeta. Regla "nada recortado":
// se toma una frase completa o se corta en límite de palabra, sin añadir «…».
import fsp from 'node:fs/promises';
import path from 'node:path';

import { pathKey } from './path-key.js';
import { storedSummaryOf } from './registry.js';

// Nombre distinto del SUMMARY_MAX_CHARS de claude-cli.js, que es otra cosa (resumen de argumentos de herramientas).
export const AUTO_SUMMARY_MAX_CHARS = 160;
export const MAX_READ_BYTES = 16384;
export const SUMMARY_CACHE_TTL_MS = 300000;
export const MIN_PARAGRAPH_CHARS = 12;
export const README_NAMES = Object.freeze(['readme.md', 'readme.markdown', 'readme.txt', 'readme', 'leeme.md']);
export const CLAUDE_MD = 'claude.md';

/** Inicios de párrafo de plantillas (se comparan con el párrafo limpio, en minúsculas, con startsWith). */
export const BOILERPLATE_PATTERNS = Object.freeze([
  'this template provides a minimal setup',
  'this project was bootstrapped with',
  'this is a next.js project bootstrapped with',
  'this file provides guidance to claude code',
  'currently, two official plugins are available',
]);

const EMPTY = Object.freeze({ summary: null, summarySource: null, summaryAt: null });

/** Primeros MAX_READ_BYTES de un fichero como texto UTF-8 (bytes inválidos → U+FFFD), sin BOM; null ante cualquier error. */
export async function readHead(file, { fsImpl = fsp } = {}) {
  let handle = null;
  try {
    handle = await fsImpl.open(file, 'r');
    const buffer = Buffer.alloc(MAX_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Ignorado: el fichero ya se leyó (o no se pudo leer).
      }
    }
  }
}

/** Texto hasta el primer . ! ? seguido de espacio o del final (incluido el signo); sin signo, el texto entero. */
export function firstSentence(text) {
  const value = String(text ?? '');
  const match = /[.!?](?=\s|$)/u.exec(value);
  return match ? value.slice(0, match.index + 1) : value;
}

/** ≤ max puntos de código: igual; si no, los max primeros cortados en el último espacio. Nunca añade «…». */
export function clipAtWord(text, max) {
  const points = [...String(text ?? '')];
  if (points.length <= max) return points.join('');
  const head = points.slice(0, max).join('');
  const space = head.lastIndexOf(' ');
  return (space > 0 ? head.slice(0, space) : head).trimEnd();
}

/** Primera frase y, si aún supera `max`, corte en límite de palabra. */
export function toOneSentence(text, max) {
  return clipAtWord(firstSentence(text), max);
}

const collapse = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const FENCE_RE = /^\s*(```|~~~)/;
const SETEXT_RE = /^\s*(=+|-+)\s*$/;
const LIST_RE = /^([-*+]\s|\d+[.)]\s)/;

/** true si el bloque (líneas no vacías) no es un párrafo de texto (título, HTML, tabla, lista, código indentado). */
function isSkippedBlock(lines) {
  const raw = lines[0];
  if (/^( {4}|\t)/.test(raw)) return true;
  const first = raw.trimStart();
  if (first.startsWith('#') || first.startsWith('<') || first.startsWith('|')) return true;
  if (LIST_RE.test(first)) return true;
  if (lines.length > 1 && SETEXT_RE.test(lines[1])) return true;
  return false;
}

/** Quita el Markdown en línea de un bloque y colapsa los espacios. */
function cleanBlock(lines) {
  let text = lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' ');
  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|[^\p{L}\p{N}])[*_](?=\S)/gu, '$1')
    .replace(/(\S)[*_](?=[^\p{L}\p{N}]|$)/gu, '$1');
  return collapse(text);
}

/** Bloques de líneas no vacías, sin cabecera YAML, comentarios HTML ni bloques de código con valla. */
function textBlocks(markdown) {
  let text = String(markdown ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  let lines = text.split('\n');
  if (lines.length && lines[0].trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    lines = end > 0 ? lines.slice(end + 1) : [];
  }
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE_RE.exec(lines[i]);
    if (fence) {
      flush();
      const marker = fence[1];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) i += 1;
      continue;
    }
    if (lines[i].trim() === '') flush();
    else current.push(lines[i]);
  }
  flush();
  return blocks;
}

/** Primer párrafo de texto de un Markdown (§5.1) reducido a una frase; null si no hay o si es una plantilla. */
export function extractFirstParagraph(markdown) {
  for (const block of textBlocks(markdown)) {
    if (isSkippedBlock(block)) continue;
    const paragraph = cleanBlock(block);
    if ([...paragraph].length < MIN_PARAGRAPH_CHARS || !/\p{L}/u.test(paragraph)) continue;
    const lower = paragraph.toLowerCase();
    if (BOILERPLATE_PATTERNS.some((pattern) => lower.startsWith(pattern))) return null;
    return toOneSentence(paragraph, AUTO_SUMMARY_MAX_CHARS);
  }
  return null;
}

/** `description` de package.json (primera frase, ≤ 160 en palabra entera) o null. Tolera JSON roto o truncado. */
export async function readPackageDescription(dir, { fsImpl = fsp } = {}) {
  const text = await readHead(path.join(dir, 'package.json'), { fsImpl });
  if (text === null) return null;
  let description;
  try {
    const parsed = JSON.parse(text);
    description = parsed && typeof parsed === 'object' ? parsed.description : undefined;
  } catch {
    const match = /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
    if (match) {
      try {
        description = JSON.parse(`"${match[1]}"`);
      } catch {
        description = undefined;
      }
    }
  }
  if (typeof description !== 'string') return null;
  const clean = collapse(description);
  return clean ? toOneSentence(clean, AUTO_SUMMARY_MAX_CHARS) : null;
}

async function listNames(dir, fsImpl) {
  try {
    return await fsImpl.readdir(dir);
  } catch {
    return [];
  }
}

function findName(names, wanted) {
  return names.find((n) => typeof n === 'string' && n.toLowerCase() === wanted) ?? null;
}

/** Nombre real del primer README presente según README_NAMES (sin distinguir mayúsculas), o null. */
export async function findReadme(dir, { fsImpl = fsp } = {}) {
  const names = await listNames(dir, fsImpl);
  for (const wanted of README_NAMES) {
    const found = findName(names, wanted);
    if (found) return found;
  }
  return null;
}

async function paragraphOf(dir, name, fsImpl) {
  if (!name) return null;
  const text = await readHead(path.join(dir, name), { fsImpl });
  return text === null ? null : extractFirstParagraph(text);
}

/** Resumen automático { summary, summarySource } (package → readme → claude-md) o null. Nunca lanza. */
export async function readAutoSummary(dir, { fsImpl = fsp } = {}) {
  if (typeof dir !== 'string' || !dir) return null;
  try {
    const fromPackage = await readPackageDescription(dir, { fsImpl });
    if (fromPackage) return { summary: fromPackage, summarySource: 'package' };
    const names = await listNames(dir, fsImpl);
    let readme = null;
    for (const wanted of README_NAMES) {
      readme = findName(names, wanted);
      if (readme) break;
    }
    const fromReadme = await paragraphOf(dir, readme, fsImpl);
    if (fromReadme) return { summary: fromReadme, summarySource: 'readme' };
    const fromClaudeMd = await paragraphOf(dir, findName(names, CLAUDE_MD), fsImpl);
    if (fromClaudeMd) return { summary: fromClaudeMd, summarySource: 'claude-md' };
  } catch {
    // Cualquier fallo inesperado: sin resumen automático.
  }
  return null;
}

/** Lector con caché por carpeta (también guarda null) y deduplicación de lecturas simultáneas. */
export function createSummaryReader({ now = Date.now, ttlMs = SUMMARY_CACHE_TTL_MS, fsImpl = fsp } = {}) {
  const cache = new Map(); // pathKey → { value, at }
  const inflight = new Map(); // pathKey → Promise
  async function read(dir) {
    const key = pathKey(dir);
    if (!key) return null;
    const cached = cache.get(key);
    if (cached && now() - cached.at < ttlMs) return cached.value;
    if (inflight.has(key)) return inflight.get(key);
    const pending = readAutoSummary(dir, { fsImpl }).then((value) => {
      cache.set(key, { value, at: now() });
      inflight.delete(key);
      return value;
    });
    inflight.set(key, pending);
    return pending;
  }
  return { read };
}

/** Resumen de un proyecto: guardado (manual o claude) → automático → nulos. Los automáticos llevan summaryAt null. */
export async function resolveSummary(entry, dir, reader) {
  const stored = storedSummaryOf(entry);
  if (stored) return stored;
  if (!dir || !reader) return { ...EMPTY };
  const auto = await reader.read(dir);
  return auto ? { summary: auto.summary, summarySource: auto.summarySource, summaryAt: null } : { ...EMPTY };
}
