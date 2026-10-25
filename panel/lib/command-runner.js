// Ejecución en serie de los pasos de un run "command" (design.md §5.6): tests o los pasos de "Commit y push".
// Cada paso { file, prefixArgs, args, display, env? } se lanza sin shell; su salida, sin ANSI, se emite como eventos
// `output`. La serie se detiene en el primer paso que termina con código distinto de 0.
import { createLineSplitter, stripAnsi } from './exec-utils.js';

export const OUTPUT_MAX_CHARS = 2000;

function clip(text) {
  return text.length > OUTPUT_MAX_CHARS ? text.slice(0, OUTPUT_MAX_CHARS) : text;
}

/** Espera al final de un proceso: { code, signal, error }. Tras `exit` da 1 s a que se cierren sus tuberías. */
export function waitForChild(child, { closeGraceMs = 1000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let exitInfo = null;
    let graceTimer = null;
    const finish = (info) => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      resolve(info);
    };
    child.on('error', (error) => {
      if (exitInfo) return;
      finish({ code: null, signal: null, error });
    });
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal, error: null };
      graceTimer = setTimeout(() => finish(exitInfo), closeGraceMs);
      if (typeof graceTimer.unref === 'function') graceTimer.unref();
    });
    child.once('close', (code, signal) => finish(exitInfo || { code, signal, error: null }));
  });
}

/** Evento `output` de una línea de salida (sin ANSI, ≤ 2000 caracteres). */
export function outputEvent(stream, line) {
  return { type: 'output', stream, text: clip(stripAnsi(line)) };
}

/**
 * Conecta stdout/stderr del proceso a eventos `output` y avisos de línea descartada. `onLine(stream, line)` sustituye
 * al comportamiento por defecto (lo usa el run de Claude para su stdout en stream-json).
 */
export function pipeOutput(child, { emit, onDiscard, maxLineBytes, onLine }) {
  const splitters = [];
  for (const stream of ['stdout', 'stderr']) {
    const source = child[stream];
    if (!source) continue;
    const splitter = createLineSplitter({
      maxLineBytes,
      onLine: (line) => (onLine ? onLine(stream, line) : emit(outputEvent(stream, line))),
      onDiscard,
    });
    source.on('data', (chunk) => splitter.push(chunk));
    source.on('end', () => splitter.end());
    splitters.push(splitter);
  }
  return splitters;
}

/**
 * Ejecuta los pasos en serie. `spawnStep(step)` lanza el proceso (puede lanzar una excepción); `isStopped()` corta la
 * serie (cancelación o límite de tiempo). Devuelve { exitCode, error } (error = texto del fallo al lanzar).
 */
export async function runSteps(steps, { emit, spawnStep, isStopped = () => false, onDiscard = () => {}, maxLineBytes } = {}) {
  let exitCode = null;
  for (let i = 0; i < steps.length; i++) {
    if (isStopped()) break;
    const step = steps[i];
    emit({ type: 'step', index: i + 1, total: steps.length, command: step.display });
    let child;
    try {
      child = spawnStep(step);
    } catch (err) {
      return { exitCode: null, error: `No se pudo ejecutar el comando: ${err && (err.code || err.message)}` };
    }
    const done = waitForChild(child);
    pipeOutput(child, { emit, onDiscard, maxLineBytes });
    const result = await done;
    if (result.error) return { exitCode: null, error: `No se pudo ejecutar el comando: ${result.error.code || result.error.message}` };
    exitCode = result.code;
    if (exitCode !== 0) break;
  }
  return { exitCode, error: null };
}
