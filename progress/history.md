# Historial

> **¿Qué es esto?** El registro de TODO lo que se ha ido completando, en orden. Solo se
> AÑADE (no se borra). Es la memoria a largo plazo del proyecto: qué se hizo, cuándo y
> qué cambió. Cuando una feature pasa a `done`, su resumen se mueve aquí.

---

<!-- Formato sugerido por entrada:

## [fecha] · Feature N: <nombre>
- **Qué se hizo:** ...
- **Ficheros cambiados:** ...
- **Requisitos cubiertos:** R1, R2, ...
- **Tests añadidos:** ...
- **Notas / decisiones:** ...

-->

## 2026-10-25 · Feature 1: puesto-de-mando-base (Puesto de Mando MUVER, fase 1)
- **Qué se hizo:** Panel web local en `panel/` que lista los proyectos registrados,
  lee su estado real en disco (feature_list.json, progress/current.md, git), muestra
  tarjetas con semáforo (atencion / en_curso / inactivo / ok / no_encontrado), acceso
  directo a cada app, vista de detalle, alta y baja de proyectos desde la interfaz,
  escucha en la red local (0.0.0.0:4310), diseño mobile-first con tema claro/oscuro y
  manifest para "añadir a pantalla de inicio".
- **Ficheros cambiados:** `panel/**` (nuevo: server.js, lib/, public/, test/,
  projects.json, package.json), `init.sh` (ejecuta `npm test` del panel),
  `docs/verification.md` (trazabilidad), `docs/architecture.md` (arquitectura).
- **Requisitos cubiertos:** R1–R37 (`specs/puesto-de-mando-base/requirements.md`).
- **Tests añadidos:** 83 tests con `node:test` en `panel/test/` (registry, git-info,
  project-state, network, api, render, styles). `bash init.sh` en verde.
- **Notas / decisiones:** Node >= 18 sin dependencias; ESM; `git` solo vía `execFile`
  con argumentos fijos; sin autenticación (solo red de confianza) hasta la fase 2.
  Pendiente del humano: T27 (verificación manual en Windows/móvil), rutas reales y
  `appUrl` en `panel/projects.json`, y aportar `muver.html` para `panel/legacy/`.
  Mejoras anotadas por el reviewer (no bloqueantes): `detectBlock` solo lee la misma
  línea de "Bloqueos / esperando"; mensaje específico si `projects.json` está corrupto;
  subdirectorio de un repo padre muestra el repo padre. Revisión completa en
  `progress/review_puesto-de-mando-base.md`.

## 2026-10-25 · Feature 2: puesto-de-mando-acceso-web (Puesto de Mando MUVER, fase 2)
- **Qué se hizo:** Acceso al panel desde Internet con contraseña única (scrypt),
  sesiones firmadas por cookie (30 días, renovación deslizante), límite de intentos
  (5 fallos → 15 min), anti-CSRF por cabecera, toda la API protegida; pantallas de
  creación de contraseña y login integradas en la UI; URL pública visible en el
  encabezado; cambio de contraseña y `npm run reset-password`. Lanzador del túnel de
  Cloudflare (URL temporal trycloudflare) que guarda la URL en `panel/data/`; scripts
  PowerShell para arrancar panel y túnel con Windows; guía `docs/acceso-web.md`.
- **Ficheros cambiados:** `panel/lib/{config,auth,sessions,rate-limit,public-url,tunnel}.js`,
  `panel/scripts/`, `panel/deploy/`, `panel/public/*`, `panel/lib/{app,http-utils}.js`,
  `panel/server.js`, `panel/test/*`, `.gitignore` (`panel/data/`), `docs/acceso-web.md`,
  `docs/architecture.md`, `docs/verification.md`.
- **Requisitos cubiertos:** R1–R50 (`specs/puesto-de-mando-acceso-web/requirements.md`);
  R47–R50 son manuales (Windows/Internet), pendientes de anotar por el humano.
- **Tests añadidos:** 85 (168 en total). `bash init.sh` en verde.
- **Notas / decisiones:** Reviewer rechazó una primera vez por B1 (cuerpos JSON no-objeto
  dejaban la petición colgada); corregido junto con M1 (límite de intentos en cambio de
  contraseña) y M2 (ruta explícita de cloudflared en la tarea programada). Mejoras
  futuras anotadas: CF-Connecting-IP falsificable desde la LAN, cerrojo en setup
  concurrente, uninstall no cierra cloudflared.exe, PUT/PATCH sin anti-CSRF, rotación de
  panel.log. Informe: `progress/review_puesto-de-mando-acceso-web.md`.

## 2026-10-25 · Feature 3: puesto-de-mando-descubrimiento-claude (Puesto de Mando MUVER, fase 3)
- **Qué se hizo:** Los proyectos abiertos en Claude Code aparecen solos en el panel:
  lectura en solo lectura de `~/.claude.json` y `~/.claude/projects/` (sesiones, títulos,
  última actividad, nº de mensajes, rama) con caché por ruta+mtime+size y límite para
  ficheros grandes; fusión con `projects.json` (ahora capa de ajustes) por ruta
  normalizada, ids estables, fijar/ocultar, orden por fijados y actividad; PATCH de
  ajustes, DELETE 409 en proyectos de Claude, `GET /api/claude/status`; anti-CSRF en
  todo método distinto de GET/HEAD. UI: badge Claude Code, última sesión, fijar/ocultar,
  mostrar ocultos, sesiones recientes y formulario de ajustes en el detalle.
- **Ficheros cambiados:** `panel/lib/{path-key,claude-discovery,project-catalog}.js` (nuevos),
  `panel/lib/{app,registry,config}.js`, `panel/server.js`, `panel/public/*`, `panel/test/*`,
  `docs/architecture.md`, `docs/verification.md`.
- **Requisitos cubiertos:** R1–R53 (`specs/puesto-de-mando-descubrimiento-claude/requirements.md`).
- **Tests añadidos:** 78 (246 en total). `bash init.sh` en verde.
- **Notas / decisiones:** Aprobado a la primera; probado con datos reales de Claude Code
  sin modificar nada en `~/.claude`. Mejoras anotadas (no bloqueantes): recortar títulos
  de `summary`, límite de longitud de línea en modo truncado, caché compartida con el
  escaneo de arranque, git en cada GET también para ocultos (`--no-optional-locks`),
  validar esquema http/https de `appUrl`/`repoUrl`, `scan({force})` concurrente. Nota:
  las versiones recientes de Claude Code guardan el historial en `~/.claude/history.jsonl`
  (no leído en esta fase). Informe: `progress/review_puesto-de-mando-descubrimiento-claude.md`.

## 2026-10-25 · Feature 4: puesto-de-mando-trabajar (Puesto de Mando MUVER, fase 4)
- **Qué se hizo:** Trabajar con Claude Code desde el panel: vista Trabajar por proyecto con chat
  (nueva, continuar o retomar sesión), salida en vivo por SSE con reconexión, cancelar, límites de
  ejecuciones/tiempo/salida e historial en disco; permisos acotados (acceptEdits + comandos
  autorizados por proyecto como reglas Bash y PowerShell) con «Permitir y reintentar»; botones SDD
  (implementar, aprobar spec, aprobar tests, ejecutar tests, ver cambios con diff, commit y push sin
  --force); reconfirmación de contraseña por el túnel cada 15 min, verificación de Cloudflare
  Access, PANEL_ALLOW_EXEC, audit.log; portada con «Te necesitan».
- **Ficheros cambiados:** `panel/lib/{claude-cli,exec-utils,run-store,runs,command-runner,sse,
  sdd-actions,git-actions,cf-access,reauth,audit,work-api}.js` (nuevos), `panel/public/work.js`,
  cambios en app/config/registry/sessions/git-info/http-utils/rate-limit, UI, tests y docs.
- **Requisitos cubiertos:** R1–R99 (`specs/puesto-de-mando-trabajar/requirements.md`); R95–R99 manuales.
- **Tests añadidos:** 165 (411 en total); suite en verde en Linux y en el Windows del humano.
- **Notas / decisiones:** La prueba real T36 (Windows, Claude Code 2.1.307) destapó 7 fallos que los
  tests simulados no veían, corregidos antes de aprobar: prompt por stdin (--allowedTools variádica),
  reglas PowerShell, texto recortado/duplicado, estado con permisos denegados, registro movido a
  panel/data/, IP real del limitador solo desde loopback, tests que leían datos locales y rutas
  Windows. Pendiente del humano: T36 desde el móvil y Commit y push real; T37 (Internet).
  Reviewer: APROBADO con mejoras de seguridad M1 (alta: git.exe del proyecto en Windows), M2
  (comandos autorizados demasiado amplios), M3 (hooks y core.fsmonitor), M4, M5 y notas N1–N6.
  Informe: `progress/review_puesto-de-mando-trabajar.md`.

## 2026-10-25 · Feature 14: endurecimiento-ejecucion (seguridad de la ejecución)
- **Qué se hizo:** Resolución de `git`, `node`, `npm`, `npx`, `claude`, `bash` y `taskkill` por ruta
  absoluta solo desde `PATH` y rutas conocidas, excluyendo la carpeta del proyecto y las del catálogo,
  con comprobación final antes de lanzar cualquier proceso y `NoDefaultCurrentDirectoryInExePath=1` en
  Windows (M1: `git.exe` en la carpeta del proyecto); sin vuelta al nombre suelto en `exec-utils` y
  `claude-cli`; comandos amplios no sugeridos y con confirmación con aviso (M2); git con
  `core.fsmonitor=false`, aviso de hooks en Commit y push, push SSH en BatchMode y diffs con
  `--literal-pathspecs` (M3, M4, N3); límite de salida para todos los eventos (M5); «Aprobar spec»
  rechazada con un run activo (N4).
- **Ficheros cambiados:** `panel/lib/trusted-bin.js` (nuevo), `app`, `claude-cli`, `exec-utils`,
  `git-actions`, `git-info`, `registry`, `runs`, `sdd-actions`, `work-api`, `public/{app,work}.js`,
  `server.js`, tests y docs.
- **Requisitos cubiertos:** R1–R33 (`specs/endurecimiento-ejecucion/requirements.md`); R12 manual.
- **Tests añadidos:** 59 (470 en total); suite en verde en Linux.
- **Notas / decisiones:** Puerta 2 aprobada por el humano. T30 (prueba manual en Windows con
  `whoami.exe` como `git.exe`/`claude.exe` en `C:\prueba-m1`) **superada** el 2026-10-25 (Node 24.14.0, Git
  2.52.0.windows.1, Claude Code 2.1.307; `whoami` no se ejecutó en ningún paso), registrada desde otra sesión e
  incorporada aquí. Dos revisiones, ambas APROBADO: `progress/review_endurecimiento-ejecucion.md` (M1–M3, que
  pasan a la feature 15) y `progress/review_endurecimiento-ejecucion_2.md` (MA1, cubierta por la 15; **MA2 alta:
  el sondeo sin clic ejecuta `gpg.program` con `log.showSignature` y filtros `clean` de `.git/config`**; M3 vectores
  de configuración en Commit y push; M4 UX: los campos de comando de tests y comandos autorizados se confunden).

## 2026-10-25 · Feature 15: comandos-amplios-git-npm (seguridad, segunda parte)
- **Qué se hizo:** `git` y `npm` se clasifican por lista permitida de subcomandos: el resto (fetch/push/pull,
  ls-remote, clone, grep, hook, merge, cherry-pick, revert, npm install/ci/exec/view…) no se sugiere y añadirlo exige
  la confirmación con aviso; el nombre base ignora `.exe/.cmd/.bat/.com/.ps1`; los comandos ya guardados que pasan a
  ser amplios se avisan. `killProcessTree` comprueba `taskkill` con `isTrustedPath` y le pasa
  `NoDefaultCurrentDirectoryInExePath=1` en Windows. El resolvedor excluye también la ruta real del `cwd`.
- **Ficheros cambiados:** `panel/lib/{claude-cli,exec-utils,runs,trusted-bin}.js`, tests y docs.
- **Requisitos cubiertos:** R1–R18 (`specs/comandos-amplios-git-npm/requirements.md`); R13 manual.
- **Tests añadidos:** 18 (488 en total); suite en verde en Linux.
- **Notas / decisiones:** Primera revisión RECHAZADA (B1: `git cherry-pick --strategy` y `git merge -s` ejecutan
  programas y estaban en la lista permitida; fallo de la spec). Enmienda 1 aprobada por el humano: salen `merge`,
  `cherry-pick`, `revert` y `npm view/info/show/v` (`--git=<programa>`). Segunda revisión: APROBADO sin bloqueantes
  (`progress/review_comandos-amplios-git-npm.md`). T16 (prueba manual en Windows: cancelar un run, avisos de
  `git push/merge/cherry-pick` y `npm view`, evidencia con git 2.52) pendiente del humano y no bloqueante. Riesgos
  aceptados que pasan a las features 16, 17 y 18; duda 5 (variables de entorno delante de una regla Bash) a comprobar
  con el CLI real.
