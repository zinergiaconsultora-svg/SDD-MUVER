// URLs de acceso al panel (localhost + IPv4 de la red local).
import os from 'node:os';

/** Devuelve ['http://localhost:<port>', ...una URL por IPv4 no interna]. */
export function buildAccessUrls(port, interfaces = os.networkInterfaces()) {
  const urls = [`http://localhost:${port}`];
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      const isIPv4 = entry.family === 'IPv4' || entry.family === 4;
      if (isIPv4 && entry.internal === false) urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}
