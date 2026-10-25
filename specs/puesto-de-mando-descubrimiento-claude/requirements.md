# Requisitos — Feature 3: Puesto de Mando MUVER (fase 3: descubrimiento de proyectos de Claude Code)

> Objetivo decidido con el humano: **todos los proyectos que abra en Claude Code deben aparecer solos en el
> panel**, sin darlos de alta a mano. El panel lee (y solo lee) los datos locales de Claude Code del PC donde
> corre el servidor — `%USERPROFILE%\.claude.json` y `%USERPROFILE%\.claude\projects\` — y los fusiona con
> `panel/projects.json`, que pasa a ser una **capa de ajustes** (nombre, URL de la app, repo, etiquetas,
> ocultar, fijar) y sigue admitiendo proyectos manuales.
>
> Fuera de alcance (features 4 y 5): ejecutar Claude Code o comandos, capturas y avisos, leer el contenido
> completo de las conversaciones (solo título, fechas, rama y recuentos) y **modificar cualquier cosa dentro de
> `~/.claude`** (requisito explícito del humano: el panel es de solo lectura sobre esa carpeta).
>
> Convención de este fichero: cada requisito ocupa UNA sola línea (así `sdd-lint.js` lo valida completo) y va
> seguido de su línea *Cómo se prueba*. Contratos JSON, nombres de funciones y textos exactos están en
> `design.md`. Los tests usan **fixtures en un directorio temporal** que imitan `.claude.json` y
> `.claude/projects/<codificado>/<id>.jsonl` (ver `design.md` §6), nunca el `~/.claude` real del equipo.

## Vocabulario

- **Directorio de Claude (`claudeHome`):** carpeta base donde Claude Code guarda sus datos: `CLAUDE_HOME_DIR` o, por defecto, `os.homedir()`. Contiene `.claude.json` (fichero de configuración) y `.claude/projects/` (directorio de proyectos).
- **Fichero de configuración:** `<claudeHome>/.claude.json`; su clave `projects` es un objeto cuyas claves son rutas absolutas de proyectos y cuyos valores son objetos con, opcionalmente, `history` (array de `{ display, ... }`).
- **Directorio de proyectos:** `<claudeHome>/.claude/projects/`; cada subcarpeta directa es un **proyecto codificado** y cada fichero `<id>.jsonl` dentro de ella es una **sesión**.
- **Ruta codificada:** nombre de carpeta resultante de sustituir `/`, `\` y `:` por `-` en la ruta absoluta (`C:\Users\Usuario\app-flyder` → `C--Users-Usuario-app-flyder`; `/home/user/SDD-MUVER` → `-home-user-SDD-MUVER`). No es reversible: la ruta real se obtiene del campo `cwd` de las sesiones o casando con las claves del fichero de configuración.
- **Línea de sesión:** una línea del `.jsonl` que parsea como objeto JSON; puede traer `type`, `timestamp` (ISO), `cwd`, `sessionId`, `gitBranch`, `message` (`{ role, content }`, con `content` cadena o array de bloques `{ type, text }`) y, si `type` es `summary`, el campo `summary`.
- **Mensaje:** línea de sesión con `type` igual a `user` o `assistant`.
- **Clave de ruta:** forma normalizada de una ruta para compararla (`design.md` §5.1): en rutas Windows (`X:\…` o `\\…`) sin distinguir mayúsculas y con `\` como separador; en rutas POSIX, tal cual tras `path.posix.normalize`, sin separador final.
- **Entrada de ajustes:** objeto de `projects.json` (`id`, `name`, `path`, `appUrl`, `repoUrl`, `tags` y, nuevos, `hidden`, `pinned`).
- **Proyecto manual:** el que tiene entrada de ajustes y ninguna coincidencia en Claude (`source: "manual"`). **Proyecto de Claude:** el descubierto sin entrada de ajustes (`source: "claude"`). **Proyecto fusionado:** el que tiene ambas (`source: "both"`).
- **Catálogo:** la lista final de proyectos que devuelve `GET /api/projects` (fusión + estado de disco de la fase 1 + orden de la fase 3).
- **Mutación:** petición a `/api/*` con cualquier método distinto de `GET` y `HEAD` (amplía la definición de la fase 2, que solo cubría `POST` y `DELETE`).
- **Petición autenticada** y **cabecera anti-CSRF (`X-Requested-With: fetch`):** como en la fase 2.
- **Ahora (`now`):** instante inyectable en `createApp` y en el módulo de descubrimiento, para tests deterministas.

## A. Localización de Claude Code y disponibilidad

- **R1.** Cuando el panel arranca, el sistema debe tomar como directorio de Claude el valor de `CLAUDE_HOME_DIR` (recortado) si está definido y no vacío y, si no, `os.homedir()`, y debe exponerlo en `readConfig` como `claudeHome`.
  - *Cómo se prueba:* test unitario de `readConfig` con `env = {}` (igual a `os.homedir()`), con `CLAUDE_HOME_DIR` definida (ruta absoluta devuelta tal cual) y con `CLAUDE_HOME_DIR = "   "` (vuelve al valor por defecto).

- **R2.** Si no existen ni el fichero de configuración ni el directorio de proyectos, entonces el sistema debe listar únicamente los proyectos de `projects.json` en `GET /api/projects` (código `200`, array, cada uno con `source: "manual"` y `claude: null`) sin registrar ningún error en `console.error`.
  - *Cómo se prueba:* test de integración con `claudeHome` apuntando a un directorio temporal vacío y dos proyectos manuales: código, `source`, `claude` y espía de `console.error` sin llamadas.

- **R3.** Cuando una petición autenticada hace `GET /api/claude/status` y existe el fichero de configuración o el directorio de proyectos, el sistema debe responder `200` con `{ "available": true, "claudeHome", "projectsDir", "projectCount", "sessionCount", "lastScanAt" }`, donde `projectCount` es el número de proyectos descubiertos, `sessionCount` la suma de sus sesiones y `lastScanAt` la fecha ISO del último escaneo.
  - *Cómo se prueba:* test de integración con fixtures de 2 proyectos y 3 sesiones: código y los seis campos (recuentos exactos; `lastScanAt` parsea como fecha igual al `now` inyectado).

- **R4.** Si no existen ni el fichero de configuración ni el directorio de proyectos y una petición autenticada hace `GET /api/claude/status`, entonces el sistema debe responder `200` con `{ "available": false, "claudeHome": "<ruta>", "projectsDir": "<ruta>", "projectCount": 0, "sessionCount": 0, "lastScanAt": "<ISO>" }`.
  - *Cómo se prueba:* test de integración con directorio temporal vacío; comprueba cuerpo exacto salvo `lastScanAt`, que debe parsear como fecha.

- **R5.** Si el fichero de configuración existe pero no es JSON válido o su clave `projects` no es un objeto, entonces el sistema debe ignorarlo (ninguna clave de configuración, `lastPrompt: null` en todos los proyectos), registrar un único aviso con `console.error` por escaneo y seguir descubriendo los proyectos del directorio de proyectos con `available: true`.
  - *Cómo se prueba:* test unitario de `discoverClaudeProjects` con `.claude.json` = `{ roto` y una carpeta de proyecto con sesión: `available` true, un proyecto, `lastPrompt` null, espía de `console.error` llamada exactamente una vez; segundo caso con `{ "projects": [] }` (array) → mismo resultado.

- **R6.** Cuando `GET /api/claude/status` o `GET /api/projects` llegan sin petición autenticada, el sistema debe responder `401` con `{ "error": "No autenticado" }` como en la fase 2.
  - *Cómo se prueba:* test de integración sin cookie sobre `/api/claude/status` y sobre `/api/projects?includeHidden=1`.

## B. Descubrimiento de proyectos y sesiones (`lib/claude-discovery.js`)

- **R7.** Cuando el sistema escanea el directorio de proyectos, debe crear un proyecto por cada subcarpeta directa y una sesión por cada fichero con extensión `.jsonl` dentro de ella, ignorando los ficheros sueltos del directorio de proyectos, las subcarpetas de segundo nivel y los ficheros con otra extensión.
  - *Cómo se prueba:* test unitario con fixtures: 2 carpetas de proyecto (una con 2 `.jsonl`, un `notas.txt` y una subcarpeta `tools/` con otro `.jsonl`) y un fichero `suelto.jsonl` en la raíz → 2 proyectos, `sessionCount` 2 y 0 respectivamente.

- **R8.** Cuando una carpeta de proyecto contiene al menos una línea de sesión con un campo `cwd` de tipo cadena, el sistema debe usar el `cwd` de la primera línea que lo tenga (en el orden de ficheros por nombre y de líneas por aparición) como `path` del proyecto, con `unresolved: false`.
  - *Cómo se prueba:* test unitario con un fixture cuya primera línea no tiene `cwd`, la segunda tiene `cwd: "/tmp/muver-proy-a"` y una tercera tiene otro `cwd` distinto → `path` igual al segundo.

- **R9.** Si ninguna línea de sesión de una carpeta tiene `cwd` pero la ruta codificada de la carpeta coincide con la codificación de alguna clave del fichero de configuración, entonces el sistema debe asignar esa clave como `path` (incluida una clave Windows `C:\Users\Usuario\app-flyder` para la carpeta `C--Users-Usuario-app-flyder`).
  - *Cómo se prueba:* test unitario con fixture `C--Users-Usuario-app-flyder/` sin `cwd` y `.claude.json` con la clave `C:\\Users\\Usuario\\app-flyder` → `path` igual a la clave y `unresolved` false; segundo caso POSIX `-home-user-SDD-MUVER` ↔ `/home/user/SDD-MUVER`.

- **R10.** Si una carpeta de proyecto no tiene `cwd` ni casa con ninguna clave del fichero de configuración, entonces el sistema debe listarla con `path: null`, `unresolved: true`, `name` igual al nombre de la carpeta codificada, y en el catálogo debe aparecer con `exists: false` y `status: "no_encontrado"`.
  - *Cómo se prueba:* test unitario de descubrimiento (campos `path`, `unresolved`, `name`) y test de integración `GET /api/projects` que comprueba `exists`, `status` y que el proyecto está en el listado.

- **R11.** Cuando el fichero de configuración tiene una clave de proyecto sin carpeta correspondiente en el directorio de proyectos, el sistema debe incluirla como proyecto con `sessions: []`, `sessionCount: 0`, `lastActivityAt: null` y `source: "claude"`.
  - *Cómo se prueba:* test unitario con `.claude.json` con dos claves y una sola carpeta → 2 proyectos; el segundo con los valores indicados.

- **R12.** Cuando una misma ruta aparece como clave del fichero de configuración y como carpeta del directorio de proyectos (resuelta por `cwd` o por codificación), el sistema debe devolver una sola entrada por clave de ruta, con las sesiones de la carpeta y el `lastPrompt` de la configuración.
  - *Cómo se prueba:* test unitario con clave `/tmp/muver-proy-a` en la configuración y carpeta con `cwd: "/tmp/muver-proy-a/"` (separador final) → exactamente 1 proyecto con `sessionCount` 1 y `lastPrompt` definido.

- **R13.** Cuando la entrada del fichero de configuración de un proyecto tiene `history` con elementos cuyo `display` es una cadena no vacía, el sistema debe fijar `lastPrompt` al `display` del elemento con mayor `timestamp` si los elementos lo traen y, si no, al del primer elemento del array, recortado a 80 caracteres según la regla de títulos; sin `history` o sin elementos válidos, `lastPrompt` debe ser `null`.
  - *Cómo se prueba:* test unitario con tres entradas: `history` con `timestamp` (gana la mayor aunque no sea la primera), `history` sin `timestamp` (gana el índice 0, y un `display` de 100 caracteres queda en 80 + `…`), y entrada sin `history` → `null`.

- **R14.** Cuando el sistema lee una sesión, debe devolver `{ id, title, startedAt, lastActivityAt, messageCount, gitBranch, truncated }` con `id` = nombre del fichero sin `.jsonl`, `startedAt` = menor `timestamp` válido, `lastActivityAt` = mayor `timestamp` válido, `messageCount` = número de mensajes y `gitBranch` = último `gitBranch` no vacío (o `null`).
  - *Cómo se prueba:* test unitario con un fixture de 5 líneas (2 `user`, 2 `assistant`, 1 `summary`, timestamps desordenados, dos `gitBranch` distintos) que comprueba cada campo.

- **R15.** Cuando un fichero de sesión contiene una o más líneas con `type: "summary"` y campo `summary` de tipo cadena no vacía, el sistema debe usar como `title` el `summary` de la última de esas líneas.
  - *Cómo se prueba:* test unitario con dos líneas `summary` ("Primero", "Segundo") intercaladas con mensajes → `title` igual a "Segundo".

- **R16.** Si un fichero de sesión no tiene ningún `summary` válido, entonces el sistema debe usar como `title` el texto del primer mensaje `user` (contenido cadena, o el primer bloque `{ type: "text" }` si es array) cuyo texto recortado no esté vacío ni empiece por `<command-` ni por `<local-command-`, con espacios en blanco consecutivos colapsados y recortado a 80 caracteres (los primeros 80 más `…` si era más largo); si tampoco hay ninguno, debe usar el `id`.
  - *Cómo se prueba:* test unitario con tres fixtures: `content` cadena de 120 caracteres (título de 81 caracteres acabado en `…`), `content` array cuyo primer bloque es `tool_result` y el segundo `text`, primer `user` `<command-name>/clear</command-name>` seguido de otro con texto normal (gana el segundo); y un fixture solo con `assistant` → `title` igual al `id`.

- **R17.** Si un fichero de sesión contiene líneas que no parsean como JSON, líneas vacías o líneas sin los campos esperados, entonces el sistema debe ignorarlas sin lanzar ni registrar error y procesar el resto; y si ninguna línea trae `timestamp` válido, `startedAt` y `lastActivityAt` deben ser la fecha de modificación del fichero (`mtime`) en ISO.
  - *Cómo se prueba:* test unitario con un fixture que mezcla `{ roto`, línea vacía, `"cadena"`, `{}` y 2 mensajes válidos → `messageCount` 2 y título correcto; segundo fixture sin `timestamp` → ambas fechas iguales al `mtime` del fichero (`utimes` fijado por el test).

- **R18.** Si un fichero de sesión supera `MAX_SESSION_FILE_BYTES` (20 MB por defecto, inyectable), entonces el sistema debe leer solo sus primeras `HEAD_LINES` (200) líneas para obtener `cwd`, `gitBranch`, `title` y `startedAt`, fijar `lastActivityAt` al `mtime`, `messageCount: null` y `truncated: true`, sin leer el resto del fichero.
  - *Cómo se prueba:* test unitario que inyecta `maxFileBytes: 1024` y `headLines: 3` sobre un fixture de 2 KB con 10 líneas → `truncated` true, `messageCount` null, `lastActivityAt` igual al `mtime`, `title` tomado de las 3 primeras líneas y `stats.bytesRead` menor que el tamaño del fichero.

- **R19.** Cuando un proyecto tiene sesiones, el sistema debe devolver `sessions` ordenadas por `lastActivityAt` descendente, `sessionCount` igual a su número y `lastActivityAt` del proyecto igual al mayor `lastActivityAt` de sus sesiones.
  - *Cómo se prueba:* test unitario con 3 sesiones con fechas distintas escritas en orden alfabético inverso → orden por fecha, recuento 3 y fecha del proyecto igual a la mayor.

- **R20.** Cuando el sistema vuelve a escanear y un fichero de sesión conserva la misma ruta, `mtime` y tamaño que en el escaneo anterior, debe reutilizar el resultado en memoria sin releer su contenido, y las estadísticas del escaneo deben reflejarlo (`stats.filesParsed` y `stats.filesCached`).
  - *Cómo se prueba:* test unitario de `createClaudeDiscovery` con `ttlMs: 0`: primer `scan()` → `filesParsed` igual al número de ficheros y `filesCached` 0; segundo `scan()` → `filesParsed` 0 y `filesCached` igual al total; tras modificar un fichero (contenido y tamaño distintos) → `filesParsed` 1.

- **R21.** Cuando se llama a `scan()` y han pasado menos de `ttlMs` (30 000 ms por defecto) desde el último escaneo completado, el sistema debe devolver el resultado anterior sin tocar el disco (`stats.fromCache: true`); pasado el TTL o con `scan({ force: true })`, debe escanear de nuevo e incorporar sesiones nuevas.
  - *Cómo se prueba:* test unitario con `now` controlable: `scan()` en `t0`; se añade una sesión; `scan()` en `t0 + 29 s` → mismo `sessionCount` y `fromCache` true; `scan()` en `t0 + 31 s` → `sessionCount + 1`; `scan({ force: true })` justo después de otra adición → la incorpora.

- **R22.** Cuando el sistema escanea el directorio de Claude, debe limitarse a leer: el fuente de `lib/claude-discovery.js` no debe contener ninguna llamada de escritura de `fs` (lista cerrada en `design.md` §5.2) y, tras un escaneo completo sobre los fixtures, el árbol de ficheros (nombres, tamaños y `mtime`) debe ser idéntico al anterior.
  - *Cómo se prueba:* test estático que lee `panel/lib/claude-discovery.js` y comprueba que no aparece ninguna de las cadenas prohibidas de `design.md` §5.2 y que solo importa `node:fs/promises`, `node:fs` (para `createReadStream`), `node:readline`, `node:path` y `./path-key.js`; test unitario que toma una instantánea recursiva del directorio temporal antes y después de `discoverClaudeProjects` y compara con `deepEqual`.

## C. Fusión, identificadores y catálogo (`lib/project-catalog.js`, `lib/path-key.js`)

- **R23.** Cuando el sistema compara dos rutas, debe considerarlas la misma clave de ruta si, tratándose de rutas Windows, solo difieren en mayúsculas/minúsculas, en el separador (`/` o `\`) o en un separador final; y si, tratándose de rutas POSIX, solo difieren en un separador final o en segmentos `.`/`..` normalizables.
  - *Cómo se prueba:* test unitario de `pathKey` con los pares (`C:\Users\Usuario\App-Flyder`, `c:/users/usuario/app-flyder/`) iguales, (`/home/user/proy/`, `/home/user/proy`) iguales, (`/home/user/Proy`, `/home/user/proy`) distintos y (`C:\a\b`, `D:\a\b`) distintos.

- **R24.** Cuando un proyecto descubierto por Claude tiene la misma clave de ruta que una entrada de ajustes, el sistema debe devolverlo como un único proyecto con `source: "both"`, `id`, `name`, `appUrl`, `repoUrl`, `tags`, `hidden` y `pinned` de la entrada de ajustes y `claude: { sessionCount, lastActivityAt, lastPrompt }` del descubrimiento.
  - *Cómo se prueba:* test unitario de `mergeProjects` con entrada `path: "C:\\Users\\Usuario\\app-flyder"` y descubrimiento con `path: "c:/users/usuario/app-flyder"` → 1 proyecto `both` con los campos indicados.

- **R25.** Cuando una entrada de ajustes no coincide con ningún proyecto descubierto, el sistema debe devolverla con `source: "manual"`, `claude: null` y `lastActivityAt` igual a la fecha del último commit de git si existe o `null`.
  - *Cómo se prueba:* test unitario de `mergeProjects` (campos `source` y `claude`) y test de integración con un proyecto manual con repo git de 1 commit (`lastActivityAt` igual a la fecha del commit) y otro sin git (`null`).

- **R26.** Cuando un proyecto descubierto no coincide con ninguna entrada de ajustes, el sistema debe devolverlo con `source: "claude"`, `name` igual al último segmento de su ruta, `appUrl: ""`, `repoUrl: ""`, `tags: []`, `hidden: false`, `pinned: false` e `id` igual al `slugify` de ese nombre.
  - *Cómo se prueba:* test unitario de `mergeProjects` con `path: "C:\\Users\\Usuario\\Mi Proyecto"` → `name` "Mi Proyecto", `id` "mi-proyecto" y el resto de valores por defecto.

- **R27.** Si el `id` derivado de un proyecto de Claude coincide con el de otro proyecto (manual o de Claude), entonces el sistema debe añadir el sufijo `-2`, `-3`… al derivado, dando prioridad a los ids manuales, asignando los sufijos en orden alfabético de clave de ruta para que no cambien entre escaneos; y un proyecto no resuelto debe usar el `slugify` de su carpeta codificada.
  - *Cómo se prueba:* test unitario con manual `id: "app"` y dos proyectos de Claude `/x/app` y `/y/app` → ids `app`, `app-2` (`/x/app`), `app-3` (`/y/app`), idénticos al repetir la fusión con el array de descubrimiento en otro orden; un no resuelto `C--Users-Usuario-viejo` → `c-users-usuario-viejo`.

- **R28.** Cuando `GET /api/projects` devuelve un proyecto, el sistema debe incluir, además de los campos de la fase 1, `source`, `claude`, `hidden`, `pinned`, `lastActivityAt` y `unresolved`, y no debe incluir `path`.
  - *Cómo se prueba:* test de integración que comprueba la presencia de los 6 campos nuevos y la ausencia de `path` en cada elemento, para un proyecto `both`, uno `manual` y uno `claude`.

- **R29.** Cuando `GET /api/projects` devuelve el catálogo, el sistema debe ordenarlo con los fijados (`pinned: true`) primero, después por `lastActivityAt` descendente (los `null` al final) y, a igualdad, por `name` con `localeCompare('es')` y después por `id`.
  - *Cómo se prueba:* test unitario de `sortCatalog` con 5 proyectos (uno fijado antiguo, dos con fechas distintas, dos con `null` y nombres "Ágil"/"Zeta") → orden exacto; test de integración que comprueba el orden de ids con fixtures.

- **R30.** Cuando `GET /api/projects` llega sin el parámetro `includeHidden=1`, el sistema debe excluir los proyectos con `hidden: true`; y cuando llega con `includeHidden=1`, debe incluirlos con `hidden: true`.
  - *Cómo se prueba:* test de integración con una entrada `hidden: true`: sin parámetro no aparece; con `?includeHidden=1` aparece y su `hidden` es `true`; `?includeHidden=0` se comporta como sin parámetro.

- **R31.** Cuando una petición autenticada hace `GET /api/projects/:id` de un proyecto con datos de Claude, el sistema debe responder el detalle de la fase 1 más los campos de R28 y `claude.sessions`: hasta 20 sesiones, las más recientes primero, cada una con `{ id, title, startedAt, lastActivityAt, messageCount, gitBranch, truncated }`; para un proyecto manual `claude` debe ser `null`; y un proyecto oculto debe seguir respondiendo `200`.
  - *Cómo se prueba:* test de integración con un proyecto de 22 sesiones (→ 20 devueltas, ordenadas, con los 7 campos), uno manual (`claude` null) y uno oculto (`200`).

- **R32.** Cuando `loadRegistry` lee una entrada de ajustes con `hidden` o `pinned` ausentes o no booleanos, el sistema debe tratarlos como `false`, y cuando son `true` debe conservarlos en el catálogo y al guardar el registro.
  - *Cómo se prueba:* test unitario de `loadRegistry` + `normalizeSettings` con entradas `{}`, `{ hidden: "sí" }`, `{ pinned: true }`; `saveRegistry` tras `upsertSettings` conserva `pinned: true` en el fichero.

- **R33.** Cuando `GET /api/projects` se ejecuta contra `projects.json` con las cuatro entradas iniciales (rutas `C:\Users\Usuario\<nombre>` inexistentes en el entorno de tests) y sin Claude disponible, el sistema debe seguir devolviéndolas con `exists: false`, `status: "no_encontrado"` y `source: "manual"`, igual que en la fase 1.
  - *Cómo se prueba:* test de integración que arranca con `projectsFile` igual al `panel/projects.json` real copiado a un temporal y comprueba los 4 ids y sus valores.

## D. Ajustes: `PATCH`, `DELETE`, `POST` y anti-CSRF

- **R34.** Cuando una petición autenticada con cabecera anti-CSRF hace `PATCH /api/projects/:id` sobre un proyecto manual o fusionado con un cuerpo que contiene uno o más de `name`, `appUrl`, `repoUrl`, `tags`, `hidden`, `pinned` válidos, el sistema debe actualizar solo esos campos en su entrada de `projects.json` (escritura atómica), responder `200` con el resumen actualizado del catálogo y dejar intactos `id`, `path` y los campos no enviados.
  - *Cómo se prueba:* test de integración: `PATCH { "pinned": true, "tags": ["crm"] }` → `200`, cuerpo con `pinned` true y `tags`, `projects.json` con la entrada actualizada y `name`/`path`/`appUrl` iguales que antes.

- **R35.** Cuando una petición autenticada hace `PATCH /api/projects/:id` sobre un proyecto de Claude (sin entrada de ajustes), el sistema debe crear en `projects.json` una entrada con ese `id`, su `path` resuelto, `name` por defecto, `appUrl: ""`, `repoUrl: ""`, `tags: []`, `hidden: false`, `pinned: false` más los cambios recibidos, y el proyecto debe pasar a `source: "both"` en la respuesta y en el siguiente listado.
  - *Cómo se prueba:* test de integración con un proyecto solo de Claude: `PATCH { "appUrl": "http://localhost:5173" }` → `200` con `source` `both` y `appUrl`; `projects.json` contiene la entrada con `path` igual a la ruta del fixture; `GET /api/projects` lo devuelve como `both`.

- **R36.** Si `PATCH /api/projects/:id` llega con `name` vacío o no cadena, `appUrl` o `repoUrl` no cadena, `tags` que no es un array de cadenas, o `hidden`/`pinned` no booleanos, entonces el sistema debe responder `400` con `{ "error": "<texto de design.md §4.3>", "field": "<campo>" }` sin modificar `projects.json`; y si el cuerpo no contiene ninguno de los seis campos, debe responder `400` con `{ "error": "Nada que actualizar" }`.
  - *Cómo se prueba:* test de integración con seis cuerpos inválidos (uno por campo, más `{}` y `{ "path": "/otra" }`) que comprueba código, `error`, `field` y que el fichero no cambia (`mtime` y contenido).

- **R37.** Si `PATCH /api/projects/:id` llega para un `id` que no está en el catálogo (incluidos los ocultos, que sí están), entonces el sistema debe responder `404` con `{ "error": "Proyecto no encontrado" }`; y un `PATCH` sobre un proyecto oculto debe funcionar como R34.
  - *Cómo se prueba:* test de integración con `id` inexistente (`404`) y con un proyecto `hidden: true` al que se le hace `PATCH { "hidden": false }` → `200` y vuelve al listado sin `includeHidden`.

- **R38.** Si una mutación a `/api/*` con cualquier método distinto de `GET` y `HEAD` (incluidos `PATCH` y `PUT`) llega sin la cabecera anti-CSRF, entonces el sistema debe responder `403` con `{ "error": "Cabecera X-Requested-With requerida" }` antes de comprobar la sesión y sin modificar `projects.json`; y un `PATCH` con cabecera pero sin petición autenticada debe responder `401`.
  - *Cómo se prueba:* test de integración: `PATCH` y `PUT /api/projects/:id` con cookie válida y sin cabecera → `403`, fichero intacto; `PATCH` con cabecera y sin cookie → `401`; `POST`/`DELETE` sin cabecera siguen en `403` (fase 2).

- **R39.** Si una petición autenticada hace `DELETE /api/projects/:id` sobre un proyecto con `source` `claude` o `both`, entonces el sistema debe responder `409` con `{ "error": "Este proyecto lo detecta Claude Code: no se puede eliminar, ocúltalo" }` sin modificar `projects.json`; y sobre un proyecto manual debe responder `204` y eliminar su entrada como en la fase 1.
  - *Cómo se prueba:* test de integración con los tres casos (`claude` → `409`, `both` → `409` y fichero intacto, `manual` → `204` y entrada eliminada).

- **R40.** Cuando una petición autenticada hace `POST /api/projects` con una ruta cuya clave de ruta coincide con un proyecto de Claude, el sistema debe aceptarla como en la fase 1 (`201`) y el siguiente listado debe mostrar un único proyecto con `source: "both"` y el `id` de la entrada creada.
  - *Cómo se prueba:* test de integración: `POST { name: "Mi Flyder", path: <ruta del fixture> }` → `201`; `GET /api/projects` contiene un solo proyecto con esa ruta (`id` `mi-flyder`, `source` `both`) y ninguno con el id derivado anterior.

## E. Interfaz (`public/`)

- **R41.** Cuando `renderProjectCard` recibe un proyecto con `source` `claude` o `both`, el sistema debe pintar un distintivo `<span class="badge source-claude">Claude Code</span>` y una línea `<p class="claude-activity">Última sesión: <relativa> · N sesiones</p>` (o `Sin sesiones` si `sessionCount` es 0); y con `source: "manual"` no debe pintar ninguno de los dos.
  - *Cómo se prueba:* test unitario de render puro con tres proyectos (`both` con 3 sesiones y fecha de ayer, `claude` con 0 sesiones, `manual`) comprobando presencia/ausencia de las cadenas.

- **R42.** Cuando `renderProjectCard` recibe un proyecto, el sistema debe pintar un botón de fijar `<button data-action="pin" aria-pressed="true|false" aria-label="Fijar|Desfijar">📌</button>`, un botón `data-action="hide"` con texto "Ocultar" (o "Mostrar" si `hidden`), la clase `pinned` en la tarjeta si está fijado, la clase `is-hidden` si está oculto, y el botón "Eliminar" solo cuando `source` es `manual`.
  - *Cómo se prueba:* test unitario con un proyecto fijado y visible de Claude (sin "Eliminar", `aria-pressed="true"`, clase `pinned`), un manual oculto (con "Eliminar", texto "Mostrar", clase `is-hidden`) y escapado HTML del nombre.

- **R43.** Cuando `renderHiddenToggle(hiddenCount, showing)` recibe `hiddenCount` mayor que 0 o `showing` true, el sistema debe devolver `<button type="button" class="btn link" data-action="toggle-hidden">Mostrar ocultos (N)</button>` o, si `showing`, `…>Ocultar ocultos</button>`; y con `hiddenCount` 0 y `showing` false debe devolver `''`.
  - *Cómo se prueba:* test unitario con los tres casos (`(2, false)`, `(2, true)`, `(0, false)`).

- **R44.** Cuando `renderClaudeNotice(status)` recibe `available: false`, el sistema debe devolver `<p class="notice" role="status">Claude Code no detectado en este equipo: solo se muestran los proyectos añadidos a mano.</p>`; con `available: true` o `status` nulo debe devolver `''`.
  - *Cómo se prueba:* test unitario con `{ available: false }`, `{ available: true }` y `null`.

- **R45.** Cuando `renderProjectDetail` recibe un detalle con `claude` no nulo, el sistema debe pintar una sección "Sesiones de Claude Code" con una lista `<ol class="sessions">` cuyos elementos muestran título escapado, fecha relativa (`<time datetime>`), rama (si existe) y "N mensajes" (o "—" si `messageCount` es `null`), o el texto "Sin sesiones" si la lista está vacía; con `claude: null` no debe pintar la sección; y con `unresolved: true` debe pintar `<p class="missing">Ruta no resuelta</p>`.
  - *Cómo se prueba:* test unitario con tres detalles: 2 sesiones (una con `messageCount` null y sin rama), `claude` con `sessions: []` y `claude: null`; más uno con `unresolved: true`.

- **R46.** Cuando `renderSettingsForm(project)` recibe un proyecto, el sistema debe devolver `<form id="settings-form" data-id="<id>">` con los campos `name`, `appUrl`, `repoUrl` y `tags` (etiquetas unidas por `, `) rellenos con los valores actuales escapados, un hueco `<div id="settings-error" class="form-error-slot">` y un botón `type="submit"` con texto "Guardar ajustes".
  - *Cómo se prueba:* test unitario con un proyecto con `name` `"A <b>"`, `tags: ["web", "crm"]` → valores escapados (`A &lt;b&gt;`, `web, crm`), `data-id` y el botón.

- **R47.** Cuando `buildSettingsPayload(formValues)` recibe los valores del formulario de ajustes, el sistema debe devolver siempre los cuatro campos `{ name, appUrl, repoUrl, tags }` con cadenas recortadas y `tags` como array sin vacíos (`[]` si el campo está vacío), de modo que vaciar un campo lo borre en el servidor.
  - *Cómo se prueba:* test unitario con `{ name: " A ", appUrl: "", repoUrl: " x ", tags: "web, , crm " }` → `{ name: "A", appUrl: "", repoUrl: "x", tags: ["web", "crm"] }`.

- **R48.** Cuando `patchProject(id, changes, { request })` se invoca, el sistema debe llamar a `request('/api/projects/<id codificado>', { method: 'PATCH', body: JSON.stringify(changes) })` y devolver la respuesta; `togglePin(project, deps)` debe enviar `{ pinned: !project.pinned }` y `toggleHidden(project, deps)` debe enviar `{ hidden: !project.hidden }`.
  - *Cómo se prueba:* test unitario con un `request` espía que registra URL, método y cuerpo para los tres casos (id con espacio → `encodeURIComponent`).

- **R49.** Cuando `buildProjectsUrl(showHidden)` se invoca, el sistema debe devolver `/api/projects?includeHidden=1` si `showHidden` es `true` y `/api/projects` en otro caso; y cuando `splitHidden(projects, showHidden)` se invoca, debe devolver `{ visible, hiddenCount }` con `hiddenCount` = número de proyectos con `hidden: true` y `visible` = todos si `showHidden` es `true` o solo los no ocultos en otro caso, conservando el orden.
  - *Cómo se prueba:* test unitario de `buildProjectsUrl` con `true`, `false` y `undefined`; test unitario de `splitHidden` con 3 proyectos (1 oculto) en ambos modos.

- **R50.** Cuando `relativeTime(isoDate, now)` se invoca, el sistema debe devolver "ahora mismo" (menos de 60 s), "hace N min" (menos de 60 min), "hace N h" (menos de 24 h) y, a partir de 24 h, el resultado de `relativeDate`; con fecha inválida debe devolver "fecha desconocida".
  - *Cómo se prueba:* test unitario con 30 s, 5 min, 3 h, 2 días (igual a `relativeDate`) y `"basura"`.

- **R51.** Cuando se carga `index.html`, el sistema debe contener los huecos `id="claude-notice"` (dentro de `#list-view`, antes de `#projects`) e `id="hidden-toggle"` (después de `#projects`), conservar el formulario `#add-project-form` con sus 5 campos, y `styles.css` debe definir `.badge.source-claude`, `.card.pinned`, `.card.is-hidden`, `.sessions` y `.notice`, manteniendo en verde los tests de anchos ≤ 360 px y de botones de 44 px.
  - *Cómo se prueba:* test estático sobre `index.html` (orden de los ids con `indexOf`) y `styles.css` (presencia de los cinco selectores); los tests de anchos y botones de la fase 1 siguen pasando.

## F. Arranque y documentación

- **R52.** Cuando el panel arranca, el sistema debe imprimir una línea `Claude Code: detectado en <claudeHome> (N proyectos, M sesiones)` si está disponible o `Claude Code: no detectado en <claudeHome> (solo proyectos de projects.json)` si no, mediante `buildStartupLines({ ..., claude })`.
  - *Cómo se prueba:* test unitario de `buildStartupLines` con `claude: { available: true, claudeHome, projectCount: 3, sessionCount: 7 }` y con `available: false`, comprobando la línea exacta y que las líneas de la fase 2 siguen presentes.

- **R53.** Cuando se consulta la documentación del arnés, el sistema (repo) debe contener en `docs/architecture.md` las cadenas `lib/claude-discovery.js`, `lib/project-catalog.js`, `/api/claude/status`, `CLAUDE_HOME_DIR` y `PATCH /api/projects/:id`, y en `docs/verification.md` una tabla de trazabilidad con el prefijo `[F3-R` para esta feature.
  - *Cómo se prueba:* test estático que lee ambos ficheros y busca cada cadena.
