// Arranque del Puesto de Mando MUVER: escucha en 0.0.0.0:PORT (defecto 4310) e imprime las URLs de acceso,
// el directorio de datos, si hay contraseña configurada, si se detecta Claude Code, si la ejecución desde el panel
// está activada (fase 4), el estado de Cloudflare Access y la URL pública del túnel.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './lib/app.js';
import { buildAccessUrls } from './lib/network.js';
import { readConfig, buildStartupLines } from './lib/config.js';
import { loadAuth } from './lib/auth.js';
import { readPublicUrl } from './lib/public-url.js';
import { createClaudeDiscovery } from './lib/claude-discovery.js';
import { prepareProjectsFile } from './lib/registry.js';

const PANEL_DIR = path.dirname(fileURLToPath(import.meta.url));
const config = readConfig(process.env, { panelDir: PANEL_DIR });

// Corrección T36: el registro vivo está en el directorio de datos (no versionado). panel/projects.json queda como
// semilla heredada (se copia una vez y la app ya no escribe en él); si no existe, se usa projects.example.json.
const projectsFile = path.join(config.dataDir, 'projects.json');
await prepareProjectsFile({
  dataFile: projectsFile,
  legacyFile: path.join(PANEL_DIR, 'projects.json'),
  exampleFile: path.join(PANEL_DIR, 'projects.example.json'),
});

const server = createApp({
  projectsFile,
  publicDir: path.join(PANEL_DIR, 'public'),
  dataDir: config.dataDir,
  trustProxy: config.trustProxy,
  secureCookies: config.secureCookies,
  claudeHome: config.claudeHome,
  allowExec: config.allowExec,
  maxRuns: config.maxRuns,
  runTimeoutMs: config.runTimeoutMs,
  // Feature 14 (D5): Claude se resuelve en cada lanzamiento (cwd del run y catálogo vigente), no una vez al arrancar.
  claudeBin: config.claudeBin,
  panelDir: PANEL_DIR,
  env: process.env,
  bashBin: config.bashBin,
  cfAccess: config.cfAccess,
});

/** Ctrl+C o parada de la tarea: cierra el servidor (cancela los runs activos y mata sus árboles de procesos). */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Recibido ${signal}: cerrando el panel y cancelando las ejecuciones en marcha…`);
  server.close(() => process.exit(0));
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/** Estado de Claude Code para la línea de arranque (escaneo propio de solo lectura; nunca impide arrancar). */
async function claudeStartupStatus() {
  try {
    const discovery = createClaudeDiscovery({ claudeHome: config.claudeHome });
    await discovery.scan();
    return discovery.status();
  } catch (err) {
    console.error('[panel] No se pudo escanear Claude Code al arrancar:', err && err.message ? err.message : err);
    return { available: false, claudeHome: config.claudeHome, projectCount: 0, sessionCount: 0 };
  }
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`El puerto ${config.port} ya está en uso. Arranca con otro puerto, por ejemplo: PORT=4311 npm start`);
  } else {
    console.error('No se pudo arrancar el servidor:', err && err.message ? err.message : err);
  }
  process.exit(1);
});

server.listen(config.port, '0.0.0.0', async () => {
  const realPort = server.address().port;
  const auth = await loadAuth(path.join(config.dataDir, 'auth.json'));
  const publicUrl = await readPublicUrl(path.join(config.dataDir, 'public-url.txt'));
  const claude = await claudeStartupStatus();
  const lines = buildStartupLines({
    urls: buildAccessUrls(realPort),
    dataDir: config.dataDir,
    configured: auth.state === 'ok',
    publicUrl,
    claude,
    work: { allowExec: config.allowExec, maxRuns: config.maxRuns, runTimeoutMin: config.runTimeoutMs / 60000, cfAccess: config.cfAccess },
  });
  if (auth.state === 'corrupt') lines.push('AVISO: auth.json ilegible; ejecuta npm run reset-password');
  console.log(lines.join('\n'));
});
