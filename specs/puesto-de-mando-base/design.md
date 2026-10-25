# Diseño — Feature 1: Puesto de Mando MUVER (fase 1: base)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo
> solo esta carpeta más `docs/conventions.md`. Alineado con `docs/architecture.md`.

## 1. Decisiones técnicas (resumen)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | Todo vive en `panel/` dentro de este repo. Node.js >= 18, **sin frameworks de build ni dependencias npm** (ni en producción ni en tests). | Arranque con `npm start` en cualquier máquina con Node; cero mantenimiento de dependencias; `node:test` y `fetch` global ya vienen en Node 18. |
| D2 | Servidor HTTP con módulos nativos `node:http`, `node:fs`, `node:path`, `node:child_process`, `node:os`. | Es un panel local de un solo usuario; no necesita Express. |
| D3 | El paquete `panel/` es **ES Modules** (`"type": "module"` en `package.json`). | Permite que `public/render.js` y `public/app-config.js` se importen igual desde el navegador (`<script type="module">`) y desde los tests en Node, sin bundler. |
| D4 | Frontend vanilla JS, mobile-first, tema claro/oscuro con `prefers-color-scheme`, sin librerías externas ni CDN. | Funciona offline en la red local; peso mínimo; usable a 360 px. |
| D5 | El estado se lee **de disco en cada petición** (sin caché) y las lecturas de los N proyectos se hacen en paralelo con `Promise.all`. | Datos siempre reales; con 4-10 proyectos el coste es despreciable. Caché queda para fases posteriores si hiciera falta. |
| D6 | `git` se invoca **solo** con `execFile('git', [...args fijos], { cwd, timeout: 5000 })`. Nunca `exec`, nunca shell, nunca argumentos construidos con datos del cliente. | Requisito R12; el servidor no ejecuta comandos arbitrarios en fase 1. |
| D7 | Las funciones de cálculo reciben dependencias inyectables (`now`, `runner`, `confirm`, `request`). | Tests deterministas sin tocar el reloj ni la red. |
| D8 | El registro de proyectos es un fichero JSON plano `panel/projects.json`, reescrito completo en cada alta/baja con escritura atómica (`writeFile` a `projects.json.tmp` + `rename`). | Sencillo, editable a mano por el humano, sin base de datos. |
| D9 | El servidor escucha en `0.0.0.0:PORT` (defecto 4310) e imprime las URLs de acceso. **Acceso fuera de la red local: se recomienda Tailscale (o similar); fuera de alcance de esta feature.** No hay autenticación en fase 1: el panel debe exponerse solo en redes de confianza. | Acceso desde el móvil en la misma Wi-Fi sin configuración extra. |
| D10 | `manifest.webmanifest` + `<meta viewport>` para "Añadir a pantalla de inicio" en el móvil. Sin service worker (no hace falta offline). | PWA mínima sin complejidad. |

## 2. Estructura de ficheros

```
panel/
├── package.json              (crear) { "type": "module", scripts: start, test }  — sin dependencies
├── server.js                 (crear) arranque: createServer(...) + listen + impresión de URLs
├── projects.json             (crear) registro inicial con los 4 proyectos (rutas placeholder)
├── lib/
│   ├── registry.js           (crear) carga/guardado del registro y validación de altas/bajas
│   ├── git-info.js           (crear) lectura de git vía execFile
│   ├── project-state.js      (crear) feature_list.json, progress/current.md, semáforo, resumen y detalle
│   ├── http-utils.js         (crear) sendJson, readJsonBody (límite 64 KB), MIME, serveStatic
│   ├── app.js                (crear) createApp({ projectsFile, publicDir, now, runner }) → http.Server (sin listen)
│   └── network.js            (crear) buildAccessUrls(port, interfaces)
├── public/
│   ├── index.html            (crear) estructura, <link rel="manifest">, <meta viewport>, <script type="module" src="/app.js">
│   ├── styles.css            (crear) variables CSS, tema claro/oscuro, grid mobile-first
│   ├── app.js                (crear) fetch + eventos + refresco cada 60 s (usa render.js y app-config.js)
│   ├── render.js             (crear) funciones PURAS que devuelven HTML string (testeables en Node)
│   ├── app-config.js         (crear) REFRESH_INTERVAL_MS, API_BASE
│   ├── manifest.webmanifest  (crear)
│   └── icon.svg              (crear) icono simple del panel (letra M / semáforo)
├── legacy/
│   └── (vacío por ahora; ver §9)
└── test/
    ├── helpers.js            (crear) crear repos/proyectos temporales, arrancar app en puerto 0
    ├── registry.test.js
    ├── git-info.test.js
    ├── project-state.test.js
    ├── network.test.js
    ├── api.test.js           (integración HTTP: listado, detalle, alta, baja, 404, estáticos, manifest)
    ├── render.test.js        (render.js + app-config.js + payload/handlers del frontend)
    └── styles.test.js        (tests estáticos sobre styles.css e index.html)

init.sh                       (tocar) añadir `(cd panel && npm test)` en el paso 3
docs/architecture.md          (ya rellenado por el spec_author con esta arquitectura)
```

## 3. Modelo de datos

### 3.1 `panel/projects.json`

```json
{
  "projects": [
    {
      "id": "app-flyder",
      "name": "app-flyder",
      "path": "C:\\Users\\Usuario\\app-flyder",
      "appUrl": "",
      "repoUrl": "",
      "tags": []
    }
  ]
}
```

- `id`: `^[a-z0-9][a-z0-9-]{0,63}$`, único. Si no se recibe en el alta, se deriva de `name` con `slugify` (minúsculas, acentos eliminados, no alfanuméricos → `-`, sin guiones repetidos ni en extremos).
- `path`: ruta local **absoluta** (`path.isAbsolute`) normalizada con `path.resolve`. Se comprueba `fs.stat(...).isDirectory()` en el alta.
- `appUrl`, `repoUrl`: cadenas (pueden ser `""`). `tags`: array de cadenas (puede ser `[]`).

Los 4 proyectos iniciales (placeholders que el humano ajustará): `app-flyder`, `appcc-real`, `crm-zinergia`, `app-finanzas-restaurante`, con `path: "C:\\Users\\Usuario\\<nombre>"`, `appUrl: ""`, `repoUrl: ""`, `tags: []`.

### 3.2 Resumen de proyecto (elemento de `GET /api/projects`)

```json
{
  "id": "crm-zinergia",
  "name": "crm-zinergia",
  "appUrl": "http://localhost:3000",
  "repoUrl": "https://github.com/zinergia/crm-zinergia",
  "tags": ["crm"],
  "exists": true,
  "status": "atencion",
  "sdd": {
    "present": true,
    "error": null,
    "counts": { "pending": 3, "spec_ready": 1, "in_progress": 0, "done": 5 },
    "inProgress": null,
    "awaitingApproval": [{ "id": 7, "slug": "alta-cliente" }]
  },
  "progress": { "present": true, "blocked": false, "blockReason": null },
  "git": {
    "isRepo": true,
    "branch": "main",
    "lastCommit": { "hash": "a1b2c3…(40)", "date": "2026-10-20T17:03:11+02:00", "message": "Añade validación de email" },
    "dirtyCount": 2
  }
}
```

Nota: `path` **no** se incluye en el listado ni en el detalle (no exponer rutas absolutas al cliente más de lo necesario). El humano lo ve/edita en `projects.json`.

Valores cuando falta algo:
- Sin arnés: `sdd = { present: false, error: null, counts: null, inProgress: null, awaitingApproval: [] }`.
- `feature_list.json` corrupto: `sdd = { present: true, error: "JSON inválido: …", counts: null, inProgress: null, awaitingApproval: [] }`.
- Sin `progress/current.md`: `progress = { present: false, blocked: false, blockReason: null }`.
- Sin git: `git = { isRepo: false, branch: null, lastCommit: null, dirtyCount: null }`.
- Ruta inexistente: `exists: false, status: "no_encontrado"` y los tres bloques anteriores en su forma "ausente".

### 3.3 Detalle (`GET /api/projects/:id`) = resumen + campos extra

```json
{
  "...": "todos los campos del resumen",
  "sdd": { "...": "igual que resumen", "features": [ { "id": 1, "slug": "…", "description": "…", "status": "done", "sdd": true } ] },
  "progress": { "...": "igual que resumen", "text": "# Progreso actual\n…" },
  "git": {
    "...": "igual que resumen",
    "recentCommits": [ { "hash": "…", "date": "2026-10-20T17:03:11+02:00", "message": "…" } ],
    "dirtyFiles": [ "src/app.js", "README.md" ]
  }
}
```

`features` es `[]` si no hay arnés; `text` es `null` si no hay fichero; `recentCommits` máximo 10; `dirtyFiles` son las rutas de `git status --porcelain` (columnas 4+ de cada línea, recortadas).

### 3.4 Errores

Todos los errores de la API son `{ "error": "<mensaje en español>" }` y, en validaciones de alta, además `"field": "name" | "path" | "id"`. Códigos: `400` validación, `404` no encontrado, `500` fallo inesperado (mensaje genérico "Error interno", el detalle va a `console.error`).

## 4. API HTTP

| Método | Ruta | Respuesta | Requisitos |
|--------|------|-----------|-----------|
| GET | `/api/projects` | `200` array de resúmenes (§3.2) | R1, R5–R16 |
| GET | `/api/projects/:id` | `200` detalle (§3.3) / `404` | R2, R3 |
| POST | `/api/projects` | `201` proyecto registrado / `400` | R17–R20 |
| DELETE | `/api/projects/:id` | `204` / `404` | R21, R22 |
| * | `/api/...` sin ruta | `404 { error: "Ruta no encontrada" }` | R4 |
| GET | `/`, `/<fichero>` | estático desde `public/` / `404` | R24, R25, R26 |

Ejemplo de alta:

```http
POST /api/projects
Content-Type: application/json

{ "name": "Mi Proyecto", "path": "C:\\Users\\Usuario\\mi-proyecto", "appUrl": "http://localhost:5173", "tags": ["web"] }

→ 201
{ "id": "mi-proyecto", "name": "Mi Proyecto", "path": "C:\\Users\\Usuario\\mi-proyecto", "appUrl": "http://localhost:5173", "repoUrl": "", "tags": ["web"] }
```

(La respuesta `201` del alta sí incluye `path` porque es el eco de lo que el propio cliente acaba de enviar.)

Ejemplo de error: `400 { "error": "La ruta no existe o no es un directorio", "field": "path" }`.

## 5. Módulos y funciones (contratos)

### `lib/registry.js`
- `loadRegistry(file) → Promise<{ projects: Project[] }>`; si el fichero no existe devuelve `{ projects: [] }`.
- `saveRegistry(file, registry) → Promise<void>` (escritura atómica, 2 espacios de indentación).
- `slugify(name) → string`.
- `validateNewProject(input, existing, { statFn }) → Promise<{ ok: true, project } | { ok: false, status: 400, error, field }>`. Comprueba, en este orden: `name` no vacío (field `name`); `path` cadena no vacía, absoluta, directorio existente (field `path`); `id` formato y unicidad (field `id`). Normaliza `path` con `path.resolve`. `tags` no array → `[]`; `appUrl`/`repoUrl` no cadena → `""`.
- `removeProject(registry, id) → { removed: boolean, registry }`.

### `lib/git-info.js`
- `GIT_COMMANDS` (constante exportada, lista cerrada de argumentos permitidos):
  - `['rev-parse', '--is-inside-work-tree']`
  - `['rev-parse', '--abbrev-ref', 'HEAD']`
  - `['log', '-1', '--format=%H%x1f%cI%x1f%s']`
  - `['log', '-10', '--format=%H%x1f%cI%x1f%s']`
  - `['status', '--porcelain']`
- `defaultRunner(file, args, opts) → Promise<{ stdout }>` = `promisify(execFile)`.
- `getGitInfo(dir, { runner = defaultRunner, detail = false }) → Promise<GitInfo>`. Toda llamada usa `runner('git', args, { cwd: dir, timeout: 5000, windowsHide: true })`. Cualquier error del runner (ENOENT, código ≠ 0, timeout) → `isRepo: false` y resto en forma ausente. Repo sin commits (`log` falla) → `isRepo: true, lastCommit: null, recentCommits: []`.

### `lib/project-state.js`
- `readFeatureList(dir) → Promise<SddInfo>` (R5–R7).
- `readProgress(dir, { detail }) → Promise<ProgressInfo>`; `detectBlock(text) → { blocked, blockReason }` (R8). Regla: primera línea que, sin espacios iniciales, empieza por `- **Bloqueos / esperando:**`; el valor es lo que sigue, recortado; `blocked = !EMPTY_BLOCK_VALUES.has(valor.toLowerCase())` con `EMPTY_BLOCK_VALUES = {"", "—", "-", "–", "ninguno", "(ninguno)", "no"}`. Sin esa línea → no bloqueado.
- `computeStatus({ exists, sdd, progress, git }, now = Date.now()) → Status` (R13–R16), en este orden exacto:
  1. `!exists` → `no_encontrado`.
  2. `sdd.awaitingApproval.length > 0 || progress.blocked` → `atencion`.
  3. `sdd.inProgress !== null` → `en_curso`.
  4. `git.isRepo && git.lastCommit && (now - Date.parse(git.lastCommit.date)) > INACTIVE_AFTER_MS` → `inactivo`, con `INACTIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000` (comparación estricta `>`: exactamente 14 días es `ok`).
  5. en otro caso → `ok`.
- `buildSummary(project, { now, runner }) → Promise<Summary>` y `buildDetail(project, { now, runner }) → Promise<Detail>`. Ambos empiezan por `fs.stat(project.path)`; si falla o no es directorio → forma "no encontrado" sin llamar al runner (R11). Nunca incluyen `path` en la salida.

### `lib/http-utils.js`
- `sendJson(res, status, body)`, `sendEmpty(res, status)`.
- `readJsonBody(req, { limit = 65536 }) → Promise<any>`; rechaza con `{ status: 400, error: "Cuerpo JSON inválido" }` si excede el límite o no parsea.
- `MIME_TYPES` (html, css, js, webmanifest → `application/manifest+json`, svg, png, ico, json).
- `serveStatic(publicDir, urlPath, res)`: decodifica `decodeURIComponent`, resuelve `path.resolve(publicDir, '.' + pathname)`, y exige que el resultado empiece por `publicDir + path.sep`; si no, o si no existe, `404` con cuerpo `"No encontrado"`. `/` → `index.html`.

### `lib/app.js`
- `createApp({ projectsFile, publicDir, now = () => Date.now(), runner }) → http.Server` sin `listen` (los tests lo arrancan en puerto 0). Enrutado manual con `new URL(req.url, 'http://localhost')`. Captura cualquier excepción del handler → `500` + `console.error`.

### `lib/network.js`
- `buildAccessUrls(port, interfaces = os.networkInterfaces()) → string[]`: `['http://localhost:<port>', ...'http://<address>:<port>' por cada entrada con family 'IPv4' (o 4) y internal === false]`.

### `server.js`
- Lee `PORT` (defecto 4310), crea la app con `projectsFile = panel/projects.json` y `publicDir = panel/public`, `listen(port, '0.0.0.0')` e imprime `Puesto de Mando MUVER escuchando en:` seguido de una URL por línea.

### `public/render.js` (funciones puras, sin DOM; devuelven strings HTML)
- `escapeHtml(s)`, `relativeDate(isoDate, now)` ("hace 3 días", "hoy"…).
- `STATUS_LABELS = { atencion: 'Atención', en_curso: 'En curso', inactivo: 'Inactivo', ok: 'OK', no_encontrado: 'No encontrado' }`.
- `renderProjectCard(project, now)` (R28, R29): `<article class="card status-<status>" data-id="…">` con cabecera (nombre + badge), bloque git o "Sin repositorio git", bloque SDD o "Sin arnés SDD", "Ruta no encontrada" cuando `!exists`, botones `Abrir app` (`<a href target="_blank" rel="noopener">`, con atributo `aria-disabled="true"` y sin `href` si `appUrl` vacío), `Detalle`, `Eliminar` y enlace al repo.
- `renderProjectDetail(detail, now)` (R30), `renderFormError(payload)` (R32), `renderLoadError()` (R34).
- `buildProjectPayload(formValues)` (R31): recorta cadenas, separa `tags` por comas, omite claves vacías.
- `handleDelete(id, { confirm, request })` (R33): `if (!confirm('¿Eliminar el proyecto del panel? No se borra nada del disco.')) return false; await request('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' }); return true`.

### `public/app.js`
- Carga inicial, pinta tarjetas con `renderProjectCard`, refresco con `setInterval(load, REFRESH_INTERVAL_MS)`, hora de última actualización en `<header>`, delegación de eventos para Detalle/Eliminar, formulario de alta, vista detalle con botón Volver. Todo texto visible en español.

### `public/styles.css`
- Variables en `:root` (`--bg`, `--fg`, `--card`, `--border`, `--status-atencion`, `--status-en_curso`, `--status-inactivo`, `--status-ok`, `--status-no_encontrado`) y redefinición en `@media (prefers-color-scheme: dark)` (R37).
- `.projects { display: grid; grid-template-columns: 1fr; gap: 12px; }` y `@media (min-width: 601px) { .projects { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); } }` (R36). Padding lateral 16 px, sin `width` fijos > 360 px, `img, pre { max-width: 100%; overflow: auto }`.

## 6. Tests (`node --test`, sin dependencias)

- `test/helpers.js`: `makeTempDir()`, `makeProjectDir({ featureList, currentMd, git: { commits, dirtyFile } })` (usa `execFile('git', ...)` real con `user.name/user.email` configurados en local), `startApp(options) → { baseUrl, close }` (puerto 0), `writeRegistry(file, projects)`.
- Los tests que requieren `git` real comprueban al inicio que `git --version` responde; si no, se marcan `skip` con mensaje (no fallo silencioso).
- Mapa de trazabilidad R ↔ test: lo completa el implementer en `docs/verification.md` (una fila por requisito, R1–R37).

## 7. Ficheros que NO se tocan

- `.claude/` (agentes), `CLAUDE.md`, `AGENTS.md`, `CHECKPOINTS.md`, `GUIA-SDD.html`.
- `docs/specs.md`, `docs/constitution.md`, `docs/conventions.md`, `sdd-lint.js`.
- `feature_list.json` y `progress/` los gestiona solo el leader según el protocolo (el implementer no cambia estados de features).
- `specs/_ejemplo-feature/` y `sdd-descubrimiento/`.
- De `init.sh` solo se toca el paso 3 (comando de tests); el resto de la estructura del arnés se mantiene.
- Nada fuera de `panel/`, `init.sh`, `docs/architecture.md` y `docs/verification.md` (tabla de trazabilidad).

## 8. Alternativas consideradas y descartadas

| Alternativa | Por qué se descarta |
|-------------|---------------------|
| Framework pesado (React/Next, Vue, Svelte) con build | Añade toolchain y dependencias para un panel de un usuario; el objetivo es `npm start` y listo, mantenible por el humano. Vanilla JS con módulos ES cubre la fase 1. |
| Leer el estado desde GitHub (API) en vez de disco | El estado real (`in_progress`, cambios sin commitear, `progress/current.md` local) solo existe en disco; la API de GitHub necesitaría tokens y no vería trabajo no empujado. GitHub queda como enlace (`repoUrl`). |
| Electron / app de escritorio | Más pesado, no accesible desde el móvil, empaquetado por plataforma. Un servidor HTTP en la LAN resuelve el acceso móvil sin instalar nada. |
| Express / Fastify | Dependencia innecesaria para 4 rutas y estáticos; `node:http` basta y mantiene el paquete sin `node_modules`. |
| Base de datos (SQLite) para el registro | Sobredimensionado: una lista de <20 proyectos editable a mano cabe en un JSON. |
| Caché del estado en memoria | Datos potencialmente desfasados; con pocos proyectos la lectura por petición es barata. Reconsiderar en fase 3 si se añaden capturas. |
| Autenticación básica | Decidido fuera de alcance en fase 1; el panel se expone solo en red local o vía Tailscale. |

## 9. Migración del `muver.html` existente

El panel actual del humano (`salida/muver.html`) aún no está en el repo. Cuando lo aporte:
1. Se guardará **sin modificar** en `panel/legacy/muver.html` como referencia.
2. Se revisará qué aporta (lista de proyectos, enlaces, estilos) y se migrará a `projects.json` / `styles.css` en una tarea de `sdd: false` o en la fase que corresponda.
3. No bloquea esta feature: la fase 1 se construye con los 4 proyectos iniciales y rutas placeholder.

## 10. Riesgos y notas de implementación

- **Windows:** usar siempre `path.resolve`/`path.sep`; `execFile('git', …)` funciona si `git` está en el `PATH`; `windowsHide: true`. Los tests crean repos en `os.tmpdir()` y configuran `user.name`/`user.email` localmente.
- **Fechas de git:** `%cI` da ISO 8601 estricto, parseable con `Date.parse`.
- **Rendimiento:** `Promise.all` sobre proyectos; cada proyecto hace como máximo 4 llamadas a git (5 en detalle).
- **Ruta con espacios o acentos en `projects.json`:** `execFile` no pasa por shell, así que no hay problema de escapado.
- **Encoding:** leer ficheros como `utf8`; `progress/current.md` puede llegar con BOM; eliminarlo antes de `detectBlock`.
