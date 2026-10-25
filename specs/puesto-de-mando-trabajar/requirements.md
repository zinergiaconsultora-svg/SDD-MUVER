# Requisitos — Feature 4: Puesto de Mando MUVER (fase 4: trabajar desde el panel)

> Objetivo del humano: **"que sea una app útil y que podamos trabajar desde ella sin tener que entrar en Claude"**.
> Desde el móvil o el PC, por la URL del túnel o por la red local, el humano hace avanzar cada proyecto: habla con
> Claude Code (que se ejecuta en su PC Windows, donde `claude` está instalado y con sesión iniciada), pulsa los
> botones del flujo SDD, ejecuta los tests, ve los cambios, hace commit y push, y ve el resultado en vivo.
>
> Decisiones ya tomadas con el humano (no se discuten aquí): Claude lanzado desde el panel **edita ficheros sin
> preguntar y solo ejecuta los comandos de una lista autorizada por proyecto** (nunca `--dangerously-skip-permissions`
> ni `bypassPermissions`); protección extra con **Cloudflare Access + contraseña** cuando haya dominio propio y, mientras
> tanto, **repetir la contraseña cada 15 minutos** para las acciones de ejecución pedidas por el túnel; interruptor
> general `PANEL_ALLOW_EXEC`.
>
> Fuera de alcance (fase 5 u otras): capturas, Web Push, editor de código en el navegador, varios usuarios y **cualquier
> terminal o shell libre**: el panel solo lanza Claude con permisos acotados y los comandos configurados.
>
> Convención de este fichero: cada requisito ocupa UNA sola línea (así `sdd-lint.js` lo valida completo) y va seguido
> de su línea *Cómo se prueba*. Contratos JSON, textos exactos, nombres de funciones y formatos de eventos están en
> `design.md`. Los tests usan un **CLI de Claude falso** (`panel/test/fixtures/fake-claude.js`, un script Node que emite
> stream-json de ejemplo), **repos git temporales reales** y, para Cloudflare Access, un par RSA generado en el propio
> test con las claves públicas servidas desde un servidor HTTP local. Los requisitos marcados **[MANUAL — Windows]** o
> **[MANUAL — Internet]** no pueden ejecutarse en el entorno de tests (Linux, sin Claude real ni Cloudflare): el humano
> los comprueba y anota el resultado en `docs/verification.md`.

## Vocabulario

- **Run (ejecución):** proceso lanzado por el panel en la carpeta de un proyecto. Tipo `claude` (Claude Code CLI) o `command` (comando de tests o pasos de git de "Commit y push"). Tiene un `runId`, un estado y una lista de eventos.
- **Estados del run:** `queued` (creado, proceso aún no arrancado), `running`, y los finales `succeeded`, `failed`, `cancelled`, `timeout` y `needs_permission` (solo `claude`: el proceso terminó y hubo al menos una denegación de permiso).
- **Run activo:** run en estado `queued` o `running`.
- **Acción de ejecución:** cualquiera de estas peticiones: lanzar un run de Claude (chat, "Implementar siguiente tarea", "Aprobar tests"), "Ejecutar tests", "Commit y push", "Aprobar spec", "Permitir en este proyecto" y el cambio de los ajustes `allowedCommands` o `testCommand`. Cancelar un run NO es acción de ejecución (siempre se permite parar).
- **Petición por el túnel:** la que trae la cabecera `CF-Connecting-IP`, la cabecera `Cf-Ray` o `X-Forwarded-Proto: https` (se miran siempre, con independencia de `PANEL_TRUST_PROXY`, porque solo endurecen). El resto es **petición de la red local**.
- **Cloudflare Access configurado:** `PANEL_CF_ACCESS_TEAM` y `PANEL_CF_ACCESS_AUD` definidas y válidas.
- **Confirmación reciente:** la sesión tiene `reauthAt` y han pasado como mucho 15 minutos desde entonces.
- **Proyecto ejecutable:** proyecto del catálogo con `path` resuelto que existe como directorio en el PC. La carpeta de trabajo siempre sale del catálogo, nunca del cuerpo de la petición.
- **Proyecto con arnés SDD:** su `feature_list.json` existe y es válido (`sdd.present` y `sdd.error` nulo, como en la fase 1).
- **CLI falso:** `panel/test/fixtures/fake-claude.js`; elige su escenario por una marca en el prompt (`[[ok]]`, `[[denied]]`, `[[error]]`, `[[crash]]`, `[[hang]]`, `[[big]]`, `[[garbage]]`) y escribe sus argumentos y su `cwd` en el fichero `FAKE_CLAUDE_LOG` (ver `design.md` §8.1).
- **Directorio de datos:** el de la fase 2 (`panel/data/` o `PANEL_DATA_DIR`).

## A. Configuración, interruptor general y estado

- **R1.** Cuando el panel arranca, el sistema debe leer en `readConfig` `allowExec` (falso solo si `PANEL_ALLOW_EXEC` es `0` o `false`), `maxRuns` (`PANEL_MAX_RUNS` entero 1–10, si no 2), `runTimeoutMs` (`PANEL_RUN_TIMEOUT_MIN` entero 1–240 en minutos, si no 30), `claudeBin` (`CLAUDE_BIN` recortado o `claude`), `bashBin` (`PANEL_BASH_BIN` recortado o `null`) y `cfAccess` según `design.md` §5.1.
  - *Cómo se prueba:* test unitario de `readConfig` con `env = {}` (valores por defecto), con cada variable válida, con valores fuera de rango (`PANEL_MAX_RUNS=0`, `=11`, `PANEL_RUN_TIMEOUT_MIN=abc`) que vuelven al defecto, y `PANEL_ALLOW_EXEC` = `0`, `false`, `1`.

- **R2.** Si solo una de `PANEL_CF_ACCESS_TEAM` y `PANEL_CF_ACCESS_AUD` está definida o el equipo no cumple `^[a-z0-9-]{1,63}$`, entonces el sistema debe devolver `cfAccess: { error }` en `readConfig` y rechazar con `403` y el texto de "Access mal configurado" toda petición por el túnel, sin afectar a las de la red local.
  - *Cómo se prueba:* test unitario de `readConfig` con solo el equipo, solo el AUD y equipo `Mi Equipo`; test de integración con `cfAccess: { error }`: `GET /` con `CF-Connecting-IP` → `403`, sin esa cabecera → `200`.

- **R3.** Cuando `buildStartupLines` recibe `work`, el sistema debe añadir la línea `Ejecución desde el panel: activada (máx. N a la vez, límite M min)` o `Ejecución desde el panel: desactivada (PANEL_ALLOW_EXEC=0)` y la línea de Cloudflare Access de `design.md` §5.1, sin cambiar las líneas de las fases 2 y 3.
  - *Cómo se prueba:* test unitario con `work` activado + Access configurado, desactivado + sin Access, Access con error, y sin `work` (líneas idénticas a las actuales).

- **R4.** Cuando una petición autenticada hace `GET /api/work/status`, el sistema debe responder `200` con `{ execEnabled, accessConfigured, tunnel, reauthFresh, maxRuns, activeRuns, runTimeoutMin }` según `design.md` §4.3.
  - *Cómo se prueba:* test de integración con valores por defecto, con `allowExec: false`, con cabecera `CF-Connecting-IP` (`tunnel: true`, `reauthFresh` según la sesión) y con un run activo (`activeRuns: 1`).

- **R5.** Si `allowExec` es falso, entonces el sistema debe responder `403` con el texto de "ejecución desactivada" a toda acción de ejecución sin lanzar ningún proceso ni escribir ningún fichero del proyecto, y debe seguir respondiendo `200` a las lecturas (`GET` de runs, cambios y diff).
  - *Cómo se prueba:* test de integración con `allowExec: false` que llama a las ocho acciones de ejecución (`403` cada una), comprueba que `FAKE_CLAUDE_LOG` no existe, que `feature_list.json` y `projects.json` no cambian y que `GET /api/projects/:id/runs` y `GET /api/projects/:id/changes` responden `200`.

- **R6.** Cuando una petición autenticada hace `GET /api/projects/:id/work`, el sistema debe responder `200` con `{ projectId, executable, execEnabled, hasSdd, isRepo, specReady, inProgress, allowedCommands, testCommand, effectiveTestCommand, defaultTools, activeRun, sessions }` según `design.md` §4.3, y `404` si el proyecto no existe.
  - *Cómo se prueba:* test de integración con un proyecto con arnés (una feature `spec_ready`), repo git, `init.sh` y `allowedCommands: ["npm test"]`; otro sin arnés ni git; uno no resuelto (`executable: false`); y un id inexistente.

## B. Construcción de la llamada a Claude Code (`lib/claude-cli.js`)

- **R7.** Cuando el sistema prepara un run de Claude en modo `new`, debe construir los argumentos exactos `['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', <reglas>]` con `--allowedTools` como última opción y enviar el prompt completo por stdin (UTF-8, cerrado tras escribirlo), nunca en argv (corrección tras la prueba manual T36 con Claude Code 2.1.307: `--allowedTools` es variádica y se tragaba un prompt posicional).
  - *Cómo se prueba:* test unitario de `buildClaudeArgs` comparando el array completo; test de integración en el que el CLI falso (que, como el real, trata `--allowedTools` como variádica y lee el prompt de stdin) registra exactamente esos argumentos, el prompt recibido por stdin y como `cwd` la carpeta del proyecto.

- **R8.** Cuando la petición pide `session: { mode: "continue" }` o `session: { mode: "resume", id }`, el sistema debe insertar `--continue` o `--resume <id>` inmediatamente antes de `--allowedTools`, y en modo `new` no debe incluir ninguno de los dos.
  - *Cómo se prueba:* test unitario de `buildClaudeArgs` con los tres modos (posición e igualdad exacta del array).

- **R9.** Cuando el sistema construye cualquier llamada a Claude, la lista de argumentos no debe contener `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions` ni el valor `bypassPermissions`, y el fuente de `lib/claude-cli.js` no debe contener esas cadenas fuera de la lista `FORBIDDEN_ARGS`.
  - *Cómo se prueba:* test unitario que construye los tres modos con un prompt igual a `--dangerously-skip-permissions` y comprueba que ningún elemento del array es una cadena prohibida; test estático del fuente.

- **R10.** Cuando el sistema construye `--allowedTools`, el valor debe ser un único argumento con las reglas por defecto (`Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)`) seguidas de `Bash(<comando> *)` por cada entrada de `allowedCommands` del proyecto, sin duplicados y unidas por comas. **Corrección T36:** en Windows Claude Code también usa la herramienta `PowerShell`: cada regla (las de git por defecto y cada `allowedCommands`) se emite como `Bash(<comando> *)` y `PowerShell(<comando> *)`.
  - *Cómo se prueba:* test unitario de `buildAllowedTools` con `[]`, con `["npm test", "npm run build"]` y con un duplicado de una regla por defecto (`git status`).

- **R11.** Si el prompt, tras recortar espacios, empieza por `-`, entonces el sistema no debe permitir que el CLI lo interprete como opción: el prompt viaja por stdin tal cual, sin añadirle nada, y nunca en argv (corrección tras la prueba manual T36 con Claude Code 2.1.307: `--allowedTools` es variádica y se tragaba un prompt posicional).
  - *Cómo se prueba:* test unitario de `buildClaudeArgs` con `--resume x`, `- lista` y `--dangerously-skip-permissions` (el array no cambia); test de integración en el que el CLI falso recibe por stdin `--resume x …` exacto y argv no contiene `--resume`.

- **R12.** Cuando el sistema resuelve el ejecutable de Claude, debe usar `process.execPath` con el fichero como primer argumento si `CLAUDE_BIN` termina en `.js`, `.mjs` o `.cjs` y, en Windows, debe aplicar las reglas de búsqueda de `design.md` §5.3 (`claude.exe` en `PATH`, `%USERPROFILE%\.local\bin\claude.exe`, y paquete npm `@anthropic-ai/claude-code/cli.js` junto a un `claude.cmd`), devolviendo un error descriptivo si solo encuentra un `.cmd`/`.bat` sin su `cli.js`.
  - *Cómo se prueba:* test unitario de `resolveClaudeCommand` con `platform` `linux` y `win32`, `env` y función `exists` inyectados para cada caso de la tabla de `design.md` §5.3.

## C. Lectura del stream-json de Claude

- **R13.** Cuando el CLI emite una línea JSON de tipo `assistant`, el sistema debe generar un evento `text` por cada bloque `text` no vacío y un evento `tool` con `name` y `summary` por cada bloque `tool_use`; y cuando emite `system`/`init`, un evento `session` con `sessionId` y `model`. **Corrección T36:** el texto de cada bloque llega hasta 20 000 caracteres; si se recorta termina en `… (texto recortado)`.
  - *Cómo se prueba:* test unitario de `createStreamMapper` con las líneas del escenario `ok` del CLI falso → secuencia exacta de eventos.

- **R14.** Cuando el CLI emite la línea `result`, el sistema debe generar un evento `result` con `ok` (`!is_error`), `text` (recortado a 2000 caracteres), `costUsd` (`total_cost_usd`), `durationMs`, `numTurns` y `sessionId`, y un evento `permission_denied` por cada elemento de `permission_denials` cuyo `tool_use_id` no se hubiera notificado antes. **Corrección T36:** `text` hasta 20 000 caracteres (con `… (texto recortado)` si se recorta); cada denegación lleva además `suggestions` (lista) y su detalle sale de `tool_input.command` o, si no existe, del texto `requires approval: <comando>` del error de herramienta; nunca `{}`.
  - *Cómo se prueba:* test unitario con un `result` de éxito, uno con `is_error: true` y uno con dos denegaciones, una de ellas ya emitida como `system`/`permission_denied` (→ solo un evento nuevo).

- **R15.** Cuando el CLI emite un bloque `tool_result` con `is_error: true`, el sistema debe generar un evento `tool_error` con `preview` recortado a 300 caracteres; cuando emite `system`/`api_retry`, un evento `notice` con el texto de reintento; y cuando emite una línea que no es JSON, un evento `output` con `stream: "stdout"` y esa línea recortada a 2000 caracteres.
  - *Cómo se prueba:* test unitario con un `tool_result` de error de 1000 caracteres, un `api_retry` con `attempt: 2` y la línea `Invalid API key`; los tipos desconocidos (`stream_event`, `{ "type": "otro" }`) no generan eventos.

- **R16.** Cuando el sistema resume los argumentos de una herramienta, debe devolver la ruta del fichero relativa a la carpeta del proyecto para `Read`, `Edit`, `MultiEdit`, `Write` y `NotebookEdit`, el `command` para `Bash`, el `pattern` para `Glob` y `Grep`, la `url` para `WebFetch`, la `description` para `Task`/`Agent` y `''` en otro caso, recortado a 120 caracteres.
  - *Cómo se prueba:* test unitario de `summarizeToolInput` con cada herramienta, una ruta fuera de la carpeta (se devuelve tal cual), una ruta Windows y un comando de 300 caracteres.

## D. Ciclo de vida de los runs (`lib/runs.js`)

- **R17.** Cuando una petición autenticada hace `POST /api/projects/:id/runs` con `{ prompt, session? }` válido sobre un proyecto ejecutable, el sistema debe responder `202` con el `RunMeta` de `design.md` §3.2 (estado `queued` o `running`) y lanzar el CLI con `spawn` sin shell, `cwd` igual a la ruta del catálogo, el prompt escrito por `stdin` (antes `stdin` ignorado; ver R7) y `windowsHide: true`.
  - *Cómo se prueba:* test de integración con el CLI falso en escenario `ok`: código, campos del `RunMeta`, `cwd` y argumentos registrados por el CLI falso, y estado final `succeeded`.

- **R18.** Si el `prompt` falta, no es una cadena, queda vacío al recortarlo o supera 20 000 caracteres, entonces el sistema debe responder `400` con el texto correspondiente de `design.md` §4.4 y no lanzar ningún proceso.
  - *Cómo se prueba:* test de integración con `{}`, `{ prompt: 5 }`, `{ prompt: "   " }` y 20 001 caracteres (`400`) y con exactamente 20 000 caracteres (`202`); el cuerpo de 20 000 caracteres multibyte (`ñ`) también se acepta.

- **R19.** Si el proyecto no existe, entonces el sistema debe responder `404`; y si no es ejecutable (sin ruta resuelta o carpeta inexistente), entonces debe responder `409` con el texto "carpeta no accesible", en ambos casos sin lanzar ningún proceso.
  - *Cómo se prueba:* test de integración con un id inexistente, un proyecto manual con ruta inexistente y un proyecto de Claude no resuelto.

- **R20.** Si ya hay un run activo en el proyecto, entonces el sistema debe responder `409` con `{ error, runId }` del run activo a cualquier nuevo run de ese proyecto (de Claude o de comando).
  - *Cómo se prueba:* test de integración: run `[[hang]]` en marcha, segundo `POST` de chat y `POST /tests` → `409` con el `runId` del primero.

- **R21.** Si el número de runs activos en todo el panel es igual a `maxRuns`, entonces el sistema debe responder `429` con el texto de máximo alcanzado y no lanzar ningún proceso.
  - *Cómo se prueba:* test de integración con `maxRuns: 1`, un run `[[hang]]` en el proyecto A y un `POST` en el proyecto B → `429`; tras cancelar el primero, el `POST` en B → `202`.

- **R22.** Si `session.mode` no es `new`, `continue` ni `resume`, o en `resume` el `id` no cumple `^[A-Za-z0-9_-]{1,100}$` o no está entre las sesiones de Claude del proyecto ni entre los `claudeSessionId` de sus runs, entonces el sistema debe responder `400` con el texto de sesión no válida.
  - *Cómo se prueba:* test de integración con fixtures de `claudeHome` (sesión `s-1` del proyecto y `s-9` de otro proyecto): `resume s-1` → `202` con `--resume s-1`; `resume s-9`, `resume ../x` y `mode: "otro"` → `400`; `resume` del `claudeSessionId` de un run anterior → `202`.

- **R23.** Cuando el proceso de Claude termina con código 0, un `result` con `is_error: false` y sin denegaciones, el sistema debe pasar el run por `queued` → `running` → `succeeded`, fijar `endedAt`, `durationMs`, `exitCode`, `costUsd`, `numTurns` y `claudeSessionId`, y emitir los eventos `state` y `end` correspondientes.
  - *Cómo se prueba:* test de integración con el escenario `ok`: secuencia de eventos `state` y campos del `RunMeta` final.

- **R24.** Cuando un run de Claude termina y se ha registrado al menos un evento `permission_denied`, el sistema debe fijar el estado `needs_permission` y guardar en `permissionDenials` cada denegación con `tool`, `detail` y `suggestion` (`design.md` §5.4). **Corrección T36:** con el CLI real una denegación no detiene el trabajo: si el `result` es éxito el estado es `succeeded` (con `permissionDenials`) y `needs_permission` queda solo cuando el `result` no es éxito y hubo denegaciones.
  - *Cómo se prueba:* test de integración con el escenario `[[denied]]` (Bash `npm run lint` denegado, código 0) → estado `needs_permission` y `permissionDenials` exacto.

- **R25.** Si el proceso termina con código distinto de 0, el `result` trae `is_error: true` o el proceso no se puede lanzar (p. ej. `ENOENT`), entonces el sistema debe fijar el estado `failed` y, en el último caso, emitir un evento `error` con el texto "No se pudo ejecutar Claude Code: <código>" y guardar ese texto en `error`.
  - *Cómo se prueba:* test de integración con los escenarios `[[error]]` y `[[crash]]` (texto de stderr como evento `output` con `stream: "stderr"`) y con `claudeCommand` apuntando a un fichero inexistente.

- **R26.** Cuando una petición autenticada hace `POST /api/runs/:runId/cancel` sobre un run activo, el sistema debe responder `202`, terminar el árbol de procesos del run (también los procesos hijos que haya lanzado) y fijar el estado `cancelled` en menos de 10 segundos.
  - *Cómo se prueba:* test de integración con `[[hang]]`, que lanza además un proceso nieto y registra su PID: tras el `202`, el estado llega a `cancelled` y `process.kill(pidNieto, 0)` lanza `ESRCH` antes de 10 s.

- **R27.** Si `POST /api/runs/:runId/cancel` llega para un run ya terminado, entonces el sistema debe responder `409` con el texto de run terminado; y si el `runId` no existe o no cumple el formato de `design.md` §3.2, entonces debe responder `404`.
  - *Cómo se prueba:* test de integración tras un run `ok` terminado (`409`), con un id bien formado inexistente (`404`) y con `..%2Fx` (`404`).

- **R28.** Cuando el sistema termina el árbol de procesos en Windows, debe ejecutar `execFile('taskkill', ['/PID', '<pid>', '/T', '/F'])` sin shell; y en el resto de sistemas debe haber lanzado el proceso con `detached: true` y enviar `SIGTERM` al grupo (`process.kill(-pid)`) y, si sigue vivo a los 5 segundos, `SIGKILL`.
  - *Cómo se prueba:* test unitario de `killProcessTree` con `platform: "win32"` y un `execFile` espía (argumentos exactos) y con `platform: "linux"` y un `kill` espía con reloj inyectado (`-pid`, `SIGTERM`, después `SIGKILL`); el caso real Linux lo cubre la prueba de cancelación.

- **R29.** Cuando un run activo alcanza `runTimeoutMs`, el sistema debe terminar su árbol de procesos, emitir un evento `notice` con el texto de límite de tiempo y fijar el estado `timeout`.
  - *Cómo se prueba:* test de integración con `runTimeoutMs: 300` y el escenario `[[hang]]` → estado `timeout` y evento `notice`.

- **R30.** Cuando los eventos de texto y salida de un run superan 5 MB guardados (`outputLimitBytes`, inyectable), el sistema debe emitir un único evento `notice` de salida truncada, dejar de guardar y emitir eventos `text`, `output`, `tool` y `tool_error`, marcar `truncated: true` y seguir procesando `result`, denegaciones y fin de proceso.
  - *Cómo se prueba:* test de integración con `outputLimitBytes: 10000` y el escenario `[[big]]`: un único `notice`, tamaño del `.jsonl` menor que el límite más 4 KB, `truncated` true y estado final `succeeded` con `costUsd`.

- **R31.** Si una línea de la salida del proceso supera 1 MB sin salto de línea, entonces el sistema debe descartarla entera, emitir un evento `notice` de línea descartada y seguir leyendo las siguientes líneas.
  - *Cómo se prueba:* test unitario de `createLineSplitter` con `maxLineBytes: 100` y trozos que parten una línea de 250 bytes entre tres `push` → la línea larga se descarta, se notifica una vez y la siguiente línea corta llega intacta.

- **R32.** Cuando el panel arranca y el índice de runs contiene runs en estado `queued` o `running`, el sistema debe marcarlos como `failed` con `error: "Interrumpida al reiniciar el panel"` y `endedAt` igual al instante del arranque.
  - *Cómo se prueba:* test de integración que escribe un índice con un run `running` en el directorio de datos, arranca la app y consulta `GET /api/runs/:runId`.

- **R33.** Cuando el servidor HTTP del panel se cierra, el sistema debe cancelar todos los runs activos y terminar sus árboles de procesos.
  - *Cómo se prueba:* test de integración con un run `[[hang]]` cuyo PID registra el CLI falso: tras `close()`, `process.kill(pid, 0)` lanza `ESRCH` antes de 10 s.

## E. Historial de runs (`lib/run-store.js`)

- **R34.** Cuando un run produce eventos, el sistema debe añadirlos en orden, uno por línea JSON con `seq` creciente desde 1 y `at` ISO, a `<datos>/runs/<projectId>/<runId>.jsonl`, y mantener el `RunMeta` en `<datos>/runs/<projectId>/index.json` (más reciente primero, escritura atómica).
  - *Cómo se prueba:* test unitario de `createRunStore` (añadir eventos, actualizar meta, releer) y test de integración que, tras un run `ok`, lee ambos ficheros del directorio de datos temporal.

- **R35.** Cuando una petición autenticada hace `GET /api/projects/:id/runs`, el sistema debe responder `200` con un array de como mucho 50 `RunMeta` del proyecto, el más reciente primero, incluidos los activos con su estado actual.
  - *Cómo se prueba:* test unitario del almacén con 60 metas (→ 50 en orden) y test de integración con dos runs terminados y uno activo.

- **R36.** Cuando una petición autenticada hace `GET /api/runs/:runId`, el sistema debe responder `200` con `{ run: RunMeta, events: Event[] }` leídos del disco (o de memoria si está activo), y `404` si el `runId` no existe o no cumple el formato.
  - *Cómo se prueba:* test de integración con un run terminado (eventos iguales a los del `.jsonl`), un run activo y dos ids no válidos.

- **R37.** Cuando un proyecto supera 200 runs guardados (`keepRuns`, inyectable), el sistema debe borrar el `.jsonl` de los más antiguos y quitarlos del índice, conservando los 200 más recientes y nunca un run activo.
  - *Cómo se prueba:* test unitario del almacén con `keepRuns: 3` y 5 runs → 3 en el índice y solo sus 3 ficheros `.jsonl` en disco.

- **R38.** Cuando un run de Claude empieza, el sistema debe guardar el prompt completo como primer evento `prompt` del `.jsonl` y en el `RunMeta` solo `promptPreview` con los primeros 120 caracteres.
  - *Cómo se prueba:* test de integración con un prompt de 500 caracteres: evento `prompt` con el texto completo y `promptPreview` de 120.

## F. Salida en vivo (Server-Sent Events)

- **R39.** Cuando una petición autenticada abre `GET /api/runs/:runId/events`, el sistema debe responder `200` con `Content-Type: text/event-stream`, `Cache-Control: no-store` y `X-Accel-Buffering: no`, enviar `retry: 3000`, reenviar todos los eventos ya producidos como mensajes `id: <seq>` + `data: <json>` y después los nuevos según se producen.
  - *Cómo se prueba:* test de integración que abre el flujo con `fetch` durante un run `[[hang]]` que emite eventos con retardo, comprueba las cabeceras y que llegan eventos posteriores a la apertura.

- **R40.** Cuando la petición SSE trae la cabecera `Last-Event-ID: N`, el sistema debe reenviar solo los eventos con `seq` mayor que N.
  - *Cómo se prueba:* test de integración sobre un run terminado con `Last-Event-ID: 3` → el primer `id` recibido es 4.

- **R41.** Cuando el run del flujo SSE está terminado o termina mientras el flujo está abierto, el sistema debe enviar el evento `end` y cerrar la respuesta.
  - *Cómo se prueba:* test de integración: flujo de un run terminado (se cierra tras `end`) y flujo abierto durante un run que termina (se cierra tras su `end`).

- **R42.** Si la petición SSE llega sin sesión válida, entonces el sistema debe responder `401` como el resto de la API; y si el `runId` no existe, entonces debe responder `404` en JSON sin abrir el flujo.
  - *Cómo se prueba:* test de integración sin cookie y con un id inexistente.

- **R43.** Cuando un flujo SSE lleva abierto un intervalo de latido (15 s por defecto, inyectable como `sseHeartbeatMs`) sin enviar nada, el sistema debe enviar la línea de comentario `: ping`.
  - *Cómo se prueba:* test de integración con `sseHeartbeatMs: 50` durante un run `[[hang]]` → se recibe `: ping`.

## G. Botones del flujo SDD (`lib/sdd-actions.js`)

- **R44.** Cuando una petición autenticada hace `POST /api/projects/:id/sdd/implement` sobre un proyecto con arnés SDD, el sistema debe lanzar un run de Claude con `action: "implement"` y el prompt exacto `implementa la siguiente tarea pendiente`, en modo `new` salvo que el cuerpo indique otra `session`.
  - *Cómo se prueba:* test de integración: el CLI falso registra el prompt exacto y la ausencia de `--continue`/`--resume`; el `RunMeta` lleva `action` y `label` de `design.md` §3.2.

- **R45.** Cuando una petición autenticada hace `POST /api/projects/:id/sdd/approve-tests` sobre un proyecto con arnés SDD, el sistema debe lanzar un run de Claude con `action: "approve-tests"` y el prompt exacto `tests aprobados, lanza al reviewer`, en modo `continue` salvo que el cuerpo indique otra `session`.
  - *Cómo se prueba:* test de integración: prompt exacto y `--continue` presente; con `session: { mode: "new" }` no aparece.

- **R46.** Si un botón SDD (`implement`, `approve-tests` o `approve-spec`) se pide sobre un proyecto sin arnés SDD, entonces el sistema debe responder `409` con el texto "sin arnés SDD" sin lanzar ningún proceso ni escribir ficheros.
  - *Cómo se prueba:* test de integración con un proyecto sin `feature_list.json` y otro con `feature_list.json` roto.

- **R47.** Cuando una petición autenticada hace `POST /api/projects/:id/sdd/approve-spec` con `{ featureId }` de una feature en `spec_ready` y no hay ninguna `in_progress`, el sistema debe cambiar solo el valor de su `status` a `in_progress` en `feature_list.json` (todos los demás bytes del fichero idénticos, incluidos BOM, saltos `\r\n` e indentación), escribirlo con `.tmp` + `rename` y responder `200` con `{ feature: { id, slug, status: "in_progress" } }`.
  - *Cómo se prueba:* test unitario de `setFeatureStatus` con un texto de 2 espacios, uno con `\r\n` y BOM y uno con la clave `status` antes y después de objetos anidados; test de integración que compara los bytes del fichero antes y después.

- **R48.** Si en `approve-spec` el `featureId` falta o no es entero o cadena, entonces el sistema debe responder `400`; si la feature no existe o no está en `spec_ready`, `409` con el texto "no está en spec_ready"; y si ya hay otra feature `in_progress`, `409` con su id y slug en el texto; en todos los casos sin modificar el fichero.
  - *Cómo se prueba:* test de integración con los cuatro casos comparando los bytes de `feature_list.json` antes y después.

- **R49.** Si el texto resultante de la edición de `feature_list.json` no vuelve a parsear como JSON igual al original salvo ese `status`, entonces el sistema debe abortar sin escribir y responder `500` con el texto de edición fallida.
  - *Cómo se prueba:* test unitario de `setFeatureStatus` con un escáner forzado a devolver un rango incorrecto (inyección de `locateFn`) → lanza el error de verificación y no devuelve texto.

## H. Ejecutar tests (`lib/command-runner.js`, `lib/exec-utils.js`)

- **R50.** Cuando una petición autenticada hace `POST /api/projects/:id/tests` sobre un proyecto ejecutable con `testCommand` configurado, el sistema debe parsearlo con `parseCommandLine`, lanzarlo con `spawn` sin shell en la carpeta del proyecto, responder `202` con un `RunMeta` de `kind: "command"` y `action: "tests"`, emitir la salida como eventos `output` (`stdout`/`stderr`, sin secuencias ANSI) y fijar `succeeded` con código 0 o `failed` con otro código.
  - *Cómo se prueba:* test de integración con `testCommand: "node <ruta>/fake-command.js ok"` y `... fail 3` (`fake-command.js` escribe en ambas salidas y colorea con ANSI): eventos, `exitCode` y estado.

- **R51.** Si el proyecto no tiene `testCommand` pero tiene `init.sh` en su raíz, entonces el sistema debe usar `[<bash>, "init.sh"]` donde `<bash>` es `bashBin` si está configurado, `bash` fuera de Windows y Git Bash en Windows según `design.md` §5.3; y si no hay ni `testCommand` ni `init.sh`, entonces debe responder `409` con el texto de comando de tests sin configurar.
  - *Cómo se prueba:* test de integración en Linux con un `init.sh` que hace `echo listo` (evento `output` con `listo`) y con un proyecto sin ninguno de los dos (`409`).

- **R52.** Cuando el sistema busca Git Bash en Windows, debe probar en orden `PANEL_BASH_BIN`, `CLAUDE_CODE_GIT_BASH_PATH`, `%ProgramFiles%\Git\bin\bash.exe`, `%ProgramFiles(x86)%\Git\bin\bash.exe` y `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`, no debe devolver nunca una ruta bajo `System32`, y si no encuentra ninguna debe producir el `409` con el texto "No se encontró Git Bash".
  - *Cómo se prueba:* test unitario de `findGitBash` con `env` y `exists` inyectados para cada posición, con `CLAUDE_CODE_GIT_BASH_PATH=C:\Windows\System32\bash.exe` (se ignora) y sin ninguna (resultado `null`).

- **R53.** Cuando el sistema parsea una línea de comando, debe separarla por espacios y tabuladores, agrupar el texto entre comillas dobles en un solo argumento admitiendo `\"` dentro de ellas, no dar significado especial a ningún otro carácter (`|`, `&`, `;`, `>`, `$`, `'`) y rechazar con error la línea vacía, con comillas sin cerrar, con saltos de línea o NUL, con más de 300 caracteres o con más de 50 argumentos.
  - *Cómo se prueba:* test unitario de `parseCommandLine` con `npm test`, `node "mi script.js" --x`, `echo "a \"b\""`, `echo a|b; rm x` (→ `["echo", "a|b;", "rm", "x"]`) y cada caso de error.

- **R54.** Cuando el sistema resuelve el ejecutable de un comando en Windows, debe usar `process.execPath` para `node`, `node` + `npm-cli.js`/`npx-cli.js` de la instalación de Node para `npm`/`npx`, Git Bash para `bash`, buscar `.com`/`.exe` en `PATH` para el resto, y si solo encuentra un `.cmd` o `.bat` debe rechazarlo con el texto de `design.md` §4.4 sin ejecutarlo.
  - *Cómo se prueba:* test unitario de `resolveExecutable` con `platform: "win32"`, `env.PATH`, `execPath` y `exists` inyectados para `node`, `npm`, `npx`, `bash`, `git` (encontrado `.exe`) y `yarn` (solo `.cmd` → error).

## I. Ver cambios y "Commit y push" (`lib/git-actions.js`)

- **R55.** Cuando una petición autenticada hace `GET /api/projects/:id/changes` sobre un repo git, el sistema debe responder `200` con `{ branch, files: [{ path, status }], stat, truncated }` obtenido de `git --no-optional-locks status --porcelain=v1 -z --untracked-files=all` y `git --no-optional-locks diff HEAD --stat` (o `diff --cached --stat` sin commits), con como mucho 500 ficheros; y si el proyecto no es repo git, `409` con el texto "no es un repositorio git".
  - *Cómo se prueba:* test de integración con un repo temporal con un fichero modificado, uno nuevo sin seguimiento, uno renombrado y uno con espacios y acentos en el nombre (rutas exactas), y con una carpeta sin git (`409`).

- **R56.** Cuando una petición autenticada hace `GET /api/projects/:id/changes/diff?file=<ruta>` con una ruta que coincide exactamente con un `path` de la lista de cambios actual, el sistema debe responder `200` con `{ file, diff, untracked, truncated }` del comando `git --no-optional-locks diff HEAD -- <ruta>` (sin `HEAD` en un repo sin commits), recortando `diff` a 200 KB con `truncated: true`, y con `untracked: true` y `diff: null` para un fichero sin seguimiento.
  - *Cómo se prueba:* test de integración con un fichero modificado (contiene `-antes` y `+después`), uno sin seguimiento y uno modificado de 300 KB (`truncated` true y longitud 200 KB).

- **R57.** Si el parámetro `file` falta o no coincide exactamente con un `path` de la lista de cambios actual, entonces el sistema debe responder `400` con el texto "no está en la lista de cambios" sin ejecutar `git diff`.
  - *Cómo se prueba:* test de integración con `../secreto.txt`, con un fichero sin cambios del repo y sin parámetro, usando un `runner` espía que comprueba que no se llamó a `diff`.

- **R58.** Cuando una petición autenticada hace `POST /api/projects/:id/git/commit-push` con `{ message }` válido y hay cambios, el sistema debe responder `202` con un run `kind: "command"`, `action: "commit-push"` que ejecuta en orden `git add -A`, `git commit -m <message>` y `git push` (o `git push -u origin <rama>` si la rama no tiene upstream), con `GIT_TERMINAL_PROMPT=0`, deteniéndose en el primer paso que falle.
  - *Cómo se prueba:* test de integración con un repo temporal y un remoto `--bare` local: con upstream (`git push`) y sin upstream (`-u origin main`, después `git rev-parse @{u}` responde); el remoto recibe el commit con el mensaje exacto; un remoto inexistente deja el run `failed` tras el commit.

- **R59.** Si el mensaje falta, queda vacío al recortarlo, supera 2000 caracteres o contiene NUL, entonces el sistema debe responder `400`; si no hay cambios, `409` con el texto "No hay cambios que commitear"; y si el HEAD está separado, `409` con el texto de HEAD separado; en todos los casos sin ejecutar ningún paso.
  - *Cómo se prueba:* test de integración con cada caso y un `git log` posterior que confirma que no hay commits nuevos.

- **R60.** Cuando el sistema ejecuta cualquier comando git de esta fase, debe usar `execFile`/`spawn` con el ejecutable `git`, la opción global `--no-optional-locks` y argumentos de una lista fija más, como argumentos sueltos, solo la ruta validada o el mensaje, y el fuente de `lib/git-actions.js` no debe contener `--force`, `-f` como argumento de push ni `--force-with-lease`.
  - *Cómo se prueba:* test unitario de los planes de pasos (`planCommitPush`) con un mensaje `--amend; rm -rf /` que llega intacto como un único argumento tras `-m`; test estático del fuente.

- **R61.** Cuando `getGitInfo` consulta el estado del repo, el sistema debe ejecutar `git --no-optional-locks status --porcelain` en lugar de `git status --porcelain` (mejora M4 de la fase 3).
  - *Cómo se prueba:* test existente de la lista cerrada `GIT_COMMANDS` actualizado con la nueva entrada y test con `runner` espía.

## J. Permisos por proyecto y ajustes de ejecución

- **R62.** Cuando `PATCH /api/projects/:id` recibe `allowedCommands` (array de como mucho 30 cadenas que cumplen `^[A-Za-z0-9._:/=@+-][A-Za-z0-9 ._:/=@+-]{0,199}$` tras recortar) o `testCommand` (cadena vacía o aceptada por `parseCommandLine`), el sistema debe guardarlos en `projects.json` sin duplicados; y si no cumplen, entonces debe responder `400` con `field` y el texto de `design.md` §4.4.
  - *Cómo se prueba:* test unitario de `validatePatch` (valores válidos, `npm test && rm`, `a(b)`, 31 entradas, `"sin cerrar`) y test de integración que relee `projects.json`.

- **R63.** Cuando un `PATCH /api/projects/:id` incluye `allowedCommands` o `testCommand`, el sistema debe tratarlo como acción de ejecución (`403` con `allowExec` falso, confirmación reciente por el túnel y auditoría), mientras que un `PATCH` sin esos campos debe seguir funcionando como en la fase 3.
  - *Cómo se prueba:* test de integración con `allowExec: false` (`PATCH { testCommand }` → `403`, `PATCH { name }` → `200`) y por el túnel sin confirmación reciente (`401` con `reauthRequired`).

- **R64.** Cuando una petición autenticada hace `POST /api/projects/:id/permissions` con `{ command }` válido según la regla de `allowedCommands`, el sistema debe añadirlo a `allowedCommands` del proyecto si no estaba (creando la entrada de ajustes si el proyecto era solo de Claude) y responder `200` con `{ allowedCommands }`.
  - *Cómo se prueba:* test de integración: añadir `npm run lint` dos veces (una sola entrada), sobre un proyecto solo de Claude (pasa a `both`) y con `npm test; rm` (`400`).

- **R65.** Cuando el sistema registra una denegación de `Bash`, debe proponer como `suggestion` el primer argumento del comando más el segundo si no empieza por `-` (y el tercero si los dos primeros son `npm`/`pnpm`/`yarn` + `run`), solo si el resultado cumple la regla de `allowedCommands`; y si el comando contiene `&&`, `||`, `;`, `|`, `>`, `<`, `` ` `` o `$(`, o la herramienta no es `Bash`, entonces `suggestion` debe ser `null`. **Corrección T36:** para un comando compuesto se propone el comando base de cada parte (`suggestions`, p. ej. `head` y `git rev-list`), cada uno validado con la regla de `allowedCommands`. **Corrección T36:** las denegaciones de `PowerShell` se tratan igual que las de `Bash` (detalle desde `tool_input.command`, del `tool_use` o del texto "requires approval: …"; comando base propuesto, p. ej. `node`).
  - *Cómo se prueba:* test unitario de `suggestAllowedCommand` con `npm run lint -- --fix` → `npm run lint`, `pytest -x` → `pytest`, `cargo test` → `cargo test`, `npm test && rm x` → `null`, y una denegación de `WebFetch` → `null`.

- **R66.** Si `POST /api/projects` o `PATCH /api/projects/:id` reciben `appUrl` o `repoUrl` no vacíos cuyo esquema no es `http:` ni `https:` (o que no parsean como URL), entonces el sistema debe responder `400` con `field` y el texto de URL no válida, sin guardar (mejora M5 de la fase 3).
  - *Cómo se prueba:* test unitario de `validateNewProject` y `validatePatch` con `javascript:alert(1)`, `ftp://x`, `no es url`, `''` (válido) y `https://ok.example` (válido); test de integración del `400` en ambas rutas.

## K. Confirmación de contraseña por el túnel (`lib/reauth.js`)

- **R67.** Si una acción de ejecución llega por el túnel, Cloudflare Access no está configurado y la sesión no tiene confirmación reciente, entonces el sistema debe responder `401` con `{ "error": "Confirma tu contraseña para continuar", "reauthRequired": true }` sin lanzar ningún proceso ni escribir ficheros.
  - *Cómo se prueba:* test de integración con reloj inyectable: login, avanzar 16 minutos, `POST /runs` con `CF-Connecting-IP` → `401` con `reauthRequired`; con `X-Forwarded-Proto: https` → igual; `FAKE_CLAUDE_LOG` sin crear.

- **R68.** Cuando una petición autenticada hace `POST /api/auth/reauth` con la contraseña correcta, el sistema debe guardar `reauthAt` en la sesión (persistido en `sessions.json`) y responder `204`; con la contraseña incorrecta, `401` con el texto "Contraseña incorrecta" y un fallo en el limitador de intentos (al sexto intento, `429`); y sin sesión, `401` "No autenticado". **Corrección T36 (= M3 de la fase 2):** la IP del límite de intentos es la real: `CF-Connecting-IP`/`X-Forwarded-For` (y `X-Forwarded-Proto` para el atributo solo-HTTPS de la cookie) solo se creen si la conexión viene de loopback (desde donde conecta cloudflared); desde la LAN se usa `remoteAddress`, aunque esas cabeceras sigan haciendo que la acción se trate como del túnel (más estricto). El mapa del limitador se limpia de caducadas y tiene un tope de 10 000 entradas.
  - *Cómo se prueba:* test de integración: reauth correcto y la acción del caso anterior pasa a `202`; cinco fallos y el sexto `429`; sin cookie `401`; lectura de `sessions.json` con `reauthAt`.

- **R69.** Cuando el humano crea la contraseña (`setup`) o inicia sesión (`login`), el sistema debe fijar `reauthAt` de la nueva sesión al instante actual.
  - *Cómo se prueba:* test de integración: login y acción por el túnel inmediata → `202`; a los 16 minutos → `401` con `reauthRequired`.

- **R70.** Cuando una acción de ejecución llega desde la red local (sin ninguna de las cabeceras del túnel), el sistema debe exigir solo la sesión normal, sin confirmación reciente.
  - *Cómo se prueba:* test de integración: login, avanzar 2 horas, `POST /runs` sin cabeceras del túnel → `202`.

## L. Cloudflare Access (`lib/cf-access.js`)

- **R71.** Si Cloudflare Access está configurado y una petición por el túnel (incluidos estáticos y `/api/auth/status`) no trae `Cf-Access-Jwt-Assertion` o el token no es válido, entonces el sistema debe responder `403` con el texto de acceso denegado; y cuando la petición es de la red local, debe atenderla sin mirar esa cabecera.
  - *Cómo se prueba:* test de integración con `cfAccess` apuntando a un servidor local de claves: `GET /` y `GET /api/auth/status` con `CF-Connecting-IP` sin token → `403`; sin cabeceras del túnel → `200`.

- **R72.** Cuando el sistema verifica un token de Access, debe aceptarlo solo si su cabecera tiene `alg: "RS256"` y un `kid` de las claves de `https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs`, la firma RSA-SHA256 es válida con `node:crypto`, `aud` (cadena o array) contiene el AUD configurado, `iss` es `https://<equipo>.cloudflareaccess.com`, `exp` es posterior y `nbf` (si existe) anterior o igual al instante actual con 60 s de margen.
  - *Cómo se prueba:* test unitario de `createAccessVerifier` con un par RSA generado en el test: token válido (aceptado) y uno por cada fallo (firma alterada, `aud` ajeno, `iss` ajeno, `exp` pasado, `nbf` futuro, `alg: "HS256"`, `alg: "none"`, `kid` desconocido, texto que no es JWT) → rechazado con su motivo.

- **R73.** Cuando el sistema obtiene las claves públicas de Access, debe reutilizarlas durante 1 hora; si llega un `kid` desconocido, debe volver a pedirlas como mucho una vez por minuto; y si la descarga falla, debe rechazar el token (`403`) y registrar el fallo con `console.error`.
  - *Cómo se prueba:* test unitario con `fetch` espía y reloj inyectado: dos verificaciones en 59 min (1 descarga), a los 61 min (2), `kid` nuevo dos veces en 30 s (1 descarga extra), y `fetch` que lanza → rechazo con motivo `certs`.

- **R74.** Cuando Cloudflare Access está configurado y el token es válido, el sistema no debe exigir confirmación reciente de contraseña a las acciones de ejecución por el túnel (siguen exigiendo la sesión del panel).
  - *Cómo se prueba:* test de integración: login, avanzar 1 hora, `POST /runs` con `CF-Connecting-IP` y token válido → `202`; sin cookie → `401` "No autenticado".

## M. Registro de auditoría (`lib/audit.js`)

- **R75.** Cuando el sistema atiende una acción de ejecución con sesión válida (aceptada o rechazada), debe añadir a `<datos>/audit.log` una línea JSON con `at`, `ip`, `tunnel`, `projectId`, `action`, `result` y, si existen, `runId`, `status` y `detail` (`design.md` §3.5), con el prompt recortado a 120 caracteres.
  - *Cómo se prueba:* test de integración con un run aceptado, un `409` y un `401` por confirmación: tres líneas con los campos exactos y `detail.promptPreview` de 120 caracteres para un prompt de 500.

- **R76.** Cuando el sistema escribe en `audit.log`, ninguna línea debe contener la contraseña, el valor de la cookie de sesión, el token de Access ni más de 120 caracteres del prompt.
  - *Cómo se prueba:* test de integración que hace login, reauth (correcto e incorrecto), un run con prompt de 500 caracteres y una petición con token de Access, y busca en `audit.log` la contraseña, el token de sesión, el JWT y el carácter 121 del prompt (ninguno aparece).

- **R77.** Cuando un run termina, el sistema debe añadir a `audit.log` una línea `action: "run.end"` con su estado final; y cuando `audit.log` supera 5 MB antes de escribir, debe renombrarlo a `audit.log.1` (sustituyendo el anterior) y empezar uno nuevo.
  - *Cómo se prueba:* test unitario de `createAuditLog` con `maxBytes: 200` (rotación) y test de integración que encuentra la línea `run.end` con `state: "succeeded"`.

## N. Cola de atención ("Te necesitan")

- **R78.** Cuando una petición autenticada hace `GET /api/attention`, el sistema debe responder `200` con `{ projects, runs }`: los proyectos visibles con estado `atencion` y su motivo (`spec_ready` con las features o `bloqueo` con el texto), y como mucho 20 runs terminados en `needs_permission`, `failed` o `timeout` en los últimos 7 días sin `dismissed`, el más reciente primero. **Corrección T36:** también aparecen, como aviso informativo (`informative: true`), los runs `succeeded` con denegaciones.
  - *Cómo se prueba:* test de integración con un proyecto con feature `spec_ready`, otro con bloqueo, uno oculto en atención (no aparece), un run `[[denied]]`, un run `ok` (no aparece) y un run antiguo de 8 días escrito en el índice (no aparece).

- **R79.** Cuando una petición autenticada hace `POST /api/runs/:runId/dismiss` sobre un run terminado, el sistema debe marcar `dismissed: true` en su `RunMeta` y responder `204`, y el run no debe volver a aparecer en `GET /api/attention`.
  - *Cómo se prueba:* test de integración tras un run `[[denied]]`: aparece, `dismiss` → `204`, ya no aparece; `dismiss` de un run activo → `409`.

## O. Interfaz (`public/work.js`, `public/app.js`, `index.html`, `styles.css`)

- **R80.** Cuando la interfaz pinta la vista "Trabajar" de un proyecto, el sistema debe mostrar la caja de mensaje con el selector de sesión ("Nueva conversación", "Continuar la última sesión" y las sesiones recientes), y los botones "Implementar siguiente tarea" y "Aprobar tests" solo si `hasSdd`, "Aprobar spec" solo si hay `specReady`, "Ver cambios" y "Commit y push" solo si `isRepo`, y "Ejecutar tests" solo si `effectiveTestCommand` no es nulo.
  - *Cómo se prueba:* test unitario de `renderWorkView` con combinaciones de `hasSdd`, `specReady`, `isRepo` y `effectiveTestCommand` (presencia y ausencia de cada `data-action`).

- **R81.** Si `execEnabled` es falso o el proyecto no es ejecutable, entonces la vista "Trabajar" debe mostrar el aviso de solo lectura de `design.md` §6.2 y no debe incluir la caja de mensaje ni ningún botón de acción de ejecución, manteniendo el historial y "Ver cambios".
  - *Cómo se prueba:* test unitario de `renderWorkView` con `execEnabled: false` y con `executable: false`.

- **R82.** Cuando el humano pulsa una acción de ejecución, el sistema debe abrir un diálogo de confirmación cuyo texto, generado por `describeAction`, indique exactamente qué se hará: prompt y modo de sesión para Claude, línea de comando para los tests, feature y cambio de estado para "Aprobar spec", y los pasos de git con el mensaje para "Commit y push".
  - *Cómo se prueba:* test unitario de `describeAction` con cada acción contra los textos exactos de `design.md` §6.3 (con escapado de HTML).

- **R83.** Cuando la interfaz recibe un evento de run, el sistema debe pintarlo con `renderRunEvent` según su tipo (texto del asistente, herramienta con nombre y resumen, error de herramienta, salida, aviso, resultado con coste y duración, error, fin) escapando todo el texto. **Corrección T36:** el `result` no repite el texto si es idéntico al último texto del asistente.
  - *Cómo se prueba:* test unitario de `renderRunEvent` con cada tipo de evento y textos con `<script>` (escapados).

- **R84.** Cuando un run termina en `needs_permission`, la interfaz debe mostrar "Claude necesita permiso para: <herramienta>: <detalle>" por cada denegación y, si tiene `suggestion`, el botón "Permitir en este proyecto y reintentar", que tras confirmar añade el comando y relanza el mismo prompt reanudando la sesión de Claude del run. **Corrección T36:** un run `succeeded` con denegaciones muestra "N comandos denegados durante la ejecución" con un botón "Permitir… y reintentar" por cada comando propuesto.
  - *Cómo se prueba:* test unitario de `renderPermissionPrompt` (con y sin `suggestion`) y de `buildRetryPayload` (`session: { mode: "resume", id: claudeSessionId }` o `continue` si no hay id).

- **R85.** Cuando la interfaz pinta un diff, el sistema debe marcar las líneas que empiezan por `+` con la clase `add`, por `-` con `del`, por `@@` con `hunk` y las de cabecera (`diff `, `index `, `+++ `, `--- `) con `meta`, escapando el contenido, y debe indicar "Diff recortado a 200 KB" si `truncated`.
  - *Cómo se prueba:* test unitario de `renderDiff` con un diff de ejemplo que contiene `<b>` y con `truncated: true`.

- **R86.** Si una petición de la interfaz recibe `401` con `reauthRequired: true`, entonces el cliente no debe cerrar la sesión (no debe llamar a `onUnauthorized`) y la interfaz debe abrir el diálogo de contraseña y, tras un `reauth` correcto, repetir la acción una sola vez.
  - *Cómo se prueba:* test unitario de `createApiClient` con un `fetch` falso que responde ese `401` (`onUnauthorized` no se llama y el error lleva `payload.reauthRequired`) y de `withReauth` con funciones espía (una repetición tras `reauth` correcto, ninguna si se cancela).

- **R87.** Cuando la portada pinta la sección "Te necesitan", el sistema debe mostrar con `renderAttention` cada proyecto con su motivo y un botón que abre su vista "Trabajar", y cada run con su estado y botones "Ver ejecución" y "Descartar"; y si no hay nada, la sección no debe mostrarse.
  - *Cómo se prueba:* test unitario de `renderAttention` con datos de ambos tipos y con listas vacías (cadena vacía).

- **R88.** Cuando la interfaz pinta el historial de runs, el sistema debe mostrar por cada run su etiqueta, el estado con el texto de `design.md` §6.4, la fecha relativa, la duración y el coste si existe, y un botón para reabrirlo.
  - *Cómo se prueba:* test unitario de `renderRunList` con un run de cada estado y una lista vacía ("Sin ejecuciones todavía").

- **R89.** Cuando la interfaz prepara "Commit y push", el sistema debe prerrellenar el mensaje con `suggestCommitMessage`: `Avance de <slug> desde el Puesto de Mando` si hay feature `in_progress` y `Cambios desde el Puesto de Mando` si no.
  - *Cómo se prueba:* test unitario de `suggestCommitMessage` con y sin `inProgress`.

- **R90.** Si `appUrl` o `repoUrl` no empiezan por `http://` o `https://`, entonces `renderProjectCard` y `renderProjectDetail` no deben generar `href` con ese valor (el botón "Abrir app" queda deshabilitado y no se muestra el enlace al repositorio).
  - *Cómo se prueba:* test unitario con `javascript:alert(1)` y `JaVaScRiPt:x` (sin `href` con esos valores) y con `https://ok.example` (enlace presente).

- **R91.** Cuando se sirve `index.html`, el sistema debe incluir la sección `#attention` dentro de `#list-view` antes de `#projects`, los diálogos `#confirm-dialog` y `#reauth-dialog` (elementos `<dialog>`) y el script `work.js` importado desde `app.js`; y `styles.css` debe definir `.run-log`, `.diff .add`, `.diff .del`, `.diff .hunk`, `.attention`, `.work-actions` y `.state-needs_permission` sin anchos fijos mayores de 360 px.
  - *Cómo se prueba:* test estático de `index.html`, `app.js` y `styles.css` (orden de huecos, presencia de selectores y ausencia de `width: NNNpx` con NNN > 360).

## P. Otras mejoras pendientes de revisiones anteriores

- **R92.** Cuando el sistema usa el `summary` de una sesión de Claude como título, debe recortarlo con `clipTitle` a 80 caracteres más `…` (mejora M1 de la fase 3).
  - *Cómo se prueba:* test unitario de `parseSessionFile` con un `summary` de 120 caracteres → título de 81 caracteres acabado en `…`.

- **R93.** Cuando se ejecuta `panel/deploy/uninstall-service.ps1`, el script debe cerrar también los procesos `cloudflared.exe` cuyo `CommandLine` contenga `--url http://localhost:` (mejora M5 de la fase 2).
  - *Cómo se prueba:* test estático de `deploy.test.js` que busca en el script el filtro `Name = 'cloudflared.exe'`, la cadena `--url http://localhost:` y `Stop-Process`.

- **R94.** Cuando la fase 4 se entrega, `docs/architecture.md` debe documentar los módulos, rutas y variables nuevas (`PANEL_ALLOW_EXEC`, `PANEL_MAX_RUNS`, `PANEL_RUN_TIMEOUT_MIN`, `CLAUDE_BIN`, `PANEL_BASH_BIN`, `PANEL_CF_ACCESS_TEAM`, `PANEL_CF_ACCESS_AUD`), `docs/verification.md` debe tener la tabla con prefijo `[F4-R` y `docs/acceso-web.md` debe terminar con la sección `## 9. Cloudflare Access` (dominio propio, aplicación de Access con política por email y código de un solo uso, y las dos variables). **Corrección T36:** el registro vivo pasa a `<datos>/projects.json` (copiado una vez de `panel/projects.json` o sembrado con `panel/projects.example.json`); `docs/architecture.md` y `docs/acceso-web.md` lo explican.
  - *Cómo se prueba:* test estático en `deploy.test.js` que busca esas cadenas y comprueba que la sección 9 va después de la 8 y que el test existente de `acceso-web.md` sigue en verde.

## Q. Comprobaciones manuales en el PC Windows y en el móvil

- **R95.** **[MANUAL — Windows]** Cuando el humano envía un mensaje desde la vista "Trabajar" de un proyecto real con el `claude` instalado en su PC, el sistema debe mostrar en vivo el texto y las herramientas, terminar en `succeeded` con coste y duración, y el run debe poder reabrirse desde el historial; con "Continuar la última sesión" Claude debe recordar el mensaje anterior.
  - *Cómo se prueba:* MANUAL desde el móvil por la red local y por la URL del túnel; resultado anotado en `docs/verification.md` (anotar también la versión de `claude --version`).

- **R96.** **[MANUAL — Windows]** Cuando el humano pide a Claude un comando no autorizado (p. ej. `npm run lint` sin estar en la lista), el sistema debe terminar en `needs_permission` con el botón "Permitir en este proyecto y reintentar", y tras pulsarlo el reintento debe ejecutar el comando.
  - *Cómo se prueba:* MANUAL en el PC Windows; anotar en `docs/verification.md` el texto exacto de la denegación que emite el CLI real.

- **R97.** **[MANUAL — Windows]** Cuando el humano cancela un run de Claude o de tests que está ejecutando un comando largo, el sistema debe dejar el run en `cancelled` y no debe quedar ningún proceso `claude.exe`, `node.exe` o `bash.exe` hijo vivo (comprobado en el Administrador de tareas).
  - *Cómo se prueba:* MANUAL en Windows con un `testCommand` que espera 120 s; anotar el resultado.

- **R98.** **[MANUAL — Windows]** Cuando el humano pulsa "Ejecutar tests" en un proyecto con `init.sh` y sin `testCommand`, el sistema debe ejecutarlo con Git Bash y mostrar su salida en vivo; y cuando pulsa "Commit y push", el push debe llegar al remoto sin quedarse esperando credenciales.
  - *Cómo se prueba:* MANUAL en Windows con Git for Windows instalado; anotar la ruta de bash detectada y el resultado.

- **R99.** **[MANUAL — Internet]** Cuando el humano, con dominio propio y la aplicación de Cloudflare Access creada según `docs/acceso-web.md` §9, abre el panel desde el móvil con datos móviles, el sistema debe pedir primero el código de un solo uso de Access y después la contraseña del panel, y las acciones de ejecución no deben pedir de nuevo la contraseña; con las variables de Access sin definir y la URL temporal, una acción por el túnel pasados 15 minutos debe pedir la contraseña.
  - *Cómo se prueba:* MANUAL con el dominio propio y con la URL de trycloudflare; resultado anotado en `docs/verification.md`.

## Supuestos y dudas para el leader (no inventados; se marcan para confirmar)

1. **Flags del CLI** (verificados en la documentación oficial `code.claude.com/docs/en/cli-reference` y `/headless` el 2026-10-25): `-p`, `--output-format stream-json` (requiere `--verbose`), `--permission-mode acceptEdits`, `--allowedTools` con reglas `Bash(git diff *)` (la forma `Bash(git diff:*)` es la sintaxis antigua equivalente), `--continue`, `--resume <id>`; con stream-json las denegaciones llegan como mensajes `system`/`permission_denied` y en `permission_denials` del `result`. Todo vive en la tabla de constantes de `lib/claude-cli.js`: si la versión instalada del humano difiere, se cambia solo ahí. **A confirmar por el humano** con `claude --version` y la prueba manual de las denegaciones.
2. **Prompt que empieza por `-`:** se antepone un espacio para que el CLI lo trate como texto. Se asume que el CLI no recorta ese espacio antes de interpretar opciones; se verifica en la prueba manual de Windows.
3. **`init.sh` en Windows:** se ejecuta con Git Bash (Claude Code en Windows ya requiere Git for Windows). Si el humano tiene Git en otra ruta, debe fijar `PANEL_BASH_BIN` o el `testCommand` del proyecto.
4. **`npm` en Windows sin shell:** `npm.cmd` no puede lanzarse sin shell; se sustituye por `node <instalación de Node>\node_modules\npm\bin\npm-cli.js`. Se asume la instalación estándar de Node para Windows.
5. **Push con credenciales:** se asume que el humano tiene las credenciales de git guardadas (Git Credential Manager) para el usuario con el que corre el panel; con `GIT_TERMINAL_PROMPT=0` el push falla en lugar de quedarse esperando. Con la tarea programada S4U el gestor de credenciales puede no tener acceso: se comprueba en la prueba manual.
6. **SSE a través de Cloudflare:** se asume que el túnel no acumula la respuesta `text/event-stream` (Cloudflare la reenvía en vivo); si se observara retraso, la reconexión con `Last-Event-ID` no pierde eventos.
