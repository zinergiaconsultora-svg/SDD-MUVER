# Revisión — Feature 14: `endurecimiento-ejecucion`

**Veredicto: APROBADO** (HEAD `e5b7e80`, diff `sdd-checkpoint-endurecimiento-start..HEAD -- panel/ docs/ specs/`).

No hay bloqueantes contra la spec aprobada (R1–R33, D1–D12). El objetivo principal, M1, está cerrado de verdad: ningún
proceso del panel se lanza con un nombre suelto. El único `spawn` por nombre que queda es `cloudflared`, que está fuera
de alcance y documentado. Ni con enlaces simbólicos ni con trucos en el `PATH` he conseguido que el resolvedor ejecute un
binario de un proyecto.

Hay dos **mejoras de prioridad alta**. Ninguna incumple la spec: son huecos de la propia spec.

- **MA1:** la lista de comandos amplios (M2) deja pasar `git fetch`/`push`/`ls-remote`/`grep`, las variantes `.cmd` y
  los cmdlets de PowerShell.
- **MA2:** el sondeo del listado, sin ningún clic, sigue ejecutando programas definidos en `.git/config` mediante
  `log.showSignature`+`gpg.program` (sin documentar) y los filtros `clean` (documentado).

Conviene resolverlas antes de la exposición permanente por Internet.

## Checklist

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad R1–R33 ↔ tests | OK. Cada R no manual tiene su etiqueta `[F14-R<n>]` en `panel/test/`, y `deploy.test.js` lo comprueba (R32). He leído `trusted-bin`, `hardening`, `runs-api`, `git-info`, `git-actions`, `claude-cli`, `work-api` y `work-render`. No son triviales: los ejecutables falsos escriben marcas, cada fixture comprueba que es efectivo (un `git status` sin prefijo sí dispara fsmonitor/textconv), el `PATH` de prueba está aislado y nunca alcanza un `claude` real, y el push va a un `--bare` local. R12 es manual y está superado (T30). |
| 2 | `bash init.sh` | OK: **470 tests, 470 pass, 0 fail, 0 skipped** (Linux). sdd-lint: 0 errores y 0 advertencias. |
| 3 | Tareas | T1–T31 marcadas `[x]`. |
| 4 | Convenciones | OK. Código en inglés, comentarios y textos visibles en español, constantes en MAYÚSCULAS y errores con mensaje útil (en `untrusted` solo va el último segmento de la ruta). |
| 5 | Checkpoints | Se cumplen. Las dos puertas están aprobadas y T30 está superado. Queda `progress/history.md` para el leader al cerrar. |
| 6 | Diseño | OK. La implementación coincide con §3–§6. Solo se tocó lo permitido por §10 (en `registry.js`, una línea). No se ha colado nada extra. |

## Pruebas contra la app real (`createApp` + CLI falso, temporales)

Escenario: proyecto B con un `git` falso que escribe una marca, registrado en el catálogo. El `PATH` del panel era
`<enlace simbólico a B>:.::rel/bin:<B>/:<bin con git real>`.

**M1 (ejecutables de un proyecto):**

- Listado, detalle, cambios y "Ejecutar tests" (`git --version`): todo se ejecuta con el git real (`git version 2.43.0`). El `git` falso de B **no se ejecutó nunca**.
- Chat con `claudeBin: 'claude'` sin Claude en el `PATH`: `409 notFound`.

**Configuración del repo (proyecto A, `.git/config` preparado, `GET /api/projects` sin ningún clic):**

- Se ejecutaron el **filtro `clean`** y el **`gpg.program`**: el `git log -1 --format=…` del sondeo, con `log.showSignature=true`, verifica la firma (MA2).
- `core.fsmonitor` y `textconv` no se ejecutan (R22 y R23 están verificados por los tests).

**M2 (comandos amplios):**

- `POST /permissions` acepta **sin `acknowledgeBroad`** `git fetch`, `npx.cmd`, `Invoke-Expression` y `git grep`.
- `node` sí exige la confirmación (`400 needsAcknowledge`).

**Comprobación aparte en un repo temporal:** `git ls-remote --upload-pack=<script>`, `git fetch --upload-pack=<script>`
y `git grep --open-files-in-pager=<script>` ejecutan el script.

No toqué `panel/projects.json` ni los datos del humano, borré los temporales y el árbol quedó limpio.

## Revisión con mentalidad de atacante

**Lanzamientos (grep exhaustivo de `spawn`/`execFile`/`exec`/`fork`/`child_process` en `panel/`):**

- `runs.js:233`: `spawnImpl` solo se llama desde `guardedSpawn` (`isTrustedPath` o `projectScript` dentro del `cwd`).
- `git-info.js:46`: el runner central resuelve, aplica la guardia y añade el prefijo.
- `exec-utils.js:125`: `taskkill` va por `%SystemRoot%\System32\taskkill.exe`.
- `tunnel.js:64`: `spawn('cloudflared')` por nombre. Está fuera de alcance y documentado; ver N1.
- `scripts/` y `deploy/` no lanzan procesos por sí mismos.
- `server.js` ya no resuelve Claude al arrancar: lo hace en cada run con el `cwd` y el catálogo vigente.

**Resolvedor (`trusted-bin.js`):**

- Se descartan las entradas de `PATH` vacías, `.`, relativas, con `%` o con comillas mal formadas. En Windows solo se aceptan `X:\` y `\\`.
- No se usa `PATHEXT`: solo `.com`/`.exe`.
- La comparación usa `pathKey`, sin distinguir mayúsculas en win32.
- Cada candidato se excluye también por su ruta real (`realpathSync.native`), y `catalogDirs` añade la ruta real de cada proyecto (`fsp.realpath`, nativa). Probado en la app: con una entrada de `PATH` que es un enlace simbólico a un proyecto, con `/` final, con `//`, con `./` o `../` y con el proyecto registrado por su enlace, siempre se descarta.
- Un proyecto que es a la vez carpeta del `PATH` (`~/.local/bin`) se excluye entero.
- La caché solo guarda los candidatos. La exclusión se recalcula en cada llamada, así que un proyecto añadido después excluye un `git` ya cacheado (probado).
- En Windows, `\\?\`, unidades `subst` y nombres 8.3 quedan cubiertos porque la ruta real se resuelve de forma nativa. Solo queda un alias por recurso administrativo UNC (N2).

**Proyecto contenedor:** de `HOME` o de una raíz de unidad solo se excluye la raíz. Queda una vía aceptada en §12, que el
humano aprobó: si `HOME` está en el catálogo y Claude trabaja ahí con `acceptEdits`, puede escribir
`~/.local/bin/git(.exe)`. Tras reiniciar el panel, si esa carpeta va antes en el `PATH`, el panel la usaría. Es el
mismo riesgo que `~/.bashrc` o la carpeta Inicio de Windows, así que no es un hueco nuevo, pero conviene escribirlo
explícitamente (N3).

**Guardia `projectScript`:** solo se activa con un `file` absoluto dentro del `cwd`. Los pasos se construyen en el
servidor y el cliente no puede marcarlos.

**M3/M4/N3:**

- `-c core.fsmonitor=false` va en todas las llamadas git: runner central (listado, detalle, `/changes`, diff, hooks) y los tres pasos de "Commit y push".
- El diff usa `--literal-pathspecs --no-ext-diff --no-textconv`.
- Los hooks se listan y se avisa de ellos. No se usa `--no-verify` (test estático).
- El push lleva `GIT_SSH_COMMAND` en BatchMode (en git tiene prioridad sobre `core.sshCommand`).
- `core.pager`: git no usa el pager sin TTY y `execFile` no lo es.
- `core.editor`: no aplica, porque el commit es `-m`.
- `diff.external`: queda anulado por `--no-ext-diff`.
- Los demás vectores de configuración del repo (filtros, `gpg.program`, `credential.helper`/`core.askPass`, `remote.*.receivepack`…) están en MA2 y M3.

**M5/N4:**

- Todo evento salvo `state`/`end` cuenta para los 5 MB. El aviso de truncado y el de tiempo máximo son esenciales.
- Las denegaciones tienen un tope de 50, con un solo aviso.
- `approve-spec` responde `409` con un run activo.

## Hallazgos

### Bloqueantes

Ninguno.

### Mejoras

- **MA1 (alta) — Comandos amplios que se cuelan (M2).**
  - Dónde: `panel/lib/claude-cli.js:59` (`GIT_EXEC_SUBCOMMANDS`), `:69` (`commandBase`) y `:52` (`RUNNER_COMMANDS`). Requisitos: R14, R15, R16.
  - La implementación cumple las listas de design §3.5, pero estas son incompletas, y sin `acknowledgeBroad` y **proponiéndose tras una denegación** pasan:
    - `git fetch`, `git pull`, `git push`, `git ls-remote` y `git clone` (con `--upload-pack`/`--receive-pack` ejecutan un programa local; verificado) y `git grep` (`-O`/`--open-files-in-pager`; verificado).
    - En Windows, `npx.cmd`, `npm.cmd exec`, `pnpm.cmd dlx` y `node.cmd`: `commandBase` solo quita `.exe`.
    - Cmdlets de PowerShell (el panel genera reglas `PowerShell(...)`): `Invoke-Expression`, `iex`, `Start-Process`, `saps`, `Invoke-Command`, `icm`, `Invoke-Item`.
    - Intérpretes con versión: `python3.12 -c`.
    - Lanzadores con subcomando: `yarn node`, `deno eval`, `uv run`, `tsx`, `corepack`.
  - Camino de ataque: una inyección de prompt hace que Claude ejecute `git fetch --upload-pack='…' .` o `npx.cmd -y paquete`. La denegación propone «git fetch» o «npx.cmd» **sin aviso**. Un clic en "Permitir y reintentar" da ejecución libre permanente en ese proyecto.
  - Recomendación:
    - En `commandBase`, quitar también `.cmd`, `.bat`, `.ps1` y `.com`.
    - Añadir a `GIT_EXEC_SUBCOMMANDS` `fetch`, `pull`, `push`, `clone`, `ls-remote` y `grep`.
    - Añadir una lista de cmdlets y alias de PowerShell como envolventes.
    - Normalizar `python3.N`.
    - Documentar que la lista negra es inevitablemente incompleta: también son de facto amplios `npm install <url>`, con sus scripts de ciclo de vida, y cualquier comando que ejecute código editable del proyecto (`npm run x`).
- **MA2 (alta) — El sondeo sin clic sigue ejecutando programas de `.git/config` (M3).**
  - Dónde: `panel/lib/git-info.js:25` (`GIT_SAFE_PREFIX`), `:16-19` (`log -1/-10`, `status`) y `git-actions.js:19-23` (`diff --stat`/diff). Requisitos: R21, R22, R31.
  - Verificado en la app: con `log.showSignature=true` y `gpg.program=<script>` en `.git/config` y un commit con `gpgsig`, `GET /api/projects` ejecuta el script en cada sondeo. **No está documentado.** Con `filter.X.clean` y `.gitattributes`, el `git status` del listado (con un cambio del mismo tamaño) y el `diff --stat` de "Ver cambios" ejecutan el filtro. Esto sí está documentado como riesgo conocido (R31).
  - Ambos requieren poder escribir en `.git/config`, igual que fsmonitor. Pero el objetivo de M3 era precisamente cerrar el camino sin clic, y este queda abierto.
  - Arreglo sugerido:
    - Añadir `-c log.showSignature=false` a `GIT_SAFE_PREFIX` (trivial).
    - Para los filtros en lecturas, valorar `--attr-source=<árbol vacío>` (git ≥ 2.42), o anular los `filter.<n>.clean/process` que devuelva `git config --get-regexp '^filter\.'`.
    - Si no se hace, documentar el caso de `showSignature`.
- **M3 (media) — Vectores de configuración en "Commit y push" sin aviso ni documentación.**
  - Requisitos: R25, R31.
  - Además de los hooks (que sí se avisan) y de `credential.helper` (documentado), en el commit y en el push se ejecutan:
    - `gpg.program`, con `commit.gpgsign=true`;
    - `core.askPass` (no lo frena `GIT_TERMINAL_PROMPT=0`);
    - `remote.origin.receivepack`, con un remoto local.
  - Si el humano define `GIT_SSH` (no `GIT_SSH_COMMAND`), un `core.sshCommand` del repo tiene prioridad sobre `GIT_SSH`.
  - Recomendación: añadirlos a "Riesgos conocidos" de `docs/architecture.md`, o anular `gpg.program`/`core.askPass` con `-c` en los pasos.
- **M4 (baja, UX, T30) — Campos que se confunden.**
  - Dónde: `panel/public/work.js:110` y `:114`.
  - El humano escribió el comando de tests en "Comandos que Claude puede ejecutar", y `git --version` disparó el aviso de comando amplio (es amplio por regla: `git` + opción).
  - Recomendación: separar visualmente las dos secciones, con un texto de ayuda bajo cada campo (p. ej. "Esto NO es el comando de tests").

### Notas

- **N1.** `panel/lib/tunnel.js:64` lanza `spawn('cloudflared')` por nombre con el `cwd` del panel. Si la carpeta del panel está dentro de un proyecto del catálogo (el propio `SDD-MUVER`, si se abrió con Claude Code), en Windows libuv buscaría primero `cloudflared.exe` en ese `cwd`. `install-service.ps1` pasa `CLOUDFLARED_BIN` absoluto, así que solo afecta al arranque manual. Está fuera de alcance y documentado; para una feature futura, conviene usar el resolvedor también ahí.
- **N2.** Alias de ruta que no se normalizan: una entrada de `PATH` `\\localhost\C$\proyecto` apunta al mismo proyecto, pero su ruta real sigue siendo UNC y no se excluye. Requiere que el humano tenga ese `PATH`; el impacto es mínimo.
- **N3.** El proyecto contenedor (D2, §12) queda aceptado por el humano. Convendría añadir una línea en `docs/architecture.md`: con `HOME` en el catálogo, Claude puede escribir en `~/.local/bin` y el panel lo usaría tras reiniciarse si esa carpeta va antes en el `PATH`.
- **N4.** `createStreamMapper` sigue llenando `seenDenials`, `toolInputs` y `approvals` después del tope y del truncado (`claude-cli.js:285-339`). La memoria crece con el run hasta el timeout. Es menor.
- **N5.** Las reglas por defecto `Bash(git diff *)`/`Bash(git log *)` (de la fase 4) admiten `--output=<fichero>` (escritura de ficheros). Está fuera de esta feature; lo anoto para una revisión futura de las reglas por defecto.

## Regresiones y desviaciones declaradas

Las seis desviaciones declaradas en `docs/verification.md` son **legítimas**: cada una es consecuencia directa de un
requisito o de un texto de esta spec.

- **F4-R30:** el `result` se descarta tras el truncado (R27). El estado y el coste salen de `rec.result`, así que el run conserva `succeeded`.
- **F4-R24/R65:** `node --version` ya no propone `node` (R15).
- **F4-R12:** un `.mjs` relativo se hace absoluto respecto al panel (§5.5 paso 2; si no, Node lo resolvería contra el proyecto).
- **F4-R28:** `taskkill` va por ruta absoluta (R10).
- **F4-R62/R64:** texto ampliado de `invalidCommand` (§4.1).
- **F4-R6:** `broadCommands: []` (R18).

He comparado las líneas eliminadas de los tests antiguos con esta lista y con §8.3 y no hay ningún otro cambio. Las fases
1–4 siguen en verde.

## Portabilidad Windows

- `.com`/`.exe` sin `PATHEXT`, rutas con `path.win32` y `pathKey` sin distinguir mayúsculas.
- `taskkill` absoluto y `NoDefaultCurrentDirectoryInExePath=1` en los hijos.
- `npm`/`npx` → `node npm-cli.js`; Git Bash sin `System32`.
- Comprobado por el humano en T30 con `whoami.exe` como `git.exe` y `claude.exe`: no se ejecutó en ningún paso.

## Re-revisión (HEAD `3f68a23`: R34–R39, design §13)

**Veredicto: APROBADO.**

- `bash init.sh`: **481/481** tests en verde y sdd-lint con 0 errores.
- MA1, MA2, M3, M4, N3, N4 y N5 están corregidos y cumplen R34–R39.
- Las dos desviaciones de §13.2 son razonables:
  - No se usa `-c gpg.program=`, porque rompería la firma del humano, y `log.showSignature=false` ya evita que las lecturas llamen a gpg.
  - No se usa `--attr-source`, porque `.git/info/attributes` sigue aplicándose y además pierde `text`/`eol`. Lo he comprobado.
- Quedan dos huecos de la misma clase (requieren poder escribir en `.git/`, como antes fsmonitor) y una lista negra todavía incompleta. Son **mejoras**, no bloqueantes.

### Comprobado contra la app real (temporales, CLI falso, push solo a un `--bare` local)

- **MA1.** `git fetch --upload-pack=…`, `npx.cmd -y …`, `Invoke-Expression -Command …` y `git grep -O…` son ahora amplios, no se sugieren (`null`) y exigen `acknowledgeBroad`. Tampoco se cuelan:
  - las variantes `GIT FETCH`, `git.exe fetch`, `git -C . fetch` y `git remote update`;
  - `node.cmd`, `npm.ps1 exec`, `python3.12w -c` y `Py.exe -c`;
  - `cmd.exe /c`, `pwsh.exe -File`, `& x` y `Start x`.
- **MA2.** Probé con un repo que tiene `log.showSignature`, `gpg.program`, `filter.evil.clean` y `commit.gpgsign` en `.git/config`. El listado de la app, el detalle, "Trabajar" y `GET /changes` (en navegador headless) **no** ejecutan ningún script de marca. Con el runner central directamente, `status`, `diff --stat`, `diff` y `log`, con un filtro local o con `.git/info/attributes` que apunta a un filtro local, tampoco ejecutan nada. `core.pager` y `pager.log` no se usan, porque no hay TTY.
- **M3 y M4** (Playwright, Chromium headless, contra el panel real):
  - El diálogo de "Commit y push" muestra el aviso de hooks (`pre-commit`) y el nuevo «Atención: la configuración de este repositorio ejecutará programas al hacer commit y push: firma de commits (commit.gpgsign ejecuta gpg.program); filtros de .gitattributes (evil)…».
  - El nombre del proyecto `<b>A</b>` sale escapado.
  - Bajo cada campo de "Ajustes de ejecución" aparece su texto de ayuda exacto, con `aria-describedby` correcto.
  - Ningún fichero de marca en todo el recorrido.

### Hallazgos nuevos

- **MB1 (alta, no bloqueante) — Los filtros se escapan de la anulación por dos vías.**
  - Dónde: `panel/lib/git-info.js` (`GIT_LOCAL_FILTERS_ARGS` con `--local`) y `git-actions.js` (`repoConfigRisks` con `--local`). Requisitos: R35, R36. Ambas vías verificadas.
  - (a) **`config.worktree`.** Con `extensions.worktreeConfig=true` y `git config --worktree filter.evil.clean <script>`, el script se ejecuta en `status`, `diff --stat` y diff. `git config --local` no lee `config.worktree`.
  - (b) **Submódulos.** El `git status` del superproyecto entra en cada submódulo y aplica el filtro definido en `.git/modules/<sm>/config` (sí ejecutado). El fsmonitor del submódulo no se ejecuta, porque los `-c` se propagan.
  - Arreglo:
    - Consultar con `git config --show-scope --includes --get-regexp '^filter\.'` y anular los de ámbito `local` y `worktree`. Hacer lo mismo en `repoConfigRisks`.
    - En las lecturas, `--ignore-submodules=dirty` (o `-c diff.ignoreSubmodules=dirty`): se siguen viendo los cambios de commit del submódulo sin recorrer su árbol.
- **MB2 (media) — La lista negra (R34) sigue dejando pasar comandos que ejecutan cosas.** Pasan, y se sugieren:
  - binarios de Windows que ejecutan (comprobado: `forfiles /c`, `conhost`, `mshta`, `wscript`, `cscript`, `rundll32`, `regsvr32`, `msiexec`, `schtasks`);
  - herramientas con opción de ejecución (`ssh -o ProxyCommand`, `rsync -e`, `tar --to-command`, `zip -TT`, `docker run`, `go run`);
  - instaladores (`npm install`/`npm i`/`pip install`/`cargo install`, que ejecutan scripts de instalación).
  
  El design §13.1 y la arquitectura ya admiten que la lista es incompleta. Recomiendo añadir al menos `forfiles`, `conhost`, `mshta`, `wscript`, `cscript`, `rundll32`, `regsvr32` y `schtasks` como envolventes, y `ssh`/`rsync`/`tar`/`zip`/`docker` cuando el siguiente argumento es una opción.
- **Nota.** `repoConfigRisks` solo mira la configuración local. Un `commit.gpgsign` global del humano no se avisa, y es correcto: es suyo.
