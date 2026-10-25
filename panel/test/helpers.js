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

/**
 * Arranca la app en puerto 0. Si no recibe `dataDir` crea uno temporal; si recibe `password`
 * escribe `auth.json` con esa contraseña antes de arrancar. Acepta `now`, `trustProxy`, `secureCookies`.
 * Fase 3: `claudeHome` (por defecto un directorio temporal VACÍO, para que ningún test vea el ~/.claude real
 * de la máquina → Claude no disponible) y `claudeCacheTtlMs` (por defecto 0: cada GET refleja los fixtures).
 * Devuelve { server, baseUrl, dataDir, claudeHome, close, login(password?) → cabecera Cookie }.
 */
export async function startApp(options = {}) {
  const { createApp } = await import('../lib/app.js');
  const { password, dataDir: givenDataDir, claudeHome: givenClaudeHome, claudeCacheTtlMs = 0, ...rest } = options;
  const dataDir = givenDataDir || (await makeTempDir('muver-data-'));
  const claudeHome = givenClaudeHome || (await makeTempDir('muver-claude-vacio-'));
  if (password !== undefined) {
    const { createAuthRecord, saveAuth } = await import('../lib/auth.js');
    await saveAuth(path.join(dataDir, 'auth.json'), await createAuthRecord(password));
  }
  const server = createApp({ publicDir: PUBLIC_DIR, dataDir, claudeHome, claudeCacheTtlMs, ...rest });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    server,
    baseUrl,
    dataDir,
    claudeHome,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      if (!givenClaudeHome) await fs.rm(claudeHome, { recursive: true, force: true });
    },
    async login(pwd = password, init = {}) {
      const r = await request(baseUrl, '/api/auth/login', { method: 'POST', body: JSON.stringify({ password: pwd }), ...init });
      if (r.status !== 200 || !r.setCookie) throw new Error(`login falló: ${r.status} ${r.text}`);
      return cookieHeaderFromSetCookie(r.setCookie);
    },
  };
}

/** Convierte un valor de Set-Cookie en el valor que iría en la cabecera Cookie ("nombre=valor"). */
export function cookieHeaderFromSetCookie(setCookie) {
  return String(setCookie).split(';')[0].trim();
}

/**
 * Wrapper sobre fetch que devuelve status, headers, cuerpo (texto y JSON) y `setCookie`.
 * Añade `X-Requested-With: fetch` a toda mutación (método distinto de GET/HEAD: POST, DELETE, PATCH, PUT…; fase 3)
 * salvo `init.csrf === false`; `init.cookie` → cabecera Cookie.
 */
export async function request(baseUrl, urlPath, init = {}) {
  const { csrf, cookie, headers: givenHeaders, ...rest } = init;
  const headers = { ...(givenHeaders || {}) };
  const method = String(rest.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && csrf !== false) headers['X-Requested-With'] = 'fetch';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(baseUrl + urlPath, { ...rest, headers, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, headers: res.headers, text, json, setCookie: setCookie || null };
}

/** Reloj controlable para el `now` inyectado. */
export function makeClock(start = Date.now()) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    },
    set(value) {
      current = value;
    },
  };
}

/** Parsea una cabecera Set-Cookie: { name, value, attributes: Set<string en minúsculas> }. */
export function parseSetCookie(header) {
  const parts = String(header).split(';').map((p) => p.trim()).filter(Boolean);
  const [name, ...valueParts] = parts[0].split('=');
  const attributes = new Set(parts.slice(1).map((a) => a.toLowerCase()));
  return { name, value: valueParts.join('='), attributes };
}

/** Elimina un directorio temporal sin fallar si ya no existe. */
export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
