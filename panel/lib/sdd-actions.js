// Botones del flujo SDD y comando de tests (design.md §5.7).
// "Aprobar spec" edita feature_list.json POR TEXTO: un escáner JSON mínimo localiza el literal del `status` de la
// feature y solo se sustituye ese rango (BOM, \r\n, indentación, orden y escapes quedan byte a byte). Se verifica
// re-parseando antes de escribir (.tmp + rename).
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { parseCommandLine, formatCommandLine, resolveExecutable, CMD_SCRIPT_ERROR } from './exec-utils.js';
import { pathKey, isWindowsPath } from './path-key.js';

export const FEATURE_LIST_FILE = 'feature_list.json';

const SDD_ERRORS = Object.freeze({
  noSdd: 'El proyecto no tiene arnés SDD (feature_list.json ausente o no válido)',
  notSpecReady: 'La feature no está en spec_ready',
  otherInProgress: (id, slug) => `Ya hay otra feature in_progress: #${id} ${slug}`,
  editFailed: 'No se pudo editar feature_list.json sin alterar el resto del fichero',
  noTestCommand: 'Configura el comando de tests del proyecto (Ajustes de ejecución → Comando de tests)',
  invalidTestCommand: (reason) => `Comando de tests no válido: ${reason}`,
});

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---------- Escáner JSON mínimo ----------

const LITERAL_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

/** Error interno del escáner (texto que no es JSON). */
class ScanError extends Error {}

function createScanner(text) {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  function skipWs() {
    while (pos < text.length && ' \t\r\n'.includes(text[pos])) pos += 1;
  }

  function expect(ch) {
    skipWs();
    if (text[pos] !== ch) throw new ScanError(`se esperaba ${ch}`);
    pos += 1;
  }

  /** Lee una cadena y devuelve { value, start, end } (rango con comillas). */
  function readString() {
    skipWs();
    if (text[pos] !== '"') throw new ScanError('se esperaba una cadena');
    const start = pos;
    pos += 1;
    while (pos < text.length && text[pos] !== '"') pos += text[pos] === '\\' ? 2 : 1;
    if (pos >= text.length) throw new ScanError('cadena sin cerrar');
    pos += 1;
    return { value: JSON.parse(text.slice(start, pos)), start, end: pos };
  }

  function skipValue() {
    skipWs();
    const ch = text[pos];
    if (ch === '"') return readString();
    if (ch === '{') return eachMember(() => skipValue());
    if (ch === '[') return eachElement(() => skipValue());
    LITERAL_RE.lastIndex = pos;
    const match = LITERAL_RE.exec(text);
    if (!match) throw new ScanError('valor no reconocido');
    pos += match[0].length;
    return null;
  }

  /** Recorre un objeto llamando a onMember(clave) con `pos` al principio del valor (que onMember debe consumir). */
  function eachMember(onMember) {
    expect('{');
    skipWs();
    if (text[pos] === '}') {
      pos += 1;
      return null;
    }
    for (;;) {
      const key = readString().value;
      expect(':');
      onMember(key);
      skipWs();
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }
      expect('}');
      return null;
    }
  }

  function eachElement(onElement) {
    expect('[');
    skipWs();
    if (text[pos] === ']') {
      pos += 1;
      return null;
    }
    for (let i = 0; ; i++) {
      onElement(i);
      skipWs();
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }
      expect(']');
      return null;
    }
  }

  function peek() {
    skipWs();
    return text[pos];
  }

  return { eachMember, eachElement, skipValue, readString, peek };
}

/**
 * Rango { start, end } (comillas incluidas) del valor de la ÚLTIMA clave "status" del objeto features[index] de la
 * ÚLTIMA clave "features" de la raíz, o null. Solo mira claves de la raíz, elementos de features y sus claves.
 */
export function locateFeatureStatus(text, index) {
  const scanner = createScanner(String(text));
  let found = null;
  try {
    scanner.eachMember((rootKey) => {
      if (rootKey !== 'features' || scanner.peek() !== '[') {
        scanner.skipValue();
        return;
      }
      let current = null;
      scanner.eachElement((i) => {
        if (i !== index || scanner.peek() !== '{') {
          scanner.skipValue();
          return;
        }
        scanner.eachMember((key) => {
          if (key === 'status' && scanner.peek() === '"') {
            const { start, end } = scanner.readString();
            current = { start, end };
          } else {
            if (key === 'status') current = null;
            scanner.skipValue();
          }
        });
      });
      found = current;
    });
  } catch (err) {
    if (err instanceof ScanError || err instanceof SyntaxError) return null;
    throw err;
  }
  return found;
}

/**
 * Cambia el status de la feature `featureId` de `from` a `to` editando solo ese literal. Devuelve el texto nuevo o
 * lanza Error('not-found') / Error('verify').
 */
export function setFeatureStatus(text, featureId, from, to, { locateFn = locateFeatureStatus } = {}) {
  const parsed = JSON.parse(stripBom(text));
  const features = parsed && Array.isArray(parsed.features) ? parsed.features : [];
  const index = features.findIndex((f) => f && typeof f === 'object' && String(f.id) === String(featureId) && f.status === from);
  if (index < 0) throw new Error('not-found');
  const range = locateFn(text, index);
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end > text.length || range.start >= range.end) {
    throw new Error('verify');
  }
  const next = text.slice(0, range.start) + JSON.stringify(to) + text.slice(range.end);
  const expected = structuredClone(parsed);
  expected.features[index].status = to;
  let reparsed;
  try {
    reparsed = JSON.parse(stripBom(next));
  } catch {
    throw new Error('verify');
  }
  if (!isDeepStrictEqual(reparsed, expected)) throw new Error('verify');
  return next;
}

/** Lee feature_list.json: { ok: true, text, features } | { ok: false } si no hay arnés válido. */
export async function readHarness(projectDir) {
  let text;
  try {
    text = await fs.readFile(path.join(projectDir, FEATURE_LIST_FILE), 'utf8');
  } catch {
    return { ok: false };
  }
  try {
    const parsed = JSON.parse(stripBom(text));
    if (!parsed || !Array.isArray(parsed.features)) return { ok: false };
    return { ok: true, text, features: parsed.features.filter((f) => f && typeof f === 'object') };
  } catch {
    return { ok: false };
  }
}

const locks = new Map();

/** Cerrojo en memoria por carpeta (cola de promesas). */
function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.catch(() => {});
  locks.set(key, settled);
  settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return next;
}

/** Aprobar spec: spec_ready → in_progress. → { ok, status, error?, feature? }. */
export function approveSpec(projectDir, featureId) {
  return withLock(path.resolve(projectDir), async () => {
    const harness = await readHarness(projectDir);
    if (!harness.ok) return { ok: false, status: 409, error: SDD_ERRORS.noSdd };
    const feature = harness.features.find((f) => String(f.id) === String(featureId));
    if (!feature || feature.status !== 'spec_ready') return { ok: false, status: 409, error: SDD_ERRORS.notSpecReady };
    const other = harness.features.find((f) => f.status === 'in_progress');
    if (other) return { ok: false, status: 409, error: SDD_ERRORS.otherInProgress(other.id, other.slug) };
    let next;
    try {
      next = setFeatureStatus(harness.text, featureId, 'spec_ready', 'in_progress');
    } catch {
      return { ok: false, status: 500, error: SDD_ERRORS.editFailed };
    }
    const file = path.join(projectDir, FEATURE_LIST_FILE);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, next, 'utf8');
    await fs.rename(tmp, file);
    return { ok: true, status: 200, feature: { id: feature.id, slug: feature.slug, status: 'in_progress' } };
  });
}

function hasSeparator(token) {
  return token.includes('/') || token.includes('\\');
}

function isAbsoluteAny(token) {
  return path.posix.isAbsolute(token) || path.win32.isAbsolute(token) || isWindowsPath(token);
}

/** true si `file` está dentro (estrictamente) de la carpeta `dir` (comparación con pathKey). */
function isInside(file, dir) {
  const fileKey = pathKey(file);
  const dirKey = pathKey(dir);
  if (!fileKey || !dirKey || fileKey === dirKey) return false;
  const sep = isWindowsPath(dir) ? '\\' : '/';
  return fileKey.startsWith(dirKey.endsWith(sep) ? dirKey : dirKey + sep);
}

/**
 * Primer token del comando de tests → { file, prefixArgs, projectScript? } | { status, error } (design.md §3.6):
 * .js/.mjs/.cjs → node; ruta absoluta → tal cual si es de confianza; relativa con separador → script del proyecto
 * (ruta absoluta dentro de la carpeta del proyecto); nombre → resolvedor con cwd = carpeta del proyecto.
 */
function resolveFirstToken(t0, { projectDir, platform, options }) {
  if (/\.(m|c)?js$/i.test(t0)) return resolveExecutable(t0, options);
  if (isAbsoluteAny(t0)) {
    if (/\.(cmd|bat)$/i.test(t0)) return { status: 409, error: CMD_SCRIPT_ERROR(t0) };
    const trusted = options.resolver ? options.resolver.isTrustedPath(t0, { cwd: projectDir }) : !(projectDir && (isInside(t0, projectDir)));
    if (!trusted) return { status: 400, error: SDD_ERRORS.invalidTestCommand('ruta absoluta dentro de un proyecto: escríbela relativa a la carpeta del proyecto (./…)') };
    return { file: t0, prefixArgs: [] };
  }
  if (hasSeparator(t0)) {
    const p = platform === 'win32' ? path.win32 : path.posix;
    const file = projectDir ? p.resolve(projectDir, t0) : null;
    if (!file || !isInside(file, projectDir)) return { status: 400, error: SDD_ERRORS.invalidTestCommand('ruta fuera del proyecto') };
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) return { status: 409, error: CMD_SCRIPT_ERROR(t0) };
    return { file, prefixArgs: [], projectScript: true };
  }
  return resolveExecutable(t0, options);
}

/**
 * Comando de tests de un proyecto: `testCommand` si está configurado; si no, `bash init.sh` si existe init.sh.
 * → { ok: true, steps: [{ file, prefixArgs, args, display, projectScript? }] } | { ok: false, status, error }.
 * Feature 14: los ejecutables se resuelven con el resolvedor de confianza (nunca el nombre suelto).
 */
export function resolveTestCommand({ testCommand, projectDir, platform = process.platform, env = process.env, execPath = process.execPath, exists = () => false, bashBin = null, resolver } = {}) {
  const options = { platform, env, execPath, exists, bashBin, resolver, cwd: projectDir };
  const configured = typeof testCommand === 'string' ? testCommand.trim() : '';
  if (configured) {
    const parsed = parseCommandLine(configured);
    if (!parsed.ok) return { ok: false, status: 400, error: SDD_ERRORS.invalidTestCommand(parsed.error) };
    const resolved = resolveFirstToken(parsed.args[0], { projectDir, platform, options });
    if (resolved.error) return { ok: false, status: resolved.status ?? 409, error: resolved.error };
    const step = { file: resolved.file, prefixArgs: resolved.prefixArgs, args: parsed.args.slice(1), display: formatCommandLine(parsed.args) };
    if (resolved.projectScript) step.projectScript = true;
    return { ok: true, steps: [step] };
  }
  if (projectDir && exists(path.join(projectDir, 'init.sh'))) {
    const bash = resolveExecutable('bash', options);
    if (bash.error) return { ok: false, status: 409, error: bash.error };
    return { ok: true, steps: [{ file: bash.file, prefixArgs: bash.prefixArgs, args: ['init.sh'], display: 'bash init.sh' }] };
  }
  return { ok: false, status: 409, error: SDD_ERRORS.noTestCommand };
}
