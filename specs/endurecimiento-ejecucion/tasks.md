# Tareas — Feature 14: endurecimiento de la ejecución (hallazgos del reviewer de la fase 4)

> Orden TDD: para cada módulo **tests → implementación**. Cada tarea indica los requisitos (R<n>) que cubre; en los
> tests se etiquetan como `[F14-R<n>]`. Marca `[x]` al terminar cada una. Contratos en `design.md` §3–§5; UI en §6;
> fixtures, reparto y cambios declarados de tests anteriores en §8.
> Reglas de oro: **ningún proceso con nombre suelto ni con ruta dentro de un proyecto** (salvo `projectScript`),
> **ningún `shell: true`**, los tests nunca lanzan el `claude` real (CLI falso o `PATH` de prueba sin Claude) y los
> ejecutables falsos solo escriben ficheros de marca en temporales.

## Fase 0 — Preparación

- [x] T1. Añadir a `panel/test/helpers.js` las opciones `env` y `claudeBin` de `startApp` (se pasan a `createApp`), y al CLI falso `panel/test/fixtures/fake-claude.js` el escenario `[[flood]]` de design.md §8.1; comprobar que todos los tests actuales siguen en verde (R27, R28, R33).
- [x] T2. Crear `panel/test/hardening.test.js` con las utilidades `plantFakeBins`, `makeTestPath` (proyecto + `.` + `binDir` con enlaces a `git` y `sh` reales) y `markExists`, y un test vacío que se salta en Windows o sin git (R11, R22, R23).

## Fase 1 — Resolvedor (`lib/trusted-bin.js`)

- [x] T3. Escribir `panel/test/trusted-bin.test.js`: orden de `PATH` y extensiones (linux/win32), rutas conocidas de §3.2 (`node`, `npm`/`npx`, `git`, `bash`, `claude`, `taskkill`), filtrado de entradas de `PATH`, exclusión del `cwd`, de otro proyecto, de una subcarpeta, por ruta real y del proyecto contenedor, errores `notFound`/`onlyInProject`/`invalidName`, `isTrustedPath`, caché (contador de `stat`) y negativos no cacheados (R1, R2, R3, R4, R5).
- [x] T4. Implementar `panel/lib/trusted-bin.js` según design.md §3.1–§3.4 y §4.1 hasta que pase T3 (R1, R2, R3, R4, R5).

## Fase 2 — Git: runner central, prefijo, diff literal, hooks y SSH

- [x] T5. Ampliar `panel/test/git-info.test.js`: `createGitRunner` con `execFileImpl` espía (ruta absoluta del resolvedor, prefijo `-c core.fsmonitor=false`, `cwd`, rechazo de un programa distinto de `git`, error de resolución, `NoDefaultCurrentDirectoryInExePath` solo en win32); los tests `[R12]` existentes siguen sin cambios (R7, R13, R21).
- [x] T6. Implementar en `panel/lib/git-info.js` `GIT_SAFE_PREFIX`, `createGitRunner` y el nuevo `defaultRunner` (design.md §5.2) hasta que pase T5 (R7, R13, R21).
- [x] T7. Ampliar `panel/test/git-actions.test.js`: listas nuevas de `diffHead`/`diffWorktree`/`stat*`, `hooksDir`/`hooksPathConfig`, pasos de `planCommitPush` con prefijo, `env` del push con y sin `GIT_SSH_COMMAND`/`GIT_SSH`, test estático sin `--no-verify`; ajustar `[F4-R60]` y `[F4-R58]` según design.md §8.3 (R21, R23, R25, R26).
- [x] T8. Implementar en `panel/lib/git-actions.js` los cambios de design.md §5.4 (`GIT_ACTION_ARGS`, `listActiveHooks`, `getChanges` con `hooks`, `planCommitPush` con `env`) hasta que pase T7 (R21, R23, R24, R25, R26).

## Fase 3 — Procesos: `exec-utils`, comando de tests y Claude

- [x] T9. Ampliar `panel/test/exec-utils.test.js`: `resolveExecutable` con resolvedor (sin fallback al nombre suelto; ajuste declarado de `[F4-R54]`), `taskkillPath` y `killProcessTree` en win32 con y sin `SystemRoot` (R1, R4, R10).
- [x] T10. Implementar los cambios de `panel/lib/exec-utils.js` (design.md §5.3) hasta que pase T9 (R1, R4, R10).
- [x] T11. Ampliar `panel/test/sdd-actions.test.js` con la tabla de design.md §3.6 para `resolveTestCommand` (nombre, `.js`, absoluta, relativa con separador → `projectScript`, relativa fuera del proyecto → `400`, `git` solo en el proyecto → `409`) (R9).
- [x] T12. Implementar en `panel/lib/sdd-actions.js` `resolveTestCommand` con resolvedor (design.md §5.7) hasta que pase T11 (R9).
- [x] T13. Ampliar `panel/test/claude-cli.test.js`: `resolveClaudeCommand` con resolvedor y `panelDir` (tabla de design.md §5.5; ajuste declarado de `[F4-R12]`) (R8).
- [x] T14. Implementar en `panel/lib/claude-cli.js` el nuevo `resolveClaudeCommand` hasta que pase T13 (R8).

## Fase 4 — Gestor de runs: guardia, entorno y límites

- [x] T15. Ampliar `panel/test/claude-cli.test.js` con el tope de 50 denegaciones de `createStreamMapper` (`denialsCapped`) (R28).
- [x] T16. Implementar `MAX_PERMISSION_DENIALS` y el tope en `createStreamMapper` (design.md §5.5) hasta que pase T15 (R28).
- [x] T17. Ampliar `panel/test/runs-api.test.js`: `guardedSpawn` rechaza `git`, `bin/git` y rutas dentro del `cwd` sin llamar a `spawnImpl` y acepta `projectScript` dentro del proyecto; `NoDefaultCurrentDirectoryInExePath` en win32; escenario `flood` con límite pequeño (todos los eventos cuentan, un aviso de truncado, `state`/`end` al final) y con límite normal (50 denegaciones en `index.json`, un aviso `denialsCapped`); recalcular `[F4-R30]` si fija `outputBytes` (R6, R13, R27, R28).
- [x] T18. Implementar en `panel/lib/runs.js` `guardedSpawn`, el entorno de Windows, `UNLIMITED_TYPES`, los avisos esenciales y `denialsCapped` (design.md §5.6) hasta que pase T17 (R6, R13, R27, R28).

## Fase 5 — Comandos amplios (M2)

- [x] T19. Ampliar `panel/test/claude-cli.test.js`: `isBroadCommand` con la tabla de design.md §3.5, `suggestAllowedCommand(s)` sin amplios (y ajuste declarado de `[F4-R65]` para `yarn run -s x`), `isValidAllowedCommand` con `-x`, `git:`, `npm run test:` y `npm run test:unit`, y la comprobación de caracteres de `buildAllowedTools` (R14, R15, R20).
- [x] T20. Implementar en `panel/lib/claude-cli.js` las listas de §3.5, `isBroadCommand`, las sugerencias y la regla nueva de `ALLOWED_COMMAND_RE`, y el texto ampliado de `EXEC_ERRORS.invalidCommand` en `panel/lib/registry.js` (design.md §4.1) hasta que pase T19 (R14, R15, R20).

## Fase 6 — API: cableado, permisos con aviso, hooks, approve-spec

- [x] T21. Ampliar `panel/test/work-api.test.js`: `POST /permissions` con `node` sin y con `acknowledgeBroad` (registro y auditoría), `npm test` sin marca; `PATCH` con `["npm test", "git"]` sin y con marca (sin guardar ningún campo en el rechazo) y `PATCH` posterior que conserva `git`; `GET /work` con `broadCommands` (R16, R17, R18).
- [x] T22. Completar `panel/test/hardening.test.js`: ejecutables falsos en el proyecto con `PATH` de prueba recorriendo listado, detalle, cambios, diff, tests (`git --version`), commit y push a un `--bare` local y chat con `claudeBin: 'claude'` (`409 onlyInProject`); `core.fsmonitor` con marca; fichero `*` y `textconv` con marca; `GET /changes` con `hooks` y `hooksPathCustom`; `approve-spec` con un run `[[hang]]` activo → `409` y bytes idénticos, y `200` tras cancelarlo (R4, R11, R22, R23, R24, R29).
- [x] T23. Implementar en `panel/lib/work-api.js` (design.md §5.8), `panel/lib/app.js` (§5.9) y `panel/server.js` (§5.10): resolvedor con instantánea del catálogo, runner de git por defecto, opción `env`, Claude por lanzamiento, permisos y `PATCH` con `acknowledgeBroad`, `broadCommands`, `hooks` en `/changes` y `409` de `approve-spec` hasta que pasen T21 y T22 (R4, R7, R11, R16, R17, R18, R22, R24, R29).

## Fase 7 — Interfaz (solo avisos)

- [x] T24. Ampliar `panel/test/work-render.test.js`: `BROAD_TEXTS`, `describeAction('allow-broad')`, `renderBroadWarning` y `renderHooksWarning` (textos exactos de design.md §6, escapado de `<script>`, variante `core.hooksPath`, listas vacías) (R19, R25).
- [x] T25. Implementar en `panel/public/work.js` las funciones de design.md §6 y en `panel/public/app.js` `confirmLabel`, el reintento con `acknowledgeBroad` en "Permitir…" y en "Ajustes de ejecución", el aviso de comandos amplios guardados y el aviso de hooks en "Commit y push" hasta que pase T24 (R19, R25).

## Fase 8 — Documentación

- [x] T26. Ampliar `panel/test/deploy.test.js` con los tests estáticos de las correcciones N1/N2, de la sección "Seguridad de la ejecución" y de la sección Feature 14 de `docs/verification.md` (cada `[F14-R<n>]` no manual presente en `panel/test/`) (R30, R31, R32).
- [x] T27. Corregir `specs/puesto-de-mando-trabajar/design.md` exactamente como indica design.md §9.1 (fila de §10 y lista de §9, con la nota "(corregido en la feature 14)") (R30).
- [x] T28. Añadir a `docs/architecture.md` la sección "Seguridad de la ejecución" con los seis apartados de design.md §9.2 (incluidos los riesgos conocidos N5 y N6) (R31).
- [x] T29. Añadir a `docs/verification.md` la sección "Mapa de trazabilidad — Feature 14" con prefijo `[F14-R<n>]`, una fila por requisito R1–R33, la fila manual de R12 "pendiente del humano" y los cambios declarados de design.md §8.3; con T26–T29 hechas, el test de T26 pasa (R32).

## Fase 9 — Comprobación manual y verificación final

- [ ] T30. [MANUAL — Windows] El humano sigue design.md §8.4 (`whoami.exe` copiado como `git.exe` y `claude.exe` en un proyecto de prueba, avisos de comando amplio y de hooks) y el leader anota fecha, versiones y resultado en la fila de R12 de `docs/verification.md` (R12, R19, R25).
- [x] T31. Verificar con `./init.sh` (todo en verde, solo los ajustes de tests anteriores de design.md §8.3) y `node sdd-lint.js` con 0 errores (R33).
