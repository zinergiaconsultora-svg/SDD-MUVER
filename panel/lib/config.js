// Configuración del panel a partir de variables de entorno y líneas de arranque (fase 2).
import path from 'node:path';

export const DEFAULT_PORT = 4310;
export const DEFAULT_DATA_DIR_NAME = 'data';

function parsePort(value) {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : DEFAULT_PORT;
}

/**
 * Lee la configuración (R31):
 * - port: PORT entero 0–65535, si no 4310.
 * - dataDir: PANEL_DATA_DIR resuelto respecto a panelDir; por defecto <panelDir>/data.
 * - secureCookies: true solo si PANEL_SECURE_COOKIES es "1" o "true".
 * - trustProxy: false solo si PANEL_TRUST_PROXY es "0" o "false".
 */
export function readConfig(env = process.env, { panelDir } = {}) {
  if (!panelDir) throw new Error('readConfig: falta panelDir');
  const dataDirValue = typeof env.PANEL_DATA_DIR === 'string' && env.PANEL_DATA_DIR.trim() ? env.PANEL_DATA_DIR.trim() : DEFAULT_DATA_DIR_NAME;
  return {
    port: parsePort(env.PORT),
    dataDir: path.resolve(panelDir, dataDirValue),
    secureCookies: ['1', 'true'].includes(String(env.PANEL_SECURE_COOKIES).toLowerCase()),
    trustProxy: !['0', 'false'].includes(String(env.PANEL_TRUST_PROXY).toLowerCase()),
  };
}

/** Líneas que imprime server.js al arrancar (R32). */
export function buildStartupLines({ urls = [], dataDir, configured, publicUrl }) {
  return [
    'Puesto de Mando MUVER escuchando en:',
    ...urls.map((u) => `  ${u}`),
    `Directorio de datos: ${dataDir}`,
    configured ? 'Contraseña: configurada' : 'Contraseña: no configurada (abre el panel para crearla)',
    ...(publicUrl ? [`URL pública: ${publicUrl}`] : []),
    'Pulsa Ctrl+C para parar.',
  ];
}
