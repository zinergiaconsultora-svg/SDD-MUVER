# Diseño — Feature 14: endurecimiento de la ejecución (hallazgos del reviewer de la fase 4)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo solo esta carpeta,
> `docs/conventions.md` y el código actual de `panel/` (fase 4 con su corrección T36). Las referencias `fichero:línea`
> son las del informe `progress/review_puesto-de-mando-trabajar.md` sobre el HEAD `4e5e34f`.
>
> Regla de oro de esta feature: **el panel nunca lanza un proceso con un nombre suelto ni con una ruta que esté en la
> carpeta del proyecto o de otro proyecto del catálogo**, salvo el script de tests que el humano escribió a propósito
> con ruta relativa (§3.6).

## 1. Decisiones técnicas (resumen)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | **Resolvedor único** `lib/trusted-bin.js` (`createBinaryResolver`, `resolveTrustedBinary`, `isTrustedPath`) que devuelve rutas absolutas buscando solo en entradas absolutas de `PATH` y rutas conocidas. | En Windows libuv busca un nombre suelto primero en el `cwd` del hijo (`.com`/`.exe`) y después en `PATH` (M1). Una sola pieza con tests evita que cada módulo lo haga a su manera. |
| D2 | **Exclusión por carpeta**: se descartan candidatos dentro del `cwd` de la llamada y de cualquier proyecto del catálogo (por ruta y por ruta real). De un **proyecto contenedor** (raíz, `HOME` o ancestro) solo se excluye su raíz. | El ataque real es un ejecutable en la raíz del proyecto; las subcarpetas son defensa extra. Si alguien registra su carpeta personal como proyecto (Claude Code abierto en `~`), excluir el subárbol dejaría fuera `~/.local/bin/claude.exe` y Git per-user y el panel dejaría de funcionar. |
| D3 | **Guardia final al lanzar**: `runs.js` (spawn), el runner de git (`execFile`) y `taskkill` comprueban `isTrustedPath` justo antes de crear el proceso. | Defensa en profundidad: aunque una ruta llegue por otro camino (un `claudeCommand` inyectado, un paso mal construido), no se lanza nada fuera de la regla. |
| D4 | **Runner de git centralizado** (`createGitRunner` en `git-info.js`): recibe el nombre lógico `git`, lo resuelve, antepone `-c core.fsmonitor=false` y llama a `execFile`. Los llamadores (`git-info`, `git-actions`, futuras consultas de la feature 13) siguen pasando `'git'`. | Los espías de los tests existentes (`call.file === 'git'`) siguen valiendo; el prefijo y la resolución se aplican a toda consulta presente y futura sin tocar cada lista de argumentos. |
| D5 | **Claude se resuelve en cada lanzamiento** (con caché del resolvedor) a partir de `claudeBin`, no una vez al arrancar. | El catálogo cambia en caliente; así la exclusión usa siempre el `cwd` del run y el catálogo vigente. |
| D6 | **Comandos amplios** (`isBroadCommand`, listas en §3.5): nunca se proponen; si el humano los añade, la API exige `acknowledgeBroad: true` y la UI muestra un aviso con confirmación. | M2: `Bash(node *)` incluye `node -e`, `Bash(git *)` incluye `git -c core.sshCommand=…`. No se prohíben: el humano puede necesitarlos (decisión: aviso, no prohibición). |
| D7 | **`-c core.fsmonitor=false` en todas las llamadas git del panel**; en el diff además `--no-ext-diff --no-textconv` y `--literal-pathspecs`. **No** `-c core.hooksPath=` en lecturas. | `status`/`diff` ejecutan `core.fsmonitor` del `.git/config`; el diff ejecutaría drivers externos y `textconv`; las lecturas (`status`, `diff`, `log`, `rev-parse`) no ejecutan hooks, así que vaciar `hooksPath` ahí no aporta. |
| D8 | **Hooks en "Commit y push": se ejecutan** (sin `--no-verify`), y el diálogo de confirmación avisa con sus nombres si hay hooks activos. | Los hooks suelen ser del propio humano (linters, tests); desactivarlos en silencio cambiaría el resultado del commit respecto a la terminal. El aviso hace visible un hook que no reconozca. |
| D9 | **Push con `GIT_SSH_COMMAND=ssh -o BatchMode=yes`** salvo que el entorno del panel ya defina `GIT_SSH_COMMAND` o `GIT_SSH`. | M4: una clave con frase o un host desconocido fallan al momento en vez de esperar 30 min. Efecto adicional: anula un `core.sshCommand` del repo. |
| D10 | **Límite de salida para todos los eventos** salvo `state`/`end`; `permissionDenials` ≤ 50. | M5: ningún tipo de evento esquiva los 5 MB ni hace crecer `index.json` sin tope. |
| D11 | **`approve-spec` → `409` con un run activo** en el proyecto. | N4: evita que la escritura del panel y la de Claude sobre `feature_list.json` se pisen. |
| D12 | **En Windows, `NoDefaultCurrentDirectoryInExePath=1`** en el entorno de los hijos. | Defensa adicional para los nietos que lancen programas por nombre con la API de Windows o `cmd.exe` (no garantiza nada para los que usan libuv: §11). |

## 2. Estructura de ficheros

```
panel/
  lib/
    trusted-bin.js          NUEVO  resolvedor y guardia (§5.1)
    git-info.js             createGitRunner + defaultRunner con resolvedor y prefijo (§5.2)
    git-actions.js          prefijo en pasos, diff literal, hooks, SSH BatchMode (§5.4)
    exec-utils.js           resolveExecutable delega en el resolvedor; taskkill absoluto (§5.3)
    claude-cli.js           resolveClaudeCommand con resolvedor; isBroadCommand; sugerencias; regex; tope de denegaciones (§5.5)
    runs.js                 guardia al lanzar, NoDefaultCurrentDirectoryInExePath, límite para todos los eventos (§5.6)
    sdd-actions.js          resolveTestCommand: nombre / absoluta / relativa con separador (§5.7)
    work-api.js             cableado del resolvedor, Claude por lanzamiento, permisos con aviso, approve-spec 409, hooks, broadCommands (§5.8)
    app.js                  crea el resolvedor y el runner de git, opción env, instantánea de carpetas del catálogo, PATCH con aviso (§5.9)
  server.js                 pasa claudeBin en lugar de un claudeCommand ya resuelto (§5.10)
  public/
    work.js                 funciones puras de avisos (§6)
    app.js                  diálogos de aviso (comando amplio, hooks) y confirmLabel (§6)
  test/
    trusted-bin.test.js     NUEVO  unitarios del resolvedor
    hardening.test.js       NUEVO  integración: ejecutables falsos, fsmonitor, diff literal, hooks, approve-spec
    fixtures/fake-claude.js escenario nuevo `flood`
    (ampliados) exec-utils, claude-cli, git-info, git-actions, runs-api, work-api, work-render, deploy
docs/architecture.md        sección "Seguridad de la ejecución" (§9.2)
docs/verification.md        sección Feature 14 (§8.5)
specs/puesto-de-mando-trabajar/design.md   correcciones N1 y N2 (§9.1)
```

## 3. Resolvedor de ejecutables (M1)

### 3.1 API (`lib/trusted-bin.js`)

```js
createBinaryResolver({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  panelDir = process.cwd(),          // solo para CLAUDE_BIN relativo (§5.5)
  homeDir = os.homedir(),
  fsOps = defaultFsOps,              // { isFile(p) → bool, isExecutable(p) → bool, realpath(p) → string|null }
  getProjectDirs = () => [],         // carpetas del catálogo vigente (instantánea, §5.9)
  bashBin = null,                    // PANEL_BASH_BIN
}) → {
  resolve(name, { cwd }) → { ok: true, file, prefixArgs } | { ok: false, error },
  isTrustedPath(file, { cwd }) → boolean,
  excludedDirs({ cwd }) → string[],  // para tests y mensajes
}

resolveTrustedBinary(name, { cwd, resolver = defaultResolver })   // envoltorio con el resolvedor por defecto
isTrustedPath(file, { cwd, resolver = defaultResolver })
BIN_ERRORS                                                         // textos de §4.1
```

- `defaultFsOps`: `isFile` = `fs.statSync(p).isFile()` (falso si lanza); `isExecutable` = en Windows `true`, en POSIX
  `fs.accessSync(p, fs.constants.X_OK)` sin lanzar; `realpath` = `fs.realpathSync.native(p)` o `null` si lanza.
- `defaultResolver` = `createBinaryResolver()` con `getProjectDirs` vacío (solo excluye el `cwd` de la llamada). La app
  crea el suyo con el catálogo (§5.9) y lo inyecta en todos los módulos.
- `name` válido: `^[A-Za-z0-9._+-]{1,64}$` (sin separadores). Si no cumple → `{ ok: false, error: BIN_ERRORS.invalidName }`.

### 3.2 Rutas conocidas por nombre (se prueban **después** de `PATH`, salvo donde se indica)

| Nombre (sin `.exe`, en minúsculas) | `win32` | POSIX |
|---|---|---|
| `node` | **siempre** `execPath` (no mira `PATH`) | **siempre** `execPath` |
| `npm`, `npx` | **siempre** `execPath` + `<dir de execPath>\node_modules\npm\bin\<npm\|npx>-cli.js` (como hoy); si no existe → error `.cmd` de la fase 4 | `PATH` |
| `git` | `PATH`; luego `%ProgramFiles%\Git\cmd\git.exe`, `%ProgramFiles(x86)%\Git\cmd\git.exe`, `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` | `PATH` |
| `bash` | **solo** los candidatos de `findGitBash` (orden de la fase 4: `bashBin`, `CLAUDE_CODE_GIT_BASH_PATH`, `Program Files…\Git\bin\bash.exe`, `LOCALAPPDATA…`), cada uno solo si es absoluto, nunca `System32`/`sysnative`, y sin mirar `PATH` | `bashBin` si es absoluto; luego `PATH` |
| `claude` | `PATH` (`claude.exe`/`.com`); luego `%USERPROFILE%\.local\bin\claude.exe`; luego, en las carpetas de `PATH` ya filtradas, `claude.cmd` + `node_modules\@anthropic-ai\claude-code\cli.js` → `{ file: execPath, prefixArgs: [cli.js] }` | `PATH`; luego `$HOME/.local/bin/claude` |
| `taskkill` | **solo** `%SystemRoot%\System32\taskkill.exe` (`C:\Windows` si falta `SystemRoot`), sin comprobar existencia | no aplica |
| cualquier otro | `PATH` | `PATH` |

Extensiones en Windows: si el nombre ya termina en `.exe`/`.com` se busca tal cual; si no, `<n>.com` y luego `<n>.exe`
en cada carpeta. **Nunca** `.cmd`, `.bat`, `.ps1` ni sin extensión. Si en las carpetas filtradas solo hay un
`.cmd`/`.bat` del nombre → error `CMD_SCRIPT_ERROR` de la fase 4 (se conserva el texto). En POSIX el candidato debe ser
fichero regular y ejecutable (`X_OK`).

### 3.3 Algoritmo

```
resolve(name, { cwd }):
  1. validar name (§3.1); nombre lógico = minúsculas sin .exe/.com (solo para elegir la fila de §3.2)
  2. si la fila es "siempre execPath" o taskkill → devolver esa ruta (pasa igualmente por isTrustedPath)
  3. candidatos = cache.get(name) ?? buscar(name)          // §3.4
  4. excluidas = excludedDirs({ cwd })
  5. para cada c en candidatos (en orden):
        si estaExcluido(c.file, excluidas) o (c.real y estaExcluido(c.real, excluidas)) → siguiente
        devolver { ok: true, file: c.file, prefixArgs: c.prefixArgs }
  6. si candidatos.length > 0 → { ok: false, error: BIN_ERRORS.onlyInProject(name) }
     si no                    → { ok: false, error: BIN_ERRORS.notFound(name) }

buscar(name):
  dirs = carpetasPath(env)          // PATH (o Path en Windows), separador ';' en win32 y ':' en POSIX
     - quitar espacios y comillas dobles que rodeen la entrada
     - descartar: '' , '.', entradas con '%', relativas
       (win32: deben cumplir /^[A-Za-z]:\\/ o empezar por '\\\\'; POSIX: deben empezar por '/')
     - quitar duplicados por pathKey
  lista = [] ; para cada dir y cada nombre de fichero (§3.2): si fsOps.isFile y fsOps.isExecutable → push
  añadir rutas conocidas de §3.2 que existan
  cada entrada: { file, prefixArgs, real: fsOps.realpath(file) }
  si lista no vacía → cache.set(name, lista)
  return lista

excludedDirs({ cwd }) = únicas por pathKey de [cwd, ...getProjectDirs()] filtrando vacías y no absolutas

estaExcluido(file, excluidas):
  dirKey = pathKey(dirname(file)) ; fileKey = pathKey(file)
  para cada P en excluidas (pk = pathKey(P)):
     si dirKey === pk → true                         // directamente en la raíz del proyecto o del cwd
     si !esContenedor(P) y fileKey empieza por pk + sep → true   // dentro del subárbol
  false

esContenedor(P): P es raíz (C:\, \\srv\share, /) o pathKey(P) === pathKey(homeDir) o homeDir está dentro de P

isTrustedPath(file, { cwd }) = file es absoluta (win32: /^[A-Za-z]:\\/ o UNC; POSIX: '/')
                               y !estaExcluido(file) y !estaExcluido(realpath(file) ?? file)
```

- Las comparaciones usan `pathKey` (`lib/path-key.js`): en Windows sin distinguir mayúsculas.
- El `cwd` de la llamada siempre se excluye **entero** (también si es contenedor se excluye su raíz, que es donde
  busca libuv).
- `homeDir` en Windows = `env.USERPROFILE` si está; en POSIX = `env.HOME` o `os.homedir()`.

### 3.4 Caché

- `Map` nombre → lista de candidatos, calculada una vez con el `PATH` del arranque; dura lo que el proceso. Los
  fallos (lista vacía) no se guardan: si el humano instala git con el panel en marcha, la siguiente llamada lo
  encuentra (sin reiniciar), pero un cambio del `PATH` del sistema solo se ve al reiniciar el panel.
- La exclusión (paso 5) se recalcula en cada llamada: depende del `cwd` y del catálogo vigente.

### 3.5 Comandos amplios (`isBroadCommand`, en `lib/claude-cli.js`)

Se normaliza con `normalizeCommand`; `tokens` = separar por espacios; `base(t0)` = último segmento tras `/`, en
minúsculas y sin `.exe`.

```js
export const WRAPPER_COMMANDS = Object.freeze([      // su argumento es otro comando: SIEMPRE amplios
  'env', 'sudo', 'doas', 'su', 'runas', 'xargs', 'find', 'nohup', 'time', 'timeout', 'nice', 'ionice', 'stdbuf',
  'setsid', 'chroot', 'flock', 'watch', 'parallel', 'exec', 'eval', 'command', 'builtin', 'start', 'cmd', 'script',
  'busybox', 'wsl', 'strace', 'ltrace', 'gdb',
]);
export const RUNNER_COMMANDS = Object.freeze([       // amplios a secas o seguidos de una opción (- o /)
  'node', 'nodejs', 'deno', 'bun', 'bunx', 'npx', 'pnpx', 'python', 'python2', 'python3', 'py', 'pythonw', 'pypy',
  'pypy3', 'uv', 'uvx', 'pipx', 'ruby', 'irb', 'perl', 'php', 'lua', 'luajit', 'java', 'jshell', 'rscript',
  'osascript', 'awk', 'gawk', 'mawk', 'nawk', 'sed', 'tclsh', 'wish', 'bash', 'sh', 'dash', 'zsh', 'ksh', 'fish',
  'csh', 'tcsh', 'pwsh', 'powershell', 'git', 'npm', 'pnpm', 'yarn', 'make',
]);
export const GIT_EXEC_SUBCOMMANDS = Object.freeze([  // git <sub> que ejecuta programas o cambia la configuración
  'config', 'submodule', 'bisect', 'rebase', 'filter-branch', 'difftool', 'mergetool', 'daemon', 'instaweb',
  'web--browse', 'credential', 'upload-pack', 'receive-pack', 'archive',
]);
export const PKG_EXEC_SUBCOMMANDS = Object.freeze(['exec', 'x', 'dlx', 'explore', 'create', 'init']); // npm/pnpm/yarn/bun
```

`isBroadCommand(cmd)` es `true` si:
1. `base(t0)` ∈ `WRAPPER_COMMANDS` (con cualquier argumento); o
2. `base(t0)` ∈ `RUNNER_COMMANDS` y (no hay `t1`, o `t1` empieza por `-` o por `/`), **salvo** la familia python
   (`python`, `python2`, `python3`, `py`, `pythonw`, `pypy`, `pypy3`) con `t1 === '-m'` y `t2` presente que no empieza
   por `-` (p. ej. `python -m pytest` no es amplio); o
3. `base(t0) === 'git'` y `t1` ∈ `GIT_EXEC_SUBCOMMANDS`; o
4. `base(t0)` ∈ `npm`, `pnpm`, `yarn`, `bun` y (`t1` ∈ `PKG_EXEC_SUBCOMMANDS`, o `t1 === 'run'` sin `t2` o con `t2` que
   empieza por `-`).

Tabla de los tests (R14): amplios → `node`, `node.exe`, `/usr/bin/python3`, `node -e`, `python -c`, `bash`, `bash -c`,
`env`, `env A=1 x`, `sudo ls`, `xargs`, `find .`, `git`, `git -c`, `git config`, `npm`, `npm exec`, `npm run`, `npx`,
`cmd /c`, `powershell -Command`, `make -f`; no amplios → `npm test`, `npm run build`, `git rev-list`, `git status`,
`node scripts/build.js`, `python -m pytest`, `bash init.sh`, `pwsh tools/x.ps1`, `cargo test`, `pytest`, `make test`,
`npx vitest`.

### 3.6 Comando de tests y scripts del proyecto

`resolveTestCommand` clasifica el primer token `t0` del comando ya parseado:

| `t0` | Resolución | Paso |
|---|---|---|
| sin `/` ni `\` (p. ej. `npm`, `pytest`, `git`) | resolvedor con `cwd` = carpeta del proyecto (y reglas `.js`/`npm`/`node` de §3.2) | `{ file, prefixArgs, args }` |
| termina en `.js`/`.mjs`/`.cjs` | `execPath` con el script como primer argumento (la ruta del script se deja tal cual: Node la resuelve contra el `cwd`, que es la carpeta del proyecto) | igual que hoy |
| ruta absoluta (`/x/y`, `C:\x\y.exe`) | tal cual (`.cmd`/`.bat` → error de la fase 4); debe pasar `isTrustedPath` (si apunta dentro del proyecto, usar la forma relativa) | `{ file }` |
| ruta relativa con separador (`./test.sh`, `scripts/test.exe`, `.\run.exe`) | `path.resolve(carpetaProyecto, t0)` (con `path.win32` en Windows); debe quedar **dentro** de la carpeta del proyecto, si no → `400` `invalidTestCommand('ruta fuera del proyecto')` | `{ file, projectScript: true }` |

`projectScript: true` es la **única** excepción a la guardia de §3.3: el gestor de runs acepta ese `file` si es
absoluto y está dentro del `cwd` del run. Se documenta en `docs/architecture.md`: escribir un comando de tests con
ruta relativa ejecuta código del proyecto, igual que `bash init.sh` (que lanza el `bash` de confianza con el script
del proyecto como argumento).

## 4. Contratos y textos nuevos

### 4.1 Textos de error y aviso exactos

```js
// lib/trusted-bin.js
export const BIN_ERRORS = Object.freeze({
  invalidName: (name) => `Nombre de programa no válido: «${name}»`,
  notFound: (name) => `No se encontró «${name}» en el PATH del panel (se ignoran las rutas relativas y las carpetas de los proyectos): instálalo o revisa el PATH y reinicia el panel`,
  onlyInProject: (name) => `«${name}» solo está dentro de la carpeta de un proyecto y el panel no ejecuta programas de los proyectos: instálalo fuera de ellos o revisa el PATH`,
  untrusted: (name) => `No se ejecuta «${name}»: el panel solo lanza programas con ruta absoluta fuera de las carpetas de los proyectos`,
});
```

- En `untrusted` y en los errores de lanzamiento, `name` es solo el último segmento de la ruta (`lastSegment`), para
  no exponer rutas absolutas del disco al cliente.
- `lib/claude-cli.js` → `export const MAX_PERMISSION_DENIALS = 50;`
- `lib/runs.js` → `NOTICES.denialsCapped = 'Se han alcanzado 50 denegaciones de permiso: no se registran más en esta ejecución'`.
- `lib/work-api.js` → `WORK_ERRORS.broadCommand = (list) => \`${list.length > 1 ? 'Comandos' : 'Comando'} de ejecución libre: ${list.map((c) => \`«${c}»\`).join(', ')}. Permite a Claude ejecutar cualquier programa en este proyecto; confírmalo expresamente para autorizarlo\``.
- `lib/claude-cli.js` → `isValidAllowedCommand` usa `ALLOWED_COMMAND_RE = /^(?![-])[A-Za-z0-9 ._:/=@+-]{1,200}$/` más
  la condición "no termina en `:`" (sobre el comando normalizado). El mensaje `WORK_ERRORS.invalidCommand` se amplía a
  `'Comando no válido: solo letras, números, espacios y . _ : / = @ + - (máx. 200; no puede empezar por - ni terminar en :)'`
  y el mismo texto en `EXEC_ERRORS.invalidCommand` de `registry.js` (única línea que cambia en ese fichero).

### 4.2 API

| Ruta | Cambio |
|---|---|
| `POST /api/projects/:id/permissions` | Cuerpo `{ command, acknowledgeBroad? }`. Comando amplio sin `acknowledgeBroad === true` → `400 { error: WORK_ERRORS.broadCommand([cmd]), field: 'command', needsAcknowledge: true, broadCommands: [cmd] }` sin guardar. Con la marca → como hoy y `detail.acknowledgedBroad = [cmd]` en la auditoría. Un comando ya guardado → `200` como hoy (sin pedir marca). |
| `PATCH /api/projects/:id` | Tras `validatePatch`: `nuevos = valid.changes.allowedCommands` amplios que **no** estén en los guardados. Si hay y `body.acknowledgeBroad !== true` → `400 { error: WORK_ERRORS.broadCommand(nuevos), field: 'allowedCommands', needsAcknowledge: true, broadCommands: nuevos }` sin guardar **ningún** campo. Con la marca → guarda y audita `acknowledgedBroad`. `acknowledgeBroad` no es campo de `PATCHABLE_FIELDS` y no se guarda. |
| `GET /api/projects/:id/work` | Añade `broadCommands: string[]` (amplios de `allowedCommands`, en su orden). |
| `GET /api/projects/:id/changes` | Añade `hooks: string[]` y `hooksPathCustom: boolean` (§5.4). |
| `POST /api/projects/:id/sdd/approve-spec` | Tras la puerta y la resolución del proyecto, si `runs.activeFor(id)` → `409 { error: WORK_ERRORS.runActive, runId }`. |
| `POST /runs`, `sdd/implement`, `sdd/approve-tests` | Si Claude no se resuelve → `409 { error: <texto de §4.1> }` (antes: `{ file: 'claude' }` y ENOENT). |
| `POST /tests`, `git/commit-push` | Si un ejecutable no se resuelve → `409 { error: <texto de §4.1> }`. |

`createApp` acepta dos opciones nuevas: `env` (por defecto `process.env`; se pasa al resolvedor, a `work-api` y a los
runs) y `claudeBin` (por defecto `'claude'`). `claudeCommand` se sigue aceptando (tests): si viene, se usa tal cual
pero pasa por la guardia en cada lanzamiento. Opción de prueba `binaryResolver` para inyectar un resolvedor.

## 5. Módulos y funciones

### 5.1 `lib/trusted-bin.js` (nuevo)

Contrato de §3.1–§3.4. Sin dependencias fuera de `node:fs`, `node:os`, `node:path` y `./path-key.js`. Exporta además
`parsePathEntries(raw, platform)` (paso de filtrado de §3.3) para probarlo aparte.

### 5.2 `lib/git-info.js`

```js
export const GIT_SAFE_PREFIX = Object.freeze(['-c', 'core.fsmonitor=false']);
export function createGitRunner({ resolver = defaultResolver, execFileImpl = execFile, platform = process.platform } = {}) {
  return (file, args, opts = {}) => {
    if (file !== 'git') return Promise.reject(Object.assign(new Error(BIN_ERRORS.untrusted(String(file))), { code: 'EUNTRUSTED' }));
    const r = resolver.resolve('git', { cwd: opts.cwd });
    if (!r.ok) return Promise.reject(Object.assign(new Error(r.error), { code: 'ENOTFOUND_BIN' }));
    if (!resolver.isTrustedPath(r.file, { cwd: opts.cwd })) return Promise.reject(/* untrusted */);
    const env = platform === 'win32' ? { ...(opts.env || process.env), NoDefaultCurrentDirectoryInExePath: '1' } : opts.env;
    return execFileP(r.file, [...GIT_SAFE_PREFIX, ...args], { ...opts, ...(env ? { env } : {}), shell: false });
  };
}
export const defaultRunner = createGitRunner();
```

- `GIT_COMMANDS` **no cambia** (el prefijo lo pone el runner). `getGitInfo` no cambia.
- Un fallo de resolución hace que `getGitInfo` devuelva la forma ausente (como hoy con `ENOENT`).

### 5.3 `lib/exec-utils.js`

- `resolveExecutable(name, { platform, env, execPath, exists, bashBin, resolver, cwd })`:
  - Si no se pasa `resolver`, crea uno con `createBinaryResolver({ platform, env, execPath, bashBin, fsOps: { isFile: exists, isExecutable: () => true, realpath: () => null } })` (compatibilidad con los tests de la fase 4, que inyectan `exists`).
  - Ruta absoluta → como hoy (`.cmd`/`.bat` → error); nombre → `resolver.resolve(name, { cwd })` → `{ file, prefixArgs }` o `{ error }`. **Se elimina** el `return { file: bin, prefixArgs: [] }` final (`exec-utils.js:131`) y el `{ file: bashBin ?? 'bash' }` de POSIX.
- `findGitBash` se mantiene (lo usa el resolvedor) y descarta candidatos no absolutos.
- `killProcessTree` en Windows: `execFileImpl(taskkillPath(env), ['/PID', pid, '/T', '/F'], { windowsHide: true }, () => {})` con
  `export function taskkillPath(env) { return path.win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe'); }`.
  `killProcessTree` recibe `env` (por defecto `process.env`).

### 5.4 `lib/git-actions.js`

- `GIT_ACTION_ARGS` cambia en:
  - `diffHead: ['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']`
  - `diffWorktree: ['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--']`
  - `statHead`/`statCached` añaden `--no-ext-diff --no-textconv` tras `diff`.
  - nuevas: `hooksDir: ['--no-optional-locks', 'rev-parse', '--git-path', 'hooks']` y `hooksPathConfig: ['--no-optional-locks', 'config', '--get', 'core.hooksPath']`.
- `listActiveHooks(dir, { runner, readdir = fs.promises.readdir })` → `{ hooks, hooksPathCustom }`:
  `hooksDir` → `path.resolve(dir, salida.trim())`; `readdir(withFileTypes)`; se quedan ficheros o enlaces cuyo nombre
  no termina en `.sample` y cumple `^[A-Za-z0-9._-]{1,64}$`; orden alfabético; como mucho 20. `hooksPathCustom` =
  `hooksPathConfig` responde con código 0 y salida no vacía. Cualquier error → `{ hooks: [], hooksPathCustom: false }`.
- `getChanges` añade `hooks` y `hooksPathCustom` al resultado.
- `planCommitPush(dir, message, { runner, env = process.env })`:
  - cada paso: `args: [...GIT_SAFE_PREFIX, ...GIT_ACTION_ARGS.<paso>, …]`; `display` igual que hoy.
  - `env` de `add` y `commit` = `GIT_STEP_ENV`; `env` de push = `{ ...GIT_STEP_ENV, ...sshEnv(env) }` con
    `sshEnv(env) = (nonEmpty(env.GIT_SSH_COMMAND) || nonEmpty(env.GIT_SSH)) ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }`.
  - Sin `--no-verify` en ningún sitio (test estático).
- `git()` interno sigue llamando a `runner('git', …)`.

### 5.5 `lib/claude-cli.js`

- `resolveClaudeCommand(claudeBin, { platform, env, execPath, exists, resolver, cwd, panelDir = process.cwd() })`:
  1. `bin` = `claudeBin` recortado o `'claude'`.
  2. `.js/.mjs/.cjs` → `{ file: execPath, prefixArgs: [abs(bin)] }` con `abs` = `path.resolve(panelDir, bin)` si es relativo.
  3. Ruta absoluta → `{ file: bin }`. Relativa con separador → `{ file: path.resolve(panelDir, bin) }`.
  4. Nombre → `resolver.resolve(bin, { cwd })` (con la fila `claude` de §3.2 si `bin` es `claude`); error → `{ error }`.
     **Se elimina** el `return { file: bin, prefixArgs: [] }` de `claude-cli.js:129` y el de POSIX.
  Sin `resolver`, crea uno con `exists` como en §5.3 (tests de la fase 4).
- `isBroadCommand(cmd)` y las listas de §3.5 (exportadas).
- `suggestAllowedCommand(command)`: después de la lógica actual, añade el caso python `-m <mod>` (tres tokens) y el de
  `bun run <script>`; devuelve `null` si `isBroadCommand(sugerencia)`. `suggestAllowedCommands` filtra igual.
- `isValidAllowedCommand`: §4.1.
- `createStreamMapper`: `denialEvent` devuelve `null` (no registra ni emite) cuando `denials.length >= MAX_PERMISSION_DENIALS`
  y marca `capped = true`; expone `mapper.denialsCapped()` (true la primera vez que se descarta una).

### 5.6 `lib/runs.js`

- `createRunManager({ …, resolver = defaultResolver })`.
- `guardedSpawn(file, args, opts, { projectScript = false })`: si `!(projectScript ? isInside(file, opts.cwd) && isAbsolute(file) : resolver.isTrustedPath(file, { cwd: opts.cwd }))`
  → lanza `Object.assign(new Error(BIN_ERRORS.untrusted(lastSegment(file))), { code: 'EUNTRUSTED' })` **sin** llamar a
  `spawnImpl`. `launchClaude` y `spawnStep` usan `guardedSpawn`; el error se muestra como hoy:
  `rec.launchError = 'No se pudo ejecutar …: ' + (err.code === 'EUNTRUSTED' ? err.message : err.code || err.message)`
  (para `EUNTRUSTED` el texto del evento `error` es directamente `BIN_ERRORS.untrusted(...)`).
- `spawnOptions`: en `win32` añade `NoDefaultCurrentDirectoryInExePath: '1'` al `env`.
- `emit`: sustituye `LIMITED_TYPES` por `UNLIMITED_TYPES = new Set(['state', 'end'])`; todo evento fuera de ese conjunto
  suma a `outputBytes` y se descarta tras el truncado. Excepción: los avisos internos del panel `truncated` y `timeout`
  se emiten con `{ essential: true }` (no suman ni se descartan).
- Tras cada evento del mapper, si `mapper.denialsCapped()` pasa a `true` por primera vez → `emit(notice denialsCapped)`.
- `killTree(child, { platform, env })`.

### 5.7 `lib/sdd-actions.js`

- `resolveTestCommand({ …, resolver })` con la tabla de §3.6; `bash init.sh` → `resolveExecutable('bash', { resolver, cwd: projectDir })`.
- Pasos con `projectScript: true` cuando corresponda.
- `approveSpec` no cambia (la comprobación del run activo está en `work-api`, que conoce el gestor de runs).

### 5.8 `lib/work-api.js`

- `createWorkApi({ …, env, resolver, claudeBin = 'claude', claudeCommand })`: pasa `resolver` y `env` a
  `createRunManager`, `resolveTestCommand`, `resolveExecutable` (`resolveSteps`) y `planCommitPush`.
- `launchClaudeRun`: `command = claudeCommand ?? resolveClaudeCommand(claudeBin, { platform, env, execPath, resolver, cwd: dir })`;
  si `command.error` → `409 { error }`.
- `postPermission`: §4.2 (`acknowledgeBroad`).
- `postApproveSpec`: tras `projectDir`, `const active = runs.activeFor(merged.id); if (active) return ctx.respond(res, 409, { error: WORK_ERRORS.runActive, runId: active.runId });`.
- `projectWork`: añade `broadCommands`. `getProjectChanges`: añade `hooks` y `hooksPathCustom`.
- Exporta `newBroadCommands(next, current)` (amplios de `next` que no están en `current`) para `app.js`.

### 5.9 `lib/app.js`

- `const resolver = binaryResolver ?? createBinaryResolver({ platform, env, bashBin, getProjectDirs: () => projectDirsSnapshot })`.
- `projectDirsSnapshot`: array que `loadSources()` actualiza en cada llamada con las `path` (resueltas, no vacías) de
  `mergeProjects(registry.projects, scan.projects)` (la misma fusión que usa el catálogo). Valor inicial `[]`; además,
  `createApp` lanza una `loadSources()` inicial sin esperar (errores solo a consola).
- `runner` por defecto = `createGitRunner({ resolver, platform })` (ya no `undefined`): `catalogOptions()` lo pasa siempre.
- `patchProject`: tras `validatePatch` y antes de guardar, si `valid.changes.allowedCommands` → `nuevos = newBroadCommands(...)`; §4.2.
- Pasa `env`, `resolver` y `claudeBin` a `createWorkApi`. Si `claudeCommand` no viene, **no** lo resuelve al crear la app.

### 5.10 `server.js`

Pasa `claudeBin: config.claudeBin` (y ya no `claudeCommand: resolveClaudeCommand(...)`). La línea de arranque no cambia.

## 6. Interfaz (solo avisos)

### 6.1 Comando amplio

- `public/work.js`:
  - `export const BROAD_TEXTS = { broadConfirm: (cmds, name) => …, broadSaved: (cmds) => … }`:
    - `broadConfirm`: `Esto permite a Claude ejecutar cualquier programa en este proyecto: ${lista}. Equivale a darle una terminal libre en ${name}. ¿Quieres autorizarlo de todos modos?`
    - `broadSaved`: `Atención: ${lista} permite${cmds.length > 1 ? 'n' : ''} a Claude ejecutar cualquier programa en este proyecto.`
    - `lista` = `«a», «b»` con cada comando escapado con `escapeHtml`; `name` escapado.
  - `describeAction('allow-broad', ctx)` → `BROAD_TEXTS.broadConfirm(ctx.broadCommands, ctx.projectName)`.
  - `renderBroadWarning(cmds)` → `''` si la lista está vacía; si no, `<p class="warning" role="status">${broadSaved}</p>`.
- `public/app.js`:
  - `confirmAction(text, { extraHtml, confirmLabel })`: si viene `confirmLabel`, cambia el texto de `#confirm-dialog-ok`
    mientras el diálogo está abierto y lo restaura al cerrar (por defecto "Confirmar").
  - `allowCommandAction` y `submitExecSettings`: si la respuesta es `400` con `needsAcknowledge`, abre
    `confirmAction(describeAction('allow-broad', …), { confirmLabel: 'Autorizar de todos modos' })` y, solo si se
    confirma, repite la petición con `acknowledgeBroad: true`.
  - La sección "Ajustes de ejecución" pinta `renderBroadWarning(work.broadCommands)` encima del `textarea`.

### 6.2 Hooks en "Commit y push"

- `public/work.js` → `renderHooksWarning({ hooks, hooksPathCustom })`: `''` si `hooks` está vacío; si no
  `<p class="warning" role="status">${hooksWarning}</p>` con
  `hooksWarning` = `Atención: este repositorio tiene hooks de git activos (${nombres}) que se ejecutarán al hacer commit y push y pueden ejecutar cualquier programa. Revísalos si no los has creado tú.`
  y, si `hooksPathCustom`, se añade al final ` La carpeta de hooks está configurada con core.hooksPath.`; `nombres`
  unidos por `, ` y escapados.
- `public/app.js` → `commitPushAction` ya pide `GET /changes` para la rama: antepone `renderHooksWarning(changes)` al
  `extraHtml` del diálogo.
- Sin cambios de CSS: se reutiliza `.warning`.

## 7. Flujos clave

1. **Listado** → `buildCatalog` → `getGitInfo(dir, { runner })` → `createGitRunner` → `resolver.resolve('git', { cwd: dir })`
   (caché + exclusión de `dir` y del catálogo) → `execFile('/usr/bin/git', ['-c','core.fsmonitor=false','--no-optional-locks','status','--porcelain'], { cwd: dir })`.
2. **Chat** → `gateExec` → `resolveClaudeCommand(claudeBin, { resolver, cwd: dir })` → `startClaude` → `guardedSpawn` →
   `spawn(<ruta absoluta>, args, { cwd: dir, shell: false })`.
3. **Permitir comando amplio** → `POST /permissions { command: 'node' }` → `400 needsAcknowledge` → diálogo con aviso →
   "Autorizar de todos modos" → `POST { command: 'node', acknowledgeBroad: true }` → `200` + auditoría.
4. **Commit y push** → `GET /changes` (con `hooks`) → diálogo con aviso de hooks → `POST git/commit-push` → pasos con
   prefijo, push con `GIT_SSH_COMMAND` → `guardedSpawn` de cada paso.

## 8. Tests (`node --test`, sin dependencias)

### 8.1 Fixtures

- **Ejecutables falsos** (en `hardening.test.js`, función `plantFakeBins(dir, names, markDir)`): por cada nombre,
  un fichero `#!/bin/sh\necho "$0 $@" >> "<markDir>/marca-<nombre>"\nexit 0\n` con permiso `0o755`. Se plantan en la
  carpeta del proyecto. Para no tocar nunca un `claude` real que pudiera haber en el equipo de tests, el `PATH` de
  prueba **no** reutiliza el `PATH` del sistema: es `[proyecto, '.', binDir].join(':')`, donde `binDir` es un temporal
  con enlaces simbólicos a los `git` y `sh` reales (localizados recorriendo `process.env.PATH` en el test). Se pasa a
  `startApp({ env: { ...process.env, PATH } })` y, en el caso de Claude, `claudeBin: 'claude'` sin `claudeCommand`
  (resultado esperado: `409` con `onlyInProject`, sin ningún fichero de marca).
- **fsmonitor**: `git config core.fsmonitor <ruta de un script de marca>` en un repo temporal.
- **textconv**: `.gitattributes` con `* diff=marca` y `git config diff.marca.textconv <script de marca>`.
- **Fichero `*`**: `git add -- '*'` con `GIT_LITERAL_PATHSPECS=1` al preparar el fixture.
- **CLI falso**: escenario nuevo `[[flood]]` en `fake-claude.js`: emite 60 `permission_denied` distintos (`system/permission_denied`
  con `tool_use_id` únicos), 2000 líneas `system/init` con `model` de 1 KB (eventos `session`) y 2000 `system/api_retry`
  (eventos `notice`), y termina con un `result` de éxito. Ninguno de esos tipos contaba para el límite en la fase 4.

### 8.2 Reparto

| Fichero | Requisitos |
|---|---|
| `trusted-bin.test.js` (nuevo) | F14-R1, R2, R3, R4 (unitario), R5 |
| `runs-api.test.js` (ampliar) | F14-R6, R13 (runs), R27, R28 (integración) |
| `git-info.test.js` (ampliar) | F14-R7, R13 (runner), R21 (runner) |
| `claude-cli.test.js` (ampliar) | F14-R8, R14, R15, R20, R28 (mapper) |
| `sdd-actions.test.js` (ampliar) | F14-R9 |
| `exec-utils.test.js` (ampliar) | F14-R10 |
| `hardening.test.js` (nuevo) | F14-R4 (integración), R11, R22, R23 (integración), R24, R29 |
| `work-api.test.js` (ampliar) | F14-R16, R17, R18 |
| `git-actions.test.js` (ampliar) | F14-R21 (pasos), R23 (unitario), R25 (estático), R26 |
| `work-render.test.js` (ampliar) | F14-R19, R25 (render) |
| `deploy.test.js` (ampliar) | F14-R30, R31, R32 |
| Manual | F14-R12 (y cableado de R19/R25, §8.4) |

Los tests que crean scripts `#!/bin/sh` o enlaces simbólicos se saltan en Windows; los de git real, si no hay git.

### 8.3 Cambios declarados en tests de la fase 4

- `exec-utils.test.js` → `[F4-R54]`: `resolveExecutable('pytest', …)` no encontrado pasa de `{ file: 'pytest' }` a `{ error: BIN_ERRORS.notFound('pytest') }`; los casos de Linux esperan la ruta absoluta encontrada con `exists` inyectado (o el error).
- `claude-cli.test.js` → `[F4-R12]`: Linux `claude` con `PATH=/usr/bin` y `exists` que lo contiene → `/usr/bin/claude` (antes `claude`); "nada" → `{ error: notFound }`.
- `claude-cli.test.js` → `[F4-R65]`: `suggestAllowedCommand('yarn run -s x')` pasa de `'yarn run'` a `null` (`yarn run` sin script es amplio).
- `git-actions.test.js` → `[F4-R60]`/`[F4-R58]`: los `args` de los pasos empiezan por `-c core.fsmonitor=false`; el `env` del push incluye `GIT_SSH_COMMAND`. Las llamadas al runner no cambian (el prefijo lo pone el runner real).
- `git-actions.test.js`/`work-api.test.js`: cualquier aserción literal de `diffHead`/`diffWorktree`/`statHead` usa las listas nuevas de §5.4.
- `runs-api.test.js` → `[F4-R30]`: si alguna aserción fija `outputBytes` exacto, se recalcula (ahora cuentan todos los eventos salvo `state`/`end`).
- `helpers.js`: `startApp` acepta `env` y `claudeBin` (se pasan a `createApp`). Ningún otro test cambia.

### 8.4 Comprobación manual (Windows)

1. Crear `C:\prueba-m1` con `git init`, registrarlo en el panel y copiar `C:\Windows\System32\whoami.exe` como
   `C:\prueba-m1\git.exe` y como `C:\prueba-m1\claude.exe`.
2. Con el panel arrancado, abrir el listado, el detalle, "Trabajar", "Ver cambios" (con un fichero modificado),
   "Ejecutar tests" (`testCommand: git --version`), "Commit y push" (a un remoto `--bare` local) y un chat.
3. Comprobar en PowerShell, durante y después, `Get-Process whoami -ErrorAction SilentlyContinue` (nada), que la salida de
   los runs muestra la versión real de git y que el commit existe. Repetir con `PATH` que incluya `.`.
4. Avisos: autorizar `node` desde "Ajustes de ejecución" muestra el aviso y "Autorizar de todos modos"; con un
   `.git\hooks\pre-commit`, el diálogo de "Commit y push" muestra el aviso de hooks.
5. Anotar fecha, versiones (`node -v`, `git --version`, `claude --version`) y resultado en `docs/verification.md` (fila `F14-R12`).

### 8.5 `docs/verification.md`

Sección nueva al final del mapa: `## Mapa de trazabilidad — Feature 14: \`endurecimiento-ejecucion\` (prefijo \`[F14-R<n>]\`)`
con una nota de los cambios de §8.3 y una fila por requisito (R12 manual; R33 = `./init.sh`).

## 9. Documentación

### 9.1 `specs/puesto-de-mando-trabajar/design.md` (N1 y N2)

- §10, fila "Pasar el prompt por stdin" → sustituir por:
  `| Pasar el prompt como argumento posicional | Descartado tras la prueba T36: \`--allowedTools\` es variádica y se tragaba el prompt; el prompt va por stdin (D1, §5.2). (corregido en la feature 14) |`
- §9, primera viñeta: quitar `panel/lib/rate-limit.js` y `panel/lib/http-utils.js` y añadir al final de la viñeta:
  ` \`http-utils.js\` y \`rate-limit.js\` se modificaron en la corrección T36 (§5.10). (corregido en la feature 14)`.
- No se cambia nada más de ese fichero.

### 9.2 `docs/architecture.md` → sección nueva "## Seguridad de la ejecución" (antes de "Restricciones…")

Apartados (cada uno con 2–5 líneas):
1. **Resolución de ejecutables**: rutas absolutas desde `PATH` y rutas conocidas; exclusión del proyecto y del catálogo; proyecto contenedor; caché; guardia al lanzar; `NoDefaultCurrentDirectoryInExePath`; comando de tests con ruta relativa = código del proyecto.
2. **Comandos amplios**: qué son, que no se proponen y que añadirlos exige confirmación expresa.
3. **Configuración del repositorio**: `-c core.fsmonitor=false` en todas las llamadas; diff sin drivers externos ni `textconv` y con pathspec literal.
4. **Hooks**: decisión de D8 (se ejecutan y se avisa) y por qué no `--no-verify`.
5. **Push**: `GIT_SSH_COMMAND=ssh -o BatchMode=yes` salvo `GIT_SSH_COMMAND`/`GIT_SSH` del humano; consecuencia: un `core.sshCommand` global se ignora en el push del panel (para usar otro ssh, definir `GIT_SSH_COMMAND` en el entorno del panel).
6. **Riesgos conocidos**: (N5) el CLI aplica también `~/.claude/settings.json` y `.claude/settings*.json` del proyecto, que pueden ampliar los permisos de `--allowedTools`; (N6) desde la red local basta la sesión y el panel escucha en `0.0.0.0`: una cookie robada en la LAN da ejecución sin reconfirmar; los filtros `clean`/`smudge` de `.gitattributes` + `.git/config` pueden ejecutarse en `git status`/`git add`, y los `credential.helper` y hooks en el push (requieren que alguien escriba en `.git/`, que Claude Code protege); `cloudflared` se arranca por nombre desde `scripts/` (fuera de esta feature); los nietos que lance Claude por nombre siguen sus propias reglas de búsqueda.

## 10. Ficheros que NO se tocan

- `panel/lib/auth.js`, `panel/lib/sessions.js`, `panel/lib/cf-access.js`, `panel/lib/reauth.js`, `panel/lib/claude-discovery.js`, `panel/lib/audit.js`, `panel/lib/sse.js`, `panel/lib/rate-limit.js`, `panel/lib/http-utils.js`, `panel/lib/path-key.js`, `panel/lib/project-state.js`, `panel/lib/project-catalog.js`, `panel/lib/run-store.js`, `panel/lib/command-runner.js`, `panel/lib/tunnel.js`, `panel/lib/config.js`, `panel/lib/network.js`, `panel/lib/public-url.js`.
- `panel/lib/registry.js` salvo el texto de `EXEC_ERRORS.invalidCommand` (§4.1).
- `panel/public/` salvo `work.js` y `app.js` en lo descrito en §6 (ni `index.html`, ni `styles.css`, ni `render.js`).
- `panel/scripts/`, `panel/deploy/`, `panel/projects.json`, `panel/projects.example.json`, `panel/legacy/`.
- `.claude/`, `CLAUDE.md`, `sdd-lint.js`, `init.sh`, `docs/specs.md`, `docs/constitution.md`, `docs/conventions.md`, `docs/acceso-web.md`, specs de las fases 1–3 y de la feature 13; de `specs/puesto-de-mando-trabajar/` solo las dos correcciones de §9.1.
- `feature_list.json` y `progress/` los gestiona solo el leader.

## 11. Alternativas consideradas y descartadas

| Alternativa | Por qué se descarta |
|---|---|
| Desactivar siempre los hooks en "Commit y push" (`--no-verify` o `-c core.hooksPath=`) | Los hooks suelen ser del humano (lint, tests); el commit desde el panel se comportaría distinto que desde la terminal sin que se note. Se avisa en su lugar (D8). |
| No permitir nunca intérpretes ni shells como comandos autorizados | El humano puede necesitar `node scripts/x.js` o incluso `node` en un proyecto de confianza; la forma con subcomando cubre el caso normal y el aviso cubre el resto (D6). |
| Solo `NoDefaultCurrentDirectoryInExePath=1` en el entorno del panel | libuv no lo respeta al buscar el ejecutable de `spawn`/`execFile`; no corrige M1. Se mantiene solo como defensa extra para los nietos. |
| Resolver `git` una sola vez al arrancar y guardarlo en una constante | No vería el catálogo vigente ni el `cwd` de cada llamada; un proyecto añadido después que esté en `PATH` quedaría sin excluir. |
| Excluir el subárbol completo de todo proyecto, también de los contenedores | Con la carpeta personal como proyecto (Claude Code abierto en `~`) excluiría `~/.local/bin/claude.exe` y Git per-user y el panel dejaría de funcionar. |
| `GIT_LITERAL_PATHSPECS=1` en el entorno en vez de `--literal-pathspecs` | Equivalente; la opción en la lista de argumentos es visible en los tests y en `GIT_ACTION_ARGS`. |
| Prefijo `-c core.fsmonitor=false` escrito en cada lista de `GIT_COMMANDS`/`GIT_ACTION_ARGS` de lectura | Obliga a tocar todas las listas y sus tests, y una consulta nueva (feature 13) podría olvidarlo; el runner lo aplica a todas. Los pasos de commit y push no pasan por el runner y lo llevan explícito. |

## 12. Riesgos, supuestos y notas de implementación

- **Supuesto (a confirmar por el humano): proyecto contenedor.** Si un proyecto del catálogo es la carpeta personal o un
  ancestro, solo se excluye su raíz. Alternativa más estricta: excluir el subárbol y obligar a quitar ese proyecto.
- **Supuesto (a confirmar): `core.sshCommand` global.** Con D9, un `core.sshCommand` de la configuración global del
  humano se ignora en el push del panel salvo que defina `GIT_SSH_COMMAND` en el entorno del panel.
- **Supuesto (a confirmar): carpetas excluidas** = proyectos del registro + proyectos detectados de Claude Code (incluidos
  los ocultos). Los worktrees de la feature 13 aún no existen; si se añaden, sus carpetas también entrarían.
- **Feature 13 (`spec_ready`)**: toca `claude-cli.js`, `runs.js`, `git-info.js` y `project-catalog.js`. Si se
  implementa después de esta, sus llamadas git pasan por el runner (prefijo y resolvedor automáticos) y su run de solo
  lectura por `guardedSpawn`; su `design.md` no necesita cambios, pero el implementer de la 13 debe partir de este código.
- **Carrera en N4**: entre la comprobación `activeFor` y la escritura de `feature_list.json` puede arrancar un run; la
  ventana es de milisegundos y la edición por rango con verificación sigue protegiendo el fichero de corrupción.
- **Caché y `PATH` cambiado**: un `PATH` nuevo del sistema solo se aplica al reiniciar el panel (documentado en el texto
  `notFound`).
- **Rendimiento**: con ~100 proyectos el sondeo hace `resolve('git')` por llamada; con caché es una comparación de
  claves por candidato y proyecto (O(candidatos × proyectos)), sin acceso a disco.
- **Windows y `realpath`**: `fs.realpathSync.native` resuelve uniones y enlaces; si falla se usa la ruta tal cual.

## 13. Corrección revisión F14 (`progress/review_endurecimiento-ejecucion.md`)

### 13.1 Comandos amplios (MA1, R34)

- `commandBase`: último segmento tras `/` o `\`, en minúsculas y sin `.exe`/`.com`/`.cmd`/`.bat`/`.ps1`
  (`npx.cmd`, `NODE.EXE`); `python3.12`, `python3.9`, `pypy3.10`… se reducen a su familia (`/^(python|pypy)\d*(\.\d+)*w?$/`).
  El primer subcomando se compara en minúsculas.
- `GIT_EXEC_SUBCOMMANDS` añade `fetch`, `pull`, `push`, `clone`, `ls-remote` y `remote` (aceptan
  `--upload-pack`/`--receive-pack=<programa>` o leen `remote.*.uploadpack`; `remote update` hace fetch), `grep`
  (`-O`/`--open-files-in-pager=<programa>`) y `send-email` (`--sendmail-cmd`). Ya estaban `submodule`, `archive`
  (`--remote --exec`), `daemon`, `upload-pack`, `receive-pack`, `difftool`, `mergetool`, `filter-branch`, `bisect`
  (`bisect run`) y `rebase` (`--exec`). Se lista el subcomando entero (no la opción) porque la regla `Bash(git fetch *)`
  admite cualquier opción.
- `POWERSHELL_EXEC_COMMANDS` (siempre amplios): `invoke-expression`/`iex`, `invoke-command`/`icm`,
  `start-process`/`saps`/`start`, `invoke-item`/`ii`, `add-type`, `&`, `.`, `invoke-webrequest`/`iwr`,
  `invoke-restmethod`/`irm` (descarga que se encadena con `iex`), `start-job`/`sajb`, `start-threadjob`, `new-object`
  (`-ComObject WScript.Shell`), `invoke-wmimethod`, `invoke-cimmethod`.
- `WRAPPER_COMMANDS` añade `corepack`; `RUNNER_COMMANDS` añade `tsx` y `ts-node`; `TOOL_EXEC_SUBCOMMANDS`:
  `yarn node`, `deno eval|repl|run|x`, `uv run|tool`, `pipx run`, `dotnet run|exec|fsi`.
- Límite asumido (se documenta): es una lista negra y no puede ser completa. Comandos como `npm install <url>` (scripts
  de ciclo de vida) o cualquiera que ejecute código editable del proyecto (`npm run x`, `make test`) también dan
  ejecución de facto; el aviso cubre solo los que la dan directamente.

### 13.2 Lecturas git sin programas del repo (MA2, R35)

- `GIT_SAFE_PREFIX = ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false']` en todas las llamadas (runner y
  pasos de "Commit y push"). No se añade `-c gpg.program=`: anularía el `gpg.program` global del humano y rompería su
  firma de commits; con `log.showSignature=false` las lecturas ya no llaman a gpg.
- Filtros en lecturas: antes de cada `status`/`diff` del runner central se lee
  `git config --local --includes --get-regexp ^filter\.` y por cada nombre se añaden
  `-c filter.<n>.clean= -c filter.<n>.smudge= -c filter.<n>.process= -c filter.<n>.required=false` (código 1 = sin
  filtros). Solo los locales: los globales del humano (p. ej. git-lfs) se respetan.
- **Descartado `--attr-source=<árbol vacío>`** (lo soporta el git de los tests, 2.43, y el del humano, 2.52): probado
  que `.git/info/attributes` sigue aplicándose (quien puede escribir `.git/config` puede escribir ahí), y además ignora
  los atributos `text`/`eol` del `.gitattributes`, con lo que en Windows `status` podría marcar ficheros como cambiados.
- `git add`/`commit`/`push` (pasos de `runs.js`) no anulan filtros: ahí son legítimos y se avisa (§13.3).

### 13.3 Configuración del repo en "Commit y push" (M3, R36)

- `GIT_ACTION_ARGS.repoConfigRisks`: `config --local --includes --get-regexp` de `commit.gpgsign`, `core.sshcommand`,
  `core.askpass`, `credential.*helper`, `remote.*.(receivepack|uploadpack)` y `filter.*.(clean|smudge|process)`.
- `listRepoConfigRisks(dir, { runner, readFile })` → `{ gpgSign, sshCommand, askPass, credentialHelper, receivePack, filters }`
  (`filters`: nombres de la config local y de `filter=` en `.gitattributes`, válidos, ordenados, máx. 20). `getChanges`
  y `GET /changes` lo devuelven como `repoConfig`.
- `renderRepoConfigWarning(repoConfig)` (texto exacto en el test `[F14-R36]` de `work-render.test.js`):
  `Atención: la configuración de este repositorio ejecutará programas al hacer commit y push: <puntos separados por "; ">. Revísala si no la has configurado tú.`
  `commitPushAction` lo añade tras el aviso de hooks.

### 13.4 Textos de ayuda (M4, R37)

- Bajo "Comandos que Claude puede ejecutar": `Comandos que Claude podrá ejecutar por su cuenta (uno por línea). No es el comando de tests.`
- Bajo "Comando de tests": `Lo que ejecuta el botón Ejecutar tests, p. ej. npm test`
- `<p id="exec-…-help" class="muted field-help">` enlazado con `aria-describedby`; sin CSS nuevo.

### 13.5 Memoria del traductor (N4, R38)

- Tras el tope de 50 denegaciones no se guardan más ids (`seenDenials`), inputs ni textos de aprobación; `toolInputs` y
  `approvals` se limitan a `MAX_TRACKED_TOOL_USES = 500` entradas (se descarta la más antigua). `mapper.stats()` expone
  los tamaños para los tests.

### 13.6 Documentación (N3, N5, R39)

- N3: con la carpeta personal en el catálogo, Claude puede escribir en `~/.local/bin` y el panel usaría ese ejecutable
  tras reiniciarse si esa carpeta va antes en el `PATH` (mismo riesgo que `~/.bashrc` o la carpeta Inicio).
- N5: las reglas por defecto `git diff *`/`git log *` admiten `--output=<fichero>` (escritura de ficheros). Las reglas
  de `--allowedTools` son por prefijo y no permiten excluir opciones; se documenta como riesgo conocido y queda para una
  revisión futura de las reglas por defecto (quitarlas rompería el flujo SDD normal de Claude).
- `GIT_SSH`: si el humano define `GIT_SSH` (no `GIT_SSH_COMMAND`), el panel no añade `GIT_SSH_COMMAND` y un
  `core.sshCommand` del repo tiene prioridad sobre `GIT_SSH`.
