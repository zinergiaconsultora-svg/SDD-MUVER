// Tests de public/work.js (funciones puras de la vista "Trabajar") y del cambio de public/api-client.js —
// F4: R80–R89.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATE_LABELS,
  renderWorkView,
  renderSessionSelect,
  describeAction,
  renderConfirmDialogBody,
  renderRunEvent,
  renderRunLog,
  renderRunList,
  renderPermissionPrompt,
  buildRetryPayload,
  renderChanges,
  renderDiff,
  renderAttention,
  suggestCommitMessage,
  buildRunPayload,
  buildExecSettingsPayload,
  isReauthError,
  withReauth,
} from '../public/work.js';
import { createApiClient } from '../public/api-client.js';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const MIN = 60 * 1000;

function work(extra = {}) {
  return {
    projectId: 'app-flyder',
    executable: true,
    execEnabled: true,
    hasSdd: true,
    isRepo: true,
    specReady: [{ id: 4, slug: 'puesto-de-mando-trabajar' }],
    inProgress: null,
    allowedCommands: ['npm test'],
    testCommand: '',
    effectiveTestCommand: 'bash init.sh',
    testCommandError: null,
    defaultTools: [],
    activeRun: null,
    sessions: [{ id: 's-1', title: 'Sesión <b>uno</b>', lastActivityAt: '2026-10-25T11:00:00Z' }],
    ...extra,
  };
}

const has = (html, action) => html.includes(`data-action="${action}"`);
const EXEC_ACTIONS = ['implement', 'approve-tests', 'approve-spec', 'run-tests', 'commit-push'];

// ---------- R80, R81 ----------

test('[F4-R80] renderWorkView completo: caja de mensaje, selector de sesión y todos los botones', () => {
  const html = renderWorkView(work(), { runs: [], now: NOW });
  assert.ok(html.includes('<textarea') && html.includes('name="prompt"') && html.includes('maxlength="20000"'));
  assert.ok(html.includes('Nueva conversación'));
  assert.ok(html.includes('Continuar la última sesión'));
  assert.ok(html.includes('Sesión &lt;b&gt;uno&lt;/b&gt;'), 'títulos de sesión escapados');
  for (const action of [...EXEC_ACTIONS, 'show-changes']) assert.ok(has(html, action), action);
  assert.ok(html.includes('Implementar siguiente tarea'));
  assert.ok(html.includes('Aprobar tests'));
  assert.ok(html.includes('Aprobar spec'));
  assert.ok(html.includes('Ver cambios'));
  assert.ok(html.includes('Commit y push'));
  assert.ok(html.includes('Ejecutar tests'));
  assert.ok(html.includes('class="work-actions"'));
  assert.ok(html.includes('class="run-log"'));
  assert.ok(html.includes('Sin ejecuciones todavía'));
  assert.ok(html.includes('id="exec-settings-form"'));
});

test('[F4-R80] renderWorkView: cada botón depende de hasSdd, specReady, isRepo y effectiveTestCommand', () => {
  const noSdd = renderWorkView(work({ hasSdd: false, specReady: [] }), { runs: [], now: NOW });
  assert.ok(!has(noSdd, 'implement') && !has(noSdd, 'approve-tests') && !has(noSdd, 'approve-spec'));
  assert.ok(has(noSdd, 'commit-push') && has(noSdd, 'run-tests'));
  const noSpec = renderWorkView(work({ specReady: [] }), { runs: [], now: NOW });
  assert.ok(has(noSpec, 'implement') && has(noSpec, 'approve-tests') && !has(noSpec, 'approve-spec'));
  const noRepo = renderWorkView(work({ isRepo: false }), { runs: [], now: NOW });
  assert.ok(!has(noRepo, 'show-changes') && !has(noRepo, 'commit-push'));
  const noTests = renderWorkView(work({ effectiveTestCommand: null, testCommandError: 'Configura el comando de tests' }), { runs: [], now: NOW });
  assert.ok(!has(noTests, 'run-tests'));
  const twoSpecs = renderWorkView(work({ specReady: [{ id: 4, slug: 'a' }, { id: 5, slug: 'b' }] }), { runs: [], now: NOW });
  assert.equal(twoSpecs.split('data-action="approve-spec"').length - 1, 2);
  assert.ok(twoSpecs.includes('data-feature-id="5"'));
});

test('[F4-R81] renderWorkView en solo lectura (ejecución desactivada o sin carpeta): aviso, sin caja ni acciones, con historial y Ver cambios', () => {
  const runs = [{ runId: 'r1-00000001', label: 'Chat', state: 'succeeded', startedAt: '2026-10-25T11:58:00Z', durationMs: 1500, costUsd: 0.01 }];
  const disabled = renderWorkView(work({ execEnabled: false }), { runs, now: NOW });
  assert.ok(disabled.includes('<p class="notice">Las acciones de ejecución están desactivadas en este panel (PANEL_ALLOW_EXEC=0).</p>'));
  const noDir = renderWorkView(work({ executable: false, hasSdd: false, isRepo: false, effectiveTestCommand: null }), { runs, now: NOW });
  assert.ok(noDir.includes('<p class="notice">Este proyecto no tiene una carpeta accesible en este PC: no se puede trabajar en él desde el panel.</p>'));
  for (const html of [disabled, noDir]) {
    assert.ok(!html.includes('<textarea'), 'sin caja de mensaje');
    for (const action of EXEC_ACTIONS) assert.ok(!has(html, action), action);
    assert.ok(!html.includes('id="exec-settings-form"'));
    assert.ok(has(html, 'open-run'), 'historial');
  }
  assert.ok(has(disabled, 'show-changes'), 'Ver cambios se mantiene');
});

test('[F4-R80] renderSessionSelect y buildRunPayload', () => {
  const html = renderSessionSelect([{ id: 's-1', title: 'Uno' }]);
  assert.ok(html.includes('<option value="new"'));
  assert.ok(html.includes('<option value="continue"'));
  assert.ok(html.includes('<option value="resume:s-1"'));
  assert.ok(html.includes('Retomar «Uno»'));
  assert.deepEqual(buildRunPayload({ prompt: 'hola', session: 'new' }), { prompt: 'hola', session: { mode: 'new' } });
  assert.deepEqual(buildRunPayload({ prompt: 'hola', session: 'continue' }), { prompt: 'hola', session: { mode: 'continue' } });
  assert.deepEqual(buildRunPayload({ prompt: 'hola', session: 'resume:s-1' }), { prompt: 'hola', session: { mode: 'resume', id: 's-1' } });
  assert.deepEqual(buildRunPayload({ prompt: 'hola' }), { prompt: 'hola', session: { mode: 'new' } });
  assert.deepEqual(buildExecSettingsPayload({ allowedCommands: ' npm test \n\n npm run build\r\n', testCommand: '  npm test ' }), { allowedCommands: ['npm test', 'npm run build'], testCommand: 'npm test' });
  assert.deepEqual(buildExecSettingsPayload({}), { allowedCommands: [], testCommand: '' });
});

// ---------- R82: describeAction (§6.3) ----------

test('[F4-R82] describeAction: textos exactos de cada acción con escapado', () => {
  const ctx = { projectName: 'App <Flyder>', allowedCommands: [] };
  assert.equal(
    describeAction('chat', { ...ctx, prompt: 'Añade <b>validación</b>', session: { mode: 'new' } }),
    'Se lanzará Claude Code en App &lt;Flyder&gt; con el mensaje: «Añade &lt;b&gt;validación&lt;/b&gt;». Sesión: Nueva conversación. Claude puede editar ficheros y ejecutar solo: git status, git diff y git log.',
  );
  assert.equal(
    describeAction('chat', { projectName: 'A', allowedCommands: ['npm test', 'npm run build'], prompt: 'x'.repeat(400), session: { mode: 'continue' } }),
    `Se lanzará Claude Code en A con el mensaje: «${'x'.repeat(300)}…». Sesión: Continuar la última sesión. Claude puede editar ficheros y ejecutar solo: git status, git diff, git log, npm test y npm run build.`,
  );
  assert.ok(describeAction('chat', { projectName: 'A', prompt: 'p', session: { mode: 'resume', id: 's-1', title: 'Título <x>' } }).includes('Sesión: Retomar «Título &lt;x&gt;».'));
  assert.equal(describeAction('implement', { projectName: 'A', allowedCommands: ['npm test'] }), 'Se lanzará Claude Code en A con «implementa la siguiente tarea pendiente» (nueva conversación). Claude puede editar ficheros y ejecutar solo: git status, git diff, git log y npm test.');
  assert.equal(describeAction('approve-tests', { projectName: 'A' }), 'Se lanzará Claude Code en A con «tests aprobados, lanza al reviewer» continuando la última sesión. Claude puede editar ficheros y ejecutar solo: git status, git diff y git log.');
  assert.equal(describeAction('approve-spec', { projectName: 'A', featureId: 4, featureSlug: 'puesto-de-mando-trabajar' }), 'Se cambiará la feature #4 puesto-de-mando-trabajar de spec_ready a in_progress en feature_list.json de A. Después podrás lanzar «Implementar siguiente tarea».');
  assert.equal(describeAction('tests', { projectName: 'A', effectiveTestCommand: 'node "x y.js" & <z>' }), 'Se ejecutará en A: node &quot;x y.js&quot; &amp; &lt;z&gt;');
  assert.equal(describeAction('commit-push', { projectName: 'A', message: 'Avance <1>', branch: 'main' }), 'Se ejecutará en A: git add -A → git commit -m «Avance &lt;1&gt;» → git push (rama main). Nunca se fuerza el push.');
  assert.equal(describeAction('allow-command', { projectName: 'A', command: 'npm run lint' }), 'Se autorizará «npm run lint» en A para Claude y se reintentará la ejecución.');
  assert.equal(describeAction('exec-settings', { projectName: 'A', count: 3 }), 'Se guardarán los comandos autorizados (3) y el comando de tests de A.');
  assert.equal(renderConfirmDialogBody('Texto &lt;ya escapado&gt;'), '<p class="confirm-text">Texto &lt;ya escapado&gt;</p>');
});

// ---------- R83: renderRunEvent ----------

test('[F4-R83] renderRunEvent pinta cada tipo de evento escapando el texto', () => {
  const x = '<script>alert(1)</script>';
  const cases = [
    [{ type: 'prompt', text: x }, 'ev-prompt'],
    [{ type: 'state', state: 'running' }, 'En marcha'],
    [{ type: 'session', sessionId: x, model: 'm' }, 'ev-notice'],
    [{ type: 'text', text: x }, 'ev-text'],
    [{ type: 'tool', name: x, summary: x }, 'ev-tool'],
    [{ type: 'tool_error', preview: x }, 'ev-error'],
    [{ type: 'permission_denied', tool: x, detail: x, suggestion: null }, 'ev-error'],
    [{ type: 'step', index: 1, total: 3, command: x }, 'Paso 1/3'],
    [{ type: 'output', stream: 'stderr', text: x }, 'ev-output'],
    [{ type: 'notice', message: x }, 'ev-notice'],
    [{ type: 'error', message: x }, 'ev-error'],
    [{ type: 'end', state: 'needs_permission', exitCode: 0, durationMs: 1500 }, 'Necesita permiso'],
  ];
  for (const [event, needle] of cases) {
    const html = renderRunEvent(event);
    assert.ok(html.includes(needle), `${event.type}: ${html}`);
    assert.ok(!html.includes('<script>'), `${event.type} sin escapar`);
  }
  assert.ok(renderRunEvent({ type: 'output', stream: 'stderr', text: 'e' }).includes('stderr'));
  const tool = renderRunEvent({ type: 'tool', name: 'Edit', summary: 'src/a.js' });
  assert.ok(tool.includes('Edit') && tool.includes('src/a.js'));
  const result = renderRunEvent({ type: 'result', ok: true, text: x, costUsd: 0.0123, durationMs: 1500, numTurns: 3 });
  assert.ok(result.includes('ev-result'));
  assert.ok(result.includes('0,0123'), result);
  assert.ok(result.includes('1,5 s'), result);
  assert.ok(!result.includes('<script>'));
  assert.equal(renderRunEvent({ type: 'desconocido' }), '');
  assert.equal(renderRunEvent(null), '');
});

test('[F4-R83] renderRunLog pinta como mucho los últimos 2000 eventos y avisa', () => {
  const events = Array.from({ length: 2005 }, (_, i) => ({ seq: i + 1, type: 'text', text: `t${i + 1}` }));
  const html = renderRunLog(events);
  assert.ok(html.includes('Se muestran los últimos 2000 eventos'));
  assert.ok(!html.includes('>t5<'));
  assert.ok(html.includes('t2005'));
  assert.equal(renderRunLog([]), '');
});

// ---------- R84: permisos ----------

test('[F4-R84] renderPermissionPrompt con y sin sugerencia, y buildRetryPayload', () => {
  const run = { runId: 'r1', state: 'needs_permission', claudeSessionId: 'ses-9', permissionDenials: [
    { tool: 'Bash', detail: 'npm run lint -- --fix', suggestion: 'npm run lint' },
    { tool: 'WebFetch', detail: 'https://<x>', suggestion: null },
  ] };
  const html = renderPermissionPrompt(run);
  assert.ok(html.includes('Claude necesita permiso para: Bash: npm run lint -- --fix'));
  assert.ok(html.includes('Claude necesita permiso para: WebFetch: https://&lt;x&gt;'));
  assert.equal(html.split('data-action="allow-command"').length - 1, 1, 'un botón solo para la denegación con sugerencia');
  assert.ok(html.includes('data-command="npm run lint"'));
  assert.ok(html.includes('Permitir en este proyecto y reintentar'));
  assert.equal(renderPermissionPrompt({ state: 'succeeded', permissionDenials: [] }), '');
  assert.deepEqual(buildRetryPayload(run, 'lanza el linter'), { prompt: 'lanza el linter', session: { mode: 'resume', id: 'ses-9' } });
  assert.deepEqual(buildRetryPayload({ claudeSessionId: null }, 'otra vez'), { prompt: 'otra vez', session: { mode: 'continue' } });
});

// ---------- R85: diff y cambios ----------

test('[F4-R85] renderDiff marca add/del/hunk/meta, escapa y avisa del recorte', () => {
  const diff = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-<b>antes</b>\n+después\n contexto';
  const html = renderDiff({ diff, truncated: true, untracked: false });
  assert.ok(html.includes('class="diff"'));
  assert.ok(html.includes('<span class="add">+después</span>'));
  assert.ok(html.includes('<span class="del">-&lt;b&gt;antes&lt;/b&gt;</span>'));
  assert.ok(html.includes('<span class="hunk">@@ -1 +1 @@</span>'));
  for (const meta of ['diff --git a/x b/x', 'index 1..2 100644', '--- a/x', '+++ b/x']) assert.ok(html.includes(`<span class="meta">${meta}</span>`), meta);
  assert.ok(html.includes('Diff recortado a 200 KB'));
  assert.ok(!renderDiff({ diff, truncated: false }).includes('Diff recortado'));
  assert.ok(renderDiff({ diff: null, untracked: true }).includes('sin seguimiento'));
});

test('[F4-R55] renderChanges lista los ficheros con su estado y botón de diff', () => {
  const html = renderChanges({ branch: 'main', files: [{ path: 'src/<a>.js', status: ' M' }, { path: 'nuevo.txt', status: '??' }], stat: ' 1 file changed', truncated: true });
  assert.ok(html.includes('src/&lt;a&gt;.js'));
  assert.ok(html.includes('data-action="show-diff"'));
  assert.ok(html.includes('data-file="nuevo.txt"'));
  assert.ok(html.includes('más de 500'));
  assert.ok(renderChanges({ branch: 'main', files: [], stat: '', truncated: false }).includes('Sin cambios'));
});

// ---------- R86: reconfirmación de contraseña ----------

function fakeFetch(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
}

test('[F4-R86] createApiClient: un 401 con reauthRequired no llama a onUnauthorized y el error lleva payload.reauthRequired', async () => {
  let unauthorized = 0;
  const request = createApiClient({ fetch: fakeFetch(401, { error: 'Confirma tu contraseña para continuar', reauthRequired: true }), onUnauthorized: () => { unauthorized++; } });
  await assert.rejects(request('/api/projects/x/runs', { method: 'POST', body: '{}' }), (err) => {
    assert.equal(err.status, 401);
    assert.equal(err.payload.reauthRequired, true);
    assert.equal(isReauthError(err), true);
    return true;
  });
  assert.equal(unauthorized, 0);
  const plain = createApiClient({ fetch: fakeFetch(401, { error: 'No autenticado' }), onUnauthorized: () => { unauthorized++; } });
  await assert.rejects(plain('/api/projects'), (err) => !isReauthError(err));
  assert.equal(unauthorized, 1, 'un 401 normal sigue cerrando la sesión');
  assert.equal(isReauthError(null), false);
  // Contraseña incorrecta en el diálogo de confirmación: 401 sin reauthRequired, pero NO cierra la sesión.
  const wrong = createApiClient({ fetch: fakeFetch(401, { error: 'Contraseña incorrecta' }), onUnauthorized: () => { unauthorized++; } });
  await assert.rejects(wrong('/api/auth/reauth', { method: 'POST', body: '{}' }), (err) => err.status === 401 && err.payload.error === 'Contraseña incorrecta');
  assert.equal(unauthorized, 1, 'el 401 de /api/auth/reauth no llama a onUnauthorized');
});

test('[F4-R86] withReauth: repite la acción una vez tras un reauth correcto; nada si se cancela', async () => {
  const reauthError = Object.assign(new Error('Confirma'), { status: 401, payload: { reauthRequired: true } });
  let calls = 0;
  const action = async () => {
    calls += 1;
    if (calls === 1) throw reauthError;
    return 'hecho';
  };
  const passwords = [];
  const result = await withReauth(action, { askPassword: async () => 'contraseña-buena', reauth: async (p) => { passwords.push(p); } });
  assert.equal(result, 'hecho');
  assert.equal(calls, 2);
  assert.deepEqual(passwords, ['contraseña-buena']);

  let cancelledCalls = 0;
  const cancelled = await withReauth(async () => { cancelledCalls += 1; throw reauthError; }, { askPassword: async () => null, reauth: async () => { throw new Error('no debe llamarse'); } });
  assert.equal(cancelled, null);
  assert.equal(cancelledCalls, 1);

  // Contraseña incorrecta: se vuelve a pedir con el mensaje de error y, al acertar, se repite una sola vez.
  const asked = [];
  let attempts = 0;
  let runs = 0;
  const value = await withReauth(async () => { runs += 1; if (runs === 1) throw reauthError; return runs; }, {
    askPassword: async (message) => { asked.push(message); return asked.length === 1 ? 'mala' : 'buena'; },
    reauth: async (p) => { attempts += 1; if (p === 'mala') throw Object.assign(new Error('Contraseña incorrecta'), { status: 401, payload: { error: 'Contraseña incorrecta' } }); },
  });
  assert.equal(value, 2);
  assert.deepEqual(asked, [null, 'Contraseña incorrecta']);
  assert.equal(attempts, 2);

  await assert.rejects(withReauth(async () => { throw new Error('otro error'); }, { askPassword: async () => 'x', reauth: async () => {} }), /otro error/);
});

// ---------- R87: Te necesitan ----------

test('[F4-R87] renderAttention con proyectos y runs; vacío → cadena vacía', () => {
  const html = renderAttention({
    projects: [
      { id: 'crm', name: 'CRM <z>', reason: 'spec_ready', features: [{ id: 2, slug: 'alta-clientes' }], blockReason: null },
      { id: 'web', name: 'Web', reason: 'bloqueo', features: [], blockReason: 'Esperando <credenciales>' },
    ],
    runs: [{ runId: 'r1-00000001', projectId: 'app', projectName: 'App', label: 'Chat', state: 'needs_permission', endedAt: new Date(NOW - 5 * MIN).toISOString(), permissionDenials: [] }],
  }, NOW);
  assert.ok(html.includes('Te necesitan'));
  assert.ok(html.includes('CRM &lt;z&gt;'));
  assert.ok(html.includes('#2 alta-clientes'));
  assert.ok(html.includes('Esperando &lt;credenciales&gt;'));
  assert.equal(html.split('data-action="open-work"').length - 1, 2);
  assert.ok(html.includes('data-id="crm"'));
  assert.ok(html.includes('Necesita permiso'));
  assert.ok(html.includes('hace 5 min'));
  assert.ok(has(html, 'open-run') && html.includes('Ver ejecución'));
  assert.ok(has(html, 'dismiss-run') && html.includes('Descartar'));
  assert.ok(html.includes('data-run-id="r1-00000001"'));
  assert.equal(renderAttention({ projects: [], runs: [] }, NOW), '');
  assert.equal(renderAttention(null, NOW), '');
});

// ---------- R88: historial ----------

test('[F4-R88] renderRunList con un run de cada estado y lista vacía', () => {
  assert.deepEqual(Object.keys(STATE_LABELS), ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout', 'needs_permission']);
  assert.deepEqual(Object.values(STATE_LABELS), ['En cola', 'En marcha', 'Terminada', 'Fallida', 'Cancelada', 'Tiempo agotado', 'Necesita permiso']);
  const runs = Object.keys(STATE_LABELS).map((state, i) => ({
    runId: `run${i}00000-0000000${i}`,
    label: i % 2 ? 'Ejecutar tests' : 'Chat',
    state,
    startedAt: new Date(NOW - (i + 1) * 2 * MIN).toISOString(),
    durationMs: 65000,
    costUsd: i === 2 ? 0.5 : null,
  }));
  const html = renderRunList(runs, NOW);
  for (const [state, label] of Object.entries(STATE_LABELS)) {
    assert.ok(html.includes(`state-${state}`), state);
    assert.ok(html.includes(label), label);
  }
  assert.equal(html.split('data-action="open-run"').length - 1, runs.length);
  assert.ok(html.includes('hace 2 min'));
  assert.ok(html.includes('1 min 5 s'));
  assert.ok(html.includes('0,50 US$'), html);
  assert.equal(renderRunList([], NOW), '<p class="muted">Sin ejecuciones todavía</p>');
});

// ---------- R89 ----------

test('[F4-R89] suggestCommitMessage con y sin feature in_progress', () => {
  assert.equal(suggestCommitMessage({ inProgress: { id: 4, slug: 'puesto-de-mando-trabajar' } }), 'Avance de puesto-de-mando-trabajar desde el Puesto de Mando');
  assert.equal(suggestCommitMessage({ inProgress: null }), 'Cambios desde el Puesto de Mando');
  assert.equal(suggestCommitMessage(null), 'Cambios desde el Puesto de Mando');
});

// ---------- Corrección T36 (prueba manual con Claude Code 2.1.307) ----------

test('[F4-R83] corrección T36: el resultado no repite el texto si es idéntico al último del asistente', () => {
  const summary = 'Resumen final <b>largo</b>';
  const result = { type: 'result', ok: true, text: summary, costUsd: 0.01, durationMs: 2000, numTurns: 2 };
  const same = renderRunEvent(result, { lastText: summary });
  assert.ok(same.includes('Resultado: correcto'));
  assert.ok(!same.includes('Resumen final'), 'solo la línea de resumen');
  const differs = renderRunEvent(result, { lastText: 'otro texto' });
  assert.ok(differs.includes('Resumen final &lt;b&gt;largo&lt;/b&gt;'), 'si difiere, se muestra');
  const log = renderRunLog([{ seq: 1, type: 'text', text: summary }, { seq: 2, type: 'result', ...result }]);
  assert.equal(log.split('Resumen final').length - 1, 1, 'el texto final aparece una sola vez en el registro');
});

test('[F4-R84] corrección T36: un run terminado con denegaciones avisa "N comandos denegados" con un botón por comando propuesto', () => {
  const run = { state: 'succeeded', claudeSessionId: 's', permissionDenials: [
    { tool: 'Bash', detail: 'head; git rev-list --left-right --count main...HEAD', suggestion: 'head', suggestions: ['head', 'git rev-list'] },
    { tool: 'Bash', detail: '', suggestion: null, suggestions: [] },
  ] };
  const html = renderPermissionPrompt(run);
  assert.ok(html.includes('2 comandos denegados durante la ejecución'));
  assert.ok(html.includes('Comando denegado: Bash: head; git rev-list'));
  assert.ok(html.includes('data-command="head"') && html.includes('data-command="git rev-list"'));
  assert.equal(html.split('data-action="allow-command"').length - 1, 2);
  assert.ok(!html.includes('{}') && !html.includes('Bash: <'), 'nunca "{}" ni detalle vacío con dos puntos');
  assert.ok(html.includes('Permitir «head» en este proyecto y reintentar'));
  assert.ok(renderPermissionPrompt({ state: 'succeeded', permissionDenials: [{ tool: 'Bash', detail: 'x', suggestions: [] }] }).includes('1 comando denegado durante la ejecución'));
  assert.equal(renderPermissionPrompt({ state: 'succeeded', permissionDenials: [] }), '');
  assert.equal(renderRunEvent({ type: 'permission_denied', tool: 'Bash', detail: '' }), '<div class="ev ev-error">Permiso denegado: Bash</div>');
});

test('[F4-R87] corrección T36: en "Te necesitan" un run terminado con denegaciones es un aviso informativo', () => {
  const html = renderAttention({ projects: [], runs: [{ runId: 'r9-00000009', projectId: 'app', projectName: 'App', label: 'Chat', state: 'succeeded', informative: true, endedAt: new Date(NOW).toISOString(), permissionDenials: [{ tool: 'Bash' }, { tool: 'Bash' }] }] }, NOW);
  assert.ok(html.includes('attention-info'));
  assert.ok(html.includes('Terminada'));
  assert.ok(html.includes('2 comandos denegados'));
  assert.ok(html.includes('data-action="dismiss-run"'));
});
