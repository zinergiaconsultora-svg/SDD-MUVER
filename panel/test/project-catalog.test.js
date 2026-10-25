// Tests de lib/project-catalog.js — F3: R24, R25, R26, R27, R29
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeProjects, assignIds, sortCatalog, projectActivity, toSummary, MAX_DETAIL_SESSIONS } from '../lib/project-catalog.js';

function discovered(overrides = {}) {
  const p = overrides.path === undefined ? '/tmp/proy' : overrides.path;
  return {
    path: p,
    name: overrides.name,
    encodedName: overrides.encodedName ?? (p ? p.replace(/[\\/:]/g, '-') : null),
    unresolved: overrides.unresolved ?? false,
    source: 'claude',
    sessionCount: overrides.sessions ? overrides.sessions.length : 0,
    lastActivityAt: overrides.lastActivityAt ?? null,
    lastPrompt: overrides.lastPrompt ?? null,
    sessions: overrides.sessions ?? [],
  };
}

const SESSION = { id: 's1', title: 'T', startedAt: '2026-10-24T09:00:00.000Z', lastActivityAt: '2026-10-24T09:13:00.000Z', messageCount: 3, gitBranch: 'main', truncated: false };

test('[F3-R24] mergeProjects: misma clave de ruta Windows con distinta caja y separador → un solo proyecto both', () => {
  const settings = [{ id: 'flyder', name: 'Flyder', path: 'C:\\Users\\Usuario\\app-flyder', appUrl: 'http://localhost:5173', repoUrl: 'https://r', tags: ['web'], hidden: true, pinned: true }];
  const disc = [discovered({ path: 'c:/users/usuario/app-flyder', lastActivityAt: SESSION.lastActivityAt, lastPrompt: 'hola', sessions: [SESSION] })];
  const merged = mergeProjects(settings, disc);
  assert.equal(merged.length, 1);
  const m = merged[0];
  assert.equal(m.source, 'both');
  assert.equal(m.id, 'flyder');
  assert.equal(m.name, 'Flyder');
  assert.equal(m.appUrl, 'http://localhost:5173');
  assert.equal(m.repoUrl, 'https://r');
  assert.deepEqual(m.tags, ['web']);
  assert.equal(m.hidden, true);
  assert.equal(m.pinned, true);
  assert.equal(m.path, 'C:\\Users\\Usuario\\app-flyder');
  assert.deepEqual(m.claude, { sessionCount: 1, lastActivityAt: SESSION.lastActivityAt, lastPrompt: 'hola', sessions: [SESSION] });
  assert.equal(m.unresolved, false);
  assert.equal(m.settingsEntry.id, 'flyder');
});

test('[F3-R25] mergeProjects: entrada sin coincidencia → manual con claude null; hidden/pinned normalizados', () => {
  const merged = mergeProjects([{ id: 'solo', name: 'Solo', path: '/tmp/solo', appUrl: '', repoUrl: '', tags: [] }], [discovered({ path: '/tmp/otro' })]);
  const manual = merged.find((m) => m.id === 'solo');
  assert.equal(manual.source, 'manual');
  assert.equal(manual.claude, null);
  assert.equal(manual.hidden, false);
  assert.equal(manual.pinned, false);
  assert.equal(merged.find((m) => m.path === '/tmp/otro').source, 'claude');
});

test('[F3-R26] mergeProjects: descubierto sin ajustes → claude con nombre = último segmento y valores por defecto', () => {
  const [m] = assignIds(mergeProjects([], [discovered({ path: 'C:\\Users\\Usuario\\Mi Proyecto' })]));
  assert.equal(m.source, 'claude');
  assert.equal(m.name, 'Mi Proyecto');
  assert.equal(m.id, 'mi-proyecto');
  assert.equal(m.appUrl, '');
  assert.equal(m.repoUrl, '');
  assert.deepEqual(m.tags, []);
  assert.equal(m.hidden, false);
  assert.equal(m.pinned, false);
  assert.equal(m.settingsEntry, null);
  assert.deepEqual(m.claude, { sessionCount: 0, lastActivityAt: null, lastPrompt: null, sessions: [] });
});

test('[F3-R27] assignIds: colisiones app / app-2 / app-3 estables ante otro orden y no resuelto por carpeta', () => {
  const settings = [{ id: 'app', name: 'App manual', path: '/z/manual' }];
  const discA = [discovered({ path: '/y/app' }), discovered({ path: '/x/app' }), discovered({ path: null, unresolved: true, encodedName: 'C--Users-Usuario-viejo' })];
  const discB = [discA[2], discA[0], discA[1]];
  const ids = (list) => Object.fromEntries(assignIds(mergeProjects(settings, list)).map((m) => [m.path ?? m.name, m.id]));
  const a = ids(discA);
  assert.deepEqual(a, { '/z/manual': 'app', '/x/app': 'app-2', '/y/app': 'app-3', 'C--Users-Usuario-viejo': 'c-users-usuario-viejo' });
  assert.deepEqual(ids(discB), a);
});

test('[F3-R27] assignIds: nombre sin caracteres válidos → "proyecto"', () => {
  const [m] = assignIds(mergeProjects([], [discovered({ path: '/tmp/!!!' })]));
  assert.equal(m.id, 'proyecto');
});

test('[F3-R29] sortCatalog: fijados primero, fecha desc con null al final, nombre (es) e id', () => {
  const list = [
    { id: 'zeta', name: 'Zeta', pinned: false, lastActivityAt: null },
    { id: 'reciente', name: 'Reciente', pinned: false, lastActivityAt: '2026-10-24T00:00:00.000Z' },
    { id: 'agil', name: 'Ágil', pinned: false, lastActivityAt: null },
    { id: 'fijado', name: 'Fijado', pinned: true, lastActivityAt: '2020-01-01T00:00:00.000Z' },
    { id: 'antiguo', name: 'Antiguo', pinned: false, lastActivityAt: '2026-01-01T00:00:00.000Z' },
  ];
  const sorted = sortCatalog(list);
  assert.deepEqual(sorted.map((p) => p.id), ['fijado', 'reciente', 'antiguo', 'agil', 'zeta']);
  assert.equal(list[0].id, 'zeta', 'no muta la lista original');
  const ties = sortCatalog([{ id: 'b', name: 'X', pinned: false, lastActivityAt: null }, { id: 'a', name: 'X', pinned: false, lastActivityAt: null }]);
  assert.deepEqual(ties.map((p) => p.id), ['a', 'b']);
});

test('[F3-R25][F3-R29] projectActivity: Claude, git, ambos y ninguno', () => {
  const withClaude = { claude: { lastActivityAt: '2026-10-20T00:00:00.000Z' } };
  const withGit = { git: { lastCommit: { date: '2026-10-22T10:00:00+02:00' } } };
  assert.equal(projectActivity(withClaude, {}), '2026-10-20T00:00:00.000Z');
  assert.equal(projectActivity({ claude: null }, withGit), '2026-10-22T08:00:00.000Z');
  assert.equal(projectActivity(withClaude, withGit), '2026-10-22T08:00:00.000Z');
  assert.equal(projectActivity({ claude: { lastActivityAt: '2026-10-23T00:00:00.000Z' } }, withGit), '2026-10-23T00:00:00.000Z');
  assert.equal(projectActivity({ claude: null }, { git: { lastCommit: null } }), null);
  assert.equal(projectActivity({ claude: { lastActivityAt: 'basura' } }, {}), null);
});

test('[F3-R24][F3-R31] toSummary añade los campos nuevos y, en el detalle, como mucho MAX_DETAIL_SESSIONS sesiones', () => {
  assert.equal(MAX_DETAIL_SESSIONS, 20);
  const sessions = Array.from({ length: 22 }, (_, i) => ({ ...SESSION, id: `s${i}` }));
  const merged = { source: 'both', hidden: false, pinned: true, unresolved: false, claude: { sessionCount: 22, lastActivityAt: SESSION.lastActivityAt, lastPrompt: null, sessions } };
  const base = { id: 'x', name: 'X', git: { lastCommit: null } };
  const summary = toSummary(merged, base);
  assert.deepEqual(summary.claude, { sessionCount: 22, lastActivityAt: SESSION.lastActivityAt, lastPrompt: null });
  assert.equal(summary.source, 'both');
  assert.equal(summary.pinned, true);
  assert.equal(summary.lastActivityAt, SESSION.lastActivityAt);
  const detail = toSummary(merged, base, { withSessions: true });
  assert.equal(detail.claude.sessions.length, 20);
  assert.equal(toSummary({ ...merged, source: 'manual', claude: null }, base).claude, null);
});
