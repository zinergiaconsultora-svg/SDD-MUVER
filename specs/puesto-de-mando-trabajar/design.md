# Diseño — Feature 4: Puesto de Mando MUVER (fase 4: trabajar desde el panel)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo solo esta carpeta
> más `docs/conventions.md`. Se construye ENCIMA de las fases 1, 2 y 3 (`panel/`): nada de lo que funciona se rompe;
> los tests existentes siguen en verde salvo los dos ajustes declarados en §8.4.

## 1. Decisiones técnicas (resumen)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | **Claude Code CLI en modo no interactivo** (`claude -p … --output-format stream-json --verbose`) lanzado con `child_process.spawn` **sin shell**, `cwd` = ruta del catálogo y el prompt **por stdin** (corrección T36: ver §5.2). | El humano ya tiene `claude` instalado y con sesión iniciada en su PC; el CLI usa su suscripción y su `CLAUDE.md` de cada proyecto ("implementa la siguiente tarea pendiente" funciona igual que en la terminal). Sin shell no hay inyección posible. |
| D2 | **Permisos acotados**: `--permission-mode acceptEdits` + `--allowedTools` con una lista por defecto (lectura/edición + `git status/diff/log`) más los `allowedCommands` del proyecto. **Nunca** `--dangerously-skip-permissions` ni `bypassPermissions` (lista `FORBIDDEN_ARGS` + test estático). | Decisión del humano. En `-p` sin anfitrión de permisos, lo no autorizado se deniega y el stream lo informa (`permission_denied` y `permission_denials`). |
| D3 | **Todas las flags del CLI en una tabla de constantes** (`lib/claude-cli.js`, `CLI_FLAGS`). | Si la versión del CLI del humano cambia un nombre, se toca un solo sitio. Verificadas en la doc oficial el 2026-10-25 (supuesto 1 de `requirements.md`). |
| D4 | **Salida en vivo por Server-Sent Events** (`GET /api/runs/:runId/events`) con `id: <seq>` y reconexión nativa del navegador con `Last-Event-ID`. | Unidireccional (servidor → navegador), nativo en `EventSource`, pasa por Cloudflare Tunnel como HTTP normal y lleva la cookie de sesión sin código extra. |
| D5 | **Historial en disco** por run (`<datos>/runs/<projectId>/<runId>.jsonl`) + índice por proyecto (`index.json`), rotación a 200 runs. | El estado vive en disco (regla del arnés): un run se reabre tras reiniciar el panel; sin base de datos. |
| D6 | **Gestor de runs en memoria** (`lib/runs.js`): máquina de estados, límites (1 por proyecto, `maxRuns` global), timeout, cancelación con **árbol de procesos** (`taskkill /T /F` en Windows; grupo de procesos `detached` + `kill(-pid)` en POSIX). | Claude lanza procesos hijos (bash, npm…): matar solo el PID dejaría huérfanos. |
| D7 | **"Ejecutar tests" y "Commit y push" son runs `command`** con los mismos eventos, historial y SSE que los de Claude; los pasos de git se planifican antes de empezar con argumentos fijos. | Una sola vista de salida, un solo historial y un solo mecanismo de cancelación. |
| D8 | **Comandos del usuario parseados por un parser propio** (espacios + comillas dobles) y lanzados sin shell; en Windows `.cmd`/`.bat` se rechazan salvo `npm`/`npx`, que se sustituyen por `node npm-cli.js`; `bash` → Git Bash detectado. | Node ≥ 18.20 se niega a lanzar `.cmd` sin shell (CVE-2024-27980) y con shell habría inyección. |
| D9 | **"Aprobar spec" edita `feature_list.json` por texto**: localiza con un escáner JSON mínimo el literal del `status` de esa feature y lo sustituye; verifica re-parseando; escritura `.tmp` + `rename`. | Conserva byte a byte el resto del fichero (formato, orden de claves, BOM, `\r\n`), cosa que `JSON.stringify` no garantiza. |
| D10 | **Puerta de ejecución única** (`gateExec` en `lib/work-api.js`): sesión → `allowExec` → confirmación reciente si llega por el túnel sin Access → validaciones → auditoría. | Una sola función que todas las acciones usan; imposible olvidar una comprobación. |
| D11 | **Petición por el túnel** = trae `CF-Connecting-IP`, `Cf-Ray` o `X-Forwarded-Proto: https`, **siempre** (aunque `PANEL_TRUST_PROXY=0`). | `cloudflared` conecta desde `localhost`, así que la IP no sirve; falsear esas cabeceras desde la LAN solo hace la comprobación más estricta (mitiga M3 de la fase 2 para estas acciones). |
| D12 | **Cloudflare Access verificado en el origen** (`lib/cf-access.js`): JWT RS256 con `node:crypto` (`createPublicKey({ format: 'jwk' })` + `crypto.verify`), claves de `https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs` con `fetch` global, caché 1 h. Falla cerrado. | Sin dependencias npm; si alguien llegara al túnel saltándose Access (p. ej. otra ruta), el panel lo rechaza igualmente. |
| D13 | **`reauthAt` persistido en `sessions.json`** (método nuevo `markReauth`), fijado también en `login`/`setup`. TTL 15 min. | Decisión del humano ("marca `reauthAt` en la sesión"); recién iniciada la sesión no tiene sentido pedir la contraseña otra vez. |
| D14 | **Auditoría** en `<datos>/audit.log` (JSON por línea, rotación simple a 5 MB → `audit.log.1`), escritura serializada con `fs.appendFile`. Nunca contraseñas, cookies, tokens ni más de 120 caracteres del prompt. | Requisito del humano; un fichero de texto es suficiente para un solo usuario. |
| D15 | **Rutas nuevas en un módulo aparte** (`lib/work-api.js`, `createWorkApi(deps).route(req, res, url, session)`), y `lib/app.js` solo lo conecta. | `app.js` ya tiene 363 líneas; separar mantiene cada fichero corto y testeable. |
| D16 | **UI**: funciones puras nuevas en `public/work.js` (render y lógica sin DOM, testeables en Node) y cableado mínimo en `public/app.js`; diálogos con `<dialog>` nativo. | Mismo patrón de las fases 1–3. |
| D17 | Mejoras M1/M4/M5 (fase 3) y M5 (fase 2) incluidas con requisito y test propios (R61, R66, R90, R92, R93). | Pedido explícito del leader. |

## 2. Estructura de ficheros

```
panel/
├── server.js                    (tocar) pasa las opciones nuevas a createApp; líneas de arranque de ejecución y Access; cierra runs al salir
├── lib/
│   ├── claude-cli.js            (crear) CLI_FLAGS, DEFAULT_ALLOWED_TOOLS, FORBIDDEN_ARGS, SDD_PROMPTS, buildClaudeArgs, buildAllowedTools,
│   │                                    resolveClaudeCommand, createStreamMapper, summarizeToolInput, suggestAllowedCommand, isValidAllowedCommand
│   ├── exec-utils.js            (crear) parseCommandLine, formatCommandLine, resolveExecutable, findGitBash, killProcessTree, createLineSplitter, stripAnsi
│   ├── runs.js                  (crear) createRunManager: start, cancel, get, subscribe, activeFor, cancelAll; máquina de estados, límites, timeout
│   ├── run-store.js             (crear) createRunStore: create, appendEvent, updateMeta, list, find, readEvents, recoverOrphans, rotate
│   ├── command-runner.js        (crear) runSteps: ejecuta pasos {file,args,label} en serie como un run "command"
│   ├── sdd-actions.js           (crear) locateFeatureStatus, setFeatureStatus, approveSpec, resolveTestCommand
│   ├── git-actions.js           (crear) GIT_ACTION_ARGS, getChanges, parsePorcelainZ, getFileDiff, planCommitPush
│   ├── cf-access.js             (crear) createAccessVerifier, decodeJwt, accessIssuer, accessCertsUrl
│   ├── reauth.js                (crear) REAUTH_TTL_MS, isTunnelRequest, isReauthFresh
│   ├── audit.js                 (crear) createAuditLog, clipPrompt
│   ├── sse.js                   (crear) openSse, formatSseEvent
│   ├── work-api.js              (crear) createWorkApi: rutas de la fase 4 + gateExec
│   ├── app.js                   (tocar) opciones nuevas; comprobación de Access antes de todo; /api/auth/reauth; reauthAt en login/setup;
│   │                                    delega en work-api; PATCH con campos de ejecución; cierre de runs en 'close'
│   ├── config.js                (tocar) readConfig: allowExec, maxRuns, runTimeoutMs, claudeBin, bashBin, cfAccess; buildStartupLines: work
│   ├── registry.js              (tocar) PATCHABLE_FIELDS + allowedCommands/testCommand; validación http(s) de appUrl/repoUrl; normalizeSettings
│   ├── sessions.js              (tocar) reauthAt: se carga/guarda; create({ reauthAt }); markReauth(id)
│   ├── git-info.js              (tocar, M4) entrada de estado → ['--no-optional-locks', 'status', '--porcelain']
│   ├── claude-discovery.js      (tocar, SOLO M1) title = clipTitle(lastSummary)
│   └── path-key.js, rate-limit.js, http-utils.js, project-state.js, project-catalog.js, auth.js, public-url.js, tunnel.js, network.js  (NO tocar)
├── public/
│   ├── work.js                  (crear) funciones puras de la vista "Trabajar", diálogos, eventos, diff, atención, historial
│   ├── app.js                   (tocar) pestaña "Trabajar" en el detalle, EventSource, diálogos, sección "Te necesitan"
│   ├── api-client.js            (tocar) no llama a onUnauthorized si el 401 trae reauthRequired
│   ├── render.js                (tocar, M5) safeHttpUrl: sin href para esquemas que no sean http/https
│   ├── index.html               (tocar) #attention, #confirm-dialog, #reauth-dialog
│   └── styles.css               (tocar) selectores nuevos (§6.1)
├── deploy/uninstall-service.ps1 (tocar, M5 fase 2) cierra cloudflared.exe del túnel
├── projects.json                (NO tocar)
└── test/
    ├── fixtures/fake-claude.js  (crear) CLI falso (§8.1)
    ├── fixtures/fake-command.js (crear) comando falso para tests (§8.1)
    ├── work-helpers.js          (crear) waitForRun, readSse, makeAccessKeys, startCertsServer, makeJwt, tunnelHeaders
    ├── helpers.js               (tocar) startApp: por defecto claudeCommand = CLI falso, extraEnv con FAKE_CLAUDE_LOG
    ├── claude-cli.test.js, exec-utils.test.js, run-store.test.js, runs-api.test.js, sdd-actions.test.js, git-actions.test.js,
    │   cf-access.test.js, reauth-api.test.js, audit.test.js, work-api.test.js, work-render.test.js   (crear)
    └── config.test.js, registry.test.js, render.test.js, styles.test.js, deploy.test.js, git-info.test.js,
        claude-discovery.test.js, auth.test.js (sessions)   (tocar)

docs/architecture.md   (tocar) fase 4
docs/verification.md   (tocar) tabla [F4-R<n>]
docs/acceso-web.md     (tocar) SOLO añadir al final "## 9. Cloudflare Access" y las variables nuevas en la tabla de §5
```

## 3. Modelo de datos

### 3.1 `panel/projects.json` (capa de ajustes) — campos nuevos opcionales

```json
{ "id": "app-flyder", "name": "app-flyder", "path": "C:\\Users\\Usuario\\app-flyder", "appUrl": "", "repoUrl": "", "tags": [],
  "hidden": false, "pinned": false,
  "allowedCommands": ["npm test", "npm run build"],
  "testCommand": "npm test" }
```

- `allowedCommands`: array de cadenas (máx. 30), cada una cumple `ALLOWED_COMMAND_RE = /^[A-Za-z0-9._:/=@+-][A-Za-z0-9 ._:/=@+-]{0,199}$/` tras recortar y colapsar espacios; sin duplicados. Ausente o inválido al leer → `[]` (`normalizeSettings`).
- `testCommand`: cadena; `''` = no configurado. Ausente o no cadena al leer → `''`.

### 3.2 `RunMeta` (índice, respuestas `202` y `GET`)

```json
{
  "runId": "mgx3k2a1-9f3c0b1e",
  "projectId": "app-flyder",
  "kind": "claude",
  "action": "chat",
  "label": "Chat",
  "promptPreview": "Añade validación de email…",
  "command": null,
  "session": { "mode": "new", "id": null },
  "state": "running",
  "startedAt": "2026-10-25T10:15:00.000Z",
  "endedAt": null,
  "durationMs": null,
  "exitCode": null,
  "claudeSessionId": null,
  "costUsd": null,
  "numTurns": null,
  "permissionDenials": [],
  "error": null,
  "truncated": false,
  "outputBytes": 0,
  "dismissed": false
}
```

- `runId` = `Date.now().toString(36)` + `-` + 8 hex aleatorios; formato `RUN_ID_RE = /^[a-z0-9]{6,12}-[0-9a-f]{8}$/`. Cualquier `:runId` que no cumpla → `404` (nunca llega a una ruta de disco).
- `kind`/`action`/`label`: `claude`/`chat`/`Chat`, `claude`/`implement`/`Implementar siguiente tarea`, `claude`/`approve-tests`/`Aprobar tests`, `command`/`tests`/`Ejecutar tests`, `command`/`commit-push`/`Commit y push`.
- `promptPreview`: primeros 120 caracteres (puntos de código) del prompt; `null` en `command`.
- `command`: línea mostrada (`formatCommandLine`) en `tests`; `git add -A → git commit -m "…" → git push` en `commit-push`; `null` en `claude`.
- `session`: solo en `claude` (`null` en `command`).
- `permissionDenials`: `[{ "tool": "Bash", "detail": "npm run lint -- --fix", "suggestion": "npm run lint" }]` (`detail` ≤ 200 caracteres).
- `outputBytes`: bytes guardados de eventos `text`/`output`/`tool`/`tool_error` (base del límite de 5 MB).

### 3.3 Eventos (líneas del `.jsonl`, mensajes SSE, `GET /api/runs/:runId`)

Todos llevan `seq` (entero desde 1, consecutivo por run), `at` (ISO) y `type`:

| `type` | Campos | Origen |
|--------|--------|--------|
| `prompt` | `text` (completo) | Inicio de un run `claude` (siempre `seq: 1`) |
| `state` | `state` | Cada transición (`queued`, `running`, final) |
| `session` | `sessionId`, `model` | `system`/`init` del CLI |
| `text` | `text` | Bloque `text` de un mensaje `assistant` |
| `tool` | `name`, `summary` | Bloque `tool_use` de un mensaje `assistant` |
| `tool_error` | `preview` (≤ 300) | Bloque `tool_result` con `is_error: true` |
| `permission_denied` | `tool`, `detail`, `suggestion` | `system`/`permission_denied` o `result.permission_denials` (deduplicado por `tool_use_id`) |
| `step` | `index`, `total`, `command` | Inicio de cada paso de un run `command` |
| `output` | `stream` (`stdout`/`stderr`), `text` | Salida de comandos; stderr del CLI; líneas no JSON del CLI (≤ 2000) |
| `notice` | `message` | Reintento de API, truncado, línea descartada, límite de tiempo |
| `result` | `ok`, `text` (≤ 2000), `costUsd`, `durationMs`, `numTurns`, `sessionId` | Línea `result` del CLI |
| `error` | `message` | Fallo al lanzar el proceso o error interno |
| `end` | `state`, `exitCode`, `durationMs` | Último evento de todo run |

Textos de `notice`: `Reintentando la llamada a la API (intento N)`, `Salida truncada: se alcanzó el límite de 5 MB` (con el límite real en MB con un decimal si no es entero), `Línea de salida descartada por superar 1 MB`, `Tiempo máximo alcanzado (M min): se detiene la ejecución`.

### 3.4 Ficheros de runs

```
<datos>/runs/<projectId>/index.json        { "version": 1, "runs": [RunMeta, …] }  (más reciente primero; .tmp + rename)
<datos>/runs/<projectId>/<runId>.jsonl     una línea JSON por evento
```

`projectId` cumple `ID_PATTERN` de `registry.js` (los ids del catálogo siempre lo cumplen); si no, el run se rechaza con `500` interno (no debería ocurrir).

### 3.5 Línea de `audit.log`

```json
{"at":"2026-10-25T10:15:00.000Z","ip":"203.0.113.7","tunnel":true,"projectId":"app-flyder","action":"run.chat","result":"started","runId":"mgx3k2a1-9f3c0b1e","status":202,"detail":{"promptPreview":"Añade…","session":"new"}}
```

- `action`: `run.chat`, `run.implement`, `run.approve-tests`, `run.tests`, `git.commit-push`, `sdd.approve-spec`, `settings.exec` (PATCH con campos de ejecución), `permissions.add`, `auth.reauth`, `run.cancel`, `run.end`.
- `result`: `started` (202), `ok` (200/204), `rejected` (4xx; `status` con el código), `error` (5xx), y en `run.end` el estado final en `detail.state`.
- `detail`: solo `promptPreview` (≤ 120), `session`, `command` (línea de tests), `featureId`, `fields` (nombres de campos del PATCH), `addedCommand`, `state`. Nunca contraseñas, cookies, tokens ni el mensaje de commit completo (se guarda recortado a 120 como `promptPreview` también).
- `ip`: `getClientIp(req, { trustProxy })` como en la fase 2.

### 3.6 `sessions.json` — campo nuevo

Cada sesión puede llevar `reauthAt` (ms). `load()` lo conserva si es un número finito; si no, la sesión se carga sin él (se trata como no confirmada).

## 4. API HTTP

### 4.1 Tabla de rutas nuevas y cambiadas (todas detrás de la sesión salvo indicación)

| Método y ruta | Acción de ejecución | Éxito | Notas |
|---------------|:---:|-------|-------|
| `POST /api/auth/reauth` `{ password }` | no (pero exige sesión) | `204` | `401` contraseña incorrecta (sin `reauthRequired`), `429` limitador, `401` sin sesión |
| `GET /api/work/status` | — | `200` §4.3 | |
| `GET /api/projects/:id/work` | — | `200` §4.3 | `404` |
| `POST /api/projects/:id/runs` `{ prompt, session? }` | sí | `202` RunMeta | Cuerpo hasta 128 KB (`readJsonBody(req, { limit: 131072 })`) |
| `POST /api/projects/:id/sdd/implement` `{ session? }` | sí | `202` | |
| `POST /api/projects/:id/sdd/approve-tests` `{ session? }` | sí | `202` | modo por defecto `continue` |
| `POST /api/projects/:id/sdd/approve-spec` `{ featureId }` | sí | `200 { feature }` | |
| `POST /api/projects/:id/tests` | sí | `202` | |
| `GET /api/projects/:id/changes` | — | `200` §4.3 | `409` sin git |
| `GET /api/projects/:id/changes/diff?file=` | — | `200` §4.3 | `400` fichero no listado |
| `POST /api/projects/:id/git/commit-push` `{ message }` | sí | `202` | |
| `POST /api/projects/:id/permissions` `{ command }` | sí | `200 { allowedCommands }` | |
| `PATCH /api/projects/:id` | sí solo si trae `allowedCommands`/`testCommand` | `200` | resto igual que fase 3 |
| `GET /api/projects/:id/runs` | — | `200 RunMeta[]` (≤ 50) | |
| `GET /api/runs/:runId` | — | `200 { run, events }` | |
| `GET /api/runs/:runId/events` | — | SSE | |
| `POST /api/runs/:runId/cancel` | no | `202 RunMeta` | `409` terminado |
| `POST /api/runs/:runId/dismiss` | no | `204` | `409` activo |
| `GET /api/attention` | — | `200 { projects, runs }` | |

Todas las mutaciones siguen pasando por la cabecera anti-CSRF (`isMutation`), incluida `POST /api/auth/reauth`.

### 4.2 Middleware (`handle` en `app.js`), orden

1. `url` parseada.
2. **Access** (nuevo): si `isTunnelRequest(req)` y (`cfAccess.error` → `403 accessMisconfigured`) o (Access configurado y `await verifier.verify(header 'cf-access-jwt-assertion')` no es `ok` → `403 accessDenied`). Se aplica a estáticos y API.
3. API → anti-CSRF → `/api/auth/*` → sesión (como la fase 3) → `workApi.route(req, res, url, session)` (devuelve `true` si atendió) → rutas de la fase 3.
4. Estáticos.

### 4.3 Contratos de respuesta

`GET /api/work/status`:
```json
{ "execEnabled": true, "accessConfigured": false, "tunnel": true, "reauthFresh": false, "maxRuns": 2, "activeRuns": 0, "runTimeoutMin": 30 }
```
(`reauthFresh` es `true` siempre que no se necesite confirmar: red local o Access configurado; solo es `false` cuando la próxima acción pediría la contraseña.)

`GET /api/projects/:id/work`:
```json
{
  "projectId": "app-flyder", "executable": true, "execEnabled": true,
  "hasSdd": true, "isRepo": true,
  "specReady": [{ "id": 4, "slug": "puesto-de-mando-trabajar" }],
  "inProgress": null,
  "allowedCommands": ["npm test"], "testCommand": "",
  "effectiveTestCommand": "bash init.sh", "testCommandError": null,
  "defaultTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)"],
  "activeRun": null,
  "sessions": [{ "id": "s-1", "title": "…", "lastActivityAt": "…" }]
}
```
- `effectiveTestCommand`: `testCommand` si no está vacío; si no, `bash init.sh` cuando existe `init.sh` y hay bash (`testCommandError` con el texto de Git Bash si falta en Windows); si no, `null` con `testCommandError` = texto de "comando de tests sin configurar".
- `activeRun`: `RunMeta` del run activo o `null`. `sessions`: hasta 20 sesiones de Claude del proyecto (de la fase 3), `[]` si no hay.
- Un proyecto no ejecutable devuelve `executable: false`, `hasSdd: false`, `isRepo: false`, `effectiveTestCommand: null`.

`GET /api/projects/:id/changes`:
```json
{ "branch": "main", "files": [{ "path": "src/a.js", "status": " M" }, { "path": "nuevo.txt", "status": "??" }], "stat": " src/a.js | 2 +-\n 1 file changed…", "truncated": false }
```
(`truncated` true si había más de 500 ficheros; `stat` recortado a 20 KB.)

`GET /api/projects/:id/changes/diff?file=src/a.js` → `{ "file": "src/a.js", "diff": "diff --git …", "untracked": false, "truncated": false }`.

`GET /api/attention`:
```json
{
  "projects": [{ "id": "crm-zinergia", "name": "crm-zinergia", "reason": "spec_ready", "features": [{ "id": 2, "slug": "alta-clientes" }], "blockReason": null }],
  "runs": [{ "runId": "…", "projectId": "app-flyder", "projectName": "app-flyder", "label": "Chat", "state": "needs_permission", "endedAt": "…", "permissionDenials": [] }]
}
```
(`reason: "bloqueo"` lleva `blockReason` y `features: []`. Si un proyecto tiene ambos, `reason` es `spec_ready` y `blockReason` también se rellena.)

### 4.4 Textos de error exactos (`WORK_ERRORS` en `work-api.js`)

| Clave | Código | Texto |
|-------|:---:|-------|
| `execDisabled` | 403 | `Acciones de ejecución desactivadas en este panel (PANEL_ALLOW_EXEC=0)` |
| `reauthRequired` | 401 | `Confirma tu contraseña para continuar` (+ `reauthRequired: true`) |
| `accessDenied` | 403 | `Acceso denegado: falta o no es válida la identificación de Cloudflare Access` |
| `accessMisconfigured` | 403 | `Cloudflare Access mal configurado en el panel` |
| `projectNotFound` | 404 | `Proyecto no encontrado` (el de la fase 3) |
| `noDir` | 409 | `El proyecto no tiene una carpeta accesible en este PC` |
| `runActive` | 409 | `Ya hay una ejecución en marcha en este proyecto` (+ `runId`) |
| `tooManyRuns` | 429 | `Se ha alcanzado el máximo de ejecuciones simultáneas (N)` |
| `promptRequired` | 400 | `Escribe un mensaje para Claude` (+ `field: "prompt"`) |
| `promptTooLong` | 400 | `El mensaje supera los 20000 caracteres` (+ `field: "prompt"`) |
| `invalidSession` | 400 | `Sesión de Claude no válida para este proyecto` |
| `noSdd` | 409 | `El proyecto no tiene arnés SDD (feature_list.json ausente o no válido)` |
| `featureIdRequired` | 400 | `Indica la feature a aprobar` |
| `notSpecReady` | 409 | `La feature no está en spec_ready` |
| `otherInProgress` | 409 | `Ya hay otra feature in_progress: #<id> <slug>` |
| `editFailed` | 500 | `No se pudo editar feature_list.json sin alterar el resto del fichero` |
| `noTestCommand` | 409 | `Configura el comando de tests del proyecto (Ajustes de ejecución → Comando de tests)` |
| `noGitBash` | 409 | `No se encontró Git Bash: instala Git for Windows o configura el comando de tests` |
| `cmdScript` | 409 | `"<nombre>" es un script .cmd/.bat y el panel no usa shell: indica la ruta de un .exe o usa node <script>.js` |
| `notRepo` | 409 | `El proyecto no es un repositorio git` |
| `fileNotChanged` | 400 | `El fichero no está en la lista de cambios` |
| `messageRequired` | 400 | `Escribe el mensaje del commit` (+ `field: "message"`) |
| `messageTooLong` | 400 | `El mensaje del commit supera los 2000 caracteres` (+ `field: "message"`) |
| `nothingToCommit` | 409 | `No hay cambios que commitear` |
| `detachedHead` | 409 | `No se puede hacer push sin rama (HEAD separado)` |
| `runNotFound` | 404 | `Ejecución no encontrada` |
| `runFinished` | 409 | `La ejecución ya ha terminado` |
| `runStillActive` | 409 | `La ejecución sigue en marcha` |
| `invalidCommand` | 400 | `Comando no válido: solo letras, números, espacios y . _ : / = @ + - (máx. 200)` (+ `field`) |
| `tooManyCommands` | 400 | `Como mucho 30 comandos autorizados` (+ `field: "allowedCommands"`) |
| `invalidTestCommand` | 400 | `Comando de tests no válido: <motivo de parseCommandLine>` (+ `field: "testCommand"`) |
| `invalidUrl` (registry) | 400 | `La URL debe empezar por http:// o https://` (+ `field: "appUrl"` o `"repoUrl"`) |
| evento `error` (Claude) | — | `No se pudo ejecutar Claude Code: <err.code o mensaje>` |
| evento `error` (comando) | — | `No se pudo ejecutar el comando: <err.code o mensaje>` |
| `error` de huérfanos | — | `Interrumpida al reiniciar el panel` |

Motivos de `parseCommandLine`: `vacío`, `comillas sin cerrar`, `contiene saltos de línea o NUL`, `más de 300 caracteres`, `más de 50 argumentos`.

### 4.5 Puerta de ejecución (`gateExec`) — secuencia

```
acción de ejecución (sesión ya válida)
  ├─ allowExec falso ............................ 403 execDisabled        → audit rejected
  ├─ tunnel && !accessConfigured && !isReauthFresh(session.reauthAt, now)
  │                                               401 reauthRequired       → audit rejected
  ├─ validaciones propias de la acción ......... 400/404/409/429         → audit rejected
  └─ ejecutar ................................... 200/202                  → audit started/ok
```
Con Access configurado, la petición ya pasó la verificación del JWT en el middleware (§4.2), así que la confirmación no se pide.

## 5. Módulos y funciones (contratos)

### 5.1 `lib/config.js` (añadidos)

`readConfig` añade:
- `allowExec`: `!['0','false'].includes(String(env.PANEL_ALLOW_EXEC).toLowerCase())`.
- `maxRuns`: entero 1–10 o 2. `runTimeoutMs`: entero 1–240 de `PANEL_RUN_TIMEOUT_MIN` × 60 000, o 30 × 60 000.
- `claudeBin`: `CLAUDE_BIN` recortado o `'claude'`. `bashBin`: `PANEL_BASH_BIN` recortado o `null`.
- `cfAccess`: `null` si no hay ninguna de las dos; `{ team, aud }` si ambas válidas (equipo recortado en minúsculas que cumple `^[a-z0-9-]{1,63}$`, AUD recortado no vacío); `{ error: 'Faltan PANEL_CF_ACCESS_TEAM o PANEL_CF_ACCESS_AUD' }` o `{ error: 'PANEL_CF_ACCESS_TEAM no válido' }` en otro caso.

`buildStartupLines({ …, work })` con `work = { allowExec, maxRuns, runTimeoutMin, cfAccess }` añade, tras la línea de Claude y antes de la URL pública:
- `Ejecución desde el panel: activada (máx. 2 a la vez, límite 30 min)` / `Ejecución desde el panel: desactivada (PANEL_ALLOW_EXEC=0)`.
- `Cloudflare Access: activado (equipo <team>)` / `Cloudflare Access: no configurado (las acciones por el túnel piden la contraseña cada 15 min)` / `AVISO: Cloudflare Access mal configurado (<error>): se rechaza todo acceso por el túnel`.

### 5.2 `lib/claude-cli.js`

```js
export const CLI_FLAGS = Object.freeze({
  print: '-p', outputFormat: '--output-format', streamJson: 'stream-json', verbose: '--verbose',
  permissionMode: '--permission-mode', acceptEdits: 'acceptEdits', allowedTools: '--allowedTools',
  continueLast: '--continue', resume: '--resume',
});
export const BASH_RULE = (cmd) => `Bash(${cmd} *)`;   // sintaxis actual; la antigua era `Bash(cmd:*)`
export const DEFAULT_ALLOWED_TOOLS = Object.freeze(['Read','Edit','Write','Glob','Grep', BASH_RULE('git status'), BASH_RULE('git diff'), BASH_RULE('git log')]);
export const FORBIDDEN_ARGS = Object.freeze(['--dangerously-skip-permissions','--allow-dangerously-skip-permissions','bypassPermissions']);
export const SDD_PROMPTS = Object.freeze({ implement: 'implementa la siguiente tarea pendiente', approveTests: 'tests aprobados, lanza al reviewer' });
export const MAX_PROMPT_CHARS = 20000;
```

- `buildAllowedTools(allowedCommands)` → cadena: `DEFAULT_ALLOWED_TOOLS` + `BASH_RULE(c)` por cada comando válido, sin duplicados, `join(',')`.
- `buildClaudeArgs({ session, allowedCommands })` → `[-p, --output-format, stream-json, --verbose, --permission-mode, acceptEdits, (--continue | --resume <id>)?, --allowedTools, <tools>]`. Lanza si algún elemento está en `FORBIDDEN_ARGS` (defensa en profundidad). **Corrección tras la prueba manual T36 (Claude Code 2.1.307):** en el CLI real `--allowedTools` es una opción **variádica** y consumía el prompt que antes iba como último argumento (`Error: Input must be provided either through stdin or as a prompt argument when using --print`). Ahora el prompt **no va en argv**: `lib/runs.js` lo escribe en el stdin del proceso (UTF-8) y lo cierra; `--allowedTools` es siempre la última opción. Con ello desaparece el espacio inicial para prompts que empiezan por `-` (R11): por stdin no pueden leerse como opción. El CLI falso de los tests reproduce el parseo variádico y la lectura de stdin.
- `resolveClaudeCommand(claudeBin, { platform, env, execPath, exists })` → `{ file, prefixArgs }` o `{ error }`:

| Caso | Resultado |
|------|-----------|
| termina en `.js`/`.mjs`/`.cjs` | `{ file: execPath, prefixArgs: [claudeBin] }` |
| ruta absoluta (cualquier SO) | `{ file: claudeBin, prefixArgs: [] }` |
| no Windows | `{ file: claudeBin, prefixArgs: [] }` (lo busca `spawn` en `PATH`) |
| Windows, `claude.exe` en algún directorio de `env.PATH` (o `Path`) | esa ruta |
| Windows, `%USERPROFILE%\.local\bin\claude.exe` existe | esa ruta (instalador nativo) |
| Windows, `claude.cmd` en `PATH` y `<dir>\node_modules\@anthropic-ai\claude-code\cli.js` existe | `{ file: execPath, prefixArgs: [cli.js] }` (instalación npm global) |
| Windows, solo `.cmd`/`.bat` | `{ error: cmdScript }` |
| nada | `{ file: claudeBin, prefixArgs: [] }` (fallará con `ENOENT` → evento `error`) |

  Las rutas Windows se componen con `path.win32.join` para que los tests en Linux funcionen.
- `createStreamMapper({ cwd })` → `{ push(line) → Event[] (sin seq/at), denials() }`. Reglas:

| Entrada | Salida |
|---------|--------|
| no parsea como JSON (línea no vacía) | `output` `stdout`, texto ≤ 2000 |
| `type: system`, `subtype: init` | `session` `{ sessionId: session_id ?? null, model: model ?? null }` |
| `type: system`, `subtype: api_retry` | `notice` `Reintentando la llamada a la API (intento <attempt>)` |
| `type: system`, `subtype: permission_denied` | `permission_denied` con `tool = tool_name ?? toolName ?? 'desconocida'`, `input = tool_input ?? input ?? {}`; recuerda `tool_use_id` |
| `type: assistant`, `message.content[]` | por bloque: `text` (no vacío tras recortar) → `text`; `tool_use` → `tool { name, summary: summarizeToolInput(name, input, cwd) }` |
| `type: user`, bloque `tool_result` con `is_error: true` | `tool_error { preview }` (contenido cadena o concatenación de bloques `text`, ≤ 300) |
| `type: result` | `result { ok: is_error !== true, text: String(result ?? '').slice(0,2000), costUsd: total_cost_usd ?? null, durationMs: duration_ms ?? null, numTurns: num_turns ?? null, sessionId: session_id ?? null }` + `permission_denied` por cada `permission_denials[]` con `tool_use_id` no visto |
| cualquier otro (`stream_event`, tipos desconocidos) | nada |

  `detail` de una denegación: `input.command` (Bash), `input.file_path`, `input.url`, `input.pattern` o `JSON.stringify(input)`, recortado a 200; `suggestion = tool === 'Bash' ? suggestAllowedCommand(input.command) : null`.
- `summarizeToolInput(name, input, cwd)`: `Read/Edit/MultiEdit/Write` → `file_path`; `NotebookEdit` → `notebook_path ?? file_path`; si la ruta está dentro de `cwd` (comparación con `pathKey` de `path-key.js` sobre el prefijo, que admite rutas Windows), se devuelve relativa con `/`; `Bash` → `command`; `Glob/Grep` → `pattern`; `WebFetch` → `url`; `Task`/`Agent` → `description`; resto `''`. Siempre ≤ 120 caracteres (recorte + `…`).
- `suggestAllowedCommand(command)`: `null` si no es cadena o contiene `&&`, `||`, `;`, `|`, `>`, `<`, `` ` `` o `$(`; tokens = `command.trim().split(/\s+/)`; `s = [t0]`; si `t1` existe y no empieza por `-` → `s.push(t1)`; si `t0 ∈ {npm, pnpm, yarn}` y `t1 === 'run'` y `t2` existe y no empieza por `-` → `s.push(t2)`; resultado `s.join(' ')` si `isValidAllowedCommand`, si no `null`.
- `isValidAllowedCommand(c)`: cadena, tras recortar y colapsar espacios cumple `ALLOWED_COMMAND_RE` (§3.1).

### 5.3 `lib/exec-utils.js`

- `parseCommandLine(line)` → `{ ok: true, args }` o `{ ok: false, error: <motivo> }` (motivos en §4.4). Reglas: fuera de comillas, espacios y tabuladores separan; `"` abre/cierra grupo; dentro de comillas `\"` → `"` y `\\` → `\`; fuera de comillas `\` es literal (rutas Windows). `""` produce un argumento vacío.
- `formatCommandLine(args)` → une con espacios y entrecomilla (`"…"`, escapando `"`) los argumentos con espacios o vacíos.
- `resolveExecutable(name, { platform, env, execPath, exists, bashBin })` → `{ file, prefixArgs }` o `{ error }`:
  - no Windows: `bash` → `bashBin ?? 'bash'`; `.js/.mjs/.cjs` → node; resto tal cual.
  - Windows: `node`/`node.exe` → `execPath`; `npm`/`npx` → `execPath` + `path.win32.join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js' | 'npx-cli.js')` (si no existe → `{ error: cmdScript }`); `bash`/`bash.exe` → `findGitBash` (`null` → `{ error: noGitBash }`); ruta absoluta → tal cual (si termina en `.cmd`/`.bat` → `{ error: cmdScript }`); resto: buscar `<dir>\<name>.com`, `.exe` y `<name>` si ya trae `.exe` en cada directorio de `env.PATH ?? env.Path` (separador `;`); si no, si existe `.cmd`/`.bat` → `{ error: cmdScript }`; si no → tal cual (fallará con `ENOENT`).
- `findGitBash({ env, exists, bashBin })` → ruta o `null`, probando en orden: `bashBin`, `env.CLAUDE_CODE_GIT_BASH_PATH`, `<ProgramFiles>\Git\bin\bash.exe`, `<ProgramFiles(x86)>\Git\bin\bash.exe`, `<LOCALAPPDATA>\Programs\Git\bin\bash.exe`; descarta cualquier candidata cuya clave de ruta contenga `\system32\` o `\sysnative\` (bash de WSL).
- `killProcessTree(child, { platform, execFileImpl, killImpl, graceMs = 5000, setTimeoutImpl })`:
  - Windows: `execFileImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })`.
  - Resto: `killImpl(-child.pid, 'SIGTERM')` (si lanza `ESRCH`, ya terminó); a los `graceMs`, si el hijo no ha emitido `exit`, `killImpl(-child.pid, 'SIGKILL')`.
- `createLineSplitter({ maxLineBytes = 1048576, onLine, onDiscard })`: acumula con `StringDecoder('utf8')`, emite por `\n` (quita `\r` final); si el buffer pendiente supera `maxLineBytes`, lo descarta, llama una vez a `onDiscard()` y descarta hasta el siguiente `\n`. `end()` emite lo pendiente.
- `stripAnsi(text)`: elimina `/\x1b\[[0-9;?]*[ -\/]*[@-~]/g` y `/\x1b\][^\x07]*\x07/g`.

### 5.4 Máquina de estados del run (`lib/runs.js`)

```
            spawn OK                exit
 queued ─────────────▶ running ─────────────▶ succeeded | failed | needs_permission
   │  spawn 'error'       │ cancel()  ─────▶ cancelled
   └────────▶ failed      │ timeout   ─────▶ timeout
```

Estado final (en este orden de prioridad): `cancelled` si se pidió cancelar; `timeout` si saltó el límite; `failed` si hubo error al lanzar; `succeeded` si `exitCode === 0` y (en `claude`) hubo `result` con `ok` — **aunque haya denegaciones**, que quedan en `permissionDenials`; (solo `claude`) `needs_permission` si el `result` no es éxito y hubo denegaciones; `failed` en otro caso. **Corrección T36** (Claude Code 2.1.307 real): una denegación no detiene el trabajo, Claude esquiva el comando y termina con `result` success; antes el run quedaba en `needs_permission`. En la misma corrección: texto del asistente y del `result` hasta 20 000 caracteres (`… (texto recortado)`), detalle de la denegación desde `tool_input.command` o del texto `requires approval: <cmd>` del error de herramienta (nunca `{}`), `suggestions` con el comando base de cada parte, el `result` de la UI no repite el último texto del asistente, y `GET /api/attention` incluye los `succeeded` con denegaciones como `informative: true`. En `command`, cada paso que termina con código ≠ 0 detiene la serie y el run es `failed` con ese `exitCode`.

`createRunManager({ store, audit, now, maxRuns, runTimeoutMs, outputLimitBytes = 5 * 1024 * 1024, platform, spawnImpl = spawn, killTree = killProcessTree, env = process.env, extraEnv = {} })`:
- `startClaude({ project, prompt, session, action, allowedCommands, claudeCommand })` y `startCommand({ project, steps, action, commandLabel, env })` → `{ ok: true, meta }` o `{ ok: false, status, error, runId? }` (`runActive` / `tooManyRuns`).
- `spawn(file, [...prefixArgs, ...args], { cwd, env: { ...env, ...extraEnv, …extra }, stdio: [stdin, 'pipe', 'pipe'], windowsHide: true, detached: platform !== 'win32', shell: false })` con `stdin = 'pipe'` en los runs de Claude (se escribe el prompt y se cierra; EPIPE se ignora) e `'ignore'` en los de comando.
- Eventos: `store.appendEvent` → `subscribers` (SSE). Límite: antes de guardar `text`/`output`/`tool`/`tool_error`, si `outputBytes + bytes > outputLimitBytes` → un `notice` de truncado, `truncated = true` y se descartan los siguientes de esos tipos.
- Timeout: `setTimeout(runTimeoutMs)` → `notice` + `killTree` + estado `timeout`. Cancelación: `killTree` + estado `cancelled` al recibir `exit` (o a los `graceMs + 1000` si no llega).
- `cancelAll()` (para `server.on('close')` y señales de `server.js`).
- Al terminar: `updateMeta` final, eventos `state` + `end`, `audit.write({ action: 'run.end', … detail: { state } })`, cierre de suscriptores, `store.rotate(projectId)`.

### 5.5 `lib/run-store.js`

`createRunStore({ dataDir, now, keepRuns = 200 })`:
- `create(meta)` → crea carpeta, escribe índice con la meta al principio.
- `appendEvent(projectId, runId, event)` → `fs.appendFile` serializado por run (cola de promesas).
- `updateMeta(projectId, runId, patch)` → lee índice, sustituye, escribe `.tmp` + `rename` (cola por proyecto).
- `list(projectId, limit = 50)`; `find(runId)` → `{ projectId, meta }` buscando `runs/*/index.json` (solo si `RUN_ID_RE`); `readEvents(projectId, runId)` → array (líneas no parseables se ignoran).
- `recoverOrphans()` → recorre los índices y marca `queued`/`running` como `failed` (§ R32) con `endedAt = now()`.
- `rotate(projectId, activeIds)` → si hay más de `keepRuns`, borra los más antiguos que no estén activos (índice y `.jsonl`).
- `listAll({ since })` → para la cola de atención.

### 5.6 `lib/command-runner.js`

`runSteps(steps, { emit, spawnRun })`: por cada `{ file, prefixArgs, args, display }` emite `step`, lanza, pasa stdout/stderr por `createLineSplitter` + `stripAnsi` → eventos `output`, y continúa solo si el código es 0. Lo usa `runs.startCommand`.

### 5.7 `lib/sdd-actions.js`

- `locateFeatureStatus(text, index)` → `{ start, end }` del literal de cadena (comillas incluidas) del valor de la **última** clave `"status"` del objeto `features[index]`, o `null`. Escáner mínimo: salta BOM y espacios; reconoce cadenas con escapes, números, `true/false/null`, objetos y arrays; solo mira claves de profundidad 1 (raíz), luego elementos del array `features`, luego claves de ese objeto.
- `setFeatureStatus(text, featureId, from, to, { locateFn = locateFeatureStatus })` → nuevo texto o lanza `Error('verify')`/`Error('not-found')`: parsea (`JSON.parse` sin BOM), busca el índice `i` en `parsed.features` (array original, sin filtrar) con `String(f.id) === String(featureId)` y `f.status === from`; sustituye `[start, end)` por `JSON.stringify(to)`; verifica que `JSON.parse(nuevo)` sea igual en profundidad a `parsed` con `features[i].status = to` (comparación con `util.isDeepStrictEqual`).
- `approveSpec(projectDir, featureId)` → `{ ok, status, error?, feature? }` aplicando §4.4 (`noSdd`, `notSpecReady`, `otherInProgress`, `editFailed`) y escribiendo `feature_list.json.tmp` + `rename`. Cerrojo en memoria por carpeta (cola de promesas).
- `resolveTestCommand({ testCommand, projectDir, platform, env, execPath, exists, bashBin })` → `{ ok: true, steps: [{ file, prefixArgs, args, display }] }` o `{ ok: false, status: 409|400, error }`.

### 5.8 `lib/git-actions.js`

```js
export const GIT_ACTION_ARGS = Object.freeze({
  status: ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
  hasHead: ['--no-optional-locks', 'rev-parse', '--verify', '-q', 'HEAD'],
  branch: ['--no-optional-locks', 'rev-parse', '--abbrev-ref', 'HEAD'],
  upstream: ['--no-optional-locks', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
  statHead: ['--no-optional-locks', 'diff', 'HEAD', '--stat'],
  statCached: ['--no-optional-locks', 'diff', '--cached', '--stat'],
  diffHead: ['--no-optional-locks', 'diff', 'HEAD', '--'],      // + ruta validada
  diffWorktree: ['--no-optional-locks', 'diff', '--'],          // + ruta validada (repo sin commits)
  add: ['--no-optional-locks', 'add', '-A'],
  commit: ['--no-optional-locks', 'commit', '-m'],              // + mensaje
  push: ['--no-optional-locks', 'push'],
  pushSetUpstream: ['--no-optional-locks', 'push', '-u', 'origin'], // + rama
});
```

- `parsePorcelainZ(stdout)` → `[{ path, status }]`: campos separados por `\0`; cada uno `XY␠ruta`; si `X` o `Y` es `R` o `C`, el campo siguiente es la ruta de origen y se salta.
- `getChanges(dir, { runner })` → contrato §4.3 (usa `rev-parse --is-inside-work-tree` de `git-info.js` vía `getGitInfo` o su propia comprobación; no repo → `{ ok: false, status: 409, error: notRepo }`).
- `getFileDiff(dir, file, { runner, maxBytes = 204800 })`: obtiene `getChanges`, exige `files.some(f => f.path === file)` (si no → `fileNotChanged`, sin ejecutar `diff`); `??` → `untracked: true, diff: null`; si no, `diffHead` o `diffWorktree` + `file`, `maxBuffer: 10 MB`; recorta a `maxBytes` bytes (sin partir un carácter UTF-8).
- `planCommitPush(dir, message, { runner })` → `{ ok: true, steps, display }` o error §4.4: valida mensaje (recorte, ≤ 2000, sin NUL), `status` no vacío, `branch` ≠ `HEAD` y que cumple `^[A-Za-z0-9._/-]+$` sin empezar por `-`, `upstream` (éxito → `push`; fallo → `pushSetUpstream` + rama). Pasos con `env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }`.
- Todos con `execFile('git', args, { cwd, timeout: 15000, windowsHide: true, maxBuffer })` salvo los pasos de `commit-push`, que van por `runs.startCommand` (timeout del run).

### 5.9 `lib/cf-access.js`

- `accessIssuer(team)` = `https://<team>.cloudflareaccess.com`; `accessCertsUrl(team)` = `<issuer>/cdn-cgi/access/certs`.
- `decodeJwt(token)` → `{ header, payload, signingInput, signature }` o `null` (tres partes base64url, JSON válidos).
- `createAccessVerifier({ team, aud, certsUrl = accessCertsUrl(team), fetchImpl = globalThis.fetch, now = Date.now, cacheMs = 3600000, refetchMinMs = 60000, leewaySec = 60, log = console.error })` → `{ verify(token) → Promise<{ ok: true, claims } | { ok: false, reason }> }`. Motivos: `missing`, `malformed`, `alg`, `kid`, `signature`, `aud`, `iss`, `exp`, `nbf`, `certs`.
  - Claves: respuesta `{ keys: [JWK…] }` → `Map(kid → crypto.createPublicKey({ key: jwk, format: 'jwk' }))`. Caché `cacheMs`; `kid` ausente → recarga si la última descarga fue hace ≥ `refetchMinMs`.
  - Firma: `crypto.verify('RSA-SHA256', Buffer.from(signingInput), key, signature)`.
  - `aud`: cadena igual o array que la contiene. `iss` igual al emisor. `exp` (s) + `leewaySec` > `now()/1000`. `nbf` (si existe) − `leewaySec` ≤ `now()/1000`.

### 5.10 `lib/reauth.js`

- `REAUTH_TTL_MS = 15 * 60 * 1000`.
- `isTunnelRequest(req)`: `cf-connecting-ip` o `cf-ray` no vacías, o primer valor de `x-forwarded-proto` = `https`.
- `isReauthFresh(reauthAt, nowMs, ttlMs = REAUTH_TTL_MS)`: `Number.isFinite(reauthAt) && nowMs - reauthAt <= ttlMs`.

### 5.11 `lib/audit.js`

`createAuditLog({ file, now, maxBytes = 5 * 1024 * 1024 })` → `{ write(entry) → Promise }`: cola de promesas; antes de cada escritura `stat`; si `size + línea > maxBytes` → `rename(file, file + '.1')`; `appendFile(file, JSON.stringify({ at, ...entry }) + '\n')`. Nunca lanza (errores → `console.error` sin el contenido). `clipPrompt(text)` → 120 puntos de código.

### 5.12 `lib/sse.js`

- `openSse(res, { heartbeatMs })` → escribe cabeceras `200` (`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, `Connection: keep-alive`), `retry: 3000\n\n`, latido `: ping\n\n` cada `heartbeatMs` (se reinicia con cada envío); devuelve `{ send(event), close() }`.
- `formatSseEvent(event)` = `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`.
- Flujo en `work-api`: `Last-Event-ID` (entero ≥ 0, si no 0) → reenviar eventos con `seq` > N (de memoria si está activo, si no del `.jsonl`) → si terminado, cerrar tras `end`; si activo, suscribirse; al cerrar el cliente (`req.on('close')`) desuscribir y parar el latido.

### 5.13 `lib/work-api.js`

`createWorkApi({ projectsFile, dataDir, now, runner, platform, env, execPath, claudeCommand, bashBin, allowExec, maxRuns, runTimeoutMs, outputLimitBytes, keepRuns, sseHeartbeatMs, accessConfigured, trustProxy, sessions, limiter, loadSources, findMerged, buildCatalog, extraEnv })` → `{ route(req, res, url, session) → Promise<boolean>, runs, close() }`. Contiene `gateExec`, las rutas de §4.1 (salvo `/api/auth/reauth`, que vive en `app.js` junto a las demás de `/api/auth/*`) y el `PATCH` con campos de ejecución: `app.js` llama a `workApi.isExecPatch(body)` y, si es así, aplica `gateExec` antes de su lógica de la fase 3.

### 5.14 `lib/app.js` (cambios)

- Opciones nuevas de `createApp`: `allowExec = true`, `maxRuns = 2`, `runTimeoutMs = 30 * 60000`, `claudeCommand` (por defecto `resolveClaudeCommand('claude', …)`), `bashBin = null`, `cfAccess = null`, `cfCertsUrl`, `fetchImpl`, `platform = process.platform`, `outputLimitBytes`, `keepRuns`, `sseHeartbeatMs = 15000`, `extraEnv = {}`.
- Al crear: `store.recoverOrphans()` (antes de atender la primera petición: se guarda la promesa y `handle` la espera).
- `authLogin`/`authSetup`: `sessions.create({ reauthAt: now() })`.
- Ruta `POST /api/auth/reauth` en `routeAuth`: exige sesión (`401`), `limiter.check(ip)` (`429`), `verifyPassword` → `markReauth` + `204` / `limiter.recordFailure` + `401 { error: 'Contraseña incorrecta' }`; audita `auth.reauth` con `result` `ok`/`rejected` (sin la contraseña).
- `server.on('close', () => workApi.close())` → `runs.cancelAll()`.

### 5.15 `lib/registry.js` (cambios)

- `PATCHABLE_FIELDS` añade `allowedCommands` y `testCommand`; `PATCH_ERRORS` con los textos de §4.4; `patchValue('allowedCommands')` normaliza (recorte, colapso de espacios, sin duplicados) y valida; `patchValue('testCommand')` admite `''` o `parseCommandLine(...).ok`.
- `isHttpUrl(value)`: `''` válido; si no, `new URL(value)` con `protocol` `http:`/`https:`. Se aplica en `validateNewProject` y en `patchValue('appUrl'|'repoUrl')` → `{ ok: false, status: 400, error: 'La URL debe empezar por http:// o https://', field }`.
- `normalizeSettings` añade `allowedCommands` (array filtrado por `isValidAllowedCommand`) y `testCommand` (cadena o `''`). **Nota:** `normalizeSettings` ya conserva el resto de campos con `...source`.

### 5.16 `lib/sessions.js` (cambios)

`load()` conserva `reauthAt` finito; `create({ reauthAt } = {})` lo guarda si se pasa; `markReauth(id)` → `session.reauthAt = now()` + `persist()`; `verify` lo devuelve dentro de la sesión. Sin más cambios de formato.

### 5.17 `server.js`

Pasa `allowExec`, `maxRuns`, `runTimeoutMs`, `claudeCommand: resolveClaudeCommand(config.claudeBin, { platform: process.platform, env: process.env, execPath: process.execPath, exists })`, `bashBin`, `cfAccess` a `createApp`; añade `work` a `buildStartupLines`; en `SIGINT`/`SIGTERM` cierra el servidor (cancela runs) y sale.

## 6. Frontend

### 6.1 Estructura

- **Portada:** `<section id="attention" class="attention" hidden>` dentro de `#list-view`, antes de `#projects`, rellenada con `renderAttention` desde `GET /api/attention` en cada carga.
- **Detalle:** dos pestañas `Resumen` (lo de la fase 3) y `Trabajar` (`renderWorkView`). En "Trabajar": caja de mensaje (`<textarea name="prompt" maxlength="20000">`), selector de sesión, botón "Enviar"; fila `.work-actions` con los botones SDD/tests/cambios/commit; panel `.run-log` con los eventos del run actual y botón "Cancelar"; historial (`renderRunList`); formulario "Ajustes de ejecución" (`allowedCommands` uno por línea, `testCommand`) con confirmación.
- **Diálogos:** `<dialog id="confirm-dialog">` (texto de `describeAction` + "Confirmar"/"Cancelar") y `<dialog id="reauth-dialog">` (contraseña, "Confirmar", "Cancelar"; mensaje de error en `role="alert"`).
- **CSS nuevo:** `.attention`, `.work-actions`, `.run-log` (monoespaciado, `overflow-wrap: anywhere`, `max-height: 60vh; overflow: auto`), `.ev-text`, `.ev-tool`, `.ev-error`, `.ev-output`, `.ev-notice`, `.diff .add` (verde), `.diff .del` (rojo), `.diff .hunk`, `.diff .meta`, `.state-<estado>` para los 7 estados, `dialog` a `min(92vw, 34rem)`. Colores en variables para claro/oscuro.

### 6.2 Funciones puras de `public/work.js`

`renderWorkView(work, { runs, now })`, `renderSessionSelect(sessions)`, `describeAction(action, ctx)`, `renderConfirmDialogBody(text)`, `renderRunEvent(event)`, `renderRunLog(events)`, `renderRunList(runs, now)`, `renderPermissionPrompt(run)`, `buildRetryPayload(run, originalPrompt)`, `renderChanges(changes)`, `renderDiff({ diff, truncated, untracked })`, `renderAttention(attention, now)`, `suggestCommitMessage(work)`, `buildRunPayload(formValues)`, `buildExecSettingsPayload(formValues)`, `isReauthError(err)`, `withReauth(action, { askPassword, reauth })` (ejecuta `action`; si `isReauthError`, pide contraseña, llama a `reauth(password)` y repite `action` una vez; si el usuario cancela, devuelve `null`), `STATE_LABELS`.

Aviso de solo lectura (R81): `execEnabled` falso → `<p class="notice">Las acciones de ejecución están desactivadas en este panel (PANEL_ALLOW_EXEC=0).</p>`; no ejecutable → `<p class="notice">Este proyecto no tiene una carpeta accesible en este PC: no se puede trabajar en él desde el panel.</p>`.

### 6.3 Textos de confirmación (`describeAction`)

| Acción | Texto (los valores entre `<>` se escapan) |
|--------|-------------------|
| `chat` | `Se lanzará Claude Code en <nombre> con el mensaje: «<prompt (máx. 300 + …)>». Sesión: <Nueva conversación \| Continuar la última sesión \| Retomar «<título>»>. Claude puede editar ficheros y ejecutar solo: <lista de comandos autorizados o "git status, git diff y git log">.` |
| `implement` | `Se lanzará Claude Code en <nombre> con «implementa la siguiente tarea pendiente» (nueva conversación). Claude puede editar ficheros y ejecutar solo: <lista>.` |
| `approve-tests` | `Se lanzará Claude Code en <nombre> con «tests aprobados, lanza al reviewer» continuando la última sesión. Claude puede editar ficheros y ejecutar solo: <lista>.` |
| `approve-spec` | `Se cambiará la feature #<id> <slug> de spec_ready a in_progress en feature_list.json de <nombre>. Después podrás lanzar «Implementar siguiente tarea».` |
| `tests` | `Se ejecutará en <nombre>: <effectiveTestCommand>` |
| `commit-push` | `Se ejecutará en <nombre>: git add -A → git commit -m «<mensaje>» → git push (rama <rama>). Nunca se fuerza el push.` |
| `allow-command` | `Se autorizará «<comando>» en <nombre> para Claude y se reintentará la ejecución.` |
| `exec-settings` | `Se guardarán los comandos autorizados (<n>) y el comando de tests de <nombre>.` |

### 6.4 Etiquetas de estado (`STATE_LABELS`)

`queued` → `En cola`, `running` → `En marcha`, `succeeded` → `Terminada`, `failed` → `Fallida`, `cancelled` → `Cancelada`, `timeout` → `Tiempo agotado`, `needs_permission` → `Necesita permiso`.

### 6.5 Flujo en `app.js`

1. Abrir "Trabajar" → `GET /api/projects/:id/work` + `GET /api/projects/:id/runs`; si hay `activeRun`, conectar `EventSource('/api/runs/<id>/events')`.
2. Acción → diálogo de confirmación → `withReauth(() => request(...))` → `202` → `EventSource` → `renderRunEvent` por mensaje (`event.data`) → al `end`, `es.close()`, recargar historial y "Te necesitan".
3. "Cancelar" → `POST /api/runs/:id/cancel` (sin confirmación de contraseña).
4. `needs_permission` → `renderPermissionPrompt` → confirmación `allow-command` → `withReauth(POST /permissions)` → `withReauth(POST /runs con buildRetryPayload)`.
5. "Aprobar spec" `200` → ofrece en el mismo diálogo "Implementar siguiente tarea" (nueva confirmación).
6. El `EventSource` se reconecta solo con `Last-Event-ID`; al cambiar de vista se cierra.

## 7. Flujos clave (secuencias)

**Run de Claude:** `POST /runs` → sesión → `gateExec` → `findMerged` + carpeta existe → valida prompt/sesión → `runs.startClaude` (límites) → `store.create` + evento `prompt` + `state queued` → `spawn` → `state running` → líneas stdout → `createStreamMapper` → eventos → SSE → `exit` → estado final → `result`/`end` → `audit run.end` → `rotate`.

**Confirmación por el túnel:** acción → `401 reauthRequired` → diálogo → `POST /api/auth/reauth` → `markReauth` → repetir acción → `202`.

**Access:** petición por el túnel → `Cf-Access-Jwt-Assertion` → `verify` (claves en caché o `fetch` de `certs`) → válido: sigue al middleware normal (la sesión del panel sigue siendo obligatoria) → inválido: `403`.

## 8. Tests (`node --test`, sin dependencias)

### 8.1 Fixtures

`test/fixtures/fake-claude.js` (Node, sin dependencias):
- Al arrancar añade a `process.env.FAKE_CLAUDE_LOG` (si existe) una línea `{ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid }`.
- Parsea como el CLI real: `--allowedTools` es variádica (consume los argumentos siguientes que no empiecen por `-`); el prompt se lee de stdin (o de un posicional suelto) y, si no hay, escribe en stderr `Error: Input must be provided either through stdin or as a prompt argument when using --print` y sale con 1. Registra también `stdin` y `allowedTools`. El escenario es la primera marca `[[nombre]]` del prompt (por defecto `ok`).

| Escenario | Salida stdout (una línea JSON por elemento) | Código |
|-----------|---------------------------------------------|:---:|
| `ok` | `system/init` (`session_id: "fake-session-1"`, `model: "fake-model"`); `assistant` texto `Voy a revisar el proyecto.`; `assistant` `tool_use` `Edit` (`file_path: <cwd>/src/a.js`); `user` `tool_result` ok; `assistant` `tool_use` `Bash` (`command: "git status"`); `user` `tool_result` ok; `assistant` texto `Hecho.`; `result` (`subtype: "success"`, `is_error: false`, `result: "Hecho."`, `total_cost_usd: 0.0123`, `duration_ms: 1500`, `num_turns: 3`, `session_id: "fake-session-1"`, `permission_denials: []`) | 0 |
| `denied` | `init`; `tool_use` Bash `npm run lint -- --fix` (`id: "tu1"`); `system/permission_denied` (`tool_name: "Bash"`, `tool_use_id: "tu1"`, `tool_input`); `user` `tool_result` `is_error: true`; `assistant` texto; `result` con `permission_denials` = [el de `tu1`, `{ tool_name: "WebFetch", tool_use_id: "tu2", tool_input: { url: "https://example.com" } }]` | 0 |
| `error` | `init`; `result` `is_error: true`, `subtype: "error_during_execution"`, `result: "Algo falló"` | 1 |
| `crash` | stderr `Error: fallo simulado` | 2 |
| `hang` | `init`; lanza un nieto `node -e "setInterval(()=>{},1000)"` y escribe su PID en `FAKE_CLAUDE_LOG` (`{ grandchildPid }`); emite un texto `tick N` cada 100 ms indefinidamente | — |
| `big` | `init`; 200 mensajes `assistant` de 1000 caracteres; `result` éxito | 0 |
| `garbage` | `Invalid API key`, `{ roto`, `{"type":"otro"}`, `{"type":"stream_event"}`, y el final de `ok` | 0 |

`test/fixtures/fake-command.js`: `ok` → stdout `\x1b[32mtodo bien\x1b[0m`, stderr `aviso`, código 0; `fail <n>` → stdout `fallo`, código n; `sleep <ms>` → espera y sale 0.

### 8.2 Helpers

- `helpers.js` → `startApp` añade por defecto `claudeCommand: { file: process.execPath, prefixArgs: [FAKE_CLAUDE] }` y `extraEnv: { FAKE_CLAUDE_LOG: <temporal> }` (devuelve `fakeLog`), sin cambiar el comportamiento de los tests existentes.
- `work-helpers.js`: `waitForRun(app, cookie, runId, { states, timeoutMs })` (sondea `GET /api/runs/:id`), `readSse(url, { cookie, headers, until })` (lee con `fetch` y parsea `id`/`data`/comentarios), `makeAccessKeys()` (`crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })` + JWK con `kid`), `startCertsServer(jwks)` (servidor `http` local que cuenta peticiones), `makeJwt(privateKey, header, payload)`, `tunnelHeaders()` → `{ 'CF-Connecting-IP': '203.0.113.7' }`, `readFakeLog(file)`.
- Para tiempos: `makeClock` (fase 2) para la confirmación; los runs usan tiempos reales cortos (`runTimeoutMs: 300`, `sseHeartbeatMs: 50`).

### 8.3 Reparto

| Fichero | Cubre |
|---------|-------|
| `config.test.js` (ampliar) | R1, R2 (parte unitaria), R3 |
| `claude-cli.test.js` | R7–R16, R65 (unitarios), R9 (estático) |
| `exec-utils.test.js` | R28, R31, R52, R53, R54 |
| `run-store.test.js` | R34, R35, R37 |
| `runs-api.test.js` | R17–R27, R29, R30, R32, R33, R36, R38–R43 |
| `sdd-actions.test.js` | R44–R49 (R47/R49 unitarios + integración) |
| `work-api.test.js` | R4–R6, R50, R51, R55–R60, R62–R64, R66 (integración), R78, R79 |
| `reauth-api.test.js` | R67–R70, R74, R2 (integración) |
| `cf-access.test.js` | R71–R73 |
| `audit.test.js` | R75–R77 |
| `work-render.test.js` | R80–R89 |
| `render.test.js` (ampliar) | R90 |
| `styles.test.js` (ampliar) | R91 |
| `registry.test.js` (ampliar) | R62, R66 (unitarios) |
| `git-info.test.js` (ajustar) | R61 |
| `claude-discovery.test.js` (ampliar) | R92 |
| `deploy.test.js` (ampliar) | R93, R94 |
| `auth.test.js` / `sessions` (ampliar) | R68 (persistencia de `reauthAt`) |
| Comprobación manual (T36, T37) | R95–R99, anotadas en `docs/verification.md` |

Los tests que necesitan git real usan `hasGit()` y se saltan si no hay git; los de procesos (cancelación, nieto) se saltan en Windows (`process.platform === 'win32'`) porque allí se cubren manualmente (R97).

### 8.4 Compatibilidad con los tests existentes

- `git-info.test.js` → "[R12] GIT_COMMANDS es la lista cerrada…": la entrada de estado pasa a `['--no-optional-locks', 'status', '--porcelain']` (cambio declarado, mejora M4). El `runner` espía que solo admite comandos de la lista sigue valiendo.
- `claude-discovery.test.js` → si algún test fija un `summary` de más de 80 caracteres como título literal, se actualiza a la versión recortada (cambio declarado, mejora M1).
- `api.test.js`/`claude-api.test.js`: cualquier `appUrl`/`repoUrl` usada en altas o `PATCH` es `http(s)` o vacía (revisado: lo son).

## 9. Ficheros que NO se tocan

- `panel/lib/path-key.js`, `panel/lib/rate-limit.js`, `panel/lib/http-utils.js`, `panel/lib/project-state.js`, `panel/lib/project-catalog.js`, `panel/lib/auth.js`, `panel/lib/public-url.js`, `panel/lib/tunnel.js`, `panel/lib/network.js`, `panel/public/app-config.js`, `panel/projects.json`, `panel/scripts/`, `panel/deploy/install-service.ps1`, `panel/deploy/cloudflared-config.example.yml`, `panel/legacy/`.
- `panel/lib/claude-discovery.js` salvo la línea del título (M1). **Nada** escribe en `~/.claude` ni en `~/.claude.json` (el panel solo lanza el CLI, que es quien escribe sus propias sesiones).
- `.claude/`, `CLAUDE.md`, `AGENTS.md`, `CHECKPOINTS.md`, `sdd-lint.js`, `init.sh`, `docs/specs.md`, `docs/constitution.md`, `docs/conventions.md`, `docs/context_map.json`, specs de las fases 1–3.
- `docs/acceso-web.md`: solo se **añade** la sección 9 al final y filas a la tabla de variables de §5; no se reescribe lo existente.
- `feature_list.json` y `progress/` los gestiona solo el leader.

## 10. Alternativas consideradas y descartadas

| Alternativa | Por qué se descarta |
|-------------|---------------------|
| WebSockets para la salida en vivo | Bidireccional innecesario, implementación del protocolo a mano sin dependencias y peor reconexión; SSE basta y reconecta con `Last-Event-ID`. |
| Ofrecer una shell o terminal libre | Fuera de alcance por decisión del humano; anularía el modelo de permisos acotados. |
| `--dangerously-skip-permissions` / `bypassPermissions` | Prohibido por el humano: Claude podría ejecutar cualquier cosa desde el móvil. |
| `--permission-mode dontAsk` / `auto` | `dontAsk` deniega también ediciones fuera de la lista; `auto` delega en un clasificador en lugar de en la lista explícita que pidió el humano. |
| Agent SDK (TypeScript/Python) en lugar del CLI | Añade dependencias npm y otra autenticación (clave de API); el CLI ya está instalado con la sesión del humano. |
| `--permission-prompt-tool` (servidor MCP propio para aprobar en vivo) | Exige montar un servidor MCP y mantener el proceso esperando; el flujo "termina → Permitir → reintentar" es más simple y auditable. |
| Bibliotecas JWT de npm (`jose`, `jsonwebtoken`) | Regla "cero dependencias"; `node:crypto` verifica RS256 con JWK de forma nativa. |
| Lanzar comandos con `shell: true` (para `.cmd`, tuberías) | Abre la puerta a la inyección; se usa el parser propio y la sustitución de `npm`/`npx`. |
| Reescribir `feature_list.json` con `JSON.stringify(…, null, 2)` | Alteraría formatos distintos (BOM, `\r\n`, orden, escapes); la edición por rango solo toca el valor. |
| `reauthAt` solo en memoria | Contradice la decisión del humano y obligaría a reconfirmar tras cada reinicio del panel aunque se acabe de iniciar sesión. |
| Cola de espera cuando se alcanza `maxRuns` | Complica el modelo y el humano no vería por qué no arranca; se responde `429` y la UI lo explica. |
| Pasar el prompt por stdin | Igual de robusto, pero el humano pidió el prompt como argumento; el riesgo de opciones se cubre con el espacio inicial (R11). |

## 11. Riesgos y notas de implementación

- **Versión del CLI:** `--permission-prompts none` (v2.1.259+) no se usa: en `-p` sin anfitrión las peticiones se deniegan igual. Si una versión antigua no emite `system/permission_denied`, las denegaciones siguen llegando por `result.permission_denials`. Todo está en `CLI_FLAGS` (§5.2).
- **`--continue` y sesiones `-p`:** la doc indica que `claude -p --continue` sí incluye las sesiones creadas con `-p`, así que "Continuar la última sesión" retoma también la última conversación lanzada desde el panel.
- **Hooks del proyecto:** sin `--bare`, el CLI ejecuta los hooks de `.claude/settings.json` del proyecto; es deseable (son los del propio humano) y se documenta en `docs/architecture.md`.
- **Procesos en Windows:** `spawn` con `detached: false` y `taskkill /T /F` por PID; los tests de árbol de procesos se saltan en Windows y se cubren con R97.
- **SSE y compresión:** no se comprime la respuesta; `X-Accel-Buffering: no` y el latido mantienen viva la conexión a través de Cloudflare (que corta conexiones inactivas a los 100 s).
- **Concurrencia en `index.json`:** todas las escrituras de un proyecto pasan por una cola de promesas; `find(runId)` lee índices sin cerrojo (solo lectura).
- **Tamaño de `GET /api/runs/:runId`:** hasta 5 MB de eventos; aceptable para un solo usuario. La UI pinta como mucho los últimos 2000 eventos y avisa.
- **Mensajes de commit con saltos de línea:** se admiten (el array de `execFile` los pasa tal cual); solo se rechaza NUL.
- **`git push` y credenciales:** `GIT_TERMINAL_PROMPT=0` y `GCM_INTERACTIVE=never` evitan esperas; un push sin credenciales termina `failed` con la salida de git visible.
- **Rutas con caracteres especiales:** `status -z` evita el entrecomillado de git; la comparación del fichero pedido es exacta sobre esa lista, así que no hay recorrido de rutas.
- **Auditoría y disco:** `audit.log` rota a 5 MB con una copia; los runs rotan a 200 por proyecto (≤ ~1 GB en el peor caso teórico de 200 × 5 MB; en la práctica mucho menos).
