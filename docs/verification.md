# docs/verification.md — Estrategia de verificación

> **¿Qué es esto, en cristiano?** Cómo comprobamos que lo construido funciona de
> verdad. La "red de seguridad". Lo usa el reviewer para validar.

## Principio

Cada requisito (R<n>) de `requirements.md` se comprueba con **al menos un test**
automático. Si un requisito no se puede probar, está mal escrito.

## Tipos de prueba (según el proyecto)

- **Tests unitarios:** comprueban una pieza pequeña aislada (una función).
- **Tests de integración:** comprueban que varias piezas funcionan juntas.
- **Comprobación manual:** para cosas visuales o difíciles de automatizar; documéntala.

## Cómo se ejecutan

- Todo se lanza desde `init.sh` (paso 3: `(cd panel && npm test)`, que ejecuta `node --test` sobre `panel/test/*.test.js`; también puede lanzarse a mano con `cd panel && npm test`).
- El reviewer ejecuta `init.sh` y exige que esté **todo en verde** antes de aprobar.

## Mapa de trazabilidad (lo rellena el implementer)

> Tabla que conecta cada requisito con su(s) test(s). El reviewer la verifica.

| Requisito | Test que lo cubre |
|-----------|-------------------|
| R1 | `panel/test/api.test.js` → "[R1] GET /api/projects devuelve el listado…"; `panel/test/project-state.test.js` → "[R1][R2] buildSummary/buildDetail de un proyecto completo…" |
| R2 | `panel/test/api.test.js` → "[R2] GET /api/projects/:id devuelve detalle…"; `panel/test/git-info.test.js` → "[R2] detalle con 2 commits…"; `panel/test/project-state.test.js` → "[R1][R2] buildSummary/buildDetail…" |
| R3 | `panel/test/api.test.js` → "[R3] GET /api/projects/:id inexistente → 404" |
| R4 | `panel/test/api.test.js` → "[R4] rutas /api desconocidas → 404…" y "[R4] excepción inesperada del handler → 500…" |
| R5 | `panel/test/project-state.test.js` → "[R5] readFeatureList cuenta estados…" |
| R6 | `panel/test/project-state.test.js` → "[R6] readFeatureList sin fichero…" y "[R6] buildSummary sobre directorio vacío…" |
| R7 | `panel/test/project-state.test.js` → "[R7] readFeatureList con JSON roto…", "[R7] readFeatureList sin array features…" y "[R7] buildSummary con feature_list.json roto…" |
| R8 | `panel/test/project-state.test.js` → los cuatro tests "[R8] detectBlock: …" y "[R8] readProgress con fichero y con BOM" / "[R8] readProgress sin fichero…" |
| R9 | `panel/test/git-info.test.js` → "[R9] repo con 1 commit y 1 fichero sin añadir" |
| R10 | `panel/test/git-info.test.js` → "[R10] repo sin commits…", "[R10] directorio sin .git…" y "[R10] runner que falla con ENOENT…" |
| R11 | `panel/test/project-state.test.js` → "[R11] buildSummary con ruta inexistente → no_encontrado y runner nunca invocado" y "[R11] computeStatus: !exists…" |
| R12 | `panel/test/git-info.test.js` → "[R12] runner espía: binario git, argumentos permitidos, cwd y timeout 5000" y "[R12] GIT_COMMANDS es la lista cerrada…" |
| R13 | `panel/test/project-state.test.js` → los tres tests "[R13] atencion: …" |
| R14 | `panel/test/project-state.test.js` → "[R14] en_curso gana a inactivo…" |
| R15 | `panel/test/project-state.test.js` → "[R15] inactivo a 15 días; ok a 14 días exactos y a 13 días" |
| R16 | `panel/test/project-state.test.js` → los tres tests "[R16] ok …" |
| R17 | `panel/test/api.test.js` → "[R17] POST /api/projects válido → 201…"; `panel/test/registry.test.js` → tests "[R17] slugify…", "[R17] validateNewProject acepta…", "[R17] loadRegistry…", "[R17] saveRegistry + loadRegistry…" |
| R18 | `panel/test/api.test.js` → "[R18] POST con path inexistente / fichero / relativa → 400…"; `panel/test/registry.test.js` → los tres tests "[R18] validateNewProject rechaza ruta…" |
| R19 | `panel/test/api.test.js` → "[R19] POST sin name / sin path / id inválido / id duplicado…"; `panel/test/registry.test.js` → los cuatro tests "[R19] validateNewProject rechaza…" |
| R20 | `panel/test/api.test.js` → "[R20] POST con JSON roto → 400 … cuerpo > 64 KB también" |
| R21 | `panel/test/api.test.js` → "[R21] DELETE /api/projects/:id → 204…"; `panel/test/registry.test.js` → "[R21] removeProject…" |
| R22 | `panel/test/api.test.js` → "[R22] DELETE /api/projects/:id inexistente → 404" |
| R23 | `panel/test/network.test.js` → los dos tests "[R23] buildAccessUrls…"; `panel/test/api.test.js` → "[R23] la app escucha en 0.0.0.0 con puerto 0"; impresión de URLs: comprobación manual (`npm start`) |
| R24 | `panel/test/api.test.js` → "[R24] estáticos: /, /styles.css, /app.js, /manifest.webmanifest → 200…" |
| R25 | `panel/test/api.test.js` → "[R25] estáticos inexistentes o fuera de public/ → 404 sin revelar rutas" |
| R26 | `panel/test/api.test.js` → "[R26] manifest con los campos exigidos e icono SVG…"; `panel/test/styles.test.js` → "[R26] index.html declara manifest, viewport y el módulo app.js" |
| R27 | Comprobación manual documentada: `./init.sh` en verde; con un `assert.fail()` temporal en un test, `init.sh` termina con código ≠ 0 (ver T27/T30 en `specs/puesto-de-mando-base/tasks.md`) |
| R28 | `panel/test/render.test.js` → "[R28] renderProjectCard con proyecto completo", "[R28] STATUS_LABELS…", "[R28] renderProjectCard escapa HTML…", "[R28] appUrl vacío → botón…", "[R28] relativeDate en español"; `panel/test/styles.test.js` → "[R28][R31] index.html tiene los contenedores…" |
| R29 | `panel/test/render.test.js` → los tres tests "[R29] renderProjectCard sin arnés / sin git / inexistente…" |
| R30 | `panel/test/render.test.js` → "[R30] renderProjectDetail muestra features…" y "[R30] renderProjectDetail sin progress/current.md…"; navegación Detalle/Volver: manual |
| R31 | `panel/test/render.test.js` → "[R31] buildProjectPayload convierte etiquetas y omite vacíos"; `panel/test/styles.test.js` → "[R28][R31] index.html tiene … el formulario de alta con sus 5 campos"; flujo completo: manual |
| R32 | `panel/test/render.test.js` → "[R32] renderFormError devuelve el texto con role=\"alert\""; manual: alta con ruta inexistente |
| R33 | `panel/test/render.test.js` → "[R33] handleDelete no llama a request si se cancela" y "[R33] handleDelete llama a DELETE…" |
| R34 | `panel/test/render.test.js` → "[R34] renderLoadError muestra el mensaje y un botón Reintentar"; manual: parar el servidor con la página abierta |
| R35 | `panel/test/render.test.js` → "[R35] REFRESH_INTERVAL_MS es 60000…"; manual: la hora del encabezado cambia |
| R36 | `panel/test/styles.test.js` → "[R36] .projects es de una columna…", "[R36] ningún width/min-width en píxeles supera 360", "[R36] botones con área táctil mínima de 44 px"; manual: emulador 360×640 sin scroll horizontal |
| R37 | `panel/test/styles.test.js` → "[R37] tema oscuro redefine --bg y --fg…" y "[R37] las cinco clases status-* definen un color"; manual: cambiar el tema del sistema |

## Qué NO se considera verificado

- "Yo lo he probado a mano una vez" no cuenta como test.
- Un test que siempre pasa pase lo que pase (falso positivo) no cuenta.
