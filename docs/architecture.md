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
  fase 2 acceso web seguro desde Internet con contraseña y Cloudflare Tunnel (esta); después
  descubrimiento de proyectos, acciones de desarrollo con confirmación y visual/avisos.

## Piezas principales (a alto nivel)
> Ej: una base de datos, un servidor/backend, una interfaz/frontend, integraciones externas.

- **Base de datos:** no hay. El registro de proyectos es un fichero `panel/projects.json`
  (`id`, `name`, `path` local absoluta, `appUrl`, `repoUrl` opcional, `tags` opcional),
  editable a mano. El estado de cada proyecto no se guarda: se lee de su disco en cada petición.
- **Directorio de datos (fase 2):** `panel/data/` (o `PANEL_DATA_DIR`), ignorado por git, con escritura
  atómica (`.tmp` + `rename`). Contiene `auth.json` (hash scrypt de la contraseña única, `salt`, `params`,
  `sessionSecret` para firmar cookies), `sessions.json` (lista blanca de sesiones con `createdAt`,
  `lastSeenAt`, `expiresAt` en ms; caducidad deslizante de 30 días), `public-url.txt` (URL pública del túnel),
  `panel.log` y `cloudflared.log`.
- **Backend / lógica:** `panel/server.js` + `panel/lib/` (Node.js, módulos nativos `http`,
  `fs`, `path`, `child_process`, `os`, `crypto`). Lee por proyecto `feature_list.json`,
  `progress/current.md` y git (rama, último commit, cambios sin commitear), calcula el
  semáforo (`atencion` > `en_curso` > `inactivo` > `ok`; `no_encontrado` si la ruta no existe)
  y expone una API JSON. En fase 2 añade autenticación (`lib/auth.js` scrypt, `lib/sessions.js` cookies
  firmadas HMAC-SHA256, `lib/rate-limit.js` 5 fallos/15 min por IP, `lib/config.js` variables de entorno,
  `lib/public-url.js` y `lib/tunnel.js` para Cloudflare Tunnel) y los scripts `scripts/reset-password.js`
  y `scripts/run-tunnel.js`.
- **Interfaz / frontend:** `panel/public/` (index.html, styles.css, app.js, render.js, api-client.js,
  app-config.js) en vanilla JS, mobile-first (usable a 360 px), tema claro/oscuro automático
  (`prefers-color-scheme`), `manifest.webmanifest` para "añadir a pantalla de inicio". Pantallas de
  creación de contraseña, login y cambio de contraseña integradas con los mismos estilos; botones
  "Salir" y "Cambiar contraseña"; URL pública visible en el encabezado (también sin sesión).
- **Servicios externos:** `git` del sistema se invoca localmente con argumentos fijos. GitHub solo
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
- **Base de datos:** ninguna (fichero JSON `panel/projects.json`).
- **Hosting / despliegue:** el PC Windows del humano. `cd panel && npm start` escucha en `0.0.0.0:4310`
  (variable `PORT`) e imprime las URLs de acceso (localhost e IP de la red local), el directorio de datos,
  si la contraseña está configurada y la URL pública si existe. Publicación HTTPS mediante Cloudflare
  Tunnel y arranque con el PC mediante tareas programadas (ver `docs/acceso-web.md`). Variables:
  `PORT`, `PANEL_DATA_DIR`, `PANEL_SECURE_COOKIES`, `PANEL_TRUST_PROXY`, `CLOUDFLARED_BIN`.

## Cómo se comunican las piezas
> Una frase o un esquema simple. Ej: "el frontend pide datos al backend por una API; el backend guarda en la base de datos".

- El navegador (PC o móvil) carga `panel/public/` desde el servidor (estáticos públicos) y pide JSON a la API:
  `GET /api/auth/status` (público: `configured`, `authenticated`, `publicUrl`), `POST /api/auth/setup`
  (primera contraseña), `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`;
  `GET /api/projects` (listado con estado resumido), `GET /api/projects/:id` (detalle),
  `POST /api/projects` (alta, valida que la ruta exista), `DELETE /api/projects/:id` (baja).
- **Sesión y defensa CSRF:** la autenticación viaja en la cookie `muver_session=<id>.<firma HMAC>`
  (`HttpOnly; SameSite=Lax; Path=/; Max-Age=30 días`, más `Secure` cuando la petición entra por HTTPS a través
  de Cloudflare — `X-Forwarded-Proto: https` — o con `PANEL_SECURE_COOKIES=1`). Toda mutación (`POST`/`DELETE`)
  a `/api/*` debe llevar `X-Requested-With: fetch`, si no → `403`. Orden del middleware: estáticos → cabecera
  anti-CSRF → `/api/auth/*` → el resto exige sesión válida (`401 No autenticado`).
- **Cabeceras del proxy:** con `PANEL_TRUST_PROXY` activo (por defecto) el servidor cree `CF-Connecting-IP`
  (IP del cliente para el límite de intentos) y `X-Forwarded-Proto` (para el atributo `Secure`); con `0` usa
  `remoteAddress` e ignora ambas.
- El servidor, por cada proyecto registrado, lee del disco `feature_list.json`,
  `progress/current.md` y ejecuta `git` (`execFile`, sin shell) en la carpeta del proyecto, y
  devuelve el resultado. Sin caché: cada petición refleja el estado real.

```
[Móvil con datos / PC remoto] --HTTPS--> [Cloudflare] --túnel saliente (cloudflared)--+
                                                                                     v
[Móvil / PC en la Wi-Fi] --HTTP (LAN)----------------------------------------> [panel/server.js] --fs/git--> [carpeta de cada proyecto]
                                                                                     |
                                                                 panel/projects.json + panel/data/ (auth.json, sessions.json, public-url.txt)
```

## Restricciones y decisiones de arquitectura
> Cosas que condicionan: "debe funcionar en móvil", "un solo usuario admin", "tiene que integrarse con X"…

- Debe funcionar en el móvil desde la red local (responsive a 360 px, PWA mínima).
- Un solo usuario (el humano) con **una única contraseña** (10–128 caracteres, hash scrypt N=16384,
  sin usuarios ni roles); límite de intentos en memoria (5 fallos → 15 min de bloqueo por IP, `429`);
  cambio de contraseña revoca las demás sesiones; rescate solo desde el PC con `npm run reset-password`.
  Fuera de la red local el panel se publica únicamente a través de Cloudflare Tunnel (HTTPS).
- El servidor no ejecuta comandos arbitrarios: en fase 1 solo lectura + alta/baja del registro;
  `git` se invoca con una lista cerrada de argumentos. Las acciones de desarrollo llegan en
  fase 2 y siempre con confirmación previa.
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
