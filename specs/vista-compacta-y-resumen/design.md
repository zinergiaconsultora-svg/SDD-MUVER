# Diseño — Feature 13: Puesto de Mando MUVER (vista compacta y resumen de cada proyecto)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo solo esta carpeta
> más `docs/conventions.md`. Se construye ENCIMA de las fases 1–4 (`panel/`) **tal como están en disco**, incluida la
> corrección T36 de la fase 4 (el prompt de Claude va por **stdin** y `--allowedTools` es la **última** opción porque
> es variádica). Nada de lo que funciona se rompe; los ajustes de tests existentes están declarados en §7.4.

## 1. Decisiones técnicas (resumen)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | **Vista Lista compacta por defecto** (una fila ≤ 72 px en escritorio, ≤ 96 px a 360 px) y vista Tarjetas conservada pero compactada; la elección se recuerda por dispositivo en `localStorage` (`muver.listPrefs`, con `try/catch`). | Petición literal del humano ("no tengan un widget tan grande"). Es una preferencia de pantalla, no un dato del proyecto: no va al servidor. |
| D2 | **Toda la fila es un botón** que abre el detalle; fijar, ocultar, abrir app y eliminar pasan a un **menú "⋯"** (botón de 44 px). | Una sola acción principal por fila; menos ruido visual y área táctil cómoda en el móvil. Los botones del menú reutilizan el HTML de las fases 1–3, así sus tests siguen valiendo. |
| D3 | **Resumen automático sin coste**: `package.json` → README → `CLAUDE.md`, lectura de los primeros 16 KB, caché en memoria de 5 min por carpeta (`lib/project-summary.js`). | El humano no sabe de qué va cada proyecto; la mayoría tiene README o `package.json`. Leer 3 ficheros pequeños por proyecto cada 5 min es despreciable. |
| D4 | **Resumen guardado en `projects.json`** (`summary`, `summarySource` = `manual`/`claude`, `summaryAt`), editable en Ajustes con `PATCH`. | `projects.json` ya es la capa de ajustes (fase 3); el estado vive en disco. |
| D5 | **Generar con Claude bajo demanda**, nunca automático, con el gestor de runs de la fase 4 en **modo solo lectura** (`--permission-mode default`, `--allowedTools Read,Glob,Grep`, `--disallowedTools` de edición/Bash/web, `--max-turns 10`) y un **prompt fijo** por stdin. Pasa por `gateExec` (interruptor `PANEL_ALLOW_EXEC`, confirmación por el túnel, auditoría) y por los límites de runs. | Cada generación cuesta uso del plan del humano: solo cuando él lo pide y tras confirmar. Solo lectura: no puede tocar el proyecto. Reutilizar el gestor da historial, salida en vivo, cancelación y límites gratis. |
| D6 | **Lote en el servidor** (`POST /api/summaries/generate`): cola en memoria, de uno en uno, una sola confirmación y una sola puerta. | Si el bucle viviera en el navegador, cerrar la pestaña o caducar la confirmación (15 min por el túnel) lo cortaría a medias. |
| D7 | **Worktrees por git, no por nombre**: `git --no-optional-locks rev-parse --git-dir --git-common-dir` (entrada nueva de `GIT_COMMANDS`), clasificación en caché 10 min por carpeta (`lib/repo-layout.js`). | `--git-common-dir` señala al repositorio principal sin adivinar; funciona con git ≥ 2.5 y con worktrees fuera de la carpeta del principal. |
| D8 | **Respuesta plana + agrupación en el cliente**: `GET /api/projects` sigue devolviendo una lista plana (compatible con "Te necesitan" y la fase 4) y cada elemento trae `parentId`/`groupKey`/`worktreeCount`; `public/list.js` arma las filas. | Los consumidores existentes no cambian; los filtros y la búsqueda son locales (sin peticiones extra). |
| D9 | **Worktrees agrupados en modo ligero**: sin `git` (salvo la clasificación en caché); arnés y progreso del disco; rama de la última sesión de Claude. `?worktrees=full` los calcula completos (solo con "Mostrar tareas sueltas"). | Con ~70 worktrees, ahorra ~280 procesos `git` por refresco en Windows. |
| D10 | **Repintado por firma**: cada fila se renderiza a texto HTML (función pura) y ese texto es su firma; `planRowUpdate` compara con la anterior y solo se sustituyen las filas cuya firma cambió. | Más simple que comparar el JSON del modelo de fila **y** el de la tarjeta, y exacto: si el HTML es igual, el DOM no necesita cambiar. El coste de generar 100 cadenas por minuto es despreciable. |
| D11 | **Funciones puras nuevas en `public/list.js`** (agrupar, modelo de fila, filtros, antiguos, firmas, preferencias, textos de confirmación, estado del lote) y cableado mínimo en `public/app.js`. | Mismo patrón de las fases 1–4: lógica testeable en Node sin DOM. |
| D12 | **Rutas nuevas en `lib/summary-api.js`** (`createSummaryApi(deps).route(...)`), que `lib/app.js` solo conecta después de `workApi.route`. | `work-api.js` ya tiene 674 líneas y es de la fase 4 (fuera de alcance tocarlo). |

## 2. Estructura de ficheros

```
panel/
├── lib/
│   ├── project-summary.js       (crear) BOILERPLATE_PATTERNS, SUMMARY_MAX_CHARS, MAX_READ_BYTES, readHead, extractFirstParagraph,
│   │                                    readPackageDescription, findReadme, readAutoSummary, resolveSummary, createSummaryReader
│   ├── repo-layout.js           (crear) classifyRepoLayout, createRepoLayoutCache, isLikelyWorktree, groupKeyFor, groupNameFor
│   ├── summary-api.js           (crear) SUMMARY_PROMPT, SUMMARY_ERRORS, normalizeGeneratedSummary, createSummaryApi (generar, lote, estado, cancelar)
│   ├── git-info.js              (tocar) GIT_COMMANDS + ['--no-optional-locks', 'rev-parse', '--git-dir', '--git-common-dir'] (export CMD_REPO_LAYOUT)
│   ├── claude-cli.js            (tocar) CLI_FLAGS + permissionDefault/disallowedTools/maxTurns; READ_ONLY_TOOLS, READ_ONLY_DENIED_TOOLS,
│   │                                    SUMMARY_MAX_TURNS, buildReadOnlyClaudeArgs
│   ├── runs.js                  (tocar) startClaude({ …, profile }) ('work' | 'readonly'); waitFor(runId)
│   ├── project-catalog.js       (tocar) annotateLayouts, buildLightSummary, resumen en toSummary, opciones layoutCache/summaryReader/fullWorktrees,
│   │                                    worktrees[] y parentName en el detalle
│   ├── registry.js              (tocar) PATCHABLE_FIELDS + 'summary'; SUMMARY_ERRORS de PATCH; normalizeSettings de los campos de resumen;
│   │                                    applySummaryChange, storedSummaryOf
│   └── app.js                   (tocar) crea layoutCache y summaryReader; los pasa a buildCatalog/detalle/PATCH/listCatalog; ?worktrees=full;
│                                        PATCH con summary; conecta summaryApi.route después de workApi.route
├── public/
│   ├── list.js                  (crear) funciones puras de la lista (§6.2)
│   ├── render.js                (tocar) renderProjectCard compacta con menú "⋯"; exporta renderPinButton/renderHideButton/renderOpenApp;
│   │                                    detalle con "De qué va", "Tareas en curso" y enlace al principal; ajustes con resumen;
│   │                                    buildSettingsPayload con summary; buildProjectsUrl(showHidden, { fullWorktrees })
│   ├── app.js                   (tocar) barra de la lista, filtros, búsqueda, vista, preferencias, repintado por filas, menú "⋯",
│   │                                    grupo virtual, generar resumen (individual y lote) y estado del lote
│   ├── index.html               (tocar) barra de la lista (§6.1) y #batch-status
│   └── styles.css               (tocar) fila compacta, chips, menú, barra, tarjeta compacta, antiguos (§6.6)
└── test/
    ├── project-summary.test.js  (crear)  R1–R7
    ├── repo-layout.test.js      (crear)  R26, R27, R30
    ├── summary-api.test.js      (crear)  R8–R25, R28, R29, R31, R32 (integración con startApp)
    ├── list.test.js             (crear)  R33–R43, R47–R49 (puras)
    ├── claude-cli.test.js       (ampliar) R11
    ├── render.test.js           (ampliar) R35, R37, R44–R46
    ├── styles.test.js           (ampliar) R50, R51
    ├── deploy.test.js           (ampliar) R52
    ├── git-info.test.js         (ajustar) lista cerrada con la entrada nueva (§7.4)
    └── fixtures/fake-claude.js  (tocar) flags nuevas y escenario por fichero en el cwd (§7.1)
docs/architecture.md             (tocar) §8 de este diseño
docs/verification.md             (tocar) tabla F13 y fila manual
```

## 3. Modelo de datos

### 3.1 `panel/projects.json` — campos nuevos opcionales por entrada

```json
{
  "id": "crm-rapido",
  "name": "CRM RAPIDO",
  "path": "C:\\Users\\Usuario\\CRM RAPIDO",
  "summary": "CRM para gestionar clientes y propuestas de la consultora",
  "summarySource": "manual",
  "summaryAt": "2026-10-25T10:00:00.000Z"
}
```

- `summary`: texto de 1 a 200 caracteres (puntos de código), espacios colapsados. Si falta, está vacío o no es texto, la entrada no tiene resumen guardado.
- `summarySource`: `"manual"` o `"claude"`. Cualquier otro valor (o ausente con `summary` presente, p. ej. editado a mano) se trata como `"manual"`.
- `summaryAt`: ISO 8601 o ausente.
- `normalizeSettings` conserva los tres campos si `summary` es válido (normalizando `summarySource`) y los elimina si no; las entradas sin ellos no ganan campos nuevos (no se reescribe `projects.json` con valores vacíos).

### 3.2 Clasificación de carpeta (`RepoLayout`, interno)

```
{ kind: 'main' } | { kind: 'worktree', mainPath: string } | { kind: 'none' } | { kind: 'missing' }
```

`missing` = la carpeta no existe o el proyecto no tiene ruta resuelta (sin lanzar git); `none` = git falló por cualquier
motivo (no es repo, git ausente, límite de tiempo, salida inesperada).

### 3.3 Elemento de `GET /api/projects` = fase 3/4 + campos nuevos (siempre presentes)

```json
{
  "...": "campos de las fases 1-4 sin cambios (id, name, status, sdd, progress, git, source, claude, hidden, pinned, lastActivityAt, unresolved...)",
  "summary": "CRM para gestionar clientes y propuestas" ,
  "summarySource": "readme",
  "summaryAt": null,
  "isWorktree": false,
  "parentId": null,
  "parentName": null,
  "groupKey": null,
  "groupName": null,
  "likelyWorktree": false,
  "worktreeCount": 3,
  "detailLevel": "full"
}
```

- `summarySource`: `manual` | `claude` | `package` | `readme` | `claude-md` | `null`. `summaryAt` solo con `manual`/`claude`.
- `isWorktree`: clasificación `worktree`. `parentId`/`parentName`: id y nombre del principal si está en el catálogo
  (aunque esté oculto). `groupKey`/`groupName`: solo si es worktree y su principal NO está en el catálogo.
- `worktreeCount`: en un principal, número de elementos con su `parentId` y `hidden: false`; 0 en el resto.
- `detailLevel`: `"light"` para worktrees con `parentId` o `groupKey` sin `?worktrees=full`; `"full"` en el resto.
- Resumen ligero (`detailLevel: "light"`): misma forma que el de la fase 1, con `sdd` y `progress` leídos del disco,
  `git = { isRepo: true, branch: <gitBranch de la sesión de Claude más reciente que lo tenga, o null>, lastCommit: null,
  dirtyCount: null }`, `exists` real y `status` = `computeStatus` de `project-state.js` con esos datos (sin cambiar su lógica).
- Nunca se exponen `mainPath` ni otras rutas absolutas nuevas.

### 3.4 Detalle (`GET /api/projects/:id`) = detalle actual + campos de §3.3 + `worktrees`

```json
{
  "worktrees": [
    {
      "id": "audit-y-medianoche-41fbca",
      "name": "audit-y-medianoche-41fbca",
      "branch": "claude/audit-y-medianoche-41fbca",
      "lastSessionAt": "2026-10-24T21:10:00.000Z",
      "lastActivityAt": "2026-10-24T21:10:00.000Z",
      "dirtyCount": 2,
      "exists": true,
      "hidden": false,
      "status": "ok",
      "summary": null
    }
  ]
}
```

- Solo en el detalle de un principal (en el resto, `[]`). Incluye los ocultos (`hidden: true`). Orden: `lastSessionAt`
  descendente (null al final), luego nombre.
- Para los 30 primeros se lanza `getGitInfo(dir)` (resumen, sin `detail`) en paralelo: `branch` y `dirtyCount` reales
  (si git falla, `branch` de la sesión y `dirtyCount: null`). Del 31 en adelante, `branch` de la sesión y `dirtyCount: null`.
- En el detalle de un worktree con principal en el catálogo: `parentId` y `parentName` (§3.3).

### 3.5 Run de generación (`RunMeta` de la fase 4)

Idéntico al de la fase 4 con `kind: "claude"`, `action: "summary"`, `label: "Generar resumen"`, `session: { mode: "new",
id: null }` y `promptPreview` = primeros 120 caracteres de `SUMMARY_PROMPT`. Aparece en el historial del proyecto.

### 3.6 Estado del lote (`POST /api/summaries/generate` → `202`, `GET /api/summaries/batch` → `200`)

```json
{
  "batch": {
    "batchId": "b-mh6x1k2a-3f9c",
    "state": "running",
    "startedAt": "2026-10-25T10:00:00.000Z",
    "endedAt": null,
    "total": 3,
    "counts": { "queued": 1, "running": 1, "saved": 1, "failed": 0, "skipped": 0, "cancelled": 0 },
    "items": [
      { "id": "nightshift", "name": "nightshift", "state": "saved", "runId": "…", "error": null },
      { "id": "playground", "name": "playground", "state": "running", "runId": "…", "error": null },
      { "id": "panel-muver", "name": "panel-muver", "state": "queued", "runId": null, "error": null }
    ]
  }
}
```

- `state` del lote: `running` → `done` | `cancelled`. Estados de elemento: `queued`, `running`, `saved`, `failed`,
  `skipped`, `cancelled`. `name` es el del catálogo al crear el lote (o el id si no existe).
- Solo en memoria: se guarda el último lote; al reiniciar el panel, `GET` devuelve `{ "batch": null }`.

## 4. API HTTP

### 4.1 Rutas nuevas y cambiadas (todas detrás de la sesión)

| Método y ruta | Puerta de ejecución | Respuesta |
|---------------|---------------------|-----------|
| `GET /api/projects[?includeHidden=1][&worktrees=full]` | no | `200` lista §3.3 (cambia: campos nuevos y modo ligero) |
| `GET /api/projects/:id` | no | `200` detalle §3.4 (cambia: campos nuevos y `worktrees`) |
| `PATCH /api/projects/:id` con `summary` | no (salvo que traiga campos de ejecución, como en la fase 4) | `200` elemento §3.3 |
| `POST /api/projects/:id/summary/generate` (cuerpo ignorado) | sí, `action: "summary.generate"` | `202` `RunMeta` §3.5 |
| `POST /api/summaries/generate` `{ ids: string[] }` | sí, `action: "summary.batch"`, `detail: { count }` | `202` §3.6 |
| `GET /api/summaries/batch` | no | `200` §3.6 o `{ "batch": null }` |
| `POST /api/summaries/batch/cancel` | no (como cancelar un run) | `202` §3.6; `409` sin lote en marcha |

Las mutaciones siguen exigiendo `X-Requested-With: fetch` (middleware de la fase 3).

### 4.2 Orden en `handleApi`

Sin cambios hasta la sesión; después: `workApi.route` → **`summaryApi.route`** → `routeApi`. `summaryApi.route` devuelve
`true` si la ruta era suya (las cuatro de §4.1 nuevas).

### 4.3 Textos de error exactos

| Clave | Texto | Dónde |
|-------|-------|-------|
| `summaryNotText` | `El resumen debe ser un texto` | `PATCH`, `400`, `field: "summary"` |
| `summaryTooLong` | `El resumen no puede superar 200 caracteres` | `PATCH`, `400`, `field: "summary"` |
| `batchIdsInvalid` | `Indica entre 1 y 50 proyectos` | lote, `400`, `field: "ids"` |
| `batchActive` | `Ya hay una generación de resúmenes en marcha` | lote, `409` |
| `noBatch` | `No hay ninguna generación de resúmenes en marcha` | cancelar lote, `409` |
| `invalidResult` | `Claude no devolvió un resumen válido` | `error` de un elemento `failed` |
| `runEnded(state)` | `La ejecución terminó en estado ${state}` | `error` de un elemento `failed` |
| `noSlot` | `Sin hueco para ejecutar durante 10 minutos` | `error` de un elemento `skipped` |
| `manualKept` | `Se conserva el resumen escrito a mano` | `error` de un elemento `saved` sin sobrescribir (R16) |

Proyecto inexistente, sin carpeta, run activo, máximo de runs, ejecución desactivada, confirmación y CLI no disponible:
**los textos de `WORK_ERRORS` de la fase 4** (se importan de `work-api.js`, no se duplican).

### 4.4 Flujo de `GET /api/projects`

1. `loadSources()` (registro + escaneo de Claude con caché, fase 3) y `mergedCatalog` (fusión + ids, fase 3).
2. Filtro de ocultos (si no `includeHidden`).
3. `layoutCache.get(dir)` para cada elemento con ruta (paralelo; carpeta inexistente → `missing` sin git; caché 10 min).
4. `annotateLayouts(list, layouts)` (§5.3): `isWorktree`, `parentId`/`parentName`, `groupKey`/`groupName`, `likelyWorktree`, `worktreeCount`.
5. Estado de disco: `buildLightSummary` para worktrees agrupados si no `worktrees=full`; `buildSummary` (fase 1) para el resto.
6. Resumen: `resolveSummary(settingsEntry, dir, summaryReader)` (§5.1).
7. `toSummary` + campos nuevos y `sortCatalog` (fase 3, sin cambios).

## 5. Módulos y funciones (contratos)

### 5.1 `lib/project-summary.js` (solo lectura de ficheros del proyecto; nunca escribe)

Constantes: `SUMMARY_MAX_CHARS = 160`, `MAX_READ_BYTES = 16384`, `SUMMARY_CACHE_TTL_MS = 300000`, `MIN_PARAGRAPH_CHARS = 12`,
`README_NAMES = ['readme.md', 'readme.markdown', 'readme.txt', 'readme', 'leeme.md']` (comparación en minúsculas contra
`readdir`), `CLAUDE_MD = 'claude.md'`.

`BOILERPLATE_PATTERNS` (se comparan contra el párrafo ya limpio, en minúsculas, con `startsWith`):

```
'this template provides a minimal setup'
'this project was bootstrapped with'
'this is a next.js project bootstrapped with'
'this file provides guidance to claude code'
'currently, two official plugins are available'
```

- `readHead(file)` → texto o `null`: `open` + `read` de como mucho `MAX_READ_BYTES` en un `Buffer`, `toString('utf8')`
  (los bytes inválidos se convierten en U+FFFD), sin BOM; `null` ante cualquier error (inexistente, directorio, permisos).
- `clip(text, max)`: si tiene más de `max` puntos de código, corta en `max - 1` y, si hay un espacio después de la
  posición `max / 2`, en el último espacio anterior; añade `…`. Total ≤ `max`.
- `readPackageDescription(dir)`: `JSON.parse` del texto; si falla, regex `/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/` y
  `JSON.parse('"' + grupo + '"')`; válido si es texto con algo tras `trim`; colapsa espacios; `clip(…, 160)`.
- `extractFirstParagraph(markdown)` → texto o `null`:
  1. Normaliza `\r\n` → `\n`; quita los comentarios HTML `<!-- … -->` (también multilínea).
  2. Si la primera línea es `---`, salta hasta la siguiente `---` (cabecera YAML).
  3. Recorre las líneas: al ver una valla de código (` ``` ` o `~~~` al inicio, con espacios delante permitidos) salta hasta
     la valla de cierre; separa bloques por líneas en blanco.
  4. Descarta el bloque si su primera línea: empieza por `#`; o la línea siguiente del bloque es solo `=`/`-` (setext);
     empieza por `<` (HTML); empieza por `|` (tabla); empieza por `-`, `*`, `+` seguidos de espacio o por `\d+[.)]` y espacio
     (lista); empieza por 4 espacios o tabulador (código indentado).
  5. Limpia el bloque: quita prefijos `> ` de cita; quita imágenes `!\[[^\]]*\]\([^)]*\)` (también dentro de enlaces);
     enlaces `\[([^\]]*)\]\([^)]*\)` → grupo 1; enlaces de referencia `\[([^\]]*)\]\[[^\]]*\]` → grupo 1; etiquetas HTML
     `<[^>]+>` → espacio; `**`, `__`, `` ` `` y `*`/`_` de énfasis entre letras → nada; colapsa espacios y recorta.
  6. Si el resultado tiene ≥ `MIN_PARAGRAPH_CHARS` puntos de código y alguna letra (`/\p{L}/u`), es el párrafo; si no, sigue
     con el bloque siguiente (así un bloque solo de insignias queda vacío y se salta).
  7. Si el párrafo, en minúsculas, empieza por algún `BOILERPLATE_PATTERNS`, devuelve `null` para ese fichero (R5).
  8. Devuelve `clip(párrafo, 160)`.
- `findReadme(dir)`: `readdir` (con `try/catch`) y primer nombre de `README_NAMES` presente (sin distinguir mayúsculas),
  respetando el orden de la lista.
- `readAutoSummary(dir)` → `{ summary, summarySource } | null`: `package` → `readme` → `claude-md`.
- `createSummaryReader({ now = Date.now, ttlMs = SUMMARY_CACHE_TTL_MS, fsImpl } = {})` → `{ read(dir) }` con caché por
  `pathKey(dir)` (`{ value, at }`, también guarda `null`) y deduplicación de lecturas simultáneas. `fsImpl` inyectable
  para el espía de R6/R7 (por defecto `node:fs/promises`).
- `resolveSummary(entry, dir, reader)` → `{ summary, summarySource, summaryAt }`: `storedSummaryOf(entry)` (§5.8) si
  existe (primero `manual`, después `claude` — solo hay uno guardado por entrada); si no, `reader.read(dir)` (sin `dir`
  → nulos); si no, `{ summary: null, summarySource: null, summaryAt: null }`. Los automáticos llevan `summaryAt: null`.

### 5.2 `lib/repo-layout.js`

- `classifyRepoLayout(dir, { runner = defaultRunner, statFn } = {})`: si `dir` no es directorio → `{ kind: 'missing' }`
  sin git. Si no, `runner('git', [...CMD_REPO_LAYOUT], { cwd: dir, timeout: GIT_TIMEOUT_MS, windowsHide: true })`.
  Error → `{ kind: 'none' }`. Salida: dos primeras líneas no vacías (`gitDir`, `commonDir`; menos de dos → `none`).
  Cada una se resuelve contra `dir` (`path.win32.resolve` si `dir` o la línea tienen forma Windows — git en Windows
  imprime `C:/…` —, si no `path.posix.resolve`). Si `pathKey(gitDir) === pathKey(commonDir)` → `{ kind: 'main' }`.
  Si no → `{ kind: 'worktree', mainPath }` con `mainPath` = carpeta padre de `commonDir` si su último segmento es `.git`
  (sin distinguir mayúsculas), o `commonDir` tal cual (principal *bare*).
- `createRepoLayoutCache({ runner, now = Date.now, ttlMs = 600000, statFn } = {})` → `{ get(dir) }`: comprueba primero
  que `dir` existe (sin caché, barato); si no existe → `missing` sin git; si existe, devuelve la clasificación en caché
  por `pathKey(dir)` si tiene menos de `ttlMs`; si no, clasifica y guarda (deduplica peticiones simultáneas).
- `isLikelyWorktree(merged)`: `folder = lastSegment(merged.path)`; verdadero si `folder` cumple
  `/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{6}$/i` y alguna sesión de `merged.claude.sessions` tiene
  `gitBranch === 'claude/' + folder`. Sin ruta o sin sesiones → falso.
- `groupKeyFor(mainPath)` = `'g-' + sha1(pathKey(mainPath)).hex.slice(0, 10)` (`node:crypto`).
- `groupNameFor(mainPath)` = `lastSegment(mainPath)` sin `.git` final (sin distinguir mayúsculas).

### 5.3 `lib/project-catalog.js` (cambios; lo existente no cambia de firma)

- `annotateLayouts(list, layouts)` (puro; `layouts`: `Map` elemento → `RepoLayout`): índice `pathKey(path)` → elemento
  para todo `list`. Por elemento: `worktree` con principal en el índice (y distinto de él) → `parentId`, `parentName`;
  `worktree` sin principal → `groupKey`, `groupName`; `missing`/`none` → `likelyWorktree = isLikelyWorktree(m)`.
  Después `worktreeCount` de cada elemento = hijos con `hidden: false`. Devuelve copias con los campos de §3.3.
- `buildLightSummary(merged)`: `isDirectory` + `readFeatureList` + `readProgress` (exportados de `project-state.js`, que
  no se toca) + `computeStatus`; forma y `git` de §3.3; si la carpeta no existe, la forma `no_encontrado` de la fase 1.
- `buildCatalog({ registry, discovery, includeHidden, now, runner, layoutCache, summaryReader, fullWorktrees = false })`:
  flujo de §4.4. Si no recibe `layoutCache`/`summaryReader`, crea unos de usar y tirar (sin caché entre llamadas) para
  que los tests y llamadas antiguas sigan funcionando.
- `buildCatalogDetail(merged, opts)` y `buildCatalogSummary(merged, opts)`: reciben además `sources` (para clasificar el
  catálogo completo con la caché y anotar) y añaden §3.3; el detalle añade `worktrees` (§3.4) con `MAX_DETAIL_WORKTREES = 30`.

### 5.4 `lib/claude-cli.js` (añadidos; `buildClaudeArgs` no cambia)

```js
CLI_FLAGS.permissionDefault = 'default';
CLI_FLAGS.disallowedTools = '--disallowedTools';
CLI_FLAGS.maxTurns = '--max-turns';
export const READ_ONLY_TOOLS = Object.freeze(['Read', 'Glob', 'Grep']);
export const READ_ONLY_DENIED_TOOLS = Object.freeze(['Bash', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']);
export const SUMMARY_MAX_TURNS = 10;
```

`buildReadOnlyClaudeArgs()` devuelve exactamente:

```
['-p', '--output-format', 'stream-json', '--verbose',
 '--permission-mode', 'default',
 '--max-turns', '10',
 '--disallowedTools', 'Bash,Edit,MultiEdit,Write,NotebookEdit,WebFetch,WebSearch,Task',
 '--allowedTools', 'Read,Glob,Grep']
```

- `--allowedTools` va **la última** (es variádica, corrección T36) y el prompt va por stdin (como la fase 4).
- `--disallowedTools` refuerza el modo solo lectura aunque el `.claude/settings.json` del proyecto permita más cosas
  (las reglas de denegación ganan a las de permiso). Comprueba `FORBIDDEN_ARGS` igual que `buildClaudeArgs`.
- `CLI_FLAGS` se amplía sin cambiar sus entradas actuales (sigue congelado: se define el objeto completo de nuevo).

### 5.5 `lib/summary-api.js`

```js
export const SUMMARY_PROMPT = 'Lee este proyecto (README, package.json, CLAUDE.md y la estructura de carpetas) sin modificar nada. ' +
  'Responde SOLO con una frase en español de como máximo 140 caracteres que explique qué hace el proyecto y para quién. ' +
  'Sin comillas, sin Markdown y sin ningún otro texto.';
export const GENERATED_MAX_CHARS = 140;
export const BATCH_MAX = 50;
```

- `normalizeGeneratedSummary(text)` → texto o `null`: quita vallas de código (líneas que empiezan por ` ``` `);
  primera línea con contenido; quita viñeta inicial (`-`, `*`, `•`, `\d+.`), `**`/`__`/`` ` ``, prefijo
  `/^resumen\s*:\s*/i`, comillas envolventes (`"…"`, `'…'`, `«…»`, `“…”`); colapsa espacios; vacío → `null`;
  > 140 puntos de código → primeros 139 + `…`.
- `createSummaryApi({ projectsFile, loadSources, workApi, claudeCommand, audit, now, retryDelayMs = 5000,
  retryMaxMs = 600000, sleep })` → `{ route, currentBatch, close }`. Usa `workApi.gateExec`, `workApi.runs`,
  `workApi.store`.
- **Generación individual**: `gateExec(req, res, session, { projectId, action: 'summary.generate' })` → proyecto
  (`findMerged`, `404`) → carpeta (`409 noDir`) → CLI disponible (`409`, igual que la fase 4) →
  `runs.startClaude({ project: { id, dir }, prompt: SUMMARY_PROMPT, session: { mode: 'new' }, action: 'summary',
  label: 'Generar resumen', profile: 'readonly', claudeCommand, auditContext: ctx.auditContext })` → si `!ok`,
  `ctx.respond(status, error)`; si `ok`, `ctx.respond(202, meta, { runId })` y, sin esperar, `afterRun(meta)`.
- **`afterRun(meta)`**: `final = await runs.waitFor(meta.runId)`; si `final.state` no es `succeeded` ni
  `needs_permission` → `failed` (`runEnded`); si no, lee `store.readEvents`, toma el último evento `result`; si no es
  `ok` o `normalizeGeneratedSummary(text)` es `null` → `failed` (`invalidResult`); si no, `saveGenerated(id, text,
  final.startedAt)`. Devuelve `{ state: 'saved'|'failed'|'cancelled', error }` (`cancelled` si `final.state === 'cancelled'`).
- **`saveGenerated(id, text, startedAt)`**: cola de promesas propia (serializa sus escrituras); `loadSources()` fresco,
  `findMerged`; entrada = `settingsEntry` o nueva (como el `PATCH` de la fase 3); si la entrada tiene resumen `manual`
  con `summaryAt ≥ startedAt` → no escribe (`manualKept`, R16); si no, `summary`, `summarySource: 'claude'`,
  `summaryAt: new Date(now()).toISOString()` y `saveRegistry` (atómico, fase 1).
- **Lote**: valida `ids` (lista; textos con `ID_PATTERN`; sin duplicados; 1–`BATCH_MAX`) → `400 batchIdsInvalid`; lote
  en marcha → `409 batchActive`; `gateExec(…, { action: 'summary.batch', detail: { count } })`; crea el estado (§3.6),
  responde `202` y lanza `processBatch` sin esperar. `processBatch`, por elemento en orden:
  1. Si se pidió cancelar → `cancelled`.
  2. `loadSources` + `findMerged`: no existe → `skipped` (`WORK_ERRORS.projectNotFound`); sin carpeta → `skipped` (`noDir`).
  3. `startClaude` (como la individual). `429` → `await sleep(retryDelayMs)` y reintento mientras el tiempo esperado sea
     < `retryMaxMs` y no se cancele; agotado → `skipped` (`noSlot`). `409` → `skipped` (`runActive`). Otro error → `failed`.
  4. Arrancado → `running`, `runId`, `audit.write({ ...auditContext, projectId, action: 'summary.generate', result:
     'started', runId, detail: { batchId } })`, `await afterRun` → `saved`/`failed`/`cancelled`.
  Al final: `state = cancelled` si se pidió cancelar, si no `done`; `endedAt`.
- **Cancelar lote**: sin lote `running` → `409 noBatch`; si no, marca la petición, `runs.cancel(runId actual)`, audita
  `{ action: 'summary.batch.cancel', result: 'ok' }` y responde `202` con el estado. No pasa por `gateExec`.
- `batchId` = `'b-' + now().toString(36) + '-' + randomBytes(2).hex`.
- `close()`: marca cancelación del lote en marcha (lo llama `server.close` junto a `workApi.close`).

### 5.6 `lib/runs.js` (cambios mínimos)

- `startClaude({ …, profile = 'work' })`: `profile === 'readonly'` → `args = buildReadOnlyClaudeArgs()` (ignora
  `allowedCommands` y `session`, siempre conversación nueva); si no, `buildClaudeArgs` como ahora. El prompt sigue yendo
  por stdin (`writePrompt`). Nada más cambia en la máquina de estados.
- `waitFor(runId)` → la promesa `rec.done` (resuelve con el `RunMeta` final) si el run está en memoria; si no, `null`.

### 5.7 `lib/git-info.js`

`GIT_COMMANDS` gana al final `Object.freeze(['--no-optional-locks', 'rev-parse', '--git-dir', '--git-common-dir'])`,
exportada también como `CMD_REPO_LAYOUT`. `getGitInfo` no la usa.

### 5.8 `lib/registry.js`

- `PATCHABLE_FIELDS` + `'summary'` (no entra en `EXEC_FIELDS`).
- `patchValue('summary', v)`: no texto → `summaryNotText`; texto con espacios colapsados y recortado; > 200 puntos de
  código → `summaryTooLong`; si no, `ok` (vale `''`).
- `applySummaryChange(entry, value, nowIso)` (pura): `''` → copia sin `summary`/`summarySource`/`summaryAt`; si no, copia
  con `summary: value`, `summarySource: 'manual'`, `summaryAt: nowIso`.
- `storedSummaryOf(entry)` → `{ summary, summarySource, summaryAt } | null` según §3.1.
- `normalizeSettings` según §3.1.

### 5.9 `lib/app.js`

- Crea `layoutCache = createRepoLayoutCache({ runner: runner || defaultRunner, now })` y
  `summaryReader = createSummaryReader({ now })`; los pasa a `buildCatalog`, `buildCatalogDetail`, `buildCatalogSummary`
  y al `listCatalog` que recibe `createWorkApi` (así "Te necesitan" no lanza git de más).
- `listProjects`: `fullWorktrees = url.searchParams.get('worktrees') === 'full'`.
- `patchProject`: `next = applySummaryChange({ ...entry, ...resto }, changes.summary, iso)` cuando `changes` trae
  `summary`; sin `summary`, como ahora.
- `summaryApi = createSummaryApi({ … })`; en `handleApi`, tras `workApi.route`, `if (await summaryApi.route(…)) return`.
- `server.close` llama también a `summaryApi.close()`.

## 6. Frontend

### 6.1 `index.html` (dentro de `#list-view`, entre `#attention` y `#projects`)

```html
<div class="list-toolbar" id="list-toolbar">
  <div class="search-field">
    <label for="project-search" class="visually-hidden">Buscar proyectos</label>
    <input id="project-search" type="search" autocomplete="off" placeholder="Buscar por nombre, resumen o etiqueta">
  </div>
  <div class="filters" role="group" aria-label="Filtrar proyectos">
    <button type="button" class="filter" data-filter="all" aria-pressed="true">Todos</button>
    <button type="button" class="filter" data-filter="active" aria-pressed="false">Activos</button>
    <button type="button" class="filter" data-filter="pinned" aria-pressed="false">Fijados</button>
    <button type="button" class="filter" data-filter="attention" aria-pressed="false">Te necesitan</button>
  </div>
  <div class="view-toggle" role="group" aria-label="Vista">
    <button type="button" class="view" data-view="list" aria-pressed="true">Lista</button>
    <button type="button" class="view" data-view="cards" aria-pressed="false">Tarjetas</button>
  </div>
  <label class="loose-toggle"><input type="checkbox" id="loose-toggle"> Mostrar tareas sueltas</label>
  <button type="button" class="btn" id="generate-summaries">Generar resúmenes</button>
</div>
<div id="batch-status" class="batch-status" hidden aria-live="polite"></div>
```

### 6.2 `public/list.js` (puro, importable en Node)

Textos y constantes:

- `LIST_PREFS_KEY = 'muver.listPrefs'`; `DEFAULT_LIST_PREFS = { view: 'list', filter: 'all', loose: false }`;
  `FILTERS = ['all', 'active', 'pinned', 'attention']`; `ACTIVE_DAYS = 7`; `OLD_DAYS = 30`.
- `SUMMARY_SOURCE_LABELS = { manual: 'Escrito por ti', claude: 'Generado por Claude', package: 'De package.json',
  readme: 'Del README', 'claude-md': 'De CLAUDE.md' }`; sin resumen: `Sin descripción`.
- Chips (en este orden, solo si aplican): `worktrees` → `1 tarea en curso` / `N tareas en curso`; `approval` →
  `Espera tu aprobación` (`sdd.awaitingApproval.length > 0` del proyecto o de alguna tarea); `claude` → `Claude Code`
  (`source` `claude`/`both`); `parent` → `Tarea de <parentName o groupName>` (solo fila de worktree con tareas sueltas);
  `likely` → `Tarea (probable)`.
- Prioridad del semáforo de un grupo virtual (la peor de sus tareas): `atencion` > `en_curso` > `ok` > `inactivo` > `no_encontrado`.

Funciones:

| Función | Contrato |
|---------|----------|
| `loadListPrefs(storage)` / `saveListPrefs(storage, prefs)` | JSON en `LIST_PREFS_KEY`; valida cada campo contra sus valores; cualquier excepción → defectos / ignorar. |
| `normalizeSearch(text)` | minúsculas, `NFD` sin diacríticos, espacios colapsados. |
| `groupProjects(projects, { loose, showHidden })` | Filas `{ key, kind: 'project'\|'group', project?, worktrees, name, activityAt, pinned }`. Sin `loose`: proyectos sin `parentId` ni `groupKey` (con `worktrees` = hijos visibles) + una fila `group` por `groupKey` (`key: 'g:' + groupKey`); los worktrees cuyo principal no es visible no salen. Con `loose`: una fila por proyecto visible. `activityAt` = máximo de la fila y sus tareas. Orden: fijados → `activityAt` desc (null al final) → nombre (`localeCompare 'es'`) → key. |
| `buildRowModel(row, { now, attentionIds })` | `{ key, kind, id, name, status, statusLabel, summary, summaryLabel, activityAt, activityText, chips, needsYou, pinned, hidden, appUrl, manual, searchText, tags }`. `activityText` = `relativeTime` (render.js) o `Sin actividad`. `needsYou` = semáforo `atencion` propio o de una tarea, o id propio o de una tarea en `attentionIds`. Grupo: `summary` = `N tareas · el repositorio principal no está en el panel`. |
| `filterRows(models, { filter, query, now })` | Búsqueda (§R39) y filtro (§vocabulario). |
| `splitOld(models, { filter, query, now })` | `{ recent, old }`; solo pliega con `all`/`attention` y búsqueda vacía; nunca los fijados. |
| `renderProjectRow(model)` | §6.3. |
| `renderGroupCard(model)` | tarjeta compacta de un grupo virtual (nombre, resumen del grupo, chips, `data-action="group"`). |
| `renderListBody({ recent, old, view, oldOpen, now, projectsById })` | `<ul class="project-list">` (lista) o `<div class="cards">` (tarjetas: `renderProjectCard` / `renderGroupCard`) + `<details class="old-projects"[ open]><summary>Antiguos (N)</summary>…</details>` si hay antiguos; sin filas → `<p class="muted empty-filter">Ningún proyecto coincide con el filtro o la búsqueda</p>` + `<button type="button" class="btn" data-action="clear-filters">Quitar filtros</button>`. |
| `renderItemHtml(model, view, project, now)` | HTML de una fila o tarjeta (su firma). |
| `planRowUpdate(prev, next)` | `prev`: `Map key → html`; `next`: `[{ key, html }]` → `{ changed, toRender: key[], toRemove: key[], order: key[] }`; `changed` falso si mismas claves, mismo orden y mismo HTML. |
| `summaryCandidates(models, { oldOpen, oldKeys })` | `{ ids, total }`: filas `project` sin `summary`, `exists !== false`, `unresolved !== true`, fuera de antiguos plegados; `ids` = primeros 50. |
| `describeSummaryAction(kind, ctx)` | §6.4. |
| `renderBatchStatus(batch)` | En marcha: `Generando resúmenes: X de N` (X = terminados) + `· F fallidos` / `· O omitidos` si > 0 + botón `data-action="cancel-batch"` "Cancelar". Terminado: `Resúmenes generados: S de N` (+ fallidos/omitidos) o `Generación cancelada: S de N`, y botón `data-action="close-batch"` "Cerrar". `null` → `''`. |
| `renderGroupDetail(model, now)` | `<section class="detail group-detail">` con "Volver", nombre, `<p class="muted">El repositorio principal de estas tareas no está en el panel.</p>` y `<ul class="worktree-list">` con nombre, rama, actividad y `data-action="detail"` "Ver detalle". |

### 6.3 Marcado de la fila y de la tarjeta

```html
<li class="project-row status-atencion" data-key="p:crm-rapido">
  <button type="button" class="row-main" data-action="detail" data-id="crm-rapido">
    <span class="dot status-atencion" aria-hidden="true"></span><span class="visually-hidden">Estado: Atención</span>
    <span class="row-name">CRM RAPIDO</span>
    <span class="row-chips"><span class="chip chip-worktrees">3 tareas en curso</span>…</span>
    <time class="row-time" datetime="…">hace 2 h</time>
    <span class="row-summary">CRM para gestionar clientes…</span>   <!-- o class="row-summary is-empty" "Sin descripción" -->
  </button>
  <div class="row-menu">
    <button type="button" class="btn icon row-menu-button" data-action="menu" aria-haspopup="true" aria-expanded="false"
            aria-controls="menu-crm-rapido" aria-label="Más acciones de CRM RAPIDO">⋯</button>
    <div class="row-menu-list" id="menu-crm-rapido" role="menu" hidden>
      <!-- renderPinButton, renderHideButton, renderOpenApp (con aria-disabled sin URL), Eliminar solo en manuales -->
    </div>
  </div>
</li>
```

- Fila de grupo virtual: `data-key="g:<groupKey>"`, botón principal con `data-action="group" data-group="<groupKey>"`,
  sin menú "⋯".
- `renderProjectCard(project, now, { worktreeCount } = {})`: se mantiene el `<article class="card …">` y su cuerpo de las
  fases 1–3; se añade `<p class="card-summary">` (o `is-empty`) tras la cabecera; la cabecera queda dentro de un
  `<button class="card-main" data-action="detail">`; el `<footer class="card-actions">` se sustituye por el mismo
  `<div class="row-menu">` de la fila, que contiene **exactamente** los botones/enlaces que había (Abrir app, Repositorio,
  fijar, ocultar, Eliminar). Así los tests de R28/R29 de la fase 1 y F3 siguen en verde.

### 6.4 Textos de confirmación (`describeSummaryAction`, todo escapado)

- `summary`: `Se lanzará Claude Code en modo solo lectura en ${nombre} (puede leer ficheros; no puede editarlos ni
  ejecutar comandos) para escribir una frase sobre de qué va el proyecto. Es una ejecución de Claude y consume uso de
  tu plan.` + (con resumen previo) ` Sustituirá el resumen actual.`
- `summary-batch`: `Se lanzará Claude Code en modo solo lectura, uno detrás de otro, en ${n} ${n === 1 ? 'proyecto' :
  'proyectos'} sin descripción para escribir su resumen. Cada proyecto es una ejecución de Claude y consume uso de tu
  plan.` + (si `total > 50`) ` Hay ${total} sin descripción: solo se procesan los primeros 50.`
- Con 0 candidatos el botón "Generar resúmenes" queda `disabled` con `title="No hay proyectos visibles sin descripción"`.

### 6.5 Flujo en `app.js`

- **Arranque**: `prefs = loadListPrefs(window.localStorage)` (envuelto: si el acceso a `localStorage` lanza, `null`);
  aplica `aria-pressed` de filtros y vista y la casilla.
- **Carga**: `buildProjectsUrl(true, { fullWorktrees: prefs.loose })` (añade `&worktrees=full`). Tras cada carga y en
  cada cambio de filtro/búsqueda/vista: `groupProjects` → `buildRowModel` (con los `projectId` de la última respuesta de
  `/api/attention` como `attentionIds`) → `filterRows` → `splitOld` → `renderItemHtml` por fila.
- **Repintado**: si cambió la vista, el número de antiguos pasó de 0 a > 0 o al revés, o hay mensaje de vacío → pinta
  `renderListBody` completo (conservando `oldOpen` y el foco del buscador). Si no → `planRowUpdate` sobre cada contenedor
  (`ul.project-list` principal y el de antiguos): sustituye solo `toRender` (crea el nodo con un `<template>`), quita
  `toRemove` y reordena con `append` solo si cambia `order`. `Map key → { html, el }` en memoria.
- **Búsqueda**: `input` con espera de 150 ms. No se guarda en preferencias.
- **Menú "⋯"**: `data-action="menu"` alterna `hidden` y `aria-expanded`; `Escape` o un clic fuera lo cierra; un solo
  menú abierto. Las acciones del menú reutilizan `runCardToggle`, `deleteProject` (fase 3).
- **Grupo virtual**: `data-action="group"` → `renderGroupDetail` en `#detail` (sin petición); "Ver detalle" → `showDetail(id)`.
- **Detalle**: "Generar con Claude" → `confirmAction(describeSummaryAction('summary', …))` → `execRequest(POST
  …/summary/generate, body '{}')` → muestra `Generando resumen con Claude…` y consulta `GET /api/runs/:runId` cada
  2 s hasta un estado final → recarga el detalle (y la lista); si no se guardó, `No se pudo generar el resumen
  (<STATE_LABELS[estado]>)`. "Tareas en curso": "Ver detalle" → `showDetail`; "Ocultar"/"Mostrar" → `toggleHidden` y
  recarga el detalle.
- **Lote**: `summaryCandidates` → confirmación → `execRequest(POST /api/summaries/generate, { ids })` → `#batch-status`
  visible con `renderBatchStatus`; consulta `GET /api/summaries/batch` cada 3 s mientras `running` y recarga la lista
  cuando cambia `counts.saved`; "Cancelar" → `POST /api/summaries/batch/cancel`; "Cerrar" oculta el estado. Al arrancar
  el panel se consulta una vez `GET /api/summaries/batch` y, si hay uno `running`, se retoma la consulta.
- **Ajustes**: el campo "De qué va" lleva `data-initial`; `buildSettingsPayload` recibe `summaryInitial`.

### 6.6 `styles.css`

- Variables nuevas en `:root` y en `@media (prefers-color-scheme: dark)`: `--chip-bg`, `--chip-fg`, `--chip-approval`,
  `--chip-worktrees`, `--row-hover`.
- `#projects.view-list` (y `.project-list`): `display: block`; anula la rejilla de 3 columnas en la lista (desde 601 px
  la regla de rejilla sigue aplicando solo a `.cards`).
- **Regla base (móvil)**: `.project-row { position: relative; max-height: 96px; overflow: hidden; border-bottom: 1px
  solid var(--border); }`; `.row-main { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; grid-template-areas:
  "dot name time" "sum sum sum" "chips chips chips"; gap: 2px 8px; width: 100%; min-height: 44px; padding: 8px 52px 8px 12px;
  text-align: left; }`; `.row-name { font-weight: 600; line-height: 20px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }`; `.row-summary { grid-area: sum; line-height: 18px; display: -webkit-box;
  -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }`; `.row-chips { grid-area: chips;
  white-space: nowrap; overflow: hidden; line-height: 18px; }`; `.chip { font-size: 12px; padding: 0 6px; border-radius: 9px; }`.
  Presupuesto de altura: 8 + 20 + 2 + 36 + 2 + 18 + 8 = 94 px ≤ 96 px.
- **`@media (min-width: 601px)`**: `.project-row { max-height: 72px; }`; `.row-main { grid-template-columns: 12px auto
  minmax(0, 1fr) auto; grid-template-areas: "dot name chips time" "dot sum sum sum"; padding: 10px 56px 10px 12px; }`;
  `.row-summary { display: block; white-space: nowrap; text-overflow: ellipsis; }`. Altura: 10 + 20 + 2 + 18 + 10 = 60 px ≤ 72 px.
- `.row-menu { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); }`; `.row-menu-button {
  min-width: 44px; min-height: 44px; }`; `.row-menu-list { position: absolute; right: 0; z-index: 5; max-width: 260px; }`
  (la fila deja `overflow: visible` mientras su menú está abierto: clase `.menu-open`).
- `.card { max-height: 220px; overflow: hidden; }` con `.card-summary` recortado a 2 líneas; `.cards` en rejilla de
  1 columna en la base y `repeat(auto-fill, minmax(260px, 1fr))` desde 601 px.
- `.list-toolbar` en columna en la base, en fila con `flex-wrap` desde 601 px; `.filter`/`.view` con `min-height: 44px`
  y estilo `[aria-pressed="true"]`; `.old-projects > summary` con `min-height: 44px`.
- Ningún `width`/`min-width` fijo > 360 px (test existente).

## 7. Tests (`node --test`, sin dependencias)

### 7.1 Fixtures

- `fake-claude.js` (cambios compatibles): `VALUE_FLAGS` + `--max-turns`; `VARIADIC_FLAGS` + `--disallowedTools`; registra
  también `disallowedTools`. **Escenario por fichero**: si el `cwd` contiene `.fake-claude-scenario`, su primera línea es
  el escenario (tiene prioridad sobre la marca del prompt) y la segunda, opcional, el texto del `result`. Escenarios
  nuevos: `summary` (init + una lectura `Read` + `result` con el texto de la segunda línea o `Un CRM de prueba para
  gestionar clientes.`), `summary_slow` (igual tras 1 500 ms) y `blank` (`result` de solo espacios). Los escenarios
  existentes (`error`, `hang`, …) sirven también por fichero.
- Helpers nuevos en `test/summary-helpers.js`: `makeRepoWithWorktrees(names)` (repo principal con un commit + `git
  worktree add ../<name> -b claude/<name>` por nombre; `hasGit()` o se salta), `writeScenario(dir, name, text)`,
  `waitForBatch(app, cookie, states)`, `waitForRegistry(file, predicate)`.
- READMEs de ejemplo como cadenas en `project-summary.test.js` (badges, `<p align="center">`, YAML, comentarios,
  código, setext, plantillas de Vite/CRA/Next, `CLAUDE.md` de plantilla).

### 7.2 Reparto

| Fichero | Requisitos |
|---------|------------|
| `project-summary.test.js` | R1–R7 |
| `repo-layout.test.js` | R26, R27, R30 (unitarios) |
| `claude-cli.test.js` | R11 |
| `summary-api.test.js` | R8–R10, R12–R25, R28, R29, R31, R32 |
| `list.test.js` | R33, R34, R36, R38–R43, R47–R49 |
| `render.test.js` | R35, R37, R44–R46 |
| `styles.test.js` | R50, R51 |
| `deploy.test.js` | R52 |

### 7.3 Prefijos

Tests con prefijo `[F13-R<n>]`. Los de integración usan `startApp` (CLI falso, `claudeHome` y datos temporales).

### 7.4 Compatibilidad con los tests existentes

- `git-info.test.js` → "[R12][F4-R61] GIT_COMMANDS es la lista cerrada…": se añade la entrada nueva al `deepEqual`
  (cambio declarado). El runner espía que solo admite comandos de la lista sigue valiendo.
- Tests que cuentan llamadas exactas al runner en `buildCatalog`/`GET /api/projects`: la clasificación añade una llamada
  por carpeta existente (en caché después). Si alguno falla por el número, se ajusta citando `F13-R26`.
- Tests que comparan con `deepEqual` un elemento completo del catálogo: se amplían con los campos nuevos de §3.3.
- `buildSettingsPayload` sin `summary`/`summaryInitial` devuelve los cuatro campos de siempre (sin cambios).
- `buildProjectsUrl(showHidden)` con un solo argumento devuelve las mismas URL que ahora.
- `renderProjectCard`: los tests de la fase 1 y F3 siguen en verde sin cambios (§6.3).

## 8. Documentación

- `docs/architecture.md`: en "Tipo de aplicación", la feature 13 (vista compacta y resumen); en "Piezas": campos
  `summary`/`summarySource`/`summaryAt` de `projects.json`, `lib/project-summary.js` (lectura acotada + caché 5 min),
  `lib/repo-layout.js` (git common dir, caché 10 min, entrada nueva de `GIT_COMMANDS`), `lib/summary-api.js` (generación
  en solo lectura y lote), `public/list.js`; en "Cómo se comunican": `?worktrees=full`, campos nuevos (`worktreeCount`,
  `parentId`, `groupKey`, `likelyWorktree`, `detailLevel`), `POST /api/projects/:id/summary/generate`,
  `POST /api/summaries/generate`, `GET /api/summaries/batch`, `POST /api/summaries/batch/cancel`; en "Restricciones":
  Claude en solo lectura para los resúmenes (`Read`, `Glob`, `Grep`; nunca edición ni `Bash`).
- `docs/verification.md`: párrafo de prefijo `[F13-R<n>]` en "Cómo se ejecutan" y tabla "Feature 13:
  `vista-compacta-y-resumen` (prefijo `[F13-R<n>]`)" con una fila por requisito R1–R54 y la fila manual.

## 9. Ficheros que NO se tocan

- `panel/lib/auth.js`, `panel/lib/sessions.js`, `panel/lib/rate-limit.js`, `panel/lib/cf-access.js`, `panel/lib/reauth.js`,
  `panel/lib/audit.js`, `panel/lib/work-api.js`, `panel/lib/command-runner.js`, `panel/lib/exec-utils.js`,
  `panel/lib/git-actions.js`, `panel/lib/sdd-actions.js`, `panel/lib/run-store.js`, `panel/lib/sse.js`,
  `panel/lib/project-state.js`, `panel/lib/path-key.js`, `panel/lib/http-utils.js`, `panel/lib/config.js`,
  `panel/lib/claude-discovery.js` (sigue en solo lectura sobre `~/.claude`), `panel/server.js`,
  `panel/public/work.js`, `panel/public/api-client.js`, `panel/public/app-config.js`, `panel/deploy/`, `panel/scripts/`,
  `panel/projects.json`.
- `.claude/`, `CLAUDE.md`, `docs/specs.md`, `docs/constitution.md`, `docs/conventions.md`, `sdd-lint.js`, `init.sh`,
  specs de las fases 1–4. `feature_list.json` y `progress/` los gestiona solo el leader.
- Nada escribe en las carpetas de los proyectos (el resumen automático solo lee; la generación usa Claude sin
  herramientas de escritura) ni en `~/.claude`.

## 10. Alternativas consideradas y descartadas

| Alternativa | Por qué se descarta |
|-------------|---------------------|
| Generar con Claude los resúmenes de todos los proyectos al arrancar | Coste: ~90 ejecuciones de Claude con cada arranque o proyecto nuevo, sin que el humano lo pida. Los automáticos cubren la mayoría gratis; el resto, bajo demanda y confirmado. |
| Agrupar worktrees solo por el nombre (`<slug>-<hex6>` + rama `claude/<slug>`) | Frágil: no dice de qué repo son, falla con nombres puestos a mano y agruparía carpetas que no lo son. Se usa solo como marca (`likelyWorktree`) cuando git no responde. |
| Agrupar en el servidor y devolver filas anidadas | Rompería el contrato plano que usan "Te necesitan" y la fase 4; el cliente ya tiene todo para agrupar y filtrar. |
| Firma JSON del modelo de fila | Equivalente para la lista, pero la tarjeta usa más campos (git, arnés); la firma por HTML cubre las dos vistas con una sola regla. |
| Paginación o lista virtual | Con ~100 filas compactas no hace falta; añadiría complejidad sin beneficio visible. |
| Bucle del lote en el navegador | Se corta al cerrar la pestaña o al caducar la confirmación por el túnel; el servidor ya tiene el gestor de runs. |
| `acceptEdits` con lista vacía para generar | Seguiría permitiendo editar ficheros; el modo `default` + `Read,Glob,Grep` + `--disallowedTools` es solo lectura de verdad. |
| Guardar las preferencias de la vista en el servidor | Es una preferencia por dispositivo (móvil en lista, PC en tarjetas); el humano lo pidió así. |
| Resumen con IA local o heurística de código | Sin dependencias ni modelos locales en el panel; el README/`package.json` ya suele decir de qué va. |

## 11. Riesgos y notas de implementación

- **Concurrencia en `projects.json`:** `PATCH`, permisos (fase 4) y `saveGenerated` hacen lectura-modificación-escritura.
  `saveGenerated` relee justo antes de escribir y serializa sus propias escrituras; la ventana con un `PATCH` simultáneo
  es de milisegundos y la escritura es atómica (`.tmp` + `rename`), así que no se corrompe el fichero.
- **Rutas de git en Windows:** `rev-parse` imprime `C:/…/.git`; `pathKey` normaliza separadores y mayúsculas, por eso las
  comparaciones usan siempre `pathKey`.
- **Proyecto que es subcarpeta de un repo** (p. ej. `panel/` dentro de otro): `--git-dir` y `--git-common-dir` coinciden
  → `main`; no se agrupa con nada (correcto: no es un worktree).
- **Worktrees borrados:** carpeta inexistente → `missing` → solo `likelyWorktree` (supuesto S3 de `requirements.md`).
- **Altura de fila:** depende de la fuente del sistema; el presupuesto de §6.6 usa `line-height` fijos en píxeles y
  `max-height` con `overflow: hidden` como tope duro. El implementer lo comprueba con un navegador sin cabeza a 360×780
  y 1280×800 (como en la fase 4, fuera del repo) y el humano en su PC (R54).
- **CLI real:** `--permission-mode default`, `--disallowedTools` y `--max-turns` se confirman con `claude --help` en la
  tarea manual; están en `CLI_FLAGS`.
- **`needs_permission` en la cola:** un run de resumen que intente una herramienta denegada termina `needs_permission` y
  aparece en "Te necesitan" (supuesto S2); su resumen se guarda igualmente si el resultado es válido.
