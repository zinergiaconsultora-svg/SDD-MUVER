# Requisitos — Feature 15: comandos amplios de git y npm (mejoras del reviewer de la feature 14)

> Origen: `progress/review_endurecimiento-ejecucion.md` (veredicto APROBADO de la feature 14 con las mejoras M1–M3).
> Base técnica: la spec implementada `specs/endurecimiento-ejecucion/` (design §3.5 `isBroadCommand`, §5.3
> `killProcessTree`, §3.3 exclusión de carpetas del resolvedor) y el código de `panel/lib/`.
>
> Alcance:
> (M1) un comando autorizado `git <sub>` o `npm <sub>` es **amplio** salvo que `<sub>` esté en una **lista permitida**
> de subcomandos comprobados (`design.md` §3); así `git fetch`, `git push`, `git clone`, `git ls-remote`, `git grep`,
> `git hook`, `npm run-script`, `npm install`… no se proponen nunca y añadirlos a mano exige la confirmación con aviso
> que ya existe desde la feature 14; además el nombre base del comando ignora `.exe`, `.cmd`, `.bat`, `.com` y `.ps1`;
> (M2) `killProcessTree` en Windows comprueba `isTrustedPath` antes de lanzar `taskkill` y le pasa
> `NoDefaultCurrentDirectoryInExePath=1`, como el resto de lanzamientos;
> (M3) el resolvedor excluye también la **ruta real** del `cwd` de la llamada;
> y la documentación (`docs/architecture.md`, `docs/verification.md`) dice exactamente lo que hace el código.
>
> Fuera de alcance (anotado como riesgo conocido o duda para el humano, ver `design.md` §10): las opciones que escriben
> ficheros fuera del proyecto (`git log/diff/show --output`), las opciones de configuración de npm que se pueden añadir
> detrás de un comando de scripts (`npm test --node-options=…`, `--script-shell=…`), las reglas de `pnpm`, `yarn` y
> `bun` (siguen las listas de denegación de la feature 14), la configuración de `.git/` (fsmonitor, filtros, hooks,
> alias) y el arranque de `cloudflared`.
>
> Convención de este fichero: cada requisito ocupa UNA sola línea (así `sdd-lint.js` lo valida completo) y va seguido
> de su línea *Cómo se prueba*. Listas, tablas y textos exactos están en `design.md`. Los tests se etiquetan
> `[F15-R<n>]`; los de integración usan repos git temporales reales y ejecutables falsos que solo escriben ficheros de
> marca en temporales. Los requisitos marcados **[MANUAL — Windows]** los comprueba el humano en su PC y anota el
> resultado en `docs/verification.md`.

## Vocabulario

- **Comando amplio:** comando autorizado que permitiría a Claude ejecutar un programa o código indicado en la propia línea de órdenes (por un argumento, una opción o un subcomando), sin que tenga que estar en un fichero del proyecto; lo decide `isBroadCommand` (`design.md` §3).
- **Lista permitida de git / npm:** `GIT_SAFE_SUBCOMMANDS` y `NPM_SAFE_SUBCOMMANDS` (+ `NPM_RUN_SUBCOMMANDS` con un nombre de script), en `lib/claude-cli.js` (`design.md` §3.2 y §3.3).
- **Lista de referencia:** `GIT_EXEC_SUBCOMMANDS` y `NPM_EXEC_SUBCOMMANDS`, subcomandos que se sabe que ejecutan programas (`design.md` §3.4); no deciden nada, sirven para que los tests comprueben que todos son amplios.
- **Nombre base:** último segmento del primer token tras `/`, en minúsculas y sin extensión `.exe`, `.cmd`, `.bat`, `.com` ni `.ps1`.

## A. Subcomandos de git y npm (M1)

- **R1.** Cuando el sistema clasifica un comando cuyo nombre base es `git` y que tiene un segundo token que no empieza por `-` ni por `/`, `isBroadCommand` debe devolver `false` si ese token está (comparación exacta, sensible a mayúsculas) en `GIT_SAFE_SUBCOMMANDS` de `design.md` §3.2 y `true` en cualquier otro caso, incluidos los subcomandos desconocidos, los alias y los que la lista no contempla.
  - *Cómo se prueba:* test unitario con la tabla de `design.md` §3.5: `git fetch`, `git pull`, `git push`, `git clone`, `git ls-remote`, `git grep`, `git hook`, `git submodule`, `git bisect`, `git rebase`, `git difftool`, `git mergetool`, `git filter-branch`, `git send-email`, `git maintenance`, `git help`, `git init`, `git worktree`, `git apply`, `git co`, `git evilsub`, `git STATUS` → `true`; `git status`, `git diff`, `git log`, `git show`, `git rev-list`, `git commit`, `git add`, `git checkout`, `git branch`, `git stash`, `git blame` → `false`; `git`, `git -c`, `git -C x` siguen siendo `true`.

- **R2.** Cuando el sistema clasifica un comando cuyo nombre base es `npm` y que tiene un segundo token que no empieza por `-` ni por `/`, `isBroadCommand` debe devolver `false` solo si ese token está en `NPM_SAFE_SUBCOMMANDS` o si está en `NPM_RUN_SUBCOMMANDS` (`run`, `run-script`, `rum`, `urn`) y va seguido de un nombre de script que no empieza por `-`, y `true` en cualquier otro caso.
  - *Cómo se prueba:* test unitario con la tabla de `design.md` §3.5: `npm install`, `npm i`, `npm add`, `npm ci`, `npm exec`, `npm x`, `npm explore`, `npm init`, `npm create`, `npm innit`, `npm run-script`, `npm rum`, `npm urn`, `npm run`, `npm run -s`, `npm config`, `npm c`, `npm set`, `npm edit`, `npm repo`, `npm docs`, `npm help`, `npm fund`, `npm publish`, `npm pack`, `npm rebuild`, `npm update`, `npm audit`, `npm desconocido` → `true`; `npm test`, `npm t`, `npm tst`, `npm start`, `npm stop`, `npm restart`, `npm run build`, `npm run-script build`, `npm rum build`, `npm urn build`, `npm ls`, `npm list`, `npm outdated`, `npm view`, `npm explain`, `npm why`, `npm query`, `npm prefix`, `npm root` → `false`.

- **R3.** Cuando el sistema clasifica un comando cuyo nombre base es `pnpm`, `yarn` o `bun`, `isBroadCommand` debe aplicar sin cambios las reglas de la feature 14 (`PKG_EXEC_SUBCOMMANDS` y `run` sin script), de modo que la tabla de comandos amplios y no amplios de la feature 14 siga dando el mismo resultado.
  - *Cómo se prueba:* test unitario: `pnpm dlx x`, `yarn create app`, `bun x y`, `pnpm run`, `yarn run -s` → `true`; `yarn test`, `bun run build`, `pnpm run lint`, `pnpm install` → `false`; y el test de la tabla de la feature 14 (`claude-cli.test.js`) pasa sin modificarse.

- **R4.** Cuando el sistema calcula el nombre base del primer token de un comando, debe quitar la extensión final `.exe`, `.cmd`, `.bat`, `.com` o `.ps1` (sin distinguir mayúsculas), de modo que `npm.cmd`, `git.exe`, `npx.cmd`, `NODE.EXE` y `pnpm.ps1` se clasifiquen igual que `npm`, `git`, `npx`, `node` y `pnpm`.
  - *Cómo se prueba:* test unitario: `npm.cmd exec x`, `NPM.CMD install`, `git.exe fetch`, `npx.cmd`, `node.bat -e`, `pnpm.ps1 dlx x`, `C:/tools/Git/cmd/git.exe push` → `true`; `npm.cmd test`, `git.exe status`, `node.cmd build.js` → `false`.

- **R5.** El sistema debe exportar congeladas `GIT_EXEC_SUBCOMMANDS` y `NPM_EXEC_SUBCOMMANDS` con exactamente los elementos de `design.md` §3.4, y cuando se clasifica `git <sub>` o `npm <sub>` con cualquier elemento de esas listas, `isBroadCommand` debe devolver `true`; ninguna de ellas debe compartir elementos con la lista permitida correspondiente.
  - *Cómo se prueba:* test unitario que recorre las dos listas (todas amplias), comprueba que son disjuntas de `GIT_SAFE_SUBCOMMANDS` y de `NPM_SAFE_SUBCOMMANDS` + `NPM_RUN_SUBCOMMANDS`, que están congeladas y que contienen al menos `fetch`, `pull`, `push`, `clone`, `ls-remote`, `grep`, `hook`, `submodule`, `bisect`, `rebase`, `difftool`, `mergetool`, `filter-branch` (git) y `exec`, `x`, `explore`, `init`, `create`, `install`, `run-script`, `edit` (npm).

- **R6.** Si el git real del sistema ejecuta un programa indicado en una opción de `fetch --upload-pack`, `ls-remote --upload-pack`, `push --receive-pack`, `push --exec`, `clone -u` o `grep -O`, entonces `isBroadCommand` debe devolver `true` para el comando base correspondiente (`git fetch`, `git ls-remote`, `git push`, `git clone`, `git grep`).
  - *Cómo se prueba:* test de integración (Linux, se salta sin git y en Windows) con un repo temporal y un script de marca por caso: el test comprueba primero que el git real crea el fichero de marca ("la evidencia es efectiva") y después que `isBroadCommand` del comando base es `true` y `suggestAllowedCommand` del comando completo es `null`.

- **R7.** Cuando el sistema propone comandos tras una denegación, `suggestAllowedCommand` y `suggestAllowedCommands` no deben devolver nunca un `git <sub>` ni un `npm <sub>` amplio según R1, R2 y R4, y con un subcomando de `NPM_RUN_SUBCOMMANDS` seguido de un script deben proponer el comando con el alias que se usó y el nombre del script.
  - *Cómo se prueba:* test unitario: `git fetch --upload-pack=x origin`, `git push --receive-pack=x`, `git clone -u x repo`, `git grep -Ox hola`, `git hook run pre-commit`, `git ls-remote --upload-pack=x .`, `git submodule foreach ls`, `npm run-script`, `npm install left-pad`, `npm i -D x`, `npm exec foo`, `npm.cmd exec foo` → `null`/`[]`; `npm run-script lint -- --fix` → `npm run-script lint`; `npm rum build` → `npm rum build`; `git commit -m x` → `git commit`; `git rev-list --count HEAD` → `git rev-list`; `git fetch origin && npm test` → `["npm test"]`.

- **R8.** Si `POST /api/projects/:id/permissions` o `PATCH /api/projects/:id` reciben un comando que es amplio según R1, R2 o R4 sin `acknowledgeBroad: true`, entonces el sistema debe responder `400` con `needsAcknowledge: true` y ese comando en `broadCommands` sin guardar nada, y con la marca debe guardarlo y registrar `acknowledgedBroad` en `audit.log`, igual que con los comandos amplios de la feature 14.
  - *Cómo se prueba:* test de integración: `POST` con `git fetch` → `400` y `projects.json` sin cambios; con la marca → `200`, guardado y línea de auditoría con `acknowledgedBroad: ["git fetch"]`; `PATCH` con `["npm test", "npm run-script", "npm install"]` → `400` con `broadCommands: ["npm run-script", "npm install"]` y registro intacto; `POST` con `git commit` sin marca → `200`.

- **R9.** Cuando `GET /api/projects/:id/work` responde para un proyecto que ya tenía guardados comandos que pasan a ser amplios con esta feature, el sistema debe incluirlos en `broadCommands` y un `PATCH` que los mantiene sin cambios no debe exigir `acknowledgeBroad`.
  - *Cómo se prueba:* test de integración con un registro inicial con `allowedCommands: ["npm test", "git push", "npm install"]`: `broadCommands` es `["git push", "npm install"]`; un `PATCH` con la misma lista y otro `testCommand`, sin la marca → `200`.

## B. `taskkill` con la guardia final (M2)

- **R10.** Cuando `killProcessTree` se ejecuta en Windows y la ruta de `taskkill` (`taskkillPath(env)`) es una ruta de confianza para el resolvedor recibido (o uno creado para esa plataforma y ese `env` si no se recibe) con el `cwd` recibido, el sistema debe lanzarla con los argumentos de la feature 14, `windowsHide: true`, sin shell y con un entorno igual al `env` recibido más `NoDefaultCurrentDirectoryInExePath=1`.
  - *Cómo se prueba:* test unitario con `execFileImpl` espía, `platform: 'win32'`, `env` con `SystemRoot` y otra variable, con y sin resolvedor inyectado: una sola llamada con la ruta absoluta, los mismos argumentos, `opts.env.NoDefaultCurrentDirectoryInExePath === '1'`, la otra variable conservada y `opts.shell` falso.

- **R11.** Si en Windows la ruta de `taskkill` no es una ruta de confianza (por ejemplo, `SystemRoot` apunta dentro del `cwd` del run o de un proyecto del catálogo), entonces `killProcessTree` no debe lanzar ningún proceso, debe terminar solo el proceso hijo con `child.kill()` y debe escribir en la consola un error con el texto `taskkillUntrusted` de `design.md` §4.1.
  - *Cómo se prueba:* test unitario con `execFileImpl` espía, `env: { SystemRoot: 'C:\\proj' }`, `cwd: 'C:\\proj'`, un hijo falso con `kill` espía y `console.error` interceptado: el espía de `execFile` no se llama, `kill` se llama una vez y el mensaje es el exacto.

- **R12.** Cuando el gestor de runs cancela un run o lo detiene por tiempo máximo, el sistema debe llamar a `killTree` con `platform`, `env`, el mismo resolvedor que usa `guardedSpawn` y `cwd` igual a la carpeta del proyecto del run.
  - *Cómo se prueba:* test unitario de `createRunManager` con `killTree` espía, un resolvedor inyectado y un run `[[hang]]` cancelado: el espía recibe `resolver` (el mismo objeto) y `cwd` (la carpeta del proyecto).

- **R13.** [MANUAL — Windows] Cuando el humano cancela en Windows un run de Claude o de tests en marcha, el sistema debe terminar el árbol de procesos como antes de esta feature (sin procesos `claude`, `node` o `bash` del run vivos tras unos segundos).
  - *Cómo se prueba:* el humano sigue la receta de `design.md` §6.4 (junto con la comprobación manual pendiente de la feature 14) y anota fecha, versiones y resultado en `docs/verification.md`.

## C. Ruta real del `cwd` en el resolvedor (M3)

- **R14.** Cuando el resolvedor calcula las carpetas excluidas de una llamada y la ruta real del `cwd` (con `fsOps.realpath`) existe y es distinta del `cwd`, el sistema debe excluir también esa ruta real, de modo que `resolve` e `isTrustedPath` descarten un candidato que esté en el destino de un `cwd` que es un enlace simbólico o una unión.
  - *Cómo se prueba:* test unitario con `fsOps` inyectado (linux: `cwd` `/tmp/enlace` → `/datos/proyecto`, `PATH` `/datos/proyecto:/usr/bin` → `/usr/bin/git`, e `isTrustedPath('/datos/proyecto/git', { cwd: '/tmp/enlace' })` → `false`; win32: `C:\enlace` → `D:\proyecto`, mismo resultado) y test de integración en Linux con un enlace simbólico real y el `defaultFsOps` (se salta en Windows).

- **R15.** Si `fsOps.realpath` del `cwd` devuelve `null`, lanza una excepción o devuelve una ruta que no es absoluta, entonces el resolvedor debe excluir solo el `cwd` tal como viene, sin propagar el error y sin cambiar el resultado de las demás comprobaciones.
  - *Cómo se prueba:* test unitario con `realpath` que devuelve `null`, que lanza y que devuelve `rel/x`: `resolve('git', { cwd })` devuelve el mismo resultado que en la feature 14 y no lanza; los resolvedores de compatibilidad de `exec-utils.js` y `claude-cli.js` (con `realpath: () => null`) no cambian sus resultados.

## D. Documentación y verificación final

- **R16.** Cuando se cierra la feature, el sistema debe tener en `docs/architecture.md`, sección "Seguridad de la ejecución", los textos de `design.md` §7.1: el apartado 1 con la guardia y el entorno de `taskkill` y la ruta real del `cwd`, el apartado 2 con las listas permitidas de git y npm, y el apartado 6 con los riesgos conocidos nuevos.
  - *Cómo se prueba:* test estático en `panel/test/deploy.test.js` que busca en esa sección las cadenas clave de `design.md` §7.1 (`GIT_SAFE_SUBCOMMANDS`, `NPM_SAFE_SUBCOMMANDS`, `lista permitida`, `taskkillUntrusted`, `ruta real del cwd`, `--node-options`, `--output`) y que el test estático de la sección de la feature 14 sigue pasando.

- **R17.** Cuando se cierra la feature, el sistema debe tener en `docs/verification.md` la sección "Mapa de trazabilidad — Feature 15" con prefijo `[F15-R<n>]`, una fila por requisito, la fila manual pendiente del humano y la lista de cambios declarados en tests anteriores de `design.md` §6.3.
  - *Cómo se prueba:* test estático en `panel/test/deploy.test.js` que comprueba la sección, una fila por requisito y que cada etiqueta `[F15-R<n>]` no manual aparece en algún fichero de `panel/test/`.

- **R18.** Cuando se ejecuta `./init.sh` al terminar, el sistema debe pasar todos los tests de las fases 1–4 y de las features 14 y 15, con solo los cambios de tests anteriores declarados en `design.md` §6.3, y `node sdd-lint.js` debe terminar con 0 errores.
  - *Cómo se prueba:* ejecución de `./init.sh` (tarea final de `tasks.md`) con todo en verde; el reviewer compara los tests cambiados con la lista de §6.3.
