// Arranque del Puesto de Mando MUVER: escucha en 0.0.0.0:PORT (defecto 4310) e imprime las URLs de acceso,
// el directorio de datos, si hay contraseña configurada y la URL pública del túnel si existe.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './lib/app.js';
import { buildAccessUrls } from './lib/network.js';
import { readConfig, buildStartupLines } from './lib/config.js';
import { loadAuth } from './lib/auth.js';
import { readPublicUrl } from './lib/public-url.js';

const PANEL_DIR = path.dirname(fileURLToPath(import.meta.url));
const config = readConfig(process.env, { panelDir: PANEL_DIR });

const server = createApp({
  projectsFile: path.join(PANEL_DIR, 'projects.json'),
  publicDir: path.join(PANEL_DIR, 'public'),
  dataDir: config.dataDir,
  trustProxy: config.trustProxy,
  secureCookies: config.secureCookies,
});

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
  const lines = buildStartupLines({
    urls: buildAccessUrls(realPort),
    dataDir: config.dataDir,
    configured: auth.state === 'ok',
    publicUrl,
  });
  if (auth.state === 'corrupt') lines.push('AVISO: auth.json ilegible; ejecuta npm run reset-password');
  console.log(lines.join('\n'));
});
