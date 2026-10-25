// Contraseña única del panel: hash scrypt, verificación en tiempo constante y fichero auth.json.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
export const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 });
export const PASSWORD_LENGTH_ERROR = 'La contraseña debe tener entre 10 y 128 caracteres';

const HEX_RE = /^[0-9a-f]+$/i;

function isHex(value) {
  return typeof value === 'string' && value.length > 0 && value.length % 2 === 0 && HEX_RE.test(value);
}

/** Longitud válida: 10–128 caracteres (puntos de código, sin trim). */
export function validatePassword(value) {
  if (typeof value !== 'string') return { ok: false, error: PASSWORD_LENGTH_ERROR };
  const length = [...value].length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) return { ok: false, error: PASSWORD_LENGTH_ERROR };
  return { ok: true };
}

function scryptOptions(params) {
  const { N, r, p } = params;
  return { N, r, p, maxmem: 128 * N * r * 2 };
}

/** Deriva la clave scrypt de una contraseña con un salt y parámetros dados. */
async function derive(password, saltBuffer, params) {
  const key = await scrypt(Buffer.from(password, 'utf8'), saltBuffer, params.keylen, scryptOptions(params));
  return Buffer.from(key);
}

/** Genera { salt, hash, params } con un salt aleatorio nuevo de 16 bytes (R12). */
export async function hashPassword(password, { salt = crypto.randomBytes(16), params = SCRYPT_PARAMS } = {}) {
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex');
  const hash = await derive(password, saltBuffer, params);
  return { salt: saltBuffer.toString('hex'), hash: hash.toString('hex'), params: { ...params } };
}

function normalizeParams(params) {
  const p = params && typeof params === 'object' ? params : {};
  const N = Number.isInteger(p.N) && p.N > 1 ? p.N : SCRYPT_PARAMS.N;
  const r = Number.isInteger(p.r) && p.r > 0 ? p.r : SCRYPT_PARAMS.r;
  const pp = Number.isInteger(p.p) && p.p > 0 ? p.p : SCRYPT_PARAMS.p;
  const keylen = Number.isInteger(p.keylen) && p.keylen > 0 ? p.keylen : SCRYPT_PARAMS.keylen;
  return { N, r, p: pp, keylen };
}

/** Compara en tiempo constante; longitudes distintas o hex inválido → false, nunca lanza (R13). */
export async function verifyPassword(password, record) {
  if (typeof password !== 'string' || !record || !isHex(record.salt) || !isHex(record.hash)) return false;
  try {
    const params = normalizeParams(record.params);
    const expected = Buffer.from(record.hash, 'hex');
    const actual = await derive(password, Buffer.from(record.salt, 'hex'), params);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Registro completo de auth.json (§3.1) con sessionSecret nuevo. */
export async function createAuthRecord(password, { now = () => Date.now() } = {}) {
  const { salt, hash, params } = await hashPassword(password);
  const stamp = new Date(now()).toISOString();
  return {
    version: 1,
    algorithm: 'scrypt',
    salt,
    hash,
    params,
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Lee auth.json: { state: 'missing' } | { state: 'ok', record } | { state: 'corrupt' }. Nunca lanza. */
export async function loadAuth(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: 'missing' };
    return { state: 'corrupt' };
  }
  let record;
  try {
    record = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return { state: 'corrupt' };
  }
  if (!record || typeof record !== 'object') return { state: 'corrupt' };
  if (!isHex(record.salt) || !isHex(record.hash) || !isHex(record.sessionSecret)) return { state: 'corrupt' };
  return { state: 'ok', record };
}

/** Escritura atómica: mkdir recursivo, .tmp y rename (R6). */
export async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

export async function saveAuth(file, record) {
  await writeJsonAtomic(file, record);
}
