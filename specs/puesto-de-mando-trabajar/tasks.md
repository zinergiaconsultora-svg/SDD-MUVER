# Tareas — Feature 4: Puesto de Mando MUVER (fase 4: trabajar desde el panel)

> Orden TDD: para cada módulo **tests → implementación**. Cada tarea indica los requisitos (R<n>) que cubre.
> Marca `[x]` al terminar cada una. Contratos en `design.md` §3–§5; UI en §6; fixtures y reparto de tests en §8.
> Reglas de oro de esta fase: **ningún `spawn`/`execFile` con shell**, **ninguna ruta de trabajo que venga del cliente**,
> **nunca** `--dangerously-skip-permissions` ni `bypassPermissions`, y los tests usan siempre el CLI falso, repos
> temporales y un directorio de datos temporal (nunca el `claude` real ni `~/.claude`).

## Fase 0 — Preparación de tests

- [x] T1. Crear `panel/test/fixtures/fake-claude.js` (escenarios `ok`, `denied`, `error`, `crash`, `hang` con nieto, `big`, `garbage` y registro en `FAKE_CLAUDE_LOG`) y `panel/test/fixtures/fake-command.js` (`ok`, `fail <n>`, `sleep <ms>`) según design.md §8.1 (R13, R14, R15, R17, R24, R25, R26, R30, R50).
- [x] T2. Ampliar `panel/test/helpers.js` (`startApp` con `claudeCommand` del CLI falso y `extraEnv.FAKE_CLAUDE_LOG` por defecto, devuelve `fakeLog`) y crear `panel/test/work-helpers.js` (`waitForRun`, `readSse`, `makeAccessKeys`, `startCertsServer`, `makeJwt`, `tunnelHeaders`, `readFakeLog`); comprobar que todos los tests de las fases 1–3 siguen en verde sin cambios (R17, R39, R67, R71).

## Fase 1 — Configuración y arranque

- [x] T3. Ampliar `panel/test/config.test.js`: `readConfig` con las variables nuevas, valores por defecto, fuera de rango y `cfAccess` (válido, incompleto, equipo no válido); `buildStartupLines` con `work` en sus variantes y sin `work` (líneas actuales intactas) (R1, R2, R3).
- [x] T4. Implementar en `panel/lib/config.js` `allowExec`, `maxRuns`, `runTimeoutMs`, `claudeBin`, `bashBin`, `cfAccess` y las líneas de `work` (design.md §5.1) hasta que pase T3; actualizar `panel/server.js` (opciones nuevas, `resolveClaudeCommand`, líneas de arranque, cierre de runs en `SIGINT`/`SIGTERM`) según §5.17 (R1, R2, R3, R33).

## Fase 2 — Llamada a Claude Code (`lib/claude-cli.js`)

- [x] T5. Escribir `panel/test/claude-cli.test.js`: `buildClaudeArgs` en los tres modos y con prompts que empiezan por `-`; `buildAllowedTools`; ausencia de `FORBIDDEN_ARGS` y test estático del fuente; `resolveClaudeCommand` con la tabla de §5.2 (`linux`/`win32`, `exists` inyectado); `createStreamMapper` con las líneas de los escenarios `ok`, `denied`, `error`, `garbage`, `api_retry` y `tool_result` de error; `summarizeToolInput`; `suggestAllowedCommand` e `isValidAllowedCommand` (R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R65).
- [x] T6. Implementar `panel/lib/claude-cli.js` (`CLI_FLAGS`, `DEFAULT_ALLOWED_TOOLS`, `FORBIDDEN_ARGS`, `SDD_PROMPTS`, `MAX_PROMPT_CHARS` y funciones de design.md §5.2) hasta que pase T5 (R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R65).

## Fase 3 — Utilidades de procesos (`lib/exec-utils.js`)

- [x] T7. Escribir `panel/test/exec-utils.test.js`: `parseCommandLine` (casos válidos y cada error), `formatCommandLine`, `resolveExecutable` en `win32` (`node`, `npm`, `npx`, `bash`, `git.exe`, `yarn.cmd`) y en `linux`, `findGitBash` (orden y descarte de `System32`), `killProcessTree` con espías (`taskkill` exacto; `-pid` `SIGTERM` → `SIGKILL` con reloj inyectado), `createLineSplitter` (línea partida, línea > límite descartada una vez, `\r\n`), `stripAnsi` (R28, R31, R52, R53, R54).
- [x] T8. Implementar `panel/lib/exec-utils.js` según design.md §5.3 hasta que pase T7 (R28, R31, R52, R53, R54).

## Fase 4 — Historial en disco (`lib/run-store.js`)

- [x] T9. Escribir `panel/test/run-store.test.js`: `create` + `appendEvent` + `updateMeta` + `readEvents` sobre un directorio temporal; `list` con 60 metas (50, orden); `find` con id válido, inexistente y con formato inválido; `rotate` con `keepRuns: 3` sin borrar activos; `recoverOrphans` (R32, R34, R35, R36, R37).
- [x] T10. Implementar `panel/lib/run-store.js` (design.md §3.4 y §5.5, escrituras `.tmp` + `rename` y colas por proyecto/run) hasta que pase T9 (R32, R34, R35, R36, R37).

## Fase 5 — Ajustes, sesiones y mejoras M1/M4/M5 en módulos existentes

- [x] T11. Ampliar `panel/test/registry.test.js` (`allowedCommands`, `testCommand`, URLs `http(s)` en `validateNewProject` y `validatePatch`, `normalizeSettings`), `panel/test/auth.test.js` o el test de sesiones (`create({ reauthAt })`, `markReauth`, persistencia y carga de `reauthAt`), `panel/test/git-info.test.js` (lista `GIT_COMMANDS` con `--no-optional-locks`, design.md §8.4) y `panel/test/claude-discovery.test.js` (`summary` de 120 caracteres recortado) (R61, R62, R66, R68, R92).
- [x] T12. Implementar los cambios de `panel/lib/registry.js` (§5.15), `panel/lib/sessions.js` (§5.16), `panel/lib/git-info.js` (M4) y la línea del título en `panel/lib/claude-discovery.js` (M1) hasta que pase T11 sin romper los tests de las fases 1–3 (R61, R62, R66, R68, R92).

## Fase 6 — Runs de Claude, cancelación y salida en vivo

- [x] T13. Escribir `panel/test/runs-api.test.js`: `POST /runs` con el escenario `ok` (argumentos, `cwd`, `RunMeta`, estados y campos finales); validación del prompt; proyecto inexistente/no ejecutable; un run por proyecto y `maxRuns`; sesión `new`/`continue`/`resume` válida e inválida; `denied` → `needs_permission`; `error`, `crash` y binario inexistente → `failed`; cancelación con nieto muerto; `409`/`404` de cancelación; timeout; límite de salida con `big`; huérfanos al arrancar; cierre del servidor; `GET /api/runs/:runId`; evento `prompt` y `promptPreview`; SSE (cabeceras, eventos en vivo, `Last-Event-ID`, cierre tras `end`, `401`/`404`, latido) (R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R29, R30, R32, R33, R36, R38, R39, R40, R41, R42, R43).
- [x] T14. Implementar `panel/lib/runs.js` (§5.4), `panel/lib/command-runner.js` (§5.6), `panel/lib/sse.js` (§5.12) y en `panel/lib/work-api.js` las rutas `POST /api/projects/:id/runs`, `GET /api/runs/:runId`, `GET /api/runs/:runId/events` y `POST /api/runs/:runId/cancel` con un `gateExec` inicial (solo `allowExec`); conectar `work-api` en `panel/lib/app.js` (opciones nuevas, `recoverOrphans`, cierre en `'close'`) hasta que pase T13 (R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R29, R30, R32, R33, R36, R38, R39, R40, R41, R42, R43).

## Fase 7 — Botones SDD (`lib/sdd-actions.js`)

- [x] T15. Escribir `panel/test/sdd-actions.test.js`: `locateFeatureStatus`/`setFeatureStatus` (2 espacios, `\r\n` + BOM, `status` antes y después de objetos anidados, clave duplicada, `locateFn` defectuoso → error de verificación); integración de `implement` (prompt exacto, modo `new`), `approve-tests` (prompt exacto, `--continue`), `approve-spec` (bytes idénticos salvo el valor, `.tmp` + `rename`, respuesta) y sus errores (`400`, `409` no `spec_ready`, `409` otra `in_progress`, `409` sin arnés o con JSON roto) (R44, R45, R46, R47, R48, R49).
- [x] T16. Implementar `panel/lib/sdd-actions.js` (§5.7) y las rutas `sdd/implement`, `sdd/approve-tests` y `sdd/approve-spec` en `panel/lib/work-api.js` hasta que pase T15 (R44, R45, R46, R47, R48, R49).

## Fase 8 — Ejecutar tests, ver cambios y commit/push

- [x] T17. Escribir en `panel/test/work-api.test.js` (bloque A): `POST /tests` con `testCommand` (`fake-command.js ok` y `fail 3`, salida sin ANSI), con `init.sh` (`echo listo`) y sin ninguno (`409`); `GET /changes` (modificado, sin seguimiento, renombrado, nombre con espacios y acentos; sin git `409`); `GET /changes/diff` (modificado, sin seguimiento, 300 KB recortado, fichero no listado `400` sin llamar a `diff`); `commit-push` con y sin upstream contra un remoto `--bare` local, remoto inexistente (`failed`) y errores de mensaje, sin cambios y HEAD separado; plan con mensaje `--amend; rm -rf /` como un solo argumento y test estático sin `--force` (R50, R51, R55, R56, R57, R58, R59, R60).
- [x] T18. Implementar `panel/lib/git-actions.js` (§5.8), `resolveTestCommand` en `panel/lib/sdd-actions.js` y las rutas `tests`, `changes`, `changes/diff` y `git/commit-push` en `panel/lib/work-api.js` hasta que pase T17 (R50, R51, R55, R56, R57, R58, R59, R60).

## Fase 9 — Seguridad: confirmación, Cloudflare Access y auditoría

- [x] T19. Escribir `panel/test/reauth-api.test.js`: acción por el túnel sin confirmación reciente (`CF-Connecting-IP` y `X-Forwarded-Proto: https`) → `401 reauthRequired` sin proceso; `POST /api/auth/reauth` correcto, incorrecto (limitador → `429`) y sin sesión; `reauthAt` tras `login`/`setup` y a los 16 minutos; red local sin confirmación; `cfAccess: { error }` → `403` por el túnel y `200` en local; con Access válido no se pide confirmación (R2, R67, R68, R69, R70, R74).
- [x] T20. Implementar `panel/lib/reauth.js` (§5.10), la ruta `POST /api/auth/reauth` y `reauthAt` en `login`/`setup` en `panel/lib/app.js` (§5.14) y completar `gateExec` en `panel/lib/work-api.js` (§4.5) hasta que pase T19 (R2, R67, R68, R69, R70, R74).
- [x] T21. Escribir `panel/test/cf-access.test.js`: `createAccessVerifier` con par RSA generado en el test (válido y cada motivo de rechazo), caché de 1 h, recarga por `kid` desconocido limitada a una por minuto y fallo de descarga; integración con `startCertsServer`: estáticos y `/api/auth/status` por el túnel sin token → `403`, en local → `200` (R71, R72, R73).
- [x] T22. Implementar `panel/lib/cf-access.js` (§5.9) y la comprobación de Access al principio de `handle` en `panel/lib/app.js` (§4.2) hasta que pase T21 (R71, R72, R73).
- [x] T23. Escribir `panel/test/audit.test.js`: `createAuditLog` (líneas, rotación con `maxBytes: 200`, nunca lanza); integración: run aceptado, `409` y `401` por confirmación con sus campos, `run.end`, y búsqueda en `audit.log` de la contraseña, el token de sesión, el JWT y el carácter 121 del prompt (R75, R76, R77).
- [x] T24. Implementar `panel/lib/audit.js` (§5.11) y las llamadas de auditoría en `gateExec`, `reauth`, cancelación y fin de run hasta que pase T23 (R75, R76, R77).

## Fase 10 — Estado, permisos por proyecto y cola de atención

- [x] T25. Escribir en `panel/test/work-api.test.js` (bloque B): `GET /api/work/status` y `GET /api/projects/:id/work` (contratos de §4.3 en sus variantes); `allowExec: false` en las ocho acciones (sin proceso ni ficheros tocados, lecturas en `200`); `PATCH` con `allowedCommands`/`testCommand` (válidos, inválidos, como acción de ejecución) y sin ellos (como la fase 3); `POST /permissions` (duplicado, proyecto solo de Claude → `both`, inválido); URLs no `http(s)` en `POST`/`PATCH` → `400`; `GET /api/attention` y `POST /dismiss` (R4, R5, R6, R62, R63, R64, R66, R78, R79).
- [x] T26. Implementar en `panel/lib/work-api.js` `GET /api/work/status`, `GET /api/projects/:id/work`, `POST /permissions`, `GET /api/attention`, `POST /dismiss` y `isExecPatch`, y en `panel/lib/app.js` la puerta de ejecución para el `PATCH` con campos de ejecución, hasta que pase T25 (R4, R5, R6, R62, R63, R64, R66, R78, R79).

## Fase 11 — Interfaz (`public/`)

- [x] T27. Escribir `panel/test/work-render.test.js` (`renderWorkView` con y sin arnés/`specReady`/git/tests, solo lectura y no ejecutable; `describeAction` con los textos de §6.3; `renderRunEvent` por tipo con escapado; `renderPermissionPrompt` y `buildRetryPayload`; `renderDiff`; `createApiClient` con `401 reauthRequired` y `withReauth`; `renderAttention`; `renderRunList` y `STATE_LABELS`; `suggestCommitMessage`) y ampliar `panel/test/render.test.js` con URLs `javascript:` sin `href` (R80, R81, R82, R83, R84, R85, R86, R87, R88, R89, R90).
- [x] T28. Implementar `panel/public/work.js` (§6.2–§6.4), el cambio de `panel/public/api-client.js` (no llamar a `onUnauthorized` con `reauthRequired`) y `safeHttpUrl` en `panel/public/render.js` hasta que pase T27 sin romper los tests de render de las fases 1–3 (R80, R81, R82, R83, R84, R85, R86, R87, R88, R89, R90).
- [x] T29. Ampliar `panel/test/styles.test.js` y modificar `panel/public/index.html` (`#attention`, `#confirm-dialog`, `#reauth-dialog`) y `panel/public/styles.css` (selectores de §6.1, claro/oscuro, sin anchos > 360 px) hasta que pase (R91).
- [x] T30. Cablear `panel/public/app.js` según §6.5 (pestañas Resumen/Trabajar, `EventSource`, diálogos de confirmación y de contraseña, cancelar, permitir y reintentar, aprobar spec → implementar, commit con mensaje prerrellenado, ajustes de ejecución, "Te necesitan" con descartar); comprobación manual en navegador a 360 px contra el panel con el CLI falso (`CLAUDE_BIN=panel/test/fixtures/fake-claude.js`) (R80, R82, R84, R86, R87, R88, R89).

## Fase 12 — Despliegue y documentación

- [x] T31. Ampliar `panel/test/deploy.test.js` con el test estático de `uninstall-service.ps1` (`Name = 'cloudflared.exe'`, `--url http://localhost:`, `Stop-Process`) y el de documentación de la fase 4 (variables y módulos en `docs/architecture.md`, prefijo `[F4-R` en `docs/verification.md`, `## 9. Cloudflare Access` después de `## 8.` en `docs/acceso-web.md`) (R93, R94).
- [x] T32. Modificar `panel/deploy/uninstall-service.ps1` para cerrar también los `cloudflared.exe` del túnel (mismo patrón que los `node.exe`) hasta que pase su parte de T31 (R93).
- [x] T33. Actualizar `docs/architecture.md`: fase 4 en tipo de aplicación; piezas (runs en `<datos>/runs/`, `audit.log`, gestor de runs, CLI de Claude con permisos acotados, Access); comunicación (rutas de §4.1, SSE, confirmación por el túnel, Access); variables nuevas; restricción "el servidor no ejecuta comandos arbitrarios" actualizada (solo Claude con lista autorizada y comandos configurados, sin shell) (R94).
- [x] T34. Añadir al final de `docs/acceso-web.md` la sección `## 9. Cloudflare Access` (pasar de URL temporal a dominio propio con la §7, crear la aplicación self-hosted en Zero Trust → Access con política por email y código de un solo uso, copiar el AUD y el nombre del equipo, `setx PANEL_CF_ACCESS_TEAM`/`PANEL_CF_ACCESS_AUD`, reiniciar la tarea, qué pasa si solo se define una) y las filas de `PANEL_ALLOW_EXEC`, `PANEL_MAX_RUNS`, `PANEL_RUN_TIMEOUT_MIN`, `CLAUDE_BIN`, `PANEL_BASH_BIN`, `PANEL_CF_ACCESS_TEAM` y `PANEL_CF_ACCESS_AUD` en la tabla de §5, sin reescribir lo existente, hasta que pasen T31 y el test `[F2-R45]` (R94).
- [x] T35. Añadir a `docs/verification.md` la tabla "Feature 4: `puesto-de-mando-trabajar` (prefijo `[F4-R<n>]`)" con una fila por requisito R1–R99 y sus tests, y las filas de comprobación manual (R94).

## Fase 13 — Comprobaciones manuales del humano y verificación final

- [ ] T36. **[MANUAL — humano, Windows + móvil]** _(2026-10-25: superada en el PC; pendiente móvil y Commit y push real)_ Con el panel en el PC: `claude --version` anotado; chat desde el móvil por la red local y por el túnel (salida en vivo, coste, historial, "Continuar la última sesión"); petición de un comando no autorizado → "Necesita permiso" → "Permitir y reintentar"; cancelar un run largo y comprobar en el Administrador de tareas que no quedan procesos hijos; "Ejecutar tests" con `init.sh` (ruta de Git Bash detectada) y "Commit y push" real; anotar en `docs/verification.md` (R95, R96, R97, R98).
- [ ] T37. **[MANUAL — humano, Internet]** Por la URL temporal: acción pasados 15 minutos → pide la contraseña. Con dominio propio y Access según `docs/acceso-web.md` §9: código de un solo uso, contraseña del panel y acciones sin reconfirmar; anotar en `docs/verification.md` (R99).
- [x] T38. Verificar con `./init.sh` desde la raíz: estructura OK, `npm test` del panel en verde (fases 1–4) y `sdd-lint` con 0 errores y 0 advertencias (R61, R92, R94).
