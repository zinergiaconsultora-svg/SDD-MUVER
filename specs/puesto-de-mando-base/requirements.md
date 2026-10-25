# Requisitos — Feature 1: Puesto de Mando MUVER (fase 1: base)

> Panel web local que lista los proyectos desarrollados con Claude Code, lee su estado real en disco
> (`feature_list.json`, `progress/current.md`, git), lo muestra en tarjetas con semáforo y acceso directo
> a cada app, permite dar de alta/baja proyectos desde la interfaz y es usable desde el móvil en la red local.
>
> Fuera de alcance (features 2 y 3): ejecutar acciones de desarrollo, capturas de pantalla, notificaciones,
> autenticación.
>
> Convención de este fichero: cada requisito ocupa UNA sola línea (así `sdd-lint.js` lo valida completo) y
> va seguido de su línea *Cómo se prueba*. Los nombres de campos JSON son los contratos definidos en `design.md`.

## Vocabulario

- **Proyecto registrado:** entrada de `panel/projects.json` con `id`, `name`, `path`, `appUrl`, `repoUrl`, `tags`.
- **Arnés SDD:** un proyecto lo tiene cuando existe `<path>/feature_list.json`.
- **Semáforo (`status`):** uno de `atencion`, `en_curso`, `inactivo`, `ok`, `no_encontrado`.
- **Bloqueo declarado:** en `<path>/progress/current.md`, la línea que empieza por `- **Bloqueos / esperando:**` tiene un valor que, tras recortar espacios y pasar a minúsculas, NO está en el conjunto vacío `{"", "—", "-", "–", "ninguno", "(ninguno)", "no"}`.
- **Ahora (`now`):** instante de referencia inyectable en las funciones de cálculo para que los tests de fechas sean deterministas.

## A. API de lectura: listado y detalle

- **R1.** Cuando un cliente hace `GET /api/projects`, el sistema debe responder `200` con `Content-Type: application/json` y un array con un objeto por proyecto registrado, cada uno con los campos `id`, `name`, `appUrl`, `repoUrl`, `tags`, `exists`, `status`, `sdd`, `progress`, `git` según el contrato de `design.md`, en el mismo orden que `projects.json`.
  - *Cómo se prueba:* test de integración que arranca el servidor en puerto 0 con un `projects.json` temporal de dos proyectos (uno con arnés y repo git creado en un directorio temporal, otro sin arnés) y comprueba código, cabecera, longitud y presencia de los campos.

- **R2.** Cuando un cliente hace `GET /api/projects/:id` con un `id` registrado, el sistema debe responder `200` con el resumen del proyecto más los campos de detalle `sdd.features` (array completo de `feature_list.json`), `progress.text` (contenido íntegro de `progress/current.md` o `null`), `git.recentCommits` (hasta 10 commits con `hash`, `date`, `message`) y `git.dirtyFiles` (lista de rutas relativas con cambios sin commitear).
  - *Cómo se prueba:* test de integración sobre el proyecto temporal con arnés y repo: se crean 2 commits y un fichero modificado, y se comprueba que el detalle devuelve ambos commits, la rama y el fichero modificado.

- **R3.** Si un cliente hace `GET /api/projects/:id` con un `id` no registrado, entonces el sistema debe responder `404` con JSON `{ "error": "Proyecto no encontrado" }`.
  - *Cómo se prueba:* test de integración que pide un `id` inexistente y comprueba código y cuerpo.

- **R4.** Si un cliente hace una petición a una ruta `/api/...` que no coincide con ninguna de las rutas definidas (o con un método no soportado), entonces el sistema debe responder `404` con JSON `{ "error": "Ruta no encontrada" }` sin cerrar el proceso.
  - *Cómo se prueba:* test de integración con `GET /api/nada` y `PUT /api/projects` que comprueba código y cuerpo y que una petición posterior sigue respondiendo.

## B. Lectura del estado real en disco

- **R5.** Cuando el directorio del proyecto contiene un `feature_list.json` con JSON válido, el sistema debe devolver `sdd.present = true`, `sdd.counts` con los enteros `pending`, `spec_ready`, `in_progress`, `done` (contando `status` de cada feature; los demás valores se ignoran), `sdd.inProgress` con `{ id, slug, description }` de la primera feature `in_progress` o `null`, y `sdd.awaitingApproval` con el array `[{ id, slug }]` de las features `spec_ready`.
  - *Cómo se prueba:* test unitario de `readFeatureList(dir)` sobre un directorio temporal con un `feature_list.json` de 4 features (1 pending, 1 spec_ready, 1 in_progress, 1 done) que comprueba contadores, `inProgress` y `awaitingApproval`.

- **R6.** Si el directorio del proyecto NO contiene `feature_list.json`, entonces el sistema debe devolver `sdd.present = false`, `sdd.counts = null`, `sdd.inProgress = null`, `sdd.awaitingApproval = []` y seguir calculando el resto del resumen (git, semáforo) sin lanzar error.
  - *Cómo se prueba:* test unitario de `buildSummary` sobre un directorio temporal vacío que comprueba `sdd.present === false` y que `status` es `ok`.

- **R7.** Si `feature_list.json` existe pero su contenido no es JSON válido o no tiene un array `features`, entonces el sistema debe devolver `sdd.present = true`, `sdd.error` con un texto descriptivo, `sdd.counts = null`, y el semáforo debe calcularse como si no hubiera features (sin propagar la excepción).
  - *Cómo se prueba:* test unitario que escribe `{ esto no es json` en el fichero y comprueba `present`, `error` y que `buildSummary` no lanza.

- **R8.** Cuando el directorio del proyecto contiene `progress/current.md`, el sistema debe devolver `progress.present = true`, `progress.blocked` (true solo si hay bloqueo declarado según el Vocabulario) y `progress.blockReason` (el valor de la línea de bloqueos, o `null` si no hay bloqueo).
  - *Cómo se prueba:* test unitario de `detectBlock(text)` con tres textos: valor `—` (no bloqueado), valor vacío (no bloqueado) y valor `esperando aprobación de tests` (bloqueado con ese `blockReason`); más un test sin fichero que comprueba `present === false`.

- **R9.** Cuando el directorio del proyecto es un repositorio git con al menos un commit, el sistema debe devolver `git.isRepo = true`, `git.branch` (nombre de la rama actual, o `HEAD` si está en detached HEAD), `git.lastCommit` con `{ hash, date (ISO 8601), message }` del último commit y `git.dirtyCount` (número de líneas que devuelve `git status --porcelain`).
  - *Cómo se prueba:* test unitario de `getGitInfo(dir)` sobre un repo creado en directorio temporal con `git init`, 1 commit y 1 fichero nuevo sin añadir, que comprueba rama, hash de 40 caracteres, fecha parseable con `Date.parse` y `dirtyCount === 1`.

- **R10.** Si el directorio del proyecto NO es un repositorio git (o `git` no está disponible en el sistema), entonces el sistema debe devolver `git.isRepo = false`, `git.branch = null`, `git.lastCommit = null`, `git.dirtyCount = null`, `git.recentCommits = []` sin lanzar error.
  - *Cómo se prueba:* test unitario de `getGitInfo` sobre un directorio temporal sin `.git` y otro con un `runner` inyectado que simula fallo de ejecución (`ENOENT`), comprobando ambos casos.

- **R11.** Si la ruta `path` del proyecto registrado no existe o no es un directorio, entonces el sistema debe devolver `exists = false`, `status = "no_encontrado"`, `sdd.present = false`, `progress.present = false`, `git.isRepo = false` y no debe invocar `git`.
  - *Cómo se prueba:* test unitario de `buildSummary` con `path` inexistente y un `runner` espía que falla el test si se le llama; comprueba `exists`, `status` y que el espía no fue invocado.

- **R12.** Cuando el servidor ejecuta `git` para un proyecto, el sistema debe invocarlo mediante `child_process.execFile` (sin shell), con una lista fija de argumentos definida en el código, con `cwd` igual a la ruta registrada del proyecto y con un timeout de 5000 ms; ningún dato recibido del cliente HTTP debe formar parte del comando ni de sus argumentos.
  - *Cómo se prueba:* test unitario de `getGitInfo` con `runner` espía que registra cada llamada y comprueba que el binario es `git`, que los argumentos pertenecen al conjunto permitido documentado en `design.md`, que `cwd` es el directorio pasado y que `timeout === 5000`.

## C. Semáforo por proyecto

- **R13.** Cuando el proyecto tiene al menos una feature `spec_ready` O tiene bloqueo declarado en `progress/current.md`, el sistema debe asignar `status = "atencion"`, con prioridad sobre cualquier otra regla.
  - *Cómo se prueba:* test unitario de `computeStatus` con tres entradas: solo spec_ready; solo bloqueo; spec_ready + in_progress + commit reciente; todas devuelven `atencion`.

- **R14.** Cuando el proyecto NO cumple la regla de `atencion` y tiene al menos una feature `in_progress`, el sistema debe asignar `status = "en_curso"`.
  - *Cómo se prueba:* test unitario de `computeStatus` con una feature in_progress y último commit de hace 30 días (debe ganar `en_curso` sobre `inactivo`).

- **R15.** Cuando el proyecto NO cumple las reglas de `atencion` ni `en_curso`, es repositorio git y la fecha de su último commit es anterior a `now - 14 días` (es decir, `now - lastCommit.date > 14 * 24 * 3600 * 1000` ms), el sistema debe asignar `status = "inactivo"`.
  - *Cómo se prueba:* test unitario de `computeStatus` con `now` fijo y commits de hace 15 días (`inactivo`), hace 14 días exactos (`ok`) y hace 13 días (`ok`).

- **R16.** Cuando el proyecto existe y NO cumple ninguna de las reglas `atencion`, `en_curso` ni `inactivo` (incluidos los proyectos sin arnés, sin repo git o repo sin commits), el sistema debe asignar `status = "ok"`.
  - *Cómo se prueba:* test unitario de `computeStatus` con: sin arnés y sin git; con arnés todo `done` y commit de ayer; repo sin commits; todos devuelven `ok`.

## D. Alta y baja de proyectos

- **R17.** Cuando un cliente hace `POST /api/projects` con JSON `{ name, path, appUrl?, repoUrl?, tags?, id? }` donde `name` y `path` no están vacíos, `path` es una ruta absoluta que existe como directorio, y el `id` (recibido o derivado de `name` como slug `[a-z0-9-]+`) no está ya registrado, el sistema debe añadir el proyecto al final de `projects.json` (persistido en disco), responder `201` con el objeto completo registrado y devolverlo en el siguiente `GET /api/projects`.
  - *Cómo se prueba:* test de integración que da de alta un proyecto apuntando a un directorio temporal, comprueba `201`, el `id` derivado (`"Mi Proyecto"` → `mi-proyecto`), que el fichero `projects.json` temporal contiene la entrada y que el listado la devuelve.

- **R18.** Si en `POST /api/projects` la ruta `path` no existe, no es un directorio o no es absoluta, entonces el sistema debe responder `400` con JSON `{ "error": "<mensaje>", "field": "path" }` donde el mensaje explica la causa (por ejemplo "La ruta no existe o no es un directorio") sin incluir la ruta recibida ni rutas del servidor, y no debe modificar `projects.json`.
  - *Cómo se prueba:* test de integración con tres cuerpos: ruta inexistente, ruta a un fichero y ruta relativa; comprueba `400`, `field === "path"`, que `error` no contiene el `path` enviado y que el fichero de registro no cambia.

- **R19.** Si en `POST /api/projects` falta `name` o `path`, el `id` no cumple `^[a-z0-9][a-z0-9-]{0,63}$`, o el `id` ya existe, entonces el sistema debe responder `400` con JSON `{ "error": "<mensaje>", "field": "<name|path|id>" }` indicando el campo problemático.
  - *Cómo se prueba:* test de integración con cuatro cuerpos (sin name, sin path, id con espacios, id duplicado) que comprueba `400` y el `field` correcto en cada caso.

- **R20.** Si el cuerpo de `POST /api/projects` no es JSON válido o supera 64 KB, entonces el sistema debe responder `400` con JSON `{ "error": "Cuerpo JSON inválido" }` sin cerrar el proceso.
  - *Cómo se prueba:* test de integración que envía `{ roto` y comprueba `400` y que el servidor sigue atendiendo peticiones.

- **R21.** Cuando un cliente hace `DELETE /api/projects/:id` con un `id` registrado, el sistema debe eliminar la entrada de `projects.json`, responder `204` sin cuerpo y no tocar ningún fichero dentro de la ruta del proyecto.
  - *Cómo se prueba:* test de integración que da de baja un proyecto, comprueba `204`, que el listado ya no lo incluye y que el directorio del proyecto y su contenido siguen existiendo.

- **R22.** Si un cliente hace `DELETE /api/projects/:id` con un `id` no registrado, entonces el sistema debe responder `404` con JSON `{ "error": "Proyecto no encontrado" }`.
  - *Cómo se prueba:* test de integración con un `id` inexistente.

## E. Servidor, estáticos y acceso desde la red local

- **R23.** Cuando se arranca el servidor (`npm start` en `panel/`), el sistema debe escuchar en la interfaz `0.0.0.0` y en el puerto de la variable de entorno `PORT` (por defecto `4310`), e imprimir en stdout una línea `http://localhost:<puerto>` y una línea `http://<ip>:<puerto>` por cada dirección IPv4 no interna de `os.networkInterfaces()`.
  - *Cómo se prueba:* test unitario de `buildAccessUrls(port, interfaces)` con un objeto de interfaces simulado (una IPv4 interna, una IPv4 externa, una IPv6) que comprueba exactamente las dos URLs esperadas; más test de integración que arranca con `PORT=0` y comprueba que `server.address().address === "0.0.0.0"`.

- **R24.** Cuando un cliente hace `GET /` o `GET /<fichero>` existente en `panel/public/`, el sistema debe responder `200` con el contenido del fichero (`/` sirve `index.html`) y la cabecera `Content-Type` correspondiente a la extensión (`.html`, `.css`, `.js`, `.webmanifest`, `.svg`, `.png`, `.ico`).
  - *Cómo se prueba:* test de integración que pide `/`, `/styles.css`, `/app.js` y `/manifest.webmanifest` y comprueba código y `Content-Type`.

- **R25.** Si un cliente pide una ruta estática que no existe o que, una vez resuelta, queda fuera de `panel/public/` (por ejemplo `/../package.json` o `/%2e%2e/server.js`), entonces el sistema debe responder `404` sin revelar la ruta del sistema de ficheros.
  - *Cómo se prueba:* test de integración con `/no-existe.html`, `/../package.json` y `/%2e%2e/server.js` que comprueba `404` y que el cuerpo no contiene `panel/` ni separadores de ruta absolutos.

- **R26.** Cuando un cliente hace `GET /manifest.webmanifest`, el sistema debe responder `200` con `Content-Type: application/manifest+json` y un JSON con `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, `background_color`, `theme_color` e `icons` con al menos un icono SVG servido desde `public/`; además `index.html` debe contener `<link rel="manifest" href="/manifest.webmanifest">` y `<meta name="viewport" content="width=device-width, initial-scale=1">`.
  - *Cómo se prueba:* test de integración que descarga el manifest, lo parsea y comprueba los campos; test estático que lee `index.html` y busca ambas etiquetas; test que pide la URL del icono y recibe `200`.

- **R27.** Cuando se ejecuta `npm test` dentro de `panel/`, el sistema debe ejecutar todos los ficheros `panel/test/*.test.js` con `node --test` y terminar con código 0 cuando todos pasan; y cuando se ejecuta `init.sh` desde la raíz del repo, el sistema debe ejecutar `cd panel && npm test` y fallar (código distinto de 0) si algún test falla.
  - *Cómo se prueba:* comprobación manual documentada: ejecutar `./init.sh` en verde; introducir un `assert.fail()` temporal y comprobar que `init.sh` termina con error; retirarlo.

## F. Interfaz de usuario (vanilla JS, mobile-first)

- **R28.** Cuando la página `index.html` carga y recibe el listado de `GET /api/projects`, el sistema debe mostrar una tarjeta por proyecto con: nombre, semáforo (clase CSS `status-<status>` y texto en español: Atención / En curso / Inactivo / OK / No encontrado), rama, último commit (fecha relativa y mensaje), contadores de features, la feature en curso (si hay), el texto "Esperando aprobación humana (N)" cuando `awaitingApproval` no está vacío, un botón "Abrir app" que enlaza a `appUrl` en una pestaña nueva (`target="_blank"`, `rel="noopener"`) y un enlace al repositorio si hay `repoUrl`.
  - *Cómo se prueba:* test unitario de la función pura `renderProjectCard(project)` (en `public/render.js`, importable desde Node) con un proyecto completo que comprueba que el HTML resultante contiene la clase de semáforo, el texto de estado, la rama, "Esperando aprobación humana (1)", el `href` de `appUrl` con `target="_blank"` y el enlace al repo.

- **R29.** Si un proyecto tiene `sdd.present = false`, entonces el sistema debe mostrar en su tarjeta el texto "Sin arnés SDD" en lugar de los contadores de features; si tiene `git.isRepo = false`, el texto "Sin repositorio git" en lugar de rama y commit; y si tiene `exists = false`, el texto "Ruta no encontrada" y ningún dato de arnés ni git.
  - *Cómo se prueba:* test unitario de `renderProjectCard` con los tres proyectos (sin arnés, sin git, inexistente) que comprueba la presencia de cada texto y la ausencia de los datos correspondientes.

- **R30.** Cuando el usuario pulsa el botón "Detalle" de una tarjeta, el sistema debe pedir `GET /api/projects/:id` y mostrar una vista de detalle con: la lista completa de features (id, slug, status, description), el contenido de `progress/current.md` (o "Sin progress/current.md"), los últimos commits (fecha, mensaje) y la lista de ficheros con cambios sin commitear, más un botón "Volver" que regresa al listado.
  - *Cómo se prueba:* test unitario de la función pura `renderProjectDetail(detail)` con un detalle de ejemplo que comprueba que el HTML contiene cada feature, el texto de progreso, los commits y los ficheros modificados; la navegación se verifica manualmente.

- **R31.** Cuando el usuario envía el formulario "Añadir proyecto" (campos: nombre, ruta local, URL de la app, URL del repo, etiquetas separadas por comas) y el servidor responde `201`, el sistema debe añadir la tarjeta nueva al listado sin recargar la página y vaciar el formulario.
  - *Cómo se prueba:* test unitario de `buildProjectPayload(formValues)` que comprueba la conversión de etiquetas `"a, b"` → `["a","b"]` y la omisión de campos vacíos; el flujo completo se verifica manualmente con un directorio real.

- **R32.** Si el servidor responde `4xx` al formulario "Añadir proyecto", entonces el sistema debe mostrar el `error` devuelto en un elemento con `role="alert"` junto al formulario y conservar los valores introducidos.
  - *Cómo se prueba:* test unitario de `renderFormError(payload)` que comprueba el texto y el atributo `role="alert"`; verificación manual enviando una ruta inexistente.

- **R33.** Cuando el usuario pulsa "Eliminar" en una tarjeta y confirma en el diálogo de confirmación (`window.confirm`), el sistema debe llamar a `DELETE /api/projects/:id` y retirar la tarjeta del listado; si el usuario cancela, no debe hacer ninguna petición.
  - *Cómo se prueba:* test unitario de `handleDelete(id, { confirm, request })` con `confirm` simulado a `false` (no llama a `request`) y a `true` (llama a `request` con método `DELETE` y la URL correcta).

- **R34.** Si la petición a `/api/projects` falla (error de red o respuesta no `2xx`), entonces el sistema debe mostrar en la página el mensaje "No se pudo cargar el estado de los proyectos" con un botón "Reintentar", en lugar de dejar el listado vacío.
  - *Cómo se prueba:* test unitario de `renderLoadError()` que comprueba el texto y el botón; verificación manual parando el servidor con la página abierta.

- **R35.** Cuando la página lleva abierta 60 segundos (y cada 60 segundos sucesivos mientras siga abierta), el sistema debe volver a pedir `GET /api/projects` cada 60 segundos y actualizar las tarjetas, y debe mostrar la hora de la última actualización en el encabezado.
  - *Cómo se prueba:* test unitario que comprueba la constante `REFRESH_INTERVAL_MS === 60000` exportada por `public/app-config.js`; verificación manual observando que la hora del encabezado cambia.

- **R36.** Cuando el ancho de la ventana es menor o igual a 600 px (incluido 360 px), el sistema debe mostrar las tarjetas en una sola columna, el formulario de alta con los campos apilados y ningún elemento con ancho fijo superior a 360 px, de forma que no aparezca desplazamiento horizontal; a partir de 601 px debe usar una rejilla de 2 o más columnas.
  - *Cómo se prueba:* test estático sobre `styles.css` que comprueba que la regla base de `.projects` es `grid-template-columns: 1fr`, que existe una `@media (min-width: 601px)` con más columnas, y que ningún valor `width`/`min-width` en píxeles supera 360; verificación manual en el navegador con el emulador de dispositivo a 360×640.

- **R37.** Cuando el navegador declara `prefers-color-scheme: dark`, el sistema debe aplicar el tema oscuro (variables CSS de fondo y texto redefinidas en `:root` dentro de `@media (prefers-color-scheme: dark)`), y cuando no lo declara debe aplicar el tema claro; los colores del semáforo deben seguir siendo distinguibles en ambos temas.
  - *Cómo se prueba:* test estático sobre `styles.css` que comprueba la existencia del bloque `@media (prefers-color-scheme: dark)` redefiniendo al menos `--bg` y `--fg`, y que las cuatro clases `status-*` definen un color; verificación manual cambiando el tema del sistema.

## Supuestos y dudas para el leader (no inventados; se marcan para confirmar)

- **S1.** Las rutas reales de los 4 proyectos iniciales se desconocen: se usarán los placeholders `C:\Users\Usuario\<nombre>` indicados por el leader y el humano las ajustará en `panel/projects.json`.
- **S2.** Las `appUrl` de los 4 proyectos iniciales se desconocen: se dejarán vacías (`""`) y la tarjeta mostrará el botón "Abrir app" deshabilitado hasta que el humano las rellene. `appUrl` se trata como opcional en el alta.
- **S3.** El equipo del humano es Windows (rutas `C:\...`): el servidor debe funcionar en Windows y Linux; `git` debe estar en el `PATH` de la máquina que ejecuta el panel.
- **S4.** El `muver.html` actual del humano no está en el repo; no bloquea esta feature (ver `design.md`).
