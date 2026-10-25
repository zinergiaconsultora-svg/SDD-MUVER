// Arranque del Puesto de Mando MUVER: escucha en 0.0.0.0:PORT (defecto 4310) e imprime las URLs de acceso.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './lib/app.js';
import { buildAccessUrls } from './lib/network.js';

const PANEL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4310;

const envPort = Number.parseInt(process.env.PORT ?? '', 10);
const port = Number.isInteger(envPort) && envPort >= 0 && envPort <= 65535 ? envPort : DEFAULT_PORT;

const server = createApp({
  projectsFile: path.join(PANEL_DIR, 'projects.json'),
  publicDir: path.join(PANEL_DIR, 'public'),
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`El puerto ${port} ya está en uso. Arranca con otro puerto, por ejemplo: PORT=4311 npm start`);
  } else {
    console.error('No se pudo arrancar el servidor:', err && err.message ? err.message : err);
  }
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  const realPort = server.address().port;
  console.log('Puesto de Mando MUVER escuchando en:');
  for (const url of buildAccessUrls(realPort)) console.log(`  ${url}`);
  console.log('Pulsa Ctrl+C para parar.');
});
