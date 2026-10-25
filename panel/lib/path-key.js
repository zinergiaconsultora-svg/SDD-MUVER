// Claves de ruta (design.md §5.1): comparación de rutas Windows y POSIX sin depender de process.platform.
// Puro: sin fs y sin path.resolve (en Linux estropearía las rutas C:\...).
import path from 'node:path';

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

/** true si la cadena tiene forma de ruta Windows absoluta (X:\ o X:/) o UNC (\\servidor\...). */
export function isWindowsPath(p) {
  return typeof p === 'string' && (WINDOWS_DRIVE.test(p) || p.startsWith('\\\\'));
}

/**
 * Clave normalizada para comparar rutas; null si no es una cadena no vacía.
 * Windows: separador \, sin \ final (salvo la raíz X:\), en minúsculas. POSIX: normalizada, sin / final (salvo /).
 */
export function pathKey(p) {
  if (typeof p !== 'string' || p === '') return null;
  if (isWindowsPath(p)) {
    let key = path.win32.normalize(p.replace(/\//g, '\\'));
    while (key.length > 3 && key.endsWith('\\') && !/^[A-Za-z]:\\$/.test(key)) key = key.slice(0, -1);
    return key.toLowerCase();
  }
  let key = path.posix.normalize(p.replace(/\\/g, '/'));
  while (key.length > 1 && key.endsWith('/')) key = key.slice(0, -1);
  return key;
}

/** Último segmento no vacío tras dividir por / o \; si no hay ninguno, la propia cadena. */
export function lastSegment(p) {
  const value = String(p ?? '');
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : value;
}

/** Nombre de carpeta que usa Claude Code para una ruta: /, \ y : → - (regla documentada). */
export function encodeProjectPath(p) {
  return String(p).replace(/[\\/:]/g, '-');
}

/** Comparación laxa de nombres codificados (tolera versiones que codifiquen . u otros caracteres). */
export function looseEncodedKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '-');
}
