#!/usr/bin/env node
// CLI de Claude Code FALSO para los tests (design.md §8.1). Nunca se usa el `claude` real en los tests.
// - Registra en FAKE_CLAUDE_LOG (si existe) una línea { argv, cwd, pid }.
// - Como el CLI real: --allowedTools es variádica y el prompt se lee de stdin (o de un argumento posicional suelto);
//   sin prompt → el mismo error que el CLI real y código 1. El escenario es la primera marca [[nombre]] del prompt.
// - Escribe stream-json (una línea JSON por mensaje) en stdout, como `claude -p --output-format stream-json --verbose`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
process.stdout.on('error', () => {}); // tubería cerrada (p. ej. al cancelar): se ignora
const logFile = process.env.FAKE_CLAUDE_LOG;

function log(entry) {
  if (!logFile) return;
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

// Sin argumentos (p. ej. cuando `node --test` recorre test/) no hace nada.
if (argv.length === 0) process.exit(0);

/**
 * Parseo como el CLI real (Claude Code 2.1.x): `--allowedTools` es VARIÁDICA y consume todos los argumentos
 * siguientes que no empiecen por "-" (incluido un prompt colocado detrás). Lo que queda suelto es el prompt posicional.
 */
const VALUE_FLAGS = new Set(['--output-format', '--permission-mode', '--resume']);
const VARIADIC_FLAGS = new Set(['--allowedTools']);
const positional = [];
const allowedTools = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (VARIADIC_FLAGS.has(arg)) {
    while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) allowedTools.push(argv[++i]);
  } else if (VALUE_FLAGS.has(arg)) {
    i += 1;
  } else if (!arg.startsWith('-')) {
    positional.push(arg);
  }
}

/** Lee stdin completo (vacío si es /dev/null o un TTY). */
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

const stdinText = await readStdin();
const prompt = positional.length ? positional.join(' ') : stdinText;
log({ argv, cwd: process.cwd(), pid: process.pid, prompt, stdin: stdinText, allowedTools });
if (!prompt.trim()) {
  process.stderr.write('Error: Input must be provided either through stdin or as a prompt argument when using --print\n');
  process.exit(1);
}

const marker = /\[\[([a-z_]+)\]\]/.exec(prompt);
const scenario = marker ? marker[1] : 'ok';
const SESSION_ID = 'fake-session-1';

function out(obj) {
  process.stdout.write((typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n');
}

const init = () => out({ type: 'system', subtype: 'init', session_id: SESSION_ID, model: 'fake-model', cwd: process.cwd(), tools: ['Read', 'Edit', 'Bash'] });
const assistantText = (text) => out({ type: 'assistant', session_id: SESSION_ID, message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = (id, name, input) => out({ type: 'assistant', session_id: SESSION_ID, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError = false) => out({ type: 'user', session_id: SESSION_ID, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const result = (extra = {}) => out({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Hecho.',
  total_cost_usd: 0.0123,
  duration_ms: 1500,
  num_turns: 3,
  session_id: SESSION_ID,
  permission_denials: [],
  ...extra,
});

function okTail() {
  assistantText('Voy a revisar el proyecto.');
  toolUse('tu-edit', 'Edit', { file_path: path.join(process.cwd(), 'src', 'a.js'), old_string: 'a', new_string: 'b' });
  toolResult('tu-edit', 'ok');
  toolUse('tu-bash', 'Bash', { command: 'git status' });
  toolResult('tu-bash', 'nothing to commit');
  assistantText('Hecho.');
  result();
}

switch (scenario) {
  case 'ok':
    init();
    okTail();
    process.exitCode = 0;
    break;
  case 'denied': {
    init();
    const input = { command: 'npm run lint -- --fix' };
    toolUse('tu1', 'Bash', input);
    out({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'tu1', tool_input: input });
    toolResult('tu1', 'Claude requested permissions to use Bash, but you have not granted it yet.', true);
    assistantText('No tengo permiso para ejecutar el linter.');
    result({
      result: 'No tengo permiso para ejecutar el linter.',
      permission_denials: [
        { tool_name: 'Bash', tool_use_id: 'tu1', tool_input: input },
        { tool_name: 'WebFetch', tool_use_id: 'tu2', tool_input: { url: 'https://example.com' } },
      ],
    });
    process.exitCode = 0;
    break;
  }
  case 'denied_real': {
    // Como Claude Code 2.1.307 real: la denegación NO detiene el trabajo; el detalle llega en el texto del error de
    // herramienta ("requires approval: …") y permission_denials[].tool_input puede venir vacío; result = success.
    init();
    toolUse('tu1', 'Bash', { command: 'git log --oneline | head; git rev-list --left-right --count main...HEAD' });
    toolResult('tu1', 'This Bash command contains multiple operations. The following part requires approval: head; git rev-list --left-right --count main...HEAD', true);
    assistantText('No pude ejecutar ese comando; lo he resuelto leyendo los ficheros.');
    result({
      result: 'No pude ejecutar ese comando; lo he resuelto leyendo los ficheros.',
      permission_denials: [{ tool_name: 'Bash', tool_use_id: 'tu1', tool_input: {} }],
    });
    process.exitCode = 0;
    break;
  }
  case 'denied_powershell': {
    // Claude Code 2.1.307 en Windows: elige la herramienta PowerShell; denegación con tool_input vacío y el comando
    // en el texto del error ("requires approval: node --version"); result = success.
    init();
    toolUse('ps1', 'PowerShell', { command: 'node --version' });
    out({ type: 'system', subtype: 'permission_denied', tool_name: 'PowerShell', tool_use_id: 'ps1', tool_input: {} });
    toolResult('ps1', 'This PowerShell command contains multiple operations. The following part requires approval: node --version', true);
    assistantText('No tengo permiso para ejecutar node --version.');
    result({ result: 'No tengo permiso para ejecutar node --version.', permission_denials: [{ tool_name: 'PowerShell', tool_use_id: 'ps1', tool_input: {} }] });
    process.exitCode = 0;
    break;
  }
  case 'denied_fail': {
    // Denegación y result que NO es éxito → needs_permission.
    init();
    const input = { command: 'npm run lint -- --fix' };
    toolUse('tu1', 'Bash', input);
    toolResult('tu1', 'Claude requested permissions to use Bash, but you have not granted it yet.', true);
    result({ subtype: 'error_during_execution', is_error: true, result: 'No pude terminar sin permiso.', permission_denials: [{ tool_name: 'Bash', tool_use_id: 'tu1', tool_input: input }] });
    process.exitCode = 1;
    break;
  }
  case 'long': {
    // Resumen final largo (~2500 caracteres) que el result repite tal cual, como el CLI real.
    init();
    const summary = `## Resumen\n${'Línea de resumen con detalle. '.repeat(80)}\n**Git**\n- Estado limpio y rama main al día.`;
    assistantText(summary);
    result({ result: summary });
    process.exitCode = 0;
    break;
  }
  case 'error':
    init();
    result({ subtype: 'error_during_execution', is_error: true, result: 'Algo falló' });
    process.exitCode = 1;
    break;
  case 'crash':
    process.stderr.write('Error: fallo simulado\n');
    process.exitCode = 2;
    break;
  case 'hang': {
    init();
    // Nieto que sigue vivo hasta que alguien mate el árbol de procesos (mismo grupo de procesos que este).
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    log({ grandchildPid: grandchild.pid });
    let n = 0;
    setInterval(() => {
      n += 1;
      assistantText(`tick ${n}`);
    }, 100);
    break;
  }
  case 'big':
    init();
    for (let i = 0; i < 200; i++) assistantText(`${String(i).padStart(4, '0')}${'x'.repeat(996)}`);
    result();
    process.exitCode = 0;
    break;
  case 'flood': {
    // Feature 14 (design.md §8.1): solo eventos que en la fase 4 no contaban para el límite de salida.
    for (let i = 0; i < 60; i++) {
      out({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: `flood-${i}`, tool_input: { command: `comando-${i} x` } });
    }
    const model = 'm'.repeat(1024);
    for (let i = 0; i < 2000; i++) out({ type: 'system', subtype: 'init', session_id: SESSION_ID, model });
    for (let i = 0; i < 2000; i++) out({ type: 'system', subtype: 'api_retry', attempt: i + 1 });
    result();
    process.exitCode = 0;
    break;
  }
  case 'garbage':
    out('Invalid API key');
    out('{ roto');
    out({ type: 'otro' });
    out({ type: 'stream_event', event: { type: 'content_block_delta' } });
    init();
    okTail();
    process.exitCode = 0;
    break;
  default:
    process.stderr.write(`Escenario desconocido: ${scenario}\n`);
    process.exitCode = 3;
}
