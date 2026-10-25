// Server-Sent Events (design.md §5.12): salida en vivo de un run con `id: <seq>` para reconectar con Last-Event-ID.

export const SSE_RETRY_MS = 3000;
export const DEFAULT_HEARTBEAT_MS = 15000;

/** Mensaje SSE de un evento del run. */
export function formatSseEvent(event) {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Abre el flujo: cabeceras 200, `retry: 3000` y latido `: ping` cada `heartbeatMs` sin envíos.
 * Devuelve { send(event), close(), closed }.
 */
export function openSse(res, { heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);
  let closed = false;
  let timer = null;

  function schedule() {
    if (timer) clearTimeout(timer);
    if (closed) return;
    timer = setTimeout(() => {
      if (closed) return;
      res.write(': ping\n\n');
      schedule();
    }, heartbeatMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  schedule();
  return {
    send(event) {
      if (closed) return;
      res.write(formatSseEvent(event));
      schedule();
    },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      res.end();
    },
    get closed() {
      return closed;
    },
  };
}
