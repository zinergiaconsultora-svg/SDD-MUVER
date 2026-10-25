// Tests de public/render.js, public/app-config.js y public/api-client.js — R28–R35, F2-R37–R39, F2-R41, F2-R42
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  relativeDate,
  STATUS_LABELS,
  renderProjectCard,
  renderProjectDetail,
  renderFormError,
  renderLoadError,
  buildProjectPayload,
  handleDelete,
  resolveAuthView,
  renderAuthForm,
  renderAuthError,
  validateNewPassword,
  renderChangePasswordForm,
  buildChangePasswordPayload,
  handleLogout,
  renderPublicUrl,
} from '../public/render.js';
import { REFRESH_INTERVAL_MS, API_BASE, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../public/app-config.js';
import { createApiClient } from '../public/api-client.js';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const FULL_PROJECT = {
  id: 'crm-zinergia',
  name: 'CRM Zinergia',
  appUrl: 'http://localhost:3000',
  repoUrl: 'https://github.com/zinergia/crm-zinergia',
  tags: ['crm'],
  exists: true,
  status: 'atencion',
  sdd: {
    present: true,
    error: null,
    counts: { pending: 3, spec_ready: 1, in_progress: 1, done: 5 },
    inProgress: { id: 8, slug: 'facturas', description: 'Emitir facturas' },
    awaitingApproval: [{ id: 7, slug: 'alta-cliente' }],
  },
  progress: { present: true, blocked: false, blockReason: null },
  git: {
    isRepo: true,
    branch: 'feature/facturas',
    lastCommit: { hash: 'a'.repeat(40), date: new Date(NOW - 3 * DAY).toISOString(), message: 'Añade validación de email' },
    dirtyCount: 2,
  },
};

test('[R28] renderProjectCard con proyecto completo', () => {
  const html = renderProjectCard(FULL_PROJECT, NOW);
  assert.ok(html.includes('class="card status-atencion"'), 'clase de semáforo en la tarjeta');
  assert.ok(html.includes('data-id="crm-zinergia"'));
  assert.ok(html.includes('CRM Zinergia'));
  assert.ok(html.includes('>Atención<'), 'texto de estado');
  assert.ok(html.includes('feature/facturas'), 'rama');
  assert.ok(html.includes('hace 3 días'), 'fecha relativa del último commit');
  assert.ok(html.includes('Añade validación de email'), 'mensaje del commit');
  assert.ok(html.includes('Esperando aprobación humana (1)'));
  assert.ok(html.includes('facturas'), 'feature en curso');
  assert.match(html, /<a[^>]*href="http:\/\/localhost:3000"[^>]*target="_blank"[^>]*rel="noopener"[^>]*>\s*Abrir app\s*<\/a>/);
  assert.match(html, /<a[^>]*href="https:\/\/github\.com\/zinergia\/crm-zinergia"[^>]*>[^<]*Repositorio[^<]*<\/a>/);
  assert.ok(html.includes('data-action="detail"'), 'botón Detalle');
  assert.ok(html.includes('data-action="delete"'), 'botón Eliminar');
  for (const n of [3, 1, 1, 5]) assert.ok(html.includes(`>${n}<`), `contador ${n}`);
});

test('[R28] STATUS_LABELS cubre los cinco estados en español', () => {
  assert.deepEqual(STATUS_LABELS, { atencion: 'Atención', en_curso: 'En curso', inactivo: 'Inactivo', ok: 'OK', no_encontrado: 'No encontrado' });
});

test('[R28] renderProjectCard escapa HTML de los datos', () => {
  const evil = { ...FULL_PROJECT, name: '<script>alert(1)</script>', git: { ...FULL_PROJECT.git, lastCommit: { ...FULL_PROJECT.git.lastCommit, message: 'a < b & c' } } };
  const html = renderProjectCard(evil, NOW);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &lt; b &amp; c'));
  assert.equal(escapeHtml(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;');
});

test('[R29] renderProjectCard sin arnés muestra "Sin arnés SDD" y sin contadores', () => {
  const p = { ...FULL_PROJECT, status: 'ok', sdd: { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [] } };
  const html = renderProjectCard(p, NOW);
  assert.ok(html.includes('Sin arnés SDD'));
  assert.ok(!html.includes('Esperando aprobación humana'));
  assert.ok(!html.includes('class="counts"'));
  assert.ok(html.includes('feature/facturas'), 'el git sigue mostrándose');
});

test('[R29] renderProjectCard sin git muestra "Sin repositorio git" y sin rama ni commit', () => {
  const p = { ...FULL_PROJECT, git: { isRepo: false, branch: null, lastCommit: null, dirtyCount: null } };
  const html = renderProjectCard(p, NOW);
  assert.ok(html.includes('Sin repositorio git'));
  assert.ok(!html.includes('feature/facturas'));
  assert.ok(!html.includes('Añade validación de email'));
  assert.ok(html.includes('Esperando aprobación humana (1)'), 'el arnés sigue mostrándose');
});

test('[R29] renderProjectCard inexistente muestra "Ruta no encontrada" y ningún dato de arnés ni git', () => {
  const p = {
    ...FULL_PROJECT,
    exists: false,
    status: 'no_encontrado',
    sdd: { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [] },
    progress: { present: false, blocked: false, blockReason: null },
    git: { isRepo: false, branch: null, lastCommit: null, dirtyCount: null },
  };
  const html = renderProjectCard(p, NOW);
  assert.ok(html.includes('Ruta no encontrada'));
  assert.ok(html.includes('status-no_encontrado'));
  assert.ok(html.includes('>No encontrado<'));
  assert.ok(!html.includes('Sin arnés SDD'));
  assert.ok(!html.includes('Sin repositorio git'));
  assert.ok(!html.includes('class="counts"'));
  assert.ok(!html.includes('Esperando aprobación humana'));
});

test('[R28] appUrl vacío → botón "Abrir app" con aria-disabled y sin href', () => {
  const html = renderProjectCard({ ...FULL_PROJECT, appUrl: '', repoUrl: '' }, NOW);
  assert.match(html, /<a[^>]*aria-disabled="true"[^>]*>\s*Abrir app\s*<\/a>/);
  const openApp = html.match(/<a[^>]*>\s*Abrir app\s*<\/a>/)[0];
  assert.ok(!openApp.includes('href='), 'sin href cuando no hay appUrl');
  assert.ok(!html.includes('Repositorio'), 'sin enlace al repo cuando repoUrl está vacío');
});

test('[R28] relativeDate en español', () => {
  assert.equal(relativeDate(new Date(NOW).toISOString(), NOW), 'hoy');
  assert.equal(relativeDate(new Date(NOW - DAY).toISOString(), NOW), 'ayer');
  assert.equal(relativeDate(new Date(NOW - 3 * DAY).toISOString(), NOW), 'hace 3 días');
  assert.equal(relativeDate(new Date(NOW - 40 * DAY).toISOString(), NOW), 'hace 1 mes');
  assert.equal(relativeDate('no es fecha', NOW), 'fecha desconocida');
});

const DETAIL = {
  ...FULL_PROJECT,
  sdd: {
    ...FULL_PROJECT.sdd,
    features: [
      { id: 7, slug: 'alta-cliente', description: 'Dar de alta clientes', status: 'spec_ready', sdd: true },
      { id: 8, slug: 'facturas', description: 'Emitir facturas', status: 'in_progress', sdd: true },
    ],
  },
  progress: { ...FULL_PROJECT.progress, text: '# Progreso actual\n\n- **Tarea actual:** T5' },
  git: {
    ...FULL_PROJECT.git,
    recentCommits: [
      { hash: 'b'.repeat(40), date: new Date(NOW - DAY).toISOString(), message: 'Commit reciente' },
      { hash: 'c'.repeat(40), date: new Date(NOW - 2 * DAY).toISOString(), message: 'Commit anterior' },
    ],
    dirtyFiles: ['src/app.js', 'README.md'],
  },
};

test('[R30] renderProjectDetail muestra features, progreso, commits, ficheros y botón Volver', () => {
  const html = renderProjectDetail(DETAIL, NOW);
  for (const f of DETAIL.sdd.features) {
    assert.ok(html.includes(`#${f.id}`), `id de feature ${f.id}`);
    assert.ok(html.includes(f.slug));
    assert.ok(html.includes(f.description));
    assert.ok(html.includes(`status-${f.status}`));
  }
  assert.ok(html.includes('**Tarea actual:** T5'), 'texto del progreso');
  assert.ok(html.includes('Commit reciente') && html.includes('Commit anterior'));
  assert.ok(html.includes('ayer'), 'fecha de commit');
  assert.ok(html.includes('src/app.js') && html.includes('README.md'));
  assert.match(html, /<button[^>]*data-action="back"[^>]*>\s*Volver\s*<\/button>/);
});

test('[R30] renderProjectDetail sin progress/current.md ni cambios', () => {
  const d = { ...DETAIL, progress: { present: false, blocked: false, blockReason: null, text: null }, git: { ...DETAIL.git, dirtyFiles: [] } };
  const html = renderProjectDetail(d, NOW);
  assert.ok(html.includes('Sin progress/current.md'));
  assert.ok(html.includes('Sin cambios sin commitear'));
});

test('[R31] buildProjectPayload convierte etiquetas y omite vacíos', () => {
  const payload = buildProjectPayload({ name: '  Mi Proyecto ', path: ' C:\\Users\\Usuario\\mi ', appUrl: '', repoUrl: '  ', tags: 'a, b,,  c ' });
  assert.deepEqual(payload, { name: 'Mi Proyecto', path: 'C:\\Users\\Usuario\\mi', tags: ['a', 'b', 'c'] });
  assert.deepEqual(buildProjectPayload({ name: 'X', path: '/x', appUrl: 'http://a', repoUrl: 'http://b', tags: '' }), { name: 'X', path: '/x', appUrl: 'http://a', repoUrl: 'http://b' });
});

test('[R32] renderFormError devuelve el texto con role="alert"', () => {
  const html = renderFormError({ error: 'La ruta no existe o no es un directorio', field: 'path' });
  assert.match(html, /role="alert"/);
  assert.ok(html.includes('La ruta no existe o no es un directorio'));
  assert.ok(html.includes('data-field="path"'));
  assert.ok(renderFormError({}).includes('No se pudo añadir el proyecto'));
});

test('[R33] handleDelete no llama a request si se cancela', async () => {
  let called = 0;
  const result = await handleDelete('crm-zinergia', { confirm: () => false, request: async () => { called++; } });
  assert.equal(result, false);
  assert.equal(called, 0);
});

test('[R33] handleDelete llama a DELETE /api/projects/:id al confirmar', async () => {
  const calls = [];
  let confirmMessage = '';
  const result = await handleDelete('crm zinergia/ñ', {
    confirm: (msg) => { confirmMessage = msg; return true; },
    request: async (url, init) => { calls.push({ url, init }); },
  });
  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/projects/' + encodeURIComponent('crm zinergia/ñ'));
  assert.equal(calls[0].init.method, 'DELETE');
  assert.ok(confirmMessage.includes('No se borra nada del disco'));
});

test('[R34] renderLoadError muestra el mensaje y un botón Reintentar', () => {
  const html = renderLoadError();
  assert.ok(html.includes('No se pudo cargar el estado de los proyectos'));
  assert.match(html, /<button[^>]*data-action="retry"[^>]*>\s*Reintentar\s*<\/button>/);
  assert.match(html, /role="alert"/);
});

test('[R35] REFRESH_INTERVAL_MS es 60000 y API_BASE apunta a /api', () => {
  assert.equal(REFRESH_INTERVAL_MS, 60000);
  assert.equal(API_BASE, '/api');
});

// ---------- Fase 2: autenticación en la interfaz ----------

test('[F2-R37] resolveAuthView → setup / login / panel', () => {
  assert.equal(resolveAuthView({ configured: false, authenticated: false }), 'setup');
  assert.equal(resolveAuthView({ configured: true, authenticated: false }), 'login');
  assert.equal(resolveAuthView({ configured: true, authenticated: true }), 'panel');
  assert.equal(resolveAuthView({}), 'setup');
});

test('[F2-R37] renderAuthForm("setup") tiene título, data-mode, password + confirm y botón "Crear contraseña"', () => {
  const html = renderAuthForm('setup');
  assert.ok(html.includes('id="auth-form"'));
  assert.ok(html.includes('data-mode="setup"'));
  assert.match(html, /<h2[^>]*>\s*Crear contraseña\s*<\/h2>/);
  assert.match(html, /<input[^>]*type="password"[^>]*name="password"[^>]*>/);
  assert.match(html, /<input[^>]*type="password"[^>]*name="confirm"[^>]*>/);
  assert.ok(html.includes('autocomplete="new-password"'));
  assert.ok(html.includes('minlength="10"'));
  assert.ok(html.includes('id="auth-error"'));
  assert.match(html, /<button[^>]*type="submit"[^>]*class="btn primary"[^>]*>\s*Crear contraseña\s*<\/button>/);
  assert.ok(/contraseña única/i.test(html), 'explica que es la contraseña única del panel');
});

test('[F2-R37] renderAuthForm("login") tiene título "Iniciar sesión", solo password y botón "Entrar"', () => {
  const html = renderAuthForm('login');
  assert.ok(html.includes('data-mode="login"'));
  assert.match(html, /<h2[^>]*>\s*Iniciar sesión\s*<\/h2>/);
  assert.match(html, /<input[^>]*name="password"[^>]*>/);
  assert.ok(!html.includes('name="confirm"'), 'sin confirmación en login');
  assert.ok(html.includes('autocomplete="current-password"'));
  assert.match(html, /<button[^>]*type="submit"[^>]*>\s*Entrar\s*<\/button>/);
  assert.ok(!html.includes('Crear contraseña'));
});

test('[F2-R38][F2-R40] renderAuthError devuelve el mensaje escapado con role="alert"', () => {
  const html = renderAuthError('Contraseña <incorrecta>');
  assert.match(html, /<p class="form-error" role="alert">Contraseña &lt;incorrecta&gt;<\/p>/);
  assert.ok(renderAuthError('').includes('role="alert"'));
});

test('[F2-R38] validateNewPassword: corta, distinta y válida', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.equal(MAX_PASSWORD_LENGTH, 128);
  assert.deepEqual(validateNewPassword('corta', 'corta'), { ok: false, error: 'La contraseña debe tener al menos 10 caracteres' });
  assert.deepEqual(validateNewPassword('contraseña-larga', 'contraseña-larga2'), { ok: false, error: 'Las contraseñas no coinciden' });
  assert.deepEqual(validateNewPassword('contraseña-larga', 'contraseña-larga'), { ok: true });
  assert.equal(validateNewPassword('x'.repeat(129), 'x'.repeat(129)).ok, false, 'más de 128 tampoco vale');
  assert.equal(validateNewPassword(undefined, undefined).ok, false);
});

test('[F2-R41] renderChangePasswordForm tiene currentPassword, newPassword, confirm, "Guardar contraseña" y "Cancelar"', () => {
  const html = renderChangePasswordForm();
  assert.ok(html.includes('id="change-password-form"'));
  for (const name of ['currentPassword', 'newPassword', 'confirm']) {
    assert.match(html, new RegExp(`<input[^>]*type="password"[^>]*name="${name}"[^>]*>`), name);
  }
  assert.match(html, /<button[^>]*type="submit"[^>]*>\s*Guardar contraseña\s*<\/button>/);
  assert.match(html, /<button[^>]*data-action="cancel-change"[^>]*>\s*Cancelar\s*<\/button>/);
  assert.ok(html.includes('id="change-password-error"'));
});

test('[F2-R41] buildChangePasswordPayload omite confirm', () => {
  assert.deepEqual(buildChangePasswordPayload({ currentPassword: 'vieja-contraseña', newPassword: 'nueva-contraseña', confirm: 'nueva-contraseña' }), {
    currentPassword: 'vieja-contraseña',
    newPassword: 'nueva-contraseña',
  });
  assert.deepEqual(buildChangePasswordPayload({}), { currentPassword: '', newPassword: '' });
});

test('[F2-R41] handleLogout llama a POST /api/auth/logout y devuelve true', async () => {
  const calls = [];
  const result = await handleLogout({ request: async (url, init) => { calls.push({ url, init }); return null; } });
  assert.equal(result, true);
  assert.deepEqual(calls, [{ url: '/api/auth/logout', init: { method: 'POST' } }]);
});

test('[F2-R42] renderPublicUrl con URL → enlace escapado; con null → cadena vacía', () => {
  const html = renderPublicUrl('https://abc.trycloudflare.com/?a=1&b="x"');
  assert.match(html, /<a class="public-url" href="https:\/\/abc\.trycloudflare\.com\/\?a=1&amp;b=&quot;x&quot;" target="_blank" rel="noopener">/);
  assert.ok(html.includes('URL pública: https://abc.trycloudflare.com/?a=1&amp;b=&quot;x&quot;</a>'));
  assert.equal(renderPublicUrl(null), '');
  assert.equal(renderPublicUrl(''), '');
  assert.equal(renderPublicUrl(undefined), '');
});

// ---------- public/api-client.js (F2-R39) ----------

function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const spec = typeof responses === 'function' ? responses(url, init) : responses;
    const body = spec.body === undefined ? '' : (typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body));
    return { ok: spec.status >= 200 && spec.status < 300, status: spec.status, text: async () => body };
  };
  return { fetch, calls };
}

test('[F2-R39] createApiClient envía X-Requested-With: fetch, Accept, credentials same-origin y Content-Type solo con body', async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: [] });
  const request = createApiClient({ fetch });
  const data = await request('/api/projects');
  assert.deepEqual(data, []);
  assert.equal(calls[0].url, '/api/projects');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.headers['X-Requested-With'], 'fetch');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.equal('Content-Type' in calls[0].init.headers, false);

  await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) });
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[1].init.headers['X-Requested-With'], 'fetch');
  assert.equal(calls[1].init.credentials, 'same-origin');
});

test('[F2-R39] 401 en /api/projects invoca onUnauthorized una vez y rechaza con status 401', async () => {
  const { fetch } = fakeFetch({ status: 401, body: { error: 'No autenticado' } });
  let unauthorized = 0;
  const request = createApiClient({ fetch, onUnauthorized: () => { unauthorized++; } });
  await assert.rejects(request('/api/projects'), (err) => {
    assert.equal(err.status, 401);
    assert.deepEqual(err.payload, { error: 'No autenticado' });
    assert.equal(err.message, 'No autenticado');
    return true;
  });
  assert.equal(unauthorized, 1);
});

test('[F2-R39] 401 en /api/auth/login NO invoca onUnauthorized pero sí rechaza con status 401', async () => {
  const { fetch } = fakeFetch({ status: 401, body: { error: 'Contraseña incorrecta' } });
  let unauthorized = 0;
  const request = createApiClient({ fetch, onUnauthorized: () => { unauthorized++; } });
  await assert.rejects(request('/api/auth/login', { method: 'POST', body: '{}' }), (err) => err.status === 401 && err.payload.error === 'Contraseña incorrecta');
  assert.equal(unauthorized, 0);
});

test('[F2-R39] 204 → null; 4xx → error con payload; cuerpo no JSON → payload con mensaje genérico', async () => {
  const noContent = createApiClient({ fetch: fakeFetch({ status: 204 }).fetch });
  assert.equal(await noContent('/api/auth/logout', { method: 'POST' }), null);

  const bad = createApiClient({ fetch: fakeFetch({ status: 400, body: { error: 'Falta la contraseña', field: 'password' } }).fetch });
  await assert.rejects(bad('/api/auth/login', { method: 'POST', body: '{}' }), (err) => {
    assert.equal(err.status, 400);
    assert.deepEqual(err.payload, { error: 'Falta la contraseña', field: 'password' });
    return true;
  });

  const broken = createApiClient({ fetch: fakeFetch({ status: 502, body: '<html>bad gateway</html>' }).fetch });
  await assert.rejects(broken('/api/projects'), (err) => err.status === 502 && typeof err.payload.error === 'string');
});
