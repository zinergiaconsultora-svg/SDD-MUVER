// Tests de lib/cf-access.js y de su comprobación en app.js — F4: R71, R72, R73.
// Par RSA generado en el propio test y claves públicas servidas desde un servidor HTTP local (nunca Cloudflare real).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { createAccessVerifier, decodeJwt, accessIssuer, accessCertsUrl } from '../lib/cf-access.js';
import { makeTempDir, writeRegistry, startApp, request, removeDir, makeClock } from './helpers.js';
import { makeAccessKeys, makeJwt, startCertsServer, tunnelHeaders } from './work-helpers.js';

const TEAM = 'muver';
const AUD = 'aud-de-prueba';
const ISS = 'https://muver.cloudflareaccess.com';
const T0 = Date.parse('2026-10-25T10:00:00.000Z');
const MIN = 60 * 1000;
const keys = makeAccessKeys('kid-1');
const otherKeys = makeAccessKeys('kid-2');

const cleanup = [];
const closers = [];
after(async () => {
  for (const close of closers) await close();
  for (const dir of cleanup) await removeDir(dir);
});

function claims(clock, extra = {}) {
  const now = Math.floor(clock.now() / 1000);
  return { aud: [AUD], iss: ISS, exp: now + 600, iat: now, nbf: now, email: 'humano@example.com', ...extra };
}

function spyFetch(jwks = [keys.jwk]) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ keys: jwks }) };
  };
  return { calls, fetchImpl };
}

test('[F4-R72] accessIssuer, accessCertsUrl y decodeJwt', () => {
  assert.equal(accessIssuer('muver'), 'https://muver.cloudflareaccess.com');
  assert.equal(accessCertsUrl('muver'), 'https://muver.cloudflareaccess.com/cdn-cgi/access/certs');
  const clock = makeClock(T0);
  const token = makeJwt(keys.privateKey, { alg: 'RS256', kid: 'kid-1' }, claims(clock));
  const decoded = decodeJwt(token);
  assert.equal(decoded.header.kid, 'kid-1');
  assert.equal(decoded.payload.iss, ISS);
  assert.equal(decoded.signingInput, token.split('.').slice(0, 2).join('.'));
  assert.ok(Buffer.isBuffer(decoded.signature));
  for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', '!!.@@.##', `${Buffer.from('[]').toString('base64url')}.e30.x`]) assert.equal(decodeJwt(bad), null, bad);
});

test('[F4-R72] token válido aceptado (aud cadena o array) y cada motivo de rechazo', async () => {
  const clock = makeClock(T0);
  const { fetchImpl } = spyFetch();
  const verifier = createAccessVerifier({ team: TEAM, aud: AUD, fetchImpl, now: clock.now, log: () => {} });
  const sign = (header, payload, key = keys.privateKey) => makeJwt(key, header, payload);
  const ok = await verifier.verify(sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock)));
  assert.equal(ok.ok, true);
  assert.equal(ok.claims.email, 'humano@example.com');
  assert.equal((await verifier.verify(sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock, { aud: AUD })))).ok, true, 'aud como cadena');

  const valid = sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock));
  const [h, p, sig] = valid.split('.');
  const flipped = Buffer.from(sig, 'base64url');
  flipped[10] ^= 0xff;
  const nowSec = Math.floor(T0 / 1000);
  const cases = [
    [undefined, 'missing'],
    ['', 'missing'],
    ['no es un jwt', 'malformed'],
    [`${h}.${p}.${flipped.toString('base64url')}`, 'signature'],
    [sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock), otherKeys.privateKey), 'signature'],
    [sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock, { aud: ['otro-aud'] })), 'aud'],
    [sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock, { aud: 'otro-aud' })), 'aud'],
    [sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock, { iss: 'https://otro.cloudflareaccess.com' })), 'iss'],
    [sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock, { exp: nowSec - 120 })), 'exp'],
    [sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock, { nbf: nowSec + 120 })), 'nbf'],
    [sign({ alg: 'HS256', kid: 'kid-1' }, claims(clock)), 'alg'],
    [sign({ alg: 'none', kid: 'kid-1' }, claims(clock)), 'alg'],
    [sign({ alg: 'RS256', kid: 'desconocido' }, claims(clock)), 'kid'],
  ];
  for (const [token, reason] of cases) {
    const r = await verifier.verify(token);
    assert.deepEqual(r, { ok: false, reason }, `${reason}: ${String(token).slice(0, 30)}`);
  }
  // Margen de 60 s: exp 30 s en el pasado y nbf 30 s en el futuro se aceptan.
  assert.equal((await verifier.verify(sign({ alg: 'RS256', kid: 'kid-1' }, claims(clock, { exp: nowSec - 30, nbf: nowSec + 30 })))).ok, true);
});

test('[F4-R73] caché de claves de 1 h, recarga por kid desconocido como mucho una vez por minuto y fallo de descarga', async () => {
  const clock = makeClock(T0);
  const { calls, fetchImpl } = spyFetch([keys.jwk]);
  const verifier = createAccessVerifier({ team: TEAM, aud: AUD, fetchImpl, now: clock.now, log: () => {} });
  const token = () => makeJwt(keys.privateKey, { alg: 'RS256', kid: 'kid-1' }, claims(clock));
  const unknown = () => makeJwt(otherKeys.privateKey, { alg: 'RS256', kid: 'kid-2' }, claims(clock));
  assert.equal((await verifier.verify(token())).ok, true);
  clock.advance(59 * MIN);
  assert.equal((await verifier.verify(token())).ok, true);
  assert.equal(calls.length, 1, 'dos verificaciones en 59 min → una descarga');
  assert.equal(calls[0], 'https://muver.cloudflareaccess.com/cdn-cgi/access/certs');
  clock.advance(2 * MIN);
  assert.equal((await verifier.verify(token())).ok, true);
  assert.equal(calls.length, 2, 'a los 61 min se vuelve a descargar');
  clock.advance(2 * MIN);
  assert.equal((await verifier.verify(unknown())).reason, 'kid');
  clock.advance(30 * 1000);
  assert.equal((await verifier.verify(unknown())).reason, 'kid');
  assert.equal(calls.length, 3, 'kid nuevo dos veces en 30 s → una sola descarga extra');

  const errors = [];
  const failing = createAccessVerifier({ team: TEAM, aud: AUD, now: clock.now, log: (...args) => errors.push(args.join(' ')), fetchImpl: async () => { throw new Error('sin red'); } });
  assert.deepEqual(await failing.verify(token()), { ok: false, reason: 'certs' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Cloudflare Access/);
  const badStatus = createAccessVerifier({ team: TEAM, aud: AUD, now: clock.now, log: () => {}, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.deepEqual(await badStatus.verify(token()), { ok: false, reason: 'certs' });
});

test('[F4-R73] rotación de claves: un kid nuevo publicado se acepta tras recargar', async () => {
  const clock = makeClock(T0);
  let jwks = [keys.jwk];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: jwks }) });
  const verifier = createAccessVerifier({ team: TEAM, aud: AUD, fetchImpl, now: clock.now, log: () => {} });
  assert.equal((await verifier.verify(makeJwt(keys.privateKey, { alg: 'RS256', kid: 'kid-1' }, claims(clock)))).ok, true);
  jwks = [keys.jwk, otherKeys.jwk];
  clock.advance(2 * MIN);
  assert.equal((await verifier.verify(makeJwt(otherKeys.privateKey, { alg: 'RS256', kid: 'kid-2' }, claims(clock)))).ok, true);
});

test('[F4-R71] con Access configurado: estáticos y /api/auth/status por el túnel sin token o con token inválido → 403; en local → 200; con token válido → 200', async () => {
  const certs = await startCertsServer([keys.jwk]);
  closers.push(() => certs.close());
  const base = await makeTempDir('muver-f4-access-');
  cleanup.push(base);
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, []);
  const clock = makeClock(T0);
  const app = await startApp({ projectsFile: registryFile, password: 'contraseña-de-la-fase-4', now: clock.now, cfAccess: { team: TEAM, aud: AUD }, cfCertsUrl: certs.url });
  closers.push(() => app.close());
  cleanup.push(app.dataDir);
  const denied = 'Acceso denegado: falta o no es válida la identificación de Cloudflare Access';
  for (const urlPath of ['/', '/app.js', '/api/auth/status', '/api/projects']) {
    const noToken = await request(app.baseUrl, urlPath, { headers: tunnelHeaders() });
    assert.equal(noToken.status, 403, urlPath);
    assert.ok(noToken.text.includes(denied), noToken.text);
    const badToken = await request(app.baseUrl, urlPath, { headers: { ...tunnelHeaders(), 'Cf-Access-Jwt-Assertion': makeJwt(otherKeys.privateKey, { alg: 'RS256', kid: 'kid-1' }, claims(clock)) } });
    assert.equal(badToken.status, 403, urlPath);
    const viaProto = await request(app.baseUrl, urlPath, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(viaProto.status, 403, urlPath);
  }
  assert.equal((await request(app.baseUrl, '/')).status, 200);
  assert.equal((await request(app.baseUrl, '/api/auth/status')).status, 200);
  const good = { ...tunnelHeaders(), 'Cf-Access-Jwt-Assertion': makeJwt(keys.privateKey, { alg: 'RS256', kid: 'kid-1' }, claims(clock)) };
  assert.equal((await request(app.baseUrl, '/', { headers: good })).status, 200);
  const status = await request(app.baseUrl, '/api/auth/status', { headers: good });
  assert.equal(status.status, 200);
  assert.equal(status.json.configured, true);
  assert.equal(certs.count(), 1, 'claves descargadas una vez y reutilizadas');
});
