# Tareas — Feature 15: comandos amplios de git y npm (mejoras del reviewer de la feature 14)

> Orden TDD: en cada bloque, primero los tests y después la implementación. Cada tarea indica los requisitos (R<n>)
> que cubre. En los tests se etiquetan `[F15-R<n>]`. Marca `[x]` al terminar cada una. Las listas, el algoritmo y los
> textos exactos están en `design.md` §3–§5, el reparto de tests en §6 y la documentación en §7.
> Reglas de oro: **no se modifica ningún test anterior** (§6.3: si fuera imprescindible, se declara en
> `docs/verification.md`), **ningún `shell: true`**, y los ejecutables y scripts de prueba solo escriben ficheros de
> marca en temporales. No se tocan los ficheros de design.md §9.

## Fase 0 — Preparación

- [x] T1. Ejecutar `./init.sh` y comprobar que todo está en verde antes de empezar (base de R18).

## Fase 1 — Clasificación de git y npm (M1)

- [x] T2. Tests en `panel/test/claude-cli.test.js`: `[F15-R1]`, `[F15-R2]`, `[F15-R3]` y `[F15-R4]` con la tabla de design.md §3.5, y `[F15-R5]` con las listas de referencia de §3.4 (todas amplias, disjuntas de las permitidas y congeladas) (R1, R2, R3, R4, R5).
- [x] T3. Implementar en `panel/lib/claude-cli.js` `GIT_SAFE_SUBCOMMANDS`, `NPM_SAFE_SUBCOMMANDS`, `NPM_RUN_SUBCOMMANDS`, la ampliación de `GIT_EXEC_SUBCOMMANDS`, `NPM_EXEC_SUBCOMMANDS`, `commandBase` con `.exe/.cmd/.bat/.com/.ps1` y los casos 3–5 de `isBroadCommand` de design.md §3.2–§3.5, sin cambiar `WRAPPER_COMMANDS`, `RUNNER_COMMANDS` ni `PKG_EXEC_SUBCOMMANDS`; T2 y las tablas de F14 pasan (R1, R2, R3, R4, R5).
- [x] T4. Tests `[F15-R7]` en `panel/test/claude-cli.test.js` con los casos de requirements.md (R7).
- [x] T5. Implementar en `suggestAllowedCommand` la rama de alias de `run` de design.md §3.6 (con `commandBase(t0)`); T4 y los tests `[F14-R15]` pasan (R7).
- [x] T6. Test de integración `[F15-R6]` en `panel/test/hardening.test.js` con el fixture de design.md §6.1: primero se comprueba que el git real crea el fichero de marca y después que `isBroadCommand`/`suggestAllowedCommand` lo tratan como amplio (Linux, se salta sin git) (R6).
- [x] T7. Tests de integración `[F15-R8]` y `[F15-R9]` en `panel/test/work-api.test.js` (`POST /permissions` y `PATCH` con `git fetch`, `npm run-script`, `npm install`; `broadCommands` con comandos ya guardados); deben pasar sin tocar `work-api.js` ni `app.js` (R8, R9).

## Fase 2 — `taskkill` con la guardia final (M2)

- [x] T8. Tests `[F15-R10]` y `[F15-R11]` en `panel/test/exec-utils.test.js` (espía de `execFile`, `env` con `SystemRoot`, resolvedor inyectado o no, hijo falso con `kill` espía y `console.error` interceptado) (R10, R11).
- [x] T9. Implementar en `panel/lib/exec-utils.js` `KILL_ERRORS.taskkillUntrusted` y la rama Windows de `killProcessTree` de design.md §4.1–§4.2; T8, `[F4-R28]` y `[F14-R10]` pasan (R10, R11).
- [x] T10. Test `[F15-R12]` en `panel/test/runs-api.test.js` (`killTree` espía, resolvedor inyectado, run `[[hang]]` cancelado) e implementar el cambio de `stopProcess` en `panel/lib/runs.js` de design.md §4.3 (R12).

## Fase 3 — Ruta real del `cwd` (M3)

- [x] T11. Tests `[F15-R14]` (unitario, linux y win32 con `fsOps` inyectado) y `[F15-R15]` en `panel/test/trusted-bin.test.js`, y `[F15-R14]` de integración con un enlace simbólico real en `panel/test/hardening.test.js` (se salta en Windows) (R14, R15).
- [x] T12. Implementar en `panel/lib/trusted-bin.js` la ruta real del `cwd` en `excludedDirs` (`realDir`, design.md §5); T11 y todos los tests `[F14-R1]`–`[F14-R6]` pasan (R14, R15).

## Fase 4 — Documentación

- [x] T13. Tests estáticos `[F15-R16]` y `[F15-R17]` en `panel/test/deploy.test.js` según design.md §7 (cadenas clave de la sección "Seguridad de la ejecución"; sección Feature 15 de `docs/verification.md` con una fila por requisito y cada etiqueta no manual presente en `panel/test/`) (R16, R17).
- [x] T14. Actualizar `docs/architecture.md`, sección "Seguridad de la ejecución", apartados 1, 2 y 6, con los textos de design.md §7.1 (guardia y entorno de `taskkill`, ruta real del `cwd`, listas permitidas de git y npm, riesgos conocidos de `--node-options`/`--script-shell`, `--output` y `pnpm`/`yarn`/`bun`); T13 (`[F15-R16]`) y `[F14-R31]` pasan (R16).
- [x] T15. Añadir a `docs/verification.md` la sección "Mapa de trazabilidad — Feature 15: `comandos-amplios-git-npm` (prefijo `[F15-R<n>]`)" de design.md §7.2, con una fila por requisito R1–R18, la fila manual de R13 "pendiente del humano" y los cambios declarados de §6.3; T13 (`[F15-R17]`) pasa (R17).

## Fase 5 — Comprobación manual y verificación final

- [ ] T16. [MANUAL — Windows] El humano sigue design.md §6.4 (cancelar un run y añadir `git push` a mano), junto con la T30 pendiente de la feature 14, y el leader anota la fecha, las versiones y el resultado en la fila de R13 de `docs/verification.md` (R13).
- [x] T17. Verificar con `./init.sh` (todo en verde, sin cambios en tests anteriores salvo los declarados según design.md §6.3) y `node sdd-lint.js` con 0 errores (R18).
