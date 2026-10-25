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

- Todo se lanza desde `init.sh` (paso 3: `(cd panel && npm test)`, que ejecuta `node --test` sobre `panel/test/*.test.js`; también puede lanzarse a mano con `cd panel && npm test`). Los tests de la fase 1 llevan el prefijo `[R<n>]`, los de la fase 2 `[F2-R<n>]` y los de la fase 3 `[F3-R<n>]` (siempre con un `claudeHome` temporal); los de la fase 1 que tocan la API se autentican con la cookie de sesión del `before()` (`F2-R16`).
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

## Qué NO se considera verificado

- "Yo lo he probado a mano una vez" no cuenta como test.
- Un test que siempre pasa pase lo que pase (falso positivo) no cuenta.
