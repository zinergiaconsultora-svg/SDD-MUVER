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
