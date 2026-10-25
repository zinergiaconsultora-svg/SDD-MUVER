// Servidor HTTP del panel: enrutado de la API JSON y servicio de estáticos. Sin listen (lo hace server.js o los tests).
import http from 'node:http';

import { loadRegistry, saveRegistry, validateNewProject, removeProject } from './registry.js';
import { buildSummary, buildDetail } from './project-state.js';
import { sendJson, sendEmpty, readJsonBody, serveStatic } from './http-utils.js';

const API_PREFIX = '/api/';
const PROJECT_ROUTE = /^\/api\/projects\/([^/]+)$/;

/**
 * Crea la app HTTP.
 * @param {{ projectsFile: string, publicDir: string, now?: () => number, runner?: Function }} options
 */
export function createApp({ projectsFile, publicDir, now = () => Date.now(), runner } = {}) {
  if (!projectsFile) throw new Error('createApp: falta projectsFile');
  if (!publicDir) throw new Error('createApp: falta publicDir');

  const stateOptions = () => (runner ? { now, runner } : { now });

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
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.error || 'Cuerpo JSON inválido' });
    }
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
      return sendJson(res, 404, { error: 'Ruta no encontrada' });
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
    return sendJson(res, 404, { error: 'Ruta no encontrada' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    if (pathname === '/api' || pathname.startsWith(API_PREFIX)) return routeApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 404, { error: 'Ruta no encontrada' });
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
