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
]);
/** Amplios a secas o seguidos de una opción (- o /). */
export const RUNNER_COMMANDS = Object.freeze([
  'node', 'nodejs', 'deno', 'bun', 'bunx', 'npx', 'pnpx', 'python', 'python2', 'python3', 'py', 'pythonw', 'pypy',
  'pypy3', 'uv', 'uvx', 'pipx', 'ruby', 'irb', 'perl', 'php', 'lua', 'luajit', 'java', 'jshell', 'rscript',
  'osascript', 'awk', 'gawk', 'mawk', 'nawk', 'sed', 'tclsh', 'wish', 'bash', 'sh', 'dash', 'zsh', 'ksh', 'fish',
  'csh', 'tcsh', 'pwsh', 'powershell', 'git', 'npm', 'pnpm', 'yarn', 'make',
]);
/**
 * git <sub> que ejecutan programas, cambian la configuración o aceptan una estrategia de fusión (referencia;
 * isBroadCommand usa GIT_SAFE_SUBCOMMANDS). Feature 15, Enmienda 1 (design.md §3.4): `merge -s` y
 * `cherry-pick --strategy` ejecutan `git-merge-<estrategia>` del PATH o de una ruta relativa; `revert` sale por prudencia.
 */
export const GIT_EXEC_SUBCOMMANDS = Object.freeze([
  'config', 'submodule', 'bisect', 'rebase', 'filter-branch', 'difftool', 'mergetool', 'daemon', 'instaweb',
  'web--browse', 'credential', 'upload-pack', 'receive-pack', 'archive',
  'fetch', 'pull', 'push', 'clone', 'ls-remote', 'grep', 'hook', 'send-email', 'fetch-pack', 'send-pack',
  'remote-ext', 'upload-archive', 'shell', 'maintenance',
  'merge', 'cherry-pick', 'revert',
]);
/**
 * Feature 15 (design.md §3.2): git <sub> comprobados (git 2.43, `git <sub> -h` y prueba en temporales; revisados en
 * la Enmienda 1): ninguna opción ejecuta un programa indicado en la línea de órdenes. Cualquier otro git <sub> es
 * amplio (lista permitida).
 */
export const GIT_SAFE_SUBCOMMANDS = Object.freeze([
  'status', 'diff', 'log', 'show', 'rev-list', 'rev-parse', 'describe', 'ls-files', 'ls-tree', 'cat-file', 'show-ref',
  'for-each-ref', 'branch', 'tag', 'add', 'restore', 'switch', 'checkout', 'reset', 'rm', 'mv', 'stash', 'commit',
  'blame', 'shortlog', 'reflog', 'cherry', 'merge-base', 'name-rev', 'count-objects',
  'version', 'check-ignore', 'check-attr', 'diff-tree', 'diff-index', 'diff-files', 'whatchanged',
]);
/**
 * Feature 15 (design.md §3.3): npm <sub> que no son amplios: ejecutan solo scripts de package.json (riesgo de F14 D6)
 * o solo leen (npm 10.9; revisados en la Enmienda 1, sin `view`/`info`/`show`/`v`, que ejecutan el programa de `--git`).
 */
export const NPM_SAFE_SUBCOMMANDS = Object.freeze([
  'test', 't', 'tst', 'start', 'stop', 'restart', 'ls', 'list', 'll', 'la', 'outdated',
  'explain', 'why', 'query', 'prefix', 'root',
]);
/** npm <sub> <script>: no amplio solo con un nombre de script que no empieza por "-". */
export const NPM_RUN_SUBCOMMANDS = Object.freeze(['run', 'run-script', 'rum', 'urn']);
/** npm <sub> que ejecutan programas o paquetes indicados en la línea de órdenes (referencia, design.md §3.4). */
export const NPM_EXEC_SUBCOMMANDS = Object.freeze([
  'exec', 'x', 'explore', 'init', 'create', 'innit', 'install', 'i', 'add', 'ci', 'install-test', 'it',
  'install-ci-test', 'cit', 'update', 'rebuild', 'link', 'edit', 'config', 'c', 'repo', 'docs', 'help', 'fund',
  'view', 'info', 'show', 'v',
]);
/** pnpm/yarn/bun <sub> que ejecuta paquetes arbitrarios (npm usa su lista permitida desde la feature 15). */
export const PKG_EXEC_SUBCOMMANDS = Object.freeze(['exec', 'x', 'dlx', 'explore', 'create', 'init']);
const PYTHON_FAMILY = new Set(['python', 'python2', 'python3', 'py', 'pythonw', 'pypy', 'pypy3']);
const OTHER_PKG_MANAGERS = new Set(['pnpm', 'yarn', 'bun']);
const COMMAND_EXT_RE = /\.(exe|cmd|bat|com|ps1)$/;

/** Nombre base del primer token: último segmento tras /, en minúsculas y sin .exe, .cmd, .bat, .com ni .ps1 (feature 15). */
function commandBase(token) {
  return String(token).split('/').pop().toLowerCase().replace(COMMAND_EXT_RE, '');
}

/** true si npm <t1> <t2> no es amplio: subcomando permitido o alias de run con un nombre de script (feature 15 §3.5). */
function isSafeNpm(t1, t2) {
  if (NPM_SAFE_SUBCOMMANDS.includes(t1)) return true;
  return NPM_RUN_SUBCOMMANDS.includes(t1) && t2 !== undefined && !t2.startsWith('-');
}

/** true si el comando autorizado permitiría a Claude ejecutar cualquier programa (F14 §3.5 y F15 §3.5). */
export function isBroadCommand(cmd) {
  const tokens = normalizeCommand(cmd).split(' ').filter(Boolean);
  if (!tokens.length) return false;
  const [t0, t1, t2] = tokens;
  const base = commandBase(t0);
  if (WRAPPER_COMMANDS.includes(base)) return true;
  if (RUNNER_COMMANDS.includes(base) && (t1 === undefined || t1.startsWith('-') || t1.startsWith('/'))) {
    const pythonModule = PYTHON_FAMILY.has(base) && t1 === '-m' && t2 !== undefined && !t2.startsWith('-');
    if (!pythonModule) return true;
  }
  // Desde aquí t1 existe y no empieza por - ni / (si no, el caso anterior ya devolvió true).
  if (base === 'git') return !GIT_SAFE_SUBCOMMANDS.includes(t1);
  if (base === 'npm') return !isSafeNpm(t1, t2);
  if (OTHER_PKG_MANAGERS.has(base)) {
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
    // Feature 15 §3.6: alias de run de npm (se conserva el que usó Claude) y nombre base sin extensión.
    const base = commandBase(t0);
    const runAlias = base === 'npm' ? NPM_RUN_SUBCOMMANDS.includes(t1) : OTHER_PKG_MANAGERS.has(base) && t1 === 'run';
    if (runAlias && t2 !== undefined && !t2.startsWith('-')) parts.push(t2);
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
    if (toolUseId !== undefined && toolUseId !== null) {
      if (seenDenials.has(toolUseId)) return null;
      seenDenials.add(toolUseId);
    }
    if (denials.length >= MAX_PERMISSION_DENIALS) {
      capped = true;
      return null;
    }
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
        if (block.id) toolInputs.set(block.id, block.input && typeof block.input === 'object' ? block.input : {});
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
      if (approval && b.tool_use_id) {
        approvals.set(b.tool_use_id, approval);
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

  return { push, denials: () => denials.slice(), denialsCapped: () => capped };
}
