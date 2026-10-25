// Tests de lib/config.js y scripts/reset-password.js — F2-R30, F2-R31, F2-R32
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { readConfig, buildStartupLines } from '../lib/config.js';
import { PANEL_DIR, makeTempDir, removeDir } from './helpers.js';

const execFileAsync = promisify(execFile);
const RESET_SCRIPT = path.join(PANEL_DIR, 'scripts', 'reset-password.js');
const PANEL_FAKE = path.resolve('/srv/panel-fake');

test('[F2-R31] readConfig con env vacío devuelve los valores por defecto', () => {
  const config = readConfig({}, { panelDir: PANEL_FAKE });
  assert.deepEqual(config, {
    port: 4310,
    dataDir: path.join(PANEL_FAKE, 'data'),
    secureCookies: false,
    trustProxy: true,
  });
});

test('[F2-R31] readConfig con las cuatro variables definidas (ruta absoluta y relativa, "1", "0")', () => {
  const abs = path.resolve('/var/muver-datos');
  const a = readConfig({ PORT: '8080', PANEL_DATA_DIR: abs, PANEL_SECURE_COOKIES: '1', PANEL_TRUST_PROXY: '0' }, { panelDir: PANEL_FAKE });
  assert.deepEqual(a, { port: 8080, dataDir: abs, secureCookies: true, trustProxy: false });

  const b = readConfig({ PORT: '0', PANEL_DATA_DIR: 'privado/datos', PANEL_SECURE_COOKIES: 'true', PANEL_TRUST_PROXY: 'false' }, { panelDir: PANEL_FAKE });
  assert.deepEqual(b, { port: 0, dataDir: path.resolve(PANEL_FAKE, 'privado/datos'), secureCookies: true, trustProxy: false });

  const c = readConfig({ PANEL_SECURE_COOKIES: 'no', PANEL_TRUST_PROXY: 'yes' }, { panelDir: PANEL_FAKE });
  assert.equal(c.secureCookies, false);
  assert.equal(c.trustProxy, true);
});

test('[F2-R31] readConfig con PORT inválido (abc, 70000, -1) vuelve a 4310', () => {
  for (const PORT of ['abc', '70000', '-1', '']) {
    assert.equal(readConfig({ PORT }, { panelDir: PANEL_FAKE }).port, 4310, `PORT=${PORT}`);
  }
});

test('[F2-R32] buildStartupLines con contraseña configurada y URL pública', () => {
  const lines = buildStartupLines({
    urls: ['http://localhost:4310', 'http://192.168.1.10:4310'],
    dataDir: 'C:\\panel\\data',
    configured: true,
    publicUrl: 'https://abc.trycloudflare.com',
  });
  assert.deepEqual(lines, [
    'Puesto de Mando MUVER escuchando en:',
    '  http://localhost:4310',
    '  http://192.168.1.10:4310',
    'Directorio de datos: C:\\panel\\data',
    'Contraseña: configurada',
    'URL pública: https://abc.trycloudflare.com',
    'Pulsa Ctrl+C para parar.',
  ]);
});

test('[F2-R32] buildStartupLines sin contraseña y sin URL pública', () => {
  const lines = buildStartupLines({ urls: ['http://localhost:4310'], dataDir: '/tmp/d', configured: false, publicUrl: null });
  assert.ok(lines.includes('Contraseña: no configurada (abre el panel para crearla)'));
  assert.ok(lines.includes('Directorio de datos: /tmp/d'));
  assert.ok(!lines.some((l) => l.startsWith('URL pública:')));
  assert.equal(lines.at(-1), 'Pulsa Ctrl+C para parar.');
});

async function runReset(dataDir) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [RESET_SCRIPT], {
    cwd: PANEL_DIR,
    env: { ...process.env, PANEL_DATA_DIR: dataDir },
    timeout: 20000,
    windowsHide: true,
  });
  return { stdout, stderr, code: 0 };
}

test('[F2-R30] reset-password.js borra auth.json y sessions.json y lo anuncia (código 0)', async () => {
  const dataDir = await makeTempDir('muver-reset-');
  await fs.writeFile(path.join(dataDir, 'auth.json'), '{}');
  await fs.writeFile(path.join(dataDir, 'sessions.json'), '{}');
  await fs.writeFile(path.join(dataDir, 'public-url.txt'), 'https://x.trycloudflare.com');
  const { stdout, code } = await runReset(dataDir);
  assert.equal(code, 0);
  assert.ok(stdout.includes('Contraseña y sesiones eliminadas. Reinicia el panel y abre su URL para crear una contraseña nueva.'), stdout);
  await assert.rejects(fs.access(path.join(dataDir, 'auth.json')));
  await assert.rejects(fs.access(path.join(dataDir, 'sessions.json')));
  await fs.access(path.join(dataDir, 'public-url.txt')); // no borra otros ficheros
  await removeDir(dataDir);
});

test('[F2-R30] reset-password.js sin ficheros imprime "No había contraseña configurada." (código 0)', async () => {
  const dataDir = await makeTempDir('muver-reset-');
  const { stdout, code } = await runReset(dataDir);
  assert.equal(code, 0);
  assert.ok(stdout.includes('No había contraseña configurada.'), stdout);
  await removeDir(dataDir);
});

test('[F2-R30] package.json declara el script reset-password', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(PANEL_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['reset-password'], 'node scripts/reset-password.js');
});
