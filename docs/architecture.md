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
- Se construye en fases (ver `feature_list.json`): fase 1 lectura + alta/baja de proyectos;
  fase 2 acciones de desarrollo con confirmación; fase 3 visual de lo hecho y avisos.

## Piezas principales (a alto nivel)
> Ej: una base de datos, un servidor/backend, una interfaz/frontend, integraciones externas.

- **Base de datos:** no hay. El registro de proyectos es un fichero `panel/projects.json`
  (`id`, `name`, `path` local absoluta, `appUrl`, `repoUrl` opcional, `tags` opcional),
  editable a mano. El estado de cada proyecto no se guarda: se lee de su disco en cada petición.
- **Backend / lógica:** `panel/server.js` + `panel/lib/` (Node.js, módulos nativos `http`,
  `fs`, `path`, `child_process`, `os`). Lee por proyecto `feature_list.json`,
  `progress/current.md` y git (rama, último commit, cambios sin commitear), calcula el
  semáforo (`atencion` > `en_curso` > `inactivo` > `ok`; `no_encontrado` si la ruta no existe)
  y expone una API JSON.
- **Interfaz / frontend:** `panel/public/` (index.html, styles.css, app.js, render.js) en
  vanilla JS, mobile-first (usable a 360 px), tema claro/oscuro automático
  (`prefers-color-scheme`), `manifest.webmanifest` para "añadir a pantalla de inicio".
- **Servicios externos:** ninguno en fase 1. `git` del sistema se invoca localmente con
  argumentos fijos. GitHub solo como enlace (`repoUrl`). Para acceso fuera de la red local se
  recomienda Tailscale o similar (fuera del alcance del repo).

## Tecnologías
> Lenguajes, frameworks, hosting. Si no tienes criterio, el Analista propone y explica.

- **Lenguaje(s):** JavaScript (Node.js >= 18, ES Modules) en servidor y navegador.
- **Framework(s):** ninguno. Sin bundler, sin dependencias npm. Tests con `node:test` + `node:assert`.
- **Base de datos:** ninguna (fichero JSON `panel/projects.json`).
- **Hosting / despliegue:** local. `cd panel && npm start` escucha en `0.0.0.0:4310`
  (variable `PORT`) e imprime las URLs de acceso (localhost e IP de la red local).

## Cómo se comunican las piezas
> Una frase o un esquema simple. Ej: "el frontend pide datos al backend por una API; el backend guarda en la base de datos".

- El navegador (PC o móvil) carga `panel/public/` desde el servidor y pide JSON a la API:
  `GET /api/projects` (listado con estado resumido), `GET /api/projects/:id` (detalle),
  `POST /api/projects` (alta, valida que la ruta exista), `DELETE /api/projects/:id` (baja).
- El servidor, por cada proyecto registrado, lee del disco `feature_list.json`,
  `progress/current.md` y ejecuta `git` (`execFile`, sin shell) en la carpeta del proyecto, y
  devuelve el resultado. Sin caché: cada petición refleja el estado real.

```
[Móvil / PC: navegador] --HTTP (LAN)--> [panel/server.js] --fs/git--> [carpeta de cada proyecto]
                                                |
                                        panel/projects.json
```

## Restricciones y decisiones de arquitectura
> Cosas que condicionan: "debe funcionar en móvil", "un solo usuario admin", "tiene que integrarse con X"…

- Debe funcionar en el móvil desde la red local (responsive a 360 px, PWA mínima).
- Un solo usuario (el humano); sin autenticación en fase 1, por lo que el panel solo se
  expone en redes de confianza o vía Tailscale.
- El servidor no ejecuta comandos arbitrarios: en fase 1 solo lectura + alta/baja del registro;
  `git` se invoca con una lista cerrada de argumentos. Las acciones de desarrollo llegan en
  fase 2 y siempre con confirmación previa.
- No se exponen rutas absolutas del disco al cliente más allá de lo necesario.
- El equipo del humano es Windows (rutas `C:\...`): el código debe ser portable (usar
  `path.resolve`, `execFile`); los tests crean repos temporales en `os.tmpdir()`.
- Si un proyecto no tiene arnés SDD o no es repo git, la interfaz lo muestra como tal, no falla.
- Todo lo del panel vive en `panel/`; el arnés SDD del repo (`.claude/`, `docs/`, `specs/`,
  `progress/`, `feature_list.json`, `sdd-lint.js`) no se modifica salvo `init.sh` (paso de tests)
  y la tabla de trazabilidad de `docs/verification.md`.
- El `muver.html` previo del humano se guardará, cuando lo aporte, en `panel/legacy/muver.html`
  como referencia para migrar lo que aporte.
