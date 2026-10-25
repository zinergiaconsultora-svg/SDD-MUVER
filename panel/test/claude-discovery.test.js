// Tests de lib/claude-discovery.js — F3: R2, R4, R5, R7–R22
// Siempre sobre fixtures en directorios temporales (test/claude-fixtures.js), nunca sobre el ~/.claude real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  discoverClaudeProjects,
  createClaudeDiscovery,
  parseSessionFile,
  readClaudeConfig,
  resolveClaudePaths,
  clipTitle,
  extractText,
  CONFIG_FILE_NAME,
  PROJECTS_DIR_PARTS,
  MAX_SESSION_FILE_BYTES,
  HEAD_LINES,
  TITLE_MAX_CHARS,
  DEFAULT_TTL_MS,
  SKIPPED_PROMPT_PREFIXES,
} from '../lib/claude-discovery.js';
import {
  makeClaudeHome,
  makeBaseClaudeHome,
  sessionLine,
  writeSession,
  snapshotTree,
  WINDOWS_FLYDER,
  FLYDER_FOLDER,
  VIEJO_FOLDER,
} from './claude-fixtures.js';
import { PANEL_DIR, makeTempDir, removeDir } from './helpers.js';

const dirs = [];
after(async () => {
  for (const dir of dirs) await removeDir(dir);
});

async function home(options) {
  const h = await makeClaudeHome(options);
  dirs.push(h.claudeHome);
  return h;
}

function spyLog() {
  const calls = [];
  const log = (...args) => calls.push(args);
  log.calls = calls;
  return log;
}

function byPath(result, p) {
  return result.projects.find((x) => x.path === p);
}

const NOW = Date.parse('2026-10-25T10:00:00.000Z');
const fixedNow = () => NOW;

// ---------- Bloque A: configuración y estructura ----------

test('[F3-R2][F3-R4] sin .claude.json ni .claude/projects → available false, projects vacío y sin log', async () => {
  const { claudeHome } = await home({});
  const log = spyLog();
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log });
  assert.equal(r.available, false);
  assert.deepEqual(r.projects, []);
  assert.equal(r.claudeHome, claudeHome);
  assert.equal(r.projectsDir, path.join(claudeHome, '.claude', 'projects'));
  assert.equal(r.configFile, path.join(claudeHome, '.claude.json'));
  assert.equal(r.scannedAt, new Date(NOW).toISOString());
  assert.equal(log.calls.length, 0);
});

test('[F3-R4] constantes y resolveClaudePaths según design.md §5.2', () => {
  assert.equal(CONFIG_FILE_NAME, '.claude.json');
  assert.deepEqual(PROJECTS_DIR_PARTS, ['.claude', 'projects']);
  assert.equal(MAX_SESSION_FILE_BYTES, 20 * 1024 * 1024);
  assert.equal(HEAD_LINES, 200);
  assert.equal(TITLE_MAX_CHARS, 80);
  assert.equal(DEFAULT_TTL_MS, 30000);
  assert.deepEqual(SKIPPED_PROMPT_PREFIXES, ['<command-', '<local-command-']);
  const p = resolveClaudePaths('/x/home');
  assert.deepEqual(p, { claudeHome: '/x/home', configFile: path.join('/x/home', '.claude.json'), projectsDir: path.join('/x/home', '.claude', 'projects') });
});

test('[F3-R5] .claude.json roto → ignorado con un único log, carpetas descubiertas y lastPrompt null', async () => {
  for (const config of ['{ roto', JSON.stringify({ projects: [] })]) {
    const { claudeHome } = await home({
      config,
      projects: { '-tmp-muver-r5': { s1: [sessionLine({ text: 'hola', cwd: '/tmp/muver-r5', timestamp: '2026-10-01T00:00:00Z' })] } },
    });
    const log = spyLog();
    const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log });
    assert.equal(r.available, true, `config ${config}`);
    assert.equal(r.projects.length, 1);
    assert.equal(r.projects[0].lastPrompt, null);
    assert.equal(r.projects[0].path, '/tmp/muver-r5');
    assert.equal(log.calls.length, 1, 'exactamente un aviso por escaneo');
    assert.match(String(log.calls[0][0]), /\.claude\.json ilegible/);
  }
});

test('[F3-R5] readClaudeConfig: ENOENT → exists false sin log; objeto válido → mapa por clave de ruta', async () => {
  const log = spyLog();
  const missing = await readClaudeConfig('/no/existe/.claude.json', { log });
  assert.equal(missing.exists, false);
  assert.equal(missing.projects.size, 0);
  assert.equal(log.calls.length, 0);

  const { configFile } = await home({ config: { projects: { 'C:\\Users\\Usuario\\App': { history: [{ display: 'x' }] } } } });
  const ok = await readClaudeConfig(configFile, { log });
  assert.equal(ok.exists, true);
  assert.deepEqual(ok.projects.get('c:\\users\\usuario\\app'), { path: 'C:\\Users\\Usuario\\App', lastPrompt: 'x' });
});

test('[F3-R7] solo subcarpetas directas y ficheros .jsonl: se ignoran notas.txt, tools/ y suelto.jsonl', async () => {
  const { claudeHome } = await home({
    projects: {
      '-tmp-muver-r7a': {
        a1: [sessionLine({ text: 'uno', cwd: '/tmp/muver-r7a' })],
        a2: [sessionLine({ text: 'dos', cwd: '/tmp/muver-r7a' })],
      },
      '-tmp-muver-r7b': {},
    },
    extraFiles: {
      '-tmp-muver-r7a/notas.txt': 'no es sesión',
      '-tmp-muver-r7a/tools/a3.jsonl': JSON.stringify(sessionLine({ text: 'sub', cwd: '/tmp/otra' })),
      '-tmp-muver-r7b/tools/b1.jsonl': JSON.stringify(sessionLine({ text: 'sub', cwd: '/tmp/otra' })),
      'suelto.jsonl': JSON.stringify(sessionLine({ text: 'suelto', cwd: '/tmp/suelto' })),
    },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  assert.equal(r.projects.length, 2);
  const a = r.projects.find((p) => p.encodedName === '-tmp-muver-r7a');
  const b = r.projects.find((p) => p.encodedName === '-tmp-muver-r7b');
  assert.equal(a.sessionCount, 2);
  assert.deepEqual(a.sessions.map((s) => s.id).sort(), ['a1', 'a2']);
  assert.equal(b.sessionCount, 0);
  assert.ok(!r.projects.some((p) => p.path === '/tmp/suelto' || p.path === '/tmp/otra'));
});

test('[F3-R11] clave de configuración sin carpeta → proyecto con sessions [] y lastActivityAt null', async () => {
  const { claudeHome } = await home({
    config: { projects: { '/tmp/muver-r11a': {}, '/tmp/muver-r11b': { history: [] } } },
    projects: { '-tmp-muver-r11a': { s1: [sessionLine({ text: 'hola', cwd: '/tmp/muver-r11a', timestamp: '2026-10-01T00:00:00Z' })] } },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  assert.equal(r.projects.length, 2);
  const second = byPath(r, '/tmp/muver-r11b');
  assert.deepEqual(second.sessions, []);
  assert.equal(second.sessionCount, 0);
  assert.equal(second.lastActivityAt, null);
  assert.equal(second.source, 'claude');
  assert.equal(second.encodedName, null);
  assert.equal(second.unresolved, false);
  assert.equal(byPath(r, '/tmp/muver-r11a').sessionCount, 1);
});

test('[F3-R12] la misma ruta como clave y como carpeta (cwd con barra final) → una sola entrada', async () => {
  const { claudeHome } = await home({
    config: { projects: { '/tmp/muver-proy-a': { history: [{ display: 'último prompt' }] } } },
    projects: { '-tmp-muver-proy-a-': { s1: [sessionLine({ text: 'hola', cwd: '/tmp/muver-proy-a/', timestamp: '2026-10-01T00:00:00Z' })] } },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].sessionCount, 1);
  assert.equal(r.projects[0].lastPrompt, 'último prompt');
});

test('[F3-R13] lastPrompt: mayor timestamp, índice 0 sin timestamp (recortado a 80 + …) y null sin history', async () => {
  const long = 'x'.repeat(100);
  const { claudeHome } = await home({
    config: {
      projects: {
        '/tmp/r13-con-ts': { history: [{ display: 'viejo', timestamp: 1000 }, { display: 'nuevo', timestamp: 3000 }, { display: 'medio', timestamp: 2000 }] },
        '/tmp/r13-iso': { history: [{ display: 'a', timestamp: '2026-01-01T00:00:00Z' }, { display: 'b', timestamp: '2026-02-01T00:00:00Z' }] },
        '/tmp/r13-sin-ts': { history: [{ display: long }, { display: 'segundo' }] },
        '/tmp/r13-invalidos': { history: [{ display: '' }, { display: 5 }, 'texto', null, { display: '  válido  ' }] },
        '/tmp/r13-sin-history': {},
      },
    },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  assert.equal(byPath(r, '/tmp/r13-con-ts').lastPrompt, 'nuevo');
  assert.equal(byPath(r, '/tmp/r13-iso').lastPrompt, 'b');
  assert.equal(byPath(r, '/tmp/r13-sin-ts').lastPrompt, 'x'.repeat(80) + '…');
  assert.equal(byPath(r, '/tmp/r13-invalidos').lastPrompt, 'válido');
  assert.equal(byPath(r, '/tmp/r13-sin-history').lastPrompt, null);
});

// ---------- Bloque B: resolución de ruta ----------

test('[F3-R8] path = primer cwd en orden de ficheros por nombre y de líneas', async () => {
  const { claudeHome } = await home({
    projects: {
      '-tmp-muver-proy-a': {
        b: [sessionLine({ text: 'otro', cwd: '/tmp/muver-otro' })],
        a: [
          sessionLine({ text: 'sin cwd', timestamp: '2026-10-01T00:00:00Z' }),
          sessionLine({ text: 'con cwd', cwd: '/tmp/muver-proy-a' }),
          sessionLine({ text: 'otro cwd', cwd: '/tmp/muver-distinto' }),
        ],
      },
    },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].path, '/tmp/muver-proy-a');
  assert.equal(r.projects[0].unresolved, false);
  assert.equal(r.projects[0].encodedName, '-tmp-muver-proy-a');
});

test('[F3-R9] carpeta sin cwd casada con la clave Windows y con la clave POSIX de .claude.json', async () => {
  const { claudeHome } = await home({
    config: { projects: { [WINDOWS_FLYDER]: { history: [{ display: 'hola' }] }, '/home/user/SDD-MUVER': {} } },
    projects: {
      [FLYDER_FOLDER]: { s1: [sessionLine({ text: 'sin cwd', timestamp: '2026-10-24T09:00:00Z' })] },
      '-home-user-SDD-MUVER': { s2: [sessionLine({ text: 'sin cwd', timestamp: '2026-10-24T09:00:00Z' })] },
    },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  assert.equal(r.projects.length, 2);
  const flyder = byPath(r, WINDOWS_FLYDER);
  assert.ok(flyder, 'resuelto por la clave Windows');
  assert.equal(flyder.unresolved, false);
  assert.equal(flyder.sessionCount, 1);
  assert.equal(flyder.lastPrompt, 'hola');
  const muver = byPath(r, '/home/user/SDD-MUVER');
  assert.equal(muver.unresolved, false);
  assert.equal(muver.sessionCount, 1);
});

test('[F3-R9] comparación laxa: carpeta codificada con . sustituido también casa', async () => {
  const { claudeHome } = await home({
    config: { projects: { 'C:\\Users\\Usuario\\app.web': {} } },
    projects: { 'C--Users-Usuario-app-web': { s1: [sessionLine({ text: 'x' })] } },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].path, 'C:\\Users\\Usuario\\app.web');
});

test('[F3-R10] carpeta sin cwd ni clave → path null, unresolved true y name = carpeta', async () => {
  const { claudeHome } = await home({
    config: { projects: { [WINDOWS_FLYDER]: {} } },
    projects: { [VIEJO_FOLDER]: { s1: [sessionLine({ text: 'viejo', timestamp: '2026-01-01T00:00:00Z' })] } },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  const viejo = r.projects.find((p) => p.encodedName === VIEJO_FOLDER);
  assert.equal(viejo.path, null);
  assert.equal(viejo.unresolved, true);
  assert.equal(viejo.name, VIEJO_FOLDER);
  assert.equal(viejo.sessionCount, 1);
});

test('[F3-R7][F3-R8][F3-R9][F3-R10] fixture base completo: 5 proyectos resueltos como en design.md §6.1', async () => {
  const base = await makeBaseClaudeHome();
  dirs.push(base.claudeHome);
  const r = await discoverClaudeProjects({ claudeHome: base.claudeHome, now: fixedNow, log: spyLog() });
  assert.equal(r.available, true);
  assert.deepEqual(r.projects.map((p) => [p.path, p.sessionCount]).sort(), [
    ['/tmp/muver-proy-a', 2],
    ['/tmp/muver-roto', 1],
    [WINDOWS_FLYDER, 1],
    [null, 1],
  ].sort());
  assert.equal(byPath(r, WINDOWS_FLYDER).lastPrompt, 'implementa la siguiente tarea pendiente');
  assert.equal(byPath(r, '/tmp/muver-proy-a').lastPrompt, 'arranca el proyecto A');
});

// ---------- Bloque C: sesiones ----------

async function singleSession(lines, options = {}) {
  const dir = await makeTempDir('muver-ses-');
  dirs.push(dir);
  const file = await writeSession(dir, options.id || 'ses-1', lines, { mtime: options.mtime });
  const stats = { filesParsed: 0, filesCached: 0, bytesRead: 0, fromCache: false };
  const result = await parseSessionFile(file, { maxFileBytes: options.maxFileBytes ?? MAX_SESSION_FILE_BYTES, headLines: options.headLines ?? HEAD_LINES, stats });
  return { ...result, stats, file };
}

test('[F3-R14] campos de la sesión con timestamps desordenados y dos ramas', async () => {
  const { session } = await singleSession([
    sessionLine({ type: 'user', text: 'primer mensaje', timestamp: '2026-10-24T09:10:00.000Z', gitBranch: 'main', cwd: '/tmp/x' }),
    sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'r1' }], timestamp: '2026-10-24T09:00:00.000Z', gitBranch: 'main' }),
    sessionLine({ type: 'summary', summary: 'Resumen' }),
    sessionLine({ type: 'user', text: 'segundo', timestamp: '2026-10-24T09:30:00.000Z', gitBranch: 'feature/login' }),
    sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'r2' }], timestamp: '2026-10-24T09:20:00.000Z', gitBranch: '' }),
  ], { id: 'abc-123' });
  assert.deepEqual(session, {
    id: 'abc-123',
    title: 'Resumen',
    startedAt: '2026-10-24T09:00:00.000Z',
    lastActivityAt: '2026-10-24T09:30:00.000Z',
    messageCount: 4,
    gitBranch: 'feature/login',
    truncated: false,
  });
});

test('[F3-R15] título = summary de la última línea summary', async () => {
  const { session } = await singleSession([
    sessionLine({ type: 'summary', summary: 'Primero' }),
    sessionLine({ type: 'user', text: 'hola' }),
    sessionLine({ type: 'summary', summary: 'Segundo' }),
    sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'x' }] }),
    sessionLine({ type: 'summary', summary: '   ' }),
  ]);
  assert.equal(session.title, 'Segundo');
});

test('[F3-R16] título por primer user: cadena larga, bloque text tras tool_result, salto de <command-…> y fallback al id', async () => {
  const long = 'palabra  con   espacios ' + 'y'.repeat(120);
  const a = await singleSession([sessionLine({ type: 'user', text: long })]);
  assert.equal([...a.session.title].length, 81);
  assert.ok(a.session.title.endsWith('…'));
  assert.ok(a.session.title.startsWith('palabra con espacios y'), 'espacios colapsados');

  const b = await singleSession([
    sessionLine({ type: 'user', blocks: [{ type: 'tool_result', content: 'salida' }, { type: 'text', text: 'Texto del bloque' }] }),
  ]);
  assert.equal(b.session.title, 'Texto del bloque');

  const c = await singleSession([
    sessionLine({ type: 'user', text: '<command-name>/clear</command-name>' }),
    sessionLine({ type: 'user', text: '<local-command-stdout></local-command-stdout>' }),
    sessionLine({ type: 'user', text: '   ' }),
    sessionLine({ type: 'user', text: 'Texto normal' }),
  ]);
  assert.equal(c.session.title, 'Texto normal');

  const d = await singleSession([sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'solo asistente' }] })], { id: 'solo-asistente' });
  assert.equal(d.session.title, 'solo-asistente');
});

test('[F3-R16] clipTitle y extractText', () => {
  assert.equal(clipTitle('  a \n\t b  '), 'a b');
  assert.equal(clipTitle('ñ'.repeat(80)), 'ñ'.repeat(80));
  assert.equal(clipTitle('😀'.repeat(81)), '😀'.repeat(80) + '…');
  assert.equal(extractText('hola'), 'hola');
  assert.equal(extractText([{ type: 'image' }, { type: 'text', text: 'x' }]), 'x');
  assert.equal(extractText([{ type: 'tool_result' }]), null);
  assert.equal(extractText({ text: 'x' }), null);
  assert.equal(extractText(undefined), null);
});

test('[F3-R17] líneas corruptas ignoradas sin lanzar ni registrar; sin timestamps → fechas = mtime', async () => {
  const log = spyLog();
  const { session } = await singleSession([
    '{ roto',
    '',
    '"cadena"',
    '{}',
    'null',
    '[1,2]',
    sessionLine({ type: 'user', text: 'mensaje uno', timestamp: '2026-10-01T00:00:00Z' }),
    sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'ok' }], timestamp: 'no es fecha' }),
  ]);
  assert.equal(session.messageCount, 2);
  assert.equal(session.title, 'mensaje uno');
  assert.equal(log.calls.length, 0);

  const mtime = new Date('2026-05-05T05:05:05.000Z');
  const noTs = await singleSession([sessionLine({ type: 'user', text: 'sin fecha' })], { mtime });
  assert.equal(noTs.session.startedAt, mtime.toISOString());
  assert.equal(noTs.session.lastActivityAt, mtime.toISOString());
});

test('[F3-R18] fichero grande: solo cabecera, truncated, messageCount null, lastActivityAt = mtime y bytesRead < tamaño', async () => {
  const pad = 'p'.repeat(170);
  const lines = [];
  for (let i = 0; i < 10; i++) {
    lines.push(sessionLine({
      type: i % 2 === 0 ? 'user' : 'assistant',
      text: i === 0 ? '<command-name>/clear</command-name>' : `mensaje ${i} ${pad}`,
      timestamp: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
      cwd: i === 0 ? undefined : `/tmp/cwd-${i}`,
      gitBranch: `rama-${i}`,
    }));
  }
  const mtime = new Date('2026-10-20T00:00:00.000Z');
  const r = await singleSession(lines, { maxFileBytes: 1024, headLines: 3, mtime });
  const size = (await fs.stat(r.file)).size;
  assert.ok(size > 1024 && size < 4096, `tamaño del fixture ${size}`);
  assert.equal(r.session.truncated, true);
  assert.equal(r.session.messageCount, null);
  assert.equal(r.session.lastActivityAt, mtime.toISOString());
  assert.equal(r.session.startedAt, new Date(Date.UTC(2026, 9, 1, 0)).toISOString());
  assert.equal(r.session.title, `mensaje 2 ${pad}`.slice(0, 80) + '…', 'título de las 3 primeras líneas');
  assert.equal(r.session.gitBranch, 'rama-2', 'última rama de la cabecera');
  assert.equal(r.cwd, '/tmp/cwd-1');
  assert.ok(r.stats.bytesRead < size, `bytesRead ${r.stats.bytesRead} < ${size}`);
});

test('[F3-R19] sesiones ordenadas por lastActivityAt desc, recuento y fecha del proyecto', async () => {
  const { claudeHome } = await home({
    projects: {
      '-tmp-muver-r19': {
        c: [sessionLine({ text: 'c', cwd: '/tmp/muver-r19', timestamp: '2026-10-01T00:00:00.000Z' })],
        b: [sessionLine({ text: 'b', cwd: '/tmp/muver-r19', timestamp: '2026-10-03T00:00:00.000Z' })],
        a: [sessionLine({ text: 'a', cwd: '/tmp/muver-r19', timestamp: '2026-10-02T00:00:00.000Z' })],
      },
    },
  });
  const r = await discoverClaudeProjects({ claudeHome, now: fixedNow, log: spyLog() });
  const p = r.projects[0];
  assert.deepEqual(p.sessions.map((s) => s.id), ['b', 'a', 'c']);
  assert.equal(p.sessionCount, 3);
  assert.equal(p.lastActivityAt, '2026-10-03T00:00:00.000Z');
});

// ---------- Bloque D: caché y solo lectura ----------

test('[F3-R20] caché por (ruta, mtime, tamaño): filesParsed / filesCached en tres escaneos', async () => {
  const base = await makeBaseClaudeHome();
  dirs.push(base.claudeHome);
  const discovery = createClaudeDiscovery({ claudeHome: base.claudeHome, now: fixedNow, ttlMs: 0, log: spyLog() });
  const first = await discovery.scan();
  assert.equal(first.stats.filesParsed, 5);
  assert.equal(first.stats.filesCached, 0);
  assert.equal(first.stats.fromCache, false);

  const second = await discovery.scan();
  assert.equal(second.stats.filesParsed, 0);
  assert.equal(second.stats.filesCached, 5);
  assert.equal(second.stats.fromCache, false);
  assert.deepEqual(second.projects, first.projects);

  await writeSession(path.join(base.projectsDir, FLYDER_FOLDER), '1111-dddd', [
    sessionLine({ type: 'user', text: 'contenido distinto y más largo', timestamp: '2026-10-25T09:00:00.000Z' }),
    sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'ok' }], timestamp: '2026-10-25T09:01:00.000Z' }),
    sessionLine({ type: 'user', text: 'otra', timestamp: '2026-10-25T09:02:00.000Z' }),
  ]);
  const third = await discovery.scan();
  assert.equal(third.stats.filesParsed, 1);
  assert.equal(third.stats.filesCached, 4);
  const flyder = third.projects.find((p) => p.path === WINDOWS_FLYDER);
  assert.equal(flyder.sessions[0].messageCount, 3);
});

test('[F3-R21] TTL de 30 s con now controlable, fromCache y scan({ force: true })', async () => {
  const { claudeHome, projectsDir } = await home({
    projects: { '-tmp-muver-r21': { s1: [sessionLine({ text: 'uno', cwd: '/tmp/muver-r21', timestamp: '2026-10-01T00:00:00Z' })] } },
  });
  let current = NOW;
  const discovery = createClaudeDiscovery({ claudeHome, now: () => current, log: spyLog() });
  assert.equal(discovery.status(), null, 'sin escaneo previo no hay estado');
  const t0 = await discovery.scan();
  assert.equal(t0.projects[0].sessionCount, 1);
  assert.equal(t0.stats.fromCache, false);

  await writeSession(path.join(projectsDir, '-tmp-muver-r21'), 's2', [sessionLine({ text: 'dos', cwd: '/tmp/muver-r21' })]);
  current = NOW + 29000;
  const cached = await discovery.scan();
  assert.equal(cached.projects[0].sessionCount, 1);
  assert.equal(cached.stats.fromCache, true);

  current = NOW + 31000;
  const fresh = await discovery.scan();
  assert.equal(fresh.projects[0].sessionCount, 2);
  assert.equal(fresh.stats.fromCache, false);
  assert.equal(discovery.status().lastScanAt, new Date(NOW + 31000).toISOString());

  await writeSession(path.join(projectsDir, '-tmp-muver-r21'), 's3', [sessionLine({ text: 'tres', cwd: '/tmp/muver-r21' })]);
  const forced = await discovery.scan({ force: true });
  assert.equal(forced.projects[0].sessionCount, 3);
  assert.equal(forced.stats.fromCache, false);
});

test('[F3-R21] dos scan() concurrentes comparten el mismo escaneo; status() deriva del último', async () => {
  const base = await makeBaseClaudeHome();
  dirs.push(base.claudeHome);
  const discovery = createClaudeDiscovery({ claudeHome: base.claudeHome, now: fixedNow, ttlMs: 0, log: spyLog() });
  const [a, b] = await Promise.all([discovery.scan(), discovery.scan()]);
  assert.equal(a, b);
  assert.equal(a.stats.filesParsed, 5);
  assert.deepEqual(discovery.status(), {
    available: true,
    claudeHome: base.claudeHome,
    projectsDir: base.projectsDir,
    projectCount: 4,
    sessionCount: 5,
    lastScanAt: new Date(NOW).toISOString(),
  });
});

const FORBIDDEN = ['writeFile', 'appendFile', 'mkdir', 'rename', 'rmdir', 'rm(', 'unlink', 'createWriteStream', 'chmod', 'chown', 'copyFile', 'truncate(', 'ftruncate', 'utimes', 'symlink', 'link(', 'open(', 'fs.promises.open', 'writeSync', 'openSync', 'child_process'];
const ALLOWED_IMPORTS = new Map([
  ['node:fs/promises', ['readdir', 'stat', 'readFile', 'access']],
  ['node:fs', ['createReadStream']],
  ['node:readline', null],
  ['node:path', null],
  ['./path-key.js', null],
]);

test('[F3-R22] el fuente de claude-discovery.js no contiene llamadas de escritura y solo importa lo permitido', async () => {
  const source = await fs.readFile(path.join(PANEL_DIR, 'lib', 'claude-discovery.js'), 'utf8');
  for (const word of FORBIDDEN) assert.ok(!source.includes(word), `cadena prohibida: ${word}`);
  const imports = [...source.matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm)];
  assert.ok(imports.length > 0);
  for (const [, clause, from] of imports) {
    assert.ok(ALLOWED_IMPORTS.has(from), `importación no permitida: ${from}`);
    const names = ALLOWED_IMPORTS.get(from);
    if (names) {
      assert.match(clause, /^\{[^}]*\}$/, `${from} debe importarse con nombres`);
      const used = clause.slice(1, -1).split(',').map((n) => n.trim()).filter(Boolean);
      for (const n of used) assert.ok(names.includes(n), `${from}: ${n} no permitido`);
    }
  }
  assert.ok(!/\bimport\s*\(/.test(source), 'sin importaciones dinámicas');
  assert.ok(!/\brequire\s*\(/.test(source), 'sin require');
});

test('[F3-R22] tras un escaneo completo el árbol de claudeHome es idéntico (nombres, tamaños y mtime)', async () => {
  const base = await makeBaseClaudeHome();
  dirs.push(base.claudeHome);
  const before = await snapshotTree(base.claudeHome);
  const discovery = createClaudeDiscovery({ claudeHome: base.claudeHome, now: fixedNow, ttlMs: 0, log: spyLog() });
  await discovery.scan();
  await discovery.scan({ force: true });
  await discoverClaudeProjects({ claudeHome: base.claudeHome, now: fixedNow, log: spyLog(), maxFileBytes: 10, headLines: 1 });
  const after = await snapshotTree(base.claudeHome);
  assert.deepEqual(after, before);
});

// ---------- Fase 4: mejora M1 (F4-R92) ----------

test('[F4-R92] un summary de 120 caracteres se recorta con clipTitle a 80 + "…"', async () => {
  const summary = 'r'.repeat(120);
  const { session } = await singleSession([sessionLine({ type: 'summary', summary }), sessionLine({ type: 'user', text: 'hola' })]);
  assert.equal([...session.title].length, 81);
  assert.ok(session.title.endsWith('…'));
  assert.equal(session.title, 'r'.repeat(80) + '…');
  const spaced = await singleSession([sessionLine({ type: 'summary', summary: '  Resumen   con  espacios ' })]);
  assert.equal(spaced.session.title, 'Resumen con espacios');
});
