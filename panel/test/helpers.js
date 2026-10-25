// Utilidades compartidas por los tests: directorios y repos git temporales,
// registro de proyectos y arranque de la app en puerto 0.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export const PANEL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(PANEL_DIR, 'public');

/** Crea un directorio temporal único dentro de os.tmpdir(). */
export async function makeTempDir(prefix = 'muver-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Devuelve true si `git --version` responde; los tests que necesitan git real se saltan si no. */
export async function hasGit() {
  try {
    await execFileAsync('git', ['--version'], { timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Ejecuta git dentro de `dir` (solo para preparar fixtures). */
export async function git(dir, args) {
  return execFileAsync('git', args, { cwd: dir, timeout: 10000, windowsHide: true });
}

/**
 * Crea un directorio de proyecto temporal con, opcionalmente:
 * - featureList: objeto (o string crudo) que se escribe en feature_list.json
 * - currentMd: texto de progress/current.md
 * - git: { commits: ['msg1', 'msg2'], dirtyFile: 'nombre.txt' } → repo real con esos commits
 */
export async function makeProjectDir({ featureList, currentMd, git: gitOptions } = {}) {
  const dir = await makeTempDir('muver-project-');

  if (featureList !== undefined) {
    const content = typeof featureList === 'string' ? featureList : JSON.stringify(featureList, null, 2);
    await fs.writeFile(path.join(dir, 'feature_list.json'), content, 'utf8');
  }

  if (currentMd !== undefined) {
    await fs.mkdir(path.join(dir, 'progress'), { recursive: true });
    await fs.writeFile(path.join(dir, 'progress', 'current.md'), currentMd, 'utf8');
  }

  if (gitOptions) {
    await git(dir, ['init', '-q', '-b', 'main']);
    await git(dir, ['config', 'user.name', 'Test MUVER']);
    await git(dir, ['config', 'user.email', 'test@muver.local']);
    await git(dir, ['config', 'commit.gpgsign', 'false']);
    const commits = gitOptions.commits || [];
    for (let i = 0; i < commits.length; i++) {
      await fs.writeFile(path.join(dir, `commit-${i + 1}.txt`), `contenido ${i + 1}\n`, 'utf8');
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-q', '-m', commits[i]]);
    }
    if (gitOptions.dirtyFile) {
      await fs.writeFile(path.join(dir, gitOptions.dirtyFile), 'sin commitear\n', 'utf8');
    }
  }

  return dir;
}

/** Escribe un projects.json con la lista dada y devuelve la ruta del fichero. */
export async function writeRegistry(file, projects) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ projects }, null, 2), 'utf8');
  return file;
}

/** Arranca la app en puerto 0 y devuelve baseUrl, server y close(). */
export async function startApp(options = {}) {
  const { createApp } = await import('../lib/app.js');
  const server = createApp({ publicDir: PUBLIC_DIR, ...options });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Pequeño wrapper sobre fetch que devuelve status, headers y cuerpo (texto y JSON si aplica). */
export async function request(baseUrl, urlPath, init = {}) {
  const res = await fetch(baseUrl + urlPath, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** Elimina un directorio temporal sin fallar si ya no existe. */
export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
