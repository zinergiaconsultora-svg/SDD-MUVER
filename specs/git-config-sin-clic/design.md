# Diseño — Feature 19: configuración de git sin ejecución en las lecturas (segunda revisión de la feature 14)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo solo esta carpeta,
> `docs/conventions.md` y el código actual de `panel/` (features 14 y 15 cerradas). Referencias `fichero:línea` del
> informe `progress/review_endurecimiento-ejecucion_2.md` (HEAD `e5b7e80`).
>
> Regla de oro de esta feature: **una lectura git del panel no ejecuta ningún programa que venga de la configuración
> local del repositorio ni de sus atributos**. "Commit y push" sí los ejecuta (como la terminal del humano), pero avisa.
>
> **Versiones de git.** Entorno de esta spec: git 2.43.0 (Linux). PC del humano: git 2.52.0.windows.1. Ninguna técnica
> elegida hace fallar una versión antigua: `-c clave=valor` y `--ignore-submodules=dirty` existen desde git 1.7;
> `config --show-scope` desde 2.26 (con alternativa, §3.2); `GIT_NO_LAZY_FETCH` desde 2.45 (una versión anterior
> ignora la variable: queda como riesgo documentado, §3.6). Las evidencias de cada vector (que git **sí** ejecuta el
> programa sin la protección) **no se han reproducido al redactar esta spec**: las reproduce el implementer como
> primera parte de cada test de evidencia (R3, R7, R9, R10, R14), antes de implementar, como en `[F15-R6]`. Si
> alguna evidencia no se reproduce con el git real, o una protección de §3 no la frena, el implementer se detiene y
> avisa al leader (no se ajusta el test para que pase).

## 1. Decisiones técnicas (resumen)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | **Prefijo ampliado** `GIT_SAFE_PREFIX = -c core.fsmonitor=false -c log.showSignature=false -c protocol.ext.allow=never` en toda llamada git (lecturas y pasos). | MA2: el `git log -1` del sondeo verifica firmas con `gpg.program` si `log.showSignature=true`. `ext::` permite que una URL de remoto sea un programa; nadie lo necesita en el panel. `-c` va en la línea de órdenes, que pisa la configuración local. |
| D2 | **Anulación de filtros por nombre** en las lecturas `status`/`diff`: se leen los filtros de la configuración local (`config --show-scope --get-regexp`) y se anulan con `-c filter.<n>.clean= … -c filter.<n>.required=false`. | El filtro se ejecuta venga el atributo de donde venga (`.gitattributes`, `.git/info/attributes`, `core.attributesFile` local); anular el **driver** cubre todas las fuentes. Solo los de ámbito local: un `filter.lfs.*` global (git-lfs del humano) sigue funcionando. |
| D3 | **Nombre de filtro raro → no se lee el estado** (`unsafeFilter`). | `-c filter.a=b.clean=` se parte en el primer `=`; en vez de escapar, se rechaza. Un nombre así no aparece en un uso normal. |
| D4 | **`--ignore-submodules=dirty`** en `status`/`diff` de lectura. | Sin ella, `git status` entra en cada submódulo, cuya configuración local (`.git/modules/<x>/config`) no se ha leído y puede tener filtros. El prefijo `-c` sí se hereda (`GIT_CONFIG_PARAMETERS`), los filtros del submódulo no. |
| D5 | **`GIT_NO_LAZY_FETCH=1`** en el entorno de las lecturas (runner central). | En un clon parcial, una lectura que necesita un blob ausente lo descarga y ejecuta `remote.<n>.uploadpack`, `core.sshCommand`, `credential.helper`, `core.askPass`, helpers de remoto… El panel no debe descargar nada al leer. |
| D6 | **"Commit y push": se avisa, no se anula** (`execConfig` en `GET /changes` y `configWarning` en el diálogo). Solo `ext::` se anula (D1). | Igual que con los hooks (D8 de la feature 14): quien puede escribir `.git/config` puede poner `core.hooksPath` y ejecutar lo que quiera en el commit, así que anular `gpg.program` o `core.askPass` no cerraría nada y cambiaría el resultado respecto a la terminal (firma, credenciales). El aviso hace visible lo que el humano no reconozca. |
| D7 | **Ajustes de ejecución en dos `<fieldset>`** con leyenda y ayuda, y sin el `placeholder` "npm test" en la lista de comandos de Claude. | M4: el humano escribió el comando de tests en la lista de comandos autorizados (T30); el mismo `placeholder` en los dos campos ayudaba a confundirlos. |

## 2. Estructura de ficheros

```
panel/
  lib/
    git-info.js        GIT_SAFE_PREFIX ampliado, EXEC_CONFIG_RE, GIT_COMMANDS (status + 2 lecturas de config),
                       readRepoExecConfig, filterOverrideArgs, runner con GIT_NO_LAZY_FETCH, getGitInfo (§5.1)
    git-actions.js     GIT_ACTION_ARGS con --ignore-submodules=dirty, anulación en status/stat/diff, execConfig,
                       unsafeFilter (§5.2)
    work-api.js        GET /changes devuelve execConfig (§5.4)
  public/
    work.js            renderExecSettingsForm en dos grupos, CONFIG_TEXTS.configWarning, renderConfigWarning (§5.3)
    app.js             aviso de configuración en "Commit y push"; aviso de comandos amplios en #exec-broad-slot (§5.3)
    styles.css         .exec-group y .field-help (§5.3)
  test/
    git-config.test.js NUEVO  evidencias con el git real (R3, R7, R9, R10, R11, R14)
    (ampliados) git-info, git-actions, work-api, work-render, styles, deploy
docs/architecture.md   apartados 3, 6 y 7 de "Seguridad de la ejecución" (§8.1)
docs/verification.md   sección Feature 19 (§8.2)
```

## 3. Lecturas sin programas del repositorio (MA2)

### 3.1 Prefijo (en `lib/git-info.js`)

```js
export const GIT_SAFE_PREFIX = Object.freeze([
  '-c', 'core.fsmonitor=false',
  '-c', 'log.showSignature=false',
  '-c', 'protocol.ext.allow=never',
]);
```

El orden importa poco para git, pero los dos primeros elementos siguen siendo `-c core.fsmonitor=false` (los tests de
la feature 14 que miran `args[0]`/`args[1]` siguen valiendo).

### 3.2 Lectura de la configuración local

```js
export const EXEC_CONFIG_RE =
  '^(filter\\..+\\.(clean|smudge|process)|gpg\\.(.+\\.)?program|gpg\\.ssh\\.defaultkeycommand'
  + '|core\\.(askpass|sshcommand|gitproxy)|credential\\.(.+\\.)?helper|remote\\..+\\.(receivepack|uploadpack|vcs)'
  + '|protocol\\..+\\.allow|url\\..+\\.(insteadof|pushinsteadof))$';
```

- git compara la expresión con el nombre canónico de la clave (sección y variable en minúsculas, subsección tal cual).
- Lecturas nuevas (se añaden al final de `GIT_COMMANDS`, lista cerrada de la fase 1):
  - `CMD_EXEC_CONFIG = ['--no-optional-locks', 'config', '--show-scope', '--name-only', '--get-regexp', EXEC_CONFIG_RE]`
  - `CMD_EXEC_CONFIG_NOSCOPE = ['--no-optional-locks', 'config', '--name-only', '--get-regexp', EXEC_CONFIG_RE]`
- `readRepoExecConfig(dir, { runner = defaultRunner, timeout = GIT_TIMEOUT_MS } = {})` → `{ filters, unsafeFilters, execKeys }`:
  1. Ejecuta `CMD_EXEC_CONFIG`. Si falla con `err.code === 129` (opción desconocida, git < 2.26), ejecuta
     `CMD_EXEC_CONFIG_NOSCOPE`. Código 1 (sin coincidencias) o cualquier otro fallo → las tres listas vacías.
  2. Cada línea no vacía: si tiene un tabulador, `ámbito = antes del primer tabulador`, `clave = después`; si no,
     `ámbito = 'local'` (salida sin `--show-scope`). Solo cuentan `local` y `worktree`.
  3. `execKeys` = claves únicas, recortadas a 200 caracteres, ordenadas, como mucho 20.
  4. De cada clave `filter.<n>.<var>`: `<n>` = entre `filter.` y el último punto. Si cumple `FILTER_NAME_RE =
     /^[A-Za-z0-9._-]{1,64}$/` va a `filters` (únicos, ordenados); si no, a `unsafeFilters`.
- **Fallo abierto justificado:** si la lectura de configuración falla, no se anula nada. Un `.git/config` mal formado
  o un `include` ilegible hacen fallar con el mismo error a `status` y `diff` (mismo lector de configuración), así que
  no se llega a ejecutar ningún filtro. Esto además mantiene los runners falsos de los tests anteriores, que lanzan un
  error con argumentos desconocidos.
- `include.path`/`includeIf` no ejecutan nada; lo que traen se muestra con el ámbito del fichero que lo incluye, así
  que entra en la lista.

### 3.3 Anulación de filtros

```js
export function filterOverrideArgs(filters) {
  const out = [];
  for (const n of filters) out.push('-c', `filter.${n}.clean=`, '-c', `filter.${n}.smudge=`, '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`);
  return out;
}
```

- Un valor vacío deja el driver sin programa (git solo lanza `clean`/`smudge`/`process` si la cadena no está vacía) y
  `required=false` evita el error "clean filter failed". **Lo confirma la evidencia de R7** con el git real.
- Se antepone a los argumentos de las lecturas `status` y `diff` (el runner pone delante `GIT_SAFE_PREFIX`). No se
  añade a `rev-parse`, `log`, `symbolic-ref`, `config` (no aplican filtros) ni a `add`/`commit`/`push` (D6).
- Con `unsafeFilters` no vacío no se ejecuta ninguna lectura `status`/`diff` del repo (R6).

### 3.4 Listas de argumentos (valores exactos)

- `GIT_COMMANDS[4]` (status del listado): `['--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=dirty']`.
- `GIT_COMMANDS` completo: los cuatro primeros sin cambios, ese `status`, `CMD_EXEC_CONFIG` y `CMD_EXEC_CONFIG_NOSCOPE`.
- `GIT_ACTION_ARGS` (solo cambian estas):
  - `status: ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty']`
  - `statHead: ['--no-optional-locks', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', 'HEAD', '--stat']`
  - `statCached: ['--no-optional-locks', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--cached', '--stat']`
  - `diffHead: ['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', 'HEAD', '--']`
  - `diffWorktree: ['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--']`
- Efecto visible: un submódulo con cambios sin commitear dentro ya no cuenta como cambio del repo principal; un
  submódulo que apunta a otro commit sí (git lo sabe sin entrar en él).

### 3.5 Entorno del runner central

```js
const base = opts.env || process.env;
const env = { ...base, GIT_NO_LAZY_FETCH: '1', ...(platform === 'win32' ? { NoDefaultCurrentDirectoryInExePath: '1' } : {}) };
```

Siempre se pasa `options.env = env` (antes en Linux no se pasaba). Los pasos de "Commit y push" no usan el runner
(van por `runs.js`) y no llevan `GIT_NO_LAZY_FETCH`: el push necesita la red y el commit se comporta como en la
terminal. Con la variable, una lectura que necesita un blob ausente falla; el diff de ese fichero sale vacío y el
resto de la respuesta es la normal.

### 3.6 Inventario de vectores y decisión

Comandos del panel: lecturas `rev-parse`, `symbolic-ref`, `log -1/-10 --format`, `status`, `diff --stat`, `diff -- <f>`,
`config --get`; pasos `add -A`, `commit -m`, `push`.

| Vector (configuración local salvo que se diga) | Dónde actúa | Decisión |
|---|---|---|
| `log.showSignature` + `gpg.program`, `gpg.openpgp/x509/ssh.program` | `log` del sondeo y del detalle | **Anular**: `-c log.showSignature=false` (D1). |
| `commit.gpgSign`/`push.gpgSign` + `gpg.*.program`, `gpg.ssh.defaultKeyCommand` | `commit`, `push` | **Avisar** (`execConfig`, D6). |
| `filter.<n>.clean/smudge/process` (+ cualquier fuente de atributos) | `status`, `diff`, `diff --stat`; `add -A` | Lecturas: **anular** por nombre (D2, D3). `add -A`: **avisar**. |
| Configuración local de un submódulo (filtros) | `status`/`diff` recursivos | **Anular** la entrada en submódulos: `--ignore-submodules=dirty` (D4). |
| `diff.<n>.textconv`, `diff.<n>.command`, `diff.external` | `diff`, `diff --stat` | Ya anulado (feature 14): `--no-ext-diff --no-textconv`. |
| `core.fsmonitor` | `status`, `diff`, `add` | Ya anulado (feature 14). |
| `core.pager`, `pager.<cmd>` | ninguna | **Documentar**: git solo usa el paginador con un terminal, y `execFile` usa tuberías. |
| `core.editor`, `sequence.editor` | ninguna | **Documentar**: el commit es `-m`, nunca abre editor. |
| `core.hooksPath` y hooks | `commit`, `push` (incluido `pre-auto-gc`) | **Avisar** (feature 14). Las lecturas no ejecutan hooks: no cambian refs y `--no-optional-locks` evita escribir el índice (`post-index-change`). |
| `core.sshCommand`, `core.gitProxy`, `credential.helper`, `core.askPass`, `remote.<n>.uploadpack`, `remote.<n>.vcs`, `url.<x>.insteadOf` | lecturas solo vía descarga perezosa; `push` | Lecturas: **anular** con `GIT_NO_LAZY_FETCH=1` (git ≥ 2.45; antes, **riesgo documentado**). Push: **avisar**. |
| `core.sshCommand` frente a `GIT_SSH` | `push` | **Avisar y documentar**: con el `GIT_SSH_COMMAND` del panel (por defecto `BatchMode`) no actúa; si el humano define solo `GIT_SSH`, el `core.sshCommand` local gana. |
| `remote.<n>.receivepack` (remoto local) | `push` | **Avisar**. |
| `protocol.ext.allow` + URL `ext::<programa>` | `push`; lecturas vía descarga perezosa | **Anular**: `-c protocol.ext.allow=never` (D1). |
| `extensions.partialClone`, `remote.<n>.promisor` | lecturas | **Anular** la descarga: `GIT_NO_LAZY_FETCH=1` (D5). |
| `include.path`, `includeIf` | todas | No ejecutan; su contenido cuenta como local (§3.2). |
| `core.attributesFile` local, `.git/info/attributes` | `status`, `diff` | Cubierto por D2 (se anula el driver, no el atributo). |
| `merge.<n>.driver`, `trailer.<n>.cmd`, `alias.*` | ninguna | **Documentar**: el panel no fusiona, no usa `--trailer` y solo llama a subcomandos internos (un alias no puede tapar uno interno). |
| `uploadpack.packObjectsHook`, `trace2.*` | ninguna | **Documentar**: git solo los lee de la configuración global o del sistema. |
| Configuración global y del sistema del humano | todas | **Fuera de alcance**: es del humano (por ejemplo, git-lfs o Git Credential Manager). |

## 4. Contratos y textos nuevos

### 4.1 Textos exactos

- `GIT_ERRORS.unsafeFilter` (en `git-actions.js`, también lo usa `getGitInfo` solo para decidir):
  `El repositorio define un filtro de git con un nombre no admitido en su configuración local (.git/config); el panel no lee sus cambios`
- `CONFIG_TEXTS.configWarning(keys)` (en `public/work.js`):
  `Atención: la configuración local de este repositorio (.git/config) define programas que git puede ejecutar al hacer commit y push: ${claves}. Revísalos si no los has configurado tú.`
  con `claves` = cada clave escapada con `escapeHtml`, unidas por `, `.

### 4.2 API

- `GET /api/projects/:id/changes` → igual que hoy más `execConfig: string[]` (siempre presente, `[]` si no hay).
  Con `unsafeFilters` → `409 { error: unsafeFilter }`.
- `GET /api/projects/:id/diff` y `POST /api/projects/:id/git/commit-push` → `409 { error: unsafeFilter }` en ese caso.
- `GET /api/projects` y el detalle: sin cambios de forma; con `unsafeFilters`, `git.dirtyCount` es `null`.

## 5. Módulos y funciones

### 5.1 `lib/git-info.js`

- Constantes de §3.1–§3.4, `readRepoExecConfig`, `filterOverrideArgs` y `FILTER_NAME_RE` (exportadas).
- `createGitRunner`: entorno de §3.5; el resto igual.
- `getGitInfo`: tras `log`, llama a `readRepoExecConfig(dir, { runner })`; con `unsafeFilters` no vacío deja
  `dirtyCount: null`, `dirtyFiles: []` sin ejecutar `status`; si no, ejecuta `[...filterOverrideArgs(filters), ...CMD_STATUS]`.

### 5.2 `lib/git-actions.js`

- Importa de `git-info.js` `readRepoExecConfig`, `filterOverrideArgs`; `GIT_ACTION_ARGS` de §3.4.
- `getChanges(dir)`: tras `isRepo`, `const cfg = await readRepoExecConfig(dir, options)`; si `cfg.unsafeFilters.length`
  → `{ ok: false, status: 409, error: GIT_ERRORS.unsafeFilter }`; si no, `status` y `stat` con
  `[...filterOverrideArgs(cfg.filters), ...lista]`; añade `execConfig: cfg.execKeys` y un campo interno
  `filterArgs` (no se publica en la API).
- `getFileDiff`: usa `changes.filterArgs` delante de `diffHead`/`diffWorktree`.
- `planCommitPush`: tras `isRepo`, lee la configuración; `unsafeFilters` → `409`; el `status` previo con la anulación;
  los tres pasos **sin cambios** salvo el prefijo nuevo (R13).
- Sin `--no-verify` ni `hooksPath=` en el fichero (test estático).

### 5.3 Interfaz

- `public/work.js`:
  - `export const CONFIG_TEXTS = { configWarning: (keys) => … }` (§4.1) y
    `renderConfigWarning(keys)` → `''` si no es una lista no vacía; si no, `<p class="warning" role="status">${configWarning}</p>`.
  - `renderExecSettingsForm(work)` devuelve exactamente (con `${commands}` y `${testCommand}` escapados como hoy):

```html
<form id="exec-settings-form" class="exec-settings" novalidate>
      <fieldset class="exec-group" id="exec-allowed-group">
        <legend>Permisos de Claude</legend>
        <div id="exec-broad-slot"></div>
        <div class="field">
          <label for="exec-allowed">Comandos que Claude puede ejecutar (uno por línea; además de git status, git diff y git log)</label>
          <textarea id="exec-allowed" name="allowedCommands" rows="4" autocomplete="off" placeholder="npm run lint" aria-describedby="exec-allowed-help">${commands}</textarea>
          <p id="exec-allowed-help" class="field-help">Reglas de lo que Claude puede ejecutar por su cuenta mientras trabaja en este proyecto. Esto NO es el comando de tests: el panel no ejecuta nada de esta lista.</p>
        </div>
      </fieldset>
      <fieldset class="exec-group" id="exec-test-group">
        <legend>Tests del panel</legend>
        <div class="field">
          <label for="exec-test">Comando de tests (vacío = bash init.sh si existe)</label>
          <input id="exec-test" name="testCommand" type="text" autocomplete="off" placeholder="npm test" aria-describedby="exec-test-help" value="${testCommand}">
          <p id="exec-test-help" class="field-help">Lo que ejecuta el botón «Ejecutar tests» del panel (por ejemplo, npm test). No da ningún permiso a Claude.</p>
        </div>
      </fieldset>
      <div id="exec-settings-error" class="form-error-slot"></div>
      <div class="form-actions">
        <button type="submit" class="btn">Guardar ajustes de ejecución</button>
      </div>
    </form>
```

  Los tests comparan las piezas (leyendas, ayudas, atributos), no los espacios en blanco.
- `public/app.js`:
  - `openWork`: `container.querySelector('#exec-broad-slot')` → `innerHTML = renderBroadWarning(work.broadCommands)`
    (sustituye al `insertAdjacentHTML('afterbegin', …)` sobre el formulario).
  - `commitPushAction`: `extraHtml` = `renderHooksWarning(changes) + renderConfigWarning(changes.execConfig) + <campo del mensaje>`.
- `public/styles.css` (junto a `.exec-settings`):

```css
.exec-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.exec-group legend {
  padding: 0 4px;
  font-weight: 600;
}

.field-help {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
}
```

### 5.4 `lib/work-api.js`

- `getProjectChanges` añade `execConfig: Array.isArray(changes.execConfig) ? changes.execConfig : []`. Nada más cambia
  (los `409` ya pasan por `changes.status`/`diff.status`/`plan.status`).

## 6. Flujos clave

1. **Sondeo** → `getGitInfo` → `rev-parse` ×2, `log -1` (prefijo con `log.showSignature=false`), `config --show-scope
   --get-regexp` → `status` con la anulación y `--ignore-submodules=dirty`; todas con `GIT_NO_LAZY_FETCH=1`.
2. **Ver cambios / diff** → `getChanges` (configuración una vez; `status` y `stat` con la anulación) → `diff` con la anulación.
3. **Commit y push** → `GET /changes` (`hooks`, `execConfig`) → diálogo con los dos avisos → pasos con el prefijo nuevo.

## 7. Tests (`node --test`, sin dependencias)

### 7.1 Fixtures de evidencia (`panel/test/git-config.test.js`, Linux, se salta sin git y en Windows)

- **Entorno aislado** como `[F15-R6]` (`hardening.test.js`): sin variables `GIT_*` heredadas, `HOME` y `XDG_CONFIG_HOME`
  temporales, `GIT_CONFIG_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0`; el mismo `env` se pasa a `startApp({ env })`.
  `user.name`/`user.email` se ponen en el `~/.gitconfig` temporal.
- **Script de marca** `marca.sh` (0o755) por caso: `#!/bin/sh\necho "$0 $*" >> "<marcas>/<caso>"\ncat\n` para filtros
  (deja pasar el contenido); los demás casos terminan con `exit 1` tras escribir la marca.
- Cada caso: (1) preparar; (2) **evidencia**: la llamada git del caso sin la protección (`execFile`, `shell: false`,
  `timeout` 10 s) → la marca existe; (3) borrar la marca; (4) peticiones del panel → respuestas normales y la marca no
  existe. Mensajes de aserción distintos para (2) ("la evidencia es efectiva") y (4).
- **R3 firma:** commit normal; `git cat-file commit HEAD`, insertar tras la línea `committer` las líneas
  `gpgsig -----BEGIN PGP SIGNATURE-----`, ` x` y ` -----END PGP SIGNATURE-----`, `git hash-object -t commit -w`,
  `git reset --hard <nuevo>`; `git config log.showSignature true`, `git config gpg.program <marca>`. Evidencia:
  `git log -1 --format=%H`. Panel: `GET /api/projects` y el detalle.
- **R7 filtros:** commit de `a.txt` (`hola\n`); después `.gitattributes` con `a.txt filter=marca`,
  `filter.marca.clean <marca>`, `filter.marca.required true`; `a.txt` → `chau\n` (mismo tamaño). Evidencia: `git status
  --porcelain` y `git diff --stat`. Panel: listado, detalle, `GET /changes`, `GET /diff?file=a.txt`, y
  `planCommitPush` con el runner real (sin lanzar los pasos). Segunda vuelta con `filter.marca.process` y con el
  atributo en `.git/info/attributes` en lugar de `.gitattributes`.
- **R9 submódulo:** repo `S` con `s.txt`; en el principal `git -c protocol.file.allow=always submodule add <S> sub`
  y commit; en `sub`: `.gitattributes`, `git -C sub config filter.m.clean <marca>`, `s.txt` del mismo tamaño.
  Evidencia: `git status --porcelain` en el principal. Panel: listado, detalle, `GET /changes`.
- **R10 clon parcial:** origen `O` con `uploadpack.allowFilter true` y `f.txt`; `git clone --filter=blob:none
  file://<O> C`; en `O`, segundo commit que cambia `f.txt`; en `C`, `git fetch` y `git reset --soft origin/<rama>`
  (el blob nuevo falta); `git -C C config remote.origin.uploadpack <marca>`. Evidencia: `git diff HEAD -- f.txt`
  sin `GIT_NO_LAZY_FETCH`. Panel: `GET /diff?file=f.txt` → `200`. La segunda parte se salta con el motivo
  "git < 2.45 no admite GIT_NO_LAZY_FETCH" si `git --version` es menor (aquí, 2.43, se salta; en el PC del humano
  la cubre la tarea manual).
- **R11 avisos:** repo con `gpg.program`, `core.askPass`, `credential.helper`, `core.sshCommand`,
  `remote.origin.receivepack`, `filter.x.clean` locales y `~/.gitconfig` temporal con `credential.helper` y
  `filter.lfs.process`: `GET /changes` → `execConfig` exacto (6 claves canónicas en minúsculas, ordenadas).
- **R14 `ext::`:** repo con un commit, `protocol.ext.allow always`, `git remote add origin 'ext::<marca>'` y un
  fichero cambiado. Evidencia: `git push origin HEAD`. Panel: `POST git/commit-push` (con la sesión y la reautenticación
  de los tests de la fase 4) y esperar el fin del run → `failed`, la marca no existe.

### 7.2 Reparto

| Fichero | Requisitos |
|---|---|
| `git-info.test.js` (ampliar) | F19-R1 (constante y runner), R2, R4, R5 (`getGitInfo`), R6 (`getGitInfo`), R8 (`GIT_COMMANDS`) |
| `git-actions.test.js` (ampliar) | F19-R1 (pasos), R5, R6, R8 (`GIT_ACTION_ARGS`), R13 |
| `git-config.test.js` (nuevo) | F19-R3, R7, R9, R10, R11, R14 |
| `work-api.test.js` (ampliar) | F19-R6 (`409` de `/changes`) |
| `work-render.test.js` (ampliar) | F19-R12, R15, R16 (estático de `app.js`) |
| `styles.test.js` (ampliar) | F19-R17 |
| `deploy.test.js` (ampliar) | F19-R18, R19 |
| Manual | F19-R20 |

### 7.3 Cambios declarados en tests anteriores

Solo estos (y se anotan en `docs/verification.md`):
- `git-info.test.js` → `[R12] runner espía…`: la clave literal de `status` pasa a la lista de §3.4.
- `git-info.test.js` → `[R12][F4-R61] GIT_COMMANDS es la lista cerrada…`: `deepEqual` con la lista de §3.4.
- `git-info.test.js` → `[F4-R61] getGitInfo ejecuta git --no-optional-locks status…`: el `status` esperado lleva `--ignore-submodules=dirty`.
- `git-info.test.js` → `[F14-R7][F14-R21] createGitRunner…`: `GIT_SAFE_PREFIX` y los `args` literales con el prefijo
  de §3.1; la aserción "en Linux no se añade entorno" pasa a "el entorno es `process.env` + `GIT_NO_LAZY_FETCH=1`".
- `git-info.test.js` → test `[F14-R13]` de `win32`: el `deepEqual` de `opts.env` añade `GIT_NO_LAZY_FETCH: '1'`.
- `git-actions.test.js` → `[F4-R60]` y la aserción de `push -u origin` (ajuste declarado F14): prefijo de §3.1.
- `git-actions.test.js` → `[F14-R23]` (unitario de `diffHead`/`diffWorktree`/`statHead`/`statCached`): listas de §3.4.
Si aparece otro test que falle por estos cambios, el implementer se detiene y lo consulta con el leader antes de tocarlo.

### 7.4 Comprobación manual (Windows, git 2.52.0.windows.1)

En Git Bash, fuera de cualquier proyecto del catálogo:
1. `mkdir -p /c/prueba-f19-marcas && cd /c && git init prueba-f19 && cd prueba-f19`; `marca.sh` en
   `/c/prueba-f19-marcas/` con `#!/bin/sh`, `echo "$(date) $0 $*" >> /c/prueba-f19-marcas/marcas.txt` y `cat`.
   Commit de `a.txt` con `hola`; firma falsa en `HEAD` como en §7.1 (R3); `git config log.showSignature true`,
   `gpg.program`, `filter.marca.clean` y `core.askPass` apuntando a `C:/prueba-f19-marcas/marca.sh`;
   `.gitattributes` con `a.txt filter=marca`; `a.txt` → `chau`.
2. **Evidencia sin el panel:** `git log -1`, `git status` y `git diff --stat` → `marcas.txt` tiene líneas (si no,
   anotar qué vector no actúa en 2.52 y seguir). Borrar `marcas.txt`.
3. Registrar `C:\prueba-f19` en el panel; esperar dos sondeos del listado; abrir el detalle, "Trabajar", "Ver cambios"
   y el diff de `a.txt` → `marcas.txt` **no existe**.
4. Pulsar "Commit y push" → el diálogo muestra el aviso de configuración con `core.askpass`, `filter.marca.clean` y
   `gpg.program`; **cancelar**.
5. "Ajustes de ejecución": dos grupos ("Permisos de Claude" y "Tests del panel") con su ayuda; con `node` guardado
   (confirmando el aviso), el aviso de comando amplio aparece dentro del primer grupo; quitar `node` después.
6. Anotar fecha, versión de Windows, `node -v`, `git --version` y el resultado en la fila de R20; borrar
   `C:\prueba-f19` del panel y del disco.

## 8. Documentación

### 8.1 `docs/architecture.md`, sección "Seguridad de la ejecución" (líneas de 120 columnas como máximo)

- **Apartado 3** (sustituye el texto actual): toda llamada git lleva `-c core.fsmonitor=false`,
  `-c log.showSignature=false` y `-c protocol.ext.allow=never`; las lecturas llevan además `GIT_NO_LAZY_FETCH=1`
  y, en `status`/`diff`, `--ignore-submodules=dirty` y la anulación `-c filter.<n>.clean= …` de los filtros de la
  configuración local (un nombre no admitido → `unsafeFilter`); el diff sigue con `--literal-pathspecs` y
  `--no-ext-diff --no-textconv`.
- **Apartado 6:** la frase "los filtros `clean`/`smudge` de `.gitattributes` + `.git/config` pueden ejecutarse en
  `git status`/`git add`, y los `credential.helper` y hooks en el push" pasa a "los filtros `clean`/`smudge`
  locales, los `credential.helper` y los hooks se ejecutan en "Commit y push" (se avisa, apartado 7)". Debe seguir
  conteniendo `clean` y `credential.helper` (test `[F14-R31]`).
- **Apartado 7 nuevo** `7. **Configuración local del repositorio** (feature 19)`: resumen de §3.6 en 6–10 líneas:
  qué se anula en las lecturas, que "Commit y push" ejecuta la configuración local como la terminal y avisa con
  `execConfig`/`configWarning` (`gpg.program`, `core.askPass`, `credential.helper`, `core.sshCommand`,
  `remote.<n>.receivepack`, filtros), la nota de `core.sshCommand` frente a `GIT_SSH`, lo que no aplica
  (`core.pager`, `core.editor`) y la versión mínima: con git < 2.45 la descarga perezosa de un clon parcial puede
  ejecutar programas en las lecturas; por qué no `--attr-source` (§10).
- Cadenas que comprueba `[F19-R18]`: apartado 3 → `log.showSignature=false`, `protocol.ext.allow=never`,
  `GIT_NO_LAZY_FETCH`, `--ignore-submodules=dirty`, `filter.<n>.clean=`, `unsafeFilter`; apartado 7 →
  `execConfig`, `configWarning`, `gpg.program`, `core.askPass`, `remote.<n>.receivepack`, `core.sshCommand`,
  `GIT_SSH`, `2.45`, `--attr-source`, `core.pager`, `core.editor`; la sección no contiene
  ``pueden ejecutarse en `git status` ``; ninguna línea de los apartados 3 y 7 pasa de 120 columnas.

### 8.2 `docs/verification.md`

Sección nueva al final del mapa (antes de "Qué NO se considera verificado"):
`## Mapa de trazabilidad — Feature 19: \`git-config-sin-clic\` (prefijo \`[F19-R<n>]\`)` con la nota de entorno de §7.1
(incluida la versión de git con la que pasaron las evidencias y qué parte se saltó), los cambios de §7.3 (con la
referencia `§7.3`), una fila por requisito, R20 `MANUAL — Windows, pendiente del humano` y R21 = `./init.sh`.

## 9. Ficheros que NO se tocan

- `panel/lib/` salvo `git-info.js`, `git-actions.js` y `work-api.js` (en lo de §5.4). En particular `trusted-bin.js`,
  `claude-cli.js`, `runs.js`, `exec-utils.js`, `registry.js`, `sdd-actions.js`, `project-state.js`, `app.js`.
- `panel/public/` salvo `work.js`, `app.js` y `styles.css` en lo de §5.3 (ni `index.html` ni `render.js`).
- `panel/scripts/`, `panel/deploy/`, `panel/projects.json`, `panel/projects.example.json`, `panel/legacy/`.
- `.claude/`, `CLAUDE.md`, `sdd-lint.js`, `init.sh`, `docs/specs.md`, `docs/constitution.md`, `docs/conventions.md`,
  `docs/acceso-web.md` y las specs de otras features. `feature_list.json` y `progress/` los gestiona el leader.

## 10. Alternativas consideradas y descartadas

| Alternativa | Por qué se descarta |
|---|---|
| `--attr-source=<árbol vacío>` (git ≥ 2.42) en las lecturas | No cubre `.git/info/attributes` ni un `core.attributesFile` local; con git < 2.42 la opción hace fallar todas las lecturas; también apagaría los atributos de git-lfs del humano. Anular el driver (D2) cubre todas las fuentes y todas las versiones. |
| `GIT_ATTR_NOSYSTEM=1` | Solo quita los atributos del sistema, que son del humano; no toca el repo. |
| `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_<n>` en lugar de `-c` para la anulación | Admitiría cualquier nombre de filtro, pero exige git ≥ 2.31 y suma variables a las del humano; los nombres raros se rechazan (D3). |
| Anular también `gpg.program`, `core.askPass`, `credential.helper`, `core.sshCommand` y los filtros en "Commit y push" | No cierra nada mientras los hooks se ejecuten (D8 de la feature 14) y rompería la firma, las credenciales o git-lfs del humano (D6). |
| `--no-lazy-fetch` en los argumentos | Con git < 2.45 es una opción desconocida y fallarían todas las lecturas; la variable se ignora sin error. |
| Excluir solo los filtros que usa algún atributo | Exigiría leer todos los ficheros de atributos con las reglas de git; anular todos los locales es más simple y cubre más. |
| Anular filtros también de ámbito global | Rompería la vista de cambios de los repos con git-lfs instalado de forma global; la configuración global es del humano. |

## 11. Riesgos, supuestos y dudas para el humano

- **Duda 1 (git-lfs u otros filtros locales):** en un repo con un filtro definido en `.git/config` (no en
  `~/.gitconfig`), "Ver cambios" y el listado pueden mostrar como cambiados ficheros que la terminal no muestra,
  porque se lee sin el filtro. Supuesto: es aceptable. ¿Usa el humano filtros locales en algún proyecto?
- **Duda 2 (submódulos):** con `--ignore-submodules=dirty`, los cambios sin commitear dentro de un submódulo no cuentan
  en el listado ni en "Ver cambios". Supuesto: aceptable.
- **Duda 3 (avisar en vez de anular en "Commit y push"):** se mantiene la línea de la feature 14. Si el humano prefiere
  anular (`-c commit.gpgSign=false`, `GIT_ASKPASS` vacío…), habría que cambiar R13 y aceptar que el panel no firme.
- **Riesgo (git < 2.45):** la descarga perezosa en las lecturas de un clon parcial sigue abierta; el PC del humano
  (2.52) está cubierto, la máquina de los tests (2.43) no lo está, y por eso esa parte de R10 se salta aquí.
- **Riesgo (carrera):** entre leer la configuración y lanzar `status` pasan milisegundos; si Claude añade un filtro
  justo entonces, esa lectura podría ejecutarlo. Se documenta; la siguiente lectura ya lo anula.
- **Coste:** una llamada git más por proyecto y sondeo (`config --get-regexp`, que solo lee ficheros).
- **Supuesto:** el ámbito que muestra `--show-scope` para lo que llega por `include.path` es el del fichero que lo
  incluye (`local`); lo comprueba el test de R11 si el implementer añade un caso con `include.path`.

### Decisiones del humano (2026-10-26, aprobación de la spec)

- Spec aprobada tal como está; se aceptan las cuatro dudas de esta sección:
  1. con un filtro (git-lfs u otro) definido en el `.git/config` del proyecto, el listado y "Ver cambios" pueden
     mostrar como cambiados ficheros que la terminal no marca;
  2. con `--ignore-submodules=dirty`, los cambios sin commitear dentro de un submódulo no cuentan;
  3. en "Commit y push" se **avisa** (no se anula) de los programas de la configuración del repo;
  4. con git anterior a 2.45 la descarga perezosa queda abierta en las lecturas (riesgo documentado).
- Comprobación previa del leader (git 2.43.0, `HOME` temporal, `GIT_CONFIG_NOSYSTEM=1`): un `filter.x.clean` local
  se ejecuta con `git status` y no con `-c filter.x.clean= -c filter.x.required=false` (status y `diff --stat`
  siguen mostrando el cambio); `gpg.program` se ejecuta con `log.showSignature=true` en `git log -1 --format=…` y no
  con `-c log.showSignature=false`. El resto de evidencias las hace el implementer (T2/T3) antes de implementar.
