// Descubrimiento de proyectos y sesiones de Claude Code (design.md §5.2).
// SOLO LECTURA sobre <claudeHome>/.claude.json y <claudeHome>/.claude/projects/: este módulo únicamente importa
// funciones de lectura (un test estático lo comprueba). Nunca crea, modifica ni borra nada en esa carpeta.
import { readdir, stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

import { pathKey, lastSegment, encodeProjectPath, looseEncodedKey } from './path-key.js';

export const CONFIG_FILE_NAME = '.claude.json';
export const PROJECTS_DIR_PARTS = ['.claude', 'projects'];
export const MAX_SESSION_FILE_BYTES = 20 * 1024 * 1024;
export const HEAD_LINES = 200;
export const TITLE_MAX_CHARS = 80;
export const DEFAULT_TTL_MS = 30_000;
export const SKIPPED_PROMPT_PREFIXES = ['<command-', '<local-command-'];

const SESSION_EXTENSION = '.jsonl';
const MAX_STREAM_CHUNK = 64 * 1024;
const MIN_STREAM_CHUNK = 256;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rutas derivadas del directorio de Claude. */
export function resolveClaudePaths(claudeHome) {
  return {
    claudeHome,
    configFile: path.join(claudeHome, CONFIG_FILE_NAME),
    projectsDir: path.join(claudeHome, ...PROJECTS_DIR_PARTS),
  };
}

// ---------- Reglas de texto (§5.2.1) ----------

/** Colapsa espacios y recorta a TITLE_MAX_CHARS puntos de código (+ "…" si era más largo). */
export function clipTitle(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const chars = [...clean];
  return chars.length > TITLE_MAX_CHARS ? chars.slice(0, TITLE_MAX_CHARS).join('') + '…' : clean;
}

/** Texto de un contenido de mensaje: cadena, o el primer bloque { type: 'text', text } de un array; si no, null. */
export function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const block = content.find((b) => isPlainObject(b) && b.type === 'text' && typeof b.text === 'string');
    return block ? block.text : null;
  }
  return null;
}

function parseTimestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

/** Último prompt de una entrada de .claude.json (mayor timestamp o, si no hay, el primero del array). */
function pickLastPrompt(entry) {
  const history = isPlainObject(entry) && Array.isArray(entry.history) ? entry.history : [];
  const candidates = history.filter((h) => isPlainObject(h) && typeof h.display === 'string' && h.display.trim() !== '');
  if (candidates.length === 0) return null;
  let best = null;
  let bestTs = -Infinity;
  for (const item of candidates) {
    const ts = parseTimestamp(item.timestamp);
    if (!Number.isNaN(ts) && ts > bestTs) {
      best = item;
      bestTs = ts;
    }
  }
  return clipTitle((best || candidates[0]).display);
}

// ---------- Fichero de configuración ----------

/**
 * Lee <claudeHome>/.claude.json. ENOENT → { exists: false }. JSON roto o `projects` no objeto → exists true,
 * mapa vacío y UN aviso con `log`. Devuelve Map<pathKey, { path, lastPrompt }>.
 */
export async function readClaudeConfig(configFile, { log = console.error } = {}) {
  const projects = new Map();
  let raw;
  try {
    raw = await readFile(configFile, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { exists: false, projects };
    log('[panel] .claude.json ilegible, se ignora:', err && err.message ? err.message : String(err));
    return { exists: true, projects };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (err) {
    log('[panel] .claude.json ilegible, se ignora:', err.message);
    return { exists: true, projects };
  }
  if (!isPlainObject(parsed)) {
    log('[panel] .claude.json ilegible, se ignora:', 'no es un objeto JSON');
    return { exists: true, projects };
  }
  // Un .claude.json sin clave `projects` es válido (instalación recién hecha): no hay proyectos y no se avisa.
  if (parsed.projects === undefined) return { exists: true, projects };
  if (!isPlainObject(parsed.projects)) {
    log('[panel] .claude.json ilegible, se ignora:', 'la clave "projects" no es un objeto');
    return { exists: true, projects };
  }
  for (const [projectPath, entry] of Object.entries(parsed.projects)) {
    const key = pathKey(projectPath);
    if (!key || projects.has(key)) continue;
    projects.set(key, { path: projectPath, lastPrompt: pickLastPrompt(entry) });
  }
  return { exists: true, projects };
}

// ---------- Sesiones ----------

function newAccumulator() {
  return { firstCwd: null, minTs: null, maxTs: null, messageCount: 0, lastBranch: null, lastSummary: null, firstUserText: null };
}

function isUserPromptCandidate(line, text) {
  if (line.type !== 'user') return false;
  const role = isPlainObject(line.message) ? line.message.role : undefined;
  if (role !== undefined && role !== 'user') return false;
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !SKIPPED_PROMPT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Incorpora una línea cruda del .jsonl al acumulador. Las líneas que no son un objeto JSON se ignoran. */
function accumulateLine(acc, rawLine) {
  const text = rawLine.trim();
  if (!text) return;
  let line;
  try {
    line = JSON.parse(text);
  } catch {
    return;
  }
  if (!isPlainObject(line)) return;

  if (acc.firstCwd === null && typeof line.cwd === 'string' && line.cwd !== '') acc.firstCwd = line.cwd;
  const ts = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
  if (!Number.isNaN(ts)) {
    if (acc.minTs === null || ts < acc.minTs) acc.minTs = ts;
    if (acc.maxTs === null || ts > acc.maxTs) acc.maxTs = ts;
  }
  if (line.type === 'user' || line.type === 'assistant') acc.messageCount += 1;
  if (typeof line.gitBranch === 'string' && line.gitBranch !== '') acc.lastBranch = line.gitBranch;
  if (line.type === 'summary' && typeof line.summary === 'string' && line.summary.trim() !== '') acc.lastSummary = line.summary;
  if (acc.firstUserText === null && line.type === 'user') {
    const userText = extractText(isPlainObject(line.message) ? line.message.content : undefined);
    if (isUserPromptCandidate(line, userText)) acc.firstUserText = userText;
  }
}

/** Lee como mucho `headLines` líneas con un stream que se destruye en cuanto las tiene (no lee el resto). */
function readHeadLines(file, { headLines, chunkSize, stats }) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file, { highWaterMark: chunkSize });
    const lines = [];
    let done = false;
    stream.on('data', (chunk) => {
      stats.bytesRead += chunk.length;
    });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const finish = () => {
      if (done) return;
      done = true;
      rl.close();
      stream.destroy();
      resolve(lines);
    };
    rl.on('line', (line) => {
      if (done) return;
      lines.push(line);
      if (lines.length >= headLines) finish();
    });
    rl.on('close', finish);
    stream.on('error', (err) => {
      if (done) return;
      done = true;
      rl.close();
      reject(err);
    });
  });
}

/**
 * Parsea un fichero de sesión. Nunca lanza por su contenido (sí por E/S). Si supera `maxFileBytes` lee solo
 * las primeras `headLines` líneas (modo truncado). Devuelve { session, cwd }.
 */
export async function parseSessionFile(file, { maxFileBytes = MAX_SESSION_FILE_BYTES, headLines = HEAD_LINES, stats, fileStat } = {}) {
  const counters = stats || { bytesRead: 0 };
  const info = fileStat || (await stat(file));
  const id = path.basename(file, SESSION_EXTENSION);
  const mtimeIso = info.mtime.toISOString();
  const truncated = info.size > maxFileBytes;
  const acc = newAccumulator();

  if (truncated) {
    // Trozos pequeños para no leer de más: como máximo una cuarta parte del umbral (y nunca más de 64 KB).
    const chunkSize = Math.max(MIN_STREAM_CHUNK, Math.min(MAX_STREAM_CHUNK, Math.floor(maxFileBytes / 4)));
    const lines = await readHeadLines(file, { headLines, chunkSize, stats: counters });
    for (const line of lines) accumulateLine(acc, line);
  } else {
    const content = await readFile(file, 'utf8');
    counters.bytesRead += Buffer.byteLength(content);
    for (const line of content.split('\n')) accumulateLine(acc, line);
  }

  const title = acc.lastSummary ?? (acc.firstUserText !== null ? clipTitle(acc.firstUserText) : null) ?? id;
  const startedAt = acc.minTs !== null ? new Date(acc.minTs).toISOString() : mtimeIso;
  const lastActivityAt = truncated ? mtimeIso : acc.maxTs !== null ? new Date(acc.maxTs).toISOString() : mtimeIso;
  return {
    session: {
      id,
      title,
      startedAt,
      lastActivityAt,
      messageCount: truncated ? null : acc.messageCount,
      gitBranch: acc.lastBranch,
      truncated,
    },
    cwd: acc.firstCwd,
  };
}

// ---------- Descubrimiento ----------

async function isDirectory(dir) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function compareSessions(a, b) {
  if (a.lastActivityAt !== b.lastActivityAt) return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
  return compareText(a.id, b.id);
}

/** Busca en la configuración una clave cuya codificación case con el nombre de la carpeta (§5.1). */
function matchConfigKey(folder, configProjects) {
  const loose = looseEncodedKey(folder);
  for (const entry of configProjects.values()) {
    const encoded = encodeProjectPath(entry.path);
    if (encoded === folder) return entry.path;
  }
  for (const entry of configProjects.values()) {
    if (looseEncodedKey(encodeProjectPath(entry.path)) === loose) return entry.path;
  }
  return null;
}

/** Escanea una carpeta de proyecto: sesiones (con caché por ruta, mtime y tamaño) y primer cwd. */
async function scanFolder(folderDir, { fileCache, seen, maxFileBytes, headLines, stats, log }) {
  let entries;
  try {
    entries = await readdir(folderDir, { withFileTypes: true });
  } catch (err) {
    log('[panel] No se pudo leer la carpeta de Claude Code', path.basename(folderDir), '-', err && err.message ? err.message : err);
    return { sessions: [], cwd: null };
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(SESSION_EXTENSION))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const sessions = [];
  let cwd = null;
  for (const name of files) {
    const file = path.join(folderDir, name);
    try {
      const info = await stat(file);
      seen.add(file);
      const cached = fileCache.get(file);
      let parsed;
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        parsed = cached.result;
        stats.filesCached += 1;
      } else {
        parsed = await parseSessionFile(file, { maxFileBytes, headLines, stats, fileStat: info });
        fileCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, result: parsed });
        stats.filesParsed += 1;
      }
      sessions.push({ ...parsed.session });
      if (cwd === null && parsed.cwd) cwd = parsed.cwd;
    } catch (err) {
      log('[panel] No se pudo leer una sesión de Claude Code', name, '-', err && err.message ? err.message : err);
    }
  }
  return { sessions, cwd };
}

/**
 * Descubre los proyectos de Claude Code (algoritmo de design.md §5.2). Solo lee.
 * Devuelve { available, claudeHome, projectsDir, configFile, projects, scannedAt, stats }.
 */
export async function discoverClaudeProjects({
  claudeHome,
  now = Date.now,
  log = console.error,
  fileCache = new Map(),
  maxFileBytes = MAX_SESSION_FILE_BYTES,
  headLines = HEAD_LINES,
} = {}) {
  const paths = resolveClaudePaths(claudeHome);
  const stats = { filesParsed: 0, filesCached: 0, bytesRead: 0, fromCache: false };
  const config = await readClaudeConfig(paths.configFile, { log });
  const dirExists = await isDirectory(paths.projectsDir);
  const available = config.exists || dirExists;

  const merged = new Map();
  for (const [key, entry] of config.projects) {
    merged.set(key, { path: entry.path, encodedName: null, unresolved: false, sessions: [] });
  }

  if (dirExists) {
    const seen = new Set();
    let folders = [];
    try {
      folders = (await readdir(paths.projectsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (err) {
      log('[panel] No se pudo leer el directorio de proyectos de Claude Code:', err && err.message ? err.message : err);
    }
    for (const folder of folders) {
      const { sessions, cwd } = await scanFolder(path.join(paths.projectsDir, folder), { fileCache, seen, maxFileBytes, headLines, stats, log });
      const resolvedPath = cwd ?? matchConfigKey(folder, config.projects);
      const key = resolvedPath ? pathKey(resolvedPath) : `unresolved:${folder}`;
      const existing = merged.get(key);
      if (existing) {
        if (existing.encodedName === null) existing.encodedName = folder;
        existing.sessions.push(...sessions);
      } else {
        merged.set(key, { path: resolvedPath, encodedName: folder, unresolved: !resolvedPath, sessions });
      }
    }
    // La caché solo conserva los ficheros que siguen existiendo.
    for (const file of [...fileCache.keys()]) if (!seen.has(file)) fileCache.delete(file);
  }

  const projects = [...merged.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([key, p]) => {
      const sessions = p.sessions.sort(compareSessions);
      const configEntry = config.projects.get(key);
      return {
        path: p.path,
        name: p.unresolved ? p.encodedName : lastSegment(p.path),
        encodedName: p.encodedName,
        unresolved: p.unresolved,
        source: 'claude',
        sessionCount: sessions.length,
        lastActivityAt: sessions.length ? sessions[0].lastActivityAt : null,
        lastPrompt: configEntry ? configEntry.lastPrompt : null,
        sessions,
      };
    });

  return {
    available,
    claudeHome: paths.claudeHome,
    projectsDir: paths.projectsDir,
    configFile: paths.configFile,
    projects,
    scannedAt: new Date(now()).toISOString(),
    stats,
  };
}

/**
 * Descubridor con caché: por fichero (ruta, mtime, tamaño) y TTL del escaneo completo (`ttlMs`).
 * `scan({ force })` salta el TTL; dos scan() simultáneos comparten la misma promesa.
 */
export function createClaudeDiscovery({ claudeHome, now = Date.now, ttlMs = DEFAULT_TTL_MS, log = console.error, maxFileBytes, headLines } = {}) {
  const cache = new Map();
  let last = null;
  let lastAt = 0;
  let inflight = null;

  function scan({ force = false } = {}) {
    if (inflight) return inflight;
    if (!force && last && now() - lastAt < ttlMs) {
      return Promise.resolve({ ...last, stats: { ...last.stats, fromCache: true } });
    }
    const options = { claudeHome, now, log, fileCache: cache };
    if (maxFileBytes !== undefined) options.maxFileBytes = maxFileBytes;
    if (headLines !== undefined) options.headLines = headLines;
    inflight = discoverClaudeProjects(options).then(
      (result) => {
        last = result;
        lastAt = now();
        inflight = null;
        return result;
      },
      (err) => {
        inflight = null;
        throw err;
      },
    );
    return inflight;
  }

  function status() {
    if (!last) return null;
    return {
      available: last.available,
      claudeHome: last.claudeHome,
      projectsDir: last.projectsDir,
      projectCount: last.projects.length,
      sessionCount: last.projects.reduce((sum, p) => sum + p.sessionCount, 0),
      lastScanAt: last.scannedAt,
    };
  }

  return { scan, status, cache };
}
