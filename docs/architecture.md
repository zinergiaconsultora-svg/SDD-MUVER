# docs/architecture.md — Arquitectura del proyecto

> **¿Qué es esto, en cristiano?** Cómo se organizan las piezas grandes de la app y
> cómo se hablan entre ellas. El "plano de estructura" de la casa. Lo rellena el
> Analista contigo en la Fase A (a ti te pregunta cosas de negocio y traduce; lo
> técnico lo propone él y te lo explica).

## Tipo de aplicación
> Ej: web, app móvil, API, herramienta de escritorio, CLI…

- **Aplicación web local ("Puesto de Mando MUVER")**: un pequeño servidor que corre en el
  ordenador del humano y una página web que se abre desde el navegador del PC o del móvil
  (misma red Wi-Fi). Muestra el estado real de todos los proyectos desarrollados con Claude
  Code (app-flyder, appcc-real, crm-zinergia, app-finanzas-restaurante y los que se añadan).
- Se construye en fases (ver `feature_list.json`): fase 1 lectura + alta/baja de proyectos (hecha);
  fase 2 acceso web seguro desde Internet con contraseña y Cloudflare Tunnel (hecha); fase 3 descubrimiento
  automático de los proyectos abiertos en Claude Code (hecha); fase 4 **trabajar desde el panel** (esta):
  hablar con Claude Code (lanzado en el PC con permisos acotados), botones del flujo SDD, ejecutar tests, ver
  cambios, commit y push, salida en vivo e historial, y la cola "Te necesitan"; después visual/avisos (fase 5).

## Piezas principales (a alto nivel)
> Ej: una base de datos, un servidor/backend, una interfaz/frontend, integraciones externas.

- **Base de datos:** no hay. El registro de proyectos es un fichero JSON; desde la corrección T36 de la fase 4 el
  registro **vivo** es `<datos>/projects.json` (`panel/data/`, ignorado por git): al arrancar, si no existe, se copia
  una vez el heredado `panel/projects.json` (consola: `Registro de proyectos migrado a <ruta>`) o, si tampoco existe,
  `panel/projects.example.json` (los 4 proyectos de ejemplo). La app ya no escribe en `panel/projects.json`, que
  queda versionado solo como semilla heredada y el humano puede borrar cuando quiera. Cada entrada tiene
  (`id`, `name`, `path` local absoluta, `appUrl`, `repoUrl` opcional, `tags` opcional y, desde la fase 3,
  `hidden` y `pinned` opcionales), editable a mano. Desde la fase 3 es una **capa de ajustes**: se fusiona por
  ruta con los proyectos detectados en Claude Code y sigue admitiendo proyectos manuales. El estado de cada
  proyecto no se guarda: se lee de su disco en cada petición.
- **Datos de Claude Code (fase 3, SOLO LECTURA):** `<claudeHome>/.claude.json` (claves `projects` → rutas y
  `history` → último prompt) y `<claudeHome>/.claude/projects/<ruta codificada>/<sesión>.jsonl` (título, fechas,
  rama y recuentos de cada sesión; nunca el contenido completo). `claudeHome` = `CLAUDE_HOME_DIR` o la carpeta
  del usuario (`%USERPROFILE%`). El panel **nunca escribe** en `~/.claude` ni en `~/.claude.json`:
  `lib/claude-discovery.js` solo importa funciones de lectura y un test estático lo comprueba.
- **Caché en memoria (fase 3, excepción a "sin caché"):** solo para los datos de Claude Code. Por fichero de
  sesión (clave ruta + `mtime` + tamaño, sin releer lo que no cambia) y TTL de 30 s para el escaneo completo.
  El estado de disco de cada proyecto (SDD, progreso, git) se sigue leyendo en cada petición.
- **Directorio de datos (fase 2):** `panel/data/` (o `PANEL_DATA_DIR`), ignorado por git, con escritura
  atómica (`.tmp` + `rename`). Contiene `auth.json` (hash scrypt de la contraseña única, `salt`, `params`,
  `sessionSecret` para firmar cookies), `sessions.json` (lista blanca de sesiones con `createdAt`,
  `lastSeenAt`, `expiresAt` en ms; caducidad deslizante de 30 días), `public-url.txt` (URL pública del túnel),
  `panel.log` y `cloudflared.log`. Fase 4: `runs/<projectId>/index.json` (historial de ejecuciones: `RunMeta`,
  más reciente primero, máx. 200 por proyecto) y `runs/<projectId>/<runId>.jsonl` (eventos de cada ejecución, el
  prompt completo incluido), `audit.log` (una línea JSON por acción de ejecución: quién, desde dónde, qué y con qué
  resultado; nunca contraseñas, cookies, tokens ni más de 120 caracteres del prompt; rota a 5 MB → `audit.log.1`)
  y, en `sessions.json`, `reauthAt` (última confirmación de la contraseña).
- **Backend / lógica:** `panel/server.js` + `panel/lib/` (Node.js, módulos nativos `http`,
  `fs`, `path`, `child_process`, `os`, `crypto`). Lee por proyecto `feature_list.json`,
  `progress/current.md` y git (rama, último commit, cambios sin commitear), calcula el
  semáforo (`atencion` > `en_curso` > `inactivo` > `ok`; `no_encontrado` si la ruta no existe)
  y expone una API JSON. En fase 2 añade autenticación (`lib/auth.js` scrypt, `lib/sessions.js` cookies
  firmadas HMAC-SHA256, `lib/rate-limit.js` 5 fallos/15 min por IP, `lib/config.js` variables de entorno,
  `lib/public-url.js` y `lib/tunnel.js` para Cloudflare Tunnel) y los scripts `scripts/reset-password.js`
  y `scripts/run-tunnel.js`. En fase 3: `lib/path-key.js` (claves de ruta Windows/POSIX sin `path.resolve`),
  `lib/claude-discovery.js` (descubrimiento de solo lectura con caché) y `lib/project-catalog.js` (fusión con
  `projects.json`, ids estables `slug`/`slug-2`, ocultos y orden: fijados → actividad → nombre).
  En fase 4 (rutas nuevas en `lib/work-api.js`, que `lib/app.js` solo conecta):
  - `lib/claude-cli.js`: llamada a **Claude Code CLI** (`claude -p --output-format stream-json --verbose
    --permission-mode acceptEdits [--continue | --resume <id>] --allowedTools <reglas>`, con el prompt por **stdin**:
    `--allowedTools` es variádica en el CLI real y se tragaba un prompt posicional — corrección tras la prueba T36), con todas las
    flags en `CLI_FLAGS`, reglas `Bash(<cmd> *)` **y** `PowerShell(<cmd> *)` por cada comando (corrección T36: en
    Windows Claude Code usa también la herramienta PowerShell), la lista por defecto (lectura/edición + `git status/diff/log`) más los
    `allowedCommands` del proyecto, y el traductor del stream-json a eventos. **Nunca** se salta los permisos
    (lista `FORBIDDEN_ARGS` + test estático). Sin `--bare`: el CLI ejecuta los hooks y el `CLAUDE.md` del propio
    proyecto, como en la terminal.
  - `lib/runs.js` (gestor de runs en memoria: estados `queued` → `running` → `succeeded`/`failed`/`cancelled`/
    `timeout`/`needs_permission`, un run por proyecto y `PANEL_MAX_RUNS` en total, límite de tiempo, límite de
    salida de 5 MB y cancelación del **árbol de procesos**: `taskkill /T /F` en Windows, grupo de procesos en
    POSIX), `lib/run-store.js` (historial en disco), `lib/command-runner.js` (pasos en serie de "Ejecutar tests" y
    "Commit y push"), `lib/exec-utils.js` (parser propio de líneas de comando, `.cmd`/`.bat` rechazados, `npm`/`npx`
    → `node npm-cli.js`, Git Bash en Windows), `lib/sse.js` (salida en vivo), `lib/sdd-actions.js` (botones SDD;
    "Aprobar spec" edita **solo** el valor del `status` en `feature_list.json`, byte a byte), `lib/git-actions.js`
    (cambios, diff y commit/push con argumentos fijos y `--no-optional-locks`, nunca forzado),
    `lib/reauth.js` (confirmación de la contraseña por el túnel), `lib/cf-access.js` (verificación del JWT de
    Cloudflare Access con `node:crypto`) y `lib/audit.js` (registro de auditoría).
  - Feature 14: `lib/trusted-bin.js` (resolvedor de ejecutables de confianza; ver "Seguridad de la ejecución").
    "Aprobar spec" responde `409` si hay un run activo en el proyecto.
- **Feature 13 (vista compacta y resumen):**
  - `projects.json` admite por entrada `summary`, `summarySource` (`manual` | `claude`) y `summaryAt` (resumen guardado,
    1–200 caracteres) y `model` (modelo recordado: `haiku` | `sonnet` | `opus`; ausente = por defecto). `normalizeSettings`
    quita los no válidos.
  - `lib/project-summary.js`: resumen automático sin coste y **solo lectura**: `description` de `package.json` → primer
    párrafo de texto del README (`README.md`, `.markdown`, `.txt`, `README`, `LEEME.md`) → primer párrafo de `CLAUDE.md`;
    lectura acotada a 16 KB por fichero, plantillas descartadas, primera frase o 160 caracteres cortados en palabra sin
    «…»; caché en memoria de 5 min por carpeta. Orden total: `manual` → `claude` → `package` → `readme` → `claude-md`.
  - `lib/repo-layout.js`: clasifica cada carpeta en principal / worktree / ninguno con
    `git --no-optional-locks rev-parse --git-dir --git-common-dir` (entrada nueva `CMD_REPO_LAYOUT` de la lista cerrada
    `GIT_COMMANDS`), siempre por el **runner central** de la feature 14 (git de confianza + `GIT_SAFE_PREFIX`, sin
    consultar filtros); caché de 10 min por carpeta; una carpeta inexistente no lanza git. `likelyWorktree` marca (sin
    agrupar) las carpetas `<slug>-<hex6>` ya borradas con sesión en `claude/<carpeta>`.
  - `lib/project-catalog.js`: anota `isWorktree`, `parentId`/`parentName`, `groupKey`/`groupName` (`g-` + 10 hex de la
    ruta del principal, sin exponer la ruta), `worktreeCount` y `detailLevel`; los worktrees agrupados se calculan en
    **modo ligero** (sin git, rama de la última sesión de Claude) salvo con `?worktrees=full`; el detalle de un principal
    trae `worktrees[]` (git real en los 30 primeros).
  - `lib/summary-api.js`: generación del resumen con Claude Code en **solo lectura** (individual y en lote en el
    servidor, de uno en uno, con reintento cada 5 s si se alcanzó `PANEL_MAX_RUNS`, cancelación y estado en memoria).
  - `public/list.js` (funciones puras): preferencias (`localStorage` `muver.listPrefs`), agrupación, modelo y marcado de
    fila, filtros, "Antiguos", repintado por firma HTML (`planRowUpdate`), candidatos y textos del lote.
- **Interfaz / frontend:** `panel/public/` (index.html, styles.css, app.js, render.js, api-client.js,
  app-config.js) en vanilla JS, mobile-first (usable a 360 px), tema claro/oscuro automático
  (`prefers-color-scheme`), `manifest.webmanifest` para "añadir a pantalla de inicio". Pantallas de
  creación de contraseña, login y cambio de contraseña integradas con los mismos estilos; botones
  "Salir" y "Cambiar contraseña"; URL pública visible en el encabezado (también sin sesión). Fase 3: distintivo
  "Claude Code", línea de última sesión, botones fijar/ocultar, enlace "Mostrar ocultos (N)", sesiones recientes
  y formulario de ajustes en el detalle, y aviso discreto si no se detecta Claude Code. Fase 4: `public/work.js`
  (funciones puras) con la pestaña **"Trabajar"** del detalle (caja de mensaje con selector de sesión, botones
  "Implementar siguiente tarea", "Aprobar tests", "Aprobar spec", "Ejecutar tests", "Ver cambios", "Commit y push",
  salida en vivo con `EventSource`, "Cancelar", historial y "Ajustes de ejecución"), la sección **"Te necesitan"**
  en la portada, el diálogo de confirmación (`<dialog>`) que dice exactamente qué se va a ejecutar y el diálogo de
  contraseña cuando la API responde `reauthRequired`.
- **Servicios externos:** el CLI `claude` instalado en el PC del humano (con su sesión iniciada) lo lanza el panel
  en la carpeta del proyecto (fase 4). `git` del sistema se invoca localmente con argumentos fijos. GitHub solo
  como enlace (`repoUrl`). Para el acceso desde Internet se usa **Cloudflare Tunnel** (`cloudflared`):
  camino principal con URL temporal gratuita `*.trycloudflare.com` (sin cuenta ni dominio) y opción
  avanzada con dominio propio (`panel/deploy/cloudflared-config.example.yml`). El túnel es saliente:
  sin abrir puertos ni IP fija. Guía: `docs/acceso-web.md`.
- **Arranque automático (Windows):** dos tareas programadas nativas (`Register-ScheduledTask`,
  `panel/deploy/install-service.ps1`): `PuestoDeMandoMUVER` (`node server.js`) y
  `PuestoDeMandoMUVER-Tunnel` (`node scripts/run-tunnel.js`), disparadores `AtStartup` + `AtLogOn`,
  `MultipleInstances IgnoreNew`, principal = usuario actual con `LogonType S4U`, salida a `panel/data/panel.log`.

## Tecnologías
> Lenguajes, frameworks, hosting. Si no tienes criterio, el Analista propone y explica.

- **Lenguaje(s):** JavaScript (Node.js >= 18, ES Modules) en servidor y navegador.
- **Framework(s):** ninguno. Sin bundler, sin dependencias npm. Tests con `node:test` + `node:assert`.
- **Base de datos:** ninguna (fichero JSON `<datos>/projects.json`; ejemplo versionado en `panel/projects.example.json`).
- **Hosting / despliegue:** el PC Windows del humano. `cd panel && npm start` escucha en `0.0.0.0:4310`
  (variable `PORT`) e imprime las URLs de acceso (localhost e IP de la red local), el directorio de datos,
  si la contraseña está configurada y la URL pública si existe. Publicación HTTPS mediante Cloudflare
  Tunnel y arranque con el PC mediante tareas programadas (ver `docs/acceso-web.md`). Variables:
  `PORT`, `PANEL_DATA_DIR`, `PANEL_SECURE_COOKIES`, `PANEL_TRUST_PROXY`, `CLOUDFLARED_BIN` y (fase 3)
  `CLAUDE_HOME_DIR` (carpeta que contiene `.claude.json` y `.claude/`; por defecto la del usuario). Al arrancar
  imprime también `Claude Code: detectado en … (N proyectos, M sesiones)` o `Claude Code: no detectado en …`.
  Fase 4: `PANEL_ALLOW_EXEC` (interruptor general; `0`/`false` = solo lectura), `PANEL_MAX_RUNS` (1–10, por
  defecto 2), `PANEL_RUN_TIMEOUT_MIN` (1–240, por defecto 30), `CLAUDE_BIN` (ejecutable de Claude Code; por
  defecto `claude`, buscado en el `PATH`, en `%USERPROFILE%\.local\bin` o como paquete npm), `PANEL_BASH_BIN`
  (bash para `init.sh`; en Windows se busca Git Bash), `PANEL_CF_ACCESS_TEAM` y `PANEL_CF_ACCESS_AUD` (Cloudflare
  Access). Al arrancar imprime `Ejecución desde el panel: activada (máx. N a la vez, límite M min)` (o
  desactivada) y el estado de Cloudflare Access.

## Cómo se comunican las piezas
> Una frase o un esquema simple. Ej: "el frontend pide datos al backend por una API; el backend guarda en la base de datos".

- El navegador (PC o móvil) carga `panel/public/` desde el servidor (estáticos públicos) y pide JSON a la API:
  `GET /api/auth/status` (público: `configured`, `authenticated`, `publicUrl`), `POST /api/auth/setup`
  (primera contraseña), `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`;
  `GET /api/projects` (listado con estado resumido; fase 3: catálogo fusionado, ordenado y sin ocultos salvo
  `?includeHidden=1`), `GET /api/projects/:id` (detalle; fase 3: con las 20 sesiones de Claude más recientes),
  `POST /api/projects` (alta, valida que la ruta exista), `DELETE /api/projects/:id` (baja; fase 3: solo
  proyectos manuales, `409` si lo detecta Claude Code), `PATCH /api/projects/:id` (fase 3: ajustes parciales
  `name`, `appUrl`, `repoUrl`, `tags`, `hidden`, `pinned`; sobre un proyecto solo de Claude crea su entrada en
  `projects.json`) y `GET /api/claude/status` (fase 3: si se detecta Claude Code, dónde y cuántos proyectos y
  sesiones).
- **Fase 4 (trabajar):** `GET /api/work/status`, `GET /api/projects/:id/work`, `POST /api/projects/:id/runs`
  (`{ prompt, session? }` → `202` con el `RunMeta`), `POST /api/projects/:id/sdd/implement`,
  `POST /api/projects/:id/sdd/approve-tests`, `POST /api/projects/:id/sdd/approve-spec`, `POST /api/projects/:id/tests`,
  `GET /api/projects/:id/changes`, `GET /api/projects/:id/changes/diff?file=`, `POST /api/projects/:id/git/commit-push`,
  `POST /api/projects/:id/permissions`, `GET /api/projects/:id/runs`, `GET /api/runs/:runId`,
  `GET /api/runs/:runId/events` (**Server-Sent Events**: `id: <seq>` y reconexión con `Last-Event-ID`, latido
  `: ping` cada 15 s), `POST /api/runs/:runId/cancel`, `POST /api/runs/:runId/dismiss`, `GET /api/attention` y
  `POST /api/auth/reauth`. `PATCH /api/projects/:id` admite además `allowedCommands` y `testCommand`, y `appUrl`/
  `repoUrl` solo con `http(s)`. La carpeta de trabajo sale **siempre** del catálogo, nunca del cuerpo de la petición.
- **Feature 13:** `GET /api/projects[?includeHidden=1][&worktrees=full]` añade a cada elemento `summary`,
  `summarySource`, `summaryAt`, `isWorktree`, `parentId`, `parentName`, `groupKey`, `groupName`, `likelyWorktree`,
  `worktreeCount` y `detailLevel` (`light` | `full`); `GET /api/projects/:id` añade `worktrees[]`; `PATCH
  /api/projects/:id` admite `summary` (vacío = vuelve el automático) y `model` sin pasar por la puerta de ejecución;
  `POST /api/projects/:id/runs`, `…/sdd/implement` y `…/sdd/approve-tests` admiten `model` (lista cerrada; `400` si no) y
  lo recuerdan; `GET /api/projects/:id/work` trae `model` y `models`; rutas nuevas
  `POST /api/projects/:id/summary/generate` (puerta `summary.generate`, cuerpo ignorado),
  `POST /api/summaries/generate` (`{ ids }`, 1–50, puerta `summary.batch`), `GET /api/summaries/batch` y
  `POST /api/summaries/batch/cancel` (sin puerta, como cancelar un run). `GET /api/attention` excluye los runs con
  `action: "summary"`.
- **Puerta de ejecución (fase 4):** toda acción de ejecución (lanzar Claude, tests, commit y push, aprobar spec,
  permitir un comando, cambiar los ajustes de ejecución) pasa por `gateExec`: sesión → `PANEL_ALLOW_EXEC` →
  si llega **por el túnel** (cabecera `CF-Connecting-IP`, `Cf-Ray` o `X-Forwarded-Proto: https`, se mire o no
  `PANEL_TRUST_PROXY`) y Cloudflare Access no está configurado, contraseña confirmada en los últimos 15 minutos
  (`401 reauthRequired` → diálogo → `POST /api/auth/reauth`) → validaciones → auditoría. Cancelar nunca se bloquea.
- **Cloudflare Access (fase 4, con dominio propio):** con `PANEL_CF_ACCESS_TEAM` y `PANEL_CF_ACCESS_AUD`, antes
  de todo (estáticos incluidos) las peticiones por el túnel deben traer `Cf-Access-Jwt-Assertion` válido (RS256,
  claves de `https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs` en caché 1 h, `aud`, `iss`, `exp`); si
  no, `403`. La sesión del panel sigue siendo obligatoria. Con solo una de las dos variables, se rechaza todo por
  el túnel. Pasos en `docs/acceso-web.md` §9.
- **Sesión y defensa CSRF:** la autenticación viaja en la cookie `muver_session=<id>.<firma HMAC>`
  (`HttpOnly; SameSite=Lax; Path=/; Max-Age=30 días`, más `Secure` cuando la petición entra por HTTPS a través
  de Cloudflare — `X-Forwarded-Proto: https` — o con `PANEL_SECURE_COOKIES=1`). Toda mutación a `/api/*` (desde la
  fase 3, cualquier método distinto de `GET`/`HEAD`: `POST`, `DELETE`, `PATCH`, `PUT`…) debe llevar
  `X-Requested-With: fetch`, si no → `403`. Orden del middleware: estáticos → cabecera
  anti-CSRF → `/api/auth/*` → el resto exige sesión válida (`401 No autenticado`).
- **Cabeceras del proxy:** con `PANEL_TRUST_PROXY` activo (por defecto) el servidor cree `CF-Connecting-IP`
  (IP del cliente para el límite de intentos) y `X-Forwarded-Proto` (para el atributo `Secure`); con `0` usa
  `remoteAddress` e ignora ambas.
- El servidor, por cada proyecto registrado, lee del disco `feature_list.json`,
  `progress/current.md` y ejecuta `git` (`execFile`, sin shell) en la carpeta del proyecto, y
  devuelve el resultado. Sin caché: cada petición refleja el estado real (salvo los datos de Claude Code,
  cacheados en memoria como se describe arriba).

```
[Móvil con datos / PC remoto] --HTTPS--> [Cloudflare] --túnel saliente (cloudflared)--+
                                                                                     v
[Móvil / PC en la Wi-Fi] --HTTP (LAN)----------------------------------------> [panel/server.js] --fs/git--> [carpeta de cada proyecto]
                                                                                     |
                                                                 panel/data/ (projects.json, auth.json, sessions.json, public-url.txt, runs/, audit.log)
                                                                                     |
                                                     solo lectura --> ~/.claude.json + ~/.claude/projects/*/*.jsonl (Claude Code)
                                                                                     |
                                      fase 4: spawn sin shell, cwd = carpeta del catálogo --> claude -p … / tests / git
                                                    (stream-json → eventos → runs/*.jsonl + SSE al navegador; audit.log)
```

## Seguridad de la ejecución

> Feature 14 (`endurecimiento-ejecucion`, hallazgos M1–M5 y N1–N6 del reviewer de la fase 4). Regla de oro: el panel
> nunca lanza un proceso con un nombre suelto ni con una ruta que esté en la carpeta de un proyecto del catálogo.

1. **Resolución de ejecutables** (`lib/trusted-bin.js`: `createBinaryResolver`, `resolveTrustedBinary`,
   `isTrustedPath`). `git`, `node`, `npm`, `npx`, `claude`, `bash`, `taskkill` y el primer token del comando de tests se
   resuelven a una ruta absoluta buscando solo en las entradas absolutas del `PATH` (se descartan vacías, `.`,
   relativas y con `%`) y en rutas conocidas (`node` = el propio Node del panel, `taskkill` =
   `%SystemRoot%\System32\taskkill.exe`, Git for Windows, `%USERPROFILE%\.local\bin\claude.exe`…); en Windows solo
   `.com`/`.exe`. Se descartan los candidatos (por ruta y por ruta real) del `cwd` de la llamada y de las carpetas del
   catálogo (registro + Claude Code); de un **proyecto contenedor** (raíz, carpeta personal o un ancestro suyo) solo se
   excluye su raíz. La lista de candidatos se guarda en caché (un `PATH` nuevo se ve al reiniciar el panel); la
   exclusión se recalcula en cada llamada. Guardia final: `runs.js` (`guardedSpawn`), el runner de git
   (`createGitRunner`) y `taskkill` solo lanzan rutas de confianza, y en Windows los hijos reciben
   `NoDefaultCurrentDirectoryInExePath=1`. Única excepción: un comando de tests escrito con ruta relativa
   (`./test.sh`, `projectScript`) ejecuta código del proyecto, igual que `bash init.sh`.
2. **Comandos amplios** (`isBroadCommand` en `lib/claude-cli.js`): intérpretes, shells y envolventes a secas o con
   una opción (`node`, `node -e`, `bash -c`, `env`, `xargs`, `find`…), `git` con subcomandos de ejecución
   (`git -c`, `git config`, y desde la corrección de la revisión `git fetch`/`pull`/`push`/`clone`/`ls-remote`/`grep`…),
   cmdlets de PowerShell (`Invoke-Expression`/`iex`, `Start-Process`…), variantes `.cmd`/`.bat`/`.ps1` (`npx.cmd`),
   python con versión (`python3.12`) y `npm`/`pnpm`/`yarn`/`bun` con `exec`, `dlx`, `run` sin script… equivalen a una terminal
   libre. Nunca se proponen tras una denegación; si el humano los añade a mano, la API exige `acknowledgeBroad: true`
   (la interfaz muestra un aviso y el botón "Autorizar de todos modos"), queda `acknowledgedBroad` en `audit.log` y
   "Ajustes de ejecución" avisa mientras estén guardados.
3. **Configuración del repositorio**: toda llamada git del panel lleva `-c core.fsmonitor=false` (lecturas por el
   runner central y pasos de "Commit y push"); el diff usa `--literal-pathspecs` (un fichero llamado `*` es solo ese
   fichero) y `--no-ext-diff --no-textconv` (no ejecuta drivers de diff del repo). Corrección revisión F14 (MA2):
   el prefijo incluye también `-c log.showSignature=false` (si no, el sondeo del listado ejecutaría el `gpg.program`
   del repo al verificar firmas); `gpg.program` no se anula para no romper la firma de commits del humano. Antes de
   cada `status`/`diff` el runner lee los filtros de la configuración local (`git config --local --includes
   --get-regexp ^filter\.`) y los anula con `-c filter.<n>.clean=` (y `smudge`, `process`, `required=false`); los
   filtros globales (git-lfs) se respetan. Se descartó `--attr-source=<árbol vacío>`: `.git/info/attributes` sigue
   aplicándose y además ignoraría los atributos `text`/`eol`.
4. **Hooks**: se ejecutan en "Commit y push" (sin `--no-verify` ni `core.hooksPath` vacío), porque suelen ser del
   humano (lint, tests) y desactivarlos cambiaría el resultado respecto a la terminal; `GET /changes` devuelve
   `hooks` y `hooksPathCustom` y el diálogo de confirmación avisa con sus nombres. **"Commit y push" puede ejecutar
   programas del repo** (corrección revisión F14, M3): filtros `clean`/`smudge` en `git add`, hooks, `gpg.program`
   con `commit.gpgsign`, `core.askPass`/`credential.helper` y `remote.*.receivepack` en el push. `GET /changes`
   devuelve `repoConfig` y el diálogo avisa de los que estén configurados localmente.
5. **Push**: el paso de push lleva `GIT_SSH_COMMAND=ssh -o BatchMode=yes` (una clave con frase o un host desconocido
   fallan al momento) salvo que el entorno del panel ya defina `GIT_SSH_COMMAND` o `GIT_SSH`. Consecuencia: un
   `core.sshCommand` de la configuración de git se ignora en el push del panel; para usar otro ssh, definir
   `GIT_SSH_COMMAND` en el entorno del panel. Si el humano define `GIT_SSH` (y no `GIT_SSH_COMMAND`), el panel no
   añade `GIT_SSH_COMMAND` y un `core.sshCommand` del repo prevalece sobre `GIT_SSH`.
6. **Riesgos conocidos**: (N5) el CLI de Claude aplica también `~/.claude/settings.json` y los
   `.claude/settings*.json` del proyecto, que pueden ampliar los permisos de `--allowedTools`; (N6) desde la red local
   basta la sesión y el panel escucha en `0.0.0.0`: una cookie robada en la LAN da ejecución sin reconfirmar; los
   filtros `clean`/`smudge` de `.gitattributes` + `.git/config` pueden ejecutarse en `git status`/`git add`, y los
   `credential.helper` y hooks en el push (requieren que alguien escriba en `.git/`, que Claude Code protege);
   `cloudflared` se arranca por nombre desde `scripts/` (fuera de la feature 14); los nietos que lance Claude por
   nombre siguen sus propias reglas de búsqueda; (N3) con la carpeta personal (proyecto contenedor) en el catálogo,
   Claude puede escribir en `~/.local/bin` y el panel usaría ese ejecutable tras reiniciarse si esa carpeta va antes en
   el `PATH` (mismo riesgo que `~/.bashrc` o la carpeta Inicio); la lista de comandos amplios es una lista negra
   inevitablemente incompleta (`npm install <url>` ejecuta scripts de ciclo de vida y `npm run x` código editable del
   proyecto); (N5) las reglas por defecto `git diff *`/`git log *` admiten `--output=<fichero>` (escriben ficheros) y
   las reglas por prefijo no permiten excluir opciones: queda para una revisión de las reglas por defecto. Además, el run tiene un límite de salida de 5 MB que cuenta todos los
   eventos (salvo `state`/`end`) y guarda como mucho 50 denegaciones de permiso.

## Restricciones y decisiones de arquitectura
> Cosas que condicionan: "debe funcionar en móvil", "un solo usuario admin", "tiene que integrarse con X"…

- Debe funcionar en el móvil desde la red local (responsive a 360 px, PWA mínima).
- Un solo usuario (el humano) con **una única contraseña** (10–128 caracteres, hash scrypt N=16384,
  sin usuarios ni roles); límite de intentos en memoria (5 fallos → 15 min de bloqueo por IP, `429`);
  cambio de contraseña revoca las demás sesiones; rescate solo desde el PC con `npm run reset-password`.
  Fuera de la red local el panel se publica únicamente a través de Cloudflare Tunnel (HTTPS).
- El servidor **no ejecuta comandos arbitrarios** ni ofrece shell o terminal libre. Desde la fase 4 solo lanza,
  siempre con `spawn`/`execFile` **sin shell** y con los argumentos en un array: Claude Code con
  `--permission-mode acceptEdits` y la lista autorizada de herramientas (las de lectura/edición, `git status/diff/log`
  y los `allowedCommands` del proyecto; nunca `--dangerously-skip-permissions` ni `bypassPermissions`; lo no
  autorizado se deniega y la interfaz ofrece "Permitir en este proyecto y reintentar"), el comando de tests
  configurado (o `bash init.sh`) parseado por un parser propio sin significado especial para `|`, `&`, `;`, `>`…,
  y los pasos fijos de `git add -A` → `git commit -m <mensaje>` → `git push` (nunca forzado). Cada acción pide
  confirmación en la interfaz y queda en `audit.log`; `PANEL_ALLOW_EXEC=0` lo desactiva todo.
- **Feature 13 — resúmenes con Claude en solo lectura:** el run de resumen usa el mismo resolvedor de confianza y
  `guardedSpawn` de la feature 14 (`workApi.startReadOnlyClaude` → `runs.startClaude({ profile: 'readonly' })`) con
  `--model haiku --permission-mode default --max-turns 10 --tools Read,Glob,Grep --disallowedTools
  Bash,PowerShell,Edit,MultiEdit,Write,NotebookEdit,WebFetch,WebSearch,Task,Agent,mcp__* --allowedTools Read,Glob,Grep`
  (la última) y un prompt fijo por stdin: nunca edición, `acceptEdits`, `Bash` ni `PowerShell`; nunca automático (solo
  cuando el humano lo pide y confirma). Ningún módulo nuevo llama a `spawn`/`execFile`, nada escribe en las carpetas de
  los proyectos ni en `~/.claude`.
- **Feature 13 — selector de modelo:** `CLI_MODELS` = `haiku`, `sonnet`, `opus` (lista cerrada en `claude-cli.js`);
  `--model <alias>` solo con un valor de la lista, justo antes de `--allowedTools`; "Por defecto" no pasa la flag. El
  modelo se recuerda por proyecto en `model` del registro y se guarda en `RunMeta.model` (`null` = por defecto).
- **Feature 13 — "Te necesitan":** los runs de resumen nunca aparecen en la cola (ni fallidos); se ven en el historial
  del proyecto y en el estado del lote. Ajuste de la revisión visual (R62): un worktree cuyo principal está en la lista
  no genera entrada propia por spec lista o bloqueo; la alerta común se muestra una vez y las distintas se suman en
  `tasksAwaiting` del principal ("N tareas en curso esperan tu aprobación"); sus runs siguen apareciendo.
- **Feature 13 — regla "nada recortado":** ningún texto de la lista, las tarjetas ni el detalle se oculta con «…»,
  `text-overflow`, `line-clamp` ni `max-height`; los resúmenes se acotan en origen (una frase, cortada en palabra
  entera) y la fila crece si hace falta (una fila con resumen de una línea mide ≤ 72 px en escritorio).
- No se exponen rutas absolutas del disco al cliente más allá de lo necesario. Nunca se registran
  contraseñas ni cookies en los logs; los secretos viven solo en `panel/data/` (fuera de git).
- El equipo del humano es Windows (rutas `C:\...`): el código debe ser portable (usar
  `path.resolve`, `execFile`); los tests crean repos temporales en `os.tmpdir()`.
- Si un proyecto no tiene arnés SDD o no es repo git, la interfaz lo muestra como tal, no falla.
- Todo lo del panel vive en `panel/`; el arnés SDD del repo (`.claude/`, `docs/`, `specs/`,
  `progress/`, `feature_list.json`, `sdd-lint.js`) no se modifica salvo `init.sh` (paso de tests)
  y la tabla de trazabilidad de `docs/verification.md`.
- El `muver.html` previo del humano se guardará, cuando lo aporte, en `panel/legacy/muver.html`
  como referencia para migrar lo que aporte.
