# docs/verification.md — Estrategia de verificación

> **¿Qué es esto, en cristiano?** Cómo comprobamos que lo construido funciona de
> verdad. La "red de seguridad". Lo usa el reviewer para validar.

## Principio

Cada requisito (R<n>) de `requirements.md` se comprueba con **al menos un test**
automático. Si un requisito no se puede probar, está mal escrito.

## Tipos de prueba (según el proyecto)

- **Tests unitarios:** comprueban una pieza pequeña aislada (una función).
- **Tests de integración:** comprueban que varias piezas funcionan juntas.
- **Comprobación manual:** para cosas visuales o difíciles de automatizar; documéntala.

## Cómo se ejecutan

- Todo se lanza desde `init.sh` (paso 3: `(cd panel && npm test)`, que ejecuta `node --test` sobre `panel/test/*.test.js`; también puede lanzarse a mano con `cd panel && npm test`). Los tests de la fase 1 llevan el prefijo `[R<n>]`, los de la fase 2 `[F2-R<n>]` y los de la fase 3 `[F3-R<n>]` (siempre con un `claudeHome` temporal) y los de la fase 4 `[F4-R<n>]` (siempre con el CLI de Claude falso `panel/test/fixtures/fake-claude.js`, repos git temporales con un remoto `--bare` local y claves de Cloudflare Access generadas en el test; nunca el `claude` real ni un remoto real); los de la fase 1 que tocan la API se autentican con la cookie de sesión del `before()` (`F2-R16`).
- Los requisitos **[MANUAL — Windows]** y **[MANUAL — Internet]** de la fase 2 no pueden ejecutarse en el entorno de tests (Linux, sin `cloudflared`): el humano los comprueba siguiendo `docs/acceso-web.md` y anota aquí el resultado.
- El reviewer ejecuta `init.sh` y exige que esté **todo en verde** antes de aprobar.

## Mapa de trazabilidad (lo rellena el implementer)

> Tabla que conecta cada requisito con su(s) test(s). El reviewer la verifica.

| Requisito | Test que lo cubre |
|-----------|-------------------|
| R1 | `panel/test/api.test.js` → "[R1] GET /api/projects devuelve el listado…"; `panel/test/project-state.test.js` → "[R1][R2] buildSummary/buildDetail de un proyecto completo…" |
| R2 | `panel/test/api.test.js` → "[R2] GET /api/projects/:id devuelve detalle…"; `panel/test/git-info.test.js` → "[R2] detalle con 2 commits…"; `panel/test/project-state.test.js` → "[R1][R2] buildSummary/buildDetail…" |
| R3 | `panel/test/api.test.js` → "[R3] GET /api/projects/:id inexistente → 404" |
| R4 | `panel/test/api.test.js` → "[R4] rutas /api desconocidas → 404…" y "[R4] excepción inesperada del handler → 500…" |
| R5 | `panel/test/project-state.test.js` → "[R5] readFeatureList cuenta estados…" |
| R6 | `panel/test/project-state.test.js` → "[R6] readFeatureList sin fichero…" y "[R6] buildSummary sobre directorio vacío…" |
| R7 | `panel/test/project-state.test.js` → "[R7] readFeatureList con JSON roto…", "[R7] readFeatureList sin array features…" y "[R7] buildSummary con feature_list.json roto…" |
| R8 | `panel/test/project-state.test.js` → los cuatro tests "[R8] detectBlock: …" y "[R8] readProgress con fichero y con BOM" / "[R8] readProgress sin fichero…" |
| R9 | `panel/test/git-info.test.js` → "[R9] repo con 1 commit y 1 fichero sin añadir" |
| R10 | `panel/test/git-info.test.js` → "[R10] repo sin commits…", "[R10] directorio sin .git…" y "[R10] runner que falla con ENOENT…" |
| R11 | `panel/test/project-state.test.js` → "[R11] buildSummary con ruta inexistente → no_encontrado y runner nunca invocado" y "[R11] computeStatus: !exists…" |
| R12 | `panel/test/git-info.test.js` → "[R12] runner espía: binario git, argumentos permitidos, cwd y timeout 5000" y "[R12] GIT_COMMANDS es la lista cerrada…" |
| R13 | `panel/test/project-state.test.js` → los tres tests "[R13] atencion: …" |
| R14 | `panel/test/project-state.test.js` → "[R14] en_curso gana a inactivo…" |
| R15 | `panel/test/project-state.test.js` → "[R15] inactivo a 15 días; ok a 14 días exactos y a 13 días" |
| R16 | `panel/test/project-state.test.js` → los tres tests "[R16] ok …" |
| R17 | `panel/test/api.test.js` → "[R17] POST /api/projects válido → 201…"; `panel/test/registry.test.js` → tests "[R17] slugify…", "[R17] validateNewProject acepta…", "[R17] loadRegistry…", "[R17] saveRegistry + loadRegistry…" |
| R18 | `panel/test/api.test.js` → "[R18] POST con path inexistente / fichero / relativa → 400…"; `panel/test/registry.test.js` → los tres tests "[R18] validateNewProject rechaza ruta…" |
| R19 | `panel/test/api.test.js` → "[R19] POST sin name / sin path / id inválido / id duplicado…"; `panel/test/registry.test.js` → los cuatro tests "[R19] validateNewProject rechaza…" |
| R20 | `panel/test/api.test.js` → "[R20] POST con JSON roto → 400 … cuerpo > 64 KB también" |
| R21 | `panel/test/api.test.js` → "[R21] DELETE /api/projects/:id → 204…"; `panel/test/registry.test.js` → "[R21] removeProject…" |
| R22 | `panel/test/api.test.js` → "[R22] DELETE /api/projects/:id inexistente → 404" |
| R23 | `panel/test/network.test.js` → los dos tests "[R23] buildAccessUrls…"; `panel/test/api.test.js` → "[R23] la app escucha en 0.0.0.0 con puerto 0"; impresión de URLs: comprobación manual (`npm start`) |
| R24 | `panel/test/api.test.js` → "[R24] estáticos: /, /styles.css, /app.js, /manifest.webmanifest → 200…" |
| R25 | `panel/test/api.test.js` → "[R25] estáticos inexistentes o fuera de public/ → 404 sin revelar rutas" |
| R26 | `panel/test/api.test.js` → "[R26] manifest con los campos exigidos e icono SVG…"; `panel/test/styles.test.js` → "[R26] index.html declara manifest, viewport y el módulo app.js" |
| R27 | Comprobación manual documentada: `./init.sh` en verde; con un `assert.fail()` temporal en un test, `init.sh` termina con código ≠ 0 (ver T27/T30 en `specs/puesto-de-mando-base/tasks.md`) |
| R28 | `panel/test/render.test.js` → "[R28] renderProjectCard con proyecto completo", "[R28] STATUS_LABELS…", "[R28] renderProjectCard escapa HTML…", "[R28] appUrl vacío → botón…", "[R28] relativeDate en español"; `panel/test/styles.test.js` → "[R28][R31] index.html tiene los contenedores…" |
| R29 | `panel/test/render.test.js` → los tres tests "[R29] renderProjectCard sin arnés / sin git / inexistente…" |
| R30 | `panel/test/render.test.js` → "[R30] renderProjectDetail muestra features…" y "[R30] renderProjectDetail sin progress/current.md…"; navegación Detalle/Volver: manual |
| R31 | `panel/test/render.test.js` → "[R31] buildProjectPayload convierte etiquetas y omite vacíos"; `panel/test/styles.test.js` → "[R28][R31] index.html tiene … el formulario de alta con sus 5 campos"; flujo completo: manual |
| R32 | `panel/test/render.test.js` → "[R32] renderFormError devuelve el texto con role=\"alert\""; manual: alta con ruta inexistente |
| R33 | `panel/test/render.test.js` → "[R33] handleDelete no llama a request si se cancela" y "[R33] handleDelete llama a DELETE…" |
| R34 | `panel/test/render.test.js` → "[R34] renderLoadError muestra el mensaje y un botón Reintentar"; manual: parar el servidor con la página abierta |
| R35 | `panel/test/render.test.js` → "[R35] REFRESH_INTERVAL_MS es 60000…"; manual: la hora del encabezado cambia |
| R36 | `panel/test/styles.test.js` → "[R36] .projects es de una columna…", "[R36] ningún width/min-width en píxeles supera 360", "[R36] botones con área táctil mínima de 44 px"; manual: emulador 360×640 sin scroll horizontal |
| R37 | `panel/test/styles.test.js` → "[R37] tema oscuro redefine --bg y --fg…" y "[R37] las cinco clases status-* definen un color"; manual: cambiar el tema del sistema |

## Mapa de trazabilidad — Feature 2: `puesto-de-mando-acceso-web` (prefijo `[F2-R<n>]`)

> Ficheros nuevos: `panel/test/auth.test.js`, `rate-limit.test.js`, `auth-api.test.js`, `config.test.js`, `tunnel.test.js`, `deploy.test.js`; ampliados: `render.test.js`, `styles.test.js`, `api.test.js`, `helpers.js`.

| Requisito | Test que lo cubre |
|-----------|-------------------|
| R1 | `panel/test/auth-api.test.js` → "[F2-R1] GET /api/auth/status sin auth.json → 200 { configured: false, authenticated: false, publicUrl: null }" |
| R2 | `panel/test/auth-api.test.js` → "[F2-R2] POST /api/auth/setup crea auth.json (§3.1)…"; `panel/test/auth.test.js` → "[F2-R2] createAuthRecord devuelve el registro del contrato §3.1…" |
| R3 | `panel/test/auth-api.test.js` → "[F2-R3] setup con password ausente, no cadena, 9 o 129 caracteres → 400 y sin auth.json"; `panel/test/auth.test.js` → "[F2-R3][F2-R29] validatePassword…" |
| R4 | `panel/test/auth-api.test.js` → "[F2-R4] setup repetido → 409 y auth.json byte a byte igual" |
| R5 | `panel/test/auth-api.test.js` → "[F2-R5] auth.json roto → 500 en status/login/setup, fichero intacto y GET / sigue en 200"; `panel/test/auth.test.js` → "[F2-R5][F2-R6] loadAuth: …" |
| R6 | `panel/test/auth-api.test.js` → "[F2-R6] dataDir inexistente: el setup crea la carpeta y auth.json sin .tmp residual"; `panel/test/auth.test.js` → "[F2-R5][F2-R6] loadAuth … saveAuth atómico" |
| R7 | `panel/test/deploy.test.js` → "[F2-R7] .gitignore raíz contiene la línea panel/data/…" y "[F2-R7] git check-ignore considera ignorado panel/data/auth.json" |
| R8 | `panel/test/auth-api.test.js` → "[F2-R8] login correcto → 200, cookie con HttpOnly/SameSite=Lax/Path=//Max-Age=2592000 y sesión con expiresAt = now + 30 d"; `panel/test/auth.test.js` → "[F2-R8][F2-R18][F2-R19] createSessionStore…"; `panel/test/rate-limit.test.js` → "[F2-R8][F2-R20] parseCookies y buildSetCookie…" |
| R9 | `panel/test/auth-api.test.js` → "[F2-R9] contraseña incorrecta → 401 "Contraseña incorrecta", sin Set-Cookie ni sesión nueva" |
| R10 | `panel/test/auth-api.test.js` → "[F2-R10] login sin password o con password no cadena → 400 siempre (nunca 429)…" y "[F2-R10][F2-R3][F2-R29] cuerpos JSON que no son un objeto (null, "", 0, []) → 400 "Cuerpo JSON inválido" en login, setup, change-password y POST /api/projects…" |
| R11 | `panel/test/auth-api.test.js` → "[F2-R11] login sin auth.json → 409 "Contraseña no configurada"" |
| R12 | `panel/test/auth.test.js` → "[F2-R12] hashPassword usa scrypt N=16384 r=8 p=1 keylen=64 con salt nuevo; verifyPassword acepta la correcta y rechaza la alterada" |
| R13 | `panel/test/auth.test.js` → "[F2-R13] verifyPassword con hash de longitud distinta o hex inválido devuelve false sin lanzar", "[F2-R13] signId/verifyToken…" y "[F2-R13] lib/auth.js y lib/sessions.js usan timingSafeEqual" |
| R14 | `panel/test/auth-api.test.js` → "[F2-R14] atributo Secure solo con X-Forwarded-Proto: https (proxy de confianza) o secureCookies: true"; `panel/test/rate-limit.test.js` → "[F2-R14][F2-R15] isHttpsRequest…"; **MANUAL — pendiente del humano** (cookie `Secure` vista en DevTools desde la URL pública, T31) |
| R15 | `panel/test/auth-api.test.js` → "[F2-R15] trustProxy: false ignora X-Forwarded-Proto y CF-Connecting-IP"; `panel/test/rate-limit.test.js` → "[F2-R14][F2-R15] isHttpsRequest…" y "[F2-R25] getClientIp…" |
| R16 | `panel/test/auth-api.test.js` → "[F2-R16] petición autenticada ejecuta la ruta como en la fase 1 (GET 200, POST 201)"; `panel/test/api.test.js` (los 15 tests de la fase 1, autenticados en `before()`) |
| R17 | `panel/test/auth-api.test.js` → "[F2-R17] sin cookie / firma incorrecta / id no listado / caducada → 401 "No autenticado" sin tocar projects.json" |
| R18 | `panel/test/auth-api.test.js` → "[F2-R18] renovación deslizante: a los 10 s no hay Set-Cookie ni cambio; a los 20 días se renueva (expiresAt = t0 + 50 d)"; `panel/test/auth.test.js` → "[F2-R8][F2-R18][F2-R19] createSessionStore…" |
| R19 | `panel/test/auth-api.test.js` → "[F2-R19] sesión caducada (t0 + 31 d) → 401 y la entrada desaparece de sessions.json"; `panel/test/auth.test.js` → "[F2-R8][F2-R18][F2-R19] createSessionStore…" |
| R20 | `panel/test/auth-api.test.js` → "[F2-R20] logout → 204 con cookie de borrado, sesión eliminada, cookie antigua → 401; logout sin cookie → 204"; `panel/test/auth.test.js` → "[F2-R20][F2-R27] destroy…"; `panel/test/rate-limit.test.js` → "[F2-R8][F2-R20] parseCookies y buildSetCookie…" |
| R21 | `panel/test/auth-api.test.js` → "[F2-R21] reinicio con el mismo dataDir conserva la sesión" y "[F2-R21] sessions.json roto → arranca con cero sesiones…"; `panel/test/auth.test.js` → "[F2-R21] createSessionStore carga desde fichero existente; roto → cero sesiones y console.error" |
| R22 | `panel/test/auth-api.test.js` → "[F2-R22] status con cookie válida / sin cookie / alterada → authenticated true/false/false, configured true, sin renovar" |
| R23 | `panel/test/auth-api.test.js` → "[F2-R23] 5 fallos → el login correcto responde 429 con cuerpo, Retry-After y sin sesión"; `panel/test/rate-limit.test.js` → "[F2-R23] createRateLimiter: 4 fallos no bloquean; el quinto bloquea…" y "[F2-R23] fallos separados más de 15 minutos no se acumulan" |
| R24 | `panel/test/auth-api.test.js` → "[F2-R24] a los 15 min + 1 s del bloqueo el login correcto responde 200; 4 fallos + éxito + 4 fallos nunca dan 429"; `panel/test/rate-limit.test.js` → los dos tests "[F2-R24] …" |
| R25 | `panel/test/auth-api.test.js` → "[F2-R25] con proxy de confianza cada CF-Connecting-IP tiene su propio contador"; `panel/test/rate-limit.test.js` → "[F2-R25] getClientIp usa CF-Connecting-IP solo con trustProxy…" |
| R26 | `panel/test/auth-api.test.js` → "[F2-R26] mutaciones sin X-Requested-With → 403 antes de la sesión, sin efectos ni fallo contado" |
| R27 | `panel/test/auth-api.test.js` → "[F2-R27] change-password → 204, revoca las otras sesiones, conserva la actual y el sessionSecret, cambia salt y hash"; `panel/test/auth.test.js` → "[F2-R20][F2-R27] destroy elimina una sesión y destroyOthers conserva solo la indicada" |
| R28 | `panel/test/auth-api.test.js` → "[F2-R28] currentPassword incorrecta → 403 con field, auth.json intacto y cuenta para el 429" (incluye: con la IP bloqueada, change-password responde 429 con `Retry-After`) |
| R29 | `panel/test/auth-api.test.js` → "[F2-R29] newPassword ausente, no cadena o fuera de 10–128 → 400 con field newPassword sin modificar auth.json"; `panel/test/auth.test.js` → "[F2-R3][F2-R29] validatePassword…" |
| R30 | `panel/test/config.test.js` → "[F2-R30] reset-password.js borra auth.json y sessions.json y lo anuncia (código 0)", "[F2-R30] reset-password.js sin ficheros imprime "No había contraseña configurada."…" y "[F2-R30] package.json declara el script reset-password" |
| R31 | `panel/test/config.test.js` → "[F2-R31] readConfig con env vacío…", "[F2-R31] readConfig con las cuatro variables definidas…" y "[F2-R31] readConfig con PORT inválido…" |
| R32 | `panel/test/config.test.js` → "[F2-R32] buildStartupLines con contraseña configurada y URL pública" y "[F2-R32] buildStartupLines sin contraseña y sin URL pública"; `npm start`: comprobado a mano por el implementer en Linux (imprime directorio de datos y estado de la contraseña); **MANUAL — pendiente del humano** en Windows |
| R33 | `panel/test/auth-api.test.js` → "[F2-R33] los ocho estáticos son públicos sin sesión y el servidor escucha en 0.0.0.0" |
| R34 | `panel/test/tunnel.test.js` → "[F2-R34] parsePublicUrl…", "[F2-R34] readPublicUrl…" y "[F2-R34] GET /api/auth/status devuelve publicUrl según public-url.txt…" |
| R35 | `panel/test/tunnel.test.js` → "[F2-R35] extractTunnelUrl con la línea real de cloudflared, una sin URL y una con http://localhost" |
| R36 | `panel/test/tunnel.test.js` → "[F2-R36] runTunnel escribe public-url.txt al ver la URL, anexa a cloudflared.log, vacía el fichero en exit y resuelve con el código", "[F2-R36] runTunnel con exit code 3 resuelve 3; con evento error… resuelve 1" y "[F2-R36] scripts/run-tunnel.js existe y usa CLOUDFLARED_BIN, readConfig y runTunnel" |
| R37 | `panel/test/render.test.js` → "[F2-R37] resolveAuthView → setup / login / panel", "[F2-R37] renderAuthForm("setup")…", "[F2-R37] renderAuthForm("login")…"; `panel/test/styles.test.js` → "[F2-R37] index.html tiene #auth-view, #change-password-view, #session-actions y los botones Salir / Cambiar contraseña"; flujo completo: **MANUAL — pendiente del humano** |
| R38 | `panel/test/render.test.js` → "[F2-R38] validateNewPassword: corta, distinta y válida" y "[F2-R38][F2-R40] renderAuthError devuelve el mensaje escapado con role="alert"" |
| R39 | `panel/test/render.test.js` → los cuatro tests "[F2-R39] createApiClient / 401 …" |
| R40 | `panel/test/render.test.js` → "[F2-R38][F2-R40] renderAuthError…"; `panel/test/styles.test.js` → "[F2-R40] el pie de index.html ya no habla de "sin autenticación""; flujo con contraseña correcta/incorrecta: **MANUAL — pendiente del humano** |
| R41 | `panel/test/render.test.js` → "[F2-R41] renderChangePasswordForm…", "[F2-R41] buildChangePasswordPayload omite confirm" y "[F2-R41] handleLogout llama a POST /api/auth/logout y devuelve true"; flujo: **MANUAL — pendiente del humano** |
| R42 | `panel/test/render.test.js` → "[F2-R42] renderPublicUrl con URL → enlace escapado; con null → cadena vacía"; `panel/test/styles.test.js` → "[F2-R42] index.html tiene el hueco #public-url en el encabezado"; desde el móvil en la LAN: **MANUAL — pendiente del humano** |
| R43 | `panel/test/styles.test.js` → "[F2-R43] .auth-card ocupa el ancho completo con inputs al 100 %, max-width en rem y botones .btn en el encabezado" (+ "[R36] ningún width/min-width en píxeles supera 360" y "[R36] botones con área táctil mínima de 44 px" siguen en verde); 360×640: **MANUAL — pendiente del humano** |
| R44 | `panel/test/deploy.test.js` → "[F2-R44] cloudflared-config.example.yml tiene tunnel, credentials-file, ingress con hostname → http://localhost:4310 y http_status:404" |
| R45 | `panel/test/deploy.test.js` → "[F2-R45] docs/acceso-web.md tiene la estructura exigida y la opción avanzada al final" |
| R46 | `panel/test/deploy.test.js` → "[F2-R46] install-service.ps1 registra dos tareas S4U…" y "[F2-R46] uninstall-service.ps1 elimina las dos tareas con Unregister-ScheduledTask" |
| R47 | **MANUAL — Windows — pendiente del humano** (T30): `install-service.ps1` como administrador, reiniciar sin iniciar sesión, `http://localhost:4310` responde, `Get-ScheduledTask -TaskName PuestoDeMandoMUVER` en `Ready`/`Running`, `panel\data\panel.log` con las líneas de arranque. Resultado: _(anotar fecha y resultado)_ |
| R48 | **MANUAL — Windows — pendiente del humano** (T30): `uninstall-service.ps1`, `Get-ScheduledTask` ya no lista las tareas, tras reiniciar nada escucha en 4310. Resultado: _(anotar)_ |
| R49 | **MANUAL — Windows — pendiente del humano** (T30): tras reiniciar, `panel\data\public-url.txt` con `https://….trycloudflare.com` en menos de 60 s y la misma URL en el encabezado del panel desde el móvil en la LAN. Resultado: _(anotar)_ |
| R50 | **MANUAL — Internet — pendiente del humano** (T31): URL pública desde el móvil con datos → login, listado; cookie con `Secure` en DevTools de escritorio; `http://<ip-lan>:4310` sigue funcionando con su propia sesión. Resultado: _(anotar)_ |

## Mapa de trazabilidad — Feature 3: `puesto-de-mando-descubrimiento-claude` (prefijo `[F3-R<n>]`)

> Ficheros nuevos: `panel/test/claude-fixtures.js` (fixtures en temporales; nunca el `~/.claude` real), `path-key.test.js`, `claude-discovery.test.js`, `project-catalog.test.js`, `claude-api.test.js`; ampliados: `helpers.js` (`startApp` con `claudeHome` temporal vacío por defecto y `claudeCacheTtlMs: 0`; cabecera anti-CSRF en toda mutación), `registry.test.js`, `config.test.js`, `render.test.js`, `styles.test.js`, `deploy.test.js`, `api.test.js` (orden del listado tras un alta).

| Requisito | Test que lo cubre |
|-----------|-------------------|
| R1 | `panel/test/config.test.js` → "[F3-R1] readConfig → claudeHome…" |
| R2 | `panel/test/claude-api.test.js` → "[F3-R2] sin Claude: solo los proyectos de projects.json…"; `panel/test/claude-discovery.test.js` → "[F3-R2][F3-R4] sin .claude.json ni .claude/projects…" |
| R3 | `panel/test/claude-api.test.js` → "[F3-R3] GET /api/claude/status disponible…"; `panel/test/claude-discovery.test.js` → "[F3-R21] dos scan() concurrentes comparten el mismo escaneo; status()…" |
| R4 | `panel/test/claude-api.test.js` → "[F3-R4] GET /api/claude/status sin Claude…"; `panel/test/claude-discovery.test.js` → "[F3-R2][F3-R4] sin .claude.json…", "[F3-R4] constantes y resolveClaudePaths…" |
| R5 | `panel/test/claude-discovery.test.js` → "[F3-R5] .claude.json roto…", "[F3-R5] readClaudeConfig…" |
| R6 | `panel/test/claude-api.test.js` → "[F3-R6] sin cookie → 401…" |
| R7 | `panel/test/claude-discovery.test.js` → "[F3-R7] solo subcarpetas directas…", "[F3-R7][F3-R8][F3-R9][F3-R10] fixture base completo…" |
| R8 | `panel/test/claude-discovery.test.js` → "[F3-R8] path = primer cwd…", "[F3-R7][F3-R8][F3-R9][F3-R10] fixture base completo…" |
| R9 | `panel/test/claude-discovery.test.js` → "[F3-R9] carpeta sin cwd casada con la clave Windows…", "[F3-R9] comparación laxa…"; `panel/test/path-key.test.js` → "[F3-R9] encodeProjectPath…", "[F3-R9] looseEncodedKey…"; datos reales: **MANUAL — Windows — pendiente del humano** (T27) |
| R10 | `panel/test/claude-discovery.test.js` → "[F3-R10] carpeta sin cwd ni clave…"; `panel/test/claude-api.test.js` → "[F3-R10] proyecto no resuelto en el listado…" |
| R11 | `panel/test/claude-discovery.test.js` → "[F3-R11] clave de configuración sin carpeta…" |
| R12 | `panel/test/claude-discovery.test.js` → "[F3-R12] la misma ruta como clave y como carpeta…" |
| R13 | `panel/test/claude-discovery.test.js` → "[F3-R13] lastPrompt…"; datos reales: **MANUAL — Windows — pendiente del humano** (T27) |
| R14 | `panel/test/claude-discovery.test.js` → "[F3-R14] campos de la sesión…" |
| R15 | `panel/test/claude-discovery.test.js` → "[F3-R15] título = summary…" |
| R16 | `panel/test/claude-discovery.test.js` → "[F3-R16] título por primer user…", "[F3-R16] clipTitle y extractText…" |
| R17 | `panel/test/claude-discovery.test.js` → "[F3-R17] líneas corruptas ignoradas…" |
| R18 | `panel/test/claude-discovery.test.js` → "[F3-R18] fichero grande…" |
| R19 | `panel/test/claude-discovery.test.js` → "[F3-R19] sesiones ordenadas por lastActivityAt desc…" |
| R20 | `panel/test/claude-discovery.test.js` → "[F3-R20] caché por (ruta, mtime, tamaño)…" |
| R21 | `panel/test/claude-discovery.test.js` → "[F3-R21] TTL de 30 s…", "[F3-R21] dos scan() concurrentes…" |
| R22 | `panel/test/claude-discovery.test.js` → "[F3-R22] el fuente de claude-discovery.js no contiene llamadas de escritura…", "[F3-R22] tras un escaneo completo el árbol de claudeHome es idéntico…" |
| R23 | `panel/test/path-key.test.js` → "[F3-R23] pathKey: los cuatro pares…", "[F3-R23] pathKey: valores no válidos…", "[F3-R23] isWindowsPath…" |
| R24 | `panel/test/project-catalog.test.js` → "[F3-R24] mergeProjects: misma clave de ruta Windows…", "[F3-R24][F3-R31] toSummary…"; datos reales: **MANUAL — Windows — pendiente del humano** (T27) |
| R25 | `panel/test/project-catalog.test.js` → "[F3-R25] mergeProjects: entrada sin coincidencia…", "[F3-R25][F3-R29] projectActivity…"; `panel/test/claude-api.test.js` → "[F3-R25] lastActivityAt de un manual…" |
| R26 | `panel/test/project-catalog.test.js` → "[F3-R26] mergeProjects: descubierto sin ajustes…"; `panel/test/path-key.test.js` → "[F3-R26] lastSegment…" |
| R27 | `panel/test/project-catalog.test.js` → "[F3-R27] assignIds: colisiones…", "[F3-R27] assignIds: nombre sin caracteres válidos…" |
| R28 | `panel/test/claude-api.test.js` → "[F3-R28] campos nuevos presentes y sin path…" |
| R29 | `panel/test/project-catalog.test.js` → "[F3-R29] sortCatalog…", "[F3-R25][F3-R29] projectActivity…"; `panel/test/claude-api.test.js` → "[F3-R29] orden del catálogo con fixtures…" |
| R30 | `panel/test/claude-api.test.js` → "[F3-R30] includeHidden…" |
| R31 | `panel/test/claude-api.test.js` → "[F3-R31] detalle: 22 sesiones → 20…"; `panel/test/project-catalog.test.js` → "[F3-R24][F3-R31] toSummary…" |
| R32 | `panel/test/registry.test.js` → "[F3-R32] normalizeSettings y loadRegistry…", "[F3-R32] saveRegistry tras upsertSettings…" |
| R33 | `panel/test/claude-api.test.js` → "[F3-R33] projects.json real copiado sin Claude…" |
| R34 | `panel/test/claude-api.test.js` → "[F3-R34] PATCH sobre un proyecto both…"; `panel/test/registry.test.js` → "[F3-R34] upsertSettings…", "[F3-R34] validatePatch acepta…" |
| R35 | `panel/test/claude-api.test.js` → "[F3-R35] PATCH sobre un proyecto solo de Claude…"; datos reales: **MANUAL — Windows — pendiente del humano** (T27) |
| R36 | `panel/test/claude-api.test.js` → "[F3-R36] PATCH con cuerpos inválidos…"; `panel/test/registry.test.js` → "[F3-R36] validatePatch rechaza…" |
| R37 | `panel/test/claude-api.test.js` → "[F3-R37] PATCH a id inexistente…" |
| R38 | `panel/test/claude-api.test.js` → "[F3-R38] anti-CSRF en toda mutación…" |
| R39 | `panel/test/claude-api.test.js` → "[F3-R39] DELETE: claude → 409…" |
| R40 | `panel/test/claude-api.test.js` → "[F3-R40] POST con la ruta de un proyecto de Claude…" |
| R41 | `panel/test/render.test.js` → "[F3-R41] renderProjectCard: badge "Claude Code"…"; flujo en navegador: ver fila T23/T27 |
| R42 | `panel/test/render.test.js` → "[F3-R42] renderProjectCard: fijar/ocultar…"; flujo en navegador: ver fila T23/T27 |
| R43 | `panel/test/render.test.js` → "[F3-R43] renderHiddenToggle…" |
| R44 | `panel/test/render.test.js` → "[F3-R44] renderClaudeNotice…" |
| R45 | `panel/test/render.test.js` → "[F3-R45] renderProjectDetail: sesiones de Claude Code…"; ver fila T23/T27 |
| R46 | `panel/test/render.test.js` → "[F3-R46] renderSettingsForm…"; ver fila T23/T27 |
| R47 | `panel/test/render.test.js` → "[F3-R47] buildSettingsPayload…" |
| R48 | `panel/test/render.test.js` → "[F3-R48] patchProject / togglePin / toggleHidden…" |
| R49 | `panel/test/render.test.js` → "[F3-R49] buildProjectsUrl y splitHidden…" |
| R50 | `panel/test/render.test.js` → "[F3-R50] relativeTime…" |
| R51 | `panel/test/styles.test.js` → "[F3-R51] index.html: #claude-notice…", "[F3-R51] styles.css define…" |
| R52 | `panel/test/config.test.js` → "[F3-R52] buildStartupLines…" |
| R53 | `panel/test/deploy.test.js` → "[F3-R53] docs/architecture.md documenta la fase 3…" |
| T23 (UI) | Comprobación automatizada en Linux por el implementer con Chromium headless (Playwright) a 360×640 en tema claro y oscuro sobre fixtures: sin scroll horizontal, badge y línea de sesión, fijar reordena, "Mostrar ocultos (1)" / "Ocultar ocultos", formulario de ajustes → "Ajustes guardados", sin errores de consola. |
| T27 | **MANUAL — Windows — pendiente del humano**: arrancar el panel en el PC con Claude Code; comprobar que aparecen solos los proyectos abiertos en Claude Code, que las sesiones recientes y sus títulos son reconocibles, que la línea de arranque dice `Claude Code: detectado en C:\Users\…`, poner las rutas reales de los 4 proyectos iniciales en `projects.json` (o fijarlas con el formulario de ajustes) y verificar que se fusionan como un único proyecto con distintivo "Claude Code" (`both`). Confirmar además los supuestos de design.md §9 (orden de `history` y codificación de carpetas). Resultado: _(anotar fecha y resultado)_ |

## Mapa de trazabilidad — Feature 4: `puesto-de-mando-trabajar` (prefijo `[F4-R<n>]`)

> Tests en `panel/test/` (todos con `node --test`, sin dependencias). Los de procesos reales (cancelación con nieto,
> timeout, cierre del servidor, SSE con `[[hang]]`) se saltan en Windows y allí se cubren con R97. Los de git se
> saltan si no hay `git`. Cambios declarados en tests de fases anteriores (design.md §8.4 y desviaciones del
> implementer): `git-info.test.js` (`--no-optional-locks` en `GIT_COMMANDS` y el runner espía), `config.test.js`
> (`readConfig` incluye los campos nuevos), `registry.test.js` (`PATCHABLE_FIELDS` ampliado) y
> `auth-api.test.js` (la sesión del login lleva `reauthAt`).

> **Corrección T36 (prueba manual con Claude Code 2.1.307 en Windows):** stdin para el prompt, `succeeded` con
> denegaciones, texto de hasta 20 000 caracteres, reglas y denegaciones de `PowerShell` (escenario `denied_powershell`
> del CLI falso) y registro vivo en `<datos>/projects.json` (tests de `prepareProjectsFile` en `registry.test.js`).
> Además (corrección T36): la IP del límite de intentos es la real (cabeceras del proxy solo desde loopback; tests
> `[F4-R68]` de `rate-limit.test.js` y `reauth-api.test.js`, este último desde una interfaz no loopback del equipo) y
> el mapa del limitador está acotado. Desviaciones en tests de fase 2: `[F2-R25]` y `[F2-R14][F2-R15]` construyen la
> petición desde `127.0.0.1` para seguir probando las cabeceras. Ningún test lee ya datos locales del humano:
> `[F3-R33]` y `[F2-R34]` usan `panel/projects.example.json` (antes `panel/projects.json`). En Windows solo se omite
> `[F4-R33]` (comprueba solo la muerte del árbol de procesos: R97) y `[F4-R51]` si no se encuentra Git Bash; los
> demás tests con `[[hang]]` se ejecutan allí y solo saltan su aserción de procesos vivos.

| Requisito | Test(s) que lo verifican |
|-----------|---------------------------|
| R1 | `panel/test/config.test.js` → "[F4-R1] readConfig: valores por defecto de la fase 4 con env vacío", "[F4-R1] readConfig: cada variable nueva válida", "[F4-R1] readConfig: valores fuera de rango vuelven al defecto y PANEL_ALLOW_EXEC 0/false…" |
| R2 | `panel/test/config.test.js` → "[F4-R2] readConfig: cfAccess válido, incompleto y con equipo no válido"; `panel/test/reauth-api.test.js` → "[F4-R2] cfAccess con error: todo por el túnel → 403 "Access mal configurado"; la red loc…" |
| R3 | `panel/test/config.test.js` → "[F4-R3] buildStartupLines con work: activada + Access, desactivada + sin Access, Access …" |
| R4 | `panel/test/work-api.test.js` → "[F4-R4] GET /api/work/status: valores por defecto, allowExec false, por el túnel y con u…" |
| R5 | `panel/test/work-api.test.js` → "[F4-R5][F4-R63] allowExec false: las ocho acciones de ejecución → 403 sin procesos ni fi…" |
| R6 | `panel/test/work-api.test.js` → "[F4-R6] GET /api/projects/:id/work: con arnés, git, init.sh y allowedCommands; sin nada;…" |
| R7 | `panel/test/claude-cli.test.js` → "[F4-R7] constantes: CLI_FLAGS, herramientas por defecto, prompts SDD y máximo del prompt", "[F4-R7] buildClaudeArgs en modo new: array exacto, --allowedTools al final y sin el prom…" |
| R8 | `panel/test/claude-cli.test.js` → "[F4-R8] buildClaudeArgs: --continue y --resume <id> antes de --allowedTools (la opción v…" |
| R9 | `panel/test/claude-cli.test.js` → "[F4-R9] ningún modo incluye argumentos prohibidos, ni con un prompt igual a uno de ellos", "[F4-R9] estático: el fuente de lib/claude-cli.js solo nombra los argumentos prohibidos e…" |
| R10 | `panel/test/claude-cli.test.js` → "[F4-R10] buildAllowedTools: [], dos comandos y duplicado de una regla por defecto", "[F4-R10][F4-R62] isValidAllowedCommand", "[F4-R10] corrección T36: cada comando autorizado (y git status/diff/log) se emite como r…" |
| R11 | `panel/test/claude-cli.test.js` → "[F4-R11] un prompt que empieza por "-" no puede leerse como opción: nunca va en argv (se…"; `panel/test/runs-api.test.js` → "[F4-R11] un prompt que empieza por "-" llega por stdin tal cual y no se interpreta como …" |
| R12 | `panel/test/claude-cli.test.js` → "[F4-R12] resolveClaudeCommand: .js/.mjs/.cjs → node + fichero; Linux → tal cual; ruta ab…", "[F4-R12] resolveClaudeCommand en Windows: claude.exe en PATH, instalador nativo, npm glo…" |
| R13 | `panel/test/claude-cli.test.js` → "[F4-R13] escenario ok → session, text, tool, tool, text y result en orden exacto", "[F4-R14][F4-R13] corrección T36: texto del asistente y del result hasta 20000 caracteres…"; `panel/test/runs-api.test.js` → "[F4-R13][F4-R14] corrección T36: un resumen final de ~2500 caracteres llega entero en el…" |
| R14 | `panel/test/claude-cli.test.js` → "[F4-R14] result con is_error, texto de 3000 caracteres (ya no se corta) y campos ausentes", "[F4-R14][F4-R13] corrección T36: texto del asistente y del result hasta 20000 caracteres…", "[F4-R14][F4-R24] dos denegaciones en result, una ya emitida como system/permission_denie…", "[F4-R14] denegación con toolName/input alternativos, detalle por defecto y recorte a 200"; `panel/test/runs-api.test.js` → "[F4-R13][F4-R14] corrección T36: un resumen final de ~2500 caracteres llega entero en el…" |
| R15 | `panel/test/claude-cli.test.js` → "[F4-R15] tool_result de error (1000 caracteres), api_retry, línea no JSON y tipos descon…" |
| R16 | `panel/test/claude-cli.test.js` → "[F4-R16] summarizeToolInput con cada herramienta, rutas fuera, rutas Windows y recorte a…" |
| R17 | `panel/test/runs-api.test.js` → "[F4-R17][F4-R23][F4-R34][F4-R38] POST /runs con el escenario ok: 202, argumentos, cwd, e…", "[F4-R17] estático: runs.js lanza sin shell, prompt por stdin, windowsHide y grupo de pro…" |
| R18 | `panel/test/runs-api.test.js` → "[F4-R18] prompt ausente, no cadena, vacío o de más de 20000 caracteres → 400 sin proceso…" |
| R19 | `panel/test/runs-api.test.js` → "[F4-R19] proyecto inexistente → 404; manual con ruta inexistente y de Claude no resuelto…" |
| R20 | `panel/test/runs-api.test.js` → "[F4-R20][F4-R26] un run activo bloquea otro chat y los tests (409 con runId); cancelar m…" |
| R21 | `panel/test/runs-api.test.js` → "[F4-R21] con maxRuns 1 un run en A hace que B responda 429; tras cancelar A, B → 202" |
| R22 | `panel/test/runs-api.test.js` → "[F4-R22] sesión new/continue/resume: válida e inválida" |
| R23 | `panel/test/runs-api.test.js` → "[F4-R17][F4-R23][F4-R34][F4-R38] POST /runs con el escenario ok: 202, argumentos, cwd, e…" |
| R24 | `panel/test/claude-cli.test.js` → "[F4-R14][F4-R24] dos denegaciones en result, una ya emitida como system/permission_denie…", "[F4-R24][F4-R65] denegación real con tool_input vacío: el detalle sale del texto "requir…", "[F4-R24] denegación con tool_input.command: se usa ese comando; sin comando ni texto: de…", "[F4-R24][F4-R65] corrección T36: una denegación de PowerShell se trata como la de Bash (…"; `panel/test/runs-api.test.js` → "[F4-R24] corrección T36: denegación con result de éxito → succeeded con permissionDenial…", "[F4-R24][F4-R65] corrección T36: salida real (tool_input vacío) → succeeded y detalle de…", "[F4-R24][F4-R65] corrección T36: denegación real de PowerShell → succeeded con "node" co…" |
| R25 | `panel/test/runs-api.test.js` → "[F4-R25] escenarios error y crash → failed; ejecutable inexistente → failed con evento e…" |
| R26 | `panel/test/runs-api.test.js` → "[F4-R20][F4-R26] un run activo bloquea otro chat y los tests (409 con runId); cancelar m…" |
| R27 | `panel/test/runs-api.test.js` → "[F4-R27] cancelar un run terminado → 409; id bien formado inexistente o mal formado → 404" |
| R28 | `panel/test/exec-utils.test.js` → "[F4-R28] killProcessTree en Windows: taskkill /PID <pid> /T /F sin shell", "[F4-R28] killProcessTree en Linux: SIGTERM al grupo y SIGKILL a los 5 s si sigue vivo", "[F4-R28] killProcessTree en Linux: si el hijo ya salió no hay SIGKILL; ESRCH no lanza" |
| R29 | `panel/test/runs-api.test.js` → "[F4-R29] runTimeoutMs 300 con hang → timeout y aviso de límite de tiempo" |
| R30 | `panel/test/runs-api.test.js` → "[F4-R30] outputLimitBytes 10000 con big: un único aviso, .jsonl acotado, truncated y suc…" |
| R31 | `panel/test/exec-utils.test.js` → "[F4-R31] createLineSplitter: línea de 250 bytes en tres trozos con máximo 100 → descarta…", "[F4-R31] createLineSplitter: UTF-8 partido entre trozos y línea larga completa en un sol…" |
| R32 | `panel/test/run-store.test.js` → "[F4-R32] recoverOrphans marca queued/running como failed con endedAt = ahora"; `panel/test/runs-api.test.js` → "[F4-R32] al arrancar, un run running del índice pasa a failed "Interrumpida al reiniciar…" |
| R33 | `panel/test/runs-api.test.js` → "[F4-R33] al cerrar el servidor se cancelan los runs activos y mueren sus procesos" |
| R34 | `panel/test/run-store.test.js` → "[F4-R34] newRunId cumple RUN_ID_RE y no se repite", "[F4-R34] create + appendEvent + updateMeta + readEvents sobre un directorio temporal"; `panel/test/runs-api.test.js` → "[F4-R17][F4-R23][F4-R34][F4-R38] POST /runs con el escenario ok: 202, argumentos, cwd, e…" |
| R35 | `panel/test/run-store.test.js` → "[F4-R35] list con 60 metas devuelve 50, la más reciente primero"; `panel/test/runs-api.test.js` → "[F4-R35][F4-R36] historial con dos terminados y uno activo; GET /api/runs/:runId termina…" |
| R36 | `panel/test/run-store.test.js` → "[F4-R36] find con id válido, inexistente y con formato inválido"; `panel/test/runs-api.test.js` → "[F4-R35][F4-R36] historial con dos terminados y uno activo; GET /api/runs/:runId termina…" |
| R37 | `panel/test/run-store.test.js` → "[F4-R37] rotate con keepRuns: 3 y 5 runs → 3 en el índice y sus 3 .jsonl; nunca borra un…" |
| R38 | `panel/test/runs-api.test.js` → "[F4-R17][F4-R23][F4-R34][F4-R38] POST /runs con el escenario ok: 202, argumentos, cwd, e…" |
| R39 | `panel/test/runs-api.test.js` → "[F4-R39][F4-R43] SSE durante un run: cabeceras, retry, eventos ya producidos, eventos nu…" |
| R40 | `panel/test/runs-api.test.js` → "[F4-R40][F4-R41] SSE de un run terminado con Last-Event-ID: 3 empieza en 4 y se cierra t…" |
| R41 | `panel/test/runs-api.test.js` → "[F4-R40][F4-R41] SSE de un run terminado con Last-Event-ID: 3 empieza en 4 y se cierra t…" |
| R42 | `panel/test/runs-api.test.js` → "[F4-R42] SSE sin sesión → 401 y con id inexistente → 404 JSON" |
| R43 | `panel/test/runs-api.test.js` → "[F4-R39][F4-R43] SSE durante un run: cabeceras, retry, eventos ya producidos, eventos nu…" |
| R44 | `panel/test/sdd-actions.test.js` → "[F4-R44] implement lanza "implementa la siguiente tarea pendiente" en modo new con actio…" |
| R45 | `panel/test/sdd-actions.test.js` → "[F4-R45] approve-tests lanza "tests aprobados, lanza al reviewer" con --continue; con se…" |
| R46 | `panel/test/sdd-actions.test.js` → "[F4-R46] botones SDD sin arnés (sin feature_list.json o roto) → 409 sin proceso ni fiche…" |
| R47 | `panel/test/sdd-actions.test.js` → "[F4-R47] setFeatureStatus con 2 espacios: solo cambia el valor", "[F4-R47] setFeatureStatus con BOM y \\r\\n conserva todos los bytes salvo el valor", "[F4-R47] status antes y después de objetos anidados, clave duplicada y features con elem…", "[F4-R47] approve-spec cambia solo el status (bytes idénticos salvo el valor), sin .tmp y…" |
| R48 | `panel/test/sdd-actions.test.js` → "[F4-R48] approve-spec: featureId ausente o de tipo no válido → 400; no spec_ready, inexi…" |
| R49 | `panel/test/sdd-actions.test.js` → "[F4-R49] un escáner defectuoso (locateFn) produce el error de verificación y no devuelve…" |
| R50 | `panel/test/exec-utils.test.js` → "[F4-R50] stripAnsi elimina colores y secuencias OSC"; `panel/test/work-api.test.js` → "[F4-R50] POST /tests con testCommand ok: run command/tests, salida stdout y stderr sin A…", "[F4-R50] POST /tests con fail 3 → failed con exitCode 3" |
| R51 | `panel/test/work-api.test.js` → "[F4-R51] sin testCommand usa bash init.sh; sin ninguno → 409" |
| R52 | `panel/test/exec-utils.test.js` → "[F4-R52] findGitBash prueba en orden y descarta System32/Sysnative" |
| R53 | `panel/test/exec-utils.test.js` → "[F4-R53] parseCommandLine: casos válidos", "[F4-R53] parseCommandLine: cada error", "[F4-R53] formatCommandLine entrecomilla los argumentos con espacios, vacíos o comillas" |
| R54 | `panel/test/exec-utils.test.js` → "[F4-R54] resolveExecutable en Windows: node, npm, npx, bash, git (.exe) y yarn (solo .cm…", "[F4-R54] resolveExecutable en Windows: .com antes que .exe, npm sin npm-cli.js y bash si…", "[F4-R54] resolveExecutable fuera de Windows: bash → bashBin o bash, .js → node, resto ta…" |
| R55 | `panel/test/git-actions.test.js` → "[F4-R55] parsePorcelainZ: modificado, nuevo, renombrado (salta el origen) y nombres con …"; `panel/test/work-api.test.js` → "[F4-R55] GET /changes: modificado, sin seguimiento, renombrado y nombre con espacios y a…"; `panel/test/work-render.test.js` → "[F4-R55] renderChanges lista los ficheros con su estado y botón de diff" |
| R56 | `panel/test/work-api.test.js` → "[F4-R56] GET /changes/diff: modificado (-antes/+después), sin seguimiento y 300 KB recor…" |
| R57 | `panel/test/git-actions.test.js` → "[F4-R57] getFileDiff con un fichero que no está en la lista no ejecuta git diff"; `panel/test/work-api.test.js` → "[F4-R57] diff de un fichero no listado (../secreto.txt, sin cambios, sin parámetro) → 40…" |
| R58 | `panel/test/git-actions.test.js` → "[F4-R58] planCommitPush sin upstream → push -u origin <rama>"; `panel/test/work-api.test.js` → "[F4-R58] commit-push con upstream: add, commit y push al remoto --bare con el mensaje ex…", "[F4-R58] commit-push sin upstream → push -u origin main; remoto inexistente → failed tra…" |
| R59 | `panel/test/git-actions.test.js` → "[F4-R59] planCommitPush: mensaje vacío, largo o con NUL; sin cambios; HEAD separado o ra…"; `panel/test/work-api.test.js` → "[F4-R59] commit-push: mensaje inválido → 400; sin cambios → 409; HEAD separado → 409; si…" |
| R60 | `panel/test/git-actions.test.js` → "[F4-R60] planCommitPush: el mensaje "--amend; rm -rf /" llega intacto como un único argu…", "[F4-R60] estático: git-actions.js solo usa argumentos fijos, sin forzar nunca el push"; `panel/test/work-api.test.js` → "[F4-R60] commit-push: un mensaje "--amend; rm -rf /" llega como un único argumento (git …" |
| R61 | `panel/test/git-info.test.js` → "[R12][F4-R61] GIT_COMMANDS es la lista cerrada documentada en design.md (status con --no…", "[F4-R61] getGitInfo ejecuta git --no-optional-locks status --porcelain y nunca status si…" |
| R62 | `panel/test/claude-cli.test.js` → "[F4-R10][F4-R62] isValidAllowedCommand"; `panel/test/registry.test.js` → "[F4-R62] validatePatch: allowedCommands válidos (recorte, colapso de espacios, sin dupli…", "[F4-R62] validatePatch: allowedCommands y testCommand inválidos con field y texto de des…", "[F4-R62] normalizeSettings conserva allowedCommands/testCommand válidos y execSettingsOf…"; `panel/test/work-api.test.js` → "[F4-R62][F4-R63] PATCH con allowedCommands/testCommand: válidos se guardan, inválidos 40…" |
| R63 | `panel/test/work-api.test.js` → "[F4-R5][F4-R63] allowExec false: las ocho acciones de ejecución → 403 sin procesos ni fi…", "[F4-R62][F4-R63] PATCH con allowedCommands/testCommand: válidos se guardan, inválidos 40…" |
| R64 | `panel/test/work-api.test.js` → "[F4-R64] POST /permissions: añade sin duplicar, crea la entrada de un proyecto solo de C…" |
| R65 | `panel/test/claude-cli.test.js` → "[F4-R65] suggestAllowedCommand", "[F4-R65] la denegación de una herramienta distinta de Bash no propone comando", "[F4-R24][F4-R65] denegación real con tool_input vacío: el detalle sale del texto "requir…", "[F4-R65] suggestAllowedCommands: comando base de cada parte, validado con ALLOWED_COMMAN…", "[F4-R24][F4-R65] corrección T36: una denegación de PowerShell se trata como la de Bash (…"; `panel/test/runs-api.test.js` → "[F4-R24][F4-R65] corrección T36: salida real (tool_input vacío) → succeeded y detalle de…", "[F4-R24][F4-R65] corrección T36: denegación real de PowerShell → succeeded con "node" co…" |
| R66 | `panel/test/registry.test.js` → "[F4-R66] isHttpUrl y validatePatch con URLs que no son http(s)", "[F4-R66] validateNewProject rechaza appUrl/repoUrl que no son http(s) y acepta vacías o …"; `panel/test/work-api.test.js` → "[F4-R66] POST /api/projects y PATCH con appUrl/repoUrl que no son http(s) → 400 con fiel…" |
| R67 | `panel/test/reauth-api.test.js` → "[F4-R67] reauth.js: TTL de 15 minutos, petición por el túnel y confirmación reciente", "[F4-R67] por el túnel sin confirmación reciente (16 min) → 401 reauthRequired sin proces…" |
| R68 | `panel/test/auth.test.js` → "[F4-R68] createSessionStore: create({ reauthAt }), markReauth, persistencia y carga de r…"; `panel/test/rate-limit.test.js` → "[F4-R68] corrección T36: las cabeceras del proxy solo cuentan desde loopback (cloudflare…", "[F4-R68] corrección T36: el mapa del limitador está acotado (tope y limpieza de caducadas)"; `panel/test/reauth-api.test.js` → "[F4-R68] POST /api/auth/reauth correcto → 204, reauthAt en sessions.json y la acción pas…", "[F4-R68] reauth incorrecto → 401 "Contraseña incorrecta" (sin reauthRequired); al sexto …", "[F4-R68] corrección T36: desde una IP no loopback, cambiar CF-Connecting-IP en cada inte…", "[F4-R68] corrección T36: desde loopback (cloudflared) se usa CF-Connecting-IP para el lí…" |
| R69 | `panel/test/reauth-api.test.js` → "[F4-R69] login fija reauthAt: acción por el túnel inmediata → 202; a los 16 minutos → 401", "[F4-R69] setup (crear contraseña) también fija reauthAt" |
| R70 | `panel/test/reauth-api.test.js` → "[F4-R70] desde la red local basta la sesión: 2 horas después del login → 202" |
| R71 | `panel/test/cf-access.test.js` → "[F4-R71] con Access configurado: estáticos y /api/auth/status por el túnel sin token o c…" |
| R72 | `panel/test/cf-access.test.js` → "[F4-R72] accessIssuer, accessCertsUrl y decodeJwt", "[F4-R72] token válido aceptado (aud cadena o array) y cada motivo de rechazo" |
| R73 | `panel/test/cf-access.test.js` → "[F4-R73] caché de claves de 1 h, recarga por kid desconocido como mucho una vez por minu…", "[F4-R73] rotación de claves: un kid nuevo publicado se acepta tras recargar" |
| R74 | `panel/test/reauth-api.test.js` → "[F4-R74] con Access configurado y token válido no se pide confirmación (1 h después); si…" |
| R75 | `panel/test/audit.test.js` → "[F4-R75] createAuditLog escribe una línea JSON por entrada con "at" primero y clipPrompt…", "[F4-R75][F4-R77] run aceptado, 409 y 401 por confirmación: líneas con sus campos y run.e…" |
| R76 | `panel/test/audit.test.js` → "[F4-R76] audit.log no contiene la contraseña, el token de sesión, el JWT de Access ni el…" |
| R77 | `panel/test/audit.test.js` → "[F4-R77] createAuditLog rota a audit.log.1 al superar maxBytes (sustituyendo la copia an…", "[F4-R75][F4-R77] run aceptado, 409 y 401 por confirmación: líneas con sus campos y run.e…" |
| R78 | `panel/test/run-store.test.js` → "[F4-R78] listAll devuelve las metas de todos los proyectos"; `panel/test/work-api.test.js` → "[F4-R78][F4-R79] GET /api/attention y POST /dismiss" |
| R79 | `panel/test/work-api.test.js` → "[F4-R78][F4-R79] GET /api/attention y POST /dismiss" |
| R80 | `panel/test/work-render.test.js` → "[F4-R80] renderWorkView completo: caja de mensaje, selector de sesión y todos los botones", "[F4-R80] renderWorkView: cada botón depende de hasSdd, specReady, isRepo y effectiveTest…", "[F4-R80] renderSessionSelect y buildRunPayload" |
| R81 | `panel/test/work-render.test.js` → "[F4-R81] renderWorkView en solo lectura (ejecución desactivada o sin carpeta): aviso, si…" |
| R82 | `panel/test/work-render.test.js` → "[F4-R82] describeAction: textos exactos de cada acción con escapado" |
| R83 | `panel/test/work-render.test.js` → "[F4-R83] renderRunEvent pinta cada tipo de evento escapando el texto", "[F4-R83] renderRunLog pinta como mucho los últimos 2000 eventos y avisa", "[F4-R83] corrección T36: el resultado no repite el texto si es idéntico al último del as…" |
| R84 | `panel/test/work-render.test.js` → "[F4-R84] renderPermissionPrompt con y sin sugerencia, y buildRetryPayload", "[F4-R84] corrección T36: un run terminado con denegaciones avisa "N comandos denegados" …", "[F4-R84] corrección T36: una denegación de PowerShell ofrece "Permitir en este proyecto …" |
| R85 | `panel/test/work-render.test.js` → "[F4-R85] renderDiff marca add/del/hunk/meta, escapa y avisa del recorte" |
| R86 | `panel/test/work-render.test.js` → "[F4-R86] createApiClient: un 401 con reauthRequired no llama a onUnauthorized y el error…", "[F4-R86] withReauth: repite la acción una vez tras un reauth correcto; nada si se cancela" |
| R87 | `panel/test/work-render.test.js` → "[F4-R87] renderAttention con proyectos y runs; vacío → cadena vacía", "[F4-R87] corrección T36: en "Te necesitan" un run terminado con denegaciones es un aviso…" |
| R88 | `panel/test/work-render.test.js` → "[F4-R88] renderRunList con un run de cada estado y lista vacía" |
| R89 | `panel/test/work-render.test.js` → "[F4-R89] suggestCommitMessage con y sin feature in_progress" |
| R90 | `panel/test/render.test.js` → "[F4-R90] renderProjectCard y renderProjectDetail no generan href con URLs que no sean ht…" |
| R91 | `panel/test/styles.test.js` → "[F4-R91] index.html: #attention dentro de #list-view antes de #projects y diálogos <dial…", "[F4-R91] app.js importa work.js", "[F4-R91] styles.css define los selectores de la fase 4 con colores en variables para cla…" |
| R92 | `panel/test/claude-discovery.test.js` → "[F4-R92] un summary de 120 caracteres se recorta con clipTitle a 80 + "…"" |
| R93 | `panel/test/deploy.test.js` → "[F4-R93] uninstall-service.ps1 cierra también los cloudflared.exe del túnel" |
| R94 | `panel/test/deploy.test.js` → "[F4-R94] docs: architecture.md con módulos, rutas y variables de la fase 4; verification…"; `panel/test/registry.test.js` → "[F4-R94] corrección T36: prepareProjectsFile migra panel/projects.json a <datos>/project…", "[F4-R94] corrección T36: sin registro previo se siembra con projects.example.json; sin n…", "[F4-R94] corrección T36: server.js usa <datos>/projects.json y existe panel/projects.exa…" |
| R95 | **MANUAL — parcial (2026-10-25)**: Windows 11, Node 24.14.0, Git 2.52, Claude Code 2.1.307; chat en vivo, coste, historial y «Continuar la última sesión» superados en el PC (localhost); **desde el móvil pendiente** |
| R96 | **MANUAL — superado en el PC del humano (2026-10-25)**: denegación real «This PowerShell command contains multiple operations. The following part requires approval: node --version»; «Permitir en este proyecto y reintentar» repite sin denegación |
| R97 | **MANUAL — superado (2026-10-25)**: run cancelado a los 10 s; ningún `claude.exe` con `stream-json` cuelga de `node.exe` ni queda huérfano (todos los restantes son hijos de la app de escritorio Claude.exe) |
| R98 | **MANUAL — parcial (2026-10-25)**: «Ejecutar tests» lanza `init.sh` con Git Bash (411 tests: 410 pass, 1 skipped previsto); «Commit y push» real **pendiente** |
| R99 | **MANUAL — pendiente del humano** (ver fila T36/T37) |
| T30 (UI) | Comprobación automatizada en Linux por el implementer con Chromium headless (Playwright, fuera del repo) a 360×780 en tema claro y oscuro contra el panel con el CLI falso: "Te necesitan" con la spec lista → "Trabajar"; mensaje → diálogo de confirmación → salida en vivo → "Necesita permiso" → "Permitir en este proyecto y reintentar" → pasados 16 min por el túnel (`X-Forwarded-Proto: https`) pide la contraseña (incorrecta → error en el diálogo sin cerrar la sesión; correcta → repite la acción) → reintento lanzado y `npm run lint` guardado en `projects.json`; "Ver cambios" + diff; "Commit y push" con mensaje prerrellenado; sin scroll horizontal ni errores de JavaScript. |
| T36 | **MANUAL — Windows + móvil — pendiente del humano** (R95–R98): anotar `claude --version`; chat desde el móvil por la red local y por el túnel (texto y herramientas en vivo, `Terminada` con coste y duración, reabrir desde el historial, "Continuar la última sesión" recuerda el mensaje anterior); pedir un comando no autorizado (p. ej. `npm run lint`) → "Necesita permiso" → "Permitir en este proyecto y reintentar" lo ejecuta (anotar el texto exacto de la denegación del CLI real); cancelar un run largo (`testCommand` que espera 120 s) y comprobar en el Administrador de tareas que no quedan `claude.exe`/`node.exe`/`bash.exe` hijos; "Ejecutar tests" con `init.sh` (anotar la ruta de Git Bash detectada) y "Commit y push" real sin quedarse esperando credenciales. Resultado (2026-10-25, PC local): superado salvo el uso desde el móvil y el «Commit y push» real, pendientes. La prueba destapó 7 fallos, corregidos antes de la aprobación (notas «corrección T36»). |
| T37 | **MANUAL — Internet — pendiente del humano** (R99): por la URL temporal, una acción pasados 15 minutos pide la contraseña; con dominio propio y Access según `docs/acceso-web.md` §9: código de un solo uso, contraseña del panel y acciones sin reconfirmar. Resultado: _(anotar fecha y resultado)_ |

## Mapa de trazabilidad — Feature 14: `endurecimiento-ejecucion` (prefijo `[F14-R<n>]`)

> Tests en `panel/test/` (`node --test`, sin dependencias). `hardening.test.js` usa repos git temporales, ejecutables
> falsos que solo escriben ficheros de marca en temporales, un `PATH` de prueba aislado (`proyecto:.:bin` con enlaces a
> los `git` y `sh` reales; nunca el `PATH` del sistema, así que nunca se alcanza un `claude` real), un `HOME` temporal y
> un remoto `--bare` local; se salta en Windows (scripts `#!/bin/sh` y enlaces: allí se cubre con la comprobación manual
> de R12) y sin git. Ningún test lee ni escribe `panel/projects.json` ni `~/.claude`.
>
> **Cambios declarados en tests anteriores (design.md §8.3):** `exec-utils.test.js` `[F4-R54]` (`pytest` no encontrado →
> `{ error: notFound }`; Linux con rutas absolutas encontradas con `exists` inyectado); `claude-cli.test.js` `[F4-R12]`
> (Linux `claude` → `/usr/bin/claude`; "nada" → `{ error: notFound }`) y `[F4-R65]` (`yarn run -s x` → `null`);
> `git-actions.test.js` `[F4-R60]`/`[F4-R58]` (pasos con `-c core.fsmonitor=false`; el push lleva `GIT_SSH_COMMAND`);
> `runs-api.test.js` `[F4-R30]`; `helpers.js` (`startApp` acepta `env` y `claudeBin`).
>
> **Desviaciones del implementer (cambios en tests anteriores no listados en §8.3, todos consecuencia directa de un
> requisito o texto de esta feature):**
> - `runs-api.test.js` `[F4-R30]`: no fijaba `outputBytes`, pero exigía que el evento `result` siguiera en la salida
>   tras el truncado; con R27 (solo `state`/`end` y los avisos esenciales esquivan el límite) el `result` se descarta.
>   Ahora comprueba que no está y que el run conserva `succeeded` y el coste (que salen de `rec.result`).
> - `claude-cli.test.js` y `runs-api.test.js` `[F4-R24][F4-R65]` (escenario `denied_powershell`): la denegación de
>   `node --version` ya no propone `node` (es amplio, R15): `suggestion: null`, `suggestions: []`.
> - `claude-cli.test.js` `[F4-R12]`: un `CLAUDE_BIN` `.js` relativo sin separador (`tool.mjs`) también se hace absoluto
>   respecto a la carpeta del panel (design.md §5.5 dice "si es relativo"; si no, Node lo resolvería contra el `cwd` del
>   run, que es la carpeta del proyecto).
> - `exec-utils.test.js` `[F4-R28]`: `taskkill` se lanza por `C:\Windows\System32\taskkill.exe` (R10), mismos argumentos.
> - `registry.test.js` `[F4-R62]` y `work-api.test.js` `[F4-R64]`: texto ampliado de `invalidCommand` (design.md §4.1).
> - `work-api.test.js` `[F4-R6]`: la respuesta de `GET /work` incluye `broadCommands: []` (R18).

| Requisito | Test(s) que lo verifican |
|-----------|--------------------------|
| R1 | `panel/test/trusted-bin.test.js` → "[F14-R1] linux: primera carpeta del PATH…", "[F14-R1] linux: node → execPath siempre…", "[F14-R1] win32: .com antes que .exe…", "[F14-R1] win32: rutas conocidas de §3.2…", "[F14-R1] win32: claude en PATH…", "[F14-R1][F14-R4] resolveTrustedBinary e isTrustedPath…"; `panel/test/exec-utils.test.js` → "[F14-R1][F14-R4] resolveExecutable delega en el resolvedor…" |
| R2 | `panel/test/trusted-bin.test.js` → "[F14-R2] parsePathEntries descarta vacías…", "[F14-R2] el resolvedor solo consulta las entradas absolutas del PATH (linux y win32)" |
| R3 | `panel/test/trusted-bin.test.js` → "[F14-R3] linux: se descartan el git del cwd, el de otro proyecto…", "[F14-R3] win32: sin distinguir mayúsculas…", "[F14-R3] proyecto contenedor (HOME, ancestro o raíz)…", "[F14-R3][F14-R5] el catálogo se lee en cada llamada" |
| R4 | `panel/test/trusted-bin.test.js` → "[F14-R4] sin candidatos → notFound; solo dentro de un proyecto → onlyInProject…", "[F14-R4][F14-R6] isTrustedPath…"; `panel/test/hardening.test.js` → "[F14-R4] claudeBin "claude" sin Claude en el PATH del panel: POST /runs → 409 notFound…", "[F14-R11][F14-R4] con git, claude, node, npm y bash falsos…" |
| R5 | `panel/test/trusted-bin.test.js` → "[F14-R5] caché: la segunda resolución no consulta el disco…", "[F14-R5] caché: una búsqueda sin candidatos no se guarda…" |
| R6 | `panel/test/runs-api.test.js` → "[F14-R6] guardedSpawn: git suelto, bin/git o un fichero dentro del cwd…", "[F14-R6] guardedSpawn: un projectScript dentro del cwd se acepta…"; `panel/test/trusted-bin.test.js` → "[F14-R4][F14-R6] isTrustedPath…"; `panel/test/git-info.test.js` → "[F14-R7] createGitRunner rechaza…" |
| R7 | `panel/test/git-info.test.js` → "[F14-R7][F14-R21] createGitRunner: ruta absoluta del resolvedor…", "[F14-R7] createGitRunner rechaza cualquier programa que no sea git…", "[F14-R7] createGitRunner: un fallo de execFile…"; `panel/test/hardening.test.js` → "[F14-R11][F14-R4] …" |
| R8 | `panel/test/claude-cli.test.js` → "[F14-R8] resolveClaudeCommand: CLAUDE_BIN relativo con separador…", "[F14-R8] resolveClaudeCommand con resolvedor y cwd…" (y `[F4-R12]` ajustado) |
| R9 | `panel/test/sdd-actions.test.js` → "[F14-R9] resolveTestCommand: nombre → resolvedor…", "[F14-R9] resolveTestCommand: relativa con separador → … projectScript…", "[F14-R9] resolveTestCommand: git solo en la carpeta del proyecto → 409 onlyInProject…" |
| R10 | `panel/test/exec-utils.test.js` → "[F14-R10] taskkillPath y killProcessTree en win32…" |
| R11 | `panel/test/hardening.test.js` → "[F14-R11] preparación: ejecutables falsos y PATH de prueba aislado", "[F14-R11][F14-R4] con git, claude, node, npm y bash falsos en el proyecto y PATH = proyecto:.:bin, el panel no ejecuta ninguno" |
| R12 | **MANUAL — Windows — pendiente del humano** (T30, design.md §8.4): `whoami.exe` copiado como `git.exe` y `claude.exe` en un proyecto de prueba; anotar fecha, `node -v`, `git --version`, `claude --version` y resultado |
| R13 | `panel/test/runs-api.test.js` → "[F14-R13] en win32 los hijos reciben NoDefaultCurrentDirectoryInExePath=1…"; `panel/test/git-info.test.js` → "[F14-R13] createGitRunner en win32 añade NoDefaultCurrentDirectoryInExePath=1…" |
| R14 | `panel/test/claude-cli.test.js` → "[F14-R14] isBroadCommand con la tabla de design.md §3.5" |
| R15 | `panel/test/claude-cli.test.js` → "[F14-R15] suggestAllowedCommand(s) nunca proponen un comando amplio…" |
| R16 | `panel/test/work-api.test.js` → "[F14-R16] POST /permissions con un comando amplio…" |
| R17 | `panel/test/work-api.test.js` → "[F14-R17] PATCH con un comando amplio nuevo…" |
| R18 | `panel/test/work-api.test.js` → "[F14-R18] GET /work incluye broadCommands…" |
| R19 | `panel/test/work-render.test.js` → "[F14-R19] BROAD_TEXTS y describeAction("allow-broad")…", "[F14-R19] renderBroadWarning…"; cableado del diálogo: comprobación manual (T30) |
| R20 | `panel/test/claude-cli.test.js` → "[F14-R20] isValidAllowedCommand rechaza los que empiezan por - o terminan en :", "[F14-R20] buildAllowedTools con 200 comandos válidos aleatorios…" |
| R21 | `panel/test/git-info.test.js` → "[F14-R7][F14-R21] createGitRunner…"; `panel/test/git-actions.test.js` → "[F14-R21][F14-R26] planCommitPush: los tres pasos con prefijo…" |
| R22 | `panel/test/hardening.test.js` → "[F14-R22] core.fsmonitor con un script de marca no se ejecuta…" |
| R23 | `panel/test/hardening.test.js` → "[F14-R23] un fichero llamado "*" devuelve solo su diff…"; `panel/test/git-actions.test.js` → "[F14-R23] GIT_ACTION_ARGS…", "[F14-R23] getFileDiff de un fichero llamado "*"…" |
| R24 | `panel/test/hardening.test.js` → "[F14-R24] GET /changes informa de los hooks activos…"; `panel/test/git-actions.test.js` → "[F14-R24] listActiveHooks…" |
| R25 | `panel/test/work-render.test.js` → "[F14-R25] renderHooksWarning…"; `panel/test/git-actions.test.js` → "[F14-R25] estático: git-actions.js no desactiva los hooks…"; cableado del diálogo: comprobación manual (T30) |
| R26 | `panel/test/git-actions.test.js` → "[F14-R21][F14-R26] planCommitPush…", "[F14-R26] planCommitPush respeta GIT_SSH_COMMAND o GIT_SSH…" |
| R27 | `panel/test/runs-api.test.js` → "[F14-R27] escenario flood con límite pequeño…" (y `[F4-R30]` ajustado) |
| R28 | `panel/test/claude-cli.test.js` → "[F14-R28] createStreamMapper: con 60 denegaciones distintas…"; `panel/test/runs-api.test.js` → "[F14-R28] escenario flood con el límite normal…" |
| R29 | `panel/test/hardening.test.js` → "[F14-R29] approve-spec con un run activo → 409…" |
| R30 | `panel/test/deploy.test.js` → "[F14-R30] specs/puesto-de-mando-trabajar/design.md: correcciones N1 y N2" |
| R31 | `panel/test/deploy.test.js` → "[F14-R31] docs/architecture.md tiene la sección "Seguridad de la ejecución"…" |
| R32 | `panel/test/deploy.test.js` → "[F14-R32] docs/verification.md: sección Feature 14…" |
| R33 | `./init.sh` completo en verde (fases 1–4 y feature 14) y `node sdd-lint.js` con 0 errores (T31) |
| T30 | **MANUAL — Windows — pendiente del humano, no bloqueante** (R12, R19, R25; design.md §8.4). El humano decidió el 2026-10-25 cerrar la feature 14 con esta prueba pendiente; se hará junto con la de la feature 15 (cancelar un run en Windows). Resultado: _(anotar fecha, versiones y resultado)_ |

## Qué NO se considera verificado

- "Yo lo he probado a mano una vez" no cuenta como test.
- Un test que siempre pasa pase lo que pase (falso positivo) no cuenta.
