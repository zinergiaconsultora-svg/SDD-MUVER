// Configuración del panel a partir de variables de entorno y líneas de arranque (fases 2, 3 y 4).
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 4310;
export const DEFAULT_DATA_DIR_NAME = 'data';
export const DEFAULT_MAX_RUNS = 2;
export const DEFAULT_RUN_TIMEOUT_MIN = 30;
export const CF_TEAM_RE = /^[a-z0-9-]{1,63}$/;

function parsePort(value) {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : DEFAULT_PORT;
}

/** Entero estricto (solo dígitos) dentro de [min, max]; si no, `fallback`. */
function parseIntInRange(value, min, max, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(text)) return fallback;
  const n = Number(text);
  return n >= min && n <= max ? n : fallback;
}

function trimmedOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Cloudflare Access (F4-R2): null sin variables; { team, aud } válidas; { error } en otro caso. */
export function readCfAccess(env) {
  const team = trimmedOrNull(env.PANEL_CF_ACCESS_TEAM);
  const aud = trimmedOrNull(env.PANEL_CF_ACCESS_AUD);
  if (!team && !aud) return null;
  if (!team || !aud) return { error: 'Faltan PANEL_CF_ACCESS_TEAM o PANEL_CF_ACCESS_AUD' };
  const normalized = team.toLowerCase();
  if (!CF_TEAM_RE.test(normalized)) return { error: 'PANEL_CF_ACCESS_TEAM no válido' };
  return { team: normalized, aud };
}

/**
 * Lee la configuración (R31):
 * - port: PORT entero 0–65535, si no 4310.
 * - dataDir: PANEL_DATA_DIR resuelto respecto a panelDir; por defecto <panelDir>/data.
 * - secureCookies: true solo si PANEL_SECURE_COOKIES es "1" o "true".
 * - trustProxy: false solo si PANEL_TRUST_PROXY es "0" o "false".
 * - claudeHome (fase 3, F3-R1): CLAUDE_HOME_DIR recortado si no está vacío (tal cual, sin resolver); si no, os.homedir().
 * - Fase 4 (F4-R1): allowExec, maxRuns, runTimeoutMs, claudeBin, bashBin y cfAccess (design.md §5.1).
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
    allowExec: !['0', 'false'].includes(String(env.PANEL_ALLOW_EXEC).toLowerCase()),
    maxRuns: parseIntInRange(env.PANEL_MAX_RUNS, 1, 10, DEFAULT_MAX_RUNS),
    runTimeoutMs: parseIntInRange(env.PANEL_RUN_TIMEOUT_MIN, 1, 240, DEFAULT_RUN_TIMEOUT_MIN) * 60000,
    claudeBin: trimmedOrNull(env.CLAUDE_BIN) ?? 'claude',
    bashBin: trimmedOrNull(env.PANEL_BASH_BIN),
    cfAccess: readCfAccess(env),
  };
}

/** Línea de estado de Claude Code (F3-R52). */
function claudeLine(claude) {
  return claude.available
    ? `Claude Code: detectado en ${claude.claudeHome} (${claude.projectCount} proyectos, ${claude.sessionCount} sesiones)`
    : `Claude Code: no detectado en ${claude.claudeHome} (solo proyectos de projects.json)`;
}

/** Líneas de ejecución desde el panel y de Cloudflare Access (F4-R3). */
function workLines(work) {
  const exec = work.allowExec
    ? `Ejecución desde el panel: activada (máx. ${work.maxRuns} a la vez, límite ${work.runTimeoutMin} min)`
    : 'Ejecución desde el panel: desactivada (PANEL_ALLOW_EXEC=0)';
  let access;
  if (!work.cfAccess) access = 'Cloudflare Access: no configurado (las acciones por el túnel piden la contraseña cada 15 min)';
  else if (work.cfAccess.error) access = `AVISO: Cloudflare Access mal configurado (${work.cfAccess.error}): se rechaza todo acceso por el túnel`;
  else access = `Cloudflare Access: activado (equipo ${work.cfAccess.team})`;
  return [exec, access];
}

/**
 * Líneas que imprime server.js al arrancar (F2-R32; F3-R52 añade la de Claude Code si se pasa `claude`;
 * F4-R3 añade las de ejecución y Cloudflare Access si se pasa `work`).
 */
export function buildStartupLines({ urls = [], dataDir, configured, publicUrl, claude, work }) {
  return [
    'Puesto de Mando MUVER escuchando en:',
    ...urls.map((u) => `  ${u}`),
    `Directorio de datos: ${dataDir}`,
    configured ? 'Contraseña: configurada' : 'Contraseña: no configurada (abre el panel para crearla)',
    ...(claude ? [claudeLine(claude)] : []),
    ...(work ? workLines(work) : []),
    ...(publicUrl ? [`URL pública: ${publicUrl}`] : []),
    'Pulsa Ctrl+C para parar.',
  ];
}
