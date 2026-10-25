# Tareas — Feature 19: configuración de git sin ejecución en las lecturas (segunda revisión de la feature 14)

> Orden TDD: en cada bloque, primero los tests y después la implementación. Cada tarea indica los requisitos (R<n>)
> que cubre. En los tests se etiquetan `[F19-R<n>]`. Marca `[x]` al terminar cada una. Constantes, textos y fixtures
> exactos en `design.md` §3–§7.
> Reglas de oro: **los únicos tests anteriores que cambian son los de design.md §7.3** (declarados en
> `docs/verification.md`), **ningún `shell: true`**, los scripts de prueba solo escriben ficheros de marca en
> temporales y los tests de evidencia comprueban **primero** que el git real ejecuta el vector sin la protección. Si
> una evidencia no se reproduce o una protección no la frena, se para y se avisa al leader. No se tocan los ficheros
> de design.md §9.

## Fase 0 — Preparación

- [ ] T1. Ejecutar `./init.sh` y comprobar que todo está en verde antes de empezar; anotar `git --version` (base de R21).

## Fase 1 — Evidencias con el git real (fallan antes de la fase 2)

- [ ] T2. Crear `panel/test/git-config.test.js` con el entorno aislado y el script de marca de design.md §7.1 y los tests de evidencia `[F19-R3]` (firma) y `[F19-R7]` (filtros `clean` y `process`, con `.gitattributes` y con `.git/info/attributes`); comprobar que la primera parte (evidencia) pasa y la segunda falla con el código actual (R3, R7).
- [ ] T3. Añadir a `git-config.test.js` `[F19-R9]` (submódulo), `[F19-R10]` (clon parcial; la segunda parte se salta con git < 2.45 con el motivo exacto de design.md §7.1) y `[F19-R14]` (`ext::` en el push); misma comprobación que T2 (R9, R10, R14).

## Fase 2 — Lecturas sin programas del repositorio (MA2)

- [ ] T4. Tests unitarios en `panel/test/git-info.test.js`: `[F19-R1]` (constante y runner), `[F19-R2]` (entorno con `GIT_NO_LAZY_FETCH` en linux y win32), `[F19-R4]` (`readRepoExecConfig` con ámbitos, código 129, código 1, error, duplicados y tope de 20) y `[F19-R8]` (`GIT_COMMANDS`); aplicar los cambios declarados de design.md §7.3 a los tests de `git-info.test.js` (R1, R2, R4, R8).
- [ ] T5. Implementar en `panel/lib/git-info.js` §3.1, §3.2, §3.3, §3.4 (`GIT_COMMANDS`) y §3.5 de design.md: `GIT_SAFE_PREFIX`, `EXEC_CONFIG_RE`, `FILTER_NAME_RE`, `readRepoExecConfig`, `filterOverrideArgs` y el entorno del runner; T4 pasa (R1, R2, R4, R8).
- [ ] T6. Tests `[F19-R5]` y `[F19-R6]` para `getGitInfo` en `git-info.test.js` (runner falso con filtros locales válidos y con `filter.a=b.clean`) e implementar el cambio de `getGitInfo` de design.md §5.1 (R5, R6).
- [ ] T7. Tests en `panel/test/git-actions.test.js`: `[F19-R1]` (pasos con el prefijo nuevo), `[F19-R5]` y `[F19-R6]` para `getChanges`, `getFileDiff` y `planCommitPush`, `[F19-R8]` (`GIT_ACTION_ARGS`) y `[F19-R13]` (pasos exactos y estático sin `--no-verify` ni `hooksPath=`); aplicar los cambios declarados de design.md §7.3 a `git-actions.test.js` (R1, R5, R6, R8, R13).
- [ ] T8. Implementar en `panel/lib/git-actions.js` design.md §3.4 y §5.2 (`GIT_ACTION_ARGS`, `unsafeFilter`, lectura de la configuración, anulación en `status`/`stat`/`diff`, `execConfig` y `filterArgs` internos); T7 pasa (R5, R6, R8, R13).
- [ ] T9. Comprobar que `[F19-R3]`, `[F19-R7]`, `[F19-R9]` y `[F19-R10]` pasan enteros (o con la parte de git ≥ 2.45 saltada y su motivo) y que `[F14-R22]` y `[F14-R23]` siguen pasando sin cambios (R3, R7, R9, R10).

## Fase 3 — Commit y push (M3)

- [ ] T10. Test de integración `[F19-R11]` en `git-config.test.js` (claves locales y `~/.gitconfig` temporal) y `[F19-R6]` en `panel/test/work-api.test.js` (`GET /changes` → `409` con `unsafeFilter`); implementar `execConfig` en `getProjectChanges` de `panel/lib/work-api.js` (design.md §5.4) (R11, R6).
- [ ] T11. Test `[F19-R12]` de `renderConfigWarning` en `panel/test/work-render.test.js` e implementar `CONFIG_TEXTS` y `renderConfigWarning` en `panel/public/work.js` y su uso en `commitPushAction` de `panel/public/app.js` detrás del aviso de hooks (design.md §4.1 y §5.3) (R12).
- [ ] T12. Comprobar que `[F19-R14]` pasa entero con el prefijo de T5 (sin más cambios en el código) (R14).

## Fase 4 — Ajustes de ejecución (M4)

- [ ] T13. Tests `[F19-R15]` (forma de `renderExecSettingsForm` y `buildExecSettingsPayload` sin cambios) y `[F19-R16]` (estático de `public/app.js`) en `panel/test/work-render.test.js`, y `[F19-R17]` en `panel/test/styles.test.js` (R15, R16, R17).
- [ ] T14. Implementar en `panel/public/work.js` el formulario de design.md §5.3, en `panel/public/app.js` el aviso de comandos amplios en `#exec-broad-slot` y en `panel/public/styles.css` las reglas `.exec-group`, `.exec-group legend` y `.field-help`; T13 y los tests `[F14-R19]` pasan (R15, R16, R17).

## Fase 5 — Documentación

- [ ] T15. Tests estáticos `[F19-R18]` y `[F19-R19]` en `panel/test/deploy.test.js` según design.md §8.1 y §8.2 (R18, R19).
- [ ] T16. Actualizar `docs/architecture.md`, sección "Seguridad de la ejecución", apartados 3 y 6 y apartado nuevo 7, con los textos de design.md §8.1 (120 columnas como máximo); `[F19-R18]`, `[F14-R31]` y `[F15-R16]` pasan (R18).
- [ ] T17. Añadir a `docs/verification.md` la sección "Mapa de trazabilidad — Feature 19: `git-config-sin-clic` (prefijo `[F19-R<n>]`)" de design.md §8.2: nota de entorno con la versión de git y las partes saltadas, cambios declarados de §7.3, una fila por requisito R1–R21 y la fila manual de R20 "pendiente del humano"; `[F19-R19]` pasa (R19).

## Fase 6 — Comprobación manual y verificación final

- [ ] T18. [MANUAL — Windows] El humano sigue design.md §7.4 en su PC con git 2.52.0.windows.1 (evidencia en Git Bash sin el panel; listado, detalle, "Ver cambios" y diff sin marcas; aviso de configuración en "Commit y push" cancelado; dos grupos en "Ajustes de ejecución") y el leader anota fecha, versiones y resultado en la fila de R20 de `docs/verification.md` (R20).
- [ ] T19. Verificar con `./init.sh` (todo en verde; los únicos tests anteriores cambiados son los de design.md §7.3) y `node sdd-lint.js` con 0 errores (R21).
