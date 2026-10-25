# Tareas — Feature 1: Puesto de Mando MUVER (fase 1: base)

> Orden TDD: primero el esqueleto del paquete, luego para cada módulo **tests → implementación**.
> Cada tarea indica los requisitos (R<n>) que cubre. Marca `[x]` al terminar cada una.
> Referencia de contratos: `design.md` §3–§5.

## Fase 0 — Esqueleto

- [x] T1. Crear `panel/package.json` (`"type": "module"`, `"engines": { "node": ">=18" }`, scripts `start: node server.js`, `test: node --test test/`), sin `dependencies`; crear carpetas `panel/lib`, `panel/public`, `panel/test`, `panel/legacy/` (con un `README.md` de una línea explicando su uso, design.md §9) (R27).
- [x] T2. Crear `panel/projects.json` con los 4 proyectos iniciales `app-flyder`, `appcc-real`, `crm-zinergia`, `app-finanzas-restaurante`, cada uno con `path: "C:\\Users\\Usuario\\<nombre>"` (placeholder que el humano ajustará), `appUrl: ""`, `repoUrl: ""`, `tags: []` (R1, R17).
- [x] T3. Crear `panel/test/helpers.js`: `makeTempDir`, `makeProjectDir({ featureList, currentMd, git })` con repo git real (config local de `user.name`/`user.email`), `writeRegistry`, `startApp` en puerto 0 y comprobación `git --version` para `skip` si no hay git (R1, R2, R9).

## Fase 1 — Registro de proyectos (`lib/registry.js`)

- [x] T4. Escribir `panel/test/registry.test.js`: `slugify` ("Mi Proyecto" → `mi-proyecto`, acentos, guiones repetidos); `validateNewProject` rechaza sin name, sin path, ruta relativa, ruta inexistente, ruta a fichero, id con espacios, id duplicado (con el `field` correcto) y acepta un directorio temporal normalizando `path`; `loadRegistry` sin fichero devuelve lista vacía; `saveRegistry` + `loadRegistry` ida y vuelta; `removeProject` (R17, R18, R19, R21).
- [x] T5. Implementar `panel/lib/registry.js` según design.md §5 hasta que pasen los tests de T4 (R17, R18, R19, R21).

## Fase 2 — Lectura de git (`lib/git-info.js`)

- [x] T6. Escribir `panel/test/git-info.test.js`: repo temporal con 1 commit y 1 fichero sin añadir → `isRepo`, `branch`, `lastCommit` (hash 40 chars, fecha parseable), `dirtyCount === 1`; detalle con 2 commits → `recentCommits.length === 2` y `dirtyFiles`; directorio sin `.git` → forma ausente; runner que lanza `ENOENT` → forma ausente; runner espía que verifica `git`, argumentos dentro de `GIT_COMMANDS`, `cwd` y `timeout === 5000` (R2, R9, R10, R12).
- [x] T7. Implementar `panel/lib/git-info.js` (`GIT_COMMANDS`, `defaultRunner`, `getGitInfo`) hasta que pasen los tests de T6 (R9, R10, R12).

## Fase 3 — Estado del proyecto y semáforo (`lib/project-state.js`)

- [x] T8. Escribir en `panel/test/project-state.test.js` los tests de `readFeatureList` (4 features → contadores, `inProgress`, `awaitingApproval`; sin fichero → `present false`; JSON roto → `present true` + `error`) y de `detectBlock`/`readProgress` (valor `—`, vacío, texto de bloqueo, sin fichero, texto con BOM) (R5, R6, R7, R8).
- [x] T9. Escribir en `panel/test/project-state.test.js` los tests de `computeStatus` con `now` fijo: prioridad de `atencion` (spec_ready; bloqueo; spec_ready + in_progress + commit reciente), `en_curso` gana a `inactivo` (commit de hace 30 días), `inactivo` a 15 días vs `ok` a 14 días exactos y a 13 días, `ok` sin arnés y sin git, `ok` con todo `done` y commit de ayer, `ok` en repo sin commits (R13, R14, R15, R16).
- [x] T10. Escribir en `panel/test/project-state.test.js` los tests de `buildSummary`/`buildDetail`: proyecto completo (campos del contrato §3.2/§3.3, sin `path` en la salida); directorio vacío → `sdd.present false` y `status ok`; ruta inexistente → `exists false`, `status no_encontrado` y runner espía nunca invocado (R1, R2, R6, R11).
- [x] T11. Implementar `panel/lib/project-state.js` (`readFeatureList`, `readProgress`, `detectBlock`, `computeStatus`, `INACTIVE_AFTER_MS`, `buildSummary`, `buildDetail`) hasta que pasen T8–T10 (R5, R6, R7, R8, R11, R13, R14, R15, R16).

## Fase 4 — Servidor HTTP (`lib/http-utils.js`, `lib/network.js`, `lib/app.js`, `server.js`)

- [x] T12. Escribir `panel/test/network.test.js`: `buildAccessUrls(4310, interfacesSimuladas)` con una IPv4 interna, una IPv4 externa y una IPv6 devuelve exactamente `['http://localhost:4310', 'http://192.168.1.20:4310']` (R23).
- [x] T13. Implementar `panel/lib/network.js` hasta que pase T12 (R23).
- [x] T14. Escribir `panel/test/api.test.js` (integración con `startApp`): `GET /api/projects` (código, `Content-Type`, 2 proyectos, campos y orden); `GET /api/projects/:id` con detalle (features, `progress.text`, 2 commits, `dirtyFiles`); `404` en id inexistente; `404 { error: "Ruta no encontrada" }` en `GET /api/nada` y `PUT /api/projects` y el servidor sigue respondiendo (R1, R2, R3, R4).
- [x] T15. Añadir a `panel/test/api.test.js` los tests de alta y baja: `POST` válido → `201`, id derivado, persistencia en `projects.json` temporal y aparición en el listado; `400` con `field: "path"` para ruta inexistente / fichero / relativa sin exponer la ruta y sin modificar el registro; `400` con `field` correcto para sin name, sin path, id inválido, id duplicado; `400 { error: "Cuerpo JSON inválido" }` con `{ roto` y servidor vivo; `DELETE` existente → `204`, desaparece del listado y el directorio del proyecto sigue intacto; `DELETE` inexistente → `404` (R17, R18, R19, R20, R21, R22).
- [x] T16. Añadir a `panel/test/api.test.js` los tests de estáticos: `/`, `/styles.css`, `/app.js`, `/manifest.webmanifest` → `200` con `Content-Type` correcto; `/no-existe.html`, `/../package.json`, `/%2e%2e/server.js` → `404` sin rutas del servidor en el cuerpo; manifest parseado con `name`, `short_name`, `start_url "/"`, `display "standalone"`, `background_color`, `theme_color`, `icons[0].src` que responde `200`; `startApp` con `PORT=0` escucha en `0.0.0.0` (R23, R24, R25, R26).
- [x] T17. Implementar `panel/lib/http-utils.js` (`sendJson`, `sendEmpty`, `readJsonBody` con límite 64 KB, `MIME_TYPES`, `serveStatic` con protección contra salida de `public/`) (R20, R24, R25, R26).
- [x] T18. Implementar `panel/lib/app.js` (`createApp` con enrutado de las 4 rutas de la API, `404` JSON para el resto de `/api`, estáticos, captura de excepciones → `500`) hasta que pasen T14–T16 (R1, R2, R3, R4, R17, R18, R19, R20, R21, R22, R24, R25).
- [x] T19. Implementar `panel/server.js`: `PORT` (defecto 4310), `listen(port, '0.0.0.0')`, impresión de las URLs de `buildAccessUrls`; comprobar manualmente `npm start` e imprimir URLs (R23).

## Fase 5 — Frontend (`public/`)

- [x] T20. Escribir `panel/test/render.test.js`: `renderProjectCard` con proyecto completo (clase `status-atencion`, texto "Atención", rama, "Esperando aprobación humana (1)", `href` de `appUrl` con `target="_blank"` y `rel="noopener"`, enlace al repo) y con proyectos sin arnés ("Sin arnés SDD"), sin git ("Sin repositorio git") e inexistente ("Ruta no encontrada" y sin datos de arnés/git); `appUrl` vacío → botón con `aria-disabled="true"` (R28, R29).
- [x] T21. Añadir a `panel/test/render.test.js`: `renderProjectDetail` (features, texto de progreso o "Sin progress/current.md", commits, ficheros modificados, botón "Volver"); `buildProjectPayload` (tags por comas, omisión de vacíos); `renderFormError` (`role="alert"` y texto); `handleDelete` con `confirm` falso (no llama a `request`) y verdadero (llama con `DELETE` y URL correcta); `renderLoadError` (texto y botón "Reintentar"); `REFRESH_INTERVAL_MS === 60000` desde `app-config.js` (R30, R31, R32, R33, R34, R35).
- [x] T22. Implementar `panel/public/render.js` y `panel/public/app-config.js` hasta que pasen T20–T21 (R28, R29, R30, R31, R32, R33, R34, R35).
- [x] T23. Escribir `panel/test/styles.test.js` (tests estáticos): `index.html` contiene `<link rel="manifest" href="/manifest.webmanifest">`, la `<meta name="viewport" …>` y `<script type="module" src="/app.js">`; `styles.css` tiene `.projects` con `grid-template-columns: 1fr` en la regla base, una `@media (min-width: 601px)` con más columnas, ningún `width`/`min-width` en px mayor que 360, un bloque `@media (prefers-color-scheme: dark)` que redefine `--bg` y `--fg`, y las cinco clases `status-*` con color (R26, R36, R37).
- [x] T24. Crear `panel/public/index.html` (encabezado con título "Puesto de Mando MUVER" y hora de última actualización, contenedor `.projects`, formulario "Añadir proyecto" con los 5 campos y elemento de error, contenedor de detalle oculto), `panel/public/manifest.webmanifest` y `panel/public/icon.svg` hasta que pasen los tests de T16 y T23 (R26, R28, R31).
- [x] T25. Crear `panel/public/styles.css` (variables claro/oscuro, grid mobile-first 1 columna → `auto-fill` desde 601 px, padding lateral 16 px, badges de semáforo distinguibles en ambos temas, botones con área táctil ≥ 44 px) hasta que pase T23 (R36, R37).
- [x] T26. Crear `panel/public/app.js`: carga inicial y refresco cada `REFRESH_INTERVAL_MS`, hora de última actualización, pintado con `renderProjectCard`, vista detalle con "Volver", formulario de alta (éxito → nueva tarjeta y formulario vacío; `4xx` → `renderFormError` conservando valores), botón Eliminar con `handleDelete`, estado de error con `renderLoadError` y botón "Reintentar" (R28, R30, R31, R32, R33, R34, R35).
- [ ] T27. Verificación manual documentada (anotar resultado en `progress/current.md` solo vía leader): abrir desde el móvil con la URL LAN impresa; emulador 360×640 sin scroll horizontal; cambiar tema del sistema; parar el servidor con la página abierta; alta con ruta inexistente; "Añadir a pantalla de inicio" (R23, R32, R34, R36, R37).

## Fase 6 — Integración con el arnés

- [x] T28. Editar `init.sh` paso 3: sustituir el comentario por `(cd panel && npm test)` manteniendo `set -e`, de modo que un test fallido haga fallar `init.sh` (R27).
- [x] T29. Rellenar la tabla de trazabilidad de `docs/verification.md` con una fila por requisito R1–R37 y el/los tests que lo cubren (R1, R37).
- [x] T30. Verificar con `./init.sh` desde la raíz: estructura OK, `npm test` del panel en verde, `sdd-lint` con 0 errores (R27).
