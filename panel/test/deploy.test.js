// Tests estáticos de despliegue: .gitignore, deploy/*.yml, deploy/*.ps1 y docs/acceso-web.md — F2-R7, F2-R44, F2-R45, F2-R46
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PANEL_DIR, hasGit } from './helpers.js';

const execFileAsync = promisify(execFile);
const REPO_DIR = path.resolve(PANEL_DIR, '..');
const DEPLOY_DIR = path.join(PANEL_DIR, 'deploy');

const read = (file) => fs.readFile(file, 'utf8');
const gitAvailable = await hasGit();

test('[F2-R7] .gitignore raíz contiene la línea panel/data/ sin romper las negaciones del arnés', async () => {
  const lines = (await read(path.join(REPO_DIR, '.gitignore'))).split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('panel/data/'), 'falta la línea exacta panel/data/');
  for (const kept of ['!docs/', '!specs/', '!progress/', '!.claude/', '!feature_list.json', '!init.sh']) {
    assert.ok(lines.includes(kept), `se ha perdido la negación ${kept}`);
  }
});

test('[F2-R7] git check-ignore considera ignorado panel/data/auth.json', { skip: gitAvailable ? false : 'git no disponible' }, async () => {
  const { stdout } = await execFileAsync('git', ['check-ignore', 'panel/data/auth.json'], { cwd: REPO_DIR, timeout: 10000, windowsHide: true });
  assert.equal(stdout.trim(), 'panel/data/auth.json');
  await assert.rejects(
    execFileAsync('git', ['check-ignore', '-q', 'docs/acceso-web.md'], { cwd: REPO_DIR, timeout: 10000, windowsHide: true }),
    'docs/ no debe quedar ignorado',
  );
});

test('[F2-R44] cloudflared-config.example.yml tiene tunnel, credentials-file, ingress con hostname → http://localhost:4310 y http_status:404', async () => {
  const yml = await read(path.join(DEPLOY_DIR, 'cloudflared-config.example.yml'));
  assert.ok(yml.includes('tunnel: <TUNNEL-ID>'));
  assert.ok(yml.includes('credentials-file:'));
  assert.ok(yml.includes('ingress:'));
  assert.match(yml, /hostname:\s*\S+\s*\n\s*service:\s*http:\/\/localhost:4310/);
  assert.ok(yml.includes('service: http_status:404'));
  assert.ok(yml.indexOf('http_status:404') > yml.indexOf('http://localhost:4310'), 'la regla 404 es la última');
});

test('[F2-R46] install-service.ps1 registra dos tareas S4U con AtStartup+AtLogOn, IgnoreNew, panel.log, -NoTunnel y sin nssm', async () => {
  const ps1 = await read(path.join(DEPLOY_DIR, 'install-service.ps1'));
  for (const needle of [
    'Register-ScheduledTask',
    'New-ScheduledTaskAction',
    'New-ScheduledTaskTrigger',
    '-AtStartup',
    '-AtLogOn',
    '-MultipleInstances IgnoreNew',
    '-LogonType S4U',
    'PuestoDeMandoMUVER',
    'PuestoDeMandoMUVER-Tunnel',
    'server.js',
    'scripts/run-tunnel.js',
    'panel.log',
    'cloudflared.log',
    '$NoTunnel',
    '$Port',
    '$PSScriptRoot',
    '#requires -RunAsAdministrator',
    'Get-Command node',
    'Get-Command cloudflared',
    'Start-ScheduledTask',
    'Get-ScheduledTask',
  ]) {
    assert.ok(ps1.includes(needle), `falta "${needle}" en install-service.ps1`);
  }
  assert.match(ps1, /\[switch\]\s*\$NoTunnel/, 'parámetro -NoTunnel');
  assert.ok(ps1.includes('set CLOUDFLARED_BIN='), 'la tarea del túnel propaga la ruta resuelta de cloudflared (la tarea S4U no carga el PATH de usuario)');
  assert.match(ps1, /set PORT=\$Port&&/, 'la tarea propaga PORT');
  assert.match(ps1, /\[int\]\s*\$Port\s*=\s*4310/, 'parámetro -Port con valor por defecto 4310');
  assert.ok(!/nssm/i.test(ps1), 'no debe usar nssm');
  assert.ok(!/Invoke-WebRequest|Start-BitsTransfer|curl\s/i.test(ps1), 'no descarga nada');
});

test('[F2-R46] uninstall-service.ps1 elimina las dos tareas con Unregister-ScheduledTask', async () => {
  const ps1 = await read(path.join(DEPLOY_DIR, 'uninstall-service.ps1'));
  assert.ok(ps1.includes('Unregister-ScheduledTask'));
  assert.ok(ps1.includes('Stop-ScheduledTask'));
  assert.ok(ps1.includes('PuestoDeMandoMUVER'));
  assert.ok(ps1.includes('PuestoDeMandoMUVER-Tunnel') || ps1.includes('-Tunnel"'));
  assert.ok(ps1.includes('#requires -RunAsAdministrator'));
  assert.ok(ps1.includes('-Confirm:$false'));
});

test('[F2-R45] docs/acceso-web.md tiene la estructura exigida y la opción avanzada al final', async () => {
  const doc = await read(path.join(REPO_DIR, 'docs', 'acceso-web.md'));
  const main = doc.indexOf('Paso a paso principal: URL temporal de Cloudflare');
  const advanced = doc.indexOf('Opción avanzada: dominio propio');
  assert.ok(main >= 0, 'falta la sección principal');
  assert.ok(advanced >= 0, 'falta la opción avanzada');
  assert.ok(advanced > main, 'la opción avanzada va después del camino principal');
  for (const needle of [
    'winget install Cloudflare.cloudflared',
    'cloudflared tunnel --url http://localhost:4310',
    'trycloudflare.com',
    'public-url.txt',
    'install-service.ps1',
    'uninstall-service.ps1',
    'PORT',
    'PANEL_DATA_DIR',
    'PANEL_SECURE_COOKIES',
    'PANEL_TRUST_PROXY',
    'CLOUDFLARED_BIN',
    'Si olvidas la contraseña',
    'npm run reset-password',
    'cloudflared tunnel login',
    'cloudflared tunnel create',
    'cloudflared tunnel route dns',
    'cloudflared service install',
    'cloudflared-config.example.yml',
    'Cloudflare Access',
    'panel.log',
    'cloudflared.log',
    'Problemas frecuentes',
  ]) {
    assert.ok(doc.includes(needle), `falta "${needle}" en docs/acceso-web.md`);
  }
  const envTable = doc.slice(doc.indexOf('## 5.'), doc.indexOf('## 6.'));
  assert.match(envTable, /\|\s*`?PORT`?\s*\|/, 'tabla con PORT');
  assert.match(envTable, /\|\s*`?PANEL_TRUST_PROXY`?\s*\|/, 'tabla con PANEL_TRUST_PROXY');
  const sections = ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.', '## 8.'];
  let last = -1;
  for (const s of sections) {
    const idx = doc.indexOf(s);
    assert.ok(idx > last, `sección ${s} fuera de orden o ausente`);
    last = idx;
  }
});

// ---------- Fase 3: documentación del arnés (F3-R53) ----------

test('[F3-R53] docs/architecture.md documenta la fase 3 y docs/verification.md tiene la tabla [F3-R', async () => {
  const architecture = await read(path.join(REPO_DIR, 'docs', 'architecture.md'));
  for (const needle of ['lib/claude-discovery.js', 'lib/project-catalog.js', '/api/claude/status', 'CLAUDE_HOME_DIR', 'PATCH /api/projects/:id']) {
    assert.ok(architecture.includes(needle), `docs/architecture.md debe mencionar ${needle}`);
  }
  const verification = await read(path.join(REPO_DIR, 'docs', 'verification.md'));
  assert.ok(verification.includes('[F3-R'), 'docs/verification.md debe tener la tabla con prefijo [F3-R');
  for (let n = 1; n <= 53; n++) assert.match(verification, new RegExp(`^\\| R${n} \\|.*\\[F3-R`, 'm'), `fila F3 de R${n}`);
});
