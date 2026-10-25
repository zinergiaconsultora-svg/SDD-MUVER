// Llamada a Claude Code CLI en modo no interactivo (design.md §5.2): argumentos, ejecutable y lectura del stream-json.
// Todas las flags del CLI viven en CLI_FLAGS: si la versión instalada cambia un nombre, solo se toca aquí.
// Permisos acotados: acceptEdits + lista explícita de herramientas; nunca el modo que se salta los permisos.
import path from 'node:path';

import { pathKey, isWindowsPath } from './path-key.js';
import { createBinaryResolver } from './trusted-bin.js';

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
/**
 * Corrección T36: en Windows Claude Code tiene también la herramienta PowerShell y elige cualquiera de las dos.
 * Sus reglas tienen la misma forma que las de Bash (doc oficial de permisos, §PowerShell): `PowerShell(cmd *)`.
 */
export const POWERSHELL_RULE = (cmd) => `PowerShell(${cmd} *)`;
/** Herramientas de shell: sus denegaciones se tratan igual (detalle y comando base propuesto). */
export const SHELL_TOOLS = Object.freeze(['Bash', 'PowerShell']);
/** Reglas de un comando autorizado: una por herramienta de shell. */
export const shellRules = (cmd) => [BASH_RULE(cmd), POWERSHELL_RULE(cmd)];
export const DEFAULT_ALLOWED_TOOLS = Object.freeze(['Read', 'Edit', 'Write', 'Glob', 'Grep', ...shellRules('git status'), ...shellRules('git diff'), ...shellRules('git log')]);
export const FORBIDDEN_ARGS = Object.freeze(['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions']);
export const SDD_PROMPTS = Object.freeze({ implement: 'implementa la siguiente tarea pendiente', approveTests: 'tests aprobados, lanza al reviewer' });
export const MAX_PROMPT_CHARS = 20000;

/**
 * Regla de los comandos autorizados por proyecto (design.md §3.1; feature 14 §4.1): no puede empezar por "-" y,
 * además, no puede terminar en ":" (así ninguna regla generada acaba en el sufijo antiguo ":*").
 */
export const ALLOWED_COMMAND_RE = /^(?![-])[A-Za-z0-9 ._:/=@+-]{1,200}$/;

// ---------- Comandos amplios (feature 14, design.md §3.5) ----------

/** Su argumento es otro comando: SIEMPRE amplios. */
export const WRAPPER_COMMANDS = Object.freeze([
  'env', 'sudo', 'doas', 'su', 'runas', 'xargs', 'find', 'nohup', 'time', 'timeout', 'nice', 'ionice', 'stdbuf',
  'setsid', 'chroot', 'flock', 'watch', 'parallel', 'exec', 'eval', 'command', 'builtin', 'start', 'cmd', 'script',
  'busybox', 'wsl', 'strace', 'ltrace', 'gdb',
  'corepack', // corrección revisión F14 (MA1): `corepack pnpm dlx …`
]);
/**
 * Corrección revisión F14 (MA1): cmdlets y alias de PowerShell que ejecutan código o lanzan procesos (el panel genera
 * también reglas `PowerShell(...)`), incluidos los de descarga (`iwr`/`irm`, que se encadenan con `iex`). SIEMPRE amplios.
 */
export const POWERSHELL_EXEC_COMMANDS = Object.freeze([
  'invoke-expression', 'iex', 'invoke-command', 'icm', 'start-process', 'saps', 'start', 'invoke-item', 'ii', 'add-type', '&', '.',
  'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'start-job', 'sajb', 'start-threadjob', 'new-object',
  'invoke-wmimethod', 'invoke-cimmethod',
]);
/** Amplios a secas o seguidos de una opción (- o /). */
export const RUNNER_COMMANDS = Object.freeze([
  'node', 'nodejs', 'deno', 'bun', 'bunx', 'npx', 'pnpx', 'python', 'python2', 'python3', 'py', 'pythonw', 'pypy',
  'pypy3', 'uv', 'uvx', 'pipx', 'ruby', 'irb', 'perl', 'php', 'lua', 'luajit', 'java', 'jshell', 'rscript',
  'osascript', 'awk', 'gawk', 'mawk', 'nawk', 'sed', 'tclsh', 'wish', 'bash', 'sh', 'dash', 'zsh', 'ksh', 'fish',
  'csh', 'tcsh', 'pwsh', 'powershell', 'git', 'npm', 'pnpm', 'yarn', 'make',
  'tsx', 'ts-node', // corrección revisión F14 (MA1): `tsx -e`, `ts-node -e`
]);
/**
 * git <sub> que ejecuta programas o cambia la configuración. Corrección revisión F14 (MA1): también los que hablan con
 * remotos, porque aceptan `--upload-pack=<programa>`/`--receive-pack=<programa>` o leen `remote.*.uploadpack`
 * (`fetch`, `pull`, `push`, `clone`, `ls-remote`, `remote` —`remote update` hace fetch—), `grep` (`-O`/
 * `--open-files-in-pager=<programa>`) y `send-email` (`--sendmail-cmd`). `archive` ya cubría `--remote --exec`,
 * `bisect` cubre `bisect run` y `rebase` cubre `--exec`.
 */
export const GIT_EXEC_SUBCOMMANDS = Object.freeze([
  'config', 'submodule', 'bisect', 'rebase', 'filter-branch', 'difftool', 'mergetool', 'daemon', 'instaweb',
  'web--browse', 'credential', 'upload-pack', 'receive-pack', 'archive',
  'fetch', 'pull', 'push', 'clone', 'ls-remote', 'remote', 'grep', 'send-email',
]);
/** npm/pnpm/yarn/bun <sub> que ejecuta paquetes arbitrarios. */
export const PKG_EXEC_SUBCOMMANDS = Object.freeze(['exec', 'x', 'dlx', 'explore', 'create', 'init']);
/**
 * Corrección revisión F14 (MA1): lanzadores con un subcomando que ejecuta código arbitrario (o descargado).
 */
export const TOOL_EXEC_SUBCOMMANDS = Object.freeze({
  yarn: Object.freeze(['node']),
  deno: Object.freeze(['eval', 'repl', 'run', 'x']),
  uv: Object.freeze(['run', 'tool']),
  pipx: Object.freeze(['run']),
  dotnet: Object.freeze(['run', 'exec', 'fsi']),
});
const PYTHON_FAMILY = new Set(['python', 'python2', 'python3', 'py', 'pythonw', 'pypy', 'pypy3']);
// python3.12, python3.9, pypy3.10, pythonw3.11…: se tratan como su familia (corrección revisión F14, MA1).
const VERSIONED_PYTHON_RE = /^(python|pypy)\d*(\.\d+)*w?$/;
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/**
 * Nombre base del primer token: último segmento tras / o \, en minúsculas y sin .exe/.com/.cmd/.bat/.ps1
 * (corrección revisión F14, MA1: `npx.cmd`, `NODE.EXE`). Los python con versión se reducen a su familia.
 */
function commandBase(token) {
  const base = String(token).split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|com|cmd|bat|ps1)$/, '');
  if (VERSIONED_PYTHON_RE.test(base) && !PYTHON_FAMILY.has(base)) return base.startsWith('pypy') ? 'pypy' : 'python';
  return base;
}

/** true si el comando autorizado permitiría a Claude ejecutar cualquier programa (design.md §3.5). */
export function isBroadCommand(cmd) {
  const tokens = normalizeCommand(cmd).split(' ').filter(Boolean);
  if (!tokens.length) return false;
  const [t0, rawT1, t2] = tokens;
  const t1 = rawT1 === undefined ? undefined : rawT1.toLowerCase();
  const base = commandBase(t0);
  if (WRAPPER_COMMANDS.includes(base) || POWERSHELL_EXEC_COMMANDS.includes(base)) return true;
  if (Object.prototype.hasOwnProperty.call(TOOL_EXEC_SUBCOMMANDS, base) && TOOL_EXEC_SUBCOMMANDS[base].includes(t1)) return true;
  if (RUNNER_COMMANDS.includes(base) && (t1 === undefined || t1.startsWith('-') || t1.startsWith('/'))) {
    const pythonModule = PYTHON_FAMILY.has(base) && t1 === '-m' && t2 !== undefined && !t2.startsWith('-');
    if (!pythonModule) return true;
  }
  if (base === 'git' && GIT_EXEC_SUBCOMMANDS.includes(t1)) return true;
  if (PKG_MANAGERS.has(base)) {
    if (PKG_EXEC_SUBCOMMANDS.includes(t1)) return true;
    if (t1 === 'run' && (t2 === undefined || t2.startsWith('-'))) return true;
  }
  return false;
}
export const SUMMARY_MAX_CHARS = 120;
// Corrección T36: el texto del asistente y del result llega hasta 20000 caracteres por evento (antes 2000 cortaba
// resúmenes normales); el tope total sigue siendo el límite de salida del run (5 MB).
export const TEXT_MAX_CHARS = 20000;
export const OUTPUT_LINE_MAX_CHARS = 2000;
export const TRUNCATED_SUFFIX = '… (texto recortado)';
export const TOOL_ERROR_MAX_CHARS = 300;
export const DENIAL_DETAIL_MAX_CHARS = 200;
/** Feature 14 (M5): como mucho 50 denegaciones por run (memoria, RunMeta e index.json). */
export const MAX_PERMISSION_DENIALS = 50;
/** Corrección revisión F14 (N4): como mucho 500 inputs de herramientas y textos de aprobación recordados por run. */
export const MAX_TRACKED_TOOL_USES = 500;

/** Map.set acotado: si se supera `max`, descarta la entrada más antigua. */
function boundedSet(map, key, value, max) {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
}

/** Recorta espacios y colapsa los interiores a uno. */
export function normalizeCommand(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/** true si `c` es un comando autorizable (normalizado: cumple ALLOWED_COMMAND_RE y no termina en ":"). */
export function isValidAllowedCommand(c) {
  if (typeof c !== 'string') return false;
  const normalized = normalizeCommand(c);
  return ALLOWED_COMMAND_RE.test(normalized) && !normalized.endsWith(':');
}

/** Valor único de --allowedTools: reglas por defecto + Bash(<cmd> *) y PowerShell(<cmd> *) por comando válido, sin duplicados. */
export function buildAllowedTools(allowedCommands) {
  const rules = [...DEFAULT_ALLOWED_TOOLS];
  for (const command of Array.isArray(allowedCommands) ? allowedCommands : []) {
    if (!isValidAllowedCommand(command)) continue;
    for (const rule of shellRules(normalizeCommand(command))) if (!rules.includes(rule)) rules.push(rule);
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

function isAbsoluteAny(bin) {
  return path.posix.isAbsolute(bin) || path.win32.isAbsolute(bin) || isWindowsPath(bin);
}

/**
 * Ejecutable de Claude (design.md §5.2; feature 14 §5.5): { file, prefixArgs } o { error }. Nunca el nombre suelto:
 * un nombre se resuelve con el resolvedor de confianza (PATH filtrado, %USERPROFILE%\.local\bin o ~/.local/bin y el
 * cli.js junto a un claude.cmd) excluyendo el cwd del run y las carpetas del catálogo; una ruta relativa (con
 * separador, o un .js) se hace absoluta respecto a la carpeta de arranque del panel. Las rutas Windows se componen con
 * path.win32 para que los tests en Linux funcionen.
 */
export function resolveClaudeCommand(claudeBin, { platform = process.platform, env = process.env, execPath = process.execPath, exists, resolver, cwd, panelDir = process.cwd() } = {}) {
  const bin = typeof claudeBin === 'string' && claudeBin.trim() ? claudeBin.trim() : 'claude';
  const p = platform === 'win32' ? path.win32 : path.posix;
  const absolute = (file) => (isAbsoluteAny(file) ? file : p.resolve(panelDir, file));
  if (/\.(m|c)?js$/i.test(bin)) return { file: execPath, prefixArgs: [absolute(bin)] };
  if (isAbsoluteAny(bin)) return { file: bin, prefixArgs: [] };
  if (bin.includes('/') || bin.includes('\\')) return { file: absolute(bin), prefixArgs: [] };
  const active = resolver ?? createBinaryResolver({
    platform,
    env,
    execPath,
    panelDir,
    fsOps: { isFile: exists || (() => false), isExecutable: () => true, realpath: () => null },
  });
  const resolved = active.resolve(bin, { cwd });
  return resolved.ok ? { file: resolved.file, prefixArgs: resolved.prefixArgs } : { error: resolved.error };
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
  } else if (SHELL_TOOLS.includes(name)) summary = data.command;
  else if (name === 'Glob' || name === 'Grep') summary = data.pattern;
  else if (name === 'WebFetch') summary = data.url;
  else if (name === 'Task' || name === 'Agent') summary = data.description;
  return typeof summary === 'string' ? clipWithEllipsis(summary, SUMMARY_MAX_CHARS) : '';
}

/** Texto del asistente/result recortado a TEXT_MAX_CHARS con aviso visible si se recorta. */
function clipText(text) {
  const value = String(text ?? '');
  return value.length > TEXT_MAX_CHARS ? value.slice(0, TEXT_MAX_CHARS) + TRUNCATED_SUFFIX : value;
}

/**
 * Comando que se propone autorizar tras una denegación de Bash (o null). Feature 14: nunca un comando amplio
 * (isBroadCommand); añade `python -m <módulo>` y `bun run <script>`.
 */
export function suggestAllowedCommand(command) {
  if (typeof command !== 'string') return null;
  if (['&&', '||', ';', '|', '>', '<', '`', '$('].some((s) => command.includes(s))) return null;
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const [t0, t1, t2] = tokens;
  const parts = [t0];
  if (t1 !== undefined && !t1.startsWith('-')) {
    parts.push(t1);
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(t0) && t1 === 'run' && t2 !== undefined && !t2.startsWith('-')) parts.push(t2);
  } else if (PYTHON_FAMILY.has(commandBase(t0)) && t1 === '-m' && t2 !== undefined && !t2.startsWith('-')) {
    parts.push(t1, t2);
  }
  const suggestion = parts.join(' ');
  return isValidAllowedCommand(suggestion) && !isBroadCommand(suggestion) ? suggestion : null;
}

/**
 * Comandos base que se proponen autorizar para un comando compuesto (corrección T36): se separa por ;, &&, || y |
 * y se aplica suggestAllowedCommand a cada parte (validado con ALLOWED_COMMAND_RE), sin duplicados.
 */
export function suggestAllowedCommands(command) {
  if (typeof command !== 'string') return [];
  const out = [];
  for (const part of command.split(/;|&&|\|\||\|/)) {
    const suggestion = suggestAllowedCommand(part);
    if (suggestion && !out.includes(suggestion)) out.push(suggestion);
  }
  return out;
}

/** Parte del comando que pide aprobación según el texto de error del CLI real ("… requires approval: <cmd>"). */
export function approvalCommandFrom(text) {
  const match = /requires approval:\s*(.+)/i.exec(String(text ?? ''));
  return match ? match[1].split(/\r?\n/)[0].trim() : null;
}

function denialDetail(input, approval) {
  const data = input && typeof input === 'object' ? input : {};
  const value = data.command ?? data.file_path ?? data.url ?? data.pattern;
  if (typeof value === 'string' && value) return clipPlain(value, DENIAL_DETAIL_MAX_CHARS);
  if (approval) return clipPlain(approval, DENIAL_DETAIL_MAX_CHARS);
  // Nunca "{}": un input vacío deja el detalle vacío.
  return Object.keys(data).length ? clipPlain(JSON.stringify(data), DENIAL_DETAIL_MAX_CHARS) : '';
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
  const approvals = new Map(); // tool_use_id → parte del comando que pide aprobación (texto del error real)
  const toolInputs = new Map(); // tool_use_id → input del tool_use (respaldo si la denegación llega sin input)
  const denialById = new Map(); // tool_use_id → denegación registrada (se completa si el texto llega después)
  let capped = false; // true en cuanto se descarta una denegación por el tope

  function shellSuggestions(approval, command) {
    if (approval) return suggestAllowedCommands(approval);
    const single = typeof command === 'string' ? suggestAllowedCommand(command) : null;
    return single ? [single] : [];
  }

  /** El texto "requires approval: …" puede llegar DESPUÉS de la denegación (system/permission_denied): se completa. */
  function enrichDenial(toolUseId, approval) {
    const denial = denialById.get(toolUseId);
    if (!denial || !SHELL_TOOLS.includes(denial.tool)) return;
    if (!denial.fromInput) denial.detail = clipPlain(approval, DENIAL_DETAIL_MAX_CHARS);
    denial.suggestions = shellSuggestions(approval, null);
    denial.suggestion = denial.suggestions[0] ?? null;
  }

  function denialEvent(toolName, input, toolUseId) {
    if (toolUseId !== undefined && toolUseId !== null && seenDenials.has(toolUseId)) return null;
    if (denials.length >= MAX_PERMISSION_DENIALS) {
      // Corrección revisión F14 (N4): tras el tope no se recuerda nada más (memoria acotada).
      capped = true;
      return null;
    }
    if (toolUseId !== undefined && toolUseId !== null) seenDenials.add(toolUseId);
    const tool = typeof toolName === 'string' && toolName ? toolName : 'desconocida';
    const data = input && typeof input === 'object' ? input : {};
    const hasId = toolUseId !== undefined && toolUseId !== null;
    const approval = hasId ? approvals.get(toolUseId) || null : null;
    const fromInput = typeof data.command === 'string' && data.command !== '';
    const used = hasId && toolInputs.get(toolUseId);
    const fallbackCommand = !fromInput && !approval && used && typeof used.command === 'string' ? used.command : null;
    const suggestions = SHELL_TOOLS.includes(tool) ? shellSuggestions(approval, fromInput ? data.command : fallbackCommand) : [];
    const detail = fallbackCommand ? clipPlain(fallbackCommand, DENIAL_DETAIL_MAX_CHARS) : denialDetail(data, approval);
    const denial = { tool, detail, suggestion: suggestions[0] ?? null, suggestions };
    if (hasId) denialById.set(toolUseId, Object.defineProperty(denial, 'fromInput', { value: fromInput, enumerable: false }));
    denials.push(denial);
    return { type: 'permission_denied', ...denial };
  }

  function mapAssistant(message) {
    const blocks = message && Array.isArray(message.content) ? message.content : [];
    const events = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        events.push({ type: 'text', text: clipText(block.text) });
      } else if (block.type === 'tool_use') {
        if (block.id && !capped) boundedSet(toolInputs, block.id, block.input && typeof block.input === 'object' ? block.input : {}, MAX_TRACKED_TOOL_USES);
        events.push({ type: 'tool', name: String(block.name ?? ''), summary: summarizeToolInput(block.name, block.input, cwd) });
      }
    }
    return events;
  }

  function mapUser(message) {
    const blocks = message && Array.isArray(message.content) ? message.content : [];
    const errors = blocks.filter((b) => b && b.type === 'tool_result' && b.is_error === true);
    for (const b of errors) {
      const approval = approvalCommandFrom(toolResultText(b.content));
      if (approval && b.tool_use_id && !capped) {
        boundedSet(approvals, b.tool_use_id, approval, MAX_TRACKED_TOOL_USES);
        enrichDenial(b.tool_use_id, approval);
      }
    }
    return errors.map((b) => ({ type: 'tool_error', preview: clipPlain(toolResultText(b.content), TOOL_ERROR_MAX_CHARS) }));
  }

  function mapResult(msg) {
    const events = [{
      type: 'result',
      ok: msg.is_error !== true,
      text: clipText(msg.result),
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
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return [{ type: 'output', stream: 'stdout', text: clipPlain(lineText, OUTPUT_LINE_MAX_CHARS) }];
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

  return {
    push,
    denials: () => denials.slice(),
    denialsCapped: () => capped,
    /** Tamaños de las estructuras internas (tests de la corrección N4). */
    stats: () => ({ denials: denials.length, seenDenials: seenDenials.size, toolInputs: toolInputs.size, approvals: approvals.size }),
  };
}
