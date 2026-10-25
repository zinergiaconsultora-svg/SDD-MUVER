// Tests de lib/claude-cli.js — F4: R7–R16, R65 (unitarios) y R9 (estático del fuente).
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
} from '../lib/claude-cli.js';
import { PANEL_DIR } from './helpers.js';

const DEFAULT_TOOLS_TEXT = 'Read,Edit,Write,Glob,Grep,Bash(git status *),Bash(git diff *),Bash(git log *)';
// Corrección tras la prueba manual T36 (Claude Code 2.1.307): --allowedTools es VARIÁDICA en el CLI real y se
// tragaba el prompt colocado detrás. El prompt va ahora por stdin y --allowedTools es la última opción.
const BASE = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];

test('[F4-R7] constantes: CLI_FLAGS, herramientas por defecto, prompts SDD y máximo del prompt', () => {
  assert.equal(CLI_FLAGS.print, '-p');
  assert.equal(CLI_FLAGS.acceptEdits, 'acceptEdits');
  assert.deepEqual(DEFAULT_ALLOWED_TOOLS, ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)']);
  assert.equal(SDD_PROMPTS.implement, 'implementa la siguiente tarea pendiente');
  assert.equal(SDD_PROMPTS.approveTests, 'tests aprobados, lanza al reviewer');
  assert.equal(MAX_PROMPT_CHARS, 20000);
  assert.ok(Object.isFrozen(CLI_FLAGS));
});

test('[F4-R7] buildClaudeArgs en modo new: array exacto, --allowedTools al final y sin el prompt (va por stdin)', () => {
  const args = buildClaudeArgs({ session: { mode: 'new' }, allowedCommands: ['npm test'] });
  assert.deepEqual(args, [...BASE, '--allowedTools', `${DEFAULT_TOOLS_TEXT},Bash(npm test *)`]);
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
  assert.equal(buildAllowedTools(['npm test', 'npm run build']), `${DEFAULT_TOOLS_TEXT},Bash(npm test *),Bash(npm run build *)`);
  assert.equal(buildAllowedTools(['git status', 'npm test', 'npm  test']), `${DEFAULT_TOOLS_TEXT},Bash(npm test *)`);
  assert.equal(buildAllowedTools(['npm test; rm -rf /', 'ok']), `${DEFAULT_TOOLS_TEXT},Bash(ok *)`, 'los inválidos se ignoran');
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

test('[F4-R12] resolveClaudeCommand: .js/.mjs/.cjs → node + fichero; Linux → tal cual; ruta absoluta → tal cual', () => {
  const exists = () => false;
  for (const bin of ['/opt/fake/claude.js', 'tool.mjs', 'C:\\x\\cli.cjs']) {
    assert.deepEqual(resolveClaudeCommand(bin, { platform: 'linux', env: {}, execPath: '/usr/bin/node', exists }), { file: '/usr/bin/node', prefixArgs: [bin] });
  }
  assert.deepEqual(resolveClaudeCommand('claude', { platform: 'linux', env: { PATH: '/usr/bin' }, execPath: '/usr/bin/node', exists }), { file: 'claude', prefixArgs: [] });
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
  assert.deepEqual(nothing, { file: 'claude', prefixArgs: [] });

  const upperPath = resolveClaudeCommand('claude', { platform: 'win32', env: { PATH: 'C:\\bin' }, execPath: WIN_EXEC, exists: existsIn(new Set(['C:\\bin\\claude.exe'])) });
  assert.deepEqual(upperPath, { file: 'C:\\bin\\claude.exe', prefixArgs: [] });
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

test('[F4-R14] result con is_error, texto de 3000 caracteres y campos ausentes', () => {
  const { events } = mapAll([line({ type: 'result', is_error: true, result: 'x'.repeat(3000) })]);
  assert.deepEqual(events, [{ type: 'result', ok: false, text: 'x'.repeat(2000), costUsd: null, durationMs: null, numTurns: null, sessionId: null }]);
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
    { type: 'permission_denied', tool: 'Bash', detail: 'npm run lint -- --fix', suggestion: 'npm run lint' },
    { type: 'permission_denied', tool: 'WebFetch', detail: 'https://example.com', suggestion: null },
  ]);
  assert.equal(events.filter((e) => e.type === 'result').length, 1);
  assert.equal(events.findIndex((e) => e.type === 'result'), 1, 'result antes de la denegación nueva');
  assert.deepEqual(mapper.denials(), [
    { tool: 'Bash', detail: 'npm run lint -- --fix', suggestion: 'npm run lint' },
    { tool: 'WebFetch', detail: 'https://example.com', suggestion: null },
  ]);
});

test('[F4-R14] denegación con toolName/input alternativos, detalle por defecto y recorte a 200', () => {
  const { events } = mapAll([
    line({ type: 'system', subtype: 'permission_denied', toolName: 'Read', input: { file_path: '/etc/passwd' } }),
    line({ type: 'system', subtype: 'permission_denied', tool_use_id: 'z', tool_input: { a: 'b'.repeat(300) } }),
  ]);
  assert.deepEqual(events[0], { type: 'permission_denied', tool: 'Read', detail: '/etc/passwd', suggestion: null });
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
  assert.equal(suggestAllowedCommand('yarn run -s x'), 'yarn run');
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
