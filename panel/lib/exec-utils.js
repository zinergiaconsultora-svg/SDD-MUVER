// Utilidades de procesos (design.md §5.3): parser propio de líneas de comando (sin shell), resolución de
// ejecutables en Windows sin .cmd/.bat, Git Bash, terminación del árbol de procesos, troceo de líneas y ANSI.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { isWindowsPath } from './path-key.js';
import { createBinaryResolver, gitBashCandidates, taskkillPath, CMD_SCRIPT_ERROR, NO_GIT_BASH_ERROR } from './trusted-bin.js';

// Feature 14: los textos de la fase 4 y taskkillPath viven en trusted-bin.js (sin dependencias); se reexportan aquí.
export { CMD_SCRIPT_ERROR, NO_GIT_BASH_ERROR, taskkillPath };

export const MAX_COMMAND_LINE_CHARS = 300;
export const MAX_COMMAND_ARGS = 50;
export const MAX_LINE_BYTES = 1024 * 1024;
export const KILL_GRACE_MS = 5000;


/**
 * Separa una línea de comando en argumentos: espacios y tabuladores separan; "…" agrupa (con \" y \\ dentro);
 * ningún otro carácter tiene significado especial. → { ok: true, args } | { ok: false, error }.
 */
export function parseCommandLine(line) {
  if (typeof line !== 'string' || line.trim() === '') return { ok: false, error: 'vacío' };
  if (/[\r\n\0]/.test(line)) return { ok: false, error: 'contiene saltos de línea o NUL' };
  if (line.length > MAX_COMMAND_LINE_CHARS) return { ok: false, error: 'más de 300 caracteres' };
  const args = [];
  let current = '';
  let inToken = false;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
        current += line[i + 1];
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === ' ' || ch === '\t') {
      if (inToken) {
        args.push(current);
        current = '';
        inToken = false;
      }
    } else if (ch === '"') {
      inQuotes = true;
      inToken = true;
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (inQuotes) return { ok: false, error: 'comillas sin cerrar' };
  if (inToken) args.push(current);
  if (args.length === 0) return { ok: false, error: 'vacío' };
  if (args.length > MAX_COMMAND_ARGS) return { ok: false, error: 'más de 50 argumentos' };
  return { ok: true, args };
}

/** Línea para mostrar: une con espacios y entrecomilla los argumentos vacíos o con espacios o comillas. */
export function formatCommandLine(args) {
  return (Array.isArray(args) ? args : [])
    .map((arg) => {
      const value = String(arg);
      return value === '' || /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
    })
    .join(' ');
}

/**
 * Ruta de Git Bash en Windows (o null), en el orden de design.md §5.3, sin aceptar el bash de WSL ni candidatos
 * relativos (feature 14: los candidatos los da trusted-bin.js, que también los usa el resolvedor).
 */
export function findGitBash({ env = {}, exists = () => false, bashBin = null } = {}) {
  for (const candidate of gitBashCandidates({ env, bashBin })) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

function isAbsoluteAny(bin) {
  return path.posix.isAbsolute(bin) || path.win32.isAbsolute(bin) || isWindowsPath(bin);
}

/**
 * Ejecutable de un comando sin shell: { file, prefixArgs } | { error } (design.md §5.3; feature 14 §5.3).
 * Un .js/.mjs/.cjs se lanza con node; una ruta absoluta se usa tal cual (.cmd/.bat → error); un nombre se resuelve
 * con el resolvedor de confianza (cwd = carpeta de la llamada). Nunca se devuelve el nombre suelto.
 */
export function resolveExecutable(name, { platform = process.platform, env = process.env, execPath = process.execPath, exists, bashBin = null, resolver, cwd } = {}) {
  const bin = String(name ?? '');
  if (/\.(m|c)?js$/i.test(bin)) return { file: execPath, prefixArgs: [bin] };
  if (isAbsoluteAny(bin)) {
    return /\.(cmd|bat)$/i.test(bin) ? { error: CMD_SCRIPT_ERROR(bin) } : { file: bin, prefixArgs: [] };
  }
  const active = resolver ?? createBinaryResolver({
    platform,
    env,
    execPath,
    bashBin,
    fsOps: { isFile: exists || (() => false), isExecutable: () => true, realpath: () => null },
  });
  const resolved = active.resolve(bin, { cwd });
  return resolved.ok ? { file: resolved.file, prefixArgs: resolved.prefixArgs } : { error: resolved.error };
}

/**
 * Termina el árbol de procesos de `child`. Windows: taskkill /T /F. Resto: SIGTERM al grupo (el hijo se lanzó con
 * detached: true) y, si no ha salido a los `graceMs`, SIGKILL al grupo.
 */
export function killProcessTree(child, {
  platform = process.platform,
  env = process.env,
  execFileImpl = execFile,
  killImpl = (pid, signal) => process.kill(pid, signal),
  graceMs = KILL_GRACE_MS,
  setTimeoutImpl = setTimeout,
} = {}) {
  if (!child || !Number.isInteger(child.pid)) return;
  if (platform === 'win32') {
    // Feature 14 (R10): por ruta absoluta, nunca por nombre (libuv lo buscaría primero en el cwd).
    execFileImpl(taskkillPath(env), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  let exited = child.exitCode !== null && child.exitCode !== undefined;
  if (typeof child.once === 'function') child.once('exit', () => { exited = true; });
  const send = (signal) => {
    try {
      killImpl(-child.pid, signal);
      return true;
    } catch (err) {
      if (err && err.code !== 'ESRCH') console.error('[panel] No se pudo terminar el proceso', child.pid, '-', err.message);
      return false;
    }
  };
  if (!send('SIGTERM')) return;
  const timer = setTimeoutImpl(() => {
    if (!exited) send('SIGKILL');
  }, graceMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

/**
 * Trocea un flujo en líneas UTF-8 (sin \r final). Una línea que supera `maxLineBytes` se descarta entera y se
 * avisa una vez con onDiscard(). end() emite lo pendiente.
 */
export function createLineSplitter({ maxLineBytes = MAX_LINE_BYTES, onLine = () => {}, onDiscard = () => {} } = {}) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let discarding = false;

  function emit(line) {
    onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  }

  function consume(text) {
    let rest = text;
    let idx;
    while ((idx = rest.indexOf('\n')) >= 0) {
      const piece = rest.slice(0, idx);
      rest = rest.slice(idx + 1);
      if (discarding) {
        discarding = false;
        continue;
      }
      const line = pending + piece;
      pending = '';
      if (Buffer.byteLength(line) > maxLineBytes) onDiscard();
      else emit(line);
    }
    if (discarding) return;
    pending += rest;
    if (Buffer.byteLength(pending) > maxLineBytes) {
      pending = '';
      discarding = true;
      onDiscard();
    }
  }

  return {
    push(chunk) {
      consume(typeof chunk === 'string' ? chunk : decoder.write(chunk));
    },
    end() {
      consume(decoder.end());
      if (!discarding && pending !== '') emit(pending);
      pending = '';
      discarding = false;
    },
  };
}

/** Quita secuencias ANSI (colores, cursor) y OSC (títulos de ventana). */
export function stripAnsi(text) {
  return String(text ?? '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}
