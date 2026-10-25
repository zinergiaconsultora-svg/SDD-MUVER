// URL pública del panel (public-url.txt escrito por el lanzador del túnel).
import fs from 'node:fs/promises';

/** Devuelve la URL si el texto recortado empieza por https:// y no contiene espacios; si no, null. */
export function parsePublicUrl(text) {
  if (typeof text !== 'string') return null;
  const value = text.replace(/^﻿/, '').trim();
  if (!value.startsWith('https://') || /\s/.test(value)) return null;
  return value;
}

/** Lee el fichero y lo parsea; si no existe o no se puede leer → null. */
export async function readPublicUrl(file) {
  try {
    return parsePublicUrl(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
