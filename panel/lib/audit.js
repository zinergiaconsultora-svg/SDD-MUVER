// Registro de auditoría de las acciones de ejecución (design.md §3.5 y §5.11): <datos>/audit.log, una línea JSON por
// entrada, escritura serializada y rotación simple (> 5 MB → audit.log.1, sustituyendo la copia anterior).
// Nunca contiene contraseñas, cookies, tokens ni más de 120 caracteres del prompt; nunca lanza.
import fs from 'node:fs/promises';
import path from 'node:path';

export const AUDIT_MAX_BYTES = 5 * 1024 * 1024;
export const PROMPT_PREVIEW_CHARS = 120;

/** Primeros 120 puntos de código de un texto (prompt o mensaje de commit). */
export function clipPrompt(text) {
  return [...String(text ?? '')].slice(0, PROMPT_PREVIEW_CHARS).join('');
}

export function createAuditLog({ file, now = Date.now, maxBytes = AUDIT_MAX_BYTES } = {}) {
  if (!file) throw new Error('createAuditLog: falta file');
  let queue = Promise.resolve();

  async function append(line) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    let size = 0;
    try {
      size = (await fs.stat(file)).size;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (size > 0 && size + Buffer.byteLength(line) > maxBytes) await fs.rename(file, `${file}.1`);
    await fs.appendFile(file, line, 'utf8');
  }

  return {
    write(entry) {
      const line = JSON.stringify({ at: new Date(now()).toISOString(), ...entry }) + '\n';
      queue = queue.then(() => append(line)).catch((err) => {
        console.error('[panel] No se pudo escribir en audit.log:', err && err.code ? err.code : 'error');
      });
      return queue;
    },
  };
}
