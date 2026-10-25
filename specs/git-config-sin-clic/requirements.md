# Requisitos — Feature 19: configuración de git sin ejecución en las lecturas (segunda revisión de la feature 14)

> Origen: `progress/review_endurecimiento-ejecucion_2.md`, mejoras MA2 (alta), M3 (media) y M4 (baja, UX observada en
> la T30). Base técnica: las specs implementadas `specs/endurecimiento-ejecucion/` (prefijo `GIT_SAFE_PREFIX`,
> `core.fsmonitor`, `textconv`, hooks, `BatchMode`, riesgos conocidos) y `specs/comandos-amplios-git-npm/` (evidencias
> con el git real en un entorno aislado), y el código de `panel/lib/git-info.js`, `panel/lib/git-actions.js`,
> `panel/lib/work-api.js` y `panel/public/work.js`.
>
> Alcance:
> (MA2) ninguna llamada git de solo lectura del panel (sondeo del listado, detalle, "Ver cambios", diff, `isGitRepo` y
> el `status` previo de "Commit y push") ejecuta un programa definido en la configuración local del repositorio
> (`.git/config`, sus `include`, `config.worktree`, la de sus submódulos) ni en sus ficheros de atributos: se anulan
> la verificación de firmas de `git log`, los filtros `clean`/`smudge`/`process` locales, el transporte `ext::` y la
> descarga perezosa de un clon parcial, y las lecturas no entran en los submódulos;
> (M3) "Commit y push" sigue ejecutando hooks y la configuración local (decisión de la feature 14), pero el diálogo
> avisa de las claves locales que ejecutan programas (`gpg.program`, `core.askPass`, `credential.helper`,
> `core.sshCommand`, `remote.<n>.receivepack`, filtros…), y el push nunca usa el transporte `ext::`;
> (M4) "Ajustes de ejecución" separa en dos grupos "Comandos que Claude puede ejecutar" y "Comando de tests", con un
> texto de ayuda bajo cada campo.
>
> Fuera de alcance: desactivar los hooks o la firma en "Commit y push", la configuración global o del sistema del
> humano (`~/.gitconfig`, `C:\Program Files\Git\etc\gitconfig`), que se considera suya, los comandos autorizados de
> Claude (features 16–18) y el arranque de `cloudflared`.
>
> Convención de este fichero: cada requisito ocupa UNA sola línea (así `sdd-lint.js` lo valida completo) y va seguido
> de su línea *Cómo se prueba*. Listas, expresiones y textos exactos están en `design.md`. Los tests se etiquetan
> `[F19-R<n>]`. Los tests de **evidencia** siguen el patrón de la feature 15: con el git real, en un repo temporal y un
> entorno aislado (`HOME` y `XDG_CONFIG_HOME` temporales, `GIT_CONFIG_NOSYSTEM=1`, sin variables `GIT_*` heredadas),
> primero demuestran que la llamada git **sin** la protección crea el fichero de marca ("la evidencia es efectiva") y
> después que la llamada del panel **no** lo crea. Los requisitos marcados **[MANUAL — Windows]** los comprueba el
> humano en su PC (git 2.52.0.windows.1) y anota el resultado en `docs/verification.md`.

## Vocabulario

- **Configuración local:** valores de configuración de git cuyo ámbito (`--show-scope`) es `local` o `worktree`, incluidos los que llegan por `include.path`/`includeIf` desde esos ficheros; la escribe cualquiera que pueda escribir en `.git/`.
- **Lectura git:** cualquier llamada git del panel que no sea uno de los tres pasos de "Commit y push" (`add`, `commit`, `push`); todas pasan por el runner central `createGitRunner`.
- **Anulación de filtros:** las opciones `-c filter.<n>.clean= -c filter.<n>.smudge= -c filter.<n>.process= -c filter.<n>.required=false` para cada filtro `<n>` de la configuración local (`design.md` §3.3).
- **Clave local que ejecuta programas:** clave de la configuración local que casa con `EXEC_CONFIG_RE` (`design.md` §3.2).
- **Marca:** fichero que crea un script de prueba solo si git lo ejecuta.

## A. Lecturas sin programas del repositorio (MA2)

- **R1.** El sistema debe exportar congelado `GIT_SAFE_PREFIX` con exactamente `['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-c', 'protocol.ext.allow=never']` y, cuando el panel ejecuta una lectura git o un paso de "Commit y push", debe anteponerlo a sus argumentos.
  - *Cómo se prueba:* test unitario de la constante (valor exacto y congelada), de `createGitRunner` con `execFileImpl` espía (los argumentos empiezan por el prefijo completo) y de `planCommitPush` (los tres pasos empiezan por el prefijo completo; `display` no cambia).

- **R2.** Cuando el runner central lanza una lectura git, el sistema debe pasar al proceso un entorno igual al recibido (o a `process.env`) más `GIT_NO_LAZY_FETCH=1`, y en Windows también `NoDefaultCurrentDirectoryInExePath=1`, sin quitar ninguna otra variable.
  - *Cómo se prueba:* test unitario de `createGitRunner` con espía en `linux` y `win32`, con y sin `opts.env`: `GIT_NO_LAZY_FETCH === '1'` en los dos, la variable propia conservada y `NoDefaultCurrentDirectoryInExePath` solo en `win32`; los pasos de "Commit y push" no llevan `GIT_NO_LAZY_FETCH`.

- **R3.** Si la configuración local de un repo tiene `log.showSignature=true` y `gpg.program` (o `gpg.ssh.program`) apunta a un script de marca y `HEAD` es un commit con cabecera `gpgsig`, entonces el sistema no debe ejecutar ese script al responder `GET /api/projects` ni el detalle del proyecto.
  - *Cómo se prueba:* test de evidencia (Linux, se salta sin git) con el fixture de `design.md` §7.1: `git log -1` sin el prefijo crea la marca; tras borrarla, el listado y el detalle de `createApp` responden con la rama y el último commit reales y la marca no existe.

- **R4.** Cuando el sistema lee la configuración local de un repo, `readRepoExecConfig(dir, { runner })` debe ejecutar la lectura `execConfig` de `design.md` §3.2 y devolver `{ filters, unsafeFilters, execKeys }` con los nombres de filtro y las claves cuyo ámbito es `local` o `worktree`; si git no admite `--show-scope` debe repetirla sin esa opción y tratar todo lo devuelto como local, y si la lectura falla o no hay coincidencias debe devolver listas vacías.
  - *Cómo se prueba:* test unitario con un runner falso: salida con ámbitos `global`, `local`, `worktree` y `command` (solo cuentan `local`/`worktree`); fallo con código 129 en la primera llamada y salida sin ámbitos en la segunda; código 1 (sin coincidencias) → listas vacías; error de cualquier tipo → listas vacías; claves repetidas → una vez, en orden alfabético y como mucho 20 en `execKeys`.

- **R5.** Cuando el panel ejecuta una lectura git `status` o `diff` (el `status` del listado y del detalle, el `status` y el `diff --stat` de "Ver cambios", el diff de un fichero y el `status` previo de "Commit y push"), el sistema debe anteponer a sus argumentos la anulación de filtros de cada nombre de `filters`, en orden alfabético, y no debe añadirla a `add`, `commit` ni `push`.
  - *Cómo se prueba:* test unitario de `getGitInfo`, `getChanges`, `getFileDiff` y `planCommitPush` con un runner falso cuya lectura de configuración devuelve `local\tfilter.lfs.process` y `local\tfilter.b.clean`: las llamadas `status`/`diff` empiezan por las 8 opciones de anulación de `b` seguidas de las 8 de `lfs` y los tres pasos de `planCommitPush` no las contienen.

- **R6.** Si la configuración local define un filtro cuyo nombre no cumple `^[A-Za-z0-9._-]{1,64}$`, entonces el sistema no debe ejecutar ninguna lectura `status` ni `diff` de ese repo: `getGitInfo` debe devolver `dirtyCount: null` y `dirtyFiles: []`, y `getChanges`, `getFileDiff` y `planCommitPush` deben devolver `409` con el texto exacto `unsafeFilter` de `design.md` §4.1.
  - *Cómo se prueba:* test unitario con un runner falso que devuelve `local\tfilter.a=b.clean` y registra las llamadas: ninguna contiene `status` ni `diff`, y los resultados son los indicados; test de integración de `GET /api/projects/:id/changes` → `409` con ese texto.

- **R7.** Si la configuración local define `filter.<n>.clean`, `filter.<n>.smudge` o `filter.<n>.process` apuntando a un script de marca, con `filter.<n>.required=true`, y un `.gitattributes` del repo (o `.git/info/attributes`) asigna `filter=<n>` a un fichero cambiado, entonces el sistema no debe ejecutar ese script en el sondeo del listado, el detalle, `GET /changes`, el diff de ese fichero ni el `status` previo de "Commit y push", y esas respuestas deben ser las normales.
  - *Cómo se prueba:* test de evidencia (Linux, se salta sin git) con el fixture de `design.md` §7.1 (cambio del mismo tamaño y `mtime` igual al del índice para forzar la relectura): `git status` y `git diff --stat` sin la anulación crean la marca; tras borrarla, las peticiones del panel responden `200` con el fichero en la lista y la marca no existe; se repite con el atributo solo en `.git/info/attributes`.

- **R8.** Cuando el panel ejecuta una lectura git `status` o `diff`, el sistema debe incluir `--ignore-submodules=dirty` en sus argumentos, según las listas de `design.md` §3.4.
  - *Cómo se prueba:* test unitario de `GIT_COMMANDS` y `GIT_ACTION_ARGS` (`status`, `statHead`, `statCached`, `diffHead`, `diffWorktree`) con los valores exactos de `design.md` §3.4.

- **R9.** Si un repo tiene un submódulo cuya configuración local define un filtro `clean` de marca asignado a un fichero modificado del submódulo, entonces el sistema no debe ejecutar ese filtro en el sondeo del listado, el detalle ni `GET /changes` del repo principal.
  - *Cómo se prueba:* test de evidencia (Linux, se salta sin git) con el fixture de `design.md` §7.1 (submódulo desde un repo local con `protocol.file.allow=always` solo al prepararlo): `git status` sin la opción en el repo principal crea la marca; tras borrarla, las peticiones del panel responden `200` y la marca no existe.

- **R10.** Si un repo es un clon parcial (`--filter=blob:none`) de un remoto local y la configuración local define `remote.origin.uploadpack` con un script de marca, entonces el sistema no debe ejecutar ese script al pedir el diff de un fichero cuyo blob de `HEAD` falta, y el diff debe responder `200` (con o sin contenido).
  - *Cómo se prueba:* test de evidencia (Linux, se salta sin git; la segunda parte se salta con el motivo "git < 2.45 no admite GIT_NO_LAZY_FETCH" si la versión es menor): `git diff HEAD -- <fichero>` sin `GIT_NO_LAZY_FETCH` crea la marca; tras borrarla (el script falla, así que el blob sigue faltando), `GET /diff` del panel responde `200` y la marca no existe.

## B. Commit y push (M3)

- **R11.** Cuando `GET /api/projects/:id/changes` responde para un repo, el sistema debe incluir `execConfig` con las claves locales que ejecutan programas (`execKeys` de `readRepoExecConfig`), y una lista vacía si no hay o si la lectura falla.
  - *Cómo se prueba:* test de integración (Linux, se salta sin git) con un repo cuya configuración local define `gpg.program`, `core.askPass`, `credential.helper`, `core.sshCommand`, `remote.origin.receivepack` y `filter.x.clean`, y un `~/.gitconfig` temporal con `credential.helper` y `filter.lfs.process`: `execConfig` es exactamente la lista ordenada de las seis claves locales; un repo recién creado → `[]`.

- **R12.** Cuando el humano abre "Commit y push" en un repo con `execConfig` no vacío, la interfaz debe añadir al diálogo, detrás del aviso de hooks, el aviso exacto `configWarning` de `design.md` §5.2 con las claves escapadas, y sin él si la lista está vacía.
  - *Cómo se prueba:* test unitario de `renderConfigWarning` (texto exacto con dos claves, escapado de `<script>`, lista vacía o ausente → cadena vacía); el orden en el diálogo se comprueba en la tarea manual.

- **R13.** Cuando el sistema prepara los pasos de "Commit y push", los argumentos de cada paso deben ser exactamente `GIT_SAFE_PREFIX` seguido de la lista de la feature 14 (`add -A`, `commit -m <mensaje>`, `push` o `push -u origin <rama>`), sin `--no-verify`, sin anulación de filtros y sin anular `gpg.*`, `core.askPass`, `credential.helper`, `core.sshCommand` ni `core.hooksPath`.
  - *Cómo se prueba:* test unitario de `planCommitPush` con un runner falso cuya configuración local tiene filtros (`deepEqual` de los tres pasos) y test estático de que `git-actions.js` no contiene `--no-verify` ni `hooksPath=`.

- **R14.** Si la configuración local tiene `protocol.ext.allow=always` y la URL de `origin` usa el transporte `ext::` con un script de marca, entonces el sistema no debe ejecutar ese script en el paso de push de "Commit y push", y el run debe terminar `failed`.
  - *Cómo se prueba:* test de evidencia (Linux, se salta sin git): `git push origin HEAD` sin el prefijo crea la marca; tras borrarla, `POST git/commit-push` del panel termina con el run `failed` y la marca no existe.

## C. Ajustes de ejecución (M4)

- **R15.** Cuando el sistema pinta "Ajustes de ejecución", `renderExecSettingsForm` debe devolver dos grupos `<fieldset>` con las leyendas, ayudas y atributos exactos de `design.md` §5.3, conservando los `id` y `name` de los campos, el hueco `exec-broad-slot` dentro del primer grupo y el botón de guardar.
  - *Cómo se prueba:* test unitario de `renderExecSettingsForm` (dos `fieldset`, leyendas, textos de ayuda exactos, `aria-describedby` de cada campo igual al `id` de su ayuda, `exec-broad-slot` dentro del primer grupo, valores escapados) y de que `buildExecSettingsPayload` no cambia.

- **R16.** Cuando la vista "Trabajar" se carga con comandos amplios guardados, la interfaz debe pintar el aviso `broadSaved` dentro del hueco `exec-broad-slot` del grupo de comandos de Claude y no al principio del formulario.
  - *Cómo se prueba:* test estático de `public/app.js` (usa `#exec-broad-slot` y ya no `settingsForm.insertAdjacentHTML('afterbegin'`) y comprobación en la tarea manual.

- **R17.** Cuando el navegador pinta "Ajustes de ejecución", el sistema debe aplicar las reglas de `public/styles.css` `.exec-group` (borde, radio y relleno) y `.field-help` (tamaño y color atenuados) sin anchos fijos en píxeles mayores que 360.
  - *Cómo se prueba:* test estático en `panel/test/styles.test.js` que busca los dos selectores con `border`, `padding` y `color: var(--muted)`, y el test de anchos existente sigue pasando.

## D. Documentación, verificación manual y final

- **R18.** Cuando se cierra la feature, el sistema debe tener en `docs/architecture.md`, sección "Seguridad de la ejecución", el apartado 3 y el apartado nuevo 7 con los textos de `design.md` §8.1 (prefijo ampliado, anulación de filtros, submódulos, descarga perezosa, inventario de vectores con su decisión y versión mínima de git), y el apartado 6 sin la frase de los filtros en `git status` como riesgo abierto.
  - *Cómo se prueba:* test estático en `panel/test/deploy.test.js` que busca en esos apartados las cadenas clave de `design.md` §8.1 y que los tests estáticos de la sección de las features 14 y 15 siguen pasando.

- **R19.** Cuando se cierra la feature, el sistema debe tener en `docs/verification.md` la sección "Mapa de trazabilidad — Feature 19" con prefijo `[F19-R<n>]`, una fila por requisito, la fila manual pendiente del humano y la lista de cambios declarados en tests anteriores de `design.md` §7.3.
  - *Cómo se prueba:* test estático en `panel/test/deploy.test.js` que comprueba la sección, una sola fila por requisito y que cada etiqueta `[F19-R<n>]` no manual aparece en algún fichero de `panel/test/`.

- **R20.** [MANUAL — Windows] Cuando el humano prepara en su PC (git 2.52.0.windows.1) un repo de prueba con los vectores de `design.md` §7.4 y usa el panel, el sistema no debe ejecutar ningún script de marca en el listado, el detalle, "Ver cambios" ni el diff, debe mostrar el aviso `configWarning` en "Commit y push" y debe mostrar "Ajustes de ejecución" con los dos grupos separados.
  - *Cómo se prueba:* el humano sigue la receta de `design.md` §7.4 (primero comprueba en Git Bash que cada vector crea su marca sin el panel) y anota fecha, versiones y resultado en `docs/verification.md`.

- **R21.** Cuando se ejecuta `./init.sh` al terminar, el sistema debe pasar todos los tests de las fases 1–4 y de las features 14, 15 y 19, con solo los cambios de tests anteriores declarados en `design.md` §7.3, y `node sdd-lint.js` debe terminar con 0 errores.
  - *Cómo se prueba:* ejecución de `./init.sh` (tarea final de `tasks.md`) con todo en verde; el reviewer compara los tests cambiados con la lista de §7.3.
