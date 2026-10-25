# Diseño — Feature 3: Puesto de Mando MUVER (fase 3: descubrimiento de proyectos de Claude Code)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo solo esta
> carpeta más `docs/conventions.md`. Se construye ENCIMA de las fases 1 y 2 (`panel/`): nada de lo que funciona
> se rompe; los tests existentes siguen en verde (ver §6.4 sobre el orden del listado).

## 1. Decisiones técnicas (resumen)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | **Leer los datos locales de Claude Code tal cual** (`<claudeHome>/.claude.json` y `<claudeHome>/.claude/projects/*/*.jsonl`) con `node:fs` nativo, sin dependencias npm. | Es donde Claude Code CLI guarda qué proyectos se han abierto y sus sesiones; el servidor corre en el mismo PC Windows. Mantiene la regla "cero dependencias". |
| D2 | **Solo lectura absoluta** sobre `~/.claude`: `lib/claude-discovery.js` importa únicamente funciones de lectura y un test estático lo comprueba. | Requisito explícito del humano. Un bug nunca debe tocar el historial de Claude. |
| D3 | **Tolerancia al formato**: toda línea `.jsonl` que no parsee o no tenga el campo esperado se ignora; el fichero de configuración roto se ignora con un aviso; ficheros grandes se leen solo por cabecera. | El formato de Claude Code no está documentado y cambia entre versiones; el panel no debe caerse por un cambio. |
| D4 | **Ruta real por `cwd`**, con respaldo en las claves de `.claude.json` codificadas; si nada casa, el proyecto se lista como no resuelto. | La ruta codificada (`C--Users-...`) no es reversible (`-` puede venir de `/`, `\`, `:` o de un guion real). |
| D5 | **Comparación de rutas por clave normalizada** (`lib/path-key.js`): Windows sin distinguir mayúsculas y con `\`; POSIX literal. Detecta el tipo por la forma de la cadena, no por `process.platform`. | Los tests corren en Linux pero `projects.json` tiene rutas `C:\...`; `path.resolve` en Linux las estropearía. |
| D6 | `projects.json` pasa a ser **capa de ajustes** fusionada por clave de ruta; `lib/project-catalog.js` hace la fusión, asigna ids, aplica orden y ocultos. `lib/project-state.js` **no cambia**. | Separar descubrimiento (Claude), ajustes (JSON) y estado de disco (fase 1) mantiene cada módulo pequeño y testeable. |
| D7 | **Caché en memoria** por fichero de sesión, clave `(ruta, mtimeMs, size)`, más un TTL de 30 s para el escaneo completo; `scan({ force })` lo salta. Inyectables `now` y `ttlMs`. | Con decenas de sesiones (ficheros de MB) parsear en cada `GET /api/projects` (cada 60 s desde cada cliente) sería costoso; el `mtime` detecta cambios sin releer. Excepción documentada a la regla "sin caché" de la fase 1 (solo afecta a los datos de Claude; el estado de disco sigue leyéndose en cada petición). |
| D8 | `GET /api/projects` **sigue devolviendo un array** (no se rompe la fase 1); la meta de Claude va en una ruta nueva `GET /api/claude/status`. | Compatibilidad con los tests y la UI existentes. |
| D9 | `PATCH /api/projects/:id` para ajustes parciales; sobre un proyecto solo de Claude **crea** la entrada de ajustes con su `path`. `DELETE` solo para proyectos manuales (`409` en `claude` y `both`). | Un proyecto detectado no se puede "borrar" (volvería en el siguiente escaneo): se oculta. Eliminar la entrada de un `both` perdería los ajustes sin quitar el proyecto; se evita. |
| D10 | Anti-CSRF: `MUTATING_METHODS` pasa a ser "todo método distinto de `GET`/`HEAD`" (mejora M6 del reviewer de la fase 2). | Cubre `PATCH` ahora y `PUT` u otros en el futuro sin tocar la lista. |
| D11 | Ids de proyectos de Claude: `slugify(último segmento)` desambiguado con `-2`, `-3` en orden alfabético de clave de ruta, con prioridad a los ids manuales. | Ids legibles en la URL y estables entre escaneos (no dependen de la actividad). Un `PATCH` los fija en `projects.json`. |
| D12 | UI mobile-first con funciones puras en `render.js` (badge, actividad, fijar/ocultar, sesiones, ajustes) y lógica mínima en `app.js`. | Mismo patrón de las fases 1 y 2: todo lo que se pinta se prueba en Node sin DOM. |

## 2. Estructura de ficheros

```
panel/
├── server.js                   (tocar) pasa claudeHome a createApp; imprime la línea "Claude Code: …"
├── projects.json               (NO tocar) las 4 entradas iniciales quedan como ajustes; el humano pondrá rutas reales
├── lib/
│   ├── path-key.js             (crear) isWindowsPath, pathKey, lastSegment, encodeProjectPath, looseEncodedKey
│   ├── claude-discovery.js     (crear) discoverClaudeProjects, createClaudeDiscovery, parseSessionFile, constantes
│   ├── project-catalog.js      (crear) mergeProjects, assignIds, sortCatalog, buildCatalog, buildCatalogDetail
│   ├── registry.js             (tocar) normalizeSettings en loadRegistry; validatePatch; upsertSettings; PATCHABLE_FIELDS
│   ├── config.js               (tocar) readConfig → claudeHome; buildStartupLines → línea de Claude
│   ├── app.js                  (tocar) opción claudeHome/claudeCacheTtlMs; MUTATING = !GET/HEAD; rutas PATCH, /api/claude/status, includeHidden, DELETE 409
│   ├── http-utils.js           (NO tocar)
│   ├── project-state.js        (NO tocar)
│   ├── git-info.js             (NO tocar)
│   ├── auth.js, sessions.js, rate-limit.js, public-url.js, tunnel.js, network.js   (NO tocar)
├── public/
│   ├── index.html              (tocar) #claude-notice, #hidden-toggle; pie
│   ├── styles.css              (tocar) .badge.source-claude, .card.pinned, .card.is-hidden, .claude-activity, .sessions, .notice, .settings-form, .btn.icon
│   ├── render.js               (tocar) renderProjectCard/Detail ampliados + renderHiddenToggle, renderClaudeNotice, renderSettingsForm, buildSettingsPayload, patchProject, togglePin, toggleHidden, buildProjectsUrl, relativeTime
│   ├── app.js                  (tocar) estado showHidden, claudeStatus; acciones pin/hide/toggle-hidden; formulario de ajustes en el detalle
│   ├── api-client.js           (NO tocar) ya añade X-Requested-With a cualquier método
│   └── app-config.js           (NO tocar)
├── scripts/, deploy/           (NO tocar)
└── test/
    ├── helpers.js              (tocar) startApp acepta claudeHome (por defecto: temporal vacío) y claudeCacheTtlMs: 0
    ├── claude-fixtures.js      (crear) makeClaudeHome, writeSession, sessionLine, snapshotTree
    ├── claude-discovery.test.js (crear) descubrimiento, resolución, títulos, fechas, truncado, caché, solo lectura
    ├── path-key.test.js        (crear) pathKey, encodeProjectPath, lastSegment
    ├── project-catalog.test.js (crear) mergeProjects, assignIds, sortCatalog
    ├── claude-api.test.js      (crear) integración: /api/claude/status, listado fusionado, includeHidden, detalle, PATCH, DELETE 409, POST both, CSRF PATCH/PUT
    ├── registry.test.js        (tocar) normalizeSettings, validatePatch, upsertSettings
    ├── config.test.js          (tocar) claudeHome, línea de Claude
    ├── render.test.js          (tocar) nuevas funciones puras
    ├── styles.test.js          (tocar) huecos nuevos y selectores
    └── deploy.test.js          (tocar) cadenas de docs/architecture.md y docs/verification.md (F3)

docs/architecture.md            (tocar) fase 3: descubrimiento, catálogo, rutas nuevas, variable CLAUDE_HOME_DIR, caché
docs/verification.md            (tocar) tabla de trazabilidad de la feature 3 (prefijo [F3-R<n>])
```

## 3. Modelo de datos

### 3.1 Datos de Claude Code (entrada; se leen, nunca se escriben)

`<claudeHome>/.claude.json` (solo nos interesa `projects`):

```json
{
  "projects": {
    "C:\\Users\\Usuario\\app-flyder": {
      "allowedTools": [],
      "history": [
        { "display": "implementa la siguiente tarea pendiente", "pastedContents": {} },
        { "display": "revisa los tests" }
      ]
    },
    "/home/user/SDD-MUVER": {}
  }
}
```

`<claudeHome>/.claude/projects/<ruta codificada>/<sessionId>.jsonl` — una línea JSON por evento. Ejemplos de líneas que el panel entiende (cualquier otro campo se ignora):

```json
{"type":"summary","summary":"Implementar login con contraseña","leafUuid":"…"}
{"type":"user","timestamp":"2026-10-24T09:12:03.000Z","cwd":"C:\\Users\\Usuario\\app-flyder","sessionId":"5f1c…","gitBranch":"main","message":{"role":"user","content":"implementa la siguiente tarea pendiente"}}
{"type":"assistant","timestamp":"2026-10-24T09:12:40.000Z","cwd":"C:\\Users\\Usuario\\app-flyder","message":{"role":"assistant","content":[{"type":"text","text":"Voy a leer…"}]}}
{"type":"user","timestamp":"2026-10-24T09:13:00.000Z","message":{"role":"user","content":[{"type":"tool_result","content":"…"}]}}
```

### 3.2 `panel/projects.json` (capa de ajustes)

```json
{
  "projects": [
    {
      "id": "app-flyder",
      "name": "app-flyder",
      "path": "C:\\Users\\Usuario\\app-flyder",
      "appUrl": "",
      "repoUrl": "",
      "tags": [],
      "hidden": false,
      "pinned": true
    }
  ]
}
```

- `hidden` y `pinned` son **opcionales**; ausentes o no booleanos → `false` (`normalizeSettings`). Las 4 entradas iniciales no se modifican en esta fase.
- `path` sigue siendo la clave de unión con los proyectos de Claude (comparación por clave de ruta, §5.1).
- Una entrada creada por `PATCH` sobre un proyecto de Claude lleva `id` (el derivado), `path` (el resuelto), `name` (último segmento) y el resto por defecto.

### 3.3 Proyecto descubierto (salida de `discoverClaudeProjects`)

```json
{
  "path": "C:\\Users\\Usuario\\app-flyder",
  "encodedName": "C--Users-Usuario-app-flyder",
  "unresolved": false,
  "source": "claude",
  "sessionCount": 2,
  "lastActivityAt": "2026-10-24T09:13:00.000Z",
  "lastPrompt": "implementa la siguiente tarea pendiente",
  "sessions": [
    { "id": "5f1c…", "title": "Implementar login con contraseña", "startedAt": "2026-10-24T09:12:03.000Z", "lastActivityAt": "2026-10-24T09:13:00.000Z", "messageCount": 3, "gitBranch": "main", "truncated": false }
  ]
}
```

- `encodedName` es `null` para proyectos que solo están en `.claude.json`. `path` es `null` cuando `unresolved: true`.
- `sessions` ordenadas por `lastActivityAt` descendente (ISO comparable; empates por `id`).

### 3.4 Resumen de proyecto (elemento de `GET /api/projects`) = fase 1 + campos nuevos

```json
{
  "id": "app-flyder",
  "name": "app-flyder",
  "appUrl": "",
  "repoUrl": "",
  "tags": [],
  "exists": true,
  "status": "ok",
  "sdd": { "…": "fase 1" },
  "progress": { "…": "fase 1" },
  "git": { "…": "fase 1" },
  "source": "both",
  "claude": { "sessionCount": 2, "lastActivityAt": "2026-10-24T09:13:00.000Z", "lastPrompt": "implementa la siguiente tarea pendiente" },
  "hidden": false,
  "pinned": true,
  "lastActivityAt": "2026-10-24T09:13:00.000Z",
  "unresolved": false
}
```

- `source`: `"manual" | "claude" | "both"`. `claude`: `null` en `manual`.
- `lastActivityAt` del proyecto: el mayor entre `claude.lastActivityAt` y `git.lastCommit.date` (ambos pasados por `Date.parse`; se devuelve en ISO); `null` si no hay ninguno.
- `path` **no** se expone (como en la fase 1). Un proyecto no resuelto: `exists: false`, `status: "no_encontrado"`, `unresolved: true`, `name` = carpeta codificada.

### 3.5 Detalle (`GET /api/projects/:id`) = detalle de la fase 1 + campos de §3.4 + `claude.sessions`

```json
{
  "…": "detalle de la fase 1 y campos de §3.4",
  "claude": {
    "sessionCount": 22,
    "lastActivityAt": "…",
    "lastPrompt": "…",
    "sessions": [ { "id": "…", "title": "…", "startedAt": "…", "lastActivityAt": "…", "messageCount": 14, "gitBranch": "main", "truncated": false } ]
  }
}
```

`sessions` lleva como máximo `MAX_DETAIL_SESSIONS = 20`, las más recientes primero. En `manual`, `claude` es `null`.

### 3.6 `GET /api/claude/status`

```json
{ "available": true, "claudeHome": "C:\\Users\\Usuario", "projectsDir": "C:\\Users\\Usuario\\.claude\\projects", "projectCount": 5, "sessionCount": 37, "lastScanAt": "2026-10-25T10:00:00.000Z" }
```

`available` = existe `.claude.json` **o** existe el directorio de proyectos. Con `available: false`, `projectCount` y `sessionCount` son 0. `lastScanAt` = `new Date(now()).toISOString()` del último escaneo (el propio `GET` lo provoca, así que nunca es `null`). Las rutas se exponen porque la ruta está detrás de la sesión y el humano necesita saber dónde está buscando el panel (es la única ruta absoluta nueva que viaja al cliente).

## 4. API HTTP

### 4.1 Tabla de rutas (nuevas y cambiadas)

| Método | Ruta | Anti-CSRF | Sesión | Respuesta | Requisitos |
|--------|------|-----------|--------|-----------|-----------|
| GET | `/api/projects[?includeHidden=1]` | no | sí | `200` array de resúmenes (§3.4) ordenado (§5.4), sin ocultos salvo `includeHidden=1` | R2, R10, R25–R30, R33 |
| GET | `/api/projects/:id` | no | sí | `200` detalle (§3.5) / `404` | R31 |
| POST | `/api/projects` | sí | sí | como fase 1; la entrada creada se fusiona por ruta | R40 |
| PATCH | `/api/projects/:id` | sí | sí | `200` resumen actualizado / `400` / `404` | R34–R37 |
| DELETE | `/api/projects/:id` | sí | sí | `204` (manual) / `409` (claude, both) / `404` | R39 |
| PUT u otros | `/api/...` | sí | — | `403` sin cabecera; con cabecera, `404 Ruta no encontrada` | R38 |
| GET | `/api/claude/status` | no | sí | `200` §3.6 | R3, R4, R6 |

### 4.2 Middleware (`handleApi`), cambios respecto a la fase 2

1. `isMutation(req) = req.method !== 'GET' && req.method !== 'HEAD'` sustituye a `MUTATING_METHODS.has(req.method)`. Sin cabecera → `403 { error: "Cabecera X-Requested-With requerida" }`. Todo lo demás igual (auth → sesión → `touch` → `routeApi`).
2. `routeApi` añade: `pathname === '/api/claude/status' && GET` → `claudeStatus(res)`; `PATCH` en `PROJECT_ROUTE` → `patchProject(req, res, id)`; `GET /api/projects` lee `url.searchParams.get('includeHidden') === '1'`.

### 4.3 Cuerpos y errores (textos exactos)

| Código | Texto | Cuándo |
|--------|-------|--------|
| 400 | `El nombre es obligatorio` (`field: "name"`) | `PATCH` con `name` vacío o no cadena |
| 400 | `La URL de la app debe ser una cadena` (`field: "appUrl"`) | `PATCH` con `appUrl` no cadena |
| 400 | `La URL del repositorio debe ser una cadena` (`field: "repoUrl"`) | `PATCH` con `repoUrl` no cadena |
| 400 | `Las etiquetas deben ser una lista de textos` (`field: "tags"`) | `PATCH` con `tags` no array o con elementos no cadena |
| 400 | `hidden debe ser true o false` (`field: "hidden"`) | `PATCH` con `hidden` no booleano |
| 400 | `pinned debe ser true o false` (`field: "pinned"`) | `PATCH` con `pinned` no booleano |
| 400 | `Nada que actualizar` | `PATCH` sin ninguno de los seis campos (los demás, p. ej. `path` o `id`, se ignoran) |
| 400 | `Cuerpo JSON inválido` | como fases 1 y 2 |
| 404 | `Proyecto no encontrado` | `GET`/`PATCH`/`DELETE` con id fuera del catálogo (los ocultos SÍ están en el catálogo) |
| 409 | `Este proyecto lo detecta Claude Code: no se puede eliminar, ocúltalo` | `DELETE` sobre `claude` o `both` |

Ejemplo:

```http
PATCH /api/projects/app-flyder
Content-Type: application/json
X-Requested-With: fetch
Cookie: muver_session=…

{ "pinned": true, "appUrl": "http://localhost:5173" }

→ 200
{ "id": "app-flyder", "name": "app-flyder", "appUrl": "http://localhost:5173", "…": "resto del resumen §3.4", "pinned": true, "source": "both" }
```

### 4.4 Flujo de `GET /api/projects` (secuencia)

```
Navegador                    app.js                         project-catalog.js            claude-discovery.js        disco
  | GET /api/projects ------>| loadRegistry(projects.json)   |                              |                          |
  |                          | discovery.scan() ------------------------------------------->| TTL vigente? → caché    |
  |                          |                               |                              | si no: readdir projects/ |
  |                          |                               |                              |  por fichero: stat →     |
  |                          |                               |                              |  (ruta,mtime,size) en    |
  |                          |                               |                              |  caché? si no, parsear   |
  |                          |                               |                              | + .claude.json (prompts) |
  |                          | buildCatalog({ registry, discovered, includeHidden, now, runner })                      |
  |                          |                               | mergeProjects → assignIds → buildSummary (fase 1) por proyecto → sortCatalog |
  |<-- 200 [ … ] ------------|                               |                              |                          |
```

## 5. Módulos y funciones (contratos)

### 5.1 `lib/path-key.js` (puro, sin `fs`)

- `isWindowsPath(p) → boolean`: `/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')`.
- `pathKey(p) → string | null`: `null` si `p` no es cadena no vacía. Windows: `path.win32.normalize(p)` con `/` → `\`, sin `\` final (salvo raíz `C:\`), en minúsculas. POSIX: `path.posix.normalize(p.replace(/\\/g, '/'))` sin `/` final (salvo `/`), respetando mayúsculas.
- `lastSegment(p) → string`: último segmento no vacío tras dividir por `/` o `\` (`C:\Users\Usuario\app-flyder` → `app-flyder`; `/home/user/SDD-MUVER/` → `SDD-MUVER`); si no hay, la propia cadena.
- `encodeProjectPath(p) → string`: `p.replace(/[\\/:]/g, '-')` (regla documentada de Claude Code).
- `looseEncodedKey(s) → string`: `s.toLowerCase().replace(/[^a-z0-9]/g, '-')`. Se usa como segunda comparación (tolerante a versiones que codifiquen `.` u otros caracteres): dos nombres casan si `encodeProjectPath(clave) === carpeta` o `looseEncodedKey(encodeProjectPath(clave)) === looseEncodedKey(carpeta)`.

### 5.2 `lib/claude-discovery.js` (solo lectura)

Constantes exportadas: `CONFIG_FILE_NAME = '.claude.json'`, `PROJECTS_DIR_PARTS = ['.claude', 'projects']`, `MAX_SESSION_FILE_BYTES = 20 * 1024 * 1024`, `HEAD_LINES = 200`, `TITLE_MAX_CHARS = 80`, `DEFAULT_TTL_MS = 30_000`, `SKIPPED_PROMPT_PREFIXES = ['<command-', '<local-command-']`.

Importaciones permitidas (el test estático las comprueba): `node:fs/promises` (solo `readdir`, `stat`, `readFile`, `access`), `node:fs` (solo `createReadStream`), `node:readline`, `node:path`, `./path-key.js`. **Cadenas prohibidas** en el fuente: `writeFile`, `appendFile`, `mkdir`, `rename`, `rmdir`, `rm(`, `unlink`, `createWriteStream`, `chmod`, `chown`, `copyFile`, `truncate(`, `ftruncate`, `utimes`, `symlink`, `link(`, `open(`, `fs.promises.open`, `writeSync`, `openSync`, `child_process`.

- `resolveClaudePaths(claudeHome) → { claudeHome, configFile, projectsDir }` (`path.join`).
- `readClaudeConfig(configFile, { log = console.error }) → { exists: boolean, projects: Map<pathKey, { path, lastPrompt }> }`. ENOENT → `exists: false`, mapa vacío. JSON roto o `projects` no objeto plano → `exists: true`, mapa vacío, **una** llamada a `log('[panel] .claude.json ilegible, se ignora:', mensaje)`. `lastPrompt` según §5.2.1.
- `parseSessionFile(file, { maxFileBytes, headLines, stats }) → Promise<{ session, cwd }>`: `stat` → si `size > maxFileBytes` modo truncado (lee con `createReadStream` + `readline` y para tras `headLines` líneas, destruyendo el stream); si no, lee todo con `readFile` y divide por `\n`. Acumula: `firstCwd`, `minTs`, `maxTs`, `messageCount`, `lastBranch`, `lastSummary`, `firstUserText`. Devuelve la sesión de §3.3 (`truncated`, `messageCount: null` y `lastActivityAt = mtime` en modo truncado; fechas de respaldo = `stat.mtime.toISOString()`). Nunca lanza por contenido; un error de E/S en un fichero concreto (p. ej. EACCES) se registra con `log` y la sesión se omite.
- `discoverClaudeProjects({ claudeHome, now = Date.now, log = console.error, fileCache = new Map(), maxFileBytes = MAX_SESSION_FILE_BYTES, headLines = HEAD_LINES }) → Promise<{ available, claudeHome, projectsDir, configFile, projects, scannedAt, stats }>`, con `stats = { filesParsed, filesCached, bytesRead, fromCache: false }`. Algoritmo:
  1. `config = readClaudeConfig(...)`; `dirExists = stat(projectsDir).isDirectory()` (ENOENT → false). `available = config.exists || dirExists`.
  2. Si `dirExists`: `readdir(projectsDir, { withFileTypes: true })`, solo `isDirectory()`; por carpeta, `readdir` y solo `isFile()` con `.jsonl` (orden por nombre, `localeCompare`). Por fichero: `stat`; clave de caché `file`; si `fileCache.get(file)` tiene el mismo `mtimeMs` y `size` → reutilizar (`filesCached++`); si no, `parseSessionFile` y guardar (`filesParsed++`).
  3. Resolución de `path` de la carpeta: primer `cwd` (orden de ficheros/líneas) → si no, clave de `config` cuya codificación casa (§5.1) → si no, `null`.
  4. Fusión por `pathKey(path)`: `Map`. Primero las claves de `config` (`sessions: []`), después las carpetas (añaden `sessions` o sustituyen la entrada vacía). Carpetas no resueltas: clave `unresolved:<encodedName>`.
  5. Por proyecto: ordenar `sessions`, `sessionCount`, `lastActivityAt` (máximo o `null`), `lastPrompt` (de `config` si la clave existe; si no `null`), `source: 'claude'`.
  6. Resultado con `projects` ordenados por `pathKey` (determinista), `scannedAt = new Date(now()).toISOString()`.
- `createClaudeDiscovery({ claudeHome, now = Date.now, ttlMs = DEFAULT_TTL_MS, log, maxFileBytes, headLines }) → { scan({ force } = {}) → Promise<resultado>, status() → §3.6 | null, cache }`. `scan`: si `!force && last && now() - lastAt < ttlMs` devuelve `{ ...last, stats: { ...last.stats, fromCache: true } }`; si no, `discoverClaudeProjects` con el `fileCache` interno persistente. Dos `scan` concurrentes comparten la misma promesa. `status()` deriva de `last` (`projectCount = projects.length`, `sessionCount` = suma, `lastScanAt = scannedAt`).

#### 5.2.1 Reglas de texto

- `clipTitle(text) → string`: `String(text).replace(/\s+/g, ' ').trim()`; si `[...t].length > TITLE_MAX_CHARS` → primeros 80 caracteres (por puntos de código) + `'…'`.
- `extractText(content) → string | null`: cadena → ella misma; array → `text` del primer bloque con `type === 'text'` y `text` cadena; otro → `null`.
- Candidato a título de usuario: `type === 'user'`, `message.role === 'user'` (o sin `message.role`), texto no vacío tras `trim` y que no empiece por ninguno de `SKIPPED_PROMPT_PREFIXES`.
- `title = lastSummary ?? clipTitle(firstUserText) ?? id`.
- `lastPrompt`: entradas de `history` que son objetos con `display` cadena no vacía; si alguna trae `timestamp` numérico o ISO parseable, la de mayor `timestamp`; si ninguna, la de índice 0; `clipTitle(display)`; sin candidatas → `null`.
- Timestamps: `Date.parse(line.timestamp)` válido (no `NaN`); se guardan como ISO (`new Date(ms).toISOString()`).

### 5.3 `lib/project-catalog.js`

- `MAX_DETAIL_SESSIONS = 20`.
- `mergeProjects(settings, discovered) → MergedProject[]` (puro). `MergedProject = { id: string|null, name, path, appUrl, repoUrl, tags, hidden, pinned, source, claude: { sessionCount, lastActivityAt, lastPrompt, sessions } | null, unresolved, settingsEntry: entrada | null, pathKey }`. Algoritmo: índice `Map<pathKey, discovered>`; por cada entrada de ajustes (normalizada) → buscar por `pathKey(entry.path)`: si hay → `both` (marcar consumida) si no → `manual`. Después, cada descubierto no consumido → `claude` con `id: null`, `name: lastSegment(path)` (o `encodedName` si `unresolved`), valores por defecto.
- `assignIds(merged) → MergedProject[]`: `taken = Set(ids manuales/both)`; los `id: null` ordenados por `pathKey ?? 'unresolved:' + name` (alfabético) reciben `base = slugify(name) || 'proyecto'`, y si `taken` lo tiene, `base-2`, `base-3`… (primer sufijo libre); se añade a `taken`.
- `projectActivity(merged, summary) → string | null`: máximo entre `merged.claude?.lastActivityAt` y `summary.git?.lastCommit?.date` (ambos por `Date.parse`; se descartan `NaN`), en ISO.
- `toSummary(merged, summary) → §3.4`: `{ ...summary, source, claude: claude ? { sessionCount, lastActivityAt, lastPrompt } : null, hidden, pinned, lastActivityAt: projectActivity(...), unresolved }`. Para el detalle, `claude` incluye además `sessions: claude.sessions.slice(0, MAX_DETAIL_SESSIONS)`.
- `sortCatalog(list) → list` (puro, copia): comparador `pinned` desc → `lastActivityAt` desc con `null` al final → `name.localeCompare(other, 'es')` → `id.localeCompare`.
- `buildCatalog({ registry, discovery, includeHidden = false, now, runner }) → Promise<Summary[]>`: `merged = assignIds(mergeProjects(registry.projects, discovery.projects))`; filtra `hidden` salvo `includeHidden`; `Promise.all(buildSummary({ id, name, path, appUrl, repoUrl, tags }, stateOptions))` (para `path: null` `buildSummary` ya devuelve `no_encontrado`); `toSummary`; `sortCatalog`.
- `findMerged({ registry, discovery }, id) → MergedProject | null`: igual fusión (con ocultos) y búsqueda por `id`.
- `buildCatalogDetail(merged, { now, runner }) → Promise<Detail>`: `buildDetail` + `toSummary` con sesiones.

### 5.4 `lib/registry.js` (añadidos; lo existente no cambia de firma)

- `PATCHABLE_FIELDS = ['name', 'appUrl', 'repoUrl', 'tags', 'hidden', 'pinned']`.
- `normalizeSettings(entry) → entry` con `hidden: entry.hidden === true`, `pinned: entry.pinned === true`, `tags` array de cadenas (filtrado) y `appUrl`/`repoUrl` cadenas (`''` si no). `loadRegistry` la aplica a cada entrada; `saveRegistry` escribe lo que recibe (los booleanos quedan en el fichero).
- `validatePatch(body) → { ok: true, changes } | { ok: false, status: 400, error, field? }`: recorre `PATCHABLE_FIELDS` presentes en `body` (`!== undefined`), valida según §4.3 (`name` → `trim()` no vacío; `tags` → array de cadenas recortadas sin vacíos; `appUrl`/`repoUrl` → `trim()`); campos ajenos se ignoran; si `changes` queda vacío → `Nada que actualizar`.
- `upsertSettings(registry, entry) → registry` (sin mutar): sustituye la entrada con el mismo `id` o la añade al final.

### 5.5 `lib/config.js`

- `readConfig` añade `claudeHome`: `env.CLAUDE_HOME_DIR` recortado si no vacío; si no `os.homedir()`.
- `buildStartupLines({ urls, dataDir, configured, publicUrl, claude })`: tras la línea de contraseña, `claude.available ? 'Claude Code: detectado en <claudeHome> (<projectCount> proyectos, <sessionCount> sesiones)' : 'Claude Code: no detectado en <claudeHome> (solo proyectos de projects.json)'`; si `claude` es `undefined`, no añade línea (compatibilidad con los tests de la fase 2).

### 5.6 `lib/app.js` (cambios)

- `createApp({ ..., claudeHome = os.homedir(), claudeCacheTtlMs = DEFAULT_TTL_MS })`; `discovery = createClaudeDiscovery({ claudeHome, now, ttlMs: claudeCacheTtlMs })`.
- `listProjects(res, { includeHidden })`: `registry = loadRegistry`, `scan = await discovery.scan()`, `buildCatalog(...)`, `200`.
- `getProject(res, id)`: `findMerged` → `404` / `buildCatalogDetail` → `200`.
- `patchProject(req, res, id)`: cuerpo (`readBody`) → `findMerged` (`404`) → `validatePatch` (`400`) → `entry = merged.settingsEntry ?? { id: merged.id, name: merged.name, path: merged.path, appUrl: '', repoUrl: '', tags: [], hidden: false, pinned: false }`; si `merged.unresolved` (sin `path`) → `400 { error: "No se puede guardar ajustes de un proyecto sin ruta resuelta" }`; `next = { ...entry, ...changes }`; `saveRegistry(upsertSettings(registry, next))`; responder `200` con `toSummary` recalculado (`buildSummary` de ese proyecto).
- `deleteProject(res, id)`: `findMerged` → `404`; `source !== 'manual'` → `409`; si no, como la fase 1.
- `claudeStatus(res)`: `await discovery.scan()` y `200` con `discovery.status()`.
- Anti-CSRF: `isMutation(req)` (§4.2).

### 5.7 `server.js`

`createApp({ ..., claudeHome: config.claudeHome })`. Como `createApp` devuelve el servidor `http` (sin acceso a su `discovery` interno), en `listen` `server.js` crea su propio `createClaudeDiscovery({ claudeHome: config.claudeHome })`, hace `scan()` y pasa `status()` a `buildStartupLines({ ..., claude })`. Un escaneo extra al arrancar es aceptable.

### 5.8 Frontend

- `public/render.js`:
  - `renderProjectCard(project, now)`: añade `pinned`/`is-hidden` a la clase de la tarjeta; en la cabecera, tras el nombre, `renderSourceBadge(project)`; en el cuerpo (antes del bloque git) `renderClaudeActivity(project.claude, now)` (`Última sesión: ${relativeTime(lastActivityAt, now)} · ${n} ${n === 1 ? 'sesión' : 'sesiones'}` o `Sin sesiones`); en el pie, botón fijar `<button type="button" class="btn icon" data-action="pin" data-id aria-pressed aria-label="Fijar|Desfijar" title="…">📌</button>`, botón `<button type="button" class="btn" data-action="hide" data-id>Ocultar|Mostrar</button>` y "Eliminar" solo si `source === 'manual'`.
  - `renderProjectDetail(detail, now)`: tras "Cambios sin commitear", si `detail.claude` → `<section class="detail-section"><h3>Sesiones de Claude Code</h3>…</section>` con `renderSessionList(sessions, now)`: `<ol class="sessions">` y por sesión `<li><strong class="session-title">…</strong> <time datetime>…</time>${branch ? ' · <span class="branch">…</span>' : ''} · <span class="session-count">N mensajes|—</span></li>`; vacía → `<p class="muted">Sin sesiones</p>`. Después, `<section class="detail-section settings"><h3>Ajustes</h3>${renderSettingsForm(detail)}</section>` (siempre, también en manuales). Si `detail.unresolved` → `<p class="missing">Ruta no resuelta</p>` junto a "Ruta no encontrada".
  - `renderHiddenToggle(hiddenCount, showing)`, `splitHidden(projects, showHidden)`, `renderClaudeNotice(status)`, `renderSettingsForm(project)`, `buildSettingsPayload(values)`, `patchProject(id, changes, { request })`, `togglePin(project, deps)`, `toggleHidden(project, deps)`, `buildProjectsUrl(showHidden)`, `relativeTime(iso, now)` según `requirements.md` E.
- `public/app.js`: estado `showHidden = false`, `claudeStatus = null`. `load()` pide siempre `buildProjectsUrl(true)` (una sola petición, incluye ocultos) y aplica `splitHidden(projects, showHidden)` → `{ visible, hiddenCount }`: pinta `visible` y `renderHiddenToggle(hiddenCount, showHidden)` en `#hidden-toggle`. Así el recuento de ocultos es exacto sin una segunda petición; el filtrado del servidor (`includeHidden`, R30) queda para otros clientes y para la compatibilidad de la fase 1. Al pulsar `toggle-hidden` → `showHidden = !showHidden` y se repinta. Acciones `pin`/`hide` → `togglePin`/`toggleHidden` y `load()`. En el detalle, `submit` de `#settings-form` → `patchProject(id, buildSettingsPayload(values))`, mensaje `role="status"` "Ajustes guardados" y recarga del detalle; errores `4xx` → `renderFormError` en `#settings-error`. `showPanel()` pide `/api/claude/status` una vez y pinta `renderClaudeNotice` en `#claude-notice`. El formulario "Añadir proyecto" no cambia.
- `public/index.html`: en `#list-view`, `<div id="claude-notice"></div>` antes de `#projects` y `<div id="hidden-toggle" class="hidden-toggle"></div>` después; pie: "Acceso protegido por contraseña. Los proyectos abiertos en Claude Code aparecen solos; se actualiza cada minuto."
- `public/styles.css`: `.badge.source-claude` (color propio, p. ej. `--claude: #c96a2b`, definido también en tema oscuro), `.card.pinned` (borde superior o icono destacado), `.card.is-hidden { opacity: .6 }`, `.claude-activity` (texto secundario), `.sessions li` (líneas con `flex-wrap`), `.notice` (fondo suave), `.settings-form .field`, `.btn.icon { min-width: 44px }`, `.hidden-toggle { text-align: center }`. Sin anchos en px > 360.

## 6. Tests (`node --test`, sin dependencias)

### 6.1 Fixtures (`test/claude-fixtures.js`)

```
<tmp>/muver-claude-XXXX/            ← claudeHome
├── .claude.json                    ← { "projects": { "<ruta>": { "history": [...] }, ... } }
└── .claude/projects/
    ├── -tmp-muver-proy-a/          ← resuelto por cwd (POSIX)
    │   ├── 0001-aaaa.jsonl
    │   ├── 0002-bbbb.jsonl
    │   ├── notas.txt               ← ignorado
    │   └── tools/0003-cccc.jsonl   ← ignorado (subcarpeta)
    ├── C--Users-Usuario-app-flyder/ ← sin cwd; se resuelve por la clave Windows de .claude.json
    │   └── 1111-dddd.jsonl
    ├── C--Users-Usuario-viejo/      ← sin cwd y sin clave → no resuelto
    │   └── 2222-eeee.jsonl
    ├── -tmp-muver-roto/             ← líneas corruptas
    │   └── 3333-ffff.jsonl
    └── suelto.jsonl                 ← ignorado
```

- `makeClaudeHome({ config, projects }) → { claudeHome, projectsDir, configFile }`: `config` = objeto para `.claude.json` (o cadena cruda, o `undefined` para no crearlo); `projects` = `{ '<carpeta codificada>': { '<id>': [líneas] } }` donde cada línea es un objeto (se serializa) o una cadena cruda (se escribe tal cual, para corruptas).
- `sessionLine({ type = 'user', text, timestamp, cwd, gitBranch, summary, blocks })` → objeto con el formato de §3.1.
- `writeSession(dir, id, lines, { mtime })` → escribe `<id>.jsonl` y, si `mtime`, `fs.utimes`.
- `snapshotTree(dir) → Array<{ rel, size, mtimeMs }>` ordenado, para el test de solo lectura.
- Los proyectos resueltos por `cwd` apuntan a directorios temporales reales (`makeProjectDir`) para que `exists` sea `true` en los tests de integración; los Windows (`C:\...`) quedan `exists: false`, lo cual es esperado en Linux.

### 6.2 Helpers

- `startApp` acepta `claudeHome` (por defecto un directorio temporal vacío → `available: false`, así los tests de las fases 1 y 2 no ven el `~/.claude` real de la máquina) y `claudeCacheTtlMs` (por defecto `0` en tests, para que cada `GET` refleje los fixtures).
- Nombres de test: `[F3-R<n>] …`.

### 6.3 Reparto

| Fichero | Cubre |
|---------|-------|
| `path-key.test.js` | R23, codificación y `lastSegment` |
| `claude-discovery.test.js` | R5, R7–R22 |
| `project-catalog.test.js` | R24–R27, R29 (unitario) |
| `registry.test.js` (+) | R32, R36 (unitario de `validatePatch`) |
| `claude-api.test.js` | R2–R4, R6, R10, R25, R28–R31, R33–R40 |
| `config.test.js` (+) | R1, R52 |
| `render.test.js` (+) | R41–R50 |
| `styles.test.js` (+) | R51 |
| `deploy.test.js` (+) | R53 |

### 6.4 Compatibilidad con los tests existentes

- `api.test.js` "[R1] … en orden": `con-arnes` tiene commit reciente (o `null` sin git) y `sin-arnes` `null`; con el orden nuevo (`lastActivityAt` desc, `null` al final, luego nombre `Con arnés` < `Sin arnés`) el resultado sigue siendo `['con-arnes', 'sin-arnes']`. No hay que tocarlo.
- `SUMMARY_KEYS` de la fase 1 comprueba presencia, no exclusividad: los campos nuevos no rompen nada.
- `DELETE` de la fase 1 actúa sobre proyectos manuales → `204` sin cambios.
- `startApp` por defecto sin Claude → `source: "manual"` en todo.

## 7. Ficheros que NO se tocan

- `panel/lib/auth.js`, `panel/lib/sessions.js`, `panel/lib/rate-limit.js`, `panel/lib/git-info.js`, `panel/lib/project-state.js`, `panel/lib/http-utils.js`, `panel/lib/public-url.js`, `panel/lib/tunnel.js`, `panel/lib/network.js`, `panel/public/api-client.js`, `panel/public/app-config.js`, `panel/projects.json`, `panel/scripts/`, `panel/deploy/`, `panel/legacy/`.
- `docs/acceso-web.md`, `docs/specs.md`, `docs/constitution.md`, `docs/conventions.md`, `docs/context_map.json`.
- `.claude/`, `CLAUDE.md`, `AGENTS.md`, `CHECKPOINTS.md`, `sdd-lint.js`, `init.sh`, `specs/puesto-de-mando-base/`, `specs/puesto-de-mando-acceso-web/`, `specs/_ejemplo-feature/`.
- `feature_list.json` y `progress/` los gestiona solo el leader.
- Y, por supuesto, **nada dentro de `~/.claude` ni `~/.claude.json`** (ni en tests, que usan temporales).

## 8. Alternativas consideradas y descartadas

| Alternativa | Por qué se descarta |
|-------------|---------------------|
| Decodificar la ruta real a partir del nombre de carpeta (`C--Users-...` → `C:\Users\...`) | Ambigua: `-` puede ser `/`, `\`, `:` o un guion del propio nombre (`app-flyder`). Se usa `cwd` y, de respaldo, la comparación codificando las claves conocidas. |
| Watchers de ficheros (`fs.watch`) sobre `~/.claude` | Poco fiables en Windows con carpetas grandes, consumen descriptores y añaden estado; el `mtime` + TTL de 30 s da frescura suficiente para un panel que se refresca cada 60 s. |
| Base de datos (SQLite u otra) para indexar sesiones | Añade dependencia nativa y un segundo origen de verdad; la caché en memoria por `mtime` resuelve el rendimiento con decenas de sesiones. |
| Leer el contenido completo de las conversaciones y mostrarlo | Fuera de alcance por decisión del humano (privacidad y volumen); solo título, fechas, rama y recuentos. |
| Escribir en `.claude.json` o en `~/.claude` (p. ej. anotar ajustes) | Prohibido: el panel es de solo lectura sobre Claude; los ajustes viven en `projects.json`. |
| Cambiar `GET /api/projects` a `{ projects, meta }` | Rompe la fase 1, sus tests y la UI; la meta va en `/api/claude/status`. |
| Ids por hash de la ruta | Ilegibles en la URL y en `projects.json`; el slug del último segmento con sufijos es legible y estable. |
| Permitir `DELETE` de un proyecto `both` (borrar solo los ajustes) | Confuso: el proyecto reaparecería sin ajustes; la acción equivalente es `PATCH` de los campos o `hidden: true`. |
| Descubrir solo desde `.claude.json` (sin sesiones) | Perdería la actividad y las sesiones recientes, que es lo que el humano quiere ver. |

## 9. Riesgos y notas de implementación

- **Formato real de Claude Code:** el diseño es tolerante, pero hay dos supuestos a confirmar por el humano con su `.claude.json` real: (1) el orden de `history` (se asume índice 0 = más reciente cuando no hay `timestamp`); (2) que la codificación de carpetas solo sustituye `/`, `\` y `:` (la comparación laxa `looseEncodedKey` cubre otros caracteres).
- **Rutas Windows en tests Linux:** nunca pasar rutas `C:\...` por `path.resolve`; usar `pathKey`/`lastSegment` de `lib/path-key.js`. `buildSummary` sí hace `path.resolve`, pero sobre una ruta inexistente solo produce `no_encontrado`, que es lo esperado.
- **Caché por `(mtime, size)`:** un test que reescriba un fichero con el mismo tamaño dentro del mismo milisegundo vería el resultado cacheado; los tests deben cambiar el tamaño o usar `fileCache` nuevo.
- **Ficheros grandes:** en modo truncado hay que destruir el stream (`rl.close(); stream.destroy()`) tras `headLines` para no leer el resto.
- **`readdir` con `withFileTypes`** devuelve `Dirent`; en enlaces simbólicos `isDirectory()` es `false`: se ignoran (comportamiento aceptado).
- **Concurrencia:** `scan()` guarda la promesa en curso para que varias peticiones simultáneas (listado + status) no disparen dos escaneos.
- **`console.error` en tests:** el aviso de `.claude.json` roto se emite una vez por escaneo; los tests pasan un `log` espía para no ensuciar la salida.
- **Nombres duplicados en la UI:** dos proyectos con el mismo nombre (`/x/app`, `/y/app`) se distinguen por `id` (`app-2`); el detalle muestra el id bajo el título (`<p class="muted">id: app-2</p>`) para que el humano pueda identificarlo al poner ajustes.
- **El `lastActivityAt` del proyecto mezcla fuentes** (Claude o git): es intencionado para que los proyectos manuales con commits recientes no caigan al final.
- **Primera carga en el PC real:** con decenas de sesiones grandes el primer escaneo puede tardar varios segundos; después la caché responde al instante. `server.js` lo hace al arrancar para que la primera petición ya sea rápida.
