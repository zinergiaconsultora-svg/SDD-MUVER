# Revisión — Feature 14: `endurecimiento-ejecucion`

**Veredicto: APROBADO** (HEAD `ef4c30b`; implementación en `c7ae45f`, diff desde `e64fec4`). No hay defectos
bloqueantes contra la spec aprobada (R1–R33, D1–D12). M1 de la fase 4 queda cerrado: ningún `execFile`/`spawn` del
panel recibe ya un nombre suelto ni una ruta dentro de la carpeta de un proyecto. Hay una **mejora de prioridad media**
(M1 de esta revisión): la lista de comandos amplios no incluye varios subcomandos de `git` que ejecutan programas
mediante una opción, y el panel los sigue proponiendo. Hay además dos mejoras menores y varias notas. **T30** (prueba
manual en Windows, R12, y cableado de R19/R25) sigue pendiente del humano y no es motivo de rechazo.

## Checklist

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad R1–R33 ↔ tests | OK. Las etiquetas `[F14-R1]`–`[F14-R32]` existen en `panel/test/`, salvo `R12`, que es MANUAL (T30) y figura como pendiente en `docs/verification.md`. R33 es `./init.sh`. Reparto según design §8.2: `trusted-bin` (R1–R5), `runs-api` (R6, R13, R27, R28), `git-info` (R7, R13, R21), `claude-cli` (R8, R14, R15, R20, R28), `sdd-actions` (R9), `exec-utils` (R10), `hardening` (R4, R11, R22–R24, R29), `work-api` (R16–R18), `git-actions` (R21, R23–R26), `work-render` (R19, R25) y `deploy` (R30–R32). He leído `trusted-bin`, `hardening` y los tests F14 de `runs-api`. No son triviales. Usan espías que comprueban que `spawn`/`execFile` **no** se llaman. Los ejecutables falsos están primeros en el `PATH`, así que sin el arreglo se ejecutarían. Los fixtures de `fsmonitor` y `textconv` se validan al final con un `git` normal ("el fixture es efectivo"). |
| 2 | `bash init.sh` | OK: **470 tests, 470 pass, 0 fail, 0 skipped** (Linux, con git). sdd-lint: 0 errores y 0 advertencias (33 requisitos, 31 tareas con trazabilidad). El aviso `[TDD]` de init.sh solo indica que no hay cambios locales sin commit. |
| 3 | Tareas | T1–T29 y T31 `[x]`. **T30 `[ ]`**: es manual en Windows, está pendiente del humano y se acepta. |
| 4 | Convenciones | OK. Código en inglés y comentarios y textos en español. Constantes en MAYÚSCULAS (`BIN_ERRORS`, `GIT_SAFE_PREFIX`, `MAX_PERMISSION_DENIALS`…). Los errores dan un mensaje útil y no exponen rutas absolutas: `untrusted` usa `lastSegment`. Funciones cortas. |
| 5 | Checkpoints | Se cumplen, salvo lo que cierra el leader: la entrada en `progress/history.md` y el resultado de T30. Las dos puertas humanas están aprobadas (`e64fec4` y `ef4c30b`). No hay `progress/impl_<feature>.md`, igual que en las fases anteriores. |
| 6 | Diseño | OK. La implementación coincide con D1–D12 y con §3–§6. Las desviaciones están declaradas en `docs/verification.md` y son legítimas (ver §Regresiones). Hay pequeños añadidos razonables (N3). Se respetan los ficheros que §10 prohíbe tocar, con una excepción menor en `progress/current.md` (N1). |

## Comprobación de M1 (fase 4): todos los lanzamientos de procesos

He revisado todos los `execFile`/`spawn` de `panel/` (`grep` de `child_process`):

| Punto de lanzamiento | Qué recibe | Guardia |
|---|---|---|
| `git-info.js:35-52` `createGitRunner` (listado, detalle, cambios, diff, hooks) | Solo acepta el nombre lógico `'git'` y lo resuelve con el resolvedor de la app (`cwd` = proyecto + catálogo). Comprueba `isTrustedPath` antes de `execFile`, con `shell: false`. | Sí |
| `runs.js` `guardedSpawn` → `launchClaude` y `spawnStep` (Claude, tests, commit y push) | Ruta absoluta de confianza. Con `projectScript` acepta un script absoluto dentro del `cwd`. Si no, `EUNTRUSTED` sin llamar a `spawnImpl`. | Sí |
| `exec-utils.js:93-108` `resolveExecutable` | Se ha eliminado el `return { file: bin }` final. Un nombre → resolvedor → `{ file }` absoluto o `{ error }`. Una ruta absoluta se usa tal cual y pasa después por la guardia de `runs.js`. | Indirecta |
| `claude-cli.js` `resolveClaudeCommand` | Se ha eliminado el `{ file: bin }` de Windows y de POSIX. Un `CLAUDE_BIN` relativo (con separador, o `.js`) se hace absoluto respecto a `panelDir`. Un nombre → resolvedor. El `cli.js` junto a `claude.cmd` también se comprueba contra las carpetas excluidas (`extra`). | Indirecta + guardia |
| `sdd-actions.js` `resolveFirstToken` | Un nombre → resolvedor con `cwd` = proyecto. Una ruta absoluta se acepta si `isTrustedPath`. Una relativa con separador → `projectScript` dentro del proyecto. | Sí |
| `exec-utils.js:125` `killProcessTree` (Windows) | `taskkillPath(env)`: ruta absoluta fija `%SystemRoot%\System32\taskkill.exe`. | Sin `isTrustedPath` (M3) |
| `tunnel.js:64` (`scripts/run-tunnel.js`) | `cloudflared` por nombre. | Fuera de alcance, documentado (N5) |

Mecanismo en Windows: libuv solo busca en el `cwd` del hijo cuando el fichero no lleva ruta. Ahora todo lo que llega a
`spawn`/`execFile` es absoluto (`X:\…` o UNC), y `isAbsoluteFor` rechaza `\foo`, `C:foo` y `/x` en win32, de modo que
esa búsqueda ya no ocurre. Los candidatos del `PATH` que están en la raíz del `cwd` o de un proyecto, o en su subárbol,
se descartan. La comparación usa `pathKey` sin distinguir mayúsculas y se hace también por la ruta real. Además,
`app.js` (`catalogDirs`) añade la ruta real de cada carpeta del catálogo. Así queda cubierto un proyecto registrado
mediante enlace o unión cuyo destino esté en el `PATH`.

Los fallbacks sin resolvedor de `exec-utils.js` y `claude-cli.js` crean uno que solo excluye el `cwd` y no resuelve
rutas reales. Solo se usan en tests: la app inyecta siempre el suyo, y la guardia final de `runs.js` usa el de la app.

En `hardening.test.js` (Linux) he comprobado lo siguiente. El `PATH` es `proyecto:.:bin`, con `git`, `claude`, `node`,
`npm` y `bash` falsos en el proyecto. El listado, el detalle, `/work`, los cambios, el diff, los tests, el commit y push
y el chat no ejecutan ninguno. El commit llega al remoto `--bare` con el git del sistema. El chat responde `409
onlyInProject`.

## Revisión con mentalidad de atacante

- **Resolvedor.** `NAME_RE` impide separadores. En Windows solo se aceptan `.com`/`.exe`. Si solo hay un `.cmd` o un
  `.bat`, se devuelve el error de la fase 4. `bash` en Windows nunca sale del `PATH` ni de `System32`/`sysnative`.
  `node` es siempre `execPath`. `npm`/`npx` usan el `npm-cli.js` junto a `execPath`. La caché no guarda los fallos, y
  la exclusión se recalcula en cada llamada con el catálogo vigente.
- **Proyecto contenedor.** Si `HOME` es un proyecto, se excluye `~\claude.exe` pero se acepta
  `~\.local\bin\claude.exe`. Es el supuesto de D2, que el humano aceptó al aprobar la spec.
- **git.** `-c core.fsmonitor=false` va en todas las lecturas (runner) y en los tres pasos. El diff usa
  `--literal-pathspecs --no-ext-diff --no-textconv`, y `stat` usa `--no-ext-diff --no-textconv`. El push lleva
  `GIT_SSH_COMMAND=ssh -o BatchMode=yes` salvo que el entorno defina `GIT_SSH_COMMAND`/`GIT_SSH`. No hay `--no-verify`
  (test estático). `listActiveHooks` filtra los nombres con `^[A-Za-z0-9._-]{1,64}$` y la interfaz los escapa.
- **Comandos amplios.** La API exige `acknowledgeBroad === true` en `POST /permissions` y en `PATCH`. Sin ella, el
  `PATCH` no guarda ningún campo. Queda auditado con `acknowledgedBroad`. `ALLOWED_COMMAND_RE` impide `\`, `*`, `(`,
  `)` y `,`, de modo que una ruta Windows como `C:\x\node.exe` no se puede autorizar. Ver M1 sobre la lista.
- **Límites.** Todo evento salvo `state` y `end` cuenta para los 5 MB. Los avisos de truncado y de tiempo máximo son
  esenciales. Se guardan como mucho 50 denegaciones, con un único aviso `denialsCapped`. `approve-spec` → `409` con un
  run activo.

## Hallazgos

### Bloqueantes

Ninguno.

### Mejoras

- **M1 (media) — Subcomandos de `git` que ejecutan programas y no se consideran amplios.**
  - Dónde: `claude-cli.js` `GIT_EXEC_SUBCOMMANDS` (lista literal de design §3.5) y `suggestAllowedCommand`. Requisitos: R14 y R15. La implementación cumple la lista de la spec: es una laguna del diseño, no un incumplimiento.
  - Lo he verificado en el scratchpad. `git fetch --upload-pack="touch PWNED; false" .` ejecuta el comando, y `git grep -O"touch PWNED2" hola` también. `suggestAllowedCommand` propone `git fetch`, `git ls-remote`, `git push`, `git clone`, `git grep` y `git hook` (por `git fetch --upload-pack=x origin`, `git push --receive-pack=x`, `git clone -u x`, `git grep -Ox` y `git hook run`).
  - Efecto: un Claude manipulado provoca la denegación y el panel propone, por ejemplo, «git fetch». Un clic en "Permitir y reintentar" da `Bash(git fetch *)`, que equivale a una terminal libre, sin aviso. Es justo el patrón que M2 de la fase 4 quería cerrar. Lo mitiga que un comando "normal" como `npm test` ya ejecuta código que Claude puede editar con `acceptEdits` (riesgo aceptado en D6).
  - Arreglo propuesto: añadir a `GIT_EXEC_SUBCOMMANDS` `fetch`, `pull`, `push`, `clone`, `ls-remote`, `grep` y `hook`, o como mínimo no proponerlos. Añadir también a `run` sus alias `run-script`, `rum` y `urn` (`npm run-script` se propone hoy y equivale a `npm run`). Mencionar en `docs/architecture.md` que la lista es una lista de denegación y no exhaustiva. Esto exige un cambio de spec, así que el leader debe decidir si va en una feature pequeña o con la feature 13.
- **M2 (baja) — `taskkill` sin la guardia final.**
  - Dónde: `exec-utils.js:125`. Requisitos: D3/R6, que dicen que `taskkill` comprueba `isTrustedPath`, y R13.
  - `killProcessTree` lanza `taskkillPath(env)` sin `isTrustedPath` y sin `NoDefaultCurrentDirectoryInExePath`. El propio design §5.3 especifica la llamada así, de modo que la incoherencia está en la spec. El riesgo práctico es nulo, porque la ruta es absoluta y fija en `System32`.
  - Pero `docs/architecture.md` §"Seguridad de la ejecución" punto 1 afirma que "`taskkill` solo lanza rutas de confianza". Conviene corregir el texto o añadir la comprobación.
- **M3 (baja) — Resolvedor por defecto sin rutas reales de las carpetas excluidas.**
  - `excludedDirs` compara el candidato (y su ruta real) con las carpetas tal como vienen, sin resolver la ruta real de la carpeta. En la app no importa, porque `catalogDirs` ya añade las rutas reales.
  - Pero `defaultResolver` y los resolvedores de compatibilidad no lo hacen. Si en el futuro se llama al runner por defecto con un `cwd` que sea un enlace, un `PATH` que contenga el destino real dejaría pasar un ejecutable de ese proyecto.
  - Propuesta: resolver también `realpath(cwd)` en `excludedDirs`.

### Notas

- **N1.** El implementer modificó `progress/current.md` (4 líneas de estado). Design §10 reserva `progress/` al leader. No tiene efecto: el leader lo actualizó en `ef4c30b`.
- **N2.** `git-info.js:46` monta `[...GIT_SAFE_PREFIX, ...resolved.prefixArgs, ...args]`. Si `git` tuviera alguna vez `prefixArgs`, el prefijo `-c` quedaría delante del ejecutable de verdad. Hoy `git` nunca los tiene, así que es teórico.
- **N3.** Añadidos fuera del texto literal del diseño, todos razonables: `catalogDirs` con rutas reales (refuerza D2), la opción `panelDir` de `createApp`/`createWorkApi`, `gitBashCandidates`/`taskkillPath`/`CMD_SCRIPT_ERROR` movidos a `trusted-bin.js` y reexportados en `exec-utils.js`, y el mensaje `400` para una ruta absoluta de tests dentro del proyecto.
- **N4.** Con R27, el evento `result` también se descarta tras el truncado (desviación declarada en `[F4-R30]`). El run conserva el estado y el coste, pero en un run de más de 5 MB la interfaz no muestra el texto final de Claude. Es coherente con la spec.
- **N5.** Queda un lanzamiento por nombre: `cloudflared` en `tunnel.js:64` (`scripts/run-tunnel.js`), con el `cwd` del proceso del túnel. Está fuera de alcance y documentado como riesgo conocido. Conviene resolverlo igual cuando se toque la fase 5.
- **N6.** La instantánea del catálogo arranca vacía hasta que termina la primera `loadSources()`. Todas las rutas que lanzan procesos llaman antes a `loadSources()`, así que no hay ventana efectiva.
- **N7.** `NoDefaultCurrentDirectoryInExePath` solo protege a los nietos que usen la API de Windows o `cmd.exe`. Los que usen libuv (por ejemplo, herramientas Node que lance Claude) siguen sus propias reglas. Está documentado en el riesgo 6 de `docs/architecture.md`.

## Regresiones y desviaciones declaradas

Todas están listadas en `docs/verification.md` (sección Feature 14) y son consecuencia directa de un requisito:

- Cambios previstos en §8.3: `[F4-R54]` (nombre no encontrado → `notFound`), `[F4-R12]` (Linux → ruta absoluta), `[F4-R65]` (`yarn run -s x` → `null`), `[F4-R60]`/`[F4-R58]` (prefijo y `GIT_SSH_COMMAND`) y `helpers.js` (`env`, `claudeBin`).
- Desviaciones del implementer, declaradas:
  - `[F4-R30]`: `result` descartado tras el truncado (R27).
  - `[F4-R24][F4-R65]` `denied_powershell`: ya no propone `node` (R15).
  - `[F4-R12]`: `tool.mjs` se hace absoluto respecto al panel.
  - `[F4-R28]`: `taskkill` por ruta absoluta (R10).
  - `[F4-R62]`/`[F4-R64]`: texto de `invalidCommand` (§4.1).
  - `[F4-R6]`: `broadCommands: []` en `/work` (R18).

He comparado las líneas eliminadas de los tests anteriores con esa lista y no hay ningún cambio sin declarar. Las
fases 1–4 siguen en verde dentro de los 470 tests.

## Portabilidad Windows

- Las rutas Windows se componen con `path.win32` y se comparan con `pathKey`, que no distingue mayúsculas ni el tipo de barra. Los unitarios simulan `win32` en Linux:
  - el orden `.com` → `.exe`;
  - las rutas conocidas de Git;
  - `%USERPROFILE%\.local\bin\claude.exe`;
  - el `cli.js` junto a `claude.cmd`;
  - `taskkill` con y sin `SystemRoot`;
  - el filtrado de `Path` con comillas, `%`, relativas y `\herramientas`.
- `NoDefaultCurrentDirectoryInExePath=1` en los hijos de `runs.js` y del runner de git (no en `taskkill`, M2).
- `hardening.test.js` se salta en Windows (scripts `#!/bin/sh` y enlaces simbólicos). La cobertura real en Windows depende de **T30** (receta de design §8.4: `whoami.exe` copiado como `git.exe`/`claude.exe`, `Get-Process whoami` vacío, `PATH` con `.`, y avisos de comando amplio y de hooks). **Pendiente del humano**: el leader debe anotar la fecha, las versiones y el resultado en la fila R12/T30 de `docs/verification.md` antes de pasar la feature a `done`.
