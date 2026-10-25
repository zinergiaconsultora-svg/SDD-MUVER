# Revisión — Feature 4: `puesto-de-mando-trabajar`

**Veredicto: APROBADO** (HEAD `4e5e34f`, diff desde `sdd-checkpoint-trabajar-start`). No hay defectos bloqueantes
contra la spec aprobada (R1–R99, D1–D17, correcciones T36). Hay una **mejora de prioridad alta** (M1: en Windows se
puede ejecutar un `git.exe` de la carpeta del proyecto) que conviene resolver antes de abrir el panel a Internet
con dominio propio (T37/fase 5), y varias mejoras y notas. T37 (manual por Internet) sigue pendiente y no es motivo
de rechazo.

## Checklist

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad R1–R99 ↔ tests | OK. Las 94 etiquetas `[F4-R1]`–`[F4-R94]` existen en `panel/test/`. R95–R99 son manuales (T36/T37). He leído los tests de seguridad: `claude-cli`, `exec-utils`, `runs-api`, `work-api`, `reauth-api`, `cf-access`, `audit`, `git-actions`, `sdd-actions` y `rate-limit`. No son triviales. JWT: firma ajena, `aud`, `iss`, `exp`, `nbf`, `HS256`, `none`, `kid` desconocido y caché/rotación. Reauth a 16 min, desde la LAN, con Access y con suplantación de `CF-Connecting-IP` desde una IP que no es loopback. R5 cubre las ocho acciones sin procesos ni ficheros. R76 comprueba que no salen secretos en `audit.log`. R57 cubre `../secreto.txt` sin ejecutar `git diff`. |
| 2 | `bash init.sh` | OK: **411 tests, 411 pass, 0 fail, 0 skipped** (Linux). sdd-lint: 0 errores y 0 advertencias (99 requisitos, 38 tareas). En Windows, según el humano: 410 pass y 1 omitido, el previsto. |
| 3 | Tareas | T1–T35 y T38 `[x]`. **T36 sigue `[ ]`** y `docs/verification.md` (R95–R98, fila T36) sigue diciendo "pendiente del humano", aunque el humano la superó (`progress/current.md`). El leader debe registrar el resultado (fecha, `claude --version` 2.1.307 y lo comprobado) y marcar T36. T37 queda `[ ]` (manual, aceptado). |
| 4 | Convenciones | OK. Código en inglés, comentarios y textos visibles en español, constantes en MAYÚSCULAS y errores con mensaje útil sin datos sensibles. `work-api.js` es largo (680 líneas), pero está dividido en funciones de un solo propósito. |
| 5 | Checkpoints | Se cumplen, salvo dos tareas administrativas del leader: la entrada en `progress/history.md` y el registro de T36 (punto 3). No hay `progress/impl_<feature>.md` (igual que en las fases 1–3); el estado está en `progress/current.md`. |
| 6 | Diseño | OK. La implementación coincide con D1–D17 y con las correcciones T36. Desviaciones declaradas: ver §Regresiones. No se ha colado nada fuera del diseño. Hay dos incoherencias de documentación (N1, N2). |

## Pruebas contra la app real (`server.js` + CLI falso)

Entorno de la prueba: `CLAUDE_BIN=panel/test/fixtures/fake-claude.js` y `PANEL_DATA_DIR`/`CLAUDE_HOME_DIR` en el
scratchpad. El proyecto temporal era un repo git con `init.sh` y `feature_list.json`, con `origin` apuntando a un
`--bare` local. No toqué `panel/projects.json` y el árbol de trabajo quedó limpio.

- Sin sesión, `POST /runs` y SSE → 401. Sin `X-Requested-With` → 403.
- Prompt `--dangerously-skip-permissions [[ok]]` → argv exacto `[-p, --output-format, stream-json, --verbose, --permission-mode, acceptEdits, --allowedTools, <reglas>]`, con el prompt **solo por stdin** y `cwd` = carpeta del catálogo.
- `POST /permissions`: rechaza `npm run test*`, `a,Bash(*)`, `x)` y `git:*` (no admite `*`, `,`, `(` ni `)`, así que no se puede inyectar una regla). **Acepta `git`, `node` y `env`** y genera `Bash(git *)`, `PowerShell(node *)`… (ver M2).
- `git/commit-push` con mensaje `--amend` → commit con el mensaje literal "--amend" y `push -u origin main` al remoto local. Nunca `--force`. `GIT_TERMINAL_PROMPT=0`.
- **Hooks:** un `.git/hooks/pre-commit` del repo **se ejecutó** al hacer commit desde el panel (M3).
- `changes/diff?file=../data/auth.json` → 400 sin ejecutar diff. **`file=*`** (un fichero versionado que se llama `*`) → git lo trata como pathspec glob y devuelve también el diff de `b.txt` (N3).
- Dos `approve-spec` simultáneos → uno 200 y otro 409. Solo cambia la línea del `status`.
- `[[hang]]` + cancelar → `cancelled`. El hijo y el nieto (mismo grupo) desaparecen en < 6 s, sin huérfanos.
- Reauth desde una IP de la LAN (192.0.2.2) cambiando `CF-Connecting-IP` en cada intento: 401 ×5 y 429 la sexta vez. El limitador usa la IP real. `audit.log` registra `tunnel: true`, no guarda la contraseña y el mensaje del commit va recortado a 120 caracteres.

## Revisión con mentalidad de atacante

**Ejecución de procesos.** `spawn`/`execFile` nunca usan `shell` (`runs.js:188-197` lo fija explícitamente a
`false`). Los argumentos van siempre en array, el prompt solo por stdin (`runs.js:282-290`) y el `cwd` sale siempre
del catálogo (`work-api.js:190-194`). `FORBIDDEN_ARGS` se comprueba en `buildClaudeArgs` y además con un test
estático. El cliente no elige el binario de Claude: viene de `CLAUDE_BIN` o `claude`, resuelto al arrancar.
`testCommand` elige un ejecutable cualquiera, pero así está diseñado: lo configura el humano, y por el túnel exige
reauth o Access. El parser propio no da significado a `| & ; > $ '`. `ALLOWED_COMMAND_RE` impide salir de la regla
`Bash(x *)`. `--resume <id>` solo admite ids conocidos.

**git-actions.** El diff solo se ejecuta para rutas de la lista `status -z`, con comparación exacta. El commit va
como `-m <mensaje>` en un solo argumento. Push sin `--force`. Rama validada con `BRANCH_RE`.

**sdd-actions.** La edición se hace por rango y se verifica con `isDeepStrictEqual`; luego se escribe con `.tmp` +
`rename` bajo un cerrojo por carpeta.

**Autenticación.** Todas las rutas de `work-api` van detrás de `currentSession` (`app.js:425-429`). `gateExec` cubre
las 8 acciones de ejecución y el `PATCH` con campos de ejecución. `POST /api/projects` descarta
`allowedCommands`/`testCommand`. Con Access, el middleware verifica el JWT antes de todo, estáticos incluidos.
JWT: solo RS256 (`none`/HS256 → `alg`), `crypto.verify` con la clave del `kid`, `aud`/`iss`/`exp`/`nbf` con 60 s
de margen, y recarga por `kid` desconocido como mucho una vez por minuto. Detección del túnel: cabeceras que
Cloudflare siempre añade y que un cliente de Internet no puede quitar. Falsificarlas desde la LAN solo endurece.
El anti-CSRF cubre todo método que no sea GET/HEAD.

**Recursos.** `checkLimits` + `register` son síncronos (sin carrera entre la comprobación y el alta). Hay timeout que
mata el árbol de procesos, 5 MB por run y líneas de 1 MB. El historial rota a 200 runs, `audit.log` a 5 MB y el mapa
del limitador está acotado a 10 000 entradas. SSE: latido de 15 s y cierre tras `end` o al cerrar el servidor.

**Fugas y XSS.** Todo lo que pinta `work.js` pasa por `escapeHtml` (que escapa `& < > " '`): salida de
Claude/comandos, diff, nombres de fichero, ramas, denegaciones y textos de confirmación. Los enlaces solo admiten
`http(s)` (`safeHttpUrl` y `isHttpUrl` en altas y PATCH). Las rutas de herramientas se muestran relativas al
proyecto. `audit.log` no guarda secretos.

## Hallazgos

### Bloqueantes

Ninguno.

### Mejoras

- **M1 (alta) — PATH hijacking en Windows con `git`.**
  - Dónde: `git-info.js:22` y `:56`, `git-actions.js:41-43` (`execFile('git', …, { cwd: <proyecto> })`), y los fallbacks `{ file: bin }` de `exec-utils.js:131` y `claude-cli.js:129`.
  - Requisitos: R54, R61, R55–R58.
  - Mecanismo: en Windows, libuv busca un nombre sin ruta **primero en el `cwd` del hijo** (`.com` y `.exe`) y después en `PATH`. Un `git.exe` o `git.com` en la raíz de un proyecto (por ejemplo, un repo clonado que lo incluya) se ejecuta con los privilegios del humano solo con listar el proyecto en el panel o abrir "Trabajar" o "Ver cambios", sin ningún clic de ejecución.
  - Precedente: es la misma clase de fallo que la CVE de VS Code con `git.exe` en la carpeta del workspace.
  - Alcance: `commit-push` sí resuelve `git` desde `PATH` (`work-api.js:367-375`). Las lecturas no, y la fase 1 ya lo hacía así (`git-info`). Es una laguna del diseño (§5.8 especifica `execFile('git', …)`), no un incumplimiento. Por eso no bloquea, pero debe corregirse antes de la exposición permanente.
  - Arreglo propuesto: resolver `git` a una ruta absoluta del `PATH` al arrancar y usarla en todos los runners; que `resolveExecutable`/`resolveClaudeCommand` devuelvan error en vez de `{ file: bin }` si no lo encuentran; opcionalmente, `NoDefaultCurrentDirectoryInExePath=1` en el entorno del panel.
  - Verificación manual en Windows: renombrar una copia de `whoami.exe` a `git.exe` en un proyecto de prueba y abrir el panel.
- **M2 (media) — Comandos autorizados demasiado amplios.**
  - Dónde: `claude-cli.js:37` (`ALLOWED_COMMAND_RE`) y `:179-192` (`suggestAllowedCommand`). Requisitos: R62, R64, R65.
  - `git`, `node`, `env`, `bash`, `sh`, `powershell`, `pwsh`, `npx`, `python`… son válidos y equivalen a permitir casi todo. Por ejemplo, `Bash(git *)` incluye `git -c core.sshCommand=… fetch`, `git push --force` y alias. `Bash(node *)` incluye `node -e`.
  - Peor aún, R65 **propone** el comando base cuando el segundo token empieza por `-`: `node -e "…"` → sugiere `node`, y `git -c x=y push` → sugiere `git`. Con un clic en "Permitir y reintentar", un Claude manipulado por inyección de prompt consigue ejecución libre en ese proyecto de forma permanente. El diálogo muestra «git», pero no advierte del alcance.
  - Recomendación: no sugerir un token suelto si es un intérprete, una shell, `env` o `git`, y mostrar un aviso explícito si el humano lo añade a mano.
- **M3 (media) — Hooks y configuración del repo.**
  - Dónde: `git-actions.js:17-19` y `git-info.js:56`. Requisitos: R58, R61.
  - `Commit y push` ejecuta los hooks de `.git/hooks` (verificado con `pre-commit`). `git status` (del panel y del `Bash(git status *)` por defecto de Claude) ejecuta `core.fsmonitor` de `.git/config`. Si Claude puede escribir en `.git/` con `acceptEdits`, puede escalar a ejecución arbitraria, y en el caso de `fsmonitor` sin clic, por el sondeo del panel.
  - Contexto: Claude Code protege en principio `.git/` y `.claude/` frente a la edición automática (hay que comprobarlo en la versión 2.1.307). Además, "Ejecutar tests" ya ejecuta código que Claude puede editar (`init.sh`), así que el riesgo añadido es limitado.
  - Recomendación: en las llamadas del panel, `-c core.fsmonitor=false` (y `-c core.hooksPath=` si el humano decide no ejecutar hooks), y documentar la decisión en `docs/architecture.md`.
- **M4 (baja) — Push que puede quedarse esperando.**
  - Dónde: `git-actions.js:28` (`GIT_STEP_ENV`). Requisito: R58.
  - Falta `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`: un push por SSH con clave protegida o host desconocido puede quedarse esperando hasta el timeout del run (30 min) en vez de fallar enseguida.
- **M5 (baja) — Eventos que esquivan el límite de salida.**
  - Dónde: `runs.js:19` (`LIMITED_TYPES`). Requisito: R30.
  - `permission_denied`, `notice`, `session`, `result` y `error` no cuentan para el límite de 5 MB, y `permissionDenials` crece sin tope en `index.json`. Los genera el CLI, no el modelo directamente, pero un bucle de denegaciones puede inflar memoria y disco.
  - Recomendación: contarlos también y limitar `permissionDenials` (p. ej. a 50).

### Notas

- **N1.** `design.md:638` (tabla de alternativas) sigue diciendo que "Pasar el prompt por stdin" se descarta. Contradice D1/§5.2 tras la corrección T36. Conviene actualizarlo.
- **N2.** `design.md:615` (§9 "NO se tocan") sigue listando `http-utils.js` y `rate-limit.js`, que se modificaron como corrección T36. Las modificaciones están declaradas en §5.10/R68 y en `docs/verification.md` y son legítimas, pero la lista quedó desactualizada.
- **N3.** `git-actions.js:15-16`: la ruta va después de `--`, pero git sigue aplicando la magia de pathspec. Un fichero cambiado llamado `*` o `:(glob)…` devuelve el diff de otros ficheros cambiados. Impacto mínimo, porque todos están en la lista visible. Se arregla con `--literal-pathspecs` o `GIT_LITERAL_PATHSPECS=1`.
- **N4.** `approve-spec` no comprueba que no haya un run activo en el proyecto. Si Claude está editando `feature_list.json` a la vez, puede perderse una de las dos escrituras. El riesgo es bajo, porque el humano decide cuándo pulsar.
- **N5.** Además de `--allowedTools`, el CLI aplica los permisos de `~/.claude/settings.json` y de `.claude/settings*.json` del proyecto. Si esos ficheros son permisivos, el modelo acotado del panel se amplía. Conviene mencionarlo en `docs/architecture.md` junto a la nota de hooks.
- **N6.** Desde la LAN basta la sesión (R70), y `server.js` escucha en `0.0.0.0`. Una cookie robada en la red local da ejecución sin reconfirmar. Así está diseñado.

## Regresiones y desviaciones declaradas

Todas son legítimas y están documentadas en `docs/verification.md` y en design §8.4 y §5.10:

- `--no-optional-locks` en `GIT_COMMANDS`.
- `readConfig` con campos nuevos.
- `PATCHABLE_FIELDS` ampliado.
- `reauthAt` en la sesión.
- `[F2-R25]`/`[F2-R14][F2-R15]` desde `127.0.0.1`.
- `[F3-R33]`/`[F2-R34]` sobre `projects.example.json`.
- Registro vivo en `<datos>/projects.json`: `panel/projects.json` queda intacto y no se modifica.
- `claude-discovery.js` solo cambia en la línea del título (M1 de la fase 3).

Las fases 1–3 siguen en verde dentro de los 411 tests.

## Portabilidad Windows

- `taskkill /PID /T /F` sin `detached` (verificado por el humano en T36).
- `npm`/`npx` → `node npm-cli.js`; los `.cmd`/`.bat` se rechazan.
- Git Bash: se descarta `System32`/`sysnative`.
- Rutas compuestas con `path.win32` y comparadas con `pathKey`.
- `fileURLToPath` en `server.js`.
- Riesgo pendiente: M1.
