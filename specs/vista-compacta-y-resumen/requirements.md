# Requisitos — Feature 13: Puesto de Mando MUVER (vista compacta y resumen de cada proyecto)

> Origen: feedback del humano tras arrancar el panel en su PC Windows ("Claude Code: detectado (86 proyectos,
> 212 sesiones)"). La portada es una rejilla de tarjetas grandes de 3 columnas; la mayoría son **worktrees de Claude
> Code** con nombres como `audit-y-medianoche-41fbca` y rama `claude/audit-y-medianoche-41fbca` (copias de trabajo
> de una tarea del repo principal "CRM RAPIDO"); el resto son proyectos reales ("CRM RAPIDO" con 99 sesiones,
> "nightshift", "panel-muver", "playground" sin git). Palabras del humano: *"Quiero que los proyectos no tengan un
> widget tan grande y que tenga datos fáciles de entender. Un resumen de qué va el proyecto, ya que veo que hay
> muchos proyectos que no sé qué son."*
>
> Alcance: (1) vista **lista compacta** por defecto, con conmutador Lista/Tarjetas y tarjetas también compactadas;
> (2) **resumen "de qué va"** de cada proyecto, obtenido sin coste de `package.json`, README o `CLAUDE.md`, editable a
> mano y, bajo demanda, **generado por Claude en solo lectura**; (3) **worktrees agrupados** bajo su repositorio
> principal como "tareas en curso"; (4) **buscador y filtros** con los proyectos sin actividad plegados en
> "Antiguos"; (5) rendimiento con unos 100 proyectos (sin git de más y sin repintar lo que no cambia).
>
> Decisiones posteriores del humano (incorporadas en esta revisión): (6) **selector de modelo** (Por defecto / Haiku /
> Sonnet / Opus) al lanzar Claude desde "Trabajar" y en los botones SDD, recordado por proyecto; los resúmenes usan
> siempre Haiku; (7) **nada recortado** (regla de su `DISENO.md`): sin «…» en el resumen de la fila, el texto se ve
> entero y la fila crece; para que siga siendo compacta, el resumen se limita a una frase; (8) los fallos de generar
> resúmenes **no** aparecen en "Te necesitan".
>
> Fuera de alcance: cambiar la lógica del semáforo, cambiar el resto de la fase 4 (chat, botones SDD, tests, commit)
> salvo el selector de modelo, la exclusión de los resúmenes en "Te necesitan" y reutilizar su gestor de runs; avisos
> push y capturas.
>
> Se construye sobre el código **tal como está en disco** tras la fase 4 (con sus correcciones de la prueba real: prompt
> por stdin, `--allowedTools` como última opción, reglas Bash + PowerShell, registro en `<datos>/projects.json`) y la
> feature 14 (`specs/endurecimiento-ejecucion/`): todo proceso pasa por el resolvedor de confianza
> (`lib/trusted-bin.js`) y `guardedSpawn`, y todo `git` por el runner central (`createGitRunner`) con su prefijo
> `-c core.fsmonitor=false -c log.showSignature=false`.
>
> Convención de este fichero: cada requisito ocupa UNA sola línea (así `sdd-lint.js` lo valida completo) y va seguido
> de su línea *Cómo se prueba*. Contratos JSON, textos exactos, algoritmos y nombres de funciones están en `design.md`.
> Los tests usan **directorios temporales** (READMEs, `package.json` y `CLAUDE.md` de ejemplo), **repos git reales con
> `git worktree add`**, el **CLI de Claude falso** de la fase 4 (`panel/test/fixtures/fake-claude.js`) y funciones de
> render puras; nunca el `claude` real ni el `~/.claude` del equipo. El requisito marcado **[MANUAL — Windows]** lo
> comprueba el humano con su lista real y anota el resultado en `docs/verification.md`.

## Vocabulario

- **Resumen:** una frase que dice de qué va un proyecto. Se expone como `summary` (texto o `null`) y su origen como `summarySource`: `manual` (escrito por el humano), `claude` (generado por Claude y guardado), `package` (campo `description` de `package.json`), `readme` (primer párrafo de texto del README), `claude-md` (primer párrafo de texto de `CLAUDE.md`) o `null` (sin resumen: la interfaz muestra "Sin descripción").
- **Resumen guardado:** el que vive en el registro `projects.json` del directorio de datos (campos `summary`, `summarySource`, `summaryAt`); solo puede ser `manual` o `claude`.
- **Resumen automático:** el que el panel calcula leyendo ficheros del proyecto, sin ejecutar nada y sin coste (`package`, `readme`, `claude-md`).
- **Párrafo de texto:** bloque de líneas no vacías que no es título, insignia (badge), imagen, HTML, comentario, bloque de código, tabla, lista ni cabecera YAML, con al menos 12 caracteres y al menos una letra tras limpiar el Markdown (algoritmo exacto en `design.md` §5.1).
- **Worktree:** carpeta de un proyecto que git identifica como copia de trabajo enlazada de otro repositorio (su `--git-dir` y su `--git-common-dir` son distintos). Su **repositorio principal** es la carpeta que contiene el directorio común de git.
- **Tarea en curso:** worktree no oculto agrupado bajo su repositorio principal.
- **Grupo virtual:** fila que agrupa worktrees cuyo repositorio principal NO está en el catálogo; lleva el nombre de la carpeta de ese repositorio.
- **Worktree probable (`likelyWorktree`):** proyecto en el que git no pudo responder (carpeta inexistente, git ausente o error) cuyo nombre de carpeta acaba en `-` + 6 dígitos hexadecimales y que tiene alguna sesión de Claude en la rama `claude/<nombre de carpeta>`. Se marca pero no se agrupa.
- **Fila:** elemento de la vista Lista: un proyecto de nivel superior (con sus tareas en curso), un grupo virtual o, con "Mostrar tareas sueltas", un worktree.
- **Actividad de una fila:** la fecha más reciente entre la `lastActivityAt` del proyecto y las de sus tareas en curso; `null` si no hay ninguna.
- **Filtros:** `all` ("Todos"), `active` ("Activos": actividad en los últimos 7 días), `pinned` ("Fijados") y `attention` ("Te necesitan": la fila o alguna de sus tareas tiene semáforo `atencion` o un run en la cola "Te necesitan").
- **Antiguos:** filas no fijadas cuya actividad es `null` o de hace más de 30 días.
- **Preferencias de la lista:** vista (`list` | `cards`), filtro y "Mostrar tareas sueltas", guardadas en `localStorage` del navegador (por dispositivo).
- **Generación de resúmenes:** run de Claude Code de la fase 4 lanzado en **modo solo lectura** (herramientas `Read`, `Glob` y `Grep`; sin edición, sin `Bash` ni `PowerShell`, sin `acceptEdits`) con el modelo `haiku` y un prompt fijo; el texto devuelto se guarda como resumen `claude`.
- **Recorte en límite de palabra:** si un texto supera el máximo, se corta en el último espacio anterior al máximo, **sin añadir «…»** ni ningún otro marcador (regla "nada recortado": nunca se oculta texto con elipsis; lo que se muestra es una frase completa o el texto hasta una palabra entera).
- **Primera frase:** el texto hasta el primer punto (`.`, `!` o `?`) seguido de espacio o fin de texto, incluido ese signo.
- **Modelo de Claude:** `default` ("Por defecto": no se pasa `--model` y Claude Code usa el que tenga configurado) o uno de los alias de la lista cerrada `CLI_MODELS` = `haiku`, `sonnet`, `opus`. Nunca texto libre en los argumentos del CLI.
- **Lote:** generación de resúmenes de varios proyectos, uno detrás de otro, gestionada por el servidor.

## A. Resumen automático (sin coste)

- **R1.** Cuando el panel calcula el resumen de un proyecto, el sistema debe aplicar este orden y quedarse con el primero que exista: resumen guardado `manual`, resumen guardado `claude`, `description` de `package.json`, primer párrafo de texto del README, primer párrafo de texto de `CLAUDE.md` y, si no hay ninguno, `summary: null` con `summarySource: null`.
  - *Cómo se prueba:* test unitario de `resolveSummary` con un directorio temporal que tiene los tres ficheros y entradas de ajustes con y sin resumen guardado de cada tipo; se quitan los ficheros uno a uno y se comprueba el origen elegido en cada paso.

- **R2.** Cuando `package.json` tiene `description` de tipo texto no vacío, el sistema debe usar como resumen `package` su primera frase con los espacios colapsados o, si la primera frase supera 160 caracteres, sus primeros 160 recortados en límite de palabra sin «…», y si el fichero no es JSON válido, no tiene `description` o está vacío, entonces el sistema debe pasar al siguiente origen sin fallar.
  - *Cómo se prueba:* test unitario con `description` normal, con saltos de línea, con dos frases (→ la primera), de una frase de 300 caracteres (→ ≤ 160 sin «…» y en palabra entera), vacía, numérica, `package.json` roto y `package.json` de más de 16 KB cuya `description` está en los primeros 16 KB.

- **R3.** Cuando el panel lee un README, el sistema debe devolver el primer párrafo de texto según `design.md` §5.1 saltando cabecera YAML, títulos `#` y subrayados, insignias e imágenes, HTML y comentarios HTML, bloques de código, tablas y listas, quitando el Markdown en línea (enlaces → su texto, énfasis, código) y quedándose con su primera frase o, si supera 160 caracteres, con los primeros 160 recortados en límite de palabra sin «…».
  - *Cómo se prueba:* test unitario de `extractFirstParagraph` con READMEs de ejemplo: título + badges `[![CI](…)](…)` + párrafo; `<p align="center"><img …></p>` + párrafo; cabecera YAML; comentario `<!-- -->` de varias líneas; bloque de código antes del texto; título setext; párrafo con enlaces y `**negrita**`; párrafo de tres frases (→ solo la primera, terminada en punto); una frase de 400 caracteres (→ ≤ 160, acaba en palabra entera y no contiene «…»); un punto en `v1.2` o `p. ej.` seguido de letra sin espacio no corta; README solo con títulos y listas (→ `null`).

- **R4.** Cuando el panel busca el README de un proyecto, el sistema debe aceptar sin distinguir mayúsculas `README.md`, `README.markdown`, `README.txt`, `README` y `LEEME.md`, en ese orden, y si ninguno da un párrafo de texto, entonces el sistema debe aplicar el mismo algoritmo a `CLAUDE.md`.
  - *Cómo se prueba:* test unitario con `readme.md` en minúsculas, con `README.txt` y `README.md` a la vez (gana `.md`), con `LEEME.md`, y con un README sin párrafos y un `CLAUDE.md` con párrafo (→ origen `claude-md`).

- **R5.** Si el primer párrafo de texto de un README o de `CLAUDE.md` coincide con un texto de plantilla de la lista `BOILERPLATE_PATTERNS` de `design.md` §5.1, entonces el sistema debe descartar ese fichero como origen y pasar al siguiente.
  - *Cómo se prueba:* test unitario con el README por defecto de Vite ("This template provides a minimal setup…"), el de Create React App ("This project was bootstrapped with…"), el de Next.js y un `CLAUDE.md` que empieza por "This file provides guidance to Claude Code"; en los cuatro casos el origen no es ese fichero.

- **R6.** Cuando el panel lee un fichero para el resumen, el sistema debe leer como mucho sus primeros 16 384 bytes, quitar el BOM, tolerar contenido binario o no UTF-8 y no lanzar nunca una excepción (carpeta inexistente, sin permisos o fichero que es un directorio → siguiente origen).
  - *Cómo se prueba:* test unitario con un README de 1 MB cuyo párrafo está al principio (se espía la lectura: ≤ 16 384 bytes), un README con bytes aleatorios, un `README.md` que es un directorio y una carpeta inexistente (→ `null` sin excepción).

- **R7.** Cuando se pide dos veces el resumen automático de la misma carpeta en menos de 5 minutos, el sistema debe devolver el valor en caché sin volver a leer el disco, y cuando han pasado 5 minutos, el sistema debe volver a leerlo.
  - *Cómo se prueba:* test unitario de `createSummaryReader` con reloj inyectado y `fs` espiado: segunda lectura a los 4 min sin acceso a disco; tras cambiar el README y avanzar a 5 min 1 s, devuelve el párrafo nuevo.

- **R8.** Cuando una petición autenticada hace `GET /api/projects` o `GET /api/projects/:id`, el sistema debe incluir en cada proyecto `summary`, `summarySource` y `summaryAt` según `design.md` §3.3, con `summaryAt` nulo salvo en los resúmenes guardados.
  - *Cómo se prueba:* test de integración con un proyecto con `package.json`, otro con resumen `manual` guardado, otro de Claude sin ficheros (→ `null`) y uno con la ruta inexistente (→ `null`).

## B. Resumen manual y generado por Claude

- **R9.** Cuando una petición autenticada hace `PATCH /api/projects/:id` con `summary` de texto no vacío de hasta 200 caracteres, el sistema debe guardar en `projects.json` el texto con los espacios colapsados, `summarySource: "manual"` y `summaryAt` con la hora actual, sin pasar por la puerta de ejecución, y responder `200` con el proyecto actualizado.
  - *Cómo se prueba:* test de integración sobre un proyecto manual y sobre uno solo de Claude (se crea su entrada), con `allowExec: false` (sigue respondiendo `200`) y comprobando `projects.json`.

- **R10.** Si el `PATCH` trae `summary` vacío, entonces el sistema debe borrar de la entrada `summary`, `summarySource` y `summaryAt` (vuelve el resumen automático), y si trae un `summary` que no es texto o supera 200 caracteres, entonces el sistema debe responder `400` con el texto de `design.md` §4.3 y `field: "summary"` sin escribir nada; `summarySource` y `summaryAt` del cuerpo se deben ignorar.
  - *Cómo se prueba:* test de integración: `summary: ""` tras uno manual (→ vuelve el de `package.json`), `summary: 5`, `summary` de 201 caracteres, y `{ summary: "x", summarySource: "claude", summaryAt: "2000-01-01" }` (→ queda `manual` con hora actual).

- **R11.** Cuando el panel construye la llamada de solo lectura a Claude Code, el sistema debe producir exactamente los argumentos de `buildReadOnlyClaudeArgs` de `design.md` §5.4: `--model haiku`, `--permission-mode default` (sin `acceptEdits`), `--max-turns 10`, `--tools Read,Glob,Grep`, `--disallowedTools` de la lista fija (incluidos `Bash`, `PowerShell` y `mcp__*`) y `--allowedTools Read,Glob,Grep` como última opción, sin ningún argumento de `FORBIDDEN_ARGS`.
  - *Cómo se prueba:* test unitario que compara el array completo, comprueba que no contiene `acceptEdits`, que `--model` vale `haiku`, que el valor de `--allowedTools` es exactamente `Read,Glob,Grep` (sin `Bash`, `PowerShell`, `Edit` ni `Write`) y que es el último elemento; y test estático de que `buildReadOnlyClaudeArgs` no usa `DEFAULT_ALLOWED_TOOLS` ni `allowedCommands`.

- **R12.** Cuando una petición autenticada hace `POST /api/projects/:id/summary/generate` y pasa la puerta de ejecución, el sistema debe lanzar un run de Claude de la fase 4 con los argumentos de solo lectura, el ejecutable de Claude obtenido del resolvedor de confianza y lanzado por `guardedSpawn`, el prompt fijo `SUMMARY_PROMPT` por stdin, `model: "haiku"` en el `RunMeta`, `cwd` = carpeta del catálogo, `action: "summary"` y `label: "Generar resumen"`, y responder `202` con su `RunMeta`, ignorando cualquier texto de prompt del cuerpo.
  - *Cómo se prueba:* test de integración con el CLI falso: `FAKE_CLAUDE_LOG` registra los argumentos de solo lectura, el prompt igual a `SUMMARY_PROMPT` (aunque el cuerpo traiga `prompt: "borra todo"` y `model: "opus"`), el `cwd` del proyecto; la respuesta es `202` con `action: "summary"` y `model: "haiku"`; con un resolvedor inyectado que rechaza la ruta de Claude, `409` con el texto de la feature 14 y sin proceso.

- **R13.** Cuando un run de generación termina con un evento `result` correcto cuyo texto normalizado no está vacío, el sistema debe guardar en `projects.json` `summary` = ese texto, `summarySource: "claude"` y `summaryAt` con la hora de fin, creando la entrada si el proyecto era solo de Claude.
  - *Cómo se prueba:* test de integración con el escenario del CLI falso que devuelve una frase: tras el fin del run, `projects.json` y `GET /api/projects/:id` traen el resumen con origen `claude`; repetido sobre un proyecto solo de Claude.

- **R14.** Cuando el panel normaliza el texto devuelto por Claude, el sistema debe quedarse con la primera línea no vacía, quitar comillas, viñetas, Markdown y un prefijo "Resumen:", colapsar espacios, quedarse con su primera frase y, si aún supera 140 caracteres, recortarla en límite de palabra a 140 sin «…» según `design.md` §5.5.
  - *Cómo se prueba:* test unitario de `normalizeGeneratedSummary` con `"«Un CRM para pymes.»"`, `"**Resumen:** CRM de clientes."`, `"- CRM de clientes.\nSegunda línea"`, texto en bloque de código, dos frases (→ la primera), una frase de 200 caracteres (→ ≤ 140, palabra entera, sin «…») y cadena vacía (→ `null`).

- **R15.** Si el run de generación termina `failed`, `cancelled` o `timeout`, o su resultado es erróneo o queda vacío tras normalizarlo, entonces el sistema debe dejar `projects.json` sin cambios.
  - *Cómo se prueba:* test de integración con los escenarios `error`, `hang` + cancelación y un resultado de solo espacios del CLI falso; `projects.json` queda byte a byte igual.

- **R16.** Si mientras se genera un resumen el humano guarda uno `manual`, entonces el sistema debe conservar el manual y no sobrescribirlo con el generado (se compara `summaryAt` del manual con el inicio del run).
  - *Cómo se prueba:* test de integración con el escenario lento del CLI falso: se lanza la generación, se hace `PATCH` con `summary` y, al terminar el run, el resumen sigue siendo el manual.

- **R17.** Si `allowExec` es falso, entonces el sistema debe responder `403` a `POST /api/projects/:id/summary/generate` y a `POST /api/summaries/generate` sin lanzar ningún proceso, y si la petición llega por el túnel sin confirmación reciente y sin Cloudflare Access, entonces debe responder `401` con `reauthRequired: true`.
  - *Cómo se prueba:* test de integración con `allowExec: false` (`403`, `FAKE_CLAUDE_LOG` inexistente) y con la cabecera `CF-Connecting-IP` y una sesión de hace 16 minutos (`401 reauthRequired`).

- **R18.** Si el proyecto de `POST /api/projects/:id/summary/generate` no existe, no tiene carpeta en el PC, ya tiene un run activo o se alcanzó `PANEL_MAX_RUNS`, entonces el sistema debe responder `404`, `409`, `409` o `429` con los textos de la fase 4 sin lanzar ningún proceso nuevo.
  - *Cómo se prueba:* test de integración con id inexistente, proyecto con ruta inexistente, un run `hang` en marcha en el mismo proyecto y `maxRuns: 1` con un run `hang` en otro proyecto.

- **R19.** Cuando se lanza o termina una generación de resumen, el sistema debe escribir en `audit.log` la línea de la puerta (`action: "summary.generate"` o `"summary.batch"`, con `runId` o `detail.count`) y la de fin de run de la fase 4, sin el texto del prompt más allá de 120 caracteres.
  - *Cómo se prueba:* test de integración que lee `audit.log` tras una generación individual y un lote de dos proyectos y comprueba acciones, resultados y `runId`.

## C. Generación en lote

- **R20.** Cuando una petición autenticada hace `POST /api/summaries/generate` con `ids` (de 1 a 50 ids válidos tras quitar duplicados) y pasa la puerta de ejecución, el sistema debe crear un lote, responder `202` con su estado según `design.md` §3.6 y procesarlo en segundo plano.
  - *Cómo se prueba:* test de integración con tres ids (uno repetido → `total: 2`) y comprobación del contrato de la respuesta.

- **R21.** Si `ids` no es una lista, está vacía, tiene más de 50 ids distintos o alguno no cumple el formato de id, entonces el sistema debe responder `400` con el texto de `design.md` §4.3, y si ya hay un lote en marcha, entonces debe responder `409` sin crear otro.
  - *Cómo se prueba:* test de integración con `ids: "a"`, `[]`, 51 ids, `["../x"]` y un segundo lote mientras el primero sigue con un run `hang`.

- **R22.** Cuando un lote está en marcha, el sistema debe procesar sus proyectos de uno en uno en el orden recibido, cada uno con el mismo flujo de R12 a R16, y marcar cada elemento `saved`, `failed`, `skipped` o `cancelled`.
  - *Cómo se prueba:* test de integración con tres proyectos (uno con el escenario de error del CLI falso): `FAKE_CLAUDE_LOG` muestra los tres arranques sin solaparse (cada uno empieza después del fin del anterior) y los estados finales son `saved`, `failed`, `saved`.

- **R23.** Si un elemento del lote no existe en el catálogo, no tiene carpeta o ya tiene un run activo, entonces el sistema debe marcarlo `skipped` con su motivo, y si se alcanzó `PANEL_MAX_RUNS`, entonces debe reintentarlo cada 5 segundos hasta 10 minutos antes de marcarlo `skipped`.
  - *Cómo se prueba:* test de integración con un id inexistente, un proyecto con ruta inexistente y otro con un run `hang` en marcha; y test con reloj y temporizador inyectados para el reintento por `maxRuns` (arranca al liberarse el hueco; con el hueco ocupado 10 min → `skipped`).

- **R24.** Cuando una petición autenticada hace `GET /api/summaries/batch`, el sistema debe responder `200` con el último lote (en marcha o terminado) según `design.md` §3.6 o con `{ "batch": null }` si no hubo ninguno desde que arrancó el panel.
  - *Cómo se prueba:* test de integración antes de cualquier lote, durante uno y después de que termine.

- **R25.** Cuando una petición autenticada hace `POST /api/summaries/batch/cancel` con un lote en marcha, el sistema debe cancelar el run en curso y marcar los pendientes `cancelled` sin pasar por la puerta de ejecución, y si no hay lote en marcha, entonces debe responder `409`.
  - *Cómo se prueba:* test de integración con un lote cuyo primer proyecto usa el escenario `hang`: tras cancelar, el run queda `cancelled`, el lote `cancelled` y no se lanza el segundo; con `allowExec: false` cancelar sigue respondiendo `202`; sin lote → `409`.

## D. Worktrees agrupados bajo su repositorio principal

- **R26.** Cuando el panel necesita saber si un proyecto es un worktree, el sistema debe ejecutar solo `git --no-optional-locks rev-parse --git-dir --git-common-dir` (entrada nueva de la lista cerrada `GIT_COMMANDS`) a través del runner central de git de la feature 14 (git de confianza, prefijo `GIT_SAFE_PREFIX`, sin shell), con `cwd` = carpeta del proyecto y el límite de tiempo de la fase 1, y clasificarlo como `main`, `worktree` (con la ruta de su repositorio principal) o `none`.
  - *Cómo se prueba:* test con git real: repo principal con un commit y `git worktree add ../wt-tarea-a1b2c3 -b claude/wt-tarea-a1b2c3`; el worktree → `worktree` con `mainPath` = carpeta del principal; el principal → `main`; una carpeta sin git → `none`; runner espía que comprueba nombre lógico `git`, argumentos y `cwd`; y `createGitRunner` con `execFileImpl` espía que comprueba que el argv final empieza por `GIT_SAFE_PREFIX` y que no consulta filtros locales (no es status ni diff).

- **R27.** Cuando el panel clasifica una carpeta ya clasificada hace menos de 10 minutos, el sistema debe reutilizar el resultado en caché sin lanzar git, y si la carpeta no existe, entonces no debe lanzar git.
  - *Cómo se prueba:* test unitario de `createRepoLayoutCache` con runner espía y reloj inyectado: segunda petición a los 9 min sin llamadas; a los 10 min 1 s, una llamada; carpeta inexistente, cero llamadas.

- **R28.** Cuando el catálogo contiene un worktree y su repositorio principal, el sistema debe devolver en el worktree `isWorktree: true` y `parentId` = id del principal, y en el principal `worktreeCount` = número de sus worktrees no ocultos.
  - *Cómo se prueba:* test de integración con el repo principal y dos worktrees reales dados de alta (uno oculto): `GET /api/projects?includeHidden=1` trae `parentId` en ambos y `worktreeCount: 1` en el principal.

- **R29.** Si el repositorio principal de un worktree no está en el catálogo, entonces el sistema debe devolver en el worktree `parentId: null`, `groupKey` (prefijo `g-` y 10 caracteres hexadecimales derivados de la ruta del principal) y `groupName` (nombre de la carpeta del principal sin `.git` final), iguales para todos los worktrees del mismo principal.
  - *Cómo se prueba:* test de integración con dos worktrees reales cuyo principal no está dado de alta: mismo `groupKey` y `groupName`, y la respuesta no contiene la ruta absoluta del principal.

- **R30.** Si git no pudo clasificar un proyecto, su carpeta acaba en `-` seguido de 6 dígitos hexadecimales y alguna de sus sesiones de Claude está en la rama `claude/<nombre de carpeta>`, entonces el sistema debe devolver `likelyWorktree: true` con `parentId` y `groupKey` nulos.
  - *Cómo se prueba:* test con un `claudeHome` temporal: proyecto con ruta inexistente `…/audit-y-medianoche-41fbca` y sesión en `claude/audit-y-medianoche-41fbca` (→ `true`); misma carpeta con sesión en `main` (→ `false`); carpeta `mi-app` con sesión en `claude/mi-app` (→ `false`).

- **R31.** Cuando una petición autenticada hace `GET /api/projects` sin `worktrees=full`, el sistema debe calcular los worktrees con `parentId` o `groupKey` en modo ligero (`detailLevel: "light"`: arnés y progreso leídos del disco, rama de la última sesión de Claude, sin lanzar git aparte de la clasificación en caché), y con `worktrees=full` debe calcularlos completos como el resto.
  - *Cómo se prueba:* test de integración con runner espía: con dos worktrees, la segunda petición sin `worktrees=full` no lanza ningún git en sus carpetas; con `worktrees=full` sí lanza los de la fase 1 y trae `detailLevel: "full"`.

- **R32.** Cuando una petición autenticada hace `GET /api/projects/:id` de un repositorio principal, el sistema debe incluir `worktrees` con cada worktree (ocultos incluidos, marcados) según `design.md` §3.4, ordenados por última sesión, con `dirtyCount` real para los 30 primeros; y en el detalle de un worktree debe incluir `parentId` y `parentName`.
  - *Cómo se prueba:* test de integración con dos worktrees reales, uno con un fichero sin commitear (→ `dirtyCount: 1`) y otro oculto (`hidden: true`); detalle del worktree con `parentName`.

## E. Interfaz: vista Lista compacta y Tarjetas compactas

- **R33.** Cuando la interfaz agrupa el listado, el sistema debe producir con `groupProjects` una fila por proyecto de nivel superior con sus tareas en curso, una fila por grupo virtual y, si "Mostrar tareas sueltas" está activo, una fila por worktree, ordenadas por fijados, actividad de la fila descendente y nombre.
  - *Cómo se prueba:* test unitario puro con un listado de ejemplo (principal + 3 worktrees, uno oculto; 2 worktrees de un principal ausente; un `likelyWorktree`; un proyecto normal): número de filas, `worktreeCount`, grupo virtual y orden, con y sin tareas sueltas.

- **R34.** Cuando la interfaz construye el modelo de una fila, el sistema debe incluir con `buildRowModel` el semáforo con texto accesible "Estado: <etiqueta>", el nombre, el resumen completo tal como llega de la API (o "Sin descripción"), la actividad relativa ("hace X" o "Sin actividad") y solo los chips que apliquen con los textos exactos de `design.md` §6.2.
  - *Cómo se prueba:* test unitario puro (el resumen de 160 caracteres aparece entero y sin «…») de cada chip ("1 tarea en curso", "3 tareas en curso", "Espera tu aprobación" por el propio proyecto y por una tarea, "Claude Code", "Tarea de CRM RAPIDO", "Tarea (probable)") y de su ausencia cuando no aplican.

- **R35.** Cuando la interfaz pinta una fila con `renderProjectRow`, el sistema debe generar un botón principal que ocupa toda la fila con `data-action="detail"`, un botón "⋯" de 44 px con `aria-label` y `aria-expanded`, y un menú oculto con Fijar/Desfijar, Ocultar/Mostrar, "Abrir app" y "Eliminar" (solo manuales), sin botones de acción visibles en la fila y con todo el texto escapado.
  - *Cómo se prueba:* test unitario puro del HTML (atributos, menú con `hidden`, "Abrir app" con `aria-disabled` sin URL, "Eliminar" solo en manuales, nombre y resumen con `<script>` escapados).

- **R36.** Cuando el humano abre un grupo virtual, el sistema debe mostrar con `renderGroupDetail` su nombre, el aviso de que el repositorio principal no está en el panel y la lista de sus tareas con nombre, rama, actividad relativa y botón "Ver detalle".
  - *Cómo se prueba:* test unitario puro con un grupo de dos worktrees.

- **R37.** Cuando la interfaz pinta la vista Tarjetas, el sistema debe generar con `renderProjectCard` una tarjeta con el resumen completo, los datos de las fases 1–3 y las acciones dentro del menú "⋯" (sin el pie de botones grandes), conservando los atributos y textos que ya comprueban los tests de las fases 1–4.
  - *Cómo se prueba:* test unitario puro: la tarjeta contiene `class="card-summary"`, el botón "⋯" y el menú oculto, no contiene `class="card-actions"`, y los tests existentes de `renderProjectCard` siguen en verde sin cambios.

- **R38.** Cuando la interfaz carga o guarda las preferencias de la lista, el sistema debe usar `loadListPrefs`/`saveListPrefs` con la clave `muver.listPrefs` y valores por defecto `{ view: "list", filter: "all", loose: false }`, y si `localStorage` lanza una excepción o guarda un valor no válido, entonces debe devolver los valores por defecto sin propagar el error.
  - *Cómo se prueba:* test unitario puro con un almacenamiento falso: ida y vuelta, JSON roto, `view: "grande"`, `getItem` y `setItem` que lanzan.

## F. Buscar, filtrar y "Antiguos"

- **R39.** Cuando el humano escribe en el buscador, el sistema debe mostrar solo las filas cuyo nombre, resumen, etiquetas o nombres de sus tareas contienen el texto buscado sin distinguir mayúsculas ni acentos.
  - *Cómo se prueba:* test unitario puro de `filterRows` con "crm" (→ "CRM RAPIDO"), "facturación" contra un resumen "facturacion", una etiqueta y el nombre de un worktree agrupado (→ su principal).

- **R40.** Cuando el humano elige un filtro, el sistema debe aplicar las definiciones del vocabulario (`all`, `active` con 7 días, `pinned`, `attention` con el semáforo de la fila o de sus tareas y los runs de "Te necesitan") sobre la lista ya cargada, sin pedir datos al servidor.
  - *Cómo se prueba:* test unitario puro de `filterRows` con reloj fijo y una lista con cada caso (actividad de hace 6 días y de hace 8; fijado; tarea en `atencion`; proyecto con un run `failed` en la cola).

- **R41.** Cuando la lista se pinta con el filtro `all` o `attention` y el buscador vacío, el sistema debe mover las filas antiguas a un bloque plegado "Antiguos (N)" al final, y con el filtro `pinned`, con `active` o con texto en el buscador no debe plegar ninguna.
  - *Cómo se prueba:* test unitario puro de `splitOld` (actividad de hace 31 días, `null`, fijado antiguo que no se pliega) y de `renderListBody` (contiene `<details class="old-projects">` con `<summary>Antiguos (2)</summary>` cerrado).

- **R42.** Si ninguna fila cumple el filtro y la búsqueda, entonces el sistema debe mostrar "Ningún proyecto coincide con el filtro o la búsqueda" con un botón "Quitar filtros" que vuelve a `all` y vacía el buscador.
  - *Cómo se prueba:* test unitario puro de `renderListBody` con lista vacía tras filtrar.

## G. Rendimiento del repintado

- **R43.** Cuando llega el refresco del listado, el sistema debe comparar con `planRowUpdate` la firma JSON del modelo de cada fila con la anterior y repintar solo las filas nuevas o cambiadas, quitar las que ya no están y no tocar el DOM si nada cambió.
  - *Cómo se prueba:* test unitario puro de `planRowUpdate`: misma lista → `changed: false` y cero filas a repintar; una fila con otro resumen → solo esa; fila nueva, fila desaparecida y cambio de orden.

## H. Detalle del proyecto

- **R44.** Cuando la interfaz pinta el detalle, el sistema debe mostrar arriba de la pestaña Resumen el bloque "De qué va" con el resumen (o "Sin descripción"), su origen con el texto de `design.md` §6.2 y el botón "Generar con Claude".
  - *Cómo se prueba:* test unitario puro de `renderProjectDetail` con cada `summarySource` y con `null`.

- **R45.** Cuando el detalle es de un repositorio principal con worktrees, el sistema debe mostrar la sección "Tareas en curso" con nombre, rama, última sesión relativa, "N ficheros sin commitear" y los botones "Ver detalle" y "Ocultar" (o "Mostrar" si está oculta) de cada tarea; y en el detalle de un worktree, el enlace "Tarea de <principal>".
  - *Cómo se prueba:* test unitario puro de `renderProjectDetail` con dos worktrees (uno oculto, uno con `dirtyCount: 2`) y con un detalle de worktree con `parentName`.

- **R46.** Cuando la interfaz pinta el formulario de ajustes, el sistema debe incluir el campo "De qué va (una frase)" prerrellenado solo con un resumen guardado, y `buildSettingsPayload` debe incluir `summary` solo si su valor cambió respecto al inicial.
  - *Cómo se prueba:* test unitario puro: con resumen `readme` el campo sale vacío con el README como `placeholder`; con `manual` sale relleno; el cuerpo sin cambios no trae `summary`; vaciado trae `summary: ""`; los tests de las fases 3–4 de `buildSettingsPayload` siguen en verde.

- **R47.** Cuando el humano pulsa "Generar con Claude" o "Generar resúmenes", el sistema debe mostrar antes el diálogo de confirmación de la fase 4 con los textos de `describeSummaryAction` de `design.md` §6.4 (solo lectura, número de proyectos, aviso de que consume uso de su plan de Claude y, en el lote, el tope de 50).
  - *Cómo se prueba:* test unitario puro de `describeSummaryAction` para un proyecto con y sin resumen previo, para un lote de 3 y para uno de 72 candidatos (→ "los primeros 50"), y con un nombre con `<b>` escapado.

- **R48.** Cuando la interfaz calcula los candidatos del lote, el sistema debe tomar con `summaryCandidates` las filas visibles de proyectos reales sin resumen, existentes y con ruta resuelta, sin las del bloque "Antiguos" si está plegado, hasta 50.
  - *Cómo se prueba:* test unitario puro con filas con y sin resumen, un grupo virtual (excluido), un proyecto `no_encontrado` (excluido), antiguos plegados y desplegados, y 60 candidatos (→ 50).

- **R49.** Cuando un lote está en marcha, el sistema debe mostrar con `renderBatchStatus` "Generando resúmenes: X de N" con los fallidos y omitidos y un botón "Cancelar", y al terminar el resumen final con un botón para cerrarlo.
  - *Cómo se prueba:* test unitario puro de `renderBatchStatus` en marcha, terminado y cancelado.

## I. Estilos, página y documentación

- **R50.** Cuando se cargan los estilos, el sistema debe definir en `styles.css` la fila `.project-row` sin `max-height` ni `overflow: hidden`, el nombre y el resumen sin `text-overflow`, sin `line-clamp` y con `white-space: normal` (el texto se ve entero y la fila crece), las alturas de línea y rellenos de `design.md` §6.6 que dejan una fila con resumen de una línea en ≤ 72 px desde 601 px, los chips que pasan de línea en lugar de recortarse, el botón "⋯" con 44 px de área táctil, la tarjeta `.card` sin `max-height`, y los colores de chips en claro y en oscuro, sin ningún ancho fijo mayor de 360 px.
  - *Cómo se prueba:* test estático de `styles.css` con `baseCss`/`mediaBlock` de `styles.test.js`: ausencia de `text-overflow`, `line-clamp` y `max-height` en `.project-row`, `.row-name`, `.row-summary`, `.row-chips` y `.card`; `line-height` de 20 px y 18 px y relleno vertical de 10 px desde 601 px; y el test existente de anchos ≤ 360 px; la altura real se mide en T21 con un navegador sin cabeza.

- **R51.** Cuando se sirve `index.html`, el sistema debe incluir la barra de la lista con el buscador etiquetado, los cuatro filtros como botones con `aria-pressed`, el conmutador Lista/Tarjetas, la casilla "Mostrar tareas sueltas", el botón "Generar resúmenes" y el contenedor del estado del lote según `design.md` §6.1.
  - *Cómo se prueba:* test estático de `index.html` con los ids y atributos de §6.1.

- **R52.** Cuando termina la feature, el sistema debe tener `docs/architecture.md` con los módulos, rutas y campos nuevos de esta fase y `docs/verification.md` con la tabla de la feature 13 (prefijo `[F13-R<n>]`) y la fila de la comprobación manual.
  - *Cómo se prueba:* test estático en `panel/test/deploy.test.js` que busca en `docs/architecture.md` `project-summary.js`, `repo-layout.js`, `summary-api.js`, `/api/summaries/generate` y `worktreeCount`, y en `docs/verification.md` el texto `[F13-R`.

- **R53.** Cuando se ejecuta `./init.sh`, el sistema debe terminar con los tests de las fases 1–4 y de esta feature en verde y `node sdd-lint.js` con 0 errores y 0 advertencias.
  - *Cómo se prueba:* ejecución de `./init.sh` desde la raíz del repo (tarea final).

- **R54.** **[MANUAL — Windows]** Cuando el humano abre el panel en su PC y en el móvil con su lista real, el sistema debe mostrar los worktrees de su repositorio principal de CRM agrupados como tareas en curso, las filas con resumen de una línea en ≤ 72 px en el PC sin ningún texto cortado con «…», un resumen comprensible en los proyectos con README o `package.json`, lanzar un chat con Haiku y otro con Opus mostrando el modelo en la ejecución y en el historial, y generar con el `claude` real un resumen individual y un lote de 3 sin editar ningún fichero de esos proyectos.
  - *Cómo se prueba:* comprobación manual del humano siguiendo la tarea manual de `tasks.md` (incluye anotar en `claude --help` `--model`, `--tools`, `--disallowedTools`, `--max-turns` y `--permission-mode default`, y `git status` limpio en los proyectos tras generar); resultado anotado en `docs/verification.md`.

## J. Modelo de Claude

- **R55.** Cuando el panel construye la llamada de trabajo a Claude Code con un modelo de `CLI_MODELS`, el sistema debe añadir `--model <alias>` antes de `--allowedTools` (que sigue siendo la última opción), y con `default`, ausente o cualquier otro valor no debe añadir `--model` ni ningún texto recibido.
  - *Cómo se prueba:* test unitario de `buildClaudeArgs` con `haiku`, `sonnet`, `opus` (posición exacta), `default`, `undefined`, `"opus --dangerously-skip-permissions"` y `"claude-opus-9"` (sin `--model` en los cuatro últimos); test estático de que `CLI_MODELS` es exactamente `["haiku", "sonnet", "opus"]`.

- **R56.** Cuando una petición autenticada lanza un run de Claude (`POST /api/projects/:id/runs`, `sdd/implement` o `sdd/approve-tests`) con `model` en `default`, `haiku`, `sonnet` u `opus`, el sistema debe usar ese modelo, guardarlo en `RunMeta.model` (`null` para `default`) y recordarlo en el registro como `model` del proyecto (quitando el campo con `default`); y sin `model` debe usar el recordado o `default`.
  - *Cómo se prueba:* test de integración con el CLI falso: chat con `sonnet` (argumentos con `--model sonnet`, `RunMeta.model: "sonnet"`, registro con `model: "sonnet"`), después `implement` sin `model` (→ `--model sonnet`), después chat con `default` (sin `--model`, campo quitado del registro).

- **R57.** Si `model` del cuerpo de un run o de un `PATCH /api/projects/:id` no es texto de la lista `default`, `haiku`, `sonnet`, `opus`, entonces el sistema debe responder `400` con el texto de `design.md` §4.3 y `field: "model"` sin lanzar ningún proceso ni escribir el registro.
  - *Cómo se prueba:* test de integración con `model: "gpt-4"`, `model: 3` y `model: "haiku --verbose"` en un run y en un `PATCH`: `400`, `FAKE_CLAUDE_LOG` inexistente y registro sin cambios.

- **R58.** Cuando una petición autenticada hace `GET /api/projects/:id/work`, el sistema debe incluir `model` (el recordado o `default`) y `models` con las cuatro opciones y sus etiquetas de `design.md` §3.7.
  - *Cómo se prueba:* test de integración con un proyecto sin modelo recordado y con `opus` recordado.

- **R59.** Cuando la interfaz pinta la vista Trabajar, el sistema debe mostrar el selector "Modelo" (Por defecto, Haiku, Sonnet, Opus) con el modelo recordado seleccionado, y `buildRunPayload` y los cuerpos de los botones "Implementar siguiente tarea" y "Aprobar tests" deben incluir el `model` elegido, y el texto de confirmación debe nombrarlo.
  - *Cómo se prueba:* test unitario puro de `renderWorkView` (opción seleccionada), `buildRunPayload` con y sin `model` (sin él, el cuerpo es el de la fase 4), `buildSddPayload` y `describeAction` de `chat`/`implement` con "Modelo: Opus" y "Modelo: el configurado en Claude Code".

- **R60.** Cuando la interfaz muestra un run, el sistema debe mostrar el modelo con `modelLabel` (Haiku, Sonnet, Opus o "Modelo por defecto") en la cabecera de la ejecución y en cada elemento del historial, y nada si el `RunMeta` no tiene el campo (runs anteriores a esta feature).
  - *Cómo se prueba:* test unitario puro de `modelLabel`, `renderRunHeader` y `renderRunList` con `model: "opus"`, `model: null` y sin campo.

## K. "Te necesitan"

- **R61.** Cuando una petición autenticada hace `GET /api/attention`, el sistema debe excluir de `runs` los runs con `action: "summary"` en cualquier estado, y el fallo de una generación se debe ver solo en el historial del propio proyecto.
  - *Cómo se prueba:* test de integración con un run de resumen `failed` (escenario de error del CLI falso) y un chat `failed`: `/api/attention` trae solo el chat y `GET /api/projects/:id/runs` trae los dos.

## Supuestos y dudas para el leader (no inventados: a confirmar con el humano)

- **S1 — Flags del CLI (verificadas en la doc oficial `code.claude.com/docs/en/cli-reference` el 2026-10-25).** `--model` admite los alias `sonnet`, `opus`, `haiku` (y `fable`, que no se ofrece) o un nombre completo; `--permission-mode` admite `default`; `--max-turns` existe en modo `-p`; `--tools` restringe las herramientas disponibles; `--disallowedTools` con un nombre suelto quita la herramienta del contexto. Todas viven en `CLI_FLAGS`/`CLI_MODELS`; se confirman con `claude --help` en la tarea manual por si la versión del humano difiere.
- **S2 — Resuelto por el humano:** los runs de resumen no aparecen en "Te necesitan" (sección K).
- **S3 — Worktrees ya borrados.** Si la carpeta de un worktree de Claude ya no existe, git no puede agruparlo y queda como fila normal marcada "Tarea (probable)", plegada en "Antiguos" cuando tenga más de 30 días. Agruparlos también por la ruta `…/.claude/worktrees/<nombre>` sería posible, pero el humano pidió no agrupar por heurística.
- **S4 — Coste del lote.** El aviso dice que cada proyecto es una ejecución de Claude y consume uso del plan; no se muestra una estimación en euros porque depende del plan del humano. `--max-turns 10` limita cada ejecución.
- **S5 — Prompt de generación.** Texto fijo en español en `design.md` §5.4; si el humano quiere otro tono o longitud, se cambia una constante.
- **S6 — Modelo recordado al lanzar.** El modelo elegido en el selector se guarda en el proyecto al lanzar el run (no hace falta pulsar \"Guardar\"). El `PATCH` de `model` no es acción de ejecución (no pide confirmar la contraseña) porque no ejecuta nada; si el humano quiere que cambiar a Opus pida confirmación, se añade `model` a `EXEC_FIELDS`.
- **S7 — Tarjetas sin altura máxima.** Por la regla \"nada recortado\", la tarjeta pierde su `max-height`; se compacta quitando el pie de botones y con letra y rellenos menores, no ocultando texto.
