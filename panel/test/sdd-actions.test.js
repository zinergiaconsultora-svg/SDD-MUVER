// Tests de lib/sdd-actions.js y de los botones SDD — F4: R44–R49 (R47/R49 unitarios + integración).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { locateFeatureStatus, setFeatureStatus } from '../lib/sdd-actions.js';
import { makeProjectDir, makeTempDir, writeRegistry, startApp, request, removeDir } from './helpers.js';
import { waitForRun, readFakeLog, fileExists } from './work-helpers.js';

const PASSWORD = 'contraseña-de-la-fase-4';
const DEFAULT_TOOLS_TEXT = 'Read,Edit,Write,Glob,Grep,Bash(git status *),Bash(git diff *),Bash(git log *)';

const cleanup = [];
const apps = [];
after(async () => {
  for (const app of apps) await app.close();
  for (const dir of cleanup) await removeDir(dir);
});

// ---------- Unitarios: locateFeatureStatus / setFeatureStatus (R47, R49) ----------

const TWO_SPACES = `{
  "project": "demo",
  "features": [
    {
      "id": 1,
      "slug": "uno",
      "status": "done"
    },
    {
      "id": 2,
      "slug": "dos",
      "status": "spec_ready",
      "notes": "con \\"comillas\\" y status: \\"x\\""
    }
  ]
}
`;

test('[F4-R47] setFeatureStatus con 2 espacios: solo cambia el valor', () => {
  const next = setFeatureStatus(TWO_SPACES, 2, 'spec_ready', 'in_progress');
  assert.equal(next, TWO_SPACES.replace('"status": "spec_ready"', '"status": "in_progress"'));
  const range = locateFeatureStatus(TWO_SPACES, 1);
  assert.equal(TWO_SPACES.slice(range.start, range.end), '"spec_ready"');
  assert.equal(TWO_SPACES.slice(...Object.values(locateFeatureStatus(TWO_SPACES, 0))), '"done"');
  assert.equal(locateFeatureStatus(TWO_SPACES, 5), null);
});

test('[F4-R47] setFeatureStatus con BOM y \\r\\n conserva todos los bytes salvo el valor', () => {
  const text = '﻿' + '{\r\n\t"features": [\r\n\t\t{ "id": "7", "slug": "siete", "status": "spec_ready" }\r\n\t],\r\n\t"x": [1, 2.5e3, true, null]\r\n}\r\n';
  const next = setFeatureStatus(text, '7', 'spec_ready', 'in_progress');
  assert.equal(next, text.replace('"spec_ready"', '"in_progress"'));
  assert.ok(next.startsWith('﻿'));
  assert.equal(setFeatureStatus(text, 7, 'spec_ready', 'in_progress'), next, 'id numérico o cadena');
});

test('[F4-R47] status antes y después de objetos anidados, clave duplicada y features con elementos no objeto', () => {
  const before = '{"features":[{"status":"spec_ready","meta":{"status":"otro","list":[{"status":"x"}]},"id":3,"slug":"tres"}]}';
  assert.equal(setFeatureStatus(before, 3, 'spec_ready', 'in_progress'), before.replace('"status":"spec_ready"', '"status":"in_progress"'));
  const afterNested = '{"features":[{"id":3,"meta":{"status":"otro"},"sub":[{"status":"y"}],"slug":"tres","status":"spec_ready"}]}';
  assert.equal(setFeatureStatus(afterNested, 3, 'spec_ready', 'in_progress'), afterNested.replace('"status":"spec_ready"', '"status":"in_progress"'));
  // Con la clave duplicada JSON.parse se queda con la última: es la que se cambia.
  const duplicated = '{"features":[{"id":4,"status":"pending","status":"spec_ready"}]}';
  assert.equal(setFeatureStatus(duplicated, 4, 'spec_ready', 'in_progress'), '{"features":[{"id":4,"status":"pending","status":"in_progress"}]}');
  const mixed = '{"other":{"features":[{"status":"no"}]},"features":[null,"texto",{"id":5,"status":"spec_ready"}]}';
  assert.equal(setFeatureStatus(mixed, 5, 'spec_ready', 'in_progress'), '{"other":{"features":[{"status":"no"}]},"features":[null,"texto",{"id":5,"status":"in_progress"}]}');
  assert.throws(() => setFeatureStatus(mixed, 99, 'spec_ready', 'in_progress'), /not-found/);
  assert.throws(() => setFeatureStatus(TWO_SPACES, 1, 'spec_ready', 'in_progress'), /not-found/, 'la feature 1 no está en spec_ready');
});

test('[F4-R49] un escáner defectuoso (locateFn) produce el error de verificación y no devuelve texto', () => {
  const wrongRange = () => ({ start: TWO_SPACES.indexOf('"done"'), end: TWO_SPACES.indexOf('"done"') + 6 });
  assert.throws(() => setFeatureStatus(TWO_SPACES, 2, 'spec_ready', 'in_progress', { locateFn: wrongRange }), /verify/);
  assert.throws(() => setFeatureStatus(TWO_SPACES, 2, 'spec_ready', 'in_progress', { locateFn: () => ({ start: 0, end: 1 }) }), /verify/);
  assert.throws(() => setFeatureStatus(TWO_SPACES, 2, 'spec_ready', 'in_progress', { locateFn: () => null }), /verify/);
});

// ---------- Integración ----------

const FEATURES = {
  features: [
    { id: 1, slug: 'base', status: 'done' },
    { id: 2, slug: 'alta-clientes', status: 'spec_ready' },
    { id: 3, slug: 'facturas', status: 'pending' },
  ],
};

async function setup(featureList) {
  const base = await makeTempDir('muver-f4-sdd-');
  cleanup.push(base);
  const dir = await makeProjectDir(featureList === undefined ? {} : { featureList });
  cleanup.push(dir);
  const registryFile = path.join(base, 'projects.json');
  await writeRegistry(registryFile, [{ id: 'proy', name: 'Proy', path: dir }]);
  const app = await startApp({ projectsFile: registryFile, password: PASSWORD });
  apps.push(app);
  cleanup.push(app.dataDir);
  const cookie = await app.login();
  const post = (urlPath, body) => request(app.baseUrl, urlPath, { cookie, method: 'POST', body: JSON.stringify(body ?? {}) });
  return { app, cookie, post, dir, featureFile: path.join(dir, 'feature_list.json') };
}

test('[F4-R44] implement lanza "implementa la siguiente tarea pendiente" en modo new con action y label', async () => {
  const ctx = await setup(FEATURES);
  const r = await ctx.post('/api/projects/proy/sdd/implement');
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.action, 'implement');
  assert.equal(r.json.label, 'Implementar siguiente tarea');
  assert.equal(r.json.kind, 'claude');
  assert.deepEqual(r.json.session, { mode: 'new', id: null });
  await waitForRun(ctx.app, ctx.cookie, r.json.runId);
  const log = await readFakeLog(ctx.app.fakeLog);
  assert.deepEqual(log[0].argv, ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', DEFAULT_TOOLS_TEXT, 'implementa la siguiente tarea pendiente']);
  assert.ok(!log[0].argv.includes('--continue') && !log[0].argv.includes('--resume'));
  const cont = await ctx.post('/api/projects/proy/sdd/implement', { session: { mode: 'continue' } });
  assert.equal(cont.status, 202);
  await waitForRun(ctx.app, ctx.cookie, cont.json.runId);
  assert.deepEqual((await readFakeLog(ctx.app.fakeLog)).at(-1).argv.slice(-2), ['--continue', 'implementa la siguiente tarea pendiente']);
});

test('[F4-R45] approve-tests lanza "tests aprobados, lanza al reviewer" con --continue; con session new no', async () => {
  const ctx = await setup(FEATURES);
  const r = await ctx.post('/api/projects/proy/sdd/approve-tests');
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.action, 'approve-tests');
  assert.equal(r.json.label, 'Aprobar tests');
  assert.deepEqual(r.json.session, { mode: 'continue', id: null });
  await waitForRun(ctx.app, ctx.cookie, r.json.runId);
  assert.deepEqual((await readFakeLog(ctx.app.fakeLog))[0].argv.slice(-2), ['--continue', 'tests aprobados, lanza al reviewer']);
  const fresh = await ctx.post('/api/projects/proy/sdd/approve-tests', { session: { mode: 'new' } });
  assert.equal(fresh.status, 202);
  await waitForRun(ctx.app, ctx.cookie, fresh.json.runId);
  const last = (await readFakeLog(ctx.app.fakeLog)).at(-1).argv;
  assert.ok(!last.includes('--continue'));
  assert.equal(last.at(-1), 'tests aprobados, lanza al reviewer');
  const bad = await ctx.post('/api/projects/proy/sdd/approve-tests', { session: { mode: 'otro' } });
  assert.equal(bad.status, 400);
});

test('[F4-R46] botones SDD sin arnés (sin feature_list.json o roto) → 409 sin proceso ni ficheros', async () => {
  for (const featureList of [undefined, '{ roto', '{"sin":"features"}']) {
    const ctx = await setup(featureList);
    const before = featureList === undefined ? null : await fs.readFile(ctx.featureFile);
    for (const action of ['implement', 'approve-tests', 'approve-spec']) {
      const r = await ctx.post(`/api/projects/proy/sdd/${action}`, { featureId: 2 });
      assert.equal(r.status, 409, `${action} ${featureList}`);
      assert.deepEqual(r.json, { error: 'El proyecto no tiene arnés SDD (feature_list.json ausente o no válido)' });
    }
    assert.equal(await fileExists(ctx.app.fakeLog), false);
    if (before) assert.deepEqual(await fs.readFile(ctx.featureFile), before);
    else assert.equal(await fileExists(ctx.featureFile), false);
  }
});

test('[F4-R47] approve-spec cambia solo el status (bytes idénticos salvo el valor), sin .tmp y responde la feature', async () => {
  const ctx = await setup(FEATURES);
  const raw = '﻿' + JSON.stringify(FEATURES, null, 4).replace(/\n/g, '\r\n') + '\r\n';
  await fs.writeFile(ctx.featureFile, raw, 'utf8');
  const r = await ctx.post('/api/projects/proy/sdd/approve-spec', { featureId: 2 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { feature: { id: 2, slug: 'alta-clientes', status: 'in_progress' } });
  const after = await fs.readFile(ctx.featureFile, 'utf8');
  assert.equal(after, raw.replace('"status": "spec_ready"', '"status": "in_progress"'));
  assert.deepEqual(await fs.readdir(ctx.dir), ['feature_list.json'], 'sin feature_list.json.tmp residual');
  assert.equal(await fileExists(ctx.app.fakeLog), false, 'aprobar la spec no lanza procesos');
});

test('[F4-R48] approve-spec: featureId ausente o de tipo no válido → 400; no spec_ready, inexistente u otra in_progress → 409; fichero intacto', async () => {
  const withOther = { features: [...FEATURES.features.slice(0, 2), { id: 3, slug: 'facturas', status: 'in_progress' }] };
  const ctx = await setup(withOther);
  const before = await fs.readFile(ctx.featureFile);
  const cases = [
    [{}, 400, 'Indica la feature a aprobar'],
    [{ featureId: 2.5 }, 400, 'Indica la feature a aprobar'],
    [{ featureId: true }, 400, 'Indica la feature a aprobar'],
    [{ featureId: '' }, 400, 'Indica la feature a aprobar'],
    [{ featureId: 1 }, 409, 'La feature no está en spec_ready'],
    [{ featureId: 99 }, 409, 'La feature no está en spec_ready'],
    [{ featureId: 2 }, 409, 'Ya hay otra feature in_progress: #3 facturas'],
    [{ featureId: '2' }, 409, 'Ya hay otra feature in_progress: #3 facturas'],
  ];
  for (const [body, status, error] of cases) {
    const r = await ctx.post('/api/projects/proy/sdd/approve-spec', body);
    assert.equal(r.status, status, JSON.stringify(body));
    assert.equal(r.json.error, error, JSON.stringify(body));
  }
  assert.deepEqual(await fs.readFile(ctx.featureFile), before);
});
