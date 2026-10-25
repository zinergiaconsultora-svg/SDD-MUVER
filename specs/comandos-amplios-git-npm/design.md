# Diseño — Feature 15: comandos amplios de git y npm (mejoras del reviewer de la feature 14)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo solo esta carpeta,
> `docs/conventions.md` y el código actual de `panel/` (feature 14 implementada, HEAD `ef4c30b` o posterior). Las
> referencias a la feature 14 son a `specs/endurecimiento-ejecucion/design.md` ("F14 §x").
>
> Regla de esta feature: **un `git <sub>` o `npm <sub>` solo se trata como comando normal si `<sub>` se ha comprobado
> que no ejecuta un programa indicado en la línea de órdenes**; todo lo demás es amplio (no se propone y exige la
> confirmación con aviso de F14 §6.1).

> **Enmienda 1 (2026-10-25)** — por el bloqueante B1 de `progress/review_comandos-amplios-git-npm.md` (veredicto
> RECHAZADO sobre la implementación `347bd6d`).
> - **Qué estaba mal.** `GIT_SAFE_SUBCOMMANDS` incluía `merge` y `cherry-pick`, y la nota de §3.2 decía que
>   `merge -s` solo buscaba la estrategia en la carpeta de ejecución de git. Es falso con git 2.43.0:
>   `git merge -s <nombre>` ejecuta `git-merge-<nombre>` del `PATH` en un merge que no es fast-forward, y
>   `git cherry-pick --strategy=<s>` ejecuta `git-merge-<s>` sin validar el nombre (una ruta relativa al cwd; con una
>   carpeta `git-merge-..` en el repo, cualquier programa del disco, y con `-X` sus argumentos).
> - **Revisión completa.** Se han vuelto a comprobar con el git y el npm reales (temporal, `HOME` temporal,
>   `GIT_CONFIG_NOSYSTEM=1`) todos los subcomandos de las dos listas permitidas (§3.2, §3.3 y filas nuevas de §3.4).
>   Aparece un caso más: `npm view`/`info`/`show`/`v` con un paquete git ejecutan el programa de `--git=<programa>`.
> - **Qué cambia.** Salen de `GIT_SAFE_SUBCOMMANDS` `merge`, `cherry-pick` y `revert` (por prudencia: acepta
>   `--strategy` aunque en 2.43 no la usa, nota N3), y de `NPM_SAFE_SUBCOMMANDS` `view`, `info`, `show` y `v`; todos
>   pasan a `GIT_EXEC_SUBCOMMANDS`/`NPM_EXEC_SUBCOMMANDS` (§3.4). Cambian la tabla de §3.5, el fixture de R6 (casos
>   nuevos y entorno aislado con `HOME` temporal, mejora M2, §6.1), los cambios declarados (§6.3), la comprobación
>   manual (§6.4, mejora M1), los textos de `docs/architecture.md` (§7.1, apartado 1 con la nota N1 y apartado 2) y la
>   fila de R6 de `docs/verification.md` (§7.2). Las tareas nuevas son T18–T23 de `tasks.md`.
> - **Qué no cambia.** El algoritmo de `isBroadCommand` (§3.5), las sugerencias (§3.6), `taskkill` (§4), la ruta
>   real del `cwd` (§5) y los ficheros que no se tocan (§9).

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
/** git <sub> comprobados (git 2.43, `git <sub> -h` y prueba en temporales; revisados en la Enmienda 1): ninguna opción ejecuta un programa indicado en la línea de órdenes. */
export const GIT_SAFE_SUBCOMMANDS = Object.freeze([
  'status', 'diff', 'log', 'show', 'rev-list', 'rev-parse', 'describe', 'ls-files', 'ls-tree', 'cat-file', 'show-ref',
  'for-each-ref', 'branch', 'tag', 'add', 'restore', 'switch', 'checkout', 'reset', 'rm', 'mv', 'stash', 'commit',
  'blame', 'shortlog', 'reflog', 'cherry', 'merge-base', 'name-rev', 'count-objects',
  'version', 'check-ignore', 'check-attr', 'diff-tree', 'diff-index', 'diff-files', 'whatchanged',
]);
```

Son 37 subcomandos: la lista aprobada sin `merge`, `cherry-pick` ni `revert` (Enmienda 1).

Notas de la comprobación (para el reviewer):
- **Enmienda 1 — estrategias de fusión.** La nota anterior ("`merge -s <estrategia>` busca `git-merge-<estrategia>`
  solo en la carpeta de ejecución de git; se comprobó con un `git-merge-evilx` en el `PATH` y no se ejecutó") era
  **falsa**: con un merge fast-forward no se usa estrategia, y así no se ve. Con git 2.43.0 (evidencias en §3.4):
  - `git merge -s <nombre>` ejecuta `git-merge-<nombre>` de la carpeta de ejecución de git **o del `PATH`** en un merge
    que no es fast-forward. Con una barra en el nombre (`-s p/ev`, `-s ../…`) responde "Could not find merge strategy"
    y no ejecuta nada.
  - `git cherry-pick --strategy=<s>` ejecuta `git-merge-<s>` **sin validar el nombre**: un nombre del `PATH`, una ruta
    relativa al cwd (`--strategy=p/ev` con el fichero `git-merge-p/ev` en el repo) o, con una carpeta vacía
    `git-merge-..` en el repo, cualquier programa del disco (`--strategy=../…/usr/bin/env`), al que `-X<opción>` pasa
    `--<opción>` como primer argumento (`-X"split-string=sh -c '…' sh"` ejecuta código de shell escrito en la línea de
    órdenes).
  - `git revert --strategy=<s>` existe (`git revert -h`) pero en 2.43 no ejecutó nada en ninguna de las tres variantes:
    el secuenciador hace la fusión interna en los revert. Sale de la lista **por prudencia** (es el mismo código que
    `cherry-pick` y su comportamiento puede cambiar con la versión de git; nota N3 del reviewer).
  - `git rebase --strategy=<s>` también lo ejecuta, pero `rebase` ya era amplio.
- **Enmienda 1 — revisión del resto.** Con `HOME` temporal y `GIT_CONFIG_NOSYSTEM=1` se revisó `git <sub> -h` de los
  37 subcomandos que quedan buscando `strategy`, `program`, `command`, `cmd`, `exec`, `editor`, `tool`, `pager`,
  `filter`, `textconv`, `helper`, `gpg`, `sign`, `output`, `upload`, `receive`, `hook`, `template` y `shell`, y se probó
  la estrategia falsa del `PATH` con `stash apply` y `checkout -m` (no la invocan: fusión interna). Ninguna opción
  ejecuta un programa indicado en la línea de órdenes. Lo que aparece y por qué no cuenta:
  - `commit -S`/`--gpg-sign[=<key-id>]`, `tag -s`/`-u <key-id>` y `log --show-signature`: el programa es
    `gpg.program`/`gpg.format` de la configuración; `<key-id>` es un argumento para ese programa, no un programa.
  - Editor (`commit`, `tag -a`, `branch --edit-description`, `add -e`), paginador, `--ext-diff`, `--textconv`,
    `cat-file --textconv`/`--filters`, los drivers de `-m`/`--merge` (`checkout`, `switch`, `restore`) y el filtro de
    `-p` (`interactive.diffFilter`): salen de la configuración, de `.gitattributes` + `.git/config` (feature 19) o del
    entorno (§10, duda 5), no de la línea de órdenes.
  - `--recurse-submodules` (`checkout`, `switch`, `restore`, `reset`): solo lanza el propio git en los submódulos.
  - `-p`/`--paginate`, `-c`, `-C` y `--exec-path` son opciones **globales** (van antes del subcomando), así que el
    comando ya es amplio por la regla de F14 (`t1` empieza por `-`).
  - `commit -t`/`--template` y `-F`, `--pathspec-from-file`, `blame --contents`/`--ignore-revs-file` y
    `ls-files -X`: leen ficheros; no ejecutan nada.
- `commit`, `checkout`, `switch` y `reset` ejecutan hooks y filtros, pero salen de `.git/` (configuración), no de la
  línea de órdenes.
- `diff`, `log`, `show`, `rev-list`, `shortlog`, `reflog`, `whatchanged`, `diff-tree`, `diff-index`, `diff-files` y
  `blame` aceptan `--output=<fichero>`, que **escribe** un fichero en cualquier ruta, y
  `log --format` permite elegir su contenido. No ejecuta nada por sí mismo, así que no entra en el criterio de §3.1,
  pero es un riesgo conocido que afecta también a las reglas por defecto `git diff` y `git log` (§10, duda 2).
- Quedan fuera a propósito: `merge`, `cherry-pick` y `revert` (estrategias, Enmienda 1), `grep` (`-O`), `apply` (`--unsafe-paths` escribe fuera del árbol), `format-patch`
  (`-o` a cualquier carpeta), `am`, `notes`, `worktree`, `clean`, `remote`, `init`, `help` y `gc`. No hacen falta para
  el trabajo normal de Claude o abren caminos que no se han estudiado.

### 3.3 `NPM_SAFE_SUBCOMMANDS` y `NPM_RUN_SUBCOMMANDS`

```js
/** npm <sub> que no son amplios: ejecutan solo scripts de package.json (riesgo de F14 D6) o solo leen (npm 10.9; revisados en la Enmienda 1). */
export const NPM_SAFE_SUBCOMMANDS = Object.freeze([
  'test', 't', 'tst', 'start', 'stop', 'restart', 'ls', 'list', 'll', 'la', 'outdated',
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
- **(Enmienda 1)** `view` y sus alias `info`, `show` y `v`: con un paquete git (`npm view git+file://<repo>`) npm
  ejecuta el programa de `--git=<programa>` para `ls-remote` y `clone` (comprobado, también con `--offline`, §3.4).

Revisión de la Enmienda 1 (npm 10.9.4, `HOME` temporal, un proyecto con una dependencia git instalada, con y sin
`--offline`): `outdated`, `ls`, `explain`, `why`, `query`, `prefix`, `root`, `test`, `start`, `stop`, `restart` y
`run build` con `--git`, `--browser`, `--editor`, `--viewer`, `--shell` y `--node-gyp` apuntando a un programa de
marca no lo ejecutan. `--script-shell`, `--node-options` y `--prefix` detrás de un comando de scripts son la feature 18.

### 3.4 Listas de referencia y evidencias

```js
/** git <sub> que ejecutan programas, cambian la configuración o aceptan una estrategia de fusión (referencia; isBroadCommand usa GIT_SAFE_SUBCOMMANDS). */
export const GIT_EXEC_SUBCOMMANDS = Object.freeze([
  'config', 'submodule', 'bisect', 'rebase', 'filter-branch', 'difftool', 'mergetool', 'daemon', 'instaweb',
  'web--browse', 'credential', 'upload-pack', 'receive-pack', 'archive',
  'fetch', 'pull', 'push', 'clone', 'ls-remote', 'grep', 'hook', 'send-email', 'fetch-pack', 'send-pack',
  'remote-ext', 'upload-archive', 'shell', 'maintenance',
  'merge', 'cherry-pick', 'revert',
]);
/** npm <sub> que ejecutan programas o paquetes indicados en la línea de órdenes (referencia). */
export const NPM_EXEC_SUBCOMMANDS = Object.freeze([
  'exec', 'x', 'explore', 'init', 'create', 'innit', 'install', 'i', 'add', 'ci', 'install-test', 'it',
  'install-ci-test', 'cit', 'update', 'rebuild', 'link', 'edit', 'config', 'c', 'repo', 'docs', 'help', 'fund',
  'view', 'info', 'show', 'v',
]);
```

La Enmienda 1 añade al final la línea `'merge', 'cherry-pick', 'revert'` (git) y `'view', 'info', 'show', 'v'` (npm);
el orden del resto no cambia (el test de R5 compara con `deepEqual`).

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
| **Enmienda 1** (git 2.43.0 y npm 10.9.4, `HOME` temporal, `GIT_CONFIG_NOSYSTEM=1`, repo con dos ramas que divergen) | |
| `git merge -s evilx otra` (no fast-forward) con `git-merge-evilx` en el `PATH` | ejecutado |
| `git merge -s evilx` fast-forward o ya actualizado; `git merge -s p/ev`, `-s ../…/usr/bin/env` | no ejecutado (fast-forward no usa estrategia; con `/`: "Could not find merge strategy") |
| `git cherry-pick --strategy=evilx otra` con `git-merge-evilx` en el `PATH` | ejecutado |
| `git cherry-pick --strategy=p/ev otra` con el fichero `git-merge-p/ev` en el repo (ruta relativa al cwd) | ejecutado |
| `git cherry-pick --strategy=../…/usr/bin/env -X"split-string=sh -c 'touch M' sh" otra` con una carpeta vacía `git-merge-..` en el repo | ejecutado (código de shell escrito en la línea de órdenes) |
| `git revert --strategy=…` con las mismas tres variantes | no ejecutado en 2.43 (fusión interna); sale por prudencia (§3.2) |
| `git rebase --strategy=evilx otra` | ejecutado (ya era amplio) |
| `git stash apply`, `git checkout -m otra` con `git-merge-evilx` en el `PATH` | no ejecutado (fusión interna) |
| `npm view git+file://<repo> --git=P` (también `info`, `show`, `v`, y con `--offline`) | ejecutado (P recibe `ls-remote` y `clone`) |
| `npm outdated`/`ls`/`explain`/`why`/`query`/`prefix`/`root`/`test`/`start`/`stop`/`restart`/`run build` con `--git`, `--browser`, `--editor`, `--viewer`, `--shell` o `--node-gyp` = P | no ejecutado |

R6 automatiza en `hardening.test.js` las seis primeras filas de git (las del reviewer de la feature 14) y, desde la
Enmienda 1, `cherry-pick --strategy=<ruta relativa>`, `merge -s <nombre del PATH>` en un merge que no es
fast-forward y `npm view <paquete git> --git=<programa>` (§6.1).

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

Tabla de los tests (R1–R4), además de la tabla de F14, que se mantiene (Enmienda 1: `git merge`, `git cherry-pick`,
`git revert` y `npm view`/`info`/`show`/`v` pasan a la columna de amplios):

| Amplios | No amplios |
|---|---|
| `git fetch`, `git pull`, `git push`, `git clone`, `git ls-remote`, `git grep`, `git hook`, `git submodule`, `git bisect`, `git rebase`, `git difftool`, `git mergetool`, `git filter-branch`, `git send-email`, `git maintenance`, `git help`, `git init`, `git worktree`, `git apply`, `git merge`, `git cherry-pick`, `git revert`, `git co`, `git evilsub`, `git STATUS`, `git -C x` | `git status`, `git diff`, `git log`, `git show`, `git rev-list`, `git commit`, `git add`, `git checkout`, `git branch`, `git stash`, `git blame` |
| `npm install`, `npm i`, `npm add`, `npm ci`, `npm exec`, `npm x`, `npm explore`, `npm init`, `npm create`, `npm innit`, `npm run-script`, `npm rum`, `npm urn`, `npm run`, `npm run -s`, `npm config`, `npm c`, `npm set`, `npm edit`, `npm repo`, `npm docs`, `npm help`, `npm fund`, `npm publish`, `npm pack`, `npm rebuild`, `npm update`, `npm audit`, `npm view`, `npm info`, `npm show`, `npm v`, `npm desconocido` | `npm test`, `npm t`, `npm tst`, `npm start`, `npm stop`, `npm restart`, `npm run build`, `npm run-script build`, `npm rum build`, `npm urn build`, `npm ls`, `npm list`, `npm outdated`, `npm explain`, `npm why`, `npm query`, `npm prefix`, `npm root` |
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

- Tras una denegación de `git push`, `git fetch`, `git pull`, `git merge`, `git cherry-pick`, `npm install`,
  `npm view`… ya no aparece "Permitir en este proyecto
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
- R6, casos de la **Enmienda 1** (en el mismo test, después de los seis anteriores):
  - Ramas: desde el commit anterior a `HEAD` se crea la rama `f15-otra` con un commit que añade `otra.txt`, y se vuelve
    a la rama de partida. Así `merge f15-otra` no es fast-forward y `cherry-pick f15-otra` tiene que fusionar.
  - Programas de marca: `marca.sh` no sirve aquí, porque git pasa a la estrategia la base y las cabezas, no una ruta.
    Se escriben dos scripts `#!/bin/sh` con la ruta de su marca fija dentro (`: > '<marca>'` y `exit 2`):
    `<tools>/git-merge-f15path` (para `merge`) y `<repo>/git-merge-f15/marca` (para `cherry-pick`, ruta relativa), los
    dos con modo `0o755`.
  - `merge`: `git merge -s f15path f15-otra` con `PATH` = `<tools>` + el `PATH` del entorno aislado. Base
    `git merge`, comando completo `git merge -s x f15-otra`.
  - `cherry-pick`: `git cherry-pick --strategy=f15/marca f15-otra` (sin tocar el `PATH`). Base `git cherry-pick`,
    comando completo `git cherry-pick --strategy=x f15-otra`.
  - Tras cada uno, `git merge --abort`/`git cherry-pick --abort` y `git reset -q --hard <commit de partida>`, ignorando
    los errores, para que el caso siguiente parta de un repo limpio.
  - `npm view`: solo si `npm` está en el `PATH` (con `findOnSystemPath('npm')`; si no, ese caso se salta con un `if`
    comentado y los demás siguen). Un script `<tools>/git-falso` (`: > '<marca>'`, `exit 1`) y
    `npm view git+file://<repo> --git=<tools>/git-falso --offline` lanzado con `execFile` desde una carpeta temporal
    vacía (`timeout` de 30 s). Base `npm view`, comando completo `npm view x --git=y`.
- R6, **entorno aislado** (mejora M2, para todos los casos): se parte de `process.env`, se quitan las variables cuyo
  nombre empieza por `GIT_` o por `npm_config_` (sin distinguir mayúsculas; `init.sh` lanza los tests con `npm test`,
  que añade estas últimas) y se fijan `HOME` y `XDG_CONFIG_HOME` a carpetas temporales nuevas, `GIT_CONFIG_NOSYSTEM=1`
  y `GIT_TERMINAL_PROMPT=0`. Así no influyen el `~/.gitconfig` (alias, `url.insteadOf`), el `~/.npmrc` ni la caché de
  npm del usuario. La identidad de los commits ya está en la configuración local del repo (`makeProjectDir`).
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

**Ninguno previsto** en tests de fases o features anteriores. **Enmienda 1:** cambian tests de esta misma feature,
ya implementados en `347bd6d`, y se declaran en `docs/verification.md`:
- `[F15-R1]` y `[F15-R2]` (`claude-cli.test.js`): las tablas de §3.5 (`git merge`, `git cherry-pick`, `git revert`,
  `npm view`, `npm info`, `npm show`, `npm v` pasan a amplios; `npm view` sale de los no amplios).
- `[F15-R5]`: el `deepEqual` de las dos listas de referencia de §3.4 y la lista mínima de R5.
- `[F15-R6]` (`hardening.test.js`): casos nuevos, entorno aislado y nombre nuevo del test (§6.1).
- `[F15-R7]`: casos nuevos de R7.
- `[F15-R16]` (`deploy.test.js`): cadenas `--strategy` y `--git` del apartado 2 y comprobación de la nota N1.

Las tablas de F14 (`[F14-R14]`, `[F14-R15]`) siguen valiendo con §3.5, porque
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
3. **(Enmienda 1, mejora M1)** En "Ajustes de ejecución", añadir `git merge`, `git cherry-pick` y `npm view`: los tres
   deben mostrar el diálogo "Autorizar de todos modos" (se cancela sin guardar).
4. **(Enmienda 1, mejora M1)** Repetir la evidencia con el git del PC (2.52.0.windows.1), en Git Bash y en una carpeta
   temporal fuera de los proyectos: un repo con dos ramas que divergen (`otra` y la de partida), un script
   `git-merge-evilx` (`#!/bin/sh` + `touch "$HOME/MARCA-merge"`) en una carpeta temporal que se pone delante del `PATH`
   solo en esa terminal, y `git merge -s evilx otra`; luego, con `mkdir -p git-merge-p` y una copia del script como
   `git-merge-p/ev` (cambiando la marca a `MARCA-cp`), `git cherry-pick --strategy=p/ev otra`. Anotar si aparecen
   las marcas (se espera que sí; si no aparece alguna, anotarlo: la lista sigue siendo correcta, porque salir de la
   lista solo pide una confirmación de más). Borrar después la carpeta temporal y las marcas.
5. Anotar la fecha, la versión de Windows, de Node y de git y el resultado en la fila de R13 de `docs/verification.md`.

## 7. Documentación

### 7.1 `docs/architecture.md`, sección "Seguridad de la ejecución"

- **Apartado 1**: se sustituye la frase "Guardia final: `runs.js` (`guardedSpawn`), el runner de git
  (`createGitRunner`) y `taskkill` solo lanzan rutas de confianza, y en Windows los hijos reciben
  `NoDefaultCurrentDirectoryInExePath=1`." por: "Guardia final: `runs.js` (`guardedSpawn`), el runner de git
  (`createGitRunner`) y `killProcessTree` (`taskkill`) solo lanzan rutas de confianza (`isTrustedPath`), y en Windows
  todos esos hijos reciben `NoDefaultCurrentDirectoryInExePath=1`; si la ruta de `taskkill` no es de confianza, no se
  lanza y se termina solo el hijo (`taskkillUntrusted`, feature 15)." Y tras "por ruta y por ruta real" se añade
  "(también la ruta real del cwd de la llamada, feature 15)".
  - **Enmienda 1 (nota N1).** El inciso quedó delante de "del `cwd` de la llamada" y la frase se lee mal. La frase
    pasa a ser: "Se descartan los candidatos (por ruta y por ruta real) del `cwd` de la llamada y de la ruta real del
    cwd (feature 15), y de las carpetas del catálogo (registro + Claude Code); de un **proyecto contenedor** (raíz,
    carpeta personal o un ancestro suyo) solo se excluye su raíz." Se reajusta el párrafo del apartado 1 para que
    ninguna línea pase de 120 columnas, como el resto de la sección (hoy se pasan la línea del inciso y la de "Única
    excepción"). El resto del texto del apartado no cambia.
- **Apartado 2**: tras la lista de F14 se añade: "Desde la feature 15, `git <sub>` y `npm <sub>` usan una **lista
  permitida** (`GIT_SAFE_SUBCOMMANDS`, `NPM_SAFE_SUBCOMMANDS` y `npm run`/`run-script`/`rum`/`urn` con script): todo
  subcomando que no esté en ella es amplio (`git fetch`/`pull`/`push`/`clone`/`ls-remote`/`grep`/`hook`…, que ejecutan
  programas con `--upload-pack`, `--receive-pack`, `-O`…; `npm install`, `ci`, `audit`, `edit`…). `pnpm`, `yarn` y
  `bun` siguen con la lista de denegación de la feature 14, que no es exhaustiva. El nombre base ignora `.exe`, `.cmd`,
  `.bat`, `.com` y `.ps1`."
  - **Enmienda 1.** En esa frase, la lista de ejemplos pasa a ser "(`git fetch`/`pull`/`push`/`clone`/`ls-remote`/
    `grep`/`hook`…, que ejecutan programas con `--upload-pack`, `--receive-pack`, `-O`…, y `git merge`/`cherry-pick`/
    `revert`, porque `-s`/`--strategy` ejecuta `git-merge-<estrategia>` del `PATH` o de una ruta relativa;
    `npm install`, `ci`, `audit`, `edit`… y `npm view`/`info`/`show`/`v`, que con un paquete git ejecutan el programa
    de `--git`)". La frase final del apartado pasa a decir "Las listas se comprobaron con git 2.43.0 y npm 10.9.4
    (revisadas de nuevo en la Enmienda 1 de la feature 15): se revisan cuando se actualice git o npm en la máquina del
    panel."
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
- **Enmienda 1:** la nota de entorno describe los casos nuevos de `[F15-R6]` y su entorno aislado (§6.1); la fila de
  R6 cita el nombre nuevo del test; la fila de R13 añade los pasos 3 y 4 de §6.4; y la frase "Cambios declarados en
  tests anteriores (design.md §6.3): ninguno" se sustituye por la lista de la Enmienda 1 de §6.3 (el bloque sigue
  citando `§6.3`, que el test de R17 busca).

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
6. Las listas se comprobaron con git 2.43.0 y npm 10.9.4 (y otra vez, completas, en la Enmienda 1). Una versión futura puede añadir una opción que ejecute
   programas a un subcomando permitido. La lista permitida se revisa cuando se actualice git o npm en la máquina del
   panel; se anota en `docs/architecture.md`.

7. **Duda 5 (Enmienda 1): variables de entorno delante del comando.** Varios subcomandos permitidos (y las reglas
   por defecto `git diff`/`git log`) lanzan un programa que sale del entorno: `GIT_EXTERNAL_DIFF=P git diff`,
   `GIT_EDITOR=P git commit`, `GIT_PAGER`, o `PATH=<carpeta> git commit -S` (busca `gpg` en ese `PATH`). Que esto
   quede cubierto por `Bash(git diff *)` depende de cómo Claude Code compara una regla con un comando que empieza por
   asignaciones de variables, y no se ha comprobado en esta enmienda. No es la clase de fallo de B1 (opción de la
   línea de órdenes), pero da el mismo resultado. Propuesta: que el leader lo compruebe con el CLI real y, si la regla
   cubre esos comandos, abrir una feature aparte (afecta también a las reglas por defecto).
8. **Supuesto (Enmienda 1):** `npm view` deja de ser normal y pide confirmación con aviso, aunque casi siempre se use
   para consultar el registro. Se acepta el coste (como en el supuesto 4) porque la regla `Bash(npm view *)` permite
   `--git=<programa>`.

### Decisiones del humano (2026-10-25, aprobación de la spec)

- Spec aprobada tal como está.
- Duda 4: **ningún** comando se mantiene como normal; `git push`, `git fetch`, `git pull`, `npm install`, `npm ci` y
  `npm audit` piden confirmación con aviso.
- Dudas 1, 2 y 3: en esta feature se **aceptan y se documentan** como riesgos conocidos en `docs/architecture.md`, y
  cada una se trata en su propia feature: #16 (`--output` de git), #17 (`pnpm`/`yarn`/`bun`) y #18 (`npm test` con
  opciones detrás).

### Enmienda 1 (2026-10-25)

- Pendiente de la aprobación del humano (puerta 1 de nuevo): lista permitida corregida (§3.2, §3.3), evidencias
  (§3.4), tareas T18–T23 y los puntos 7 y 8 de §10.

## 11. Alternativas consideradas y descartadas

| Alternativa | Por qué no |
|---|---|
| Ampliar solo la lista de denegación con los subcomandos del reviewer | Deja fuera los alias, `git-<x>` del `PATH`, las erratas de npm y lo que añadan versiones futuras (§3.1). |
| Prohibir `git`/`npm` fuera de la lista permitida, en vez de pedir confirmación | F14 D6 eligió "aviso, no prohibición": el humano puede necesitar `git fetch` en un proyecto de confianza. |
| Corregir solo `docs/architecture.md` para `taskkill` (M2 opción "b") | Dejaría una excepción a la regla de la guardia final que habría que recordar y documentar para siempre. El código necesario es mínimo (D5). |
| Resolver la ruta real de todas las carpetas del catálogo en cada llamada (M3) | `app.js` ya lo hace una vez por instantánea, y hacerlo en cada llamada cuesta N² `realpath` por sondeo (D6). |
| (Enmienda 1) Mantener `merge`/`cherry-pick` y declarar amplias solo las variantes con `-s`/`--strategy` | La regla que se genera es `Bash(git merge *)`, que cubre cualquier opción detrás (§3.1); clasificar el comando completo no protege la regla. |
| (Enmienda 1) Mantener `revert` porque 2.43 ignora la estrategia | Acepta `--strategy`, comparte código con `cherry-pick` y el humano usa otra versión de git (2.52); un falso amplio solo cuesta una confirmación. |
| Un texto de aviso distinto para "no comprobado" y para "ejecución libre" | Cambia la interfaz y sus tests sin cambiar la decisión del humano (D7). |
