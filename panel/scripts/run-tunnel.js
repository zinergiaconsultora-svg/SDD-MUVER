// Lanza Cloudflare Tunnel con URL temporal (trycloudflare.com) hacia el panel local y publica la URL en
// <datos>/public-url.txt. Usa CLOUDFLARED_BIN si cloudflared no está en el PATH. Lo arranca la tarea programada
// PuestoDeMandoMUVER-Tunnel (panel/deploy/install-service.ps1) o el humano a mano: node scripts/run-tunnel.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../lib/config.js';
import { runTunnel } from '../lib/tunnel.js';

const PANEL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = readConfig(process.env, { panelDir: PANEL_DIR });
const bin = process.env.CLOUDFLARED_BIN || 'cloudflared';
const args = ['tunnel', '--url', `http://localhost:${config.port}`];

console.log(`Arrancando ${bin} ${args.join(' ')} (directorio de datos: ${config.dataDir})`);
const code = await runTunnel({ bin, args, dataDir: config.dataDir });
console.log(`cloudflared terminó con código ${code}.`);
process.exit(code);
