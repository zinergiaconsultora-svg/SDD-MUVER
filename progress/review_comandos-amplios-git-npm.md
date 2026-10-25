# Revisión — Feature 15: `comandos-amplios-git-npm`

**Veredicto: RECHAZADO** (HEAD `0fae39a`, implementación en `347bd6d`, diff desde
`sdd-checkpoint-comandos-amplios-git-npm-start`). La implementación cumple el design aprobado, los 488 tests pasan
y la trazabilidad está completa. Pero la lista permitida de git (`GIT_SAFE_SUBCOMMANDS`, design §3.2) incluye
`cherry-pick` y `merge`, y **los dos ejecutan un programa indicado en la línea de órdenes** con el git real 2.43.0
(bloqueante B1). Esto contradice la premisa de M1 ("un `git <sub>` solo es normal si se ha comprobado que no ejecuta
un programa indicado en la línea de órdenes") y la nota de evidencia de design §3.2, que dice que se comprobó y no
se ejecutó. El arreglo es pequeño, pero cambia la spec aprobada (design §3.2/§3.4, la tabla de R1 y los casos de R6),
así que tiene que volver a pasar por el humano.

## Checklist

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad R1–R18 ↔ tests | OK. Las etiquetas `[F15-R1]`–`[F15-R12]` y `[F15-R14]`–`[F15-R17]` existen en `panel/test/`. R13 es manual en Windows (T16) y queda pendiente del humano, sin bloquear. R18 se cubre con `./init.sh`. `[F15-R17]` comprueba automáticamente que hay una fila por requisito y que cada etiqueta está en algún test. |
| 2 | Tests (`bash init.sh`) | OK: **488 tests, 488 pass, 0 fail, 0 skipped** (Linux, git 2.43.0, npm 10.9.4). sdd-lint: 0 errores y 0 advertencias (17 tareas con trazabilidad). He leído los tests nuevos y no son triviales. `[F15-R6]` primero demuestra con el git real que se crea el fichero de marca y solo después comprueba la clasificación. `[F15-R14]` tiene una versión unitaria (linux y win32) y otra con un enlace simbólico real y `defaultFsOps`. `[F15-R12]` usa un run real `[[hang]]` cancelado y otro detenido por tiempo máximo, y compara el resolvedor por identidad. `[F15-R11]` comprueba el mensaje exacto, que `child.kill()` se llama una vez, que no se lanza nada y que un `kill` que lanza no rompe. **Laguna**: ningún test cubre las opciones `--strategy` de los subcomandos permitidos (B1). |
| 3 | Tareas | T1–T15 y T17 `[x]`. T16 `[ ]` (manual en Windows, aceptado). |
| 4 | Convenciones | OK. Código en inglés, comentarios en español, constantes congeladas en MAYÚSCULAS y referencias a la feature y la sección en los comentarios. En `docs/architecture.md` dos líneas del apartado 1 se pasan del ancho de la sección (N1). |
| 5 | Checkpoints | Se cumplen, salvo por B1 y la entrada de `progress/history.md` (la añade el leader al cerrar). No hay `progress/impl_comandos-amplios-git-npm.md`: el estado está en `progress/current.md`, como en las features anteriores. |
| 6 | Diseño | OK respecto a lo que pide el design. `claude-cli.js` (§3.2–§3.6), `exec-utils.js` (§4.1–§4.2), `runs.js` (§4.3) y `trusted-bin.js` (§5) coinciden con el texto del design. `work-api.js`, `app.js` y `public/` no cambian (§9). Los únicos cambios en tests anteriores son líneas de cabecera e imports ampliados (§6.3: "ninguno", correcto). No se ha colado nada extra. El defecto B1 está **en el design**, no en lo que se implementó. |

## Revisión con mentalidad de atacante

### Subcomandos y opciones de la lista permitida (con el git y el npm reales, en un temporal del scratchpad)

- **`git cherry-pick --strategy=<s>`**: ejecuta `git-merge-<s>` **sin validar el nombre**.
  - Con `git-merge-evilx` en el `PATH`, `git cherry-pick --strategy=evilx other` lo ejecutó.
  - Con una barra en `<s>`, el nombre se resuelve **relativo al cwd**. Con un fichero `git-merge-p/ev` en el repo, `git cherry-pick --strategy=p/ev other` lo ejecutó.
  - Con solo una carpeta vacía llamada `git-merge-..` en el repo, `--strategy=../../../../../../../../usr/bin/env` alcanza **cualquier programa del disco**.
  - `-X<opción>` le pasa `--<opción>` como primer argumento: un registrador lo vio como `[--split-string=sh -c 'touch x' sh] [<base>] [--] [<head>] [<commit>]`.
  - Juntándolo todo: `git cherry-pick --strategy=../…/usr/bin/env -X"split-string=sh -c 'touch MARCA' sh" other` **ejecutó el código de shell escrito en la línea de órdenes** (se creó `MARK-envS`).
  - La carpeta la puede crear Claude con `acceptEdits` (Write con `git-merge-../x`), o puede venir ya en un repo malicioso clonado. El código va en la línea de órdenes, no en un fichero del proyecto, así que **no** es el riesgo aceptado en F14 D6.
- **`git merge -s <s>`**: ejecuta `git-merge-<s>` del `PATH`.
  - `git merge -s evilx other` con `git-merge-evilx` en el `PATH` → ejecutado. Esto contradice la nota de design §3.2: "Se comprobó con un `git-merge-evilx` en el `PATH` y no se ejecutó".
  - Con una barra (`-s p/ev`, o una ruta con `../`) responde "Could not find merge strategy" y no ejecuta nada: `merge` valida el nombre contra la carpeta de ejecución y el `PATH`.
  - Es la misma clase de fallo que `git evilsub`, que la spec trata como amplio (R1).
- **`git revert --strategy=<s>`**: no ejecutó nada (2.43 hace la fusión interna en los reverts). La opción sí existe (`git revert -h`).
- Resto de `GIT_SAFE_SUBCOMMANDS`: revisé `git <sub> -h` de los 40 subcomandos buscando strategy, program, command, cmd, exec, editor, tool, pager, filter, textconv y helper. Lo único que aparece:
  - `cat-file --textconv`/`--filters`: usan drivers de `.git/config`/`.gitattributes` (#19).
  - `-s`/`-X` de `merge`, `cherry-pick` y `revert`.
  - Editor, pager, gpg, fsmonitor y hooks salen de la configuración o del entorno, no de la línea de órdenes.
  - `--output` es de la feature 16.
- **npm**:
  - `npm test --help --viewer=browser --browser=<registrador>` y `npm view --help …` solo imprimen el uso; no lanzan nada.
  - `NPM_SAFE_SUBCOMMANDS` no contiene ningún alias que lleve a un subcomando de ejecución.
  - `npm <script> --node-options`/`--script-shell`/`--prefix=<otra carpeta>` (scripts de otro `package.json`) son de la feature 18.

### `killProcessTree` en win32

- Solo puede lanzar `taskkillPath(env)` = `path.win32.join(SystemRoot || SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe')`, con `execFile`, sin shell y con argumentos fijos.
  - Si `SystemRoot` es relativo, la ruta no es absoluta y `isTrustedPath` la rechaza → `child.kill()`.
  - Si `SystemRoot` contiene `..`, `join` lo normaliza antes de la guardia.
- La guardia no exige que la ruta esté de verdad en `System32`, solo que sea absoluta y no esté en el cwd, en su ruta real ni en el catálogo. Un `SystemRoot` raro, como `\\servidor\x` o `D:\otra`, se aceptaría. Pero `env` es el del panel (`createRunManager({ env })` / `process.env`) y Claude no lo controla. Riesgo práctico nulo, dentro de lo que pide R10/R11 (N2).
- `runs.js` es el único que llama a `killTree`, y le pasa `resolver` (el mismo objeto que `guardedSpawn`) y `cwd: rec.cwd` (= `project.dir`).

### Exclusión por ruta real del cwd

- `defaultFsOps.realpath` usa `fs.realpathSync.native`. En Windows eso resuelve uniones, enlaces simbólicos, nombres 8.3 y `subst`. Si devuelve `null`, una ruta relativa o lanza una excepción, solo se excluye el cwd (R15, probado).
- `excludedDirs` cubre a la vez `resolve` e `isTrustedPath`. `isTrustedPath` comprueba además la ruta real del fichero contra las carpetas excluidas.
- No encuentro huecos nuevos. Los que quedan vienen de F14 y están documentados:
  - Si la ruta real del cwd es un proyecto contenedor (raíz o carpeta personal), solo se excluye su raíz.
  - Hay una ventana entre resolver y lanzar (TOCTOU) en la que se puede cambiar un enlace.
  - Las carpetas del catálogo se resuelven una vez por instantánea (D6).

## Hallazgos

### Bloqueantes

- **B1 — `cherry-pick` y `merge` en `GIT_SAFE_SUBCOMMANDS` ejecutan programas indicados en la línea de órdenes.**
  - Dónde: `panel/lib/claude-cli.js` (`GIT_SAFE_SUBCOMMANDS`) y `specs/comandos-amplios-git-npm/design.md` §3.2 (lista y nota "merge -s … no se ejecutó").
  - Requisitos afectados: R1 (la tabla clasifica implícitamente `git cherry-pick`/`git merge` como no amplios), R5, R6 y R7.
  - Efecto:
    - `isBroadCommand('git cherry-pick')` y `isBroadCommand('git merge')` devuelven `false`.
    - Tras una denegación, el panel **propone** "Permitir `git cherry-pick` y reintentar".
    - La regla `Bash(git cherry-pick *)` da ejecución de código arbitrario con `--strategy` + `-X` (más arriba).
  - Reproducción (git 2.43.0, Linux; en un repo temporal con una rama `other`):
    ```sh
    mkdir 'git-merge-..'
    git cherry-pick --strategy=../../../../../../../../usr/bin/env \
      -X"split-string=sh -c 'touch /tmp/MARCA' sh" other      # crea /tmp/MARCA
    PATH=/dir/con/git-merge-evilx:$PATH git merge -s evilx other   # ejecuta git-merge-evilx
    ```
  - Qué corregir (requiere cambiar la spec y que el humano la apruebe):
    1. design §3.2: quitar `merge` y `cherry-pick` de `GIT_SAFE_SUBCOMMANDS`. Se recomienda quitar también `revert`: hoy no ejecuta la estrategia, pero acepta `--strategy` y ese comportamiento depende de la versión de git. Corregir la nota de `merge -s`.
    2. design §3.4: añadir `merge`, `cherry-pick` (y `revert`) a `GIT_EXEC_SUBCOMMANDS` y estas filas a la tabla de evidencias.
    3. requirements R1 y design §3.5: añadir `git merge` y `git cherry-pick` a la columna de amplios. R5: incluirlos en la lista mínima.
    4. R6 (`hardening.test.js`): añadir los casos `cherry-pick --strategy=<ruta relativa>` (con una carpeta `git-merge-x` en el temporal) y `merge -s <nombre del PATH>`, con la misma evidencia de fichero de marca.
    5. Tests y docs: la tabla de `[F15-R1]`, `[F15-R5]` (`deepEqual` de `GIT_EXEC_SUBCOMMANDS`), `docs/architecture.md` apartado 2 (mencionar `-s`/`--strategy`) y la fila de R6 en `docs/verification.md`.
  - Nota: la regla por defecto de Claude Code del panel no incluye `merge` ni `cherry-pick`, así que el problema solo afecta a lo que se propone o se autoriza. En el PC del humano hay git 2.52: conviene repetir allí la comprobación de la lista (design §10.6).

### Mejoras

- **M1 (baja) — Evidencias con versión de git distinta en Windows.**
  - Las listas se comprobaron con git 2.43, pero el humano usa 2.52.0.windows.1 (T30 de F14).
  - Propuesta: añadir a T16 una comprobación rápida en Windows: `git cherry-pick --strategy=…` y `git merge -s …`, después de corregir B1, para ver que piden la confirmación con aviso.
- **M2 (baja) — Aislamiento de `[F15-R6]`.**
  - El test fija `GIT_CONFIG_NOSYSTEM=1`, pero hereda `HOME` y, con él, el `~/.gitconfig` del usuario. Un alias o un `url.insteadOf` del humano podría cambiar el resultado.
  - Propuesta: un `HOME` temporal, como en otros tests de `hardening.test.js`.

### Notas

- **N1.** En `docs/architecture.md`, apartado 1, el inciso queda mal colocado y la frase se lee mal: "Se descartan los candidatos (por ruta y por ruta real) (también la ruta real del cwd de la llamada, feature 15) del `cwd` de la llamada…". Es literal respecto a design §7.1, pero se leería mejor detrás de "del `cwd` de la llamada". Además, dos líneas superan el ancho del resto de la sección.
- **N2.** `killProcessTree` confía en el `SystemRoot` del entorno del panel (ver más arriba). Es correcto según R10/R11. Si algún día se quiere más, se puede exigir que la ruta termine en `\System32\taskkill.exe` bajo una raíz de unidad.
- **N3.** `git revert` acepta `--strategy` pero en 2.43 lo ignora (fusión interna). Si no se quita de la lista (B1, punto 1), conviene anotarlo en design §3.2 como comprobado.

## Regresiones y desviaciones declaradas

- No se ha modificado, saltado ni debilitado ningún test anterior. El diff de los tests solo quita dos líneas de import, que se sustituyen por la misma línea con más nombres.
- Las tablas `[F14-R14]`/`[F14-R15]`, `[F4-R28]`/`[F14-R10]` y `[F14-R31]`/`[F14-R32]` pasan sin cambios (§6.3).
- Desde `347bd6d` solo ha cambiado `docs/verification.md`, para registrar la T30 de F14 superada. No hay cambios de código.

## Portabilidad Windows

- `taskkill` va por ruta absoluta, pasa por la guardia y lleva `NoDefaultCurrentDirectoryInExePath=1`. Si la guardia lo rechaza, se usa `child.kill()` y se avisa en la consola.
- `commandBase` ignora `.exe`, `.cmd`, `.bat`, `.com` y `.ps1`.
- La ruta real del cwd se obtiene con `realpathSync.native` (uniones y `subst`).
- Pendiente: R13/T16 (manual).
