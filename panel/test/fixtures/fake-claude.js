#!/usr/bin/env node
// CLI de Claude Code FALSO para los tests (design.md §8.1). Nunca se usa el `claude` real en los tests.
// - Registra en FAKE_CLAUDE_LOG (si existe) una línea { argv, cwd, pid }.
// - El prompt es el último argumento; el escenario es la primera marca [[nombre]] que contenga (por defecto "ok").
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

log({ argv, cwd: process.cwd(), pid: process.pid });

const prompt = argv.length ? argv[argv.length - 1] : '';
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
