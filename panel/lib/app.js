// Servidor HTTP del panel: autenticación por contraseña, sesiones firmadas, defensa CSRF, API JSON y estáticos.
// Fase 3: catálogo fusionado con los proyectos de Claude Code (solo lectura de ~/.claude), ajustes por PATCH.
// Fase 4: rutas de trabajo (lib/work-api.js), Cloudflare Access, confirmación de contraseña y auditoría.
// Sin listen (lo hace server.js o los tests).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { loadRegistry, saveRegistry, validateNewProject, removeProject, validatePatch, upsertSettings, EXEC_FIELDS } from './registry.js';
import { createClaudeDiscovery, DEFAULT_TTL_MS } from './claude-discovery.js';
import { buildCatalog, findMerged, buildCatalogDetail, buildCatalogSummary } from './project-catalog.js';
import {
  sendJson,
  sendEmpty,
  sendText,
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
import { createWorkApi } from './work-api.js';
import { resolveClaudeCommand } from './claude-cli.js';
import { isTunnelRequest } from './reauth.js';
import { createAccessVerifier, ACCESS_HEADER } from './cf-access.js';
import { createAuditLog } from './audit.js';

const API_PREFIX = '/api/';
const AUTH_PREFIX = '/api/auth/';
const PROJECT_ROUTE = /^\/api\/projects\/([^/]+)$/;

/** Mutación = cualquier método distinto de GET y HEAD (fase 3, D10): exige la cabecera anti-CSRF. */
export function isMutation(req) {
  return req.method !== 'GET' && req.method !== 'HEAD';
}

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
  projectNotFound: 'Proyecto no encontrado',
  detectedByClaude: 'Este proyecto lo detecta Claude Code: no se puede eliminar, ocúltalo',
  unresolvedSettings: 'No se puede guardar ajustes de un proyecto sin ruta resuelta',
});

const ACCESS_ERRORS = Object.freeze({
  denied: 'Acceso denegado: falta o no es válida la identificación de Cloudflare Access',
  misconfigured: 'Cloudflare Access mal configurado en el panel',
});

/**
 * Crea la app HTTP.
 * @param {{ projectsFile: string, publicDir: string, dataDir: string, now?: () => number, runner?: Function,
 *           trustProxy?: boolean, secureCookies?: boolean, claudeHome?: string, claudeCacheTtlMs?: number,
 *           allowExec?: boolean, maxRuns?: number, runTimeoutMs?: number, claudeCommand?: object, bashBin?: string|null,
 *           cfAccess?: object|null, cfCertsUrl?: string, fetchImpl?: Function, platform?: string,
 *           outputLimitBytes?: number, keepRuns?: number, sseHeartbeatMs?: number, extraEnv?: object }} options
 */
export function createApp({
  projectsFile,
  publicDir,
  dataDir,
  now = () => Date.now(),
  runner,
  trustProxy = true,
  secureCookies = false,
  claudeHome = os.homedir(),
  claudeCacheTtlMs = DEFAULT_TTL_MS,
  allowExec = true,
  maxRuns = 2,
  runTimeoutMs = 30 * 60000,
  claudeCommand,
  bashBin = null,
  cfAccess = null,
  cfCertsUrl,
  fetchImpl,
  platform = process.platform,
  outputLimitBytes,
  keepRuns,
  sseHeartbeatMs = 15000,
  extraEnv = {},
} = {}) {
  if (!projectsFile) throw new Error('createApp: falta projectsFile');
  if (!publicDir) throw new Error('createApp: falta publicDir');
  if (!dataDir) throw new Error('createApp: falta dataDir');

  const authFile = path.join(dataDir, 'auth.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');
  const publicUrlFile = path.join(dataDir, 'public-url.txt');
  const cookieOptions = { trustProxy, secureCookies };
  const limiter = createRateLimiter({ now });
  const discovery = createClaudeDiscovery({ claudeHome, now, ttlMs: claudeCacheTtlMs });

  let authState = null; // { state: 'missing' | 'ok' | 'corrupt', record? }
  let authLoading = null;
  let sessions = null;

  const catalogOptions = () => (runner ? { now, runner } : { now });

  const accessConfigured = Boolean(cfAccess && !cfAccess.error && cfAccess.team && cfAccess.aud);
  const accessVerifier = accessConfigured
    ? createAccessVerifier({ team: cfAccess.team, aud: cfAccess.aud, now, ...(cfCertsUrl ? { certsUrl: cfCertsUrl } : {}), ...(fetchImpl ? { fetchImpl } : {}) })
    : null;
  const audit = createAuditLog({ file: path.join(dataDir, 'audit.log'), now });

  const workApi = createWorkApi({
    projectsFile,
    dataDir,
    now,
    runner,
    platform,
    claudeCommand: claudeCommand || resolveClaudeCommand('claude', { platform }),
    bashBin,
    allowExec,
    maxRuns,
    runTimeoutMs,
    outputLimitBytes,
    keepRuns,
    sseHeartbeatMs,
    trustProxy,
    accessConfigured,
    loadSources: () => loadSources(),
    listCatalog: async () => buildCatalog({ ...(await loadSources()), includeHidden: false, ...catalogOptions() }),
    extraEnv,
    audit,
  });

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

  /** Lee el cuerpo JSON (siempre un objeto plano, readJsonBody rechaza lo demás). Si ya respondió 400 devuelve null. */
  async function readBody(req, res) {
    try {
      return await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.error || 'Cuerpo JSON inválido' });
      return null;
    }
  }

  function sendTooManyAttempts(res, limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendJson(res, 429, { error: ERRORS.tooManyAttempts, retryAfterSeconds });
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
    const created = await sessions.create({ reauthAt: now() });
    setSessionCookie(req, res, created.token);
    sendJson(res, 201, { authenticated: true });
  }

  async function authLogin(req, res) {
    const state = await getAuthState();
    if (state.state === 'corrupt') return sendJson(res, 500, { error: ERRORS.corrupt });
    if (state.state !== 'ok') return sendJson(res, 409, { error: ERRORS.notConfigured });
    const ip = getClientIp(req, { trustProxy });
    const limit = limiter.check(ip);
    if (limit.blocked) return sendTooManyAttempts(res, limit);
    const body = await readBody(req, res);
    if (!body) return undefined;
    if (typeof body.password !== 'string') return sendJson(res, 400, { error: ERRORS.missingPassword, field: 'password' });
    if (!(await verifyPassword(body.password, state.record))) {
      limiter.recordFailure(ip);
      return sendJson(res, 401, { error: ERRORS.wrongPassword });
    }
    limiter.reset(ip);
    const store = await getSessions();
    const created = await store.create({ reauthAt: now() });
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
    const ip = getClientIp(req, { trustProxy });
    const limit = limiter.check(ip);
    if (limit.blocked) return sendTooManyAttempts(res, limit);
    const body = await readBody(req, res);
    if (!body) return undefined;
    const valid = validatePassword(body.newPassword);
    if (!valid.ok) return sendJson(res, 400, { error: valid.error, field: 'newPassword' });
    const record = authState.record;
    if (!(await verifyPassword(body.currentPassword, record))) {
      limiter.recordFailure(ip);
      return sendJson(res, 403, { error: ERRORS.wrongCurrentPassword, field: 'currentPassword' });
    }
    const { salt, hash, params } = await hashPassword(body.newPassword);
    const next = { ...record, salt, hash, params, updatedAt: new Date(now()).toISOString() };
    await saveAuth(authFile, next);
    authState = { state: 'ok', record: next };
    await sessions.destroyOthers(session.id);
    sendEmpty(res, 204);
  }

  /** Confirmación de la contraseña para las acciones por el túnel (F4-R68). No cierra ni renueva la sesión. */
  async function authReauth(req, res) {
    const session = await currentSession(req);
    if (!session) return sendJson(res, 401, { error: ERRORS.unauthenticated });
    const ip = getClientIp(req, { trustProxy });
    const entry = { ip, tunnel: isTunnelRequest(req), projectId: null, action: 'auth.reauth' };
    const limit = limiter.check(ip);
    if (limit.blocked) {
      await audit.write({ ...entry, result: 'rejected', status: 429 });
      return sendTooManyAttempts(res, limit);
    }
    const body = await readBody(req, res);
    if (!body) return undefined;
    if (typeof body.password !== 'string') return sendJson(res, 400, { error: ERRORS.missingPassword, field: 'password' });
    if (!(await verifyPassword(body.password, authState.record))) {
      limiter.recordFailure(ip);
      await audit.write({ ...entry, result: 'rejected', status: 401 });
      return sendJson(res, 401, { error: ERRORS.wrongPassword });
    }
    limiter.reset(ip);
    await sessions.markReauth(session.id);
    await audit.write({ ...entry, result: 'ok', status: 204 });
    return sendEmpty(res, 204);
  }

  async function routeAuth(req, res, pathname) {
    const method = req.method;
    if (pathname === '/api/auth/status' && method === 'GET') return authStatus(req, res);
    if (pathname === '/api/auth/setup' && method === 'POST') return authSetup(req, res);
    if (pathname === '/api/auth/login' && method === 'POST') return authLogin(req, res);
    if (pathname === '/api/auth/logout' && method === 'POST') return authLogout(req, res);
    if (pathname === '/api/auth/change-password' && method === 'POST') return authChangePassword(req, res);
    if (pathname === '/api/auth/reauth' && method === 'POST') return authReauth(req, res);
    return sendJson(res, 404, { error: ERRORS.notFound });
  }

  // ---------- Rutas de proyectos (fase 1 + catálogo de la fase 3) ----------

  /** Registro (capa de ajustes) y último escaneo de Claude Code (con caché y TTL). */
  async function loadSources() {
    const registry = await loadRegistry(projectsFile);
    const scan = await discovery.scan();
    return { registry, discovery: scan };
  }

  async function listProjects(res, { includeHidden }) {
    const sources = await loadSources();
    sendJson(res, 200, await buildCatalog({ ...sources, includeHidden, ...catalogOptions() }));
  }

  async function getProject(res, id) {
    const merged = findMerged(await loadSources(), id);
    if (!merged) return sendJson(res, 404, { error: ERRORS.projectNotFound });
    sendJson(res, 200, await buildCatalogDetail(merged, catalogOptions()));
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

  async function patchProject(req, res, id, session) {
    const body = await readBody(req, res);
    if (!body) return undefined;
    // Fase 4 (F4-R63): con allowedCommands/testCommand el PATCH es una acción de ejecución (puerta + auditoría).
    let ctx = null;
    if (workApi.isExecPatch(body)) {
      ctx = await workApi.gateExec(req, res, session, { projectId: id, action: 'settings.exec', detail: { fields: EXEC_FIELDS.filter((f) => body[f] !== undefined) } });
      if (!ctx) return undefined;
    }
    const reply = (status, payload) => (ctx ? ctx.respond(res, status, payload) : sendJson(res, status, payload));
    const sources = await loadSources();
    const merged = findMerged(sources, id);
    if (!merged) return reply(404, { error: ERRORS.projectNotFound });
    const valid = validatePatch(body);
    if (!valid.ok) return reply(valid.status, valid.field ? { error: valid.error, field: valid.field } : { error: valid.error });
    if (merged.unresolved || !merged.path) return reply(400, { error: ERRORS.unresolvedSettings });
    const entry = merged.settingsEntry ?? {
      id: merged.id,
      name: merged.name,
      path: merged.path,
      appUrl: '',
      repoUrl: '',
      tags: [],
      hidden: false,
      pinned: false,
    };
    const next = { ...entry, ...valid.changes };
    const registry = upsertSettings(sources.registry, next);
    await saveRegistry(projectsFile, registry);
    // Se recalcula la fusión con el registro nuevo (el proyecto pasa a "both" si era solo de Claude).
    const updated = findMerged({ registry, discovery: sources.discovery }, id);
    return reply(200, await buildCatalogSummary(updated, catalogOptions()));
  }

  async function deleteProject(res, id) {
    const sources = await loadSources();
    const merged = findMerged(sources, id);
    if (!merged) return sendJson(res, 404, { error: ERRORS.projectNotFound });
    if (merged.source !== 'manual') return sendJson(res, 409, { error: ERRORS.detectedByClaude });
    const { removed, registry: next } = removeProject(sources.registry, id);
    if (!removed) return sendJson(res, 404, { error: ERRORS.projectNotFound });
    await saveRegistry(projectsFile, next);
    sendEmpty(res, 204);
  }

  async function claudeStatus(res) {
    await discovery.scan();
    sendJson(res, 200, discovery.status());
  }

  async function routeApi(req, res, url, session) {
    const pathname = url.pathname;
    const method = req.method;
    if (pathname === '/api/claude/status' && method === 'GET') return claudeStatus(res);
    if (pathname === '/api/projects') {
      if (method === 'GET') return listProjects(res, { includeHidden: url.searchParams.get('includeHidden') === '1' });
      if (method === 'POST') return createProject(req, res);
      return sendJson(res, 404, { error: ERRORS.notFound });
    }
    const match = PROJECT_ROUTE.exec(pathname);
    if (match) {
      let id;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        return sendJson(res, 404, { error: ERRORS.projectNotFound });
      }
      if (method === 'GET') return getProject(res, id);
      if (method === 'PATCH') return patchProject(req, res, id, session);
      if (method === 'DELETE') return deleteProject(res, id);
    }
    return sendJson(res, 404, { error: ERRORS.notFound });
  }

  // ---------- Middleware (design.md §4.2) ----------

  function hasCsrfHeader(req) {
    const value = req.headers['x-requested-with'];
    return String(Array.isArray(value) ? value[0] : value).trim().toLowerCase() === 'fetch';
  }

  async function handleApi(req, res, url) {
    const pathname = url.pathname;
    if (isMutation(req) && !hasCsrfHeader(req)) return sendJson(res, 403, { error: ERRORS.csrf });
    if (pathname.startsWith(AUTH_PREFIX)) return routeAuth(req, res, pathname);
    const session = await currentSession(req);
    if (!session) return sendJson(res, 401, { error: ERRORS.unauthenticated });
    const { renewed } = await sessions.touch(session.id);
    if (renewed) setSessionCookie(req, res, sessionToken(req));
    if (await workApi.route(req, res, url, session)) return undefined;
    return routeApi(req, res, url, session);
  }

  /** Rechazo 403 en JSON para la API y en texto para el resto (estáticos). */
  function sendForbidden(res, pathname, message) {
    if (pathname === '/api' || pathname.startsWith(API_PREFIX)) return sendJson(res, 403, { error: message });
    return sendText(res, 403, message);
  }

  /**
   * Cloudflare Access (F4-R2, F4-R71): solo para peticiones por el túnel, antes de todo (estáticos incluidos).
   * Devuelve true si ya respondió con 403.
   */
  async function rejectByAccess(req, res, pathname) {
    if (!isTunnelRequest(req)) return false;
    if (cfAccess && cfAccess.error) {
      sendForbidden(res, pathname, ACCESS_ERRORS.misconfigured);
      return true;
    }
    if (!accessVerifier) return false;
    const raw = req.headers[ACCESS_HEADER];
    const result = await accessVerifier.verify(Array.isArray(raw) ? raw[0] : raw);
    if (result.ok) return false;
    sendForbidden(res, pathname, ACCESS_ERRORS.denied);
    return true;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    if (await rejectByAccess(req, res, pathname)) return undefined;
    if (pathname === '/api' || pathname.startsWith(API_PREFIX)) return handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 404, { error: ERRORS.notFound });
    return serveStatic(publicDir, pathname, res);
  }

  const server = http.createServer((req, res) => {
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

  // Al cerrar el servidor se cancelan los runs activos (y sus árboles de procesos) y se cierran los flujos SSE,
  // que de otro modo mantendrían abiertas sus conexiones e impedirían el cierre (F4-R33).
  const originalClose = server.close.bind(server);
  server.close = (callback) => {
    workApi.close();
    return originalClose(callback);
  };
  server.on('close', () => workApi.close());
  server.workApi = workApi;
  return server;
}
