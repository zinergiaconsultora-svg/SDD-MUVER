// Límite de intentos de login en memoria por clave (IP del cliente): 5 fallos → 15 minutos de bloqueo.

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const BLOCK_MS = 15 * 60 * 1000;

/**
 * Crea un limitador. Estado: Map<key, { failures, lastFailureAt, blockedUntil }>.
 * - check(key) → { blocked: false } | { blocked: true, retryAfterMs }; borra la entrada si el bloqueo expiró.
 * - recordFailure(key): reinicia el contador si el último fallo es anterior a la ventana; al llegar a maxFailures bloquea.
 * - reset(key): borra la entrada (login correcto).
 */
export function createRateLimiter({ maxFailures = MAX_FAILURES, windowMs = WINDOW_MS, blockMs = BLOCK_MS, now = () => Date.now() } = {}) {
  const entries = new Map();

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
    let entry = entries.get(key);
    if (!entry || (entry.blockedUntil != null && entry.blockedUntil <= current) || current - entry.lastFailureAt > windowMs) {
      entry = { failures: 0, lastFailureAt: current, blockedUntil: null };
      entries.set(key, entry);
    }
    entry.failures += 1;
    entry.lastFailureAt = current;
    if (entry.failures >= maxFailures && entry.blockedUntil == null) entry.blockedUntil = current + blockMs;
  }

  function reset(key) {
    entries.delete(key);
  }

  return { check, recordFailure, reset };
}
