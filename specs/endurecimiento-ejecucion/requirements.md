# Requisitos — Feature 14: endurecimiento de la ejecución (hallazgos del reviewer de la fase 4)

> Origen: `progress/review_puesto-de-mando-trabajar.md` (veredicto APROBADO de la fase 4 con mejoras M1–M5 y notas
> N1–N6). Decisión del humano: **se resuelve la seguridad de la ejecución antes que la vista compacta** (feature 13).
>
> Alcance:
> (M1) ningún programa se lanza por nombre suelto: `git`, `node`, `npm`, `npx`, `claude`, `bash` y `taskkill` se
> resuelven a una ruta absoluta desde `PATH` (y rutas conocidas), descartando la carpeta del proyecto, las demás
> carpetas del catálogo y las entradas relativas;
> (M2) los comandos autorizados que equivalen a ejecución libre (intérpretes, shells, envolventes, `git`/`npm` a secas)
> no se proponen nunca y, si el humano los añade a mano, se exige una confirmación expresa con aviso;
> (M3) toda llamada git del panel desactiva `core.fsmonitor`, el diff no ejecuta drivers externos y "Commit y push"
> avisa de los hooks activos (que se siguen ejecutando);
> (M4) push por SSH sin preguntas (`BatchMode`);
> (M5) todos los eventos de un run cuentan para el límite de 5 MB y las denegaciones se guardan como mucho 50;
> (N3) diff por fichero con pathspec literal; (N4) "Aprobar spec" se rechaza con un run activo;
> (N1/N2) corrección de dos incoherencias de `specs/puesto-de-mando-trabajar/design.md`;
> (N5/N6) riesgos conocidos documentados en `docs/architecture.md`.
>
> Fuera de alcance: la vista compacta (feature 13), cambiar el modelo de autenticación (sesión, reauth, Cloudflare
> Access), desactivar los hooks de git, prohibir del todo los intérpretes y el arranque de `cloudflared` por
> `scripts/` (se documenta como riesgo conocido).
>
> Convención de este fichero: cada requisito ocupa UNA sola línea (así `sdd-lint.js` lo valida completo) y va seguido
> de su línea *Cómo se prueba*. Contratos, algoritmos, listas y textos exactos están en `design.md`. Los tests usan
> repos git temporales reales, carpetas de proyecto temporales con **ejecutables falsos** (scripts que, si llegaran a
> ejecutarse, escriben un fichero de marca), un `PATH` de prueba inyectado (con `.` y con la carpeta del proyecto) y
> el CLI de Claude falso de la fase 4. Los requisitos marcados **[MANUAL — Windows]** los comprueba el humano en su PC
> y anota el resultado en `docs/verification.md`.

## Vocabulario

- **Resolvedor:** `lib/trusted-bin.js` (`createBinaryResolver` y `resolveTrustedBinary`, ver `design.md` §3 y §5.1).
- **Carpetas excluidas de una llamada:** la carpeta de trabajo (`cwd`) del proceso que se va a lanzar más las carpetas de todos los proyectos del catálogo fusionado vigente (registro + Claude Code).
- **Proyecto contenedor:** proyecto del catálogo cuya carpeta es la raíz de una unidad o sistema de ficheros, la carpeta personal del usuario (`HOME`/`USERPROFILE`) o una carpeta que la contiene; de él solo se excluye su propia raíz, no sus subcarpetas (`design.md` §3.3).
- **Ruta de confianza:** ruta absoluta de un fichero que no está en ninguna carpeta excluida de la llamada (ni por su ruta ni por su ruta real).
- **Comando amplio:** comando autorizado que permite a Claude ejecutar cualquier programa (`design.md` §3.5); lo decide `isBroadCommand`.
- **Ejecutable falso:** script de prueba con el nombre de un programa (`git`, `claude`, `node`, `bash`, `npm`) que escribe un fichero de marca si se ejecuta.

## A. Resolución de ejecutables por ruta absoluta (M1)

- **R1.** Cuando el panel necesita un programa por nombre (`git`, `node`, `npm`, `npx`, `claude`, `bash`, `taskkill` o el primer token sin separadores de un comando de tests), el sistema debe obtener su ruta absoluta con `resolveTrustedBinary`, que busca solo en las entradas de `PATH` y en las rutas conocidas de `design.md` §3.2, en el orden de §3.3, aceptando en Windows solo `.com` y `.exe`.
  - *Cómo se prueba:* test unitario de `createBinaryResolver` con `platform` `linux` y `win32`, `env` y funciones de sistema de ficheros inyectadas: orden de `PATH`, `.com` antes que `.exe`, rutas conocidas tras `PATH`, `node` → `execPath`, `taskkill` → `System32` y `.cmd`/`.bat` nunca devueltos.

- **R2.** Si una entrada de `PATH` está vacía, es `.`, es relativa, contiene `%` o, en Windows, no empieza por letra de unidad (`C:\`) ni por `\\`, entonces el sistema debe descartarla al resolver.
  - *Cómo se prueba:* test unitario con `PATH` = `:.:bin:/usr/bin` (linux) y `;.;bin;\herramientas;%X%\bin;"C:\Git\cmd";C:\Windows` (win32): solo se consultan `/usr/bin`, `C:\Git\cmd` (sin comillas) y `C:\Windows`.

- **R3.** Si un candidato (por su ruta o por su ruta real) está en una carpeta excluida de la llamada, dentro de ella o, para un proyecto contenedor, directamente en su raíz, entonces el sistema debe descartarlo y seguir con el siguiente candidato.
  - *Cómo se prueba:* test unitario con un `git` en la carpeta del proyecto (`cwd`), otro en la carpeta de otro proyecto del catálogo, otro en una subcarpeta `bin` de un proyecto, un enlace simbólico de `/usr/local/bin/git` a un proyecto y uno legítimo en `/usr/bin`: devuelve `/usr/bin/git`; con el proyecto contenedor `HOME`, `HOME/.local/bin/claude` se acepta y `HOME/claude` se descarta.

- **R4.** Si no queda ningún candidato, entonces el sistema debe devolver `{ ok: false, error }` con el texto exacto `notFound` u `onlyInProject` de `design.md` §4.1 y no debe lanzar ningún proceso ni recurrir al nombre suelto.
  - *Cómo se prueba:* test unitario (sin candidatos → `notFound`; solo uno en el proyecto → `onlyInProject`) y test de integración con `claudeBin: 'claude'` sin Claude en `PATH`: `POST /runs` responde `409` con ese texto y el registro del CLI falso no existe.

- **R5.** Cuando el resolvedor encuentra candidatos para un nombre, el sistema debe guardar su lista en memoria durante la vida del proceso, no volver a consultar el disco para ese nombre y aplicar en cada llamada la exclusión de R3 con el `cwd` de la llamada y el catálogo vigente; una búsqueda sin candidatos no se guarda.
  - *Cómo se prueba:* test unitario que cuenta las llamadas a la función `stat` inyectada en dos resoluciones seguidas, comprueba que la segunda con otro `cwd` descarta el candidato que está en él, y que tras un `notFound` una nueva llamada vuelve a buscar.

- **R6.** Cuando el panel va a lanzar cualquier proceso (`spawn` de `runs.js`, `execFile` del runner de git y `taskkill`), el sistema debe comprobar con `isTrustedPath` que el ejecutable es una ruta de confianza y, si no lo es, debe rechazar el lanzamiento con el texto `untrusted` de `design.md` §4.1 sin crear el proceso.
  - *Cómo se prueba:* test unitario del gestor de runs con `spawnImpl` espía y pasos con `file: 'git'`, `file: 'bin/git'` y un `file` dentro del `cwd`: el run termina `failed` con ese error y el espía no se llama; con `/usr/bin/git` sí se llama.

- **R7.** Cuando el panel consulta git para el listado, el detalle, "Ver cambios", el diff o "Commit y push", el sistema debe ejecutar la ruta absoluta de `git` que devuelve el resolvedor con `cwd` igual a la carpeta del proyecto, y el runner de git debe rechazar cualquier programa que no sea `git`.
  - *Cómo se prueba:* test unitario de `createGitRunner` con `execFileImpl` espía (fichero absoluto, `cwd`, rechazo de `node`) y el test de integración con ejecutables falsos (`hardening.test.js`).

- **R8.** Cuando el sistema resuelve el ejecutable de Claude, debe usar el resolvedor para `claude` (`PATH`, rutas conocidas y el `cli.js` junto a un `claude.cmd` de una carpeta de `PATH` ya filtrada), convertir un `CLAUDE_BIN` relativo con separador en absoluto respecto a la carpeta de arranque del panel y devolver el error de R4 en lugar de `{ file: 'claude' }` cuando no lo encuentra.
  - *Cómo se prueba:* test unitario de `resolveClaudeCommand` con la tabla de `design.md` §5.3 (linux y win32, `exists` y resolvedor inyectados), incluido `CLAUDE_BIN=herramientas/fake.js` → `prefixArgs` absoluto.

- **R9.** Cuando el sistema prepara el comando de tests, debe resolver con el resolvedor un primer token sin separadores (también `bash` para `init.sh`), aceptar tal cual una ruta absoluta y resolver contra la carpeta del proyecto una ruta relativa con separador (`./test.sh`, `scripts/test.exe`), marcando ese paso como `projectScript`.
  - *Cómo se prueba:* test unitario de `resolveTestCommand` con `fake-command`, `git --version`, `/usr/bin/env` (absoluta), `./scripts/test.sh` (→ ruta absoluta dentro del proyecto con `projectScript: true`) y `git` solo presente en la carpeta del proyecto (→ `409` con `onlyInProject`).

- **R10.** Cuando `killProcessTree` se ejecuta en Windows, el sistema debe lanzar `taskkill` por la ruta `%SystemRoot%\System32\taskkill.exe` (o `C:\Windows\System32\taskkill.exe` si falta `SystemRoot`) con los mismos argumentos de la fase 4.
  - *Cómo se prueba:* test unitario con `execFileImpl` espía, `platform: 'win32'` y `env` con y sin `SystemRoot`.

- **R11.** Si la carpeta de un proyecto contiene ejecutables falsos `git`, `claude`, `node`, `npm` y `bash` y el `PATH` del panel incluye `.` y esa carpeta, entonces el sistema no debe ejecutar ninguno al listar, abrir el detalle, ver cambios y diff, ejecutar tests, hacer commit y push ni lanzar Claude.
  - *Cómo se prueba:* test de integración (Linux, se salta sin git) con `createApp({ env })`, el proyecto en el catálogo y esas acciones en orden: ningún fichero de marca existe al final, el listado muestra la rama real y el commit se hace con el `git` del sistema.

- **R12.** [MANUAL — Windows] Si se copia `whoami.exe` como `git.exe` y como `claude.exe` en la raíz de un proyecto de prueba del catálogo, entonces el sistema no debe ejecutarlos al abrir el panel, "Trabajar", "Ver cambios", "Ejecutar tests", "Commit y push" ni al lanzar Claude.
  - *Cómo se prueba:* el humano sigue la receta de `design.md` §8.4 (Monitor de recursos o `Get-Process` sin `whoami` y ninguna salida de `whoami` en la consola ni en el historial) y anota el resultado en `docs/verification.md`.

- **R13.** Cuando el panel lanza un proceso en Windows, el sistema debe añadir `NoDefaultCurrentDirectoryInExePath=1` al entorno del hijo, sin cambiar el resto de variables.
  - *Cómo se prueba:* test unitario del gestor de runs y de `createGitRunner` con espías y `platform: 'win32'` (presente) y `linux` (ausente).

## B. Comandos autorizados de ejecución libre (M2)

- **R14.** Cuando el sistema clasifica un comando autorizado, `isBroadCommand` debe devolver `true` para los envolventes, para un intérprete, shell o lanzador sin argumento o seguido de una opción, para `git` con un subcomando de ejecución y para `npm`/`pnpm`/`yarn`/`bun` con `exec`, `x`, `dlx`, `explore`, `create`, `init` o `run` sin script, según las listas de `design.md` §3.5, y `false` en el resto.
  - *Cómo se prueba:* test unitario con la tabla de `design.md` §3.5: `node`, `node.exe`, `/usr/bin/python3`, `node -e`, `python -c`, `bash`, `bash -c`, `env`, `env A=1 x`, `sudo ls`, `xargs`, `find .`, `git`, `git -c`, `git config`, `npm`, `npm exec`, `npm run`, `npx` → `true`; `npm test`, `npm run build`, `git rev-list`, `node scripts/build.js`, `python -m pytest`, `bash init.sh`, `cargo test` → `false`.

- **R15.** Cuando el sistema propone comandos tras una denegación, `suggestAllowedCommand` y `suggestAllowedCommands` no deben devolver nunca un comando amplio y deben proponer el comando con su primer subcomando o argumento (`npm test`, `git rev-list`, `node build.js`, `python -m pytest`).
  - *Cómo se prueba:* test unitario: `node -e "x"`, `git -c a=b push`, `env A=1 node x`, `xargs rm`, `find . -exec rm {} ;`, `bash -c x`, `npm exec foo`, `yarn run -s x` → `null`/`[]`; `git rev-list --count HEAD` → `git rev-list`; `npm run lint -- --fix` → `npm run lint`; `python3 -m pytest -x` → `python3 -m pytest`; los casos de la fase 4 que no son amplios no cambian.

- **R16.** Si `POST /api/projects/:id/permissions` recibe un comando amplio sin `acknowledgeBroad: true`, entonces el sistema debe responder `400` con `{ error, field: 'command', needsAcknowledge: true, broadCommands: [comando] }` sin guardar nada, y con `acknowledgeBroad: true` debe añadirlo y registrar `acknowledgedBroad` en `audit.log`.
  - *Cómo se prueba:* test de integración con `node`: `400` y `projects.json` sin cambios; repetido con la marca: `200`, el comando guardado y la línea de auditoría con `acknowledgedBroad: ["node"]`; `npm test` sin marca → `200`.

- **R17.** Si un `PATCH /api/projects/:id` trae en `allowedCommands` algún comando amplio que no estaba ya guardado y no trae `acknowledgeBroad: true`, entonces el sistema debe responder `400` con `{ error, field: 'allowedCommands', needsAcknowledge: true, broadCommands }` sin guardar ningún campo del cuerpo.
  - *Cómo se prueba:* test de integración: `["npm test", "git"]` → `400` con `broadCommands: ["git"]` y registro intacto (tampoco cambia `testCommand` enviado a la vez); con la marca → `200`; un `PATCH` posterior que mantiene `git` ya guardado sin la marca → `200`.

- **R18.** Cuando `GET /api/projects/:id/work` responde, el sistema debe incluir `broadCommands` con los comandos amplios guardados del proyecto, en el orden de `allowedCommands` (lista vacía si no hay).
  - *Cómo se prueba:* test de integración con `allowedCommands: ["npm test", "node"]` → `broadCommands: ["node"]`, y sin comandos → `[]`.

- **R19.** Cuando una respuesta trae `needsAcknowledge`, la interfaz debe mostrar el diálogo con el texto exacto `broadConfirm` de `design.md` §6.1 y el botón "Autorizar de todos modos", y solo debe reenviar la petición con `acknowledgeBroad: true` si el humano lo pulsa; en "Ajustes de ejecución" debe mostrar el aviso `broadSaved` mientras haya comandos amplios guardados.
  - *Cómo se prueba:* test unitario de las funciones puras `describeAction('allow-broad')` y `renderBroadWarning` de `public/work.js` (texto exacto, escapado de `<script>`, lista vacía → cadena vacía); el cableado se comprueba a mano (`design.md` §8.4).

- **R20.** Si un comando autorizado empieza por `-` o termina en `:`, entonces `isValidAllowedCommand` debe rechazarlo, de modo que ninguna regla generada contenga `*`, `?`, `(`, `)`, `,` ni el sufijo antiguo `:*`.
  - *Cómo se prueba:* test unitario con `-x`, `git:`, `npm run test:` (rechazados), `npm run test:unit` (aceptado) y una comprobación sobre `buildAllowedTools` de 200 comandos aleatorios válidos sin esos caracteres.

## C. Configuración del repositorio, hooks y push (M3, M4, N3)

- **R21.** Cuando el panel ejecuta cualquier llamada git, el sistema debe anteponer `-c core.fsmonitor=false` a sus argumentos, tanto en las lecturas (runner de git) como en los pasos de "Commit y push".
  - *Cómo se prueba:* test unitario de `createGitRunner` (los argumentos empiezan por el prefijo) y de `planCommitPush` (los tres pasos empiezan por el prefijo; `display` no cambia).

- **R22.** Si un repo tiene `core.fsmonitor` apuntando a un script que escribe un fichero de marca, entonces el sistema no debe ejecutarlo durante el sondeo del listado (`GET /api/projects`), el detalle, `GET /changes`, el diff ni "Commit y push".
  - *Cómo se prueba:* test de integración (Linux, se salta sin git) con un repo temporal configurado así: tras esas peticiones, el fichero de marca no existe y las respuestas son las normales.

- **R23.** Cuando el panel pide el diff de un fichero, el sistema debe usar la opción global `--literal-pathspecs` y `--no-ext-diff --no-textconv`, de modo que un fichero cambiado llamado `*` o `:(glob)*` devuelva solo su propio diff y no se ejecute ningún driver de diff del repo.
  - *Cómo se prueba:* test de integración con un repo temporal que tiene `*`, `b.txt` y un `.gitattributes` con `diff=marca` y `diff.marca.textconv` apuntando a un script de marca: el diff de `*` no contiene `b.txt` y la marca no existe; test unitario de `GIT_ACTION_ARGS.diffHead`/`diffWorktree`.

- **R24.** Cuando `GET /api/projects/:id/changes` responde para un repo, el sistema debe incluir `hooks` (nombres ordenados de los ficheros de la carpeta de hooks efectiva sin `.sample`, como mucho 20 y solo los que cumplen `^[A-Za-z0-9._-]{1,64}$`) y `hooksPathCustom` (`true` si `core.hooksPath` está definido).
  - *Cómo se prueba:* test de integración con un repo recién creado (`hooks: []`), con `.git/hooks/pre-commit` y `pre-push` (ordenados), y con `core.hooksPath=ganchos` y `ganchos/post-commit` (`["post-commit"]`, `hooksPathCustom: true`).

- **R25.** Cuando el humano abre "Commit y push" en un repo con `hooks` no vacío, la interfaz debe añadir al diálogo el aviso exacto `hooksWarning` de `design.md` §6.2 con los nombres escapados, sin él si no hay hooks, y el sistema debe seguir ejecutando los pasos sin `--no-verify`.
  - *Cómo se prueba:* test unitario de `renderHooksWarning` (texto exacto, variante `core.hooksPath`, escapado, lista vacía → cadena vacía) y test estático de que `git-actions.js` no contiene `--no-verify`.

- **R26.** Cuando el sistema prepara el paso de push, debe añadir a su entorno `GIT_SSH_COMMAND=ssh -o BatchMode=yes` salvo que el entorno del panel ya defina `GIT_SSH_COMMAND` o `GIT_SSH` no vacíos, en cuyo caso no debe tocarlos, y debe mantener `GIT_TERMINAL_PROMPT=0` y `GCM_INTERACTIVE=never` en los tres pasos.
  - *Cómo se prueba:* test unitario de `planCommitPush` con `env` `{}`, `{ GIT_SSH_COMMAND: 'ssh -i k' }` y `{ GIT_SSH: 'plink' }`; los pasos `add` y `commit` no llevan `GIT_SSH_COMMAND`.

## D. Límites de los runs (M5)

- **R27.** Cuando un run emite un evento de cualquier tipo salvo `state` y `end`, el sistema debe sumar su tamaño a `outputBytes` y aplicar el límite de salida, y al superarlo debe emitir una sola vez el aviso de truncado y descartar los eventos siguientes salvo `state`, `end` y el aviso de tiempo máximo.
  - *Cómo se prueba:* test unitario del gestor de runs con `outputLimitBytes` pequeño y el CLI falso en el escenario nuevo `flood`, que solo produce eventos `permission_denied`, `session` y `notice` (`design.md` §8.1): `truncated: true`, `outputBytes` ≤ límite, un solo aviso y el run termina con `state` y `end`.

- **R28.** Si un run de Claude acumula más de 50 denegaciones de permiso, entonces el sistema debe guardar solo las 50 primeras en `permissionDenials` (memoria, `RunMeta` e `index.json`), no debe emitir más eventos `permission_denied` y debe emitir una sola vez el aviso `denialsCapped` de `design.md` §4.1.
  - *Cómo se prueba:* test unitario de `createStreamMapper` con 60 denegaciones distintas y test de integración con el escenario `flood` del CLI falso: `index.json` tiene 50 y el `.jsonl` tiene un solo aviso.

## E. Aprobar spec con un run activo (N4)

- **R29.** Si hay un run activo en el proyecto, entonces `POST /api/projects/:id/sdd/approve-spec` debe responder `409` con `{ error: 'Ya hay una ejecución en marcha en este proyecto', runId }` sin modificar `feature_list.json`.
  - *Cómo se prueba:* test de integración con un run `[[hang]]` en marcha: `409`, el `runId` del run y los bytes de `feature_list.json` idénticos; tras cancelarlo, la misma petición → `200`.

## F. Documentación (N1, N2, N5, N6 y decisiones)

- **R30.** Cuando se cierra la feature, el sistema debe tener en `specs/puesto-de-mando-trabajar/design.md` la fila "Pasar el prompt por stdin" de §10 sustituida por la de `design.md` §9.1 y la lista de §9 sin `http-utils.js` ni `rate-limit.js`, ambas con la nota "(corregido en la feature 14)".
  - *Cómo se prueba:* test estático en `panel/test/deploy.test.js` que lee ese fichero y busca las cadenas nuevas y la ausencia de las antiguas.

- **R31.** Cuando se cierra la feature, el sistema debe tener en `docs/architecture.md` la sección "Seguridad de la ejecución" con los apartados de `design.md` §9.2 (resolución de ejecutables, comandos amplios, `core.fsmonitor`, decisión sobre hooks, `BatchMode` y riesgos conocidos N5, N6, filtros y credenciales de git y `cloudflared`).
  - *Cómo se prueba:* test estático en `panel/test/deploy.test.js` que busca el título y una cadena clave de cada apartado.

- **R32.** Cuando se cierra la feature, el sistema debe tener en `docs/verification.md` la sección "Feature 14" con prefijo `[F14-R<n>]`, una fila por requisito y los cambios declarados en tests anteriores (`design.md` §8.3).
  - *Cómo se prueba:* test estático en `panel/test/deploy.test.js` que comprueba la sección y que cada etiqueta `[F14-R<n>]` no manual aparece en algún fichero de `panel/test/`.

- **R33.** Cuando se ejecuta `./init.sh` al terminar, el sistema debe pasar todos los tests de las fases 1–4 y de esta feature, con solo los ajustes de tests anteriores declarados en `design.md` §8.3, y `node sdd-lint.js` debe terminar con 0 errores.
  - *Cómo se prueba:* ejecución de `./init.sh` (tarea final de `tasks.md`) con todo en verde; el reviewer compara los tests cambiados con la lista de §8.3.
