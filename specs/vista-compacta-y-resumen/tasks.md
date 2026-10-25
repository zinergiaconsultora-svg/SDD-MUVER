# Tareas — Feature 13: Puesto de Mando MUVER (vista compacta y resumen de cada proyecto)

> Orden TDD: para cada módulo **tests → implementación**. Cada tarea indica los requisitos (R<n>) que cubre.
> Marca `[x]` al terminar cada una. Contratos en `design.md` §3–§5; interfaz en §6; fixtures y reparto de tests en §7.
> Se construye sobre el código en disco de la fase 4 (con sus correcciones T36) y de la feature 14 (resolvedor de
> confianza, `guardedSpawn`, runner central de git con `GIT_SAFE_PREFIX`).
> Reglas de oro de esta feature: **el resumen automático solo lee** (16 KB por fichero, nunca escribe en los proyectos);
> **Claude solo en modo lectura y con Haiku** para resúmenes (`Read,Glob,Grep`, sin `acceptEdits`, `Bash` ni `PowerShell`)
> y **nunca de forma automática**; **ningún `spawn`/`execFile` nuevo** (todo por `launchClaude`/`guardedSpawn` y por el
> runner central de git); el modelo solo desde la lista cerrada `CLI_MODELS`; **nada recortado con «…»**; los tests usan
> el CLI falso, repos temporales con `git worktree add` y datos temporales.

## Fase 0 — Preparación de tests

- [ ] T1. Ampliar `panel/test/fixtures/fake-claude.js` (flags `--model`, `--max-turns`, `--tools` y `--disallowedTools`, registro de `model`/`tools`/`disallowedTools`, escenario por fichero `.fake-claude-scenario`, escenarios `summary`, `summary_slow` y `blank`) y crear `panel/test/summary-helpers.js` (`makeRepoWithWorktrees`, `writeScenario`, `waitForBatch`, `waitForRegistry`) según design.md §7.1; comprobar que los tests de las fases 1–4 y de la feature 14 siguen en verde sin cambios (R12, R22, R26, R53).

## Fase 1 — Resumen automático (`lib/project-summary.js`)

- [ ] T2. Escribir `panel/test/project-summary.test.js`: orden de orígenes; `package.json` (normal, dos frases, frase de 300 caracteres cortada en palabra sin «…», roto, > 16 KB); `firstSentence` (`v1.2`, `node.js`, `!`, `?`) y `clipAtWord`; `extractFirstParagraph` con los READMEs de ejemplo; nombres de README y orden; `CLAUDE.md` como último origen; plantillas descartadas; lectura acotada con `fsImpl` espía; binario/directorio/inexistente; caché de 5 min con reloj inyectado; ningún resultado contiene «…» (R1, R2, R3, R4, R5, R6, R7).
- [ ] T3. Implementar `panel/lib/project-summary.js` según design.md §5.1 (y `storedSummaryOf` de §5.8 en `panel/lib/registry.js`) hasta que pase T2 (R1, R2, R3, R4, R5, R6, R7).

## Fase 2 — Clasificación de worktrees (`lib/repo-layout.js`)

- [ ] T4. Escribir `panel/test/repo-layout.test.js`: `classifyRepoLayout` con git real (principal, worktree con `git worktree add`, carpeta sin git, inexistente sin llamar a git); runner espía (nombre lógico `git`, argumentos exactos con `--no-optional-locks`, `cwd`, límite de tiempo); `createGitRunner` con `execFileImpl` espía (argv final con `GIT_SAFE_PREFIX` delante, sin consulta de filtros locales, git resuelto por el resolvedor); salida con rutas `C:/…` simulada; caché de 10 min; `isLikelyWorktree` (tres casos); `groupKeyFor`/`groupNameFor`; y ajustar en `panel/test/git-info.test.js` la lista cerrada con la entrada nueva (R26, R27, R29, R30).
- [ ] T5. Implementar `panel/lib/repo-layout.js` (§5.2) y la entrada nueva de `GIT_COMMANDS` (`CMD_REPO_LAYOUT`) en `panel/lib/git-info.js` (§5.7), sin tocar el runner central, hasta que pase T4 (R26, R27, R29, R30).

## Fase 3 — Catálogo: resumen, agrupación y modo ligero

- [ ] T6. Escribir en `panel/test/summary-api.test.js` (bloque A, integración con `startApp`): campos `summary`/`summarySource`/`summaryAt` en lista y detalle; `parentId`, `worktreeCount` (con uno oculto), `groupKey`/`groupName` sin el principal en el catálogo y sin rutas absolutas; `likelyWorktree` con `claudeHome` temporal; modo ligero sin git en los worktrees (runner espía) y `?worktrees=full`; `worktrees[]` del detalle con `dirtyCount` real y oculto marcado; `parentName` en el detalle del worktree (R8, R28, R29, R30, R31, R32).
- [ ] T7. Implementar en `panel/lib/project-catalog.js` `annotateLayouts`, `buildLightSummary`, el resumen en `toSummary`, `worktrees[]` del detalle y las opciones nuevas de `buildCatalog`/`buildCatalogDetail`/`buildCatalogSummary` (§5.3, §4.4), y en `panel/lib/app.js` la creación de `layoutCache` con el `gitRunner` central y de `summaryReader`, `?worktrees=full` y su paso a `listCatalog` (§5.9) hasta que pase T6 (R8, R28, R29, R30, R31, R32).

## Fase 4 — Resumen y modelo manuales por `PATCH`

- [ ] T8. Escribir en `panel/test/summary-api.test.js` (bloque B): `PATCH` con `summary` en un proyecto manual y en uno solo de Claude, con `allowExec: false`, vaciado (vuelve el automático), no texto, 201 caracteres y `summarySource`/`summaryAt` del cuerpo ignorados; `PATCH` con `model` válido, `default` (quita el campo) e inválidos (`"gpt-4"`, `3`, `"haiku --verbose"`); `normalizeSettings` con campos de resumen y modelo válidos y no válidos (R9, R10, R57).
- [ ] T9. Implementar en `panel/lib/registry.js` `summary` y `model` en `PATCHABLE_FIELDS`, sus validaciones, `applySummaryChange`, `applyModelChange`, `modelOf` y `normalizeSettings` (§5.8), y en `panel/lib/app.js` el `PATCH` con `summary`/`model` (§5.9) hasta que pase T8 (R9, R10, R57).

## Fase 5 — Argumentos del CLI: solo lectura y modelo

- [ ] T10. Ampliar `panel/test/claude-cli.test.js`: array exacto de `buildReadOnlyClaudeArgs` (`--model haiku`, sin `acceptEdits`, `--tools Read,Glob,Grep`, `--disallowedTools` con `Bash`, `PowerShell` y `mcp__*`, `--allowedTools` último con `Read,Glob,Grep`, sin `FORBIDDEN_ARGS`) y test estático de que no usa `DEFAULT_ALLOWED_TOOLS`, `shellRules` ni `allowedCommands`; `buildClaudeArgs` con cada modelo (posición antes de `--allowedTools`) y con `default`/`undefined`/valores no permitidos (sin `--model`); `CLI_MODELS` exacto; y test unitario de `normalizeGeneratedSummary` sin «…» (R11, R14, R55).
- [ ] T11. Implementar en `panel/lib/claude-cli.js` las flags y constantes nuevas, `isValidModel`, `buildReadOnlyClaudeArgs` y el `model` de `buildClaudeArgs` (§5.4), y `normalizeGeneratedSummary` y `SUMMARY_PROMPT` en `panel/lib/summary-api.js` (§5.5) hasta que pase T10 (R11, R14, R55).

## Fase 6 — Modelo en los runs de trabajo y "Te necesitan"

- [ ] T12. Ampliar `panel/test/work-api.test.js`: chat con `sonnet` (argumentos con `--model sonnet`, `RunMeta.model`, modelo recordado en el registro), `implement` sin `model` (usa el recordado), chat con `default` (sin `--model`, campo quitado), `400` con modelos inválidos sin proceso ni escritura, `GET …/work` con `model` y `models`; y en `panel/test/summary-api.test.js` (bloque E) `/api/attention` sin el run de resumen fallido y con el chat fallido (R56, R57, R58, R61).
- [ ] T13. Implementar en `panel/lib/runs.js` `model` en `startClaude` y en `RunMeta` (§5.6), y en `panel/lib/work-api.js` el `model` de `postRun`/`postSddRun`/`launchClaudeRun`, el recuerdo en el registro, `model`/`models` en `projectWork` y el filtro `action !== 'summary'` en `attention` (§5.10) hasta que pase T12 (R56, R57, R58, R61).

## Fase 7 — Generación individual (solo lectura)

- [ ] T14. Escribir en `panel/test/summary-api.test.js` (bloque C): `POST /summary/generate` con el CLI falso (argumentos de solo lectura con `--model haiku`, prompt por stdin igual a `SUMMARY_PROMPT` aunque el cuerpo traiga otro y `model: "opus"`, `cwd`, `202` con `action: "summary"` y `model: "haiku"`); resolvedor inyectado que rechaza Claude → `409` sin proceso; guardado `claude` en proyecto manual y solo de Claude; escenarios `error`, `hang` + cancelación y `blank` sin tocar el registro; manual guardado durante `summary_slow` que se conserva; `allowExec: false` y túnel sin confirmación; `404`, `409` sin carpeta, `409` run activo y `429` con `maxRuns: 1`; líneas de `audit.log` (R12, R13, R15, R16, R17, R18, R19).
- [ ] T15. Implementar en `panel/lib/runs.js` `profile: 'readonly'` y `waitFor` (§5.6), en `panel/lib/work-api.js` `startReadOnlyClaude` (§5.10) y en `panel/lib/summary-api.js` la ruta individual, `afterRun` y `saveGenerated` (§5.5); conectar `summaryApi.route` y `summaryApi.close` en `panel/lib/app.js` (§4.2, §5.9) hasta que pase T14 (R12, R13, R15, R16, R17, R18, R19).

## Fase 8 — Generación en lote

- [ ] T16. Escribir en `panel/test/summary-api.test.js` (bloque D): `POST /api/summaries/generate` (contrato `202`, duplicados, `400` en cada forma inválida, `409` con otro lote, `403` con `allowExec: false`); tres proyectos procesados sin solaparse (`startedAt` de cada run ≥ `endedAt` del anterior) con `saved`, `failed`, `saved`; `skipped` por inexistente, sin carpeta y run activo; reintento por `maxRuns` con `retryDelayMs`/`retryMaxMs`/`sleep` inyectados; `GET /api/summaries/batch` antes, durante y después; cancelar (también con `allowExec: false`) y `409` sin lote; auditoría del lote (R17, R19, R20, R21, R22, R23, R24, R25).
- [ ] T17. Implementar el lote en `panel/lib/summary-api.js` (validación, estado §3.6, `processBatch` con `startReadOnlyClaude`, reintento, cancelación, auditoría) hasta que pase T16 (R17, R19, R20, R21, R22, R23, R24, R25).

## Fase 9 — Interfaz: funciones puras

- [ ] T18. Escribir `panel/test/list.test.js`: `loadListPrefs`/`saveListPrefs` con almacenamiento falso (y que lanza); `groupProjects` (principal + tareas, oculto, grupo virtual, `likelyWorktree`, tareas sueltas, orden por actividad de la fila); `buildRowModel` (resumen entero sin «…», cada chip y su ausencia, semáforo del grupo, "Sin descripción", "Sin actividad", `needsYou`); `renderProjectRow` y `renderGroupCard` (atributos, menú oculto, escapado); `renderGroupDetail`; `filterRows` (búsqueda sin acentos y por tarea, cuatro filtros con reloj fijo); `splitOld` y `renderListBody` (antiguos, vacío con "Quitar filtros"); `planRowUpdate`; `summaryCandidates`; `describeSummaryAction` (menciona Haiku); `renderBatchStatus` (R33, R34, R35, R36, R38, R39, R40, R41, R42, R43, R47, R48, R49).
- [ ] T19. Implementar `panel/public/list.js` (§6.2–§6.4) hasta que pase T18 (R33, R34, R35, R36, R38, R39, R40, R41, R42, R43, R47, R48, R49).
- [ ] T20. Ampliar `panel/test/render.test.js` (tarjeta compacta con `card-summary` entero, menú "⋯", sin `card-actions`, con los tests existentes de `renderProjectCard` sin cambios; detalle con "De qué va" y cada origen; "Tareas en curso" con oculta y `dirtyCount`; enlace "Tarea de …"; campo "De qué va" en ajustes y `buildSettingsPayload` con y sin cambio; `buildProjectsUrl` con `fullWorktrees`) y `panel/test/work-render.test.js` (`renderModelSelect`, `renderWorkView` con el modelo recordado seleccionado, `buildRunPayload` con y sin `model`, `buildSddPayload`, `describeAction` con modelo, `modelLabel`, `renderRunHeader`, `renderRunList` con y sin campo `model`) (R35, R37, R44, R45, R46, R59, R60).
- [ ] T21. Modificar `panel/public/render.js` (§6.3, §6.5) y `panel/public/work.js` (§6.7) hasta que pasen T20 y los tests de render de las fases 1–4 y de la feature 14 (R35, R37, R44, R45, R46, R59, R60).

## Fase 10 — Página, estilos y cableado

- [ ] T22. Ampliar `panel/test/styles.test.js` (sin `text-overflow`, `line-clamp` ni `max-height` en `.project-row`, `.row-name`, `.row-summary`, `.row-chips` y `.card`; `line-height` 20/18 px y relleno vertical 10 px desde 601 px; botón "⋯" y `#work-model` de 44 px; variables de chips en claro y oscuro; barra de la lista y `#batch-status` en `index.html`) y modificar `panel/public/index.html` (§6.1) y `panel/public/styles.css` (§6.6) hasta que pase, sin romper el test de anchos ≤ 360 px (R50, R51).
- [ ] T23. Cablear `panel/public/app.js` según §6.5 (preferencias, barra, búsqueda con espera, filtros, vista, tareas sueltas, repintado por `planRowUpdate`, menú "⋯" con `Escape`, grupo virtual, "Generar con Claude" con seguimiento del run, lote con estado y cancelación, ajustes con `summaryInitial`, selector de modelo en Trabajar y botones SDD, `#run-model` en la cabecera); comprobación en navegador sin cabeza a 360×780 y 1280×800, claro y oscuro, contra el panel con el CLI falso y ~100 proyectos de prueba: una fila con resumen de una línea ≤ 72 px a 1280 px, ningún texto con «…», sin scroll horizontal ni errores de JavaScript, y un refresco sin cambios no sustituye ningún nodo (R33, R35, R38, R41, R43, R47, R49, R50, R59, R60).

## Fase 11 — Documentación

- [ ] T24. Ampliar `panel/test/deploy.test.js` con el test estático de documentación de esta feature y actualizar `docs/architecture.md` según design.md §8 (módulos, campos, rutas, caché de clasificación con el runner central, solo lectura con Haiku de los resúmenes, selector de modelo, resúmenes fuera de "Te necesitan", regla "nada recortado") hasta que pase (R52).
- [ ] T25. Añadir a `docs/verification.md` el párrafo del prefijo `[F13-R<n>]` en "Cómo se ejecutan" y la tabla "Feature 13: `vista-compacta-y-resumen` (prefijo `[F13-R<n>]`)" con una fila por requisito R1–R61 y la fila de la comprobación manual T26 (R52, R54).

## Fase 12 — Comprobación manual del humano y verificación final

- [ ] T26. **[MANUAL — humano, Windows + móvil]** Con su lista real (86 proyectos): anotar `claude --version` y confirmar en `claude --help` `--model`, `--tools`, `--disallowedTools`, `--max-turns` y `--permission-mode default`; ver que los worktrees `…-xxxxxx` del CRM aparecen como "N tareas en curso" bajo su repositorio principal y en su detalle "Tareas en curso"; filas con resumen de una línea ≤ 72 px en el PC y ningún texto cortado con «…» en PC ni móvil; resúmenes comprensibles en los proyectos con README o `package.json`; buscar, filtrar, "Antiguos" y Lista/Tarjetas recordado tras recargar; un chat con Haiku y otro con Opus (modelo visible en la ejecución y en el historial, y recordado al volver); "Generar con Claude" en un proyecto y "Generar resúmenes" con 3, comprobando `git status` limpio en esos proyectos después y que un fallo no aparece en "Te necesitan"; anotar el resultado en `docs/verification.md` (R54).
- [ ] T27. Verificar con `./init.sh` desde la raíz: estructura OK, `npm test` del panel en verde (fases 1–4, feature 14 y feature 13) y `node sdd-lint.js` con 0 errores y 0 advertencias (R53).
