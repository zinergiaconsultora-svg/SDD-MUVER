// Tests de lib/claude-cli.js — F4: R7–R16, R65 (unitarios) y R9 (estático del fuente).
// Feature 14: F14-R8 (resolveClaudeCommand con el resolvedor), F14-R14, F14-R15, F14-R20 (comandos amplios) y
// F14-R28 (tope de denegaciones). Ajustes declarados (design.md §8.3): [F4-R12] y [F4-R65].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CLI_FLAGS,
  DEFAULT_ALLOWED_TOOLS,
  FORBIDDEN_ARGS,
  SDD_PROMPTS,
  MAX_PROMPT_CHARS,
  buildAllowedTools,
  buildClaudeArgs,
  resolveClaudeCommand,
  createStreamMapper,
  summarizeToolInput,
  suggestAllowedCommand,
  isValidAllowedCommand,
  suggestAllowedCommands,
  TEXT_MAX_CHARS,
  BASH_RULE,
  POWERSHELL_RULE,
  MAX_PERMISSION_DENIALS,
  isBroadCommand,
  WRAPPER_COMMANDS,
  RUNNER_COMMANDS,
  GIT_EXEC_SUBCOMMANDS,
  PKG_EXEC_SUBCOMMANDS,
  POWERSHELL_EXEC_COMMANDS,
  TOOL_EXEC_SUBCOMMANDS,
} from '../lib/claude-cli.js';
import { PANEL_DIR } from './helpers.js';
import { createBinaryResolver, BIN_ERRORS } from '../lib/trusted-bin.js';

const DEFAULT_TOOLS_TEXT = 'Read,Edit,Write,Glob,Grep,Bash(git status *),PowerShell(git status *),Bash(git diff *),PowerShell(git diff *),Bash(git log *),PowerShell(git log *)' // corrección T36: reglas Bash y PowerShell;
// Corrección tras la prueba manual T36 (Claude Code 2.1.307): --allowedTools es VARIÁDICA en el CLI real y se
// tragaba el prompt colocado detrás. El prompt va ahora por stdin y --allowedTools es la última opción.
const BASE = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];

test('[F4-R7] constantes: CLI_FLAGS, herramientas por defecto, prompts SDD y máximo del prompt', () => {
  assert.equal(CLI_FLAGS.print, '-p');
  assert.equal(CLI_FLAGS.acceptEdits, 'acceptEdits');
  assert.deepEqual(DEFAULT_ALLOWED_TOOLS, ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git status *)', 'PowerShell(git status *)', 'Bash(git diff *)', 'PowerShell(git diff *)', 'Bash(git log *)', 'PowerShell(git log *)']);
  assert.equal(SDD_PROMPTS.implement, 'implementa la siguiente tarea pendiente');
  assert.equal(SDD_PROMPTS.approveTests, 'tests aprobados, lanza al reviewer');
  assert.equal(MAX_PROMPT_CHARS, 20000);
  assert.ok(Object.isFrozen(CLI_FLAGS));
});

test('[F4-R7] buildClaudeArgs en modo new: array exacto, --allowedTools al final y sin el prompt (va por stdin)', () => {
  const args = buildClaudeArgs({ session: { mode: 'new' }, allowedCommands: ['npm test'] });
  assert.deepEqual(args, [...BASE, '--allowedTools', `${DEFAULT_TOOLS_TEXT},Bash(npm test *),PowerShell(npm test *)`]);
  assert.deepEqual(buildClaudeArgs({}), [...BASE, '--allowedTools', DEFAULT_TOOLS_TEXT]);
  assert.ok(!buildClaudeArgs({ prompt: 'Añade validación de email' }).includes('Añade validación de email'), 'el prompt nunca va en argv');
});

test('[F4-R8] buildClaudeArgs: --continue y --resume <id> antes de --allowedTools (la opción variádica va la última); nada en modo new', () => {
  const cont = buildClaudeArgs({ session: { mode: 'continue' }, allowedCommands: [] });
  assert.deepEqual(cont, [...BASE, '--continue', '--allowedTools', DEFAULT_TOOLS_TEXT]);
  const resume = buildClaudeArgs({ session: { mode: 'resume', id: 's-1' }, allowedCommands: [] });
  assert.deepEqual(resume, [...BASE, '--resume', 's-1', '--allowedTools', DEFAULT_TOOLS_TEXT]);
  const fresh = buildClaudeArgs({ session: { mode: 'new' }, allowedCommands: [] });
  assert.ok(!fresh.includes('--continue') && !fresh.includes('--resume'));
  for (const args of [cont, resume, fresh]) assert.equal(args.at(-2), '--allowedTools', 'la opción variádica es la última');
});

test('[F4-R9] ningún modo incluye argumentos prohibidos, ni con un prompt igual a uno de ellos', () => {
  assert.deepEqual(FORBIDDEN_ARGS, ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions']);
  for (const forbidden of FORBIDDEN_ARGS) {
    for (const session of [{ mode: 'new' }, { mode: 'continue' }, { mode: 'resume', id: 'abc' }]) {
      const args = buildClaudeArgs({ prompt: forbidden, session, allowedCommands: ['npm test'] });
      for (const arg of args) assert.ok(!FORBIDDEN_ARGS.includes(arg), `argumento prohibido: ${arg}`);
    }
  }
  // Defensa en profundidad: si un argumento prohibido llegara por otra vía (aquí el id de sesión), se lanza.
  assert.throws(() => buildClaudeArgs({ session: { mode: 'resume', id: 'bypassPermissions' } }));
});

test('[F4-R9] estático: el fuente de lib/claude-cli.js solo nombra los argumentos prohibidos en FORBIDDEN_ARGS', async () => {
  const source = await fs.readFile(path.join(PANEL_DIR, 'lib', 'claude-cli.js'), 'utf8');
  const lines = source.split('\n');
  const declaration = lines.filter((l) => l.includes('export const FORBIDDEN_ARGS'));
  assert.equal(declaration.length, 1, 'una sola declaración de FORBIDDEN_ARGS');
  const rest = lines.filter((l) => !l.includes('export const FORBIDDEN_ARGS')).join('\n');
  for (const needle of ['dangerously-skip-permissions', 'bypassPermissions']) {
    assert.ok(!rest.includes(needle), `"${needle}" aparece fuera de FORBIDDEN_ARGS`);
  }
  assert.ok(!/shell:\s*true/.test(source));
});

test('[F4-R10] buildAllowedTools: [], dos comandos y duplicado de una regla por defecto', () => {
  assert.equal(buildAllowedTools([]), DEFAULT_TOOLS_TEXT);
  assert.equal(buildAllowedTools(['npm test', 'npm run build']), `${DEFAULT_TOOLS_TEXT},Bash(npm test *),PowerShell(npm test *),Bash(npm run build *),PowerShell(npm run build *)`);
  assert.equal(buildAllowedTools(['git status', 'npm test', 'npm  test']), `${DEFAULT_TOOLS_TEXT},Bash(npm test *),PowerShell(npm test *)`);
  assert.equal(buildAllowedTools(['npm test; rm -rf /', 'ok']), `${DEFAULT_TOOLS_TEXT},Bash(ok *),PowerShell(ok *)`, 'los inválidos se ignoran');
  assert.equal(buildAllowedTools(undefined), DEFAULT_TOOLS_TEXT);
});

test('[F4-R11] un prompt que empieza por "-" no puede leerse como opción: nunca va en argv (se envía por stdin tal cual)', () => {
  for (const prompt of ['--resume x', '- lista', '   -x y', '--dangerously-skip-permissions']) {
    const args = buildClaudeArgs({ prompt, session: { mode: 'new' } });
    assert.deepEqual(args, [...BASE, '--allowedTools', DEFAULT_TOOLS_TEXT], prompt);
  }
});

// ---------- R12: resolveClaudeCommand (tabla de design.md §5.2) ----------

const WIN_EXEC = 'C:\\Program Files\\nodejs\\node.exe';

function existsIn(set) {
  return (file) => set.has(file);
}

test('[F4-R12] resolveClaudeCommand: .js/.mjs/.cjs → node + fichero; Linux → PATH (ruta absoluta); ruta absoluta → tal cual', () => {
  const exists = () => false;
  for (const bin of ['/opt/fake/claude.js', 'C:\\x\\cli.cjs']) {
    assert.deepEqual(resolveClaudeCommand(bin, { platform: 'linux', env: {}, execPath: '/usr/bin/node', exists }), { file: '/usr/bin/node', prefixArgs: [bin] });
  }
  // Feature 14 (desviación declarada): un .js relativo se hace absoluto respecto a la carpeta del panel (design.md §5.5).
  assert.deepEqual(resolveClaudeCommand('tool.mjs', { platform: 'linux', env: {}, execPath: '/usr/bin/node', exists, panelDir: '/srv/panel' }), { file: '/usr/bin/node', prefixArgs: ['/srv/panel/tool.mjs'] });
  // Feature 14 (ajuste declarado de [F4-R12]): claude en el PATH → ruta absoluta; nada → error notFound.
  assert.deepEqual(resolveClaudeCommand('claude', { platform: 'linux', env: { PATH: '/usr/bin' }, execPath: '/usr/bin/node', exists: (f) => f === '/usr/bin/claude' }), { file: '/usr/bin/claude', prefixArgs: [] });
  assert.deepEqual(resolveClaudeCommand('claude', { platform: 'linux', env: { PATH: '/usr/bin' }, execPath: '/usr/bin/node', exists }), { error: BIN_ERRORS.notFound('claude') });
  assert.deepEqual(resolveClaudeCommand('/usr/local/bin/claude', { platform: 'linux', env: {}, execPath: '/usr/bin/node', exists }), { file: '/usr/local/bin/claude', prefixArgs: [] });
  assert.deepEqual(resolveClaudeCommand('D:\\tools\\claude.exe', { platform: 'win32', env: {}, execPath: WIN_EXEC, exists }), { file: 'D:\\tools\\claude.exe', prefixArgs: [] });
});

test('[F4-R12] resolveClaudeCommand en Windows: claude.exe en PATH, instalador nativo, npm global, solo .cmd y nada', () => {
  const env = { Path: 'C:\\Windows\\System32;C:\\Users\\U\\AppData\\Roaming\\npm', USERPROFILE: 'C:\\Users\\U' };
  const base = { platform: 'win32', env, execPath: WIN_EXEC };

  const inPath = resolveClaudeCommand('claude', { ...base, exists: existsIn(new Set(['C:\\Users\\U\\AppData\\Roaming\\npm\\claude.exe'])) });
  assert.deepEqual(inPath, { file: 'C:\\Users\\U\\AppData\\Roaming\\npm\\claude.exe', prefixArgs: [] });

  const native = resolveClaudeCommand('claude', { ...base, exists: existsIn(new Set(['C:\\Users\\U\\.local\\bin\\claude.exe'])) });
  assert.deepEqual(native, { file: 'C:\\Users\\U\\.local\\bin\\claude.exe', prefixArgs: [] });

  const cli = 'C:\\Users\\U\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
  const npm = resolveClaudeCommand('claude', { ...base, exists: existsIn(new Set(['C:\\Users\\U\\AppData\\Roaming\\npm\\claude.cmd', cli])) });
  assert.deepEqual(npm, { file: WIN_EXEC, prefixArgs: [cli] });

  const onlyCmd = resolveClaudeCommand('claude', { ...base, exists: existsIn(new Set(['C:\\Users\\U\\AppData\\Roaming\\npm\\claude.cmd'])) });
  assert.deepEqual(onlyCmd, { error: '"claude" es un script .cmd/.bat y el panel no usa shell: indica la ruta de un .exe o usa node <script>.js' });

  const nothing = resolveClaudeCommand('claude', { ...base, exists: () => false });
  assert.deepEqual(nothing, { error: BIN_ERRORS.notFound('claude') }, 'ajuste declarado F14: nunca el nombre suelto');

  const upperPath = resolveClaudeCommand('claude', { platform: 'win32', env: { PATH: 'C:\\bin' }, execPath: WIN_EXEC, exists: existsIn(new Set(['C:\\bin\\claude.exe'])) });
  assert.deepEqual(upperPath, { file: 'C:\\bin\\claude.exe', prefixArgs: [] });
});

// ---------- Feature 14: resolveClaudeCommand con el resolvedor (R8, tabla de design.md §5.5) ----------

function claudeResolver({ platform = 'linux', files = [], PATH = '/srv/p:/usr/bin', env = {} } = {}) {
  const set = new Set(files);
  return createBinaryResolver({ platform, env: { PATH, ...env }, execPath: platform === 'win32' ? WIN_EXEC : '/opt/node/bin/node', homeDir: platform === 'win32' ? 'C:\\Users\\U' : '/home/u', fsOps: { isFile: (f) => set.has(f), isExecutable: () => true, realpath: (f) => (set.has(f) ? f : null) } });
}

test('[F14-R8] resolveClaudeCommand: CLAUDE_BIN relativo con separador → absoluto respecto a la carpeta del panel', () => {
  const o = { platform: 'linux', env: {}, execPath: '/opt/node/bin/node', panelDir: '/srv/panel' };
  assert.deepEqual(resolveClaudeCommand('herramientas/fake.js', o), { file: '/opt/node/bin/node', prefixArgs: ['/srv/panel/herramientas/fake.js'] });
  assert.deepEqual(resolveClaudeCommand('bin/claude', o), { file: '/srv/panel/bin/claude', prefixArgs: [] });
  assert.deepEqual(resolveClaudeCommand('./claude', o), { file: '/srv/panel/claude', prefixArgs: [] });
  assert.deepEqual(resolveClaudeCommand('/opt/claude', o), { file: '/opt/claude', prefixArgs: [] });
  const w = { platform: 'win32', env: {}, execPath: WIN_EXEC, panelDir: 'C:\\panel' };
  assert.deepEqual(resolveClaudeCommand('herramientas\\fake.js', w), { file: WIN_EXEC, prefixArgs: ['C:\\panel\\herramientas\\fake.js'] });
  assert.deepEqual(resolveClaudeCommand('bin\\claude.exe', w), { file: 'C:\\panel\\bin\\claude.exe', prefixArgs: [] });
});

test('[F14-R8] resolveClaudeCommand con resolvedor y cwd: PATH, ~/.local/bin, descarte del proyecto y error en vez de { file: "claude" }', () => {
  const resolver = claudeResolver({ files: ['/srv/p/claude', '/usr/bin/claude'] });
  assert.deepEqual(resolveClaudeCommand('claude', { platform: 'linux', resolver, cwd: '/srv/p' }), { file: '/usr/bin/claude', prefixArgs: [] });
  assert.deepEqual(resolveClaudeCommand('claude', { platform: 'linux', resolver: claudeResolver({ files: ['/srv/p/claude'] }), cwd: '/srv/p' }), { error: BIN_ERRORS.onlyInProject('claude') });
  assert.deepEqual(resolveClaudeCommand('claude', { platform: 'linux', resolver: claudeResolver({ files: ['/home/u/.local/bin/claude'] }), cwd: '/srv/p' }), { file: '/home/u/.local/bin/claude', prefixArgs: [] });
  assert.deepEqual(resolveClaudeCommand(' ', { platform: 'linux', resolver: claudeResolver(), cwd: '/srv/p' }), { error: BIN_ERRORS.notFound('claude') });
  const winCli = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
  const w = claudeResolver({ platform: 'win32', files: ['C:\\p\\claude.exe', 'C:\\npm\\claude.cmd', winCli], PATH: 'C:\\p;C:\\npm' });
  assert.deepEqual(resolveClaudeCommand('claude', { platform: 'win32', resolver: w, cwd: 'C:\\p' }), { file: WIN_EXEC, prefixArgs: [winCli] }, 'el claude.exe de la carpeta del proyecto se descarta');
  const inProjectCli = claudeResolver({ platform: 'win32', files: ['C:\\p\\claude.cmd', 'C:\\p\\node_modules\\@anthropic-ai\\claude-code\\cli.js'], PATH: 'C:\\p' });
  assert.deepEqual(resolveClaudeCommand('claude', { platform: 'win32', resolver: inProjectCli, cwd: 'C:\\p' }), { error: BIN_ERRORS.onlyInProject('claude') }, 'cli.js dentro del proyecto tampoco');
});

// ---------- R13–R15, R24: createStreamMapper ----------

const CWD = '/srv/proyecto';
const line = (obj) => JSON.stringify(obj);

function okLines(cwd = CWD) {
  return [
    line({ type: 'system', subtype: 'init', session_id: 'fake-session-1', model: 'fake-model' }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Voy a revisar el proyecto.' }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: `${cwd}/src/a.js` } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'git status' } }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: '   ' }, { type: 'text', text: 'Hecho.' }] } }),
    line({ type: 'result', subtype: 'success', is_error: false, result: 'Hecho.', total_cost_usd: 0.0123, duration_ms: 1500, num_turns: 3, session_id: 'fake-session-1', permission_denials: [] }),
  ];
}

function mapAll(lines, cwd = CWD) {
  const mapper = createStreamMapper({ cwd });
  return { events: lines.flatMap((l) => mapper.push(l)), mapper };
}

test('[F4-R13] escenario ok → session, text, tool, tool, text y result en orden exacto', () => {
  const { events } = mapAll(okLines());
  assert.deepEqual(events, [
    { type: 'session', sessionId: 'fake-session-1', model: 'fake-model' },
    { type: 'text', text: 'Voy a revisar el proyecto.' },
    { type: 'tool', name: 'Edit', summary: 'src/a.js' },
    { type: 'tool', name: 'Bash', summary: 'git status' },
    { type: 'text', text: 'Hecho.' },
    { type: 'result', ok: true, text: 'Hecho.', costUsd: 0.0123, durationMs: 1500, numTurns: 3, sessionId: 'fake-session-1' },
  ]);
});

test('[F4-R14] result con is_error, texto de 3000 caracteres (ya no se corta) y campos ausentes', () => {
  const { events } = mapAll([line({ type: 'result', is_error: true, result: 'x'.repeat(3000) })]);
  assert.deepEqual(events, [{ type: 'result', ok: false, text: 'x'.repeat(3000), costUsd: null, durationMs: null, numTurns: null, sessionId: null }]);
});

test('[F4-R14][F4-R13] corrección T36: texto del asistente y del result hasta 20000 caracteres; si se recorta, "… (texto recortado)"', () => {
  assert.equal(TEXT_MAX_CHARS, 20000);
  const summary = '## Resumen\n' + 'a'.repeat(2400) + '\n**Git**\n- Estado limpio';
  const long = 'z'.repeat(25000);
  const { events } = mapAll([
    line({ type: 'assistant', message: { content: [{ type: 'text', text: summary }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: long }] } }),
    line({ type: 'result', is_error: false, result: long }),
  ]);
  assert.equal(events[0].text, summary, 'un resumen de ~2500 caracteres llega entero');
  assert.equal(events[1].text, 'z'.repeat(20000) + '… (texto recortado)');
  assert.equal(events[2].text, 'z'.repeat(20000) + '… (texto recortado)');
});

test('[F4-R14][F4-R24] dos denegaciones en result, una ya emitida como system/permission_denied → un solo evento nuevo', () => {
  const input = { command: 'npm run lint -- --fix' };
  const { events, mapper } = mapAll([
    line({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'tu1', tool_input: input }),
    line({ type: 'result', is_error: false, result: 'r', permission_denials: [
      { tool_name: 'Bash', tool_use_id: 'tu1', tool_input: input },
      { tool_name: 'WebFetch', tool_use_id: 'tu2', tool_input: { url: 'https://example.com' } },
    ] }),
  ]);
  assert.deepEqual(events.filter((e) => e.type === 'permission_denied'), [
    { type: 'permission_denied', tool: 'Bash', detail: 'npm run lint -- --fix', suggestion: 'npm run lint', suggestions: ['npm run lint'] },
    { type: 'permission_denied', tool: 'WebFetch', detail: 'https://example.com', suggestion: null, suggestions: [] },
  ]);
  assert.equal(events.filter((e) => e.type === 'result').length, 1);
  assert.equal(events.findIndex((e) => e.type === 'result'), 1, 'result antes de la denegación nueva');
  assert.deepEqual(mapper.denials(), [
    { tool: 'Bash', detail: 'npm run lint -- --fix', suggestion: 'npm run lint', suggestions: ['npm run lint'] },
    { tool: 'WebFetch', detail: 'https://example.com', suggestion: null, suggestions: [] },
  ]);
});

test('[F4-R14] denegación con toolName/input alternativos, detalle por defecto y recorte a 200', () => {
  const { events } = mapAll([
    line({ type: 'system', subtype: 'permission_denied', toolName: 'Read', input: { file_path: '/etc/passwd' } }),
    line({ type: 'system', subtype: 'permission_denied', tool_use_id: 'z', tool_input: { a: 'b'.repeat(300) } }),
  ]);
  assert.deepEqual(events[0], { type: 'permission_denied', tool: 'Read', detail: '/etc/passwd', suggestion: null, suggestions: [] });
  assert.equal(events[1].tool, 'desconocida');
  assert.equal(events[1].detail.length, 200);
});

test('[F4-R15] tool_result de error (1000 caracteres), api_retry, línea no JSON y tipos desconocidos', () => {
  const { events } = mapAll([
    line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'e'.repeat(1000) }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'uno ' }, { type: 'image' }, { type: 'text', text: 'dos' }] }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: false, content: 'bien' }] } }),
    line({ type: 'system', subtype: 'api_retry', attempt: 2 }),
    'Invalid API key',
    '',
    line({ type: 'stream_event', event: {} }),
    line({ type: 'otro' }),
    'x'.repeat(2500),
  ]);
  assert.deepEqual(events, [
    { type: 'tool_error', preview: 'e'.repeat(300) },
    { type: 'tool_error', preview: 'uno dos' },
    { type: 'notice', message: 'Reintentando la llamada a la API (intento 2)' },
    { type: 'output', stream: 'stdout', text: 'Invalid API key' },
    { type: 'output', stream: 'stdout', text: 'x'.repeat(2000) },
  ]);
});

// ---------- R16: summarizeToolInput ----------

test('[F4-R16] summarizeToolInput con cada herramienta, rutas fuera, rutas Windows y recorte a 120', () => {
  assert.equal(summarizeToolInput('Read', { file_path: '/srv/proyecto/README.md' }, CWD), 'README.md');
  assert.equal(summarizeToolInput('Edit', { file_path: '/srv/proyecto/src/a.js' }, CWD), 'src/a.js');
  assert.equal(summarizeToolInput('MultiEdit', { file_path: '/srv/proyecto/b.js' }, CWD), 'b.js');
  assert.equal(summarizeToolInput('Write', { file_path: '/srv/proyecto/c/d.txt' }, `${CWD}/`), 'c/d.txt');
  assert.equal(summarizeToolInput('NotebookEdit', { notebook_path: '/srv/proyecto/n.ipynb' }, CWD), 'n.ipynb');
  assert.equal(summarizeToolInput('Read', { file_path: '/etc/hosts' }, CWD), '/etc/hosts', 'fuera de la carpeta se devuelve tal cual');
  assert.equal(summarizeToolInput('Read', { file_path: '/srv/proyecto-b/x.js' }, CWD), '/srv/proyecto-b/x.js', 'prefijo sin separador no es "dentro"');
  assert.equal(summarizeToolInput('Edit', { file_path: 'C:\\Users\\U\\App\\src\\a.js' }, 'c:\\users\\u\\app'), 'src/a.js');
  assert.equal(summarizeToolInput('Bash', { command: 'npm test' }, CWD), 'npm test');
  assert.equal(summarizeToolInput('Glob', { pattern: '**/*.js' }, CWD), '**/*.js');
  assert.equal(summarizeToolInput('Grep', { pattern: 'TODO' }, CWD), 'TODO');
  assert.equal(summarizeToolInput('WebFetch', { url: 'https://example.com' }, CWD), 'https://example.com');
  assert.equal(summarizeToolInput('Task', { description: 'Revisar tests' }, CWD), 'Revisar tests');
  assert.equal(summarizeToolInput('Agent', { description: 'Subagente' }, CWD), 'Subagente');
  assert.equal(summarizeToolInput('TodoWrite', { todos: [] }, CWD), '');
  assert.equal(summarizeToolInput('Bash', null, CWD), '');
  const long = summarizeToolInput('Bash', { command: 'a'.repeat(300) }, CWD);
  assert.equal([...long].length, 120);
  assert.ok(long.endsWith('…'));
});

// ---------- R65: suggestAllowedCommand / isValidAllowedCommand ----------

test('[F4-R65] suggestAllowedCommand', () => {
  assert.equal(suggestAllowedCommand('npm run lint -- --fix'), 'npm run lint');
  assert.equal(suggestAllowedCommand('pytest -x'), 'pytest');
  assert.equal(suggestAllowedCommand('cargo test'), 'cargo test');
  assert.equal(suggestAllowedCommand('  npm   test  '), 'npm test');
  assert.equal(suggestAllowedCommand('pnpm run build --prod'), 'pnpm run build');
  assert.equal(suggestAllowedCommand('yarn run -s x'), null, 'ajuste declarado F14: `yarn run` sin script es amplio');
  assert.equal(suggestAllowedCommand('npm test && rm x'), null);
  for (const bad of ['a || b', 'a; b', 'a | b', 'a > b', 'a < b', 'echo `x`', 'echo $(x)']) assert.equal(suggestAllowedCommand(bad), null, bad);
  assert.equal(suggestAllowedCommand('python3 (x)'), null, 'no cumple la regla de allowedCommands');
  assert.equal(suggestAllowedCommand(undefined), null);
});

test('[F4-R65] la denegación de una herramienta distinta de Bash no propone comando', () => {
  const { events } = mapAll([line({ type: 'system', subtype: 'permission_denied', tool_name: 'WebFetch', tool_input: { url: 'https://x' } })]);
  assert.equal(events[0].suggestion, null);
});

test('[F4-R10][F4-R62] isValidAllowedCommand', () => {
  for (const ok of ['npm test', 'npm run build', 'node scripts/x.js', 'git status', 'make', 'a=b', '@scope/x', '  npm   test ']) assert.equal(isValidAllowedCommand(ok), true, ok);
  for (const bad of ['', '   ', 'npm test && rm', 'a(b)', 'x;y', 'a'.repeat(201), 5, null, 'echo "x"']) assert.equal(isValidAllowedCommand(bad), false, String(bad));
});

// ---------- Corrección T36: detalle de la denegación con el CLI real (F4-R24, F4-R65) ----------

test('[F4-R24][F4-R65] denegación real con tool_input vacío: el detalle sale del texto "requires approval: …" y se proponen los comandos base', () => {
  const compound = 'git log --oneline | head; git rev-list --left-right --count main...HEAD';
  const { events, mapper } = mapAll([
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: compound } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'This Bash command contains multiple operations. The following part requires approval: head; git rev-list --left-right --count main...HEAD' }] } }),
    line({ type: 'result', is_error: false, result: 'ok', permission_denials: [{ tool_name: 'Bash', tool_use_id: 'tu1', tool_input: {} }] }),
  ]);
  const denial = events.find((e) => e.type === 'permission_denied');
  assert.deepEqual(denial, { type: 'permission_denied', tool: 'Bash', detail: 'head; git rev-list --left-right --count main...HEAD', suggestion: 'head', suggestions: ['head', 'git rev-list'] });
  assert.ok(!JSON.stringify(mapper.denials()).includes('{}'));
});

test('[F4-R24] denegación con tool_input.command: se usa ese comando; sin comando ni texto: detalle vacío, nunca "{}"', () => {
  const { events } = mapAll([
    line({ type: 'result', is_error: false, result: 'ok', permission_denials: [
      { tool_name: 'Bash', tool_use_id: 'a', tool_input: { command: 'pytest -x' } },
      { tool_name: 'Bash', tool_use_id: 'b', tool_input: {} },
    ] }),
  ]);
  const denials = events.filter((e) => e.type === 'permission_denied');
  assert.deepEqual(denials[0], { type: 'permission_denied', tool: 'Bash', detail: 'pytest -x', suggestion: 'pytest', suggestions: ['pytest'] });
  assert.deepEqual(denials[1], { type: 'permission_denied', tool: 'Bash', detail: '', suggestion: null, suggestions: [] });
});

test('[F4-R65] suggestAllowedCommands: comando base de cada parte, validado con ALLOWED_COMMAND_RE', () => {
  assert.deepEqual(suggestAllowedCommands('head; git rev-list --left-right --count main...HEAD'), ['head', 'git rev-list']);
  assert.deepEqual(suggestAllowedCommands('npm run lint -- --fix && npm test | tee x'), ['npm run lint', 'npm test', 'tee x']);
  assert.deepEqual(suggestAllowedCommands('echo $(x); a(b)'), []);
  assert.deepEqual(suggestAllowedCommands(undefined), []);
});

// ---------- Corrección T36: herramienta PowerShell de Claude Code en Windows (F4-R10, F4-R24, F4-R65) ----------

test('[F4-R10] corrección T36: cada comando autorizado (y git status/diff/log) se emite como regla Bash y PowerShell', () => {
  assert.equal(POWERSHELL_RULE('node'), 'PowerShell(node *)');
  assert.equal(BASH_RULE('node'), 'Bash(node *)');
  const tools = buildAllowedTools(['node']).split(',');
  assert.ok(tools.includes('Bash(node *)') && tools.includes('PowerShell(node *)'));
  for (const git of ['git status', 'git diff', 'git log']) assert.ok(tools.includes(`PowerShell(${git} *)`), git);
  const args = buildClaudeArgs({ session: { mode: 'new' }, allowedCommands: ['node'] });
  assert.equal(args.at(-2), '--allowedTools', '--allowedTools sigue siendo la última opción');
  assert.ok(args.at(-1).includes('PowerShell(node *)'));
});

test('[F4-R24][F4-R65] corrección T36: una denegación de PowerShell se trata como la de Bash (detalle y comando base)', () => {
  const { events } = mapAll([
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'ps1', name: 'PowerShell', input: { command: 'node --version' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'ps1', is_error: true, content: 'This PowerShell command contains multiple operations. The following part requires approval: node --version' }] } }),
    line({ type: 'result', is_error: false, result: 'ok', permission_denials: [{ tool_name: 'PowerShell', tool_use_id: 'ps1', tool_input: {} }] }),
  ]);
  // Feature 14 (desviación declarada): `node` es amplio y no se propone (F14-R15); el detalle no cambia.
  assert.deepEqual(events.find((e) => e.type === 'permission_denied'), { type: 'permission_denied', tool: 'PowerShell', detail: 'node --version', suggestion: null, suggestions: [] });
  const direct = mapAll([line({ type: 'result', is_error: false, permission_denials: [{ tool_name: 'PowerShell', tool_use_id: 'x', tool_input: { command: 'npm run lint -- --fix' } }] })]).events;
  assert.equal(direct.find((e) => e.type === 'permission_denied').suggestion, 'npm run lint');
  assert.equal(summarizeToolInput('PowerShell', { command: 'node --version' }, CWD), 'node --version');
});

// ---------- Feature 14: tope de denegaciones (R28) ----------

test('[F14-R28] createStreamMapper: con 60 denegaciones distintas solo registra y emite las 50 primeras y marca denialsCapped', () => {
  assert.equal(MAX_PERMISSION_DENIALS, 50);
  const mapper = createStreamMapper({ cwd: CWD });
  const events = [];
  for (let i = 0; i < 60; i++) {
    events.push(...mapper.push(line({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: `d-${i}`, tool_input: { command: `cmd-${i} x` } })));
    if (i === 49) assert.equal(mapper.denialsCapped(), false, 'con 50 todavía no se ha descartado ninguna');
  }
  assert.equal(events.filter((e) => e.type === 'permission_denied').length, 50);
  assert.equal(mapper.denials().length, 50);
  assert.equal(mapper.denials()[49].detail, 'cmd-49 x');
  assert.equal(mapper.denialsCapped(), true);
  const more = mapper.push(line({ type: 'result', is_error: false, result: 'ok', permission_denials: [{ tool_name: 'Bash', tool_use_id: 'otra', tool_input: { command: 'x' } }] }));
  assert.deepEqual(more.map((e) => e.type), ['result'], 'las del result tampoco se emiten');
  assert.equal(mapper.denials().length, 50);
});

// ---------- Feature 14: comandos amplios (R14, R15, R20) ----------

test('[F14-R14] isBroadCommand con la tabla de design.md §3.5', () => {
  const broad = ['node', 'node.exe', '/usr/bin/python3', 'node -e', 'python -c', 'bash', 'bash -c', 'env', 'env A=1 x', 'sudo ls', 'xargs', 'find .', 'git', 'git -c', 'git config', 'npm', 'npm exec', 'npm run', 'npx', 'cmd /c', 'powershell -Command', 'make -f',
    'NODE', 'C:/tools/Node.exe', 'pnpm dlx x', 'yarn create app', 'bun x y', 'npm run -s', 'git submodule update', 'python3 -m', 'python -m -x', 'git rebase -i', 'pwsh -File x', 'deno'];
  const notBroad = ['npm test', 'npm run build', 'git rev-list', 'git status', 'node scripts/build.js', 'python -m pytest', 'bash init.sh', 'pwsh tools/x.ps1', 'cargo test', 'pytest', 'make test', 'npx vitest',
    'npm run lint', 'python3 -m pytest', 'git log', 'yarn test', 'bun run build', 'head', 'tee x'];
  for (const cmd of broad) assert.equal(isBroadCommand(cmd), true, cmd);
  for (const cmd of notBroad) assert.equal(isBroadCommand(cmd), false, cmd);
  assert.equal(isBroadCommand('  npm   exec  '), true, 'normalizado');
  assert.equal(isBroadCommand(undefined), false);
  for (const list of [WRAPPER_COMMANDS, RUNNER_COMMANDS, GIT_EXEC_SUBCOMMANDS, PKG_EXEC_SUBCOMMANDS]) assert.ok(Object.isFrozen(list));
  assert.deepEqual(PKG_EXEC_SUBCOMMANDS, ['exec', 'x', 'dlx', 'explore', 'create', 'init']);
  for (const w of ['env', 'sudo', 'xargs', 'find', 'exec', 'eval', 'cmd', 'wsl', 'gdb']) assert.ok(WRAPPER_COMMANDS.includes(w), w);
  for (const r of ['node', 'python3', 'bash', 'sh', 'pwsh', 'powershell', 'git', 'npm', 'make', 'awk', 'sed']) assert.ok(RUNNER_COMMANDS.includes(r), r);
  for (const g of ['config', 'submodule', 'bisect', 'rebase', 'filter-branch', 'difftool', 'mergetool', 'credential', 'archive']) assert.ok(GIT_EXEC_SUBCOMMANDS.includes(g), g);
});

test('[F14-R15] suggestAllowedCommand(s) nunca proponen un comando amplio y proponen el primer subcomando o argumento', () => {
  for (const cmd of ['node -e "x"', 'git -c a=b push', 'env A=1 node x', 'xargs rm', 'bash -c x', 'npm exec foo', 'yarn run -s x', 'node --version', 'python -c x', 'sudo ls', 'npx']) {
    assert.equal(suggestAllowedCommand(cmd), null, cmd);
    assert.deepEqual(suggestAllowedCommands(cmd), [], cmd);
  }
  assert.deepEqual(suggestAllowedCommands('find . -exec rm {} ;'), []);
  assert.equal(suggestAllowedCommand('git rev-list --count HEAD'), 'git rev-list');
  assert.equal(suggestAllowedCommand('npm run lint -- --fix'), 'npm run lint');
  assert.equal(suggestAllowedCommand('python3 -m pytest -x'), 'python3 -m pytest');
  assert.equal(suggestAllowedCommand('python -m pytest'), 'python -m pytest');
  assert.equal(suggestAllowedCommand('bun run build --watch'), 'bun run build');
  assert.equal(suggestAllowedCommand('node build.js --prod'), 'node build.js');
  assert.equal(suggestAllowedCommand('pytest -x'), 'pytest', 'los casos de la fase 4 que no son amplios no cambian');
  assert.equal(suggestAllowedCommand('cargo test'), 'cargo test');
  assert.deepEqual(suggestAllowedCommands('node -e x && npm test'), ['npm test']);
  assert.deepEqual(suggestAllowedCommands('head; git rev-list --left-right --count main...HEAD'), ['head', 'git rev-list']);
});

test('[F14-R20] isValidAllowedCommand rechaza los que empiezan por - o terminan en :', () => {
  for (const bad of ['-x', '--help', 'git:', 'npm run test:', ' npm run test: ', ':']) assert.equal(isValidAllowedCommand(bad), false, bad);
  for (const ok of ['npm run test:unit', 'a:b', 'git status', 'x-y']) assert.equal(isValidAllowedCommand(ok), true, ok);
});

test('[F14-R20] buildAllowedTools con 200 comandos válidos aleatorios: ninguna regla contiene * ? ( ) , en el comando ni el sufijo :*', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ._:/=@+-';
  let seed = 14;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const commands = [];
  while (commands.length < 200) {
    const length = 1 + Math.floor(random() * 30);
    let cmd = '';
    for (let i = 0; i < length; i++) cmd += alphabet[Math.floor(random() * alphabet.length)];
    if (isValidAllowedCommand(cmd)) commands.push(cmd);
  }
  const rules = buildAllowedTools(commands).split(/,(?=(?:Bash|PowerShell|Read|Edit|Write|Glob|Grep)\b)/);
  assert.ok(rules.length > 11);
  for (const rule of rules.slice(DEFAULT_ALLOWED_TOOLS.length)) {
    const match = /^(Bash|PowerShell)\((.*) \*\)$/.exec(rule);
    assert.ok(match, rule);
    assert.ok(!/[*?(),]/.test(match[2]), rule);
    assert.ok(!match[2].endsWith(':'), rule);
    assert.ok(!rule.includes(':*'), rule);
    assert.ok(!match[2].startsWith('-'), rule);
  }
});

// ---------- Corrección revisión F14 (MA1, N4): comandos amplios que se colaban y estructuras acotadas ----------

test('[F14-R34] isBroadCommand: extensiones .cmd/.bat/.ps1/.com/.exe sin mayúsculas, git con remotos y grep, PowerShell y python con versión', () => {
  const broad = [
    'npx.cmd', 'npx.cmd -y paquete', 'NPX.CMD', 'npm.cmd exec x', 'pnpm.cmd dlx x', 'node.cmd', 'NODE.EXE', 'Node.Exe -e', 'bash.bat', 'pwsh.ps1', 'python.com',
    'git fetch', 'git pull', 'git push', 'git clone', 'git ls-remote', 'git grep', 'git remote', 'git send-email', 'git.exe fetch', 'GIT FETCH',
    'git submodule', 'git archive', 'git daemon', 'git upload-pack', 'git receive-pack', 'git difftool', 'git mergetool', 'git filter-branch', 'git bisect', 'git rebase',
    'Invoke-Expression', 'invoke-expression x', 'iex', 'IEX x', 'Invoke-Command', 'icm', 'Start-Process', 'start', 'saps', 'Invoke-Item', 'ii', 'Add-Type',
    'Invoke-WebRequest', 'iwr', 'Invoke-RestMethod', 'irm', 'Start-Job', 'New-Object',
    'python3.12', 'python3.12 -c', 'python3.9 -c x', 'pythonw', 'py -3', 'py', 'pypy3.10',
    'yarn node', 'deno eval', 'deno run', 'uv run', 'pipx run', 'corepack', 'corepack pnpm', 'tsx', 'tsx -e', 'ts-node',
  ];
  for (const cmd of broad) assert.equal(isBroadCommand(cmd), true, cmd);
  for (const cmd of ['git status', 'git log', 'git diff', 'git rev-list', 'npm test', 'npm.cmd test', 'python3.12 -m pytest', 'cargo test', 'tsx scripts/build.ts', 'pytest']) {
    assert.equal(isBroadCommand(cmd), false, cmd);
  }
  for (const c of ['invoke-expression', 'iex', 'start-process', 'invoke-webrequest', 'irm', 'add-type', '&']) assert.ok(POWERSHELL_EXEC_COMMANDS.includes(c), c);
  assert.deepEqual(TOOL_EXEC_SUBCOMMANDS.yarn, ['node']);
});

test('[F14-R34] los casos del informe de revisión no se proponen tras una denegación', () => {
  for (const cmd of ['git fetch --upload-pack=x .', 'git grep -O x y', 'npx.cmd -y paquete', 'Invoke-Expression "x"', 'git ls-remote --upload-pack=x .', 'python3.12 -c x', 'iex x', 'git push origin main']) {
    assert.equal(suggestAllowedCommand(cmd), null, cmd);
    assert.deepEqual(suggestAllowedCommands(cmd), [], cmd);
  }
  assert.equal(suggestAllowedCommand('npm.cmd test'), 'npm.cmd test', 'no amplio');
});

test('[F14-R38] createStreamMapper: tras el tope de 50 no crecen las estructuras internas y toolInputs/approvals están acotados', () => {
  const mapper = createStreamMapper({ cwd: CWD });
  for (let i = 0; i < 60; i++) mapper.push(line({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: `d-${i}`, tool_input: { command: 'x' } }));
  const atCap = mapper.stats();
  assert.equal(atCap.denials, 50);
  assert.equal(atCap.seenDenials, 50, 'las descartadas no se recuerdan');
  for (let i = 0; i < 3000; i++) {
    mapper.push(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t-${i}`, name: 'Bash', input: { command: 'ls' } }] } }));
    mapper.push(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t-${i}`, is_error: true, content: 'requires approval: ls' }] } }));
  }
  const after = mapper.stats();
  assert.equal(after.toolInputs, 0, 'tras el tope no se guardan inputs');
  assert.equal(after.approvals, 0);
  const fresh = createStreamMapper({ cwd: CWD });
  for (let i = 0; i < 3000; i++) fresh.push(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t-${i}`, name: 'Bash', input: { command: 'ls' } }] } }));
  assert.ok(fresh.stats().toolInputs <= 500, `toolInputs ${fresh.stats().toolInputs}`);
});

// ---------- Feature 13: llamada de solo lectura, modelo y normalización del resumen (F13-R11, F13-R14, F13-R55) ----------

const {
  CLI_MODELS,
  MODEL_LABELS,
  isValidModel,
  SUMMARY_MODEL,
  SUMMARY_MAX_TURNS,
  READ_ONLY_TOOLS,
  READ_ONLY_DENIED_TOOLS,
  buildReadOnlyClaudeArgs,
} = await import('../lib/claude-cli.js');

test('[F13-R11] buildReadOnlyClaudeArgs: array exacto, haiku, sin acceptEdits, --allowedTools Read,Glob,Grep la última', () => {
  const args = buildReadOnlyClaudeArgs();
  assert.deepEqual(args, [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--model', 'haiku',
    '--permission-mode', 'default',
    '--max-turns', '10',
    '--tools', 'Read,Glob,Grep',
    '--disallowedTools', 'Bash,PowerShell,Edit,MultiEdit,Write,NotebookEdit,WebFetch,WebSearch,Task,Agent,mcp__*',
    '--allowedTools', 'Read,Glob,Grep',
  ]);
  assert.ok(!args.includes('acceptEdits'));
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.equal(args.at(-2), '--allowedTools', '--allowedTools es la última opción');
  const allowed = args.at(-1);
  assert.equal(allowed, 'Read,Glob,Grep');
  for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write']) assert.ok(!allowed.split(',').includes(tool), `sin ${tool}`);
  const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
  for (const tool of ['Bash', 'PowerShell', 'mcp__*']) assert.ok(denied.includes(tool), `deniega ${tool}`);
  for (const arg of args) assert.ok(!FORBIDDEN_ARGS.includes(arg));
  assert.equal(SUMMARY_MODEL, 'haiku');
  assert.equal(SUMMARY_MAX_TURNS, 10);
  assert.deepEqual(READ_ONLY_TOOLS, ['Read', 'Glob', 'Grep']);
  assert.deepEqual(READ_ONLY_DENIED_TOOLS, ['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'mcp__*']);
  assert.deepEqual(buildReadOnlyClaudeArgs({ allowedCommands: ['npm test'], model: 'opus' }), args, 'ignora cualquier entrada');
  assert.equal(CLI_FLAGS.model, '--model');
  assert.equal(CLI_FLAGS.permissionDefault, 'default');
  assert.equal(CLI_FLAGS.maxTurns, '--max-turns');
  assert.equal(CLI_FLAGS.tools, '--tools');
  assert.equal(CLI_FLAGS.disallowedTools, '--disallowedTools');
});

test('[F13-R11] estático: buildReadOnlyClaudeArgs no usa DEFAULT_ALLOWED_TOOLS, shellRules ni allowedCommands', () => {
  const source = buildReadOnlyClaudeArgs.toString();
  for (const needle of ['DEFAULT_ALLOWED_TOOLS', 'shellRules', 'allowedCommands', 'buildAllowedTools', 'acceptEdits']) {
    assert.ok(!source.includes(needle), `buildReadOnlyClaudeArgs nombra ${needle}`);
  }
});

test('[F13-R55] buildClaudeArgs con modelo: --model justo antes de --allowedTools; default, undefined y no permitidos sin --model', () => {
  assert.deepEqual(CLI_MODELS, ['haiku', 'sonnet', 'opus']);
  assert.ok(Object.isFrozen(CLI_MODELS));
  assert.deepEqual(MODEL_LABELS, { default: 'Por defecto', haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' });
  for (const model of ['haiku', 'sonnet', 'opus']) {
    const args = buildClaudeArgs({ session: { mode: 'new' }, allowedCommands: [], model });
    assert.deepEqual(args, [...BASE, '--model', model, '--allowedTools', DEFAULT_TOOLS_TEXT]);
    const resume = buildClaudeArgs({ session: { mode: 'resume', id: 's-1' }, allowedCommands: [], model });
    assert.deepEqual(resume, [...BASE, '--resume', 's-1', '--model', model, '--allowedTools', DEFAULT_TOOLS_TEXT]);
  }
  for (const model of ['default', undefined, null, 'opus --dangerously-skip-permissions', 'claude-opus-9', 'HAIKU', 3]) {
    const args = buildClaudeArgs({ session: { mode: 'new' }, allowedCommands: [], model });
    assert.deepEqual(args, [...BASE, '--allowedTools', DEFAULT_TOOLS_TEXT], `sin --model con ${String(model)}`);
  }
  assert.equal(isValidModel('default'), true);
  assert.equal(isValidModel('opus'), true);
  for (const bad of ['gpt-4', 3, 'haiku --verbose', '', null, undefined, 'Opus']) assert.equal(isValidModel(bad), false, String(bad));
});

test('[F13-R14] normalizeGeneratedSummary: comillas, Markdown, viñetas, prefijo, código, una frase, ≤ 140 sin «…» y vacío', async () => {
  const { normalizeGeneratedSummary, GENERATED_MAX_CHARS } = await import('../lib/summary-api.js');
  assert.equal(GENERATED_MAX_CHARS, 140);
  assert.equal(normalizeGeneratedSummary('«Un CRM para pymes.»'), 'Un CRM para pymes.');
  assert.equal(normalizeGeneratedSummary('"Un CRM para pymes."'), 'Un CRM para pymes.');
  assert.equal(normalizeGeneratedSummary('“Un CRM para pymes.”'), 'Un CRM para pymes.');
  assert.equal(normalizeGeneratedSummary('**Resumen:** CRM de clientes.'), 'CRM de clientes.');
  assert.equal(normalizeGeneratedSummary('- CRM de clientes.\nSegunda línea'), 'CRM de clientes.');
  assert.equal(normalizeGeneratedSummary('1. CRM de `clientes`.'), 'CRM de clientes.');
  assert.equal(normalizeGeneratedSummary('```\nCRM de clientes en código.\n```'), 'CRM de clientes en código.');
  assert.equal(normalizeGeneratedSummary('\n\n  Gestor   de  turnos.  Y algo más.'), 'Gestor de turnos.');
  const long = `${'Herramienta que gestiona muchas cosas '.repeat(6).trim()}.`;
  assert.ok([...long].length >= 200);
  const clipped = normalizeGeneratedSummary(long);
  assert.ok([...clipped].length <= 140);
  assert.ok(!clipped.includes('…'));
  assert.ok(long.startsWith(clipped) && long[clipped.length] === ' ', 'palabra entera');
  for (const empty of ['', '   ', '```\n```', null, undefined, '""']) assert.equal(normalizeGeneratedSummary(empty), null, JSON.stringify(empty));
});
