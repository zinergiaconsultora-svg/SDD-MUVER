// Fixtures de Claude Code para los tests de la fase 3 (design.md §6.1).
// Todo se crea en directorios temporales: NUNCA se toca el ~/.claude ni el ~/.claude.json reales.
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir } from './helpers.js';

/** Codificación de carpetas de Claude Code (misma regla que lib/path-key.js, duplicada para no depender de ella). */
export function encodeForFixture(projectPath) {
  return String(projectPath).replace(/[\\/:]/g, '-');
}

/**
 * Línea de sesión con el formato de design.md §3.1. `blocks` sustituye a `text` como contenido en array.
 * Los campos `undefined` no se incluyen.
 */
export function sessionLine({ type = 'user', text, timestamp, cwd, gitBranch, summary, blocks, role } = {}) {
  const line = { type };
  if (type === 'summary') {
    if (summary !== undefined) line.summary = summary;
    return line;
  }
  if (timestamp !== undefined) line.timestamp = timestamp;
  if (cwd !== undefined) line.cwd = cwd;
  if (gitBranch !== undefined) line.gitBranch = gitBranch;
  const content = blocks !== undefined ? blocks : text;
  if (content !== undefined) line.message = { role: role || (type === 'assistant' ? 'assistant' : 'user'), content };
  return line;
}

function serializeLines(lines) {
  return lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
}

/** Escribe `<dir>/<id>.jsonl` con las líneas dadas (objetos → JSON; cadenas → tal cual). `mtime` opcional (Date o ms). */
export async function writeSession(dir, id, lines, { mtime } = {}) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  await fs.writeFile(file, serializeLines(lines), 'utf8');
  if (mtime !== undefined) {
    const date = mtime instanceof Date ? mtime : new Date(mtime);
    await fs.utimes(file, date, date);
  }
  return file;
}

/**
 * Crea un claudeHome temporal.
 * - config: objeto para .claude.json, cadena cruda, o undefined para no crearlo.
 * - projects: { '<carpeta codificada>': { '<id>': [líneas] } }; con `projects` undefined no se crea .claude/projects.
 * - extraFiles: { 'ruta/relativa/a/projectsDir': contenido } para ficheros sueltos, subcarpetas, etc.
 */
export async function makeClaudeHome({ config, projects, extraFiles } = {}) {
  const claudeHome = await makeTempDir('muver-claude-');
  const configFile = path.join(claudeHome, '.claude.json');
  const projectsDir = path.join(claudeHome, '.claude', 'projects');
  if (config !== undefined) {
    await fs.writeFile(configFile, typeof config === 'string' ? config : JSON.stringify(config, null, 2), 'utf8');
  }
  if (projects !== undefined || extraFiles !== undefined) {
    await fs.mkdir(projectsDir, { recursive: true });
    for (const [folder, sessions] of Object.entries(projects || {})) {
      const dir = path.join(projectsDir, folder);
      await fs.mkdir(dir, { recursive: true });
      for (const [id, lines] of Object.entries(sessions)) await writeSession(dir, id, lines);
    }
    for (const [rel, content] of Object.entries(extraFiles || {})) {
      const file = path.join(projectsDir, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf8');
    }
  }
  return { claudeHome, projectsDir, configFile };
}

/** Instantánea recursiva (ruta relativa, tamaño, mtimeMs) de un árbol, ordenada; para el test de solo lectura (R22). */
export async function snapshotTree(dir) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const stats = await fs.stat(full);
      out.push({ rel: path.relative(dir, full), type: entry.isDirectory() ? 'dir' : 'file', size: entry.isDirectory() ? 0 : stats.size, mtimeMs: stats.mtimeMs });
      if (entry.isDirectory()) await walk(full);
    }
  }
  await walk(dir);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

export const WINDOWS_FLYDER = 'C:\\Users\\Usuario\\app-flyder';
export const FLYDER_FOLDER = 'C--Users-Usuario-app-flyder';
export const VIEJO_FOLDER = 'C--Users-Usuario-viejo';

/**
 * Los cinco fixtures base de design.md §6.1:
 * - carpeta resuelta por `cwd` (POSIX, `projADir`) con 2 sesiones, `notas.txt` y `tools/0003-cccc.jsonl` ignorados;
 * - `C--Users-Usuario-app-flyder` sin `cwd`, resuelta por la clave Windows de `.claude.json`;
 * - `C--Users-Usuario-viejo` sin `cwd` ni clave → no resuelta;
 * - carpeta con líneas corruptas (`rotoDir`);
 * - `suelto.jsonl` en la raíz del directorio de proyectos (ignorado).
 * `projADir`/`rotoDir` pueden ser directorios temporales reales (para `exists: true` en integración).
 */
export async function makeBaseClaudeHome({ projADir = '/tmp/muver-proy-a', rotoDir = '/tmp/muver-roto' } = {}) {
  const projAFolder = encodeForFixture(projADir);
  const rotoFolder = encodeForFixture(rotoDir);
  const home = await makeClaudeHome({
    config: {
      numStartups: 3,
      projects: {
        [WINDOWS_FLYDER]: {
          allowedTools: [],
          history: [{ display: 'implementa la siguiente tarea pendiente', pastedContents: {} }, { display: 'revisa los tests' }],
        },
        [projADir]: { history: [{ display: 'arranca el proyecto A' }] },
      },
    },
    projects: {
      [projAFolder]: {
        '0001-aaaa': [
          sessionLine({ type: 'summary', summary: 'Resumen de la sesión A1' }),
          sessionLine({ type: 'user', text: 'hola A1', timestamp: '2026-10-20T10:00:00.000Z', cwd: projADir, gitBranch: 'main' }),
          sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'respuesta' }], timestamp: '2026-10-20T10:05:00.000Z', cwd: projADir, gitBranch: 'main' }),
        ],
        '0002-bbbb': [
          sessionLine({ type: 'user', text: 'segunda sesión de A', timestamp: '2026-10-22T09:00:00.000Z', cwd: projADir, gitBranch: 'feature/x' }),
        ],
      },
      [FLYDER_FOLDER]: {
        '1111-dddd': [
          sessionLine({ type: 'user', text: 'implementa la siguiente tarea pendiente', timestamp: '2026-10-24T09:12:03.000Z', gitBranch: 'main' }),
          sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'Voy a leer…' }], timestamp: '2026-10-24T09:12:40.000Z' }),
        ],
      },
      [VIEJO_FOLDER]: {
        '2222-eeee': [sessionLine({ type: 'user', text: 'proyecto viejo', timestamp: '2026-01-01T00:00:00.000Z' })],
      },
      [rotoFolder]: {
        '3333-ffff': [
          '{ roto',
          '',
          '"cadena"',
          '{}',
          sessionLine({ type: 'user', text: 'mensaje válido', timestamp: '2026-10-23T08:00:00.000Z', cwd: rotoDir }),
          sessionLine({ type: 'assistant', blocks: [{ type: 'text', text: 'ok' }], timestamp: '2026-10-23T08:01:00.000Z' }),
        ],
      },
    },
    extraFiles: {
      'suelto.jsonl': JSON.stringify(sessionLine({ type: 'user', text: 'suelto', cwd: '/tmp/suelto' })) + '\n',
      [path.join(projAFolder, 'notas.txt')]: 'notas que no son una sesión\n',
      [path.join(projAFolder, 'tools', '0003-cccc.jsonl')]: JSON.stringify(sessionLine({ type: 'user', text: 'subcarpeta', cwd: '/tmp/otra' })) + '\n',
    },
  });
  return { ...home, projADir, rotoDir, projAFolder, rotoFolder };
}
