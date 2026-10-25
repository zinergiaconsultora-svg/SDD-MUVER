// Tests de lib/public-url.js y lib/tunnel.js — F2-R34, F2-R35, F2-R36
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { parsePublicUrl, readPublicUrl } from '../lib/public-url.js';
import { extractTunnelUrl, runTunnel, TUNNEL_URL_RE } from '../lib/tunnel.js';
import { makeTempDir, removeDir, startApp, request, PANEL_DIR } from './helpers.js';

test('[F2-R34] parsePublicUrl acepta https:// recortado y rechaza vacío, http:// y basura', () => {
  assert.equal(parsePublicUrl('https://x.trycloudflare.com\n'), 'https://x.trycloudflare.com');
  assert.equal(parsePublicUrl('  https://panel.midominio.com  '), 'https://panel.midominio.com');
  assert.equal(parsePublicUrl(''), null);
  assert.equal(parsePublicUrl('\n'), null);
  assert.equal(parsePublicUrl('http://inseguro'), null);
  assert.equal(parsePublicUrl('basura'), null);
  assert.equal(parsePublicUrl('https://con espacios.com'), null);
  assert.equal(parsePublicUrl(undefined), null);
});

test('[F2-R34] readPublicUrl: fichero ausente → null; con URL → URL; vacío → null', async () => {
  const dir = await makeTempDir('muver-url-');
  const file = path.join(dir, 'public-url.txt');
  assert.equal(await readPublicUrl(file), null);
  await fs.writeFile(file, 'https://abc.trycloudflare.com\n');
  assert.equal(await readPublicUrl(file), 'https://abc.trycloudflare.com');
  await fs.writeFile(file, '');
  assert.equal(await readPublicUrl(file), null);
  await removeDir(dir);
});

test('[F2-R34] GET /api/auth/status devuelve publicUrl según public-url.txt (sin fichero, con URL, vacío) leyéndolo en cada petición', async () => {
  // Corrección T36: registro temporal (nunca el panel/projects.json local del humano, que además la app podría escribir).
  const registryDir = await makeTempDir('muver-reg-');
  const registryFile = path.join(registryDir, 'projects.json');
  await fs.copyFile(path.join(PANEL_DIR, 'projects.example.json'), registryFile);
  const app = await startApp({ projectsFile: registryFile });
  const file = path.join(app.dataDir, 'public-url.txt');
  assert.equal((await request(app.baseUrl, '/api/auth/status')).json.publicUrl, null);
  await fs.writeFile(file, 'https://abc-def-123.trycloudflare.com\n');
  assert.equal((await request(app.baseUrl, '/api/auth/status')).json.publicUrl, 'https://abc-def-123.trycloudflare.com');
  await fs.writeFile(file, '');
  assert.equal((await request(app.baseUrl, '/api/auth/status')).json.publicUrl, null);
  await fs.writeFile(file, 'http://inseguro.example');
  assert.equal((await request(app.baseUrl, '/api/auth/status')).json.publicUrl, null);
  await app.close();
  await removeDir(app.dataDir);
  await removeDir(registryDir);
});

test('[F2-R35] extractTunnelUrl con la línea real de cloudflared, una sin URL y una con http://localhost', () => {
  assert.equal(extractTunnelUrl('2026-10-25T10:00:00Z INF |  https://abc-def-123.trycloudflare.com  |'), 'https://abc-def-123.trycloudflare.com');
  assert.equal(extractTunnelUrl('2026-10-25T10:00:00Z INF Starting tunnel tunnelID=...'), null);
  assert.equal(extractTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com... http://localhost:4310'), null);
  assert.equal(extractTunnelUrl('https://Mayus.trycloudflare.com'), null, 'solo minúsculas, dígitos y guiones');
  assert.equal(extractTunnelUrl(''), null);
  assert.ok(TUNNEL_URL_RE instanceof RegExp);
});

/** spawn falso: devuelve un proceso con stdout/stderr emisores y registra la llamada. */
function fakeSpawn(calls) {
  return (bin, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    calls.push({ bin, args, options, child });
    return child;
  };
}

test('[F2-R36] runTunnel escribe public-url.txt al ver la URL, anexa a cloudflared.log, vacía el fichero en exit y resuelve con el código', async () => {
  const dataDir = await makeTempDir('muver-tunnel-');
  const calls = [];
  const logs = [];
  const promise = runTunnel({ bin: 'cf-falso', args: ['tunnel', '--url', 'http://localhost:4310'], dataDir, spawn: fakeSpawn(calls), log: (l) => logs.push(l) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, 'cf-falso');
  assert.deepEqual(calls[0].args, ['tunnel', '--url', 'http://localhost:4310']);
  assert.equal(calls[0].options.windowsHide, true);
  const { child } = calls[0];
  const urlFile = path.join(dataDir, 'public-url.txt');
  const logFile = path.join(dataDir, 'cloudflared.log');

  child.stderr.emit('data', Buffer.from('2026-10-25T10:00:00Z INF Starting tunnel\n'));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await readPublicUrl(urlFile), null, 'todavía sin URL');

  child.stderr.emit('data', Buffer.from('INF |  https://abc-def-123.trycloudflare.com  |\nINF otra línea\n'));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await fs.readFile(urlFile, 'utf8'), 'https://abc-def-123.trycloudflare.com\n');
  assert.ok(logs.some((l) => l.includes('URL pública: https://abc-def-123.trycloudflare.com')), logs.join('\n'));

  child.stdout.emit('data', Buffer.from('INF |  https://otra.trycloudflare.com  |\n'));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await fs.readFile(urlFile, 'utf8'), 'https://abc-def-123.trycloudflare.com\n', 'la primera URL se conserva');

  child.emit('exit', 0, null);
  const code = await promise;
  assert.equal(code, 0);
  assert.equal(await fs.readFile(urlFile, 'utf8'), '', 'vaciado al terminar');
  const log = await fs.readFile(logFile, 'utf8');
  assert.ok(log.includes('INF Starting tunnel'));
  assert.ok(log.includes('https://abc-def-123.trycloudflare.com'));
  assert.ok(log.includes('INF otra línea'));
  assert.ok(log.includes('https://otra.trycloudflare.com'), 'toda la salida se anexa');
  await removeDir(dataDir);
});

test('[F2-R36] runTunnel con exit code 3 resuelve 3; con evento error (cloudflared no instalado) resuelve 1 y avisa', async () => {
  const dataDir = await makeTempDir('muver-tunnel-');
  const calls = [];
  const logs = [];
  const p1 = runTunnel({ dataDir, spawn: fakeSpawn(calls), log: (l) => logs.push(l) });
  assert.equal(calls[0].bin, 'cloudflared');
  assert.deepEqual(calls[0].args, ['tunnel', '--url', 'http://localhost:4310']);
  calls[0].child.emit('exit', 3, null);
  assert.equal(await p1, 3);

  const p2 = runTunnel({ dataDir, spawn: fakeSpawn(calls), log: (l) => logs.push(l) });
  calls[1].child.emit('error', Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }));
  assert.equal(await p2, 1);
  assert.ok(logs.some((l) => l.includes('No se pudo ejecutar cloudflared: spawn cloudflared ENOENT')), logs.join('\n'));
  assert.equal(await fs.readFile(path.join(dataDir, 'public-url.txt'), 'utf8'), '');
  await removeDir(dataDir);
});

test('[F2-R36] scripts/run-tunnel.js existe y usa CLOUDFLARED_BIN, readConfig y runTunnel', async () => {
  const source = await fs.readFile(path.join(PANEL_DIR, 'scripts', 'run-tunnel.js'), 'utf8');
  assert.ok(source.includes('CLOUDFLARED_BIN'));
  assert.ok(source.includes('readConfig'));
  assert.ok(source.includes('runTunnel'));
  assert.ok(source.includes('--url'));
});
