# Diseño — Feature 15: comandos amplios de git y npm (mejoras del reviewer de la feature 14)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo solo esta carpeta,
> `docs/conventions.md` y el código actual de `panel/` (feature 14 implementada, HEAD `ef4c30b` o posterior). Las
> referencias a la feature 14 son a `specs/endurecimiento-ejecucion/design.md` ("F14 §x").
>
> Regla de esta feature: **un `git <sub>` o `npm <sub>` solo se trata como comando normal si `<sub>` se ha comprobado
> que no ejecuta un programa indicado en la línea de órdenes**; todo lo demás es amplio (no se propone y exige la
> confirmación con aviso de F14 §6.1).

## 1. Decisiones técnicas (resumen)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | **Lista permitida** (no lista de denegación) de subcomandos para `git` (`GIT_SAFE_SUBCOMMANDS`) y para `npm` (`NPM_SAFE_SUBCOMMANDS` + `NPM_RUN_SUBCOMMANDS` con script). Fuera de ella, `git <sub>`/`npm <sub>` es amplio. | Ver §3.1. Resumen: la regla que se genera es `Bash(git fetch *)`, así que lo que importa es si **alguna** continuación del comando ejecuta un programa. Git tiene más de 150 subcomandos, añade opciones en cada versión (`git hook` en 2.36), ejecuta `git-<nombre>` del `PATH` para un subcomando desconocido y admite alias con cualquier nombre. npm acepta alias y erratas (`isntall`, `innit`, `rum`, `urn`). Una lista de denegación siempre se queda corta; una lista permitida falla del lado conservador (como mucho pide una confirmación de más). |
| D2 | Se conservan `GIT_EXEC_SUBCOMMANDS` (ampliada) y se añade `NPM_EXEC_SUBCOMMANDS` como **listas de referencia**: no deciden, sirven para los tests (todas amplias, disjuntas de las permitidas) y para documentar las evidencias de §3.4. | El test de la tabla de F14 importa `GIT_EXEC_SUBCOMMANDS` y comprueba que contiene `config`, `submodule`…; así no hay que cambiarlo, y la lista documenta por qué cada subcomando no está permitido. |
| D3 | `pnpm`, `yarn` y `bun` **no cambian** (reglas de F14 con `PKG_EXEC_SUBCOMMANDS`). | El reviewer y el leader acotan M1 a git y npm. Sus alias y su ejecución implícita (`yarn <script>`, `yarn node`, `bun <fichero>`) necesitan un estudio aparte; queda como riesgo conocido y duda para el humano (§10). |
| D4 | El **nombre base** ignora también `.cmd`, `.bat`, `.com` y `.ps1` (antes solo `.exe`). | Hoy `npm.cmd exec x` o `npx.cmd` no se consideran amplios y la regla `PowerShell(npm.cmd exec *)` sería válida. Es la misma laguna que M1 por otra puerta. |
| D5 | **`taskkill` pasa por `isTrustedPath`** y recibe `NoDefaultCurrentDirectoryInExePath=1` (opción "a" de M2, no solo corregir la documentación). Si la ruta no es de confianza, no se lanza nada y se termina solo el hijo con `child.kill()`. | Una regla sin excepciones ("todo lanzamiento pasa por la guardia y lleva la variable") es más fácil de auditar y de comprobar con un test que una regla con una excepción documentada. Cuesta unas diez líneas. La ruta sale de `SystemRoot` del entorno del panel: hoy es fija y el riesgo práctico es nulo, pero la guardia cubre un entorno mal configurado o un proyecto registrado dentro de `C:\Windows`. Y `docs/architecture.md` ya lo afirma, así que el código pasa a decir la verdad. |
| D6 | El resolvedor añade a las carpetas excluidas la **ruta real del `cwd`** de la llamada (M3), no la de cada carpeta del catálogo. | `app.js` (`catalogDirs`) ya añade la ruta real de cada proyecto una vez por instantánea. Resolverla en cada llamada costaría una llamada `realpath` por proyecto en cada consulta git del sondeo del listado (N proyectos × N carpetas). El `cwd` es una sola llamada y es justo el caso que el reviewer describe (runner por defecto con un `cwd` que es un enlace). |
| D7 | El aviso y el texto de la confirmación **no cambian** (F14 §4.1 `WORK_ERRORS.broadCommand`, F14 §6.1 `broadConfirm`). | El requisito es usar "la confirmación con aviso existente". El texto ("permite a Claude ejecutar cualquier programa") se queda algo corto para un `git remote` o un `npm publish`, que no están en la lista permitida por prudencia, pero cambiarlo obligaría a tocar la interfaz y sus tests (§11). |
| D8 | Los comandos ya guardados que pasan a ser amplios **no se borran ni se bloquean**: aparecen en `broadCommands` (aviso `broadSaved` de "Ajustes de ejecución") y un `PATCH` que los mantiene no pide la marca (comportamiento de F14 R17). | El humano los autorizó; esta feature le avisa de que equivalen a una terminal libre, pero no le cambia el proyecto a sus espaldas. |

## 2. Estructura de ficheros

```
panel/
  lib/
    claude-cli.js           listas nuevas, commandBase con más extensiones, isBroadCommand y suggestAllowedCommand (§3)
    exec-utils.js           killProcessTree con guardia, entorno y respaldo child.kill() (§4)
    runs.js                 stopProcess pasa resolver y cwd a killTree (§4.3)
    trusted-bin.js          excludedDirs añade la ruta real del cwd (§5)
  test/
    claude-cli.test.js      tests [F15-R1]…[F15-R5], [F15-R7] (ampliado; no se cambian los tests existentes)
    hardening.test.js       test [F15-R6] (evidencia con el git real) y [F15-R14] (enlace simbólico real)
    work-api.test.js        tests [F15-R8], [F15-R9]
    exec-utils.test.js      tests [F15-R10], [F15-R11]
    runs-api.test.js        test [F15-R12]
    trusted-bin.test.js     tests [F15-R14], [F15-R15]
    deploy.test.js          tests [F15-R16], [F15-R17]
docs/architecture.md        sección "Seguridad de la ejecución": apartados 1, 2 y 6 (§7.1)
docs/verification.md        sección Feature 15 (§7.2)
```

`lib/work-api.js`, `lib/app.js` y `public/*` **no cambian**: ya llaman a `isBroadCommand` para `POST /permissions`,
`PATCH` y `broadCommands` (F14 §4.2), así que R8 y R9 salen solos al cambiar la clasificación.

## 3. Comandos amplios de git y npm (M1)

### 3.1 Criterio y elección de lista permitida

Un comando autorizado `C` genera las reglas `Bash(C *)` y `PowerShell(C *)` (F14 §5.5). Claude puede añadir cualquier
cosa detrás de `C`. Por tanto `C` es amplio si **alguna continuación** hace que se ejecute un programa o código
indicado en la propia línea de órdenes (opción, argumento o subcomando). El código que está en ficheros del proyecto
(`package.json`, `init.sh`, tests) no cuenta: es el riesgo aceptado en F14 D6, porque Claude lo edita con
`acceptEdits` y el cambio queda visible en "Ver cambios". La configuración y los hooks de `.git/` tampoco cuentan
(riesgo conocido 6 de `docs/architecture.md`: Claude Code protege `.git/`).

Con ese criterio se compararon dos diseños:

| | Lista de denegación (ampliar `GIT_EXEC_SUBCOMMANDS`) | Lista permitida (elegida) |
|---|---|---|
| Subcomando desconocido o alias (`git co`, `git evilsub` → `git-evilsub` del `PATH`) | No amplio. Se propondría `git evilsub`, que ejecuta un programa del `PATH` (comprobado, §3.4). | Amplio. |
| Versión nueva de git/npm con una opción nueva que ejecuta programas | Laguna hasta que alguien la vea. | Solo afecta si se añade a un subcomando ya permitido (poco frecuente: los permitidos son de lectura o de trabajo local). |
| Alias y erratas de npm (`isntall`, `innit`, `rum`, `urn`, `c`) | Hay que listarlas todas. | No hace falta. |
| Coste para el humano | Ninguno. | Algunos comandos habituales pasan a pedir confirmación (`git push`, `git fetch`, `git pull`, `npm install`, `npm ci`, `npm audit`). Es lo que se busca: `git push --receive-pack=…` y `npm install <paquete>` ejecutan programas arbitrarios. |
| Qué se sugiere tras una denegación | Todo lo que no esté en la lista. | Solo los subcomandos permitidos (§3.6). |

Decisión: **lista permitida** para `git` y `npm`. Para el resto de comandos (`pytest`, `cargo`, `make test`…) se
mantienen las reglas de F14 §3.5, que no dependen de subcomandos.

### 3.2 `GIT_SAFE_SUBCOMMANDS` (en `lib/claude-cli.js`)

```js
/** git <sub> comprobados (git 2.43, `git <sub> -h` y prueba en temporales): ninguna opción ejecuta un programa indicado en la línea de órdenes. */
export const GIT_SAFE_SUBCOMMANDS = Object.freeze([
  'status', 'diff', 'log', 'show', 'rev-list', 'rev-parse', 'describe', 'ls-files', 'ls-tree', 'cat-file', 'show-ref',
  'for-each-ref', 'branch', 'tag', 'add', 'restore', 'switch', 'checkout', 'reset', 'rm', 'mv', 'stash', 'commit',
  'merge', 'cherry-pick', 'revert', 'blame', 'shortlog', 'reflog', 'cherry', 'merge-base', 'name-rev', 'count-objects',
  'version', 'check-ignore', 'check-attr', 'diff-tree', 'diff-index', 'diff-files', 'whatchanged',
]);
```

Notas de la comprobación (para el reviewer):
- `commit`, `merge`, `cherry-pick`, `revert`, `checkout`, `switch` y `reset` ejecutan hooks y filtros, pero salen de
  `.git/` (configuración), no de la línea de órdenes.
- `merge -s <estrategia>` busca `git-merge-<estrategia>` solo en la carpeta de ejecución de git. Se comprobó con un
  `git-merge-evilx` en el `PATH` y no se ejecutó.
- `commit --gpg-sign`, `tag -s` y `log --show-signature` usan `gpg.program` de la configuración.
- `diff`, `log`, `show`, `rev-list`, `shortlog`, `reflog`, `whatchanged`, `diff-tree`, `diff-index`, `diff-files`,
  `blame`, `cherry-pick` y `revert` aceptan `--output=<fichero>`, que **escribe** un fichero en cualquier ruta, y
  `log --format` permite elegir su contenido. No ejecuta nada por sí mismo, así que no entra en el criterio de §3.1,
  pero es un riesgo conocido que afecta también a las reglas por defecto `git diff` y `git log` (§10, duda 2).
- Quedan fuera a propósito: `grep` (`-O`), `apply` (`--unsafe-paths` escribe fuera del árbol), `format-patch`
  (`-o` a cualquier carpeta), `am`, `notes`, `worktree`, `clean`, `remote`, `init`, `help` y `gc`. No hacen falta para
  el trabajo normal de Claude o abren caminos que no se han estudiado.

### 3.3 `NPM_SAFE_SUBCOMMANDS` y `NPM_RUN_SUBCOMMANDS`

```js
/** npm <sub> que no son amplios: ejecutan solo scripts de package.json (riesgo de F14 D6) o solo leen (npm 10.9). */
export const NPM_SAFE_SUBCOMMANDS = Object.freeze([
  'test', 't', 'tst', 'start', 'stop', 'restart', 'ls', 'list', 'll', 'la', 'outdated', 'view', 'info', 'show', 'v',
  'explain', 'why', 'query', 'prefix', 'root',
]);
/** npm <sub> <script>: no amplio solo con un nombre de script que no empieza por "-". */
export const NPM_RUN_SUBCOMMANDS = Object.freeze(['run', 'run-script', 'rum', 'urn']);
```

Quedan fuera (amplios), entre otros:
- `install` y sus alias (`i`, `add`, `in`, `isntall`…), `ci`, `install-test`/`it`, `install-ci-test`/`cit`, `update`,
  `rebuild`, `link`, `uninstall`, `dedupe`, `prune`: ejecutan los scripts de ciclo de vida de paquetes que se pueden
  indicar en la línea de órdenes.
- `audit`: `audit fix` instala.
- `exec`/`x`, `explore`, `init`/`create`/`innit`: ejecutan paquetes.
- `edit` y `config edit` (`--editor=<programa>`), y `repo`/`docs`/`bugs`/`help`/`fund` (`--browser=<programa>`).
- `config`/`c`/`set`/`get`: escriben en `~/.npmrc`, fuera del proyecto.
- `publish`, `pack`, `version`, `doctor`, `login`.

### 3.4 Listas de referencia y evidencias

```js
/** git <sub> que ejecutan programas o cambian la configuración (referencia; isBroadCommand usa GIT_SAFE_SUBCOMMANDS). */
export const GIT_EXEC_SUBCOMMANDS = Object.freeze([
  'config', 'submodule', 'bisect', 'rebase', 'filter-branch', 'difftool', 'mergetool', 'daemon', 'instaweb',
  'web--browse', 'credential', 'upload-pack', 'receive-pack', 'archive',
  'fetch', 'pull', 'push', 'clone', 'ls-remote', 'grep', 'hook', 'send-email', 'fetch-pack', 'send-pack',
  'remote-ext', 'upload-archive', 'shell', 'maintenance',
]);
/** npm <sub> que ejecutan programas o paquetes indicados en la línea de órdenes (referencia). */
export const NPM_EXEC_SUBCOMMANDS = Object.freeze([
  'exec', 'x', 'explore', 'init', 'create', 'innit', 'install', 'i', 'add', 'ci', 'install-test', 'it',
  'install-ci-test', 'cit', 'update', 'rebuild', 'link', 'edit', 'config', 'c', 'repo', 'docs', 'help', 'fund',
]);
```

`run-script`, `rum`, `urn` y `run` **sin script** también son amplios (R2), pero no van en `NPM_EXEC_SUBCOMMANDS`
porque con script son normales (la lista debe ser disjunta de las permitidas, R5).

Evidencias, con git 2.43.0 y npm 10.9.4 en Linux. Cada caso se probó en un repo temporal con un comando que crea un
fichero de marca:

| Caso | Resultado |
|---|---|
| `git fetch --upload-pack="touch M; false" .` | ejecutado |
| `git pull --upload-pack=…` | ejecutado |
| `git push --receive-pack=…` y `git push --exec=…` | ejecutado |
| `git ls-remote --upload-pack=…` | ejecutado |
| `git clone -u …`, `git clone --template=<dir con hooks/post-checkout>`, `git clone --config core.fsmonitor=…` (al usar el clon) | ejecutado |
| `git grep -O"touch M" hola` | ejecutado |
| `git hook run pre-commit` (ejecuta el hook del repo) | ejecutado |
| `git fetch-pack --upload-pack=…`, `git send-pack --receive-pack=…`, `git archive --remote=. --exec=…` | ejecutado |
| `git rebase -x …`, `git bisect run …`, `git difftool -x …` / `--extcmd=…` | ejecutado |
| `git evilsub` con `git-evilsub` en el `PATH` | ejecutado |
| `git -c alias.zz='!…' zz` (opción global: ya era amplio por la regla de opción de F14) | ejecutado |
| `git submodule foreach`, `git mergetool`, `git filter-branch --tree-filter`, `git send-email --sendmail-cmd`, `git instaweb --httpd` | documentado en `git help` |
| `npm edit <dep> --editor=P`, `npm config edit --editor=P` | ejecutado |
| `npm exec`/`x`, `npm explore`, `npm init <paquete>`, `npm install <paquete>` (scripts de ciclo de vida), `--browser` de `repo`/`docs`/`bugs`/`help`/`fund` | documentado en `npm help` |
| `npm test --script-shell=P` y `npm test --node-options="--import=data:text/javascript,…"` | ejecutado (riesgo residual: §10, duda 1) |

R6 automatiza las seis primeras filas de git (las del reviewer) en `hardening.test.js`.

### 3.5 Algoritmo de `isBroadCommand` (cambios sobre F14 §3.5)

```js
const COMMAND_EXT_RE = /\.(exe|cmd|bat|com|ps1)$/;
function commandBase(token) {
  return String(token).split('/').pop().toLowerCase().replace(COMMAND_EXT_RE, '');
}
```

`isBroadCommand(cmd)`. Se normaliza y se separa en `[t0, t1, t2]`, y `base = commandBase(t0)`. Es `true` si:
1. `base` ∈ `WRAPPER_COMMANDS` (igual que F14); o
2. `base` ∈ `RUNNER_COMMANDS` y (no hay `t1`, o `t1` empieza por `-` o `/`), con la excepción de `python -m` (igual
   que F14); o
3. **(nuevo)** `base === 'git'` y `t1` ∉ `GIT_SAFE_SUBCOMMANDS`. Sustituye a la comprobación con
   `GIT_EXEC_SUBCOMMANDS`. Se compara exacto, así que `STATUS` es amplio.
4. **(nuevo)** `base === 'npm'` y no (`t1` ∈ `NPM_SAFE_SUBCOMMANDS` o (`t1` ∈ `NPM_RUN_SUBCOMMANDS` y `t2` existe y no
   empieza por `-`)).
5. `base` ∈ `pnpm`, `yarn`, `bun` y (`t1` ∈ `PKG_EXEC_SUBCOMMANDS`, o `t1 === 'run'` sin `t2` o con `t2` que empieza
   por `-`). Es la regla de F14, ahora sin `npm`.

Los casos 3 y 4 solo se evalúan cuando `t1` existe y no empieza por `-` ni `/`, porque el caso 2 ya devuelve `true`
en los demás.

Tabla de los tests (R1–R4), además de la tabla de F14, que se mantiene:

| Amplios | No amplios |
|---|---|
| `git fetch`, `git pull`, `git push`, `git clone`, `git ls-remote`, `git grep`, `git hook`, `git submodule`, `git bisect`, `git rebase`, `git difftool`, `git mergetool`, `git filter-branch`, `git send-email`, `git maintenance`, `git help`, `git init`, `git worktree`, `git apply`, `git co`, `git evilsub`, `git STATUS`, `git -C x` | `git status`, `git diff`, `git log`, `git show`, `git rev-list`, `git commit`, `git add`, `git checkout`, `git branch`, `git stash`, `git blame` |
| `npm install`, `npm i`, `npm add`, `npm ci`, `npm exec`, `npm x`, `npm explore`, `npm init`, `npm create`, `npm innit`, `npm run-script`, `npm rum`, `npm urn`, `npm run`, `npm run -s`, `npm config`, `npm c`, `npm set`, `npm edit`, `npm repo`, `npm docs`, `npm help`, `npm fund`, `npm publish`, `npm pack`, `npm rebuild`, `npm update`, `npm audit`, `npm desconocido` | `npm test`, `npm t`, `npm tst`, `npm start`, `npm stop`, `npm restart`, `npm run build`, `npm run-script build`, `npm rum build`, `npm urn build`, `npm ls`, `npm list`, `npm outdated`, `npm view`, `npm explain`, `npm why`, `npm query`, `npm prefix`, `npm root` |
| `pnpm dlx x`, `yarn create app`, `bun x y`, `pnpm run`, `yarn run -s` | `yarn test`, `bun run build`, `pnpm run lint`, `pnpm install` |
| `npm.cmd exec x`, `NPM.CMD install`, `git.exe fetch`, `npx.cmd`, `node.bat -e`, `pnpm.ps1 dlx x`, `C:/tools/Git/cmd/git.exe push` | `npm.cmd test`, `git.exe status`, `node.cmd build.js` |

### 3.6 Sugerencias (`suggestAllowedCommand`)

Solo cambia la rama que añade el nombre del script:

```js
const base = commandBase(t0);
const runAlias = base === 'npm' ? NPM_RUN_SUBCOMMANDS.includes(t1) : ['pnpm', 'yarn', 'bun'].includes(base) && t1 === 'run';
if (runAlias && t2 !== undefined && !t2.startsWith('-')) parts.push(t2);
```

- Se usa `commandBase(t0)` en lugar de `t0`. Así `npm.cmd run-script lint` propone `npm.cmd run-script lint`, porque
  la sugerencia conserva el texto que escribió Claude.
- El filtro final `!isBroadCommand(suggestion)` no cambia. Con §3.5 ya no se propone ningún `git`/`npm` fuera de las
  listas permitidas.
- Se propone el alias que usó Claude (`npm rum build` → `npm rum build`), no `npm run build`: la regla tiene que
  coincidir con el comando que Claude vuelve a intentar.

### 3.7 Efectos visibles

- Tras una denegación de `git push`, `git fetch`, `git pull`, `npm install`… ya no aparece "Permitir en este proyecto
  y reintentar" con ese comando: la tarjeta de la denegación muestra el detalle sin propuesta, igual que hoy con `node -e`.
- En "Ajustes de ejecución", añadir a mano `git push` muestra el diálogo `broadConfirm` de F14 §6.1.
- Un proyecto que ya tenía `git push` o `npm install` guardado ve el aviso `broadSaved` (D8).

## 4. `taskkill` con la guardia final (M2)

### 4.1 Texto nuevo

```js
// lib/exec-utils.js
export const KILL_ERRORS = Object.freeze({
  taskkillUntrusted: (pid) => `[panel] No se lanza taskkill: su ruta no es de confianza (revisa SystemRoot); se termina solo el proceso ${pid}`,
});
```

### 4.2 `killProcessTree` (en `lib/exec-utils.js`)

Firma nueva (compatible: todos los parámetros nuevos son opcionales):

```js
export function killProcessTree(child, { platform, env, execFileImpl, killImpl, graceMs, setTimeoutImpl, resolver = null, cwd } = {})
```

Rama Windows:

```js
const file = taskkillPath(env);
const guard = resolver ?? createBinaryResolver({ platform, env });
if (!guard.isTrustedPath(file, { cwd })) {
  console.error(KILL_ERRORS.taskkillUntrusted(child.pid));
  if (typeof child.kill === 'function') {
    try { child.kill(); } catch { /* ya terminado */ }
  }
  return;
}
execFileImpl(file, ['/PID', String(child.pid), '/T', '/F'],
  { windowsHide: true, env: { ...env, NoDefaultCurrentDirectoryInExePath: '1' } }, () => {});
```

- El resolvedor de respaldo se crea con la `platform` recibida, porque el `defaultResolver` usa `process.platform` y en
  los tests de Linux rechazaría `C:\…`. Sin `getProjectDirs`, solo excluye el `cwd`. `isTrustedPath` no lee el disco
  salvo `realpath`: en Linux, con una ruta `C:\…`, devuelve `null` y no influye.
- La rama POSIX no cambia: no lanza ningún programa (`process.kill` al grupo).
- `child.kill()` en Windows termina solo el hijo directo. Los nietos pueden quedar vivos, y por eso se avisa en la
  consola. Es un caso que no debería darse nunca con un entorno normal.

### 4.3 `lib/runs.js`

`stopProcess(rec)` llama a `killTree(rec.child, { platform, env, resolver, cwd: rec.cwd })` con el mismo `resolver` que
`guardedSpawn`. No hay más cambios.

## 5. Ruta real del `cwd` en el resolvedor (M3)

En `createBinaryResolver`, `excludedDirs({ cwd })` construye la lista `[cwd, realCwd, ...projects]`:

```js
function realDir(dir) {
  if (!isAbsoluteFor(dir, platform)) return null;
  try {
    const real = fsOps.realpath(dir);
    return isAbsoluteFor(real, platform) ? real : null;
  } catch {
    return null;
  }
}
```

- `realCwd` va justo detrás de `cwd`. Ya se descartan los repetidos por `pathKey`, así que si coincide con el `cwd` no
  se duplica.
- Al usar `excludedDirs`, cubre a la vez `resolve` (descarta candidatos) e `isTrustedPath` (guardia final de
  `runs.js`, del runner de git y de `taskkill`).
- La ruta real del `cwd` recibe el mismo trato que el `cwd`: si es un proyecto contenedor (raíz, carpeta personal o
  ancestro), de ella solo se excluye su raíz (F14 §3.3).
- Los resolvedores de compatibilidad de `exec-utils.js` y `claude-cli.js` usan `realpath: () => null` y no cambian.
- `excludedDirs` se exporta ya en el objeto del resolvedor. Los tests pueden comprobar la lista directamente.

## 6. Tests (`node --test`, sin dependencias)

### 6.1 Fixtures

- R6: en `hardening.test.js`, un repo temporal con un commit y un script `marca.sh` que crea un fichero cuya ruta
  recibe como argumento. Casos: `fetch --upload-pack`, `ls-remote --upload-pack`, `push --receive-pack`, `push --exec`
  (contra el propio repo `.`), `clone -u` (a una carpeta temporal) y `grep -O` (con un fichero que contiene `hola`).
  Se lanzan con `execFile` del git del sistema (`shell: false`, `timeout` de 10 s) y se ignora el código de salida.
  Se salta en Windows y sin git, como el resto de `hardening.test.js`.
- R14 de integración: `fs.symlinkSync(proyecto, enlace)`, un `git` falso en `proyecto` y un `PATH` con `proyecto` y la
  carpeta del git real. `createBinaryResolver({ env: { PATH } })` (con `defaultFsOps`) y
  `resolve('git', { cwd: enlace })` no devuelve el falso.

### 6.2 Reparto

| Requisito | Fichero |
|---|---|
| R1–R5, R7 | `claude-cli.test.js` |
| R6, R14 (integración) | `hardening.test.js` |
| R8, R9 | `work-api.test.js` (con `startApp`, como los tests F14 de permisos) |
| R10, R11 | `exec-utils.test.js` |
| R12 | `runs-api.test.js` |
| R14 (unitario), R15 | `trusted-bin.test.js` |
| R16, R17 | `deploy.test.js` |
| R13 | manual (§6.4) |
| R18 | `./init.sh` |

### 6.3 Cambios declarados en tests anteriores

**Ninguno previsto.** Las tablas de F14 (`[F14-R14]`, `[F14-R15]`) siguen valiendo con §3.5, porque
`GIT_EXEC_SUBCOMMANDS` conserva sus elementos y `PKG_EXEC_SUBCOMMANDS` no cambia. Los tests `[F4-R28]`/`[F14-R10]`
de `killProcessTree` no pasan resolvedor ni `cwd` y siguen obteniendo una sola llamada con la misma ruta, los mismos
argumentos y `windowsHide`. El test `[F14-R31]` de `deploy.test.js` sigue encontrando todas sus cadenas (§7.1 solo
añade texto). Si el implementer tuviera que cambiar algún test anterior, debe declararlo en `docs/verification.md`
como desviación, con el requisito que lo obliga.

### 6.4 Comprobación manual (Windows)

Junto con la comprobación T30 de la feature 14, que sigue pendiente:
1. Lanzar desde el panel un run de Claude largo, o un comando de tests con `[[hang]]` del CLI falso, y pulsar
   "Cancelar". Antes de 10 s, `Get-Process claude,node,bash -ErrorAction SilentlyContinue` no debe mostrar procesos del
   run, y en la consola del panel no debe aparecer `No se lanza taskkill`.
2. En "Ajustes de ejecución", añadir `git push`: debe aparecer el diálogo "Autorizar de todos modos".
3. Anotar la fecha, la versión de Windows, de Node y de git y el resultado en la fila de R13 de `docs/verification.md`.

## 7. Documentación

### 7.1 `docs/architecture.md`, sección "Seguridad de la ejecución"

- **Apartado 1**: se sustituye la frase "Guardia final: `runs.js` (`guardedSpawn`), el runner de git
  (`createGitRunner`) y `taskkill` solo lanzan rutas de confianza, y en Windows los hijos reciben
  `NoDefaultCurrentDirectoryInExePath=1`." por: "Guardia final: `runs.js` (`guardedSpawn`), el runner de git
  (`createGitRunner`) y `killProcessTree` (`taskkill`) solo lanzan rutas de confianza (`isTrustedPath`), y en Windows
  todos esos hijos reciben `NoDefaultCurrentDirectoryInExePath=1`; si la ruta de `taskkill` no es de confianza, no se
  lanza y se termina solo el hijo (`taskkillUntrusted`, feature 15)." Y tras "por ruta y por ruta real" se añade
  "(también la ruta real del cwd de la llamada, feature 15)".
- **Apartado 2**: tras la lista de F14 se añade: "Desde la feature 15, `git <sub>` y `npm <sub>` usan una **lista
  permitida** (`GIT_SAFE_SUBCOMMANDS`, `NPM_SAFE_SUBCOMMANDS` y `npm run`/`run-script`/`rum`/`urn` con script): todo
  subcomando que no esté en ella es amplio (`git fetch`/`pull`/`push`/`clone`/`ls-remote`/`grep`/`hook`…, que ejecutan
  programas con `--upload-pack`, `--receive-pack`, `-O`…; `npm install`, `ci`, `audit`, `edit`…). `pnpm`, `yarn` y
  `bun` siguen con la lista de denegación de la feature 14, que no es exhaustiva. El nombre base ignora `.exe`, `.cmd`,
  `.bat`, `.com` y `.ps1`."
- **Apartado 6** (riesgos conocidos), se añade al final:
  - "Una regla `Bash(<comando> *)` admite cualquier opción detrás: `npm test --node-options=…` o `--script-shell=…`
    ejecuta código indicado en la línea de órdenes, y `git log`/`diff`/`show --output=<fichero>` (también las reglas
    por defecto) escribe en cualquier ruta (feature 15, pendiente de decisión)."
  - "`pnpm`, `yarn` y `bun` ejecutan scripts y binarios por nombre (`yarn <script>`, `bun <fichero>`)."

### 7.2 `docs/verification.md`

Sección nueva "## Mapa de trazabilidad — Feature 15: `comandos-amplios-git-npm` (prefijo `[F15-R<n>]`)", al final de
los mapas (tras la de la feature 14):
- Una nota con el entorno de los tests de integración (§6.1) y los cambios declarados (§6.3: ninguno previsto).
- Una tabla `| R<n> | test |` con una fila por requisito R1–R18. La fila de R13 dice "MANUAL — Windows, pendiente del
  humano" y la de R18 dice `./init.sh`.

El test de R17 sigue el modelo del test `[F14-R32]`: filas `^\| R<n> \|`, cada etiqueta no manual en la fila y en
`panel/test/`, salvo R18.

## 8. Flujo clave (denegación de `git fetch --upload-pack=…`)

1. Claude intenta `git fetch --upload-pack="sh -c …" origin`. El CLI lo deniega porque no hay regla.
2. `createStreamMapper` → `suggestAllowedCommands` → `suggestAllowedCommand` calcula `git fetch` → `isBroadCommand` →
   `fetch` ∉ `GIT_SAFE_SUBCOMMANDS` → `true` → sin propuesta.
3. La interfaz muestra la denegación sin el botón "Permitir y reintentar".
4. Si el humano escribe `git fetch` a mano en "Ajustes de ejecución" → `PATCH` → `400 needsAcknowledge` → diálogo
   `broadConfirm` → solo con "Autorizar de todos modos" se guarda, con `acknowledgedBroad` en `audit.log`.

## 9. Ficheros que NO se tocan

- `panel/lib/work-api.js`, `panel/lib/app.js`, `panel/lib/git-info.js`, `panel/lib/git-actions.js`,
  `panel/lib/sdd-actions.js`, `panel/lib/registry.js`, `panel/server.js` y todo `panel/public/` (§2: la clasificación
  nueva llega sola a la API y la interfaz).
- Los tests existentes de las fases 1–4 y de la feature 14 (§6.3), salvo para **añadir** tests nuevos en los mismos
  ficheros.
- `specs/` de otras features, `feature_list.json` (lo cambia el leader), `progress/` (lo lleva el leader),
  `docs/constitution.md`, `docs/specs.md`, `docs/conventions.md`, `CLAUDE.md`, `.claude/`, `init.sh`, `sdd-lint.js`.
- `scripts/` (`cloudflared` sigue fuera de alcance).

## 10. Riesgos, supuestos y dudas para el humano

1. **Duda 1: opciones de npm detrás de un comando de scripts.** `Bash(npm test *)` permite
   `npm test --node-options="--import=data:text/javascript,…"` (comprobado: ejecuta código escrito en la línea de
   órdenes cuando el script usa `node`) y `--script-shell=<programa>`. Ninguna lista de subcomandos lo evita, porque
   la opción va detrás. Esta spec lo **acepta y lo documenta**, porque Claude ya puede cambiar el script en
   `package.json` (F14 D6). La diferencia es que el cambio no queda en "Ver cambios". Alternativas para una feature
   futura: marcar todos los comandos de npm como amplios (aviso en el comando más habitual), o añadir reglas de
   denegación (`--disallowedTools`), que son frágiles porque npm acepta abreviaturas de opciones.
2. **Duda 2: escritura de ficheros con `--output`.** `git log -1 --format=<texto> --output=<ruta>` escribe texto
   elegido en cualquier ruta, por ejemplo `~/.bashrc`. Afecta a las reglas **por defecto** `git log` y `git diff` y a
   varios subcomandos permitidos (§3.2). Se comprobó con git 2.43. No entra en el criterio de M1 (no ejecuta nada en el
   momento), pero equivale a ejecución diferida. Propuesta: una feature aparte que decida si las reglas por defecto de
   git se cambian por herramientas propias de solo lectura o se mantienen con el riesgo documentado.
3. **Duda 3: `pnpm`, `yarn` y `bun`** siguen con la lista de denegación de F14 (D3). `pnpm install <paquete>` o
   `yarn add <paquete>` no son amplios, aunque `npm install` sí. Si el humano quiere coherencia, se puede aplicar el
   mismo patrón de lista permitida en otra feature.
4. **Supuesto**: los comandos que pasan a ser amplios (`git push`, `git fetch`, `git pull`, `npm install`, `npm ci`,
   `npm audit`) pedirán confirmación a partir de ahora. Si el humano prefiere que alguno sea normal pese a la
   evidencia de §3.4 (por ejemplo `npm ci`), basta con añadirlo a la lista permitida antes de aprobar la spec.
5. **Supuesto**: el comportamiento de Claude Code con reglas `Bash(<prefijo> *)` es el de su documentación de
   permisos: la regla cubre cualquier continuación del comando. Si Claude Code analiza además las opciones, la
   protección es mayor, nunca menor.
6. Las listas se comprobaron con git 2.43.0 y npm 10.9.4. Una versión futura puede añadir una opción que ejecute
   programas a un subcomando permitido. La lista permitida se revisa cuando se actualice git o npm en la máquina del
   panel; se anota en `docs/architecture.md`.

### Decisiones del humano (2026-10-25, aprobación de la spec)

- Spec aprobada tal como está.
- Duda 4: **ningún** comando se mantiene como normal; `git push`, `git fetch`, `git pull`, `npm install`, `npm ci` y
  `npm audit` piden confirmación con aviso.
- Dudas 1, 2 y 3: en esta feature se **aceptan y se documentan** como riesgos conocidos en `docs/architecture.md`, y
  cada una se trata en su propia feature: #16 (`--output` de git), #17 (`pnpm`/`yarn`/`bun`) y #18 (`npm test` con
  opciones detrás).

## 11. Alternativas consideradas y descartadas

| Alternativa | Por qué no |
|---|---|
| Ampliar solo la lista de denegación con los subcomandos del reviewer | Deja fuera los alias, `git-<x>` del `PATH`, las erratas de npm y lo que añadan versiones futuras (§3.1). |
| Prohibir `git`/`npm` fuera de la lista permitida, en vez de pedir confirmación | F14 D6 eligió "aviso, no prohibición": el humano puede necesitar `git fetch` en un proyecto de confianza. |
| Corregir solo `docs/architecture.md` para `taskkill` (M2 opción "b") | Dejaría una excepción a la regla de la guardia final que habría que recordar y documentar para siempre. El código necesario es mínimo (D5). |
| Resolver la ruta real de todas las carpetas del catálogo en cada llamada (M3) | `app.js` ya lo hace una vez por instantánea, y hacerlo en cada llamada cuesta N² `realpath` por sondeo (D6). |
| Un texto de aviso distinto para "no comprobado" y para "ejecución libre" | Cambia la interfaz y sus tests sin cambiar la decisión del humano (D7). |
