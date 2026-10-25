// Utilidades de procesos (design.md §5.3): parser propio de líneas de comando (sin shell), resolución de
// ejecutables en Windows sin .cmd/.bat, Git Bash, terminación del árbol de procesos, troceo de líneas y ANSI.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { pathKey } from './path-key.js';

export const MAX_COMMAND_LINE_CHARS = 300;
export const MAX_COMMAND_ARGS = 50;
export const MAX_LINE_BYTES = 1024 * 1024;
export const KILL_GRACE_MS = 5000;

export const CMD_SCRIPT_ERROR = (name) => `"${name}" es un script .cmd/.bat y el panel no usa shell: indica la ruta de un .exe o usa node <script>.js`;
export const NO_GIT_BASH_ERROR = 'No se encontró Git Bash: instala Git for Windows o configura el comando de tests';

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

/** Ruta de Git Bash en Windows (o null), en el orden de design.md §5.3, sin aceptar el bash de WSL. */
export function findGitBash({ env = {}, exists = () => false, bashBin = null } = {}) {
  const win = path.win32;
  const candidates = [
    bashBin,
    env.CLAUDE_CODE_GIT_BASH_PATH,
    env.ProgramFiles ? win.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe') : null,
    env['ProgramFiles(x86)'] ? win.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe') : null,
    env.LOCALAPPDATA ? win.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe') : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const key = pathKey(candidate) || '';
    if (key.includes('\\system32\\') || key.includes('\\sysnative\\')) continue;
    if (exists(candidate)) return candidate;
  }
  return null;
}

function pathDirs(env) {
  const raw = (env && (env.PATH ?? env.Path)) || '';
  return String(raw).split(';').map((d) => d.trim()).filter(Boolean);
}

/**
 * Ejecutable de un comando sin shell: { file, prefixArgs } | { error } (design.md §5.3).
 */
export function resolveExecutable(name, { platform = process.platform, env = process.env, execPath = process.execPath, exists = () => false, bashBin = null } = {}) {
  const bin = String(name ?? '');
  if (platform !== 'win32') {
    if (bin === 'bash') return { file: bashBin ?? 'bash', prefixArgs: [] };
    if (/\.(m|c)?js$/i.test(bin)) return { file: execPath, prefixArgs: [bin] };
    return { file: bin, prefixArgs: [] };
  }
  const win = path.win32;
  const lower = bin.toLowerCase();
  if (lower === 'node' || lower === 'node.exe') return { file: execPath, prefixArgs: [] };
  if (lower === 'npm' || lower === 'npx') {
    const cli = win.join(win.dirname(execPath), 'node_modules', 'npm', 'bin', `${lower}-cli.js`);
    return exists(cli) ? { file: execPath, prefixArgs: [cli] } : { error: CMD_SCRIPT_ERROR(bin) };
  }
  if (lower === 'bash' || lower === 'bash.exe') {
    const bash = findGitBash({ env, exists, bashBin });
    return bash ? { file: bash, prefixArgs: [] } : { error: NO_GIT_BASH_ERROR };
  }
  if (win.isAbsolute(bin)) {
    return /\.(cmd|bat)$/i.test(bin) ? { error: CMD_SCRIPT_ERROR(bin) } : { file: bin, prefixArgs: [] };
  }
  const dirs = pathDirs(env);
  const names = /\.(exe|com)$/i.test(bin) ? [bin] : [`${bin}.com`, `${bin}.exe`];
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = win.join(dir, candidate);
      if (exists(full)) return { file: full, prefixArgs: [] };
    }
  }
  const base = bin.replace(/\.(cmd|bat)$/i, '');
  for (const dir of dirs) {
    if (exists(win.join(dir, `${base}.cmd`)) || exists(win.join(dir, `${base}.bat`))) return { error: CMD_SCRIPT_ERROR(bin) };
  }
  return { file: bin, prefixArgs: [] };
}

/**
 * Termina el árbol de procesos de `child`. Windows: taskkill /T /F. Resto: SIGTERM al grupo (el hijo se lanzó con
 * detached: true) y, si no ha salido a los `graceMs`, SIGKILL al grupo.
 */
export function killProcessTree(child, {
  platform = process.platform,
  execFileImpl = execFile,
  killImpl = (pid, signal) => process.kill(pid, signal),
  graceMs = KILL_GRACE_MS,
  setTimeoutImpl = setTimeout,
} = {}) {
  if (!child || !Number.isInteger(child.pid)) return;
  if (platform === 'win32') {
    execFileImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
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
