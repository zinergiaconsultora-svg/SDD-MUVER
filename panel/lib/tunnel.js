// Lanzador de Cloudflare Tunnel (URL temporal): captura la URL de la salida de cloudflared y la publica en
// <datos>/public-url.txt; anexa toda la salida a <datos>/cloudflared.log.
import { spawn as defaultSpawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
export const DEFAULT_TUNNEL_ARGS = Object.freeze(['tunnel', '--url', 'http://localhost:4310']);

/** Primera URL https://<sub>.trycloudflare.com de la línea, o null. */
export function extractTunnelUrl(line) {
  if (typeof line !== 'string') return null;
  const match = TUNNEL_URL_RE.exec(line);
  return match ? match[0] : null;
}

/**
 * Arranca cloudflared y resuelve con su código de salida (1 si no se pudo ejecutar).
 * Escribe la URL en public-url.txt en cuanto aparece y vacía el fichero al terminar.
 */
export function runTunnel({ bin = 'cloudflared', args = [...DEFAULT_TUNNEL_ARGS], dataDir, spawn = defaultSpawn, log = console.log } = {}) {
  if (!dataDir) throw new Error('runTunnel: falta dataDir');
  const urlFile = path.join(dataDir, 'public-url.txt');
  const logFile = path.join(dataDir, 'cloudflared.log');

  let urlWritten = false;
  let settled = false;
  let fileQueue = fs.mkdir(dataDir, { recursive: true }).catch(() => {});

  const enqueue = (task) => {
    fileQueue = fileQueue.then(task).catch((err) => {
      log(`No se pudo escribir en el directorio de datos: ${err && err.message ? err.message : err}`);
    });
    return fileQueue;
  };

  const appendLog = (text) => enqueue(() => fs.appendFile(logFile, text, 'utf8'));

  const onChunk = (chunk) => {
    const text = chunk.toString('utf8');
    appendLog(text.endsWith('\n') ? text : `${text}\n`);
    if (urlWritten) return;
    for (const line of text.split(/\r?\n/)) {
      const url = extractTunnelUrl(line);
      if (url) {
        urlWritten = true;
        enqueue(() => fs.writeFile(urlFile, `${url}\n`, 'utf8'));
        log(`URL pública: ${url}`);
        break;
      }
    }
  };

  return new Promise((resolve) => {
    const finish = async (code) => {
      if (settled) return;
      settled = true;
      await enqueue(() => fs.writeFile(urlFile, '', 'utf8'));
      resolve(code);
    };

    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (err) {
      log(`No se pudo ejecutar cloudflared: ${err && err.message ? err.message : err}`);
      return finish(1);
    }
    if (child.stdout) child.stdout.on('data', onChunk);
    if (child.stderr) child.stderr.on('data', onChunk);
    child.on('error', (err) => {
      log(`No se pudo ejecutar cloudflared: ${err && err.message ? err.message : err}`);
      appendLog(`[run-tunnel] error: ${err && err.message ? err.message : err}\n`);
      finish(1);
    });
    child.on('exit', (code) => {
      appendLog(`[run-tunnel] cloudflared terminó con código ${code ?? 'desconocido'}\n`);
      finish(code ?? 1);
    });
  });
}
