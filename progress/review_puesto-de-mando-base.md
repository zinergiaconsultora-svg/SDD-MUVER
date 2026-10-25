# Revisión — Feature 1: `puesto-de-mando-base`

**Veredicto: APROBADO** (T27, verificación manual en Windows/móvil, queda pendiente del humano y no es motivo de rechazo).

## Checklist

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad R1–R37 ↔ tests | OK. R1–R26 y R28–R37 tienen tests automáticos reales (leídos uno a uno, no triviales). R27 es manual por diseño de la propia spec (y `init.sh` lo ejercita en cada ejecución). |
| 2 | `bash init.sh` desde la raíz | OK: 83 tests en verde, 0 fallos, `sdd-lint` 0 errores, código de salida 0 (Node 22.22, git 2.43). |
| 3 | Tareas de `tasks.md` | T1–T26 y T28–T30 marcadas `[x]`; T27 `[ ]` (manual, la hará el humano). |
| 4 | Convenciones | OK: código en inglés, comentarios y textos visibles en español, errores capturados con mensaje útil (400/404 JSON, 500 genérico con detalle en `console.error`, `EADDRINUSE` con sugerencia). |
| 5 | Checkpoints | OK salvo el registro en `progress/history.md`, que corresponde al leader al pasar a `done`. |
| 6 | Diseño | OK: API, JSON (§3.2/§3.3, sin `path` en listado/detalle), semáforo en el orden exacto, `git` solo con `execFile` y `GIT_COMMANDS` cerrada, `cwd`/timeout 5000/`windowsHide`, escritura atómica del registro, protección path traversal (`path.resolve` + `startsWith(root + path.sep)`, `decodeURIComponent` protegido, `\0` rechazado). Extras menores no previstos en design (botón "Actualizar", `sendText`, `resolveStaticPath`) son inocuos. |

## Hallazgos

### Bloqueantes
Ninguno.

### Mejoras (no bloquean; candidatas a tarea `sdd: false` o a la fase siguiente)
1. **`detectBlock` y el formato real de `progress/current.md`** (`panel/lib/project-state.js:58-65`, R8/R13). La regla de la spec solo lee el valor en la misma línea de `- **Bloqueos / esperando:**`. El `current.md` de este mismo repo pone los bloqueos como sub-viñetas debajo, así que se evalúa como "no bloqueado" (comprobado: este repo sale `en_curso`, no `atencion`). La implementación cumple la spec; es la spec/plantilla la que debería alinearse (o ampliar la regla a las sub-viñetas) en una tarea posterior.
2. **`projects.json` corrupto → 500 en todo el panel** (`panel/lib/registry.js:16`, `panel/lib/app.js:22`). Si el humano edita a mano el registro y deja un JSON inválido, `GET /api/projects` responde 500 "Error interno" y la UI muestra solo "No se pudo cargar…". No peta el proceso (cumple convenciones), pero un mensaje específico ("projects.json no es JSON válido") ayudaría al humano.
3. **Subdirectorio dentro de otro repo** (`panel/lib/git-info.js:59`). `rev-parse --is-inside-work-tree` acepta un directorio que está dentro de un repo padre, por lo que mostraría la rama/commits del padre. Aceptable para el uso previsto; anotar.
4. **`package.json` scripts.test** es `node --test` (T1 decía `node --test test/`). Funciona igual (descubre `test/*.test.js` y también ejecuta `test/helpers.js` como fichero sin tests). Inocuo.

### Notas
- Portabilidad Windows: toda la construcción de rutas usa `path.join/resolve/sep/isAbsolute`; no hay rutas POSIX hardcodeadas en `lib/` ni `server.js` (las de los tests van solo a runners simulados). `execFile` sin shell y con `windowsHide`. `fs.rename` sobre fichero existente es válido en Windows. `git init -b main` en los tests requiere git ≥ 2.28 (solo tests).
- `/index.html/` (barra final) sirve 200; irrelevante.
- `href` de `appUrl`/`repoUrl` se escapa pero no se valida el esquema; el dato lo controla el propio humano en `projects.json`/alta. Panel local sin autenticación, como declara D9 y el pie de página.
- No existe `progress/impl_puesto-de-mando-base.md`; el implementer dejó el estado en `progress/current.md`. Sin impacto en la revisión.

## Para el leader
- Marcar la feature como `done`, registrar la entrada en `progress/history.md` y actualizar `progress/current.md`.
- T27 (manual) queda a cargo del humano: URL LAN desde el móvil, emulador 360×640, tema oscuro, servidor parado con página abierta, alta con ruta inexistente, "Añadir a pantalla de inicio".
- Pendiente del humano (no de esta feature): rutas reales en `panel/projects.json` y aportar `muver.html` para `panel/legacy/`.
