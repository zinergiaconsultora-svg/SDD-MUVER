# Revisión — Feature 3: `puesto-de-mando-descubrimiento-claude`

**Veredicto: APROBADO** (commit `a3eaeed`). Sin defectos bloqueantes. T27 (manual del humano en Windows) queda
pendiente y no es motivo de rechazo. Las mejoras M1–M6 se proponen para una iteración futura.

## Checklist

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad R1–R53 ↔ tests | OK. Las 53 filas `[F3-R<n>]` de `docs/verification.md` apuntan a tests que existen y comprueban lo que dice el requisito. Leídos uno a uno los de `claude-discovery`, `claude-api`, `path-key`, `project-catalog`, `registry`, `render`, `styles`, `config` y `deploy`. Usan fixtures temporales (nunca el `~/.claude` real), `now` inyectado, y comparan el fichero antes y después en todas las mutaciones. No hay tests triviales: R18 mide `bytesRead < size`, R20 cuenta `filesParsed`/`filesCached`, R22 hace un análisis estático de los imports y compara instantáneas del árbol, y R27 comprueba la estabilidad de los ids al reordenar. R9, R13, R24 y R35 tienen además una parte manual (T27). |
| 2 | `bash init.sh` | OK: **246 tests, 246 pass, 0 fail**; sdd-lint 0 errores y 0 advertencias (53 requisitos, 28 tareas). El aviso TDD sale porque el árbol está limpio. |
| 3 | Tareas | T1–T26 y T28 están `[x]`; T27 `[ ]` (manual del humano, aceptado). |
| 4 | Convenciones | OK: código en inglés y comentarios y textos visibles en español; `camelCase`/`MAYÚSCULAS`; funciones cortas. Los errores de E/S se registran con mensaje útil, sin volcar contenido. |
| 5 | Checkpoints | Se cumplen. Falta la entrada en `progress/history.md`, que le toca al leader al pasar a `done`. Tampoco hay `progress/impl_<feature>.md` (igual que en la fase 2); el resumen está en el commit y en `docs/verification.md`. |
| 6 | Diseño | OK, detalle abajo. No se han tocado ficheros de la lista "NO tocar" (§7): ni `project-state.js`, ni `api-client.js`, ni `projects.json`, etc. |

## Cumplimiento de `design.md`

- **Contratos JSON** (§3.3–§3.6): resumen = fase 1 + `source`, `claude`, `hidden`, `pinned`, `lastActivityAt` y
  `unresolved`, sin `path`. El detalle añade `claude.sessions`, con 20 como máximo y 7 campos. `/api/claude/status`
  devuelve sus 6 campos. Lo he comprobado contra la app real.
- **Resolución de ruta** (`claude-discovery.js:384`): primero el `cwd` (primer fichero y primera línea), luego la clave de
  `.claude.json` (exacta y después laxa, `:297-307`) y, si no hay ninguna, `unresolved:<carpeta>`. La fusión
  configuración/carpetas se hace por `pathKey` (`:366-393`).
- **Títulos** (§5.2.1): se cumple el orden `summary` → primer `user` válido (descarta `<command-` y `<local-command-`, bloque
  `text` tras `tool_result`) → `id`. `clipTitle` cuenta puntos de código.
- **Caché**: por fichero según `(ruta, mtimeMs, size)` (`:329-338`). Las entradas que desaparecen se purgan (`:395`), hay
  un TTL de 30 s y `force`, y la promesa en curso se comparte.
- **Ficheros grandes**: `createReadStream` + `readline`, que se destruyen tras `headLines`; trozos de 64 KB como máximo.
- **Fusión, orden e ids**: `mergeProjects`, `assignIds` (prioridad a los ids manuales, sufijos en orden de `pathKey`)
  y `sortCatalog` siguen exactamente §5.3.
- **PATCH, DELETE e includeHidden**: el orden es cuerpo → 404 → 400 → no resuelto 400 → upsert atómico → 200 con
  la fusión recalculada. `DELETE` responde 409 en `claude`/`both`. `includeHidden === '1'`.
- **Anti-CSRF**: `isMutation` es todo método distinto de GET y HEAD (`app.js:334`), comprobado antes de la sesión. Probado:
  `OPTIONS` sin cabecera → 403; `PATCH`/`PUT` sin cabecera → 403.

## Requisito crítico: solo lectura de `~/.claude` y `~/.claude.json`

- `lib/claude-discovery.js` solo importa `readdir`, `stat`, `readFile`, `createReadStream`, `readline`, `path` y
  `path-key`. No contiene ninguna cadena prohibida y el test estático R22 lo vigila. No crea temporales.
- Las únicas escrituras del panel están en `registry.js:51-52` (`projectsFile` + `.tmp`), `auth.js` y `sessions.js`
  (`dataDir`) y `tunnel.js` (`dataDir`). `projectsFile` es fijo: se le pasa a `createApp` desde `server.js` y ninguna
  ruta HTTP puede cambiarlo.
- **PATCH no puede redirigir la escritura.** `validatePatch` solo acepta los 6 `PATCHABLE_FIELDS`. Probado contra la app:
  `PATCH {"path":"/root/.claude","id":"zz"}` → `400 Nada que actualizar`. Con `{"path":"/root/.claude","pinned":true}`
  se ignora `path` y se guarda la ruta descubierta. El `path` almacenado es solo un dato dentro de
  `projects.json`, nunca un destino de escritura.
- Verificación con datos reales (`claudeHome=/root`, `projects.json` y `dataDir` copiados a un temporal): status,
  listado, detalle, PATCH y DELETE. Después, `sha256sum` de `/root/.claude.json` sigue igual y no ha cambiado ningún
  fichero de `/root/.claude/projects` atribuible al panel (el único que cambió es la transcripción del propio
  subagente, que escribe Claude Code). `panel/projects.json` del repo no se ha modificado (`git status` limpio).

## Seguridad (sondeo real)

- **XSS**: probé una carpeta llamada `<img src=x onerror=alert(1)>`, un `summary` `<script>…`, un `content`
  `<svg onload…>`, una `gitBranch` `<i>b</i>` y un `cwd` `/tmp/"><b>x`. `renderProjectCard` y
  `renderProjectDetail` lo escapan todo (`escapeHtml` cubre `& < > " '`); el `id` es un slug.
- **Symlinks y nombres raros**: un enlace a `/etc` como carpeta de proyecto, un `p.jsonl` que enlaza a `/etc/passwd`,
  un FIFO `f.jsonl` y un directorio `d.jsonl` se ignoran todos (`Dirent.isDirectory/isFile` no siguen enlaces).
  Solo se baja un nivel; no hay lectura fuera de `<claudeHome>/.claude/projects` ni de `.claude.json`.
- **DoS**: los ficheros de más de 20 MB se leen solo por cabecera. Los de menos se leen una vez y luego se sirven de la
  caché por mtime/size. Hay un TTL de 30 s entre escaneos. Ver M2 (líneas enormes) y M4 (git por proyecto).
- **Fuga de información**: al cliente solo llegan el título (summary o primer prompt recortado a 80), las fechas, la rama, los
  recuentos y `lastPrompt` (80). Es lo que permite la spec. `claudeHome`/`projectsDir` están en el status por diseño
  (§3.6) y siempre detrás de la sesión. Ver M1 (summary sin recortar).
- **Bypass de autenticación**: `/api/claude/status`, `PATCH` y `?includeHidden=1` pasan por `handleApi` → sesión. Sin
  cookie → 401 (probado). `PATCH /api/claude/status` → 404. `PATCH /api/projects/..%2f..%2fetc` → 404.
  Cuerpos `[]` y `null`, y cuerpos de más de 64 KB → 400.

## Regresiones y desviaciones declaradas

- **`api.test.js` [R17]**: el cambio de orden es consecuencia directa de F3-R29, porque el catálogo ya no sigue el orden del
  fichero. R17 sigue comprobando el alta, la persistencia (`saved.projects.at(-1)`) y que el proyecto aparece en el listado. Es legítimo.
  El test [R1] no se toca, como pedía §6.4.
- **`hidden`/`pinned` en el registro**: `loadRegistry` normaliza (F3-R32) y el test de ida y vuelta se ajusta. Es legítimo
  (ver nota N2).
- **`claudeHome` en config**: F3-R1. `startApp` usa por defecto un temporal vacío, así que ningún test de las fases 1 y 2
  ve el `~/.claude` real. Es legítimo.
- **`helpers.request` con anti-CSRF en todo lo que no es GET/HEAD**: refleja D10/R38. Los tests de las fases 1 y 2 que
  quitan la cabecera siguen usando `csrf: false`. Es legítimo.
- Las fases 1 y 2 siguen en verde dentro de los 246 tests.

## Portabilidad Windows

- `path-key.js` detecta Windows por la forma (`X:\`, `X:/`, `\\`), normaliza con `path.win32` sin depender de
  `process.platform`, compara sin mayúsculas y quita el separador final (salvo `X:\`). La codificación de `/ \ :` y la laxa
  `[^a-z0-9]` cubren la regla real de Claude Code, que también sustituye `.`, `_` y espacios.
- `claude-discovery.js` usa `path.join`, válido en Windows. Lee con `utf8`, quita el BOM en `.claude.json`, y el `trim` de
  cada línea absorbe el CRLF.

## Mejoras (no bloqueantes)

- **M1** `claude-discovery.js:202,264`: el `summary` se usa como título sin `clipTitle`. Un `summary` largo viajaría
  entero al cliente. Propuesta: `clipTitle(lastSummary)` (R15 no lo prohíbe, y coherente con R16).
- **M2** `claude-discovery.js:210-239`: en modo truncado, `readline` no limita la longitud de línea. Un fichero de más de 20 MB
  con una primera línea gigante (p. ej. una imagen en base64) se lee entero en memoria. Lo comprobé: un fichero de 3 MB
  con umbral 1 MB da `bytesRead` igual al tamaño. Propuesta: cortar también por bytes leídos (p. ej. 1 MB).
- **M3** `server.js:26-35`: el escaneo de arranque usa su propio `createClaudeDiscovery`, así que la primera petición vuelve a
  escanear sin caché. El diseño lo acepta (§5.7), pero la frase de §9 "para que la primera petición ya sea rápida" no se
  cumple. Propuesta: exponer el `discovery` desde `createApp` o aceptar el coste.
- **M4** `project-catalog.js:167-173` + `public/app.js:262`: cada `GET /api/projects` ejecuta los comandos git de la fase 1
  en **cada** proyecto descubierto. La UI pide siempre `includeHidden=1`, así que los ocultos también cuestan. Además,
  `git status --porcelain` puede refrescar `.git/index` en repos descubiertos. Esto ya venía de la fase 1, pero ahora afecta
  a más carpetas. Propuesta: `--no-optional-locks` y/o una caché corta del estado git.
- **M5** `render.js:108,161`: `appUrl`/`repoUrl` acaban en `href` sin validar el esquema (`javascript:`). Ya pasaba en la fase 1
  con POST; ahora también por PATCH. Solo el usuario autenticado puede fijarlas. Propuesta: aceptar únicamente `http(s)://`.
- **M6** `claude-discovery.js:438`: `scan({ force: true })` con un escaneo en curso devuelve esa promesa, que pudo empezar
  antes del cambio. No afecta a la API actual.

## Notas

- **N1** `claude-discovery.js:153`: un `.claude.json` sin clave `projects` no genera aviso. Es una desviación razonable de
  R5: el `.claude.json` real de este contenedor no tiene `projects`, y avisar sería ruido. Con esto `lastPrompt` sale
  siempre `null` aquí. Hay que confirmarlo en T27: las versiones recientes de Claude Code guardan el historial de prompts
  en `~/.claude/history.jsonl`, que esta fase no lee (supuesto 1 de §9).
- **N2** `registry.js:43`: al normalizar en `loadRegistry`, el primer guardado (POST, PATCH o DELETE) reescribe todas las
  entradas con `hidden: false`/`pinned: false` y URLs `''`. Es inocuo y compatible, pero cambia el formato de las 4
  entradas iniciales la primera vez que se guarda.
- **N3**: `lastPrompt` se envía en el listado pero la UI no lo muestra. Lo exige el contrato (R24); habría que valorar
  quitarlo o mostrarlo.
- **N4**: dos PATCH concurrentes pueden perder una actualización (leer → escribir sin cerrojo). Ya pasaba en la fase 1.
