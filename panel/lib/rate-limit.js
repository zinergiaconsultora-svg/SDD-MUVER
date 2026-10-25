// Límite de intentos de login en memoria por clave (IP del cliente): 5 fallos → 15 minutos de bloqueo.

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const BLOCK_MS = 15 * 60 * 1000;
/** Corrección T36: tope de entradas del mapa para que no crezca sin fin. */
export const MAX_ENTRIES = 10000;
const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Crea un limitador. Estado: Map<key, { failures, lastFailureAt, blockedUntil }>.
 * - check(key) → { blocked: false } | { blocked: true, retryAfterMs }; borra la entrada si el bloqueo expiró.
 * - recordFailure(key): reinicia el contador si el último fallo es anterior a la ventana; al llegar a maxFailures bloquea.
 * - reset(key): borra la entrada (login correcto).
 */
export function createRateLimiter({ maxFailures = MAX_FAILURES, windowMs = WINDOW_MS, blockMs = BLOCK_MS, now = () => Date.now(), maxEntries = MAX_ENTRIES } = {}) {
  const entries = new Map(); // en orden de último fallo (las más antiguas primero)
  let lastSweep = now();

  function isExpired(entry, current) {
    if (entry.blockedUntil != null) return entry.blockedUntil <= current;
    return current - entry.lastFailureAt > windowMs;
  }

  /** Corrección T36: borra las caducadas y, si aún se supera el tope, las más antiguas (primero las no bloqueadas). */
  function prune(current) {
    if (entries.size < maxEntries && current - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = current;
    for (const [key, entry] of entries) if (isExpired(entry, current)) entries.delete(key);
    for (const [key, entry] of entries) {
      if (entries.size < maxEntries) break;
      if (entry.blockedUntil == null) entries.delete(key);
    }
    for (const key of entries.keys()) {
      if (entries.size < maxEntries) break;
      entries.delete(key);
    }
  }

  function check(key) {
    const entry = entries.get(key);
    if (!entry) return { blocked: false };
    const current = now();
    if (entry.blockedUntil != null) {
      if (entry.blockedUntil <= current) {
        entries.delete(key);
        return { blocked: false };
      }
      return { blocked: true, retryAfterMs: entry.blockedUntil - current };
    }
    return { blocked: false };
  }

  function recordFailure(key) {
    const current = now();
    prune(current);
    let entry = entries.get(key);
    if (!entry || (entry.blockedUntil != null && entry.blockedUntil <= current) || current - entry.lastFailureAt > windowMs) {
      entry = { failures: 0, lastFailureAt: current, blockedUntil: null };
      entries.set(key, entry);
    }
    entry.failures += 1;
    entry.lastFailureAt = current;
    entries.delete(key); // se mueve al final: el orden del mapa es el de último fallo
    entries.set(key, entry);
    if (entry.failures >= maxFailures && entry.blockedUntil == null) entry.blockedUntil = current + blockMs;
  }

  function reset(key) {
    entries.delete(key);
  }

  return { check, recordFailure, reset, size: () => entries.size };
}
