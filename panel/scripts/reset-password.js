// Rescate: borra la contraseña y las sesiones del directorio de datos (npm run reset-password).
// Respeta PANEL_DATA_DIR. Después hay que reiniciar el panel y abrir su URL para crear una contraseña nueva.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../lib/config.js';

const PANEL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { dataDir } = readConfig(process.env, { panelDir: PANEL_DIR });
  const files = [path.join(dataDir, 'auth.json'), path.join(dataDir, 'sessions.json')];
  let existed = false;
  for (const file of files) {
    if (await exists(file)) existed = true;
    await fs.rm(file, { force: true });
  }
  if (existed) {
    console.log('Contraseña y sesiones eliminadas. Reinicia el panel y abre su URL para crear una contraseña nueva.');
  } else {
    console.log('No había contraseña configurada.');
  }
}

main().catch((err) => {
  console.error('No se pudo restablecer la contraseña:', err && err.message ? err.message : err);
  process.exit(1);
});
