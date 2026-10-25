// Llamada a Claude Code CLI en modo no interactivo (design.md §5.2): argumentos, ejecutable y lectura del stream-json.
// Todas las flags del CLI viven en CLI_FLAGS: si la versión instalada cambia un nombre, solo se toca aquí.
// Permisos acotados: acceptEdits + lista explícita de herramientas; nunca el modo que se salta los permisos.
import path from 'node:path';

import { pathKey, isWindowsPath } from './path-key.js';

export const CLI_FLAGS = Object.freeze({
  print: '-p',
  outputFormat: '--output-format',
  streamJson: 'stream-json',
  verbose: '--verbose',
  permissionMode: '--permission-mode',
  acceptEdits: 'acceptEdits',
  allowedTools: '--allowedTools',
  continueLast: '--continue',
  resume: '--resume',
});

/** Regla de --allowedTools para un comando Bash (sintaxis actual; la antigua era `Bash(cmd:*)`). */
export const BASH_RULE = (cmd) => `Bash(${cmd} *)`;
export const DEFAULT_ALLOWED_TOOLS = Object.freeze(['Read', 'Edit', 'Write', 'Glob', 'Grep', BASH_RULE('git status'), BASH_RULE('git diff'), BASH_RULE('git log')]);
export const FORBIDDEN_ARGS = Object.freeze(['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions']);
export const SDD_PROMPTS = Object.freeze({ implement: 'implementa la siguiente tarea pendiente', approveTests: 'tests aprobados, lanza al reviewer' });
export const MAX_PROMPT_CHARS = 20000;

/** Regla de los comandos autorizados por proyecto (design.md §3.1). */
export const ALLOWED_COMMAND_RE = /^[A-Za-z0-9._:/=@+-][A-Za-z0-9 ._:/=@+-]{0,199}$/;
export const SUMMARY_MAX_CHARS = 120;
export const TEXT_MAX_CHARS = 2000;
export const TOOL_ERROR_MAX_CHARS = 300;
export const DENIAL_DETAIL_MAX_CHARS = 200;

const CMD_SCRIPT_ERROR = (name) => `"${name}" es un script .cmd/.bat y el panel no usa shell: indica la ruta de un .exe o usa node <script>.js`;

/** Recorta espacios y colapsa los interiores a uno. */
export function normalizeCommand(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/** true si `c` es un comando autorizable (cadena que, normalizada, cumple ALLOWED_COMMAND_RE). */
export function isValidAllowedCommand(c) {
  if (typeof c !== 'string') return false;
  return ALLOWED_COMMAND_RE.test(normalizeCommand(c));
}

/** Valor único de --allowedTools: reglas por defecto + Bash(<comando> *) por comando válido, sin duplicados. */
export function buildAllowedTools(allowedCommands) {
  const rules = [...DEFAULT_ALLOWED_TOOLS];
  for (const command of Array.isArray(allowedCommands) ? allowedCommands : []) {
    if (!isValidAllowedCommand(command)) continue;
    const rule = BASH_RULE(normalizeCommand(command));
    if (!rules.includes(rule)) rules.push(rule);
  }
  return rules.join(',');
}

/**
 * Argumentos de `claude` (sin el ejecutable): -p, stream-json, acceptEdits, sesión y, AL FINAL, --allowedTools.
 * El prompt NO va en argv: se envía por stdin (lib/runs.js). Corrección tras la prueba manual T36 con Claude Code
 * 2.1.307: --allowedTools es una opción variádica y consumía también un prompt colocado detrás. Por eso además debe
 * ser la última opción (nada posicional después). Lanza si algún elemento es un argumento prohibido.
 */
export function buildClaudeArgs({ session, allowedCommands } = {}) {
  const args = [
    CLI_FLAGS.print,
    CLI_FLAGS.outputFormat,
    CLI_FLAGS.streamJson,
    CLI_FLAGS.verbose,
    CLI_FLAGS.permissionMode,
    CLI_FLAGS.acceptEdits,
  ];
  const mode = session && session.mode;
  if (mode === 'continue') args.push(CLI_FLAGS.continueLast);
  else if (mode === 'resume') args.push(CLI_FLAGS.resume, String(session.id));
  args.push(CLI_FLAGS.allowedTools, buildAllowedTools(allowedCommands));
  for (const arg of args) {
    if (FORBIDDEN_ARGS.includes(arg)) throw new Error('Argumento no permitido en la llamada a Claude Code');
  }
  return args;
}

function pathDirs(env) {
  const raw = (env && (env.PATH ?? env.Path)) || '';
  return String(raw).split(';').map((d) => d.trim()).filter(Boolean);
}

/**
 * Ejecutable de Claude (design.md §5.2): { file, prefixArgs } o { error }. Las rutas Windows se componen con
 * path.win32 para que los tests en Linux funcionen.
 */
export function resolveClaudeCommand(claudeBin, { platform = process.platform, env = process.env, execPath = process.execPath, exists = () => false } = {}) {
  const bin = typeof claudeBin === 'string' && claudeBin.trim() ? claudeBin.trim() : 'claude';
  if (/\.(m|c)?js$/i.test(bin)) return { file: execPath, prefixArgs: [bin] };
  if (path.isAbsolute(bin) || path.win32.isAbsolute(bin) || isWindowsPath(bin)) return { file: bin, prefixArgs: [] };
  if (platform !== 'win32') return { file: bin, prefixArgs: [] };

  const win = path.win32;
  const dirs = pathDirs(env);
  const exeName = /\.exe$/i.test(bin) ? bin : `${bin}.exe`;
  for (const dir of dirs) {
    const candidate = win.join(dir, exeName);
    if (exists(candidate)) return { file: candidate, prefixArgs: [] };
  }
  if (env && env.USERPROFILE) {
    const native = win.join(env.USERPROFILE, '.local', 'bin', exeName);
    if (exists(native)) return { file: native, prefixArgs: [] };
  }
  const base = bin.replace(/\.exe$/i, '');
  for (const dir of dirs) {
    const cli = win.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (exists(win.join(dir, `${base}.cmd`)) && exists(cli)) return { file: execPath, prefixArgs: [cli] };
  }
  for (const dir of dirs) {
    if (exists(win.join(dir, `${base}.cmd`)) || exists(win.join(dir, `${base}.bat`))) return { error: CMD_SCRIPT_ERROR(bin) };
  }
  return { file: bin, prefixArgs: [] };
}

/** Recorta a `max` puntos de código (los últimos `…` cuentan dentro del máximo). */
function clipWithEllipsis(text, max) {
  const chars = [...String(text ?? '')];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

function clipPlain(text, max) {
  const value = String(text ?? '');
  return value.length > max ? value.slice(0, max) : value;
}

/** Ruta relativa a `cwd` (con /) si `file` está dentro; si no, `file` tal cual. Admite rutas Windows. */
function relativeTo(file, cwd) {
  const fileKey = pathKey(file);
  const cwdKey = pathKey(cwd);
  if (!fileKey || !cwdKey) return file;
  const win = isWindowsPath(file);
  if (win !== isWindowsPath(cwd)) return file;
  const sep = win ? '\\' : '/';
  const prefix = cwdKey.endsWith(sep) ? cwdKey : cwdKey + sep;
  if (!fileKey.startsWith(prefix)) return file;
  const normalized = win ? path.win32.normalize(file.replace(/\//g, '\\')) : path.posix.normalize(file.replace(/\\/g, '/'));
  return normalized.slice(prefix.length).split(sep).join('/');
}

/** Resumen corto de los argumentos de una herramienta (≤ 120 caracteres). */
export function summarizeToolInput(name, input, cwd) {
  const data = input && typeof input === 'object' ? input : {};
  let summary = '';
  if (['Read', 'Edit', 'MultiEdit', 'Write'].includes(name)) summary = typeof data.file_path === 'string' ? relativeTo(data.file_path, cwd) : '';
  else if (name === 'NotebookEdit') {
    const file = data.notebook_path ?? data.file_path;
    summary = typeof file === 'string' ? relativeTo(file, cwd) : '';
  } else if (name === 'Bash') summary = data.command;
  else if (name === 'Glob' || name === 'Grep') summary = data.pattern;
  else if (name === 'WebFetch') summary = data.url;
  else if (name === 'Task' || name === 'Agent') summary = data.description;
  return typeof summary === 'string' ? clipWithEllipsis(summary, SUMMARY_MAX_CHARS) : '';
}

/** Comando que se propone autorizar tras una denegación de Bash (o null). */
export function suggestAllowedCommand(command) {
  if (typeof command !== 'string') return null;
  if (['&&', '||', ';', '|', '>', '<', '`', '$('].some((s) => command.includes(s))) return null;
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const [t0, t1, t2] = tokens;
  const parts = [t0];
  if (t1 !== undefined && !t1.startsWith('-')) {
    parts.push(t1);
    if (['npm', 'pnpm', 'yarn'].includes(t0) && t1 === 'run' && t2 !== undefined && !t2.startsWith('-')) parts.push(t2);
  }
  const suggestion = parts.join(' ');
  return isValidAllowedCommand(suggestion) ? suggestion : null;
}

function denialDetail(input) {
  const data = input && typeof input === 'object' ? input : {};
  const value = data.command ?? data.file_path ?? data.url ?? data.pattern;
  return clipPlain(typeof value === 'string' ? value : JSON.stringify(data), DENIAL_DETAIL_MAX_CHARS);
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
  return '';
}

/**
 * Traductor del stream-json del CLI a eventos del panel (sin seq/at). push(línea) → Event[]; denials() → las
 * denegaciones registradas ({ tool, detail, suggestion }).
 */
export function createStreamMapper({ cwd } = {}) {
  const seenDenials = new Set();
  const denials = [];

  function denialEvent(toolName, input, toolUseId) {
    if (toolUseId !== undefined && toolUseId !== null) {
      if (seenDenials.has(toolUseId)) return null;
      seenDenials.add(toolUseId);
    }
    const tool = typeof toolName === 'string' && toolName ? toolName : 'desconocida';
    const data = input && typeof input === 'object' ? input : {};
    const denial = { tool, detail: denialDetail(data), suggestion: tool === 'Bash' ? suggestAllowedCommand(data.command) : null };
    denials.push(denial);
    return { type: 'permission_denied', ...denial };
  }

  function mapAssistant(message) {
    const blocks = message && Array.isArray(message.content) ? message.content : [];
    const events = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        events.push({ type: 'text', text: clipPlain(block.text, TEXT_MAX_CHARS) });
      } else if (block.type === 'tool_use') {
        events.push({ type: 'tool', name: String(block.name ?? ''), summary: summarizeToolInput(block.name, block.input, cwd) });
      }
    }
    return events;
  }

  function mapUser(message) {
    const blocks = message && Array.isArray(message.content) ? message.content : [];
    return blocks
      .filter((b) => b && b.type === 'tool_result' && b.is_error === true)
      .map((b) => ({ type: 'tool_error', preview: clipPlain(toolResultText(b.content), TOOL_ERROR_MAX_CHARS) }));
  }

  function mapResult(msg) {
    const events = [{
      type: 'result',
      ok: msg.is_error !== true,
      text: String(msg.result ?? '').slice(0, TEXT_MAX_CHARS),
      costUsd: msg.total_cost_usd ?? null,
      durationMs: msg.duration_ms ?? null,
      numTurns: msg.num_turns ?? null,
      sessionId: msg.session_id ?? null,
    }];
    for (const d of Array.isArray(msg.permission_denials) ? msg.permission_denials : []) {
      if (!d || typeof d !== 'object') continue;
      const ev = denialEvent(d.tool_name ?? d.toolName, d.tool_input ?? d.input, d.tool_use_id);
      if (ev) events.push(ev);
    }
    return events;
  }

  function push(rawLine) {
    const lineText = String(rawLine ?? '');
    if (lineText.trim() === '') return [];
    let msg;
    try {
      msg = JSON.parse(lineText);
    } catch {
      msg = undefined;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return [{ type: 'output', stream: 'stdout', text: clipPlain(lineText, TEXT_MAX_CHARS) }];
    if (msg.type === 'system') {
      if (msg.subtype === 'init') return [{ type: 'session', sessionId: msg.session_id ?? null, model: msg.model ?? null }];
      if (msg.subtype === 'api_retry') return [{ type: 'notice', message: `Reintentando la llamada a la API (intento ${msg.attempt ?? '?'})` }];
      if (msg.subtype === 'permission_denied') {
        const ev = denialEvent(msg.tool_name ?? msg.toolName, msg.tool_input ?? msg.input, msg.tool_use_id);
        return ev ? [ev] : [];
      }
      return [];
    }
    if (msg.type === 'assistant') return mapAssistant(msg.message);
    if (msg.type === 'user') return mapUser(msg.message);
    if (msg.type === 'result') return mapResult(msg);
    return [];
  }

  return { push, denials: () => denials.slice() };
}
