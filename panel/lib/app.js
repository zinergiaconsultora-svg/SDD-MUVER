// Servidor HTTP del panel: autenticación por contraseña, sesiones firmadas, defensa CSRF, API JSON y estáticos.
// Sin listen (lo hace server.js o los tests).
import http from 'node:http';
import path from 'node:path';

import { loadRegistry, saveRegistry, validateNewProject, removeProject } from './registry.js';
import { buildSummary, buildDetail } from './project-state.js';
import {
  sendJson,
  sendEmpty,
  readJsonBody,
  serveStatic,
  parseCookies,
  buildSetCookie,
  isHttpsRequest,
  getClientIp,
  COOKIE_NAME,
} from './http-utils.js';
import { validatePassword, hashPassword, verifyPassword, createAuthRecord, loadAuth, saveAuth } from './auth.js';
import { createSessionStore, SESSION_TTL_MS } from './sessions.js';
import { createRateLimiter } from './rate-limit.js';
import { readPublicUrl } from './public-url.js';

const API_PREFIX = '/api/';
const AUTH_PREFIX = '/api/auth/';
const PROJECT_ROUTE = /^\/api\/projects\/([^/]+)$/;
const MUTATING_METHODS = new Set(['POST', 'DELETE']);

const ERRORS = Object.freeze({
  csrf: 'Cabecera X-Requested-With requerida',
  unauthenticated: 'No autenticado',
  corrupt: 'Fichero de autenticación ilegible; ejecuta npm run reset-password',
  alreadyConfigured: 'La contraseña ya está configurada',
  notConfigured: 'Contraseña no configurada',
  missingPassword: 'Falta la contraseña',
  wrongPassword: 'Contraseña incorrecta',
  wrongCurrentPassword: 'La contraseña actual no es correcta',
  tooManyAttempts: 'Demasiados intentos. Espera 15 minutos.',
  notFound: 'Ruta no encontrada',
});

/**
 * Crea la app HTTP.
 * @param {{ projectsFile: string, publicDir: string, dataDir: string, now?: () => number, runner?: Function,
 *           trustProxy?: boolean, secureCookies?: boolean }} options
 */
export function createApp({ projectsFile, publicDir, dataDir, now = () => Date.now(), runner, trustProxy = true, secureCookies = false } = {}) {
  if (!projectsFile) throw new Error('createApp: falta projectsFile');
  if (!publicDir) throw new Error('createApp: falta publicDir');
  if (!dataDir) throw new Error('createApp: falta dataDir');

  const authFile = path.join(dataDir, 'auth.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');
  const publicUrlFile = path.join(dataDir, 'public-url.txt');
  const cookieOptions = { trustProxy, secureCookies };
  const limiter = createRateLimiter({ now });

  let authState = null; // { state: 'missing' | 'ok' | 'corrupt', record? }
  let authLoading = null;
  let sessions = null;

  const stateOptions = () => (runner ? { now, runner } : { now });

  // ---------- Estado de autenticación ----------

  async function getAuthState() {
    if (authState) return authState;
    if (!authLoading) authLoading = loadAuth(authFile).then((state) => { authState = state; return state; });
    return authLoading;
  }

  function setAuthRecord(record) {
    authState = { state: 'ok', record };
    if (!sessions) sessions = createSessionStore({ file: sessionsFile, secret: record.sessionSecret, now });
  }

  async function getSessions() {
    const state = await getAuthState();
    if (state.state !== 'ok') return null;
    if (!sessions) sessions = createSessionStore({ file: sessionsFile, secret: state.record.sessionSecret, now });
    return sessions;
  }

  function sessionToken(req) {
    return parseCookies(req)[COOKIE_NAME];
  }

  async function currentSession(req) {
    const store = await getSessions();
    if (!store) return null;
    return store.verify(sessionToken(req));
  }

  function setSessionCookie(req, res, token) {
    res.setHeader('Set-Cookie', buildSetCookie(token, { maxAge: Math.floor(SESSION_TTL_MS / 1000), secure: isHttpsRequest(req, cookieOptions) }));
  }

  function clearSessionCookie(req, res) {
    res.setHeader('Set-Cookie', buildSetCookie('', { maxAge: 0, secure: isHttpsRequest(req, cookieOptions) }));
  }

  async function readBody(req, res) {
    try {
      return await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.error || 'Cuerpo JSON inválido' });
      return null;
    }
  }

  // ---------- Rutas /api/auth/* ----------

  async function authStatus(req, res) {
    const state = await getAuthState();
    if (state.state === 'corrupt') return sendJson(res, 500, { error: ERRORS.corrupt });
    const configured = state.state === 'ok';
    const authenticated = configured ? (await currentSession(req)) !== null : false;
    const publicUrl = await readPublicUrl(publicUrlFile);
    sendJson(res, 200, { configured, authenticated, publicUrl });
  }

  async function authSetup(req, res) {
    const state = await getAuthState();
    if (state.state === 'corrupt') return sendJson(res, 500, { error: ERRORS.corrupt });
    if (state.state === 'ok') return sendJson(res, 409, { error: ERRORS.alreadyConfigured });
    const body = await readBody(req, res);
    if (!body) return undefined;
    const valid = validatePassword(body.password);
    if (!valid.ok) return sendJson(res, 400, { error: valid.error, field: 'password' });
    const record = await createAuthRecord(body.password, { now });
    await saveAuth(authFile, record);
    setAuthRecord(record);
    const created = await sessions.create();
    setSessionCookie(req, res, created.token);
    sendJson(res, 201, { authenticated: true });
  }

  async function authLogin(req, res) {
    const state = await getAuthState();
    if (state.state === 'corrupt') return sendJson(res, 500, { error: ERRORS.corrupt });
    if (state.state !== 'ok') return sendJson(res, 409, { error: ERRORS.notConfigured });
    const ip = getClientIp(req, { trustProxy });
    const limit = limiter.check(ip);
    if (limit.blocked) {
      const retryAfterSeconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return sendJson(res, 429, { error: ERRORS.tooManyAttempts, retryAfterSeconds });
    }
    const body = await readBody(req, res);
    if (!body) return undefined;
    if (typeof body.password !== 'string') return sendJson(res, 400, { error: ERRORS.missingPassword, field: 'password' });
    if (!(await verifyPassword(body.password, state.record))) {
      limiter.recordFailure(ip);
      return sendJson(res, 401, { error: ERRORS.wrongPassword });
    }
    limiter.reset(ip);
    const store = await getSessions();
    const created = await store.create();
    setSessionCookie(req, res, created.token);
    sendJson(res, 200, { authenticated: true });
  }

  async function authLogout(req, res) {
    const session = await currentSession(req);
    if (session) await sessions.destroy(session.id);
    clearSessionCookie(req, res);
    sendEmpty(res, 204);
  }

  async function authChangePassword(req, res) {
    const session = await currentSession(req);
    if (!session) return sendJson(res, 401, { error: ERRORS.unauthenticated });
    const body = await readBody(req, res);
    if (!body) return undefined;
    const valid = validatePassword(body.newPassword);
    if (!valid.ok) return sendJson(res, 400, { error: valid.error, field: 'newPassword' });
    const record = authState.record;
    if (!(await verifyPassword(body.currentPassword, record))) {
      limiter.recordFailure(getClientIp(req, { trustProxy }));
      return sendJson(res, 403, { error: ERRORS.wrongCurrentPassword, field: 'currentPassword' });
    }
    const { salt, hash, params } = await hashPassword(body.newPassword);
    const next = { ...record, salt, hash, params, updatedAt: new Date(now()).toISOString() };
    await saveAuth(authFile, next);
    authState = { state: 'ok', record: next };
    await sessions.destroyOthers(session.id);
    sendEmpty(res, 204);
  }

  async function routeAuth(req, res, pathname) {
    const method = req.method;
    if (pathname === '/api/auth/status' && method === 'GET') return authStatus(req, res);
    if (pathname === '/api/auth/setup' && method === 'POST') return authSetup(req, res);
    if (pathname === '/api/auth/login' && method === 'POST') return authLogin(req, res);
    if (pathname === '/api/auth/logout' && method === 'POST') return authLogout(req, res);
    if (pathname === '/api/auth/change-password' && method === 'POST') return authChangePassword(req, res);
    return sendJson(res, 404, { error: ERRORS.notFound });
  }

  // ---------- Rutas de proyectos (fase 1, sin cambios) ----------

  async function listProjects(res) {
    const registry = await loadRegistry(projectsFile);
    const summaries = await Promise.all(registry.projects.map((p) => buildSummary(p, stateOptions())));
    sendJson(res, 200, summaries);
  }

  async function getProject(res, id) {
    const registry = await loadRegistry(projectsFile);
    const project = registry.projects.find((p) => p.id === id);
    if (!project) return sendJson(res, 404, { error: 'Proyecto no encontrado' });
    sendJson(res, 200, await buildDetail(project, stateOptions()));
  }

  async function createProject(req, res) {
    const body = await readBody(req, res);
    if (!body) return undefined;
    const registry = await loadRegistry(projectsFile);
    const result = await validateNewProject(body, registry.projects);
    if (!result.ok) return sendJson(res, result.status, { error: result.error, field: result.field });
    registry.projects.push(result.project);
    await saveRegistry(projectsFile, registry);
    sendJson(res, 201, result.project);
  }

  async function deleteProject(res, id) {
    const registry = await loadRegistry(projectsFile);
    const { removed, registry: next } = removeProject(registry, id);
    if (!removed) return sendJson(res, 404, { error: 'Proyecto no encontrado' });
    await saveRegistry(projectsFile, next);
    sendEmpty(res, 204);
  }

  async function routeApi(req, res, pathname) {
    const method = req.method;
    if (pathname === '/api/projects') {
      if (method === 'GET') return listProjects(res);
      if (method === 'POST') return createProject(req, res);
      return sendJson(res, 404, { error: ERRORS.notFound });
    }
    const match = PROJECT_ROUTE.exec(pathname);
    if (match) {
      let id;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        return sendJson(res, 404, { error: 'Proyecto no encontrado' });
      }
      if (method === 'GET') return getProject(res, id);
      if (method === 'DELETE') return deleteProject(res, id);
    }
    return sendJson(res, 404, { error: ERRORS.notFound });
  }

  // ---------- Middleware (design.md §4.2) ----------

  function hasCsrfHeader(req) {
    const value = req.headers['x-requested-with'];
    return String(Array.isArray(value) ? value[0] : value).trim().toLowerCase() === 'fetch';
  }

  async function handleApi(req, res, pathname) {
    if (MUTATING_METHODS.has(req.method) && !hasCsrfHeader(req)) return sendJson(res, 403, { error: ERRORS.csrf });
    if (pathname.startsWith(AUTH_PREFIX)) return routeAuth(req, res, pathname);
    const session = await currentSession(req);
    if (!session) return sendJson(res, 401, { error: ERRORS.unauthenticated });
    const { renewed } = await sessions.touch(session.id);
    if (renewed) setSessionCookie(req, res, sessionToken(req));
    return routeApi(req, res, pathname);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    if (pathname === '/api' || pathname.startsWith(API_PREFIX)) return handleApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 404, { error: ERRORS.notFound });
    return serveStatic(publicDir, pathname, res);
  }

  return http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((err) => {
        console.error('[panel] Error interno atendiendo', req.method, req.url, '-', err && err.stack ? err.stack : err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Error interno' });
        } else {
          res.end();
        }
      });
  });
}
