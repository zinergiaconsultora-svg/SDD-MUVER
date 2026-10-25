// Tests de lib/config.js y scripts/reset-password.js — F2-R30, F2-R31, F2-R32
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { readConfig, buildStartupLines } from '../lib/config.js';
import { PANEL_DIR, makeTempDir, removeDir } from './helpers.js';

const execFileAsync = promisify(execFile);
const RESET_SCRIPT = path.join(PANEL_DIR, 'scripts', 'reset-password.js');
const PANEL_FAKE = path.resolve('/srv/panel-fake');
// Fase 4 (F4-R1): campos nuevos de readConfig con sus valores por defecto (los tests de la fase 2 los incluyen).
const WORK_DEFAULTS = { allowExec: true, maxRuns: 2, runTimeoutMs: 30 * 60000, claudeBin: 'claude', bashBin: null, cfAccess: null };

test('[F2-R31] readConfig con env vacío devuelve los valores por defecto', () => {
  const config = readConfig({}, { panelDir: PANEL_FAKE });
  assert.deepEqual(config, {
    port: 4310,
    dataDir: path.join(PANEL_FAKE, 'data'),
    secureCookies: false,
    trustProxy: true,
    claudeHome: os.homedir(), // fase 3 (F3-R1)
    ...WORK_DEFAULTS, // fase 4 (F4-R1)
  });
});

test('[F2-R31] readConfig con las cuatro variables definidas (ruta absoluta y relativa, "1", "0")', () => {
  const abs = path.resolve('/var/muver-datos');
  const a = readConfig({ PORT: '8080', PANEL_DATA_DIR: abs, PANEL_SECURE_COOKIES: '1', PANEL_TRUST_PROXY: '0' }, { panelDir: PANEL_FAKE });
  assert.deepEqual(a, { port: 8080, dataDir: abs, secureCookies: true, trustProxy: false, claudeHome: os.homedir(), ...WORK_DEFAULTS });

  const b = readConfig({ PORT: '0', PANEL_DATA_DIR: 'privado/datos', PANEL_SECURE_COOKIES: 'true', PANEL_TRUST_PROXY: 'false' }, { panelDir: PANEL_FAKE });
  assert.deepEqual(b, { port: 0, dataDir: path.resolve(PANEL_FAKE, 'privado/datos'), secureCookies: true, trustProxy: false, claudeHome: os.homedir(), ...WORK_DEFAULTS });

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

// ---------- Fase 3: directorio de Claude y línea de arranque (F3-R1, F3-R52) ----------

test('[F3-R1] readConfig → claudeHome: os.homedir() por defecto, CLAUDE_HOME_DIR recortado y valor en blanco', () => {
  assert.equal(readConfig({}, { panelDir: PANEL_FAKE }).claudeHome, os.homedir());
  const abs = path.resolve('/srv/claude-home');
  assert.equal(readConfig({ CLAUDE_HOME_DIR: abs }, { panelDir: PANEL_FAKE }).claudeHome, abs);
  assert.equal(readConfig({ CLAUDE_HOME_DIR: `  ${abs}  ` }, { panelDir: PANEL_FAKE }).claudeHome, abs);
  assert.equal(readConfig({ CLAUDE_HOME_DIR: 'C:\\Users\\Usuario' }, { panelDir: PANEL_FAKE }).claudeHome, 'C:\\Users\\Usuario');
  assert.equal(readConfig({ CLAUDE_HOME_DIR: '   ' }, { panelDir: PANEL_FAKE }).claudeHome, os.homedir());
});

test('[F3-R52] buildStartupLines con Claude disponible, no disponible y ausente', () => {
  const common = { urls: ['http://localhost:4310'], dataDir: '/tmp/d', configured: true, publicUrl: null };
  const yes = buildStartupLines({ ...common, claude: { available: true, claudeHome: 'C:\\Users\\Usuario', projectCount: 3, sessionCount: 7 } });
  assert.ok(yes.includes('Claude Code: detectado en C:\\Users\\Usuario (3 proyectos, 7 sesiones)'), yes.join('\n'));
  const no = buildStartupLines({ ...common, claude: { available: false, claudeHome: '/home/u', projectCount: 0, sessionCount: 0 } });
  assert.ok(no.includes('Claude Code: no detectado en /home/u (solo proyectos de projects.json)'), no.join('\n'));
  for (const lines of [yes, no]) {
    assert.ok(lines.includes('Contraseña: configurada'));
    assert.ok(lines.includes('Directorio de datos: /tmp/d'));
    assert.equal(lines[0], 'Puesto de Mando MUVER escuchando en:');
    assert.equal(lines.at(-1), 'Pulsa Ctrl+C para parar.');
    assert.equal(lines.indexOf('Contraseña: configurada') + 1, lines.findIndex((l) => l.startsWith('Claude Code:')), 'tras la línea de contraseña');
  }
  const absent = buildStartupLines(common);
  assert.ok(!absent.some((l) => l.startsWith('Claude Code:')));
});

// ---------- Fase 4: ejecución desde el panel y Cloudflare Access (F4-R1, F4-R2, F4-R3) ----------

test('[F4-R1] readConfig: valores por defecto de la fase 4 con env vacío', () => {
  const c = readConfig({}, { panelDir: PANEL_FAKE });
  assert.equal(c.allowExec, true);
  assert.equal(c.maxRuns, 2);
  assert.equal(c.runTimeoutMs, 30 * 60000);
  assert.equal(c.claudeBin, 'claude');
  assert.equal(c.bashBin, null);
  assert.equal(c.cfAccess, null);
});

test('[F4-R1] readConfig: cada variable nueva válida', () => {
  const c = readConfig({
    PANEL_ALLOW_EXEC: '1',
    PANEL_MAX_RUNS: '5',
    PANEL_RUN_TIMEOUT_MIN: '90',
    CLAUDE_BIN: '  C:\\Users\\Usuario\\.local\\bin\\claude.exe  ',
    PANEL_BASH_BIN: '  /usr/bin/bash ',
  }, { panelDir: PANEL_FAKE });
  assert.equal(c.allowExec, true);
  assert.equal(c.maxRuns, 5);
  assert.equal(c.runTimeoutMs, 90 * 60000);
  assert.equal(c.claudeBin, 'C:\\Users\\Usuario\\.local\\bin\\claude.exe');
  assert.equal(c.bashBin, '/usr/bin/bash');
  assert.equal(readConfig({ PANEL_MAX_RUNS: '1', PANEL_RUN_TIMEOUT_MIN: '240' }, { panelDir: PANEL_FAKE }).maxRuns, 1);
  assert.equal(readConfig({ PANEL_MAX_RUNS: '10', PANEL_RUN_TIMEOUT_MIN: '1' }, { panelDir: PANEL_FAKE }).runTimeoutMs, 60000);
  assert.equal(readConfig({ PANEL_MAX_RUNS: '10' }, { panelDir: PANEL_FAKE }).maxRuns, 10);
  assert.equal(readConfig({ PANEL_RUN_TIMEOUT_MIN: '240' }, { panelDir: PANEL_FAKE }).runTimeoutMs, 240 * 60000);
  assert.equal(readConfig({ CLAUDE_BIN: '   ', PANEL_BASH_BIN: '' }, { panelDir: PANEL_FAKE }).claudeBin, 'claude');
  assert.equal(readConfig({ PANEL_BASH_BIN: '   ' }, { panelDir: PANEL_FAKE }).bashBin, null);
});

test('[F4-R1] readConfig: valores fuera de rango vuelven al defecto y PANEL_ALLOW_EXEC 0/false/FALSE/1', () => {
  for (const PANEL_MAX_RUNS of ['0', '11', 'abc', '2.5', '-1']) {
    assert.equal(readConfig({ PANEL_MAX_RUNS }, { panelDir: PANEL_FAKE }).maxRuns, 2, `PANEL_MAX_RUNS=${PANEL_MAX_RUNS}`);
  }
  for (const PANEL_RUN_TIMEOUT_MIN of ['abc', '0', '241', '1.5']) {
    assert.equal(readConfig({ PANEL_RUN_TIMEOUT_MIN }, { panelDir: PANEL_FAKE }).runTimeoutMs, 30 * 60000, `PANEL_RUN_TIMEOUT_MIN=${PANEL_RUN_TIMEOUT_MIN}`);
  }
  assert.equal(readConfig({ PANEL_ALLOW_EXEC: '0' }, { panelDir: PANEL_FAKE }).allowExec, false);
  assert.equal(readConfig({ PANEL_ALLOW_EXEC: 'false' }, { panelDir: PANEL_FAKE }).allowExec, false);
  assert.equal(readConfig({ PANEL_ALLOW_EXEC: 'FALSE' }, { panelDir: PANEL_FAKE }).allowExec, false);
  assert.equal(readConfig({ PANEL_ALLOW_EXEC: '1' }, { panelDir: PANEL_FAKE }).allowExec, true);
});

test('[F4-R2] readConfig: cfAccess válido, incompleto y con equipo no válido', () => {
  const ok = readConfig({ PANEL_CF_ACCESS_TEAM: '  MiEquipo-1 ', PANEL_CF_ACCESS_AUD: ' abc123 ' }, { panelDir: PANEL_FAKE });
  assert.deepEqual(ok.cfAccess, { team: 'miequipo-1', aud: 'abc123' });
  assert.deepEqual(readConfig({ PANEL_CF_ACCESS_TEAM: 'equipo' }, { panelDir: PANEL_FAKE }).cfAccess, { error: 'Faltan PANEL_CF_ACCESS_TEAM o PANEL_CF_ACCESS_AUD' });
  assert.deepEqual(readConfig({ PANEL_CF_ACCESS_AUD: 'aud' }, { panelDir: PANEL_FAKE }).cfAccess, { error: 'Faltan PANEL_CF_ACCESS_TEAM o PANEL_CF_ACCESS_AUD' });
  assert.deepEqual(readConfig({ PANEL_CF_ACCESS_TEAM: 'Mi Equipo', PANEL_CF_ACCESS_AUD: 'aud' }, { panelDir: PANEL_FAKE }).cfAccess, { error: 'PANEL_CF_ACCESS_TEAM no válido' });
  assert.deepEqual(readConfig({ PANEL_CF_ACCESS_TEAM: 'x'.repeat(64), PANEL_CF_ACCESS_AUD: 'aud' }, { panelDir: PANEL_FAKE }).cfAccess, { error: 'PANEL_CF_ACCESS_TEAM no válido' });
  assert.equal(readConfig({ PANEL_CF_ACCESS_TEAM: '  ', PANEL_CF_ACCESS_AUD: '' }, { panelDir: PANEL_FAKE }).cfAccess, null);
});

test('[F4-R3] buildStartupLines con work: activada + Access, desactivada + sin Access, Access con error y sin work', () => {
  const common = { urls: ['http://localhost:4310'], dataDir: '/tmp/d', configured: true, publicUrl: 'https://abc.trycloudflare.com', claude: { available: true, claudeHome: '/home/u', projectCount: 1, sessionCount: 2 } };
  const on = buildStartupLines({ ...common, work: { allowExec: true, maxRuns: 2, runTimeoutMin: 30, cfAccess: { team: 'muver', aud: 'x' } } });
  const claudeIdx = on.findIndex((l) => l.startsWith('Claude Code:'));
  assert.equal(on[claudeIdx + 1], 'Ejecución desde el panel: activada (máx. 2 a la vez, límite 30 min)');
  assert.equal(on[claudeIdx + 2], 'Cloudflare Access: activado (equipo muver)');
  assert.equal(on[claudeIdx + 3], 'URL pública: https://abc.trycloudflare.com');

  const off = buildStartupLines({ ...common, work: { allowExec: false, maxRuns: 2, runTimeoutMin: 30, cfAccess: null } });
  assert.ok(off.includes('Ejecución desde el panel: desactivada (PANEL_ALLOW_EXEC=0)'), off.join('\n'));
  assert.ok(off.includes('Cloudflare Access: no configurado (las acciones por el túnel piden la contraseña cada 15 min)'), off.join('\n'));

  const bad = buildStartupLines({ ...common, work: { allowExec: true, maxRuns: 3, runTimeoutMin: 45, cfAccess: { error: 'PANEL_CF_ACCESS_TEAM no válido' } } });
  assert.ok(bad.includes('Ejecución desde el panel: activada (máx. 3 a la vez, límite 45 min)'));
  assert.ok(bad.includes('AVISO: Cloudflare Access mal configurado (PANEL_CF_ACCESS_TEAM no válido): se rechaza todo acceso por el túnel'), bad.join('\n'));

  const without = buildStartupLines(common);
  assert.deepEqual(without, [
    'Puesto de Mando MUVER escuchando en:',
    '  http://localhost:4310',
    'Directorio de datos: /tmp/d',
    'Contraseña: configurada',
    'Claude Code: detectado en /home/u (1 proyectos, 2 sesiones)',
    'URL pública: https://abc.trycloudflare.com',
    'Pulsa Ctrl+C para parar.',
  ]);
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
