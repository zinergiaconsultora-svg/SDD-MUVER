// Configuración del panel a partir de variables de entorno y líneas de arranque (fases 2 y 3).
import os from 'node:os';
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
 * - claudeHome (fase 3, F3-R1): CLAUDE_HOME_DIR recortado si no está vacío (tal cual, sin resolver); si no, os.homedir().
 */
export function readConfig(env = process.env, { panelDir } = {}) {
  if (!panelDir) throw new Error('readConfig: falta panelDir');
  const dataDirValue = typeof env.PANEL_DATA_DIR === 'string' && env.PANEL_DATA_DIR.trim() ? env.PANEL_DATA_DIR.trim() : DEFAULT_DATA_DIR_NAME;
  return {
    port: parsePort(env.PORT),
    dataDir: path.resolve(panelDir, dataDirValue),
    secureCookies: ['1', 'true'].includes(String(env.PANEL_SECURE_COOKIES).toLowerCase()),
    trustProxy: !['0', 'false'].includes(String(env.PANEL_TRUST_PROXY).toLowerCase()),
    claudeHome: typeof env.CLAUDE_HOME_DIR === 'string' && env.CLAUDE_HOME_DIR.trim() ? env.CLAUDE_HOME_DIR.trim() : os.homedir(),
  };
}

/** Línea de estado de Claude Code (F3-R52). */
function claudeLine(claude) {
  return claude.available
    ? `Claude Code: detectado en ${claude.claudeHome} (${claude.projectCount} proyectos, ${claude.sessionCount} sesiones)`
    : `Claude Code: no detectado en ${claude.claudeHome} (solo proyectos de projects.json)`;
}

/** Líneas que imprime server.js al arrancar (F2-R32; F3-R52 añade la de Claude Code si se pasa `claude`). */
export function buildStartupLines({ urls = [], dataDir, configured, publicUrl, claude }) {
  return [
    'Puesto de Mando MUVER escuchando en:',
    ...urls.map((u) => `  ${u}`),
    `Directorio de datos: ${dataDir}`,
    configured ? 'Contraseña: configurada' : 'Contraseña: no configurada (abre el panel para crearla)',
    ...(claude ? [claudeLine(claude)] : []),
    ...(publicUrl ? [`URL pública: ${publicUrl}`] : []),
    'Pulsa Ctrl+C para parar.',
  ];
}
