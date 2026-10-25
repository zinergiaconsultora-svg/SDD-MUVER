# Revisión — Feature 15: `comandos-amplios-git-npm` (segunda revisión, tras la Enmienda 1)

> Primera revisión (RECHAZADO por B1): en git, commit `0d03081` (`git show 0d03081:progress/review_comandos-amplios-git-npm.md`).

**Veredicto: APROBADO** (HEAD `d85c092`, enmienda implementada en `749b239`; diff de la feature desde
`sdd-checkpoint-comandos-amplios-git-npm-start` y de la enmienda desde `sdd-checkpoint-comandos-amplios-git-npm-enmienda1`).
El bloqueante B1 está resuelto: `merge`, `cherry-pick` y `revert` han salido de `GIT_SAFE_SUBCOMMANDS`, y
`view`/`info`/`show`/`v` de `NPM_SAFE_SUBCOMMANDS`. Todos pasan a las listas de referencia y `[F15-R6]` demuestra con el
git y el npm reales que se ejecuta el programa. M2, N1 y N3 también están resueltos. Los 488 tests pasan. Con el git
2.43.0 y el npm 10.9.4 reales, en temporales y con `HOME` temporal, no he conseguido que ningún subcomando que siga
en las listas permitidas ejecute un programa indicado en la línea de órdenes, salvo las vías ya asignadas a #16, #18,
#19 y la duda 5. No quedan bloqueantes. T16 (R13, manual en Windows) sigue pendiente del humano, como estaba previsto.

## Checklist

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad R1–R18 ↔ tests | OK. Las etiquetas `[F15-R1]`–`[F15-R12]` y `[F15-R14]`–`[F15-R17]` existen en `panel/test/` (R6 en `hardening.test.js`; R14 en `trusted-bin.test.js` y `hardening.test.js`). R13 es manual (T16, pendiente del humano, no bloquea). R18 se cubre con `./init.sh`. `[F15-R17]` sigue comprobando una fila por requisito en `docs/verification.md`, y la fila de R6 cita el nombre nuevo del test. |
| 2 | Tests (`bash init.sh`) | OK: **488 tests, 488 pass, 0 fail, 0 skipped** (Linux, git 2.43.0, npm 10.9.4). sdd-lint: 0 errores y 0 advertencias. `[F15-R6]` se ejecuta (no se salta), y también el caso de npm. He leído los cambios: las ramas divergen de verdad (`f15-otra` sale de `HEAD~1`), así que `merge` no es fast-forward. Cada caso tiene su propio fichero de marca con la ruta fija dentro del script. Hay `--abort` + `reset --hard` entre casos. Siempre se comprueba primero la marca y después la clasificación. El caso de npm usa `git+file://<repo>` con `--offline` desde una carpeta vacía. Los tests no son triviales: con las listas de antes, `isBroadCommand('git merge')` daba `false` y el test falla. |
| 3 | Tareas | T1–T15 y T17–T23 `[x]`. T16 `[ ]` (manual en Windows; desde la enmienda incluye los pasos 3 y 4 de design §6.4, que recogen la mejora M1). |
| 4 | Convenciones | OK. Código en inglés, comentarios en español, constantes congeladas en MAYÚSCULAS, referencias a la feature, la enmienda y la sección del design. Algunas líneas nuevas pasan de 120 columnas (N4). `docs/conventions.md` no fija un ancho y los tests de antes ya tienen líneas así. |
| 5 | Checkpoints | Se cumplen. Falta la entrada de `progress/history.md`, que añade el leader al cerrar. Igual que en las features anteriores, no hay `progress/impl_comandos-amplios-git-npm.md`: el estado está en `progress/current.md`. |
| 6 | Diseño | OK. `claude-cli.js` coincide con las listas de design §3.2–§3.4 de la Enmienda 1: 37 subcomandos de git, los añadidos van al final de las listas de referencia y `isBroadCommand`/`suggestAllowedCommand` no cambian. `hardening.test.js` coincide con §6.1 (casos, scripts, entorno aislado). `docs/architecture.md` coincide con §7.1 (frase de N1 y apartado 2) y `docs/verification.md` con §7.2. No se ha colado nada extra. Hay una desviación declarada en `docs/verification.md`: el apartado 2 de `architecture.md` también se ha reajustado a 120 columnas. Solo cambian los saltos de línea y `[F14-R31]` pasa. La acepto. |

## Hallazgos de la primera revisión

| Hallazgo | Estado | Comprobación |
|---|---|---|
| **B1** — `merge`/`cherry-pick` en la lista permitida | **Resuelto** | Ya no están en `GIT_SAFE_SUBCOMMANDS`. Están en `GIT_EXEC_SUBCOMMANDS`, junto con `revert`. `isBroadCommand('git merge'/'git cherry-pick'/'git revert')` devuelve `true` y las tablas de `[F15-R1]` y `[F15-R5]` lo fijan. `suggestAllowedCommand` devuelve `null` para `git cherry-pick --strategy=x otra`, `git merge -s x otra` y `git revert HEAD` (`[F15-R7]`). `[F15-R6]` reproduce las dos evidencias con el git real: `merge -s <nombre del PATH>` y `cherry-pick --strategy=<ruta relativa>`. La nota falsa de design §3.2 se ha corregido. |
| (nuevo en la enmienda) `npm view --git` | Resuelto | Lo detectó el implementer al revisar las listas. `view`, `info`, `show` y `v` pasan a `NPM_EXEC_SUBCOMMANDS`. Lo he reproducido: `npm view git+file://<repo> --git=P` ejecuta `P`. |
| M1 — git 2.52 en Windows | Recogida en T16 | Pasos 3 y 4 de design §6.4 y fila de R13 de `docs/verification.md`. Pendiente del humano. |
| **M2** — aislamiento de `[F15-R6]` | **Resuelto** | `isolatedEvidenceEnv()` quita las variables `GIT_*` y `NPM_CONFIG_*` (sin distinguir mayúsculas; también `NPM_CONFIG_USERCONFIG`) y pone `HOME`/`XDG_CONFIG_HOME` temporales, `GIT_CONFIG_NOSYSTEM=1` y `GIT_TERMINAL_PROMPT=0`. Todos los casos lo usan, también los seis de antes. |
| **N1** — inciso mal colocado en `architecture.md` | **Resuelto** | La frase dice ahora "…del `cwd` de la llamada y de la ruta real del cwd (feature 15), y de las carpetas del catálogo…". `[F15-R16]` comprueba que el inciso viejo ya no está y que ninguna línea del apartado 1 pasa de 120 columnas. |
| N2 — `SystemRoot` del entorno del panel | Sin cambios (no se pidió) | Sigue siendo correcto según R10/R11. |
| **N3** — `revert --strategy` | **Resuelto** | `revert` sale por prudencia (design §3.2 y §11). |

## Revisión con mentalidad de atacante

Entorno: scratchpad, `HOME`/`XDG_CONFIG_HOME` temporales, `GIT_CONFIG_NOSYSTEM=1`, git 2.43.0 y npm 10.9.4 reales, y
programas de marca que solo crean ficheros en el temporal.

### git: los 37 subcomandos de `GIT_SAFE_SUBCOMMANDS`

- **`git <sub> -h` de los 37**, buscando `strateg`, `program`, `command`, `cmd`, `exec`, `tool`, `filter`, `textconv`, `helper`, `upload`, `receive`, `shell`, `hook`, `--output` y `template`.
  - Solo aparece `cat-file --textconv`/`--filters`, que usa drivers de `.git/config`/`.gitattributes` (#19).
  - Lo demás no ejecuta nada: `commit -t` lee un fichero, `for-each-ref --shell` solo cambia el entrecomillado y `rev-list --exclude-hidden` es un filtro de refs.
- **Estrategias de fusión con todas las estrategias falsas en el `PATH`** (`git-merge-{ort,recursive,resolve,octopus,ours,subtree,evil}`): **ninguna se ejecuta**. Hacen la fusión interna.
  - Probados: `stash apply`, `checkout -m`, `switch -m`, `reset --merge`, `restore --merge`.
  - `show`/`log`/`diff-tree --remerge-diff` y `log --diff-merges=remerge` sobre un commit de merge real.
  - `commit --cleanup`, `status`, `describe --dirty`, `cherry`, `merge-base --fork-point`.
- **Vías que dependen de la configuración o del entorno, no de la línea de órdenes**:
  - `--ext-diff`/`--textconv`, editor, paginador y `interactive.diffFilter` en `-p`.
  - `-S`/`-u <key-id>`/`--show-signature`/`%G?`: el programa de firma sale de `gpg.program` o del `PATH`.
  - `--trailer` (`trailer.<k>.command`), `--alternate-refs` (`core.alternateRefsCommand`) y la descarga perezosa de un clon parcial (remoto de `.git/config`).
  - Estas vías son #19 o la duda 5 (`PATH=`/`GIT_*=` delante de la regla).
- **`--output` de `diff`/`log`/`show`/`reflog`/`stash show`** escribe ficheros, no ejecuta: es la #16.
- **Opciones globales** (`-c`, `-C`, `--exec-path`, `-p`): van delante del subcomando y la regla de F14 ya las trata como amplias.

### npm: los 16 de `NPM_SAFE_SUBCOMMANDS`

- **Proyecto con una dependencia `git+file://`**, en tres estados: instalada, sin `node_modules` ni lockfile, y solo con lockfile (`--package-lock-only`).
  - Con `--git=P`, ninguno de estos ejecutó `P`: `outdated` (también `--long`, `--all` y con nombre), `ls`/`ll`/`la` (también `--all --long` y con una especificación `git+file://`), `explain`/`why` (también con `git+file://`), `query` (`*`, `:outdated`, `:outdated(any)`, `:outdated(major)`, `:vuln`, `:missing`), `prefix`, `root` y `test`.
  - Control positivo: `npm view git+file://… --git=P` sí lo ejecuta, así que la prueba es efectiva.
- **Los 16 subcomandos con `""`, `--help`, `-h`, `--usage` y `help`**, añadiendo `--viewer=browser --browser=Q --editor=Q --shell=Q --node-gyp=Q --git=Q` y con la entrada estándar vacía: **ninguno ejecutó `Q`**.
- **Lo que queda está asignado a otras features**:
  - #18: `--script-shell`, `--node-options` y `--prefix`/`--workspace` hacia otra carpeta.
  - F14 D6: `npm start` sin script lanza `node server.js`, un fichero del proyecto.

### Conclusión

No encuentro ningún subcomando que siga en `GIT_SAFE_SUBCOMMANDS` o en `NPM_SAFE_SUBCOMMANDS` que ejecute un programa
indicado en la línea de órdenes, ni con opciones detrás, salvo las vías ya asignadas a #16, #18, #19 y la duda 5.

## Hallazgos

### Bloqueantes

Ninguno.

### Mejoras

Ninguna nueva. M1 sigue en T16 (humano, Windows, git 2.52).

### Notas

- **N4.** Algunas líneas nuevas pasan de 120 columnas:
  - En `panel/lib/claude-cli.js`, dos líneas de comentario: la de `cherry-pick --strategy` (124) y la de `view`/`info`/`show`/`v` (122).
  - Varias en los tests.
  - `docs/conventions.md` no fija un ancho y los ficheros ya tenían líneas así. Es solo estético.
- **N5.** En `[F15-R6]`, la función `run` se define antes que `const repo`. Funciona porque solo se llama después, pero se leería mejor detrás de la declaración. Es estético.
- **N2** (de la primera revisión) sigue igual. No se pidió cambiarla.

## Regresiones y desviaciones declaradas

- Tests anteriores a la feature 15: en todo el diff de la feature, los únicos cambios en tests de antes siguen siendo las dos líneas de import ampliadas.
- La Enmienda 1 solo toca tests de esta feature, y son exactamente los que lista design §6.3: `[F15-R1]`, `[F15-R2]`, `[F15-R5]` y `[F15-R7]` (`claude-cli.test.js`), `[F15-R6]` (`hardening.test.js`) y `[F15-R16]` (`deploy.test.js`). Están declarados en `docs/verification.md`.
- La comprobación de 120 columnas en `[F15-R16]` y el reajuste del apartado 2 están declarados como desviación.
- `[F14-R14]`/`[F14-R15]`, `[F14-R31]`/`[F14-R32]` y `[F4-R28]`/`[F14-R10]` pasan sin cambios.
- `specs/endurecimiento-ejecucion/tasks.md` (T30 de F14 marcada) cambió en `e5b7e80`. Ya estaba anotado en la primera revisión y no forma parte de esta feature.

## Portabilidad Windows

- Sin cambios respecto a la primera revisión: `taskkill` con guardia, `NoDefaultCurrentDirectoryInExePath=1`, extensiones de Windows en `commandBase` y `realpathSync.native`.
- `[F15-R6]` se salta en Windows. La evidencia con git 2.52.0.windows.1 es el paso 4 de T16.
- Pendiente: R13/T16 (manual).
