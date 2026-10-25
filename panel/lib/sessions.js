// Sesiones del panel: tokens firmados (HMAC), lista blanca en sessions.json y caducidad deslizante.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import { writeJsonAtomic } from './auth.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TOUCH_INTERVAL_MS = 60 * 1000;

const TOKEN_RE = /^([0-9a-f]{64})\.([0-9a-f]{64})$/;

/** Firma HMAC-SHA256 del id de sesión en hex. */
export function signId(id, secret) {
  return crypto.createHmac('sha256', secret).update(id).digest('hex');
}

/** Devuelve el id si el token tiene formato <hex64>.<hex64> y firma correcta; si no, null. Nunca lanza (R13). */
export function verifyToken(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string') return null;
  const match = TOKEN_RE.exec(token);
  if (!match) return null;
  const [, id, signature] = match;
  try {
    const expected = Buffer.from(signId(id, secret), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length) return null;
    return crypto.timingSafeEqual(expected, actual) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Almacén de sesiones persistido en `file` (§3.2). Carga perezosa; JSON roto → mapa vacío + console.error.
 */
export function createSessionStore({ file, secret, now = () => Date.now(), ttlMs = SESSION_TTL_MS, touchIntervalMs = TOUCH_INTERVAL_MS }) {
  if (!file) throw new Error('createSessionStore: falta file');
  if (!secret) throw new Error('createSessionStore: falta secret');

  let sessions = null; // Map<id, { createdAt, lastSeenAt, expiresAt }>
  let loading = null;
  let writeQueue = Promise.resolve();

  async function load() {
    const map = new Map();
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (err && err.code !== 'ENOENT') console.error('[panel] sessions.json ilegible, se ignora');
      return map;
    }
    try {
      const parsed = JSON.parse(raw.replace(/^﻿/, ''));
      const entries = parsed && parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : null;
      if (!entries) throw new Error('sin sessions');
      for (const [id, s] of Object.entries(entries)) {
        if (/^[0-9a-f]{64}$/.test(id) && s && Number.isFinite(s.expiresAt)) {
          map.set(id, { createdAt: Number(s.createdAt) || 0, lastSeenAt: Number(s.lastSeenAt) || 0, expiresAt: Number(s.expiresAt) });
        }
      }
    } catch {
      console.error('[panel] sessions.json ilegible, se ignora');
      return new Map();
    }
    return map;
  }

  async function ensureLoaded() {
    if (sessions) return sessions;
    if (!loading) loading = load().then((map) => { sessions = map; return map; });
    return loading;
  }

  function persist() {
    const snapshot = { version: 1, sessions: Object.fromEntries(sessions) };
    writeQueue = writeQueue.then(() => writeJsonAtomic(file, snapshot));
    return writeQueue;
  }

  /** Elimina las caducadas; devuelve true si eliminó alguna. */
  function purgeExpired(current) {
    let removed = false;
    for (const [id, s] of sessions) {
      if (s.expiresAt <= current) {
        sessions.delete(id);
        removed = true;
      }
    }
    return removed;
  }

  return {
    ensureLoaded,

    async create() {
      await ensureLoaded();
      const current = now();
      const id = crypto.randomBytes(32).toString('hex');
      const session = { createdAt: current, lastSeenAt: current, expiresAt: current + ttlMs };
      purgeExpired(current);
      sessions.set(id, session);
      await persist();
      return { id, token: `${id}.${signId(id, secret)}`, expiresAt: session.expiresAt };
    },

    async verify(token) {
      await ensureLoaded();
      const id = verifyToken(token, secret);
      const current = now();
      if (purgeExpired(current)) await persist();
      if (!id) return null;
      const session = sessions.get(id);
      if (!session) return null;
      return { id, ...session };
    },

    async touch(id) {
      await ensureLoaded();
      const session = sessions.get(id);
      if (!session) return { renewed: false };
      const current = now();
      if (current - session.lastSeenAt < touchIntervalMs) return { renewed: false };
      session.lastSeenAt = current;
      session.expiresAt = current + ttlMs;
      await persist();
      return { renewed: true };
    },

    async destroy(id) {
      await ensureLoaded();
      if (sessions.delete(id)) await persist();
    },

    async destroyOthers(id) {
      await ensureLoaded();
      const keep = sessions.get(id);
      sessions = new Map(keep ? [[id, keep]] : []);
      await persist();
    },

    count() {
      return sessions ? sessions.size : 0;
    },
  };
}
