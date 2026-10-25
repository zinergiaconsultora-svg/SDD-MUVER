// Utilidades de los tests de la feature 13 (design.md §7.1): repos git reales con worktrees (`git worktree add`),
// escenario del CLI falso por fichero en la carpeta del proyecto y esperas del lote y del registro.
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir, git, request } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crea `<base>/main` (repo con un commit en `main`) y, por cada nombre, `git worktree add ../<name> -b claude/<name>`.
 * Devuelve { base, main, worktrees: { [name]: dir } }. Quien llama comprueba antes `hasGit()`.
 */
export async function makeRepoWithWorktrees(names = [], { mainName = 'main' } = {}) {
  const base = await makeTempDir('muver-f13-wt-');
  const main = path.join(base, mainName);
  await fs.mkdir(main);
  await git(main, ['init', '-q', '-b', 'main']);
  await git(main, ['config', 'user.name', 'Test MUVER']);
  await git(main, ['config', 'user.email', 'test@muver.local']);
  await git(main, ['config', 'commit.gpgsign', 'false']);
  await fs.writeFile(path.join(main, 'README.md'), '# Principal\n\nRepositorio principal de prueba para los worktrees.\n', 'utf8');
  await git(main, ['add', '-A']);
  await git(main, ['commit', '-q', '-m', 'Inicial']);
  const worktrees = {};
  for (const name of names) {
    await git(main, ['worktree', 'add', '-q', `../${name}`, '-b', `claude/${name}`]);
    worktrees[name] = path.join(base, name);
  }
  return { base, main, worktrees };
}

/** Escribe `.fake-claude-scenario` en `dir`: primera línea el escenario y, opcional, la segunda el texto del result. */
export async function writeScenario(dir, name, text) {
  const content = text === undefined || text === null ? `${name}\n` : `${name}\n${text}\n`;
  await fs.writeFile(path.join(dir, '.fake-claude-scenario'), content, 'utf8');
}

/** Sondea GET /api/summaries/batch hasta que el lote esté en uno de `states` (por defecto done/cancelled). */
export async function waitForBatch(app, cookie, states = ['done', 'cancelled'], { timeoutMs = 15000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await request(app.baseUrl, '/api/summaries/batch', { cookie });
    last = r;
    if (r.status === 200 && r.json && r.json.batch && states.includes(r.json.batch.state)) return r.json.batch;
    await sleep(intervalMs);
  }
  throw new Error(`El lote no llegó a ${states.join('/')} (último: ${last && last.text})`);
}

/** Espera a que `predicate(registro)` sea verdadero leyendo `file` (JSON { projects }). Devuelve el registro. */
export async function waitForRegistry(file, predicate, { timeoutMs = 10000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = JSON.parse(await fs.readFile(file, 'utf8'));
      if (predicate(last)) return last;
    } catch {
      // Fichero a medio escribir o inexistente: se reintenta.
    }
    await sleep(intervalMs);
  }
  throw new Error(`El registro no cumplió la condición (último: ${JSON.stringify(last)})`);
}
