# Requisitos — Feature 2: Puesto de Mando MUVER (fase 2: acceso web con contraseña)

> El panel de la fase 1 pasa a poder usarse desde una URL pública en Internet (móvil y PC) manteniendo el
> servidor en el PC Windows del humano: autenticación con contraseña y cookie de sesión firmada, todas las
> rutas `/api/*` protegidas, publicación HTTPS mediante **Cloudflare Tunnel** (camino principal: URL temporal
> gratuita `*.trycloudflare.com`; opción avanzada: dominio propio) y arranque automático del panel y del
> túnel con el PC mediante tareas programadas de Windows.
>
> Fuera de alcance (features 3, 4 y 5): descubrimiento de proyectos de Claude, ejecutar Claude Code o
> comandos, notificaciones, varios usuarios, OAuth.
>
> Convención de este fichero: cada requisito ocupa UNA sola línea (así `sdd-lint.js` lo valida completo) y
> va seguido de su línea *Cómo se prueba*. Los contratos JSON, nombres de ficheros y cabeceras son los de
> `design.md`. Los requisitos marcados **[MANUAL — Windows]** o **[MANUAL — Internet]** no pueden ejecutarse
> en el entorno de tests (Linux, sin cloudflared): se verifican a mano por el humano y así se anota en
> `docs/verification.md`; además, siempre que es posible, un test estático comprueba el contenido del fichero.

## Vocabulario

- **Directorio de datos:** carpeta donde el panel guarda su estado privado: `PANEL_DATA_DIR` o, por defecto, `panel/data/`. Contiene `auth.json`, `sessions.json`, `public-url.txt`, `panel.log` y `cloudflared.log`.
- **Contraseña configurada:** existe `<datos>/auth.json` válido (contrato en `design.md` §3.1).
- **Cookie de sesión:** cookie `muver_session` cuyo valor es `<id>.<firma>`, con `id` aleatorio de 32 bytes en hex y `firma` = HMAC-SHA256(`sessionSecret`, `id`) en hex.
- **Petición autenticada:** petición con cookie de sesión cuya firma es correcta, cuyo `id` está en `sessions.json` y cuya `expiresAt` es posterior a *ahora*.
- **Proxy de confianza:** modo (`PANEL_TRUST_PROXY`, por defecto activo) en que el servidor cree las cabeceras `X-Forwarded-Proto` y `CF-Connecting-IP` que añade Cloudflare.
- **IP del cliente:** con proxy de confianza, el valor de `CF-Connecting-IP` si existe; en otro caso `req.socket.remoteAddress`.
- **Atributo solo-HTTPS:** el atributo estándar de cookie que impide que el navegador la envíe por HTTP sin cifrar (nombre exacto en `design.md` §5.2).
- **Cabecera anti-CSRF:** `X-Requested-With: fetch`, obligatoria en toda petición `POST`/`DELETE` a `/api/*`.
- **Mutación:** petición `POST` o `DELETE` a cualquier ruta `/api/*`.
- **Ahora (`now`):** instante inyectable en `createApp` y en los módulos de sesión y límite de intentos, para tests deterministas.
- **URL pública:** contenido de `<datos>/public-url.txt`, escrito por el lanzador del túnel a partir de la salida de `cloudflared`.

## A. Primer arranque y creación de la contraseña

- **R1.** Cuando el panel arranca sin `auth.json` en el directorio de datos y un cliente hace `GET /api/auth/status`, el sistema debe responder `200` con JSON `{ "configured": false, "authenticated": false, "publicUrl": null }` sin exigir cookie ni cabecera anti-CSRF.
  - *Cómo se prueba:* test de integración que arranca la app con un `dataDir` temporal vacío y comprueba código y cuerpo exacto.

- **R2.** Cuando la contraseña no está configurada y un cliente hace `POST /api/auth/setup` con cabecera anti-CSRF y cuerpo `{ "password": "<cadena de 10 a 128 caracteres>" }`, el sistema debe crear `<datos>/auth.json` con los campos del contrato (`algorithm: "scrypt"`, `salt` hex de 32 caracteres, `hash` hex de 128 caracteres, `params`, `sessionSecret` hex de 64 caracteres distinto de `salt`, `createdAt`, `updatedAt`), crear una sesión, responder `201` con `{ "authenticated": true }` y una cabecera `Set-Cookie` de sesión, y el siguiente `GET /api/auth/status` con esa cookie debe devolver `configured: true` y `authenticated: true`.
  - *Cómo se prueba:* test de integración que hace el setup, parsea `auth.json` del `dataDir` temporal, comprueba longitudes y formato hex de cada campo, la cookie recibida y el estado posterior.

- **R3.** Si `POST /api/auth/setup` llega con `password` ausente, que no es una cadena, de menos de 10 caracteres o de más de 128, entonces el sistema debe responder `400` con `{ "error": "La contraseña debe tener entre 10 y 128 caracteres", "field": "password" }` y no debe crear `auth.json`.
  - *Cómo se prueba:* test de integración con cuatro cuerpos (sin password, número, 9 caracteres, 129 caracteres) que comprueba código, cuerpo y que el fichero no existe.

- **R4.** Si `POST /api/auth/setup` llega cuando la contraseña ya está configurada, entonces el sistema debe responder `409` con `{ "error": "La contraseña ya está configurada" }` y `auth.json` debe quedar byte a byte igual que antes.
  - *Cómo se prueba:* test de integración que lee `auth.json`, repite el setup con otra contraseña y compara código, cuerpo y contenido del fichero.

- **R5.** Si `auth.json` existe pero no es JSON válido o le falta alguno de los campos `salt`, `hash`, `sessionSecret`, entonces el sistema debe responder `500` con `{ "error": "Fichero de autenticación ilegible; ejecuta npm run reset-password" }` a `GET /api/auth/status`, `POST /api/auth/login` y `POST /api/auth/setup`, sin sobrescribir el fichero y sin cerrar el proceso.
  - *Cómo se prueba:* test de integración que escribe `{ roto` en `auth.json`, hace las tres peticiones, comprueba código y cuerpo, que el fichero sigue igual y que `GET /` sigue respondiendo `200`.

- **R6.** Cuando el sistema escribe `auth.json` o `sessions.json`, debe crear el directorio de datos si no existe (`mkdir` recursivo), escribir primero `<fichero>.tmp` y renombrarlo sobre el definitivo, de modo que tras la operación no quede ningún `.tmp` y el fichero parsee como JSON.
  - *Cómo se prueba:* test de integración que arranca con un `dataDir` cuya carpeta aún no existe, hace el setup y comprueba que la carpeta y `auth.json` existen, que no hay `auth.json.tmp` y que `JSON.parse` no lanza.

- **R7.** Cuando se consulta el `.gitignore` de la raíz del repositorio, el sistema (repo) debe contener la línea `panel/data/` de modo que `git check-ignore panel/data/auth.json` devuelva esa ruta como ignorada.
  - *Cómo se prueba:* test estático que lee `.gitignore` y busca la línea exacta `panel/data/`; comprobación adicional con `git check-ignore -q panel/data/auth.json` (código 0) en el entorno de tests.

## B. Login, cookie y sesión

- **R8.** Cuando la contraseña está configurada y un cliente hace `POST /api/auth/login` con cabecera anti-CSRF y `{ "password": "<correcta>" }`, el sistema debe responder `200` con `{ "authenticated": true }` y una cabecera `Set-Cookie` `muver_session=<id>.<firma>` con los atributos `HttpOnly`, `SameSite=Lax`, `Path=/` y `Max-Age=2592000`, y `sessions.json` debe contener la entrada `<id>` con `createdAt`, `lastSeenAt` y `expiresAt = now + 30 días` (en ms, con el `now` inyectado).
  - *Cómo se prueba:* test de integración con `now` fijo que hace login, parsea `Set-Cookie` (nombre, formato `^[0-9a-f]{64}\.[0-9a-f]{64}$`, los cuatro atributos) y comprueba la entrada en `sessions.json`.

- **R9.** Si `POST /api/auth/login` llega con una contraseña incorrecta, entonces el sistema debe responder `401` con `{ "error": "Contraseña incorrecta" }`, sin cabecera `Set-Cookie` y sin añadir ninguna entrada a `sessions.json`.
  - *Cómo se prueba:* test de integración que cuenta las entradas de `sessions.json` antes y después y comprueba la ausencia de `Set-Cookie`.

- **R10.** Si `POST /api/auth/login` llega sin `password` o con un `password` que no es una cadena, entonces el sistema debe responder `400` con `{ "error": "Falta la contraseña", "field": "password" }` sin contarlo como intento fallido.
  - *Cómo se prueba:* test de integración que envía `{}` y `{ "password": 5 }` seis veces y comprueba `400` en todas (nunca `429`).

- **R11.** Si `POST /api/auth/login` llega cuando la contraseña no está configurada, entonces el sistema debe responder `409` con `{ "error": "Contraseña no configurada" }`.
  - *Cómo se prueba:* test de integración sobre un `dataDir` vacío.

- **R12.** Cuando el sistema genera el hash de una contraseña, debe usar `crypto.scrypt` con `N = 16384`, `r = 8`, `p = 1`, `keylen = 64` y un `salt` aleatorio de 16 bytes nuevo en cada llamada, de modo que dos hashes de la misma contraseña tengan `salt` y `hash` distintos y `verifyPassword` acepte la contraseña correcta y rechace cualquier otra.
  - *Cómo se prueba:* test unitario de `hashPassword`/`verifyPassword` (`lib/auth.js`) que genera dos registros de la misma contraseña, comprueba `params` exactos, salts distintos, hashes distintos, verificación positiva con la correcta y negativa con otra que solo difiere en el último carácter.

- **R13.** Cuando el sistema compara un hash de contraseña o la firma de un token de sesión, debe hacerlo con `crypto.timingSafeEqual` sobre buffers de igual longitud, y si las longitudes difieren o el token no tiene el formato `<hex>.<hex>` debe devolver resultado negativo sin lanzar excepción.
  - *Cómo se prueba:* test unitario que llama a `verifyPassword` con un registro cuyo `hash` tiene longitud distinta y a `verifyToken` con `"abc"`, `"a.b"`, `""` y un token con firma de longitud correcta pero valor alterado, comprobando resultado negativo en todos; más un test estático que comprueba que `lib/auth.js` y `lib/sessions.js` contienen `timingSafeEqual`.

- **R14.** Cuando se emite la cookie de sesión (login, setup o renovación) y la petición llega con `X-Forwarded-Proto: https` estando el proxy de confianza activo, o bien la app se creó con `secureCookies: true` (`PANEL_SECURE_COOKIES=1`), el sistema debe incluir el atributo solo-HTTPS en `Set-Cookie`; en cualquier otro caso (petición HTTP de la red local sin esa cabecera y sin `secureCookies`) no debe incluirlo.
  - *Cómo se prueba:* test de integración con tres logins: sin cabecera (sin atributo), con `X-Forwarded-Proto: https` (con atributo) y app creada con `secureCookies: true` sin cabecera (con atributo).

- **R15.** Si la app se crea con `trustProxy: false` (`PANEL_TRUST_PROXY=0`), entonces el sistema debe ignorar `X-Forwarded-Proto` (cookie sin atributo solo-HTTPS aunque la cabecera diga `https`) e ignorar `CF-Connecting-IP` (la IP del cliente es `remoteAddress`, de modo que fallos con cabeceras `CF-Connecting-IP` distintas se acumulan en el mismo contador).
  - *Cómo se prueba:* test de integración con `trustProxy: false`: login con `X-Forwarded-Proto: https` → cookie sin el atributo; cinco fallos con cinco valores distintos de `CF-Connecting-IP` → el sexto intento responde `429`.

- **R16.** Cuando una petición a una ruta `/api/*` distinta de `/api/auth/*` es una petición autenticada, el sistema debe ejecutar la ruta con el mismo comportamiento que en la fase 1 (por ejemplo `GET /api/projects` → `200` con el listado, `POST /api/projects` válido → `201`).
  - *Cómo se prueba:* los tests de integración existentes de `api.test.js` se adaptan para hacer login en `before` y enviar la cookie y la cabecera anti-CSRF, y siguen pasando.

- **R17.** Si una petición a una ruta `/api/*` distinta de `/api/auth/*` no es una petición autenticada (sin cookie, cookie con firma incorrecta, `id` ausente en `sessions.json` o sesión caducada), entonces el sistema debe responder `401` con `{ "error": "No autenticado" }` sin ejecutar la ruta (no lee proyectos ni modifica `projects.json`).
  - *Cómo se prueba:* test de integración con `GET /api/projects` y `POST /api/projects` (con cabecera anti-CSRF y cuerpo válido) en los cuatro casos, comprobando `401`, el cuerpo y que `projects.json` no cambia.

- **R18.** Cuando una petición autenticada llega y han pasado al menos 60 segundos desde `lastSeenAt` de su sesión, el sistema debe actualizar `lastSeenAt = now` y `expiresAt = now + 30 días` en `sessions.json` y reenviar `Set-Cookie` con `Max-Age=2592000`; si han pasado menos de 60 segundos, no debe reescribir `sessions.json` ni enviar `Set-Cookie`.
  - *Cómo se prueba:* test de integración con `now` controlable: login en `t0`; petición en `t0 + 10 s` (sin `Set-Cookie`, `expiresAt` sin cambios); petición en `t0 + 20 días` (con `Set-Cookie` y `expiresAt = t0 + 50 días`).

- **R19.** Si una petición llega con una cookie cuya sesión tiene `expiresAt` anterior a `now`, entonces el sistema debe responder `401` con `{ "error": "No autenticado" }` y eliminar esa entrada de `sessions.json`.
  - *Cómo se prueba:* test de integración: login en `t0`, petición en `t0 + 31 días` → `401` y el `id` ya no está en `sessions.json`.

- **R20.** Cuando un cliente hace `POST /api/auth/logout` con cabecera anti-CSRF, el sistema debe responder `204` con `Set-Cookie` `muver_session=; Max-Age=0; Path=/` (más `HttpOnly` y `SameSite=Lax`), eliminar la sesión de `sessions.json` si la cookie era válida, y una petición posterior con esa misma cookie debe responder `401`; si la petición de logout no trae cookie válida, el sistema debe responder igualmente `204`.
  - *Cómo se prueba:* test de integración que hace login, logout, comprueba cabeceras y fichero, repite `GET /api/projects` con la cookie antigua (`401`) y hace logout sin cookie (`204`).

- **R21.** Cuando el servidor se reinicia (nueva instancia de `createApp` sobre el mismo directorio de datos), el sistema debe seguir aceptando las cookies de las sesiones guardadas en `sessions.json`; y si `sessions.json` no es JSON válido, debe arrancar con cero sesiones, registrar un aviso con `console.error` y seguir atendiendo peticiones.
  - *Cómo se prueba:* test de integración que hace login, cierra la app, arranca otra con el mismo `dataDir` y comprueba `200` con la misma cookie; segundo test que escribe `{ roto` en `sessions.json`, arranca y comprueba `401` en `GET /api/projects` y `200` en `GET /api/auth/status`.

- **R22.** Cuando un cliente hace `GET /api/auth/status` con la contraseña configurada, el sistema debe responder `200` con `authenticated: true` si la cookie es válida y `authenticated: false` si falta o no es válida, en ambos casos con `configured: true`, sin exigir cabecera anti-CSRF y sin renovar la sesión.
  - *Cómo se prueba:* test de integración con cookie válida, sin cookie y con cookie alterada, comprobando cuerpo y que `sessions.json` no cambia.

## C. Límite de intentos y defensa CSRF

- **R23.** Si desde una misma IP del cliente se producen 5 respuestas `401` consecutivas de `POST /api/auth/login` dentro de 15 minutos, entonces desde el quinto fallo y durante 15 minutos el sistema debe responder a todo `POST /api/auth/login` de esa IP (incluso con la contraseña correcta) con `429`, cuerpo `{ "error": "Demasiados intentos. Espera 15 minutos.", "retryAfterSeconds": <entero> }`, cabecera `Retry-After` con ese número de segundos y sin crear sesión.
  - *Cómo se prueba:* test de integración con `now` fijo: 5 fallos y después un login correcto → `429`, `Retry-After` entre 1 y 900, sin `Set-Cookie`, `sessions.json` sin entradas nuevas; test unitario de `createRateLimiter` (`lib/rate-limit.js`) con las mismas transiciones.

- **R24.** Cuando han transcurrido 15 minutos desde el inicio del bloqueo de una IP, o cuando un login de esa IP tiene éxito antes de alcanzar los 5 fallos, el sistema debe reiniciar su contador de fallos a cero (tras el bloqueo, un login correcto responde `200`; 4 fallos + éxito + 4 fallos no producen `429`).
  - *Cómo se prueba:* test de integración con `now` controlable (bloqueo en `t0`, login correcto en `t0 + 15 min + 1 s` → `200`) y test unitario del limitador con la secuencia 4 fallos, éxito, 4 fallos → nunca bloqueado.

- **R25.** Cuando el proxy de confianza está activo y la petición trae `CF-Connecting-IP`, el sistema debe usar ese valor como IP del cliente para el límite de intentos (4 fallos desde `1.1.1.1` más 4 fallos desde `2.2.2.2` no bloquean a ninguna), y si no trae la cabecera debe usar `remoteAddress`.
  - *Cómo se prueba:* test de integración con dos cabeceras distintas (ningún `429`) seguido de un quinto fallo desde `1.1.1.1` (`429` solo para `1.1.1.1`; `2.2.2.2` sigue en `401`); test unitario de `getClientIp(req, { trustProxy })` con y sin cabecera.

- **R26.** Si una mutación a `/api/*` (incluidas `/api/auth/login`, `/api/auth/setup`, `/api/auth/logout`, `/api/auth/change-password`, `/api/projects`) llega sin la cabecera `X-Requested-With: fetch`, entonces el sistema debe responder `403` con `{ "error": "Cabecera X-Requested-With requerida" }` antes de comprobar la sesión y sin ejecutar la ruta ni contar intento fallido.
  - *Cómo se prueba:* test de integración que envía `POST /api/auth/login` con la contraseña correcta sin la cabecera (`403`, sin cookie), `POST /api/projects` con cookie válida sin la cabecera (`403`, registro intacto) y `DELETE /api/projects/:id` sin la cabecera (`403`).

## D. Cambio de contraseña y rescate

- **R27.** Cuando una petición autenticada hace `POST /api/auth/change-password` con `{ "currentPassword": "<correcta>", "newPassword": "<10 a 128 caracteres>" }`, el sistema debe reescribir `auth.json` con `salt` y `hash` nuevos conservando `sessionSecret`, actualizar `updatedAt`, eliminar de `sessions.json` todas las sesiones salvo la actual, responder `204`, y a partir de entonces el login debe aceptar solo la nueva contraseña mientras la cookie actual sigue siendo válida.
  - *Cómo se prueba:* test de integración con dos sesiones abiertas: cambio desde la primera → `204`, la segunda cookie da `401`, la primera sigue en `200`, login con la antigua → `401`, con la nueva → `200`, `sessionSecret` sin cambios y `salt` distinto.

- **R28.** Si `POST /api/auth/change-password` llega con `currentPassword` incorrecta, entonces el sistema debe responder `403` con `{ "error": "La contraseña actual no es correcta", "field": "currentPassword" }`, no modificar `auth.json` y contar el fallo en el límite de intentos de esa IP.
  - *Cómo se prueba:* test de integración que compara `auth.json` antes y después y comprueba que 5 fallos de cambio seguidos de un login correcto producen `429`.

- **R29.** Si `POST /api/auth/change-password` llega con `newPassword` ausente, no cadena, de menos de 10 o de más de 128 caracteres, entonces el sistema debe responder `400` con `{ "error": "La contraseña debe tener entre 10 y 128 caracteres", "field": "newPassword" }` sin modificar `auth.json`.
  - *Cómo se prueba:* test de integración con tres cuerpos inválidos.

- **R30.** Cuando el humano ejecuta `npm run reset-password` en `panel/` (que lanza `node scripts/reset-password.js`), el sistema debe eliminar `auth.json` y `sessions.json` del directorio de datos (respetando `PANEL_DATA_DIR`), imprimir `Contraseña y sesiones eliminadas. Reinicia el panel y abre su URL para crear una contraseña nueva.` y terminar con código 0; si los ficheros no existen debe imprimir `No había contraseña configurada.` y terminar con código 0.
  - *Cómo se prueba:* test de integración que ejecuta el script con `execFile(process.execPath, …)` y `PANEL_DATA_DIR` apuntando a un directorio temporal con y sin los dos ficheros, comprobando ficheros, stdout y código de salida; `package.json` contiene el script `reset-password`.

## E. Configuración, arranque y URL pública

- **R31.** Cuando `readConfig(env, { panelDir })` (`lib/config.js`) recibe las variables de entorno, el sistema debe devolver `port` (`PORT` entero 0–65535, si no `4310`), `dataDir` (`PANEL_DATA_DIR` resuelto con `path.resolve(panelDir, valor)`, por defecto `<panelDir>/data`), `secureCookies` (`true` solo si `PANEL_SECURE_COOKIES` es `"1"` o `"true"`), `trustProxy` (`false` solo si `PANEL_TRUST_PROXY` es `"0"` o `"false"`, por defecto `true`).
  - *Cómo se prueba:* test unitario con `env = {}` (valores por defecto), con los cuatro valores definidos (absoluto y relativo para `PANEL_DATA_DIR`, `"1"`, `"0"`) y con `PORT=abc`.

- **R32.** Cuando el servidor arranca con `npm start`, el sistema debe imprimir, además de las URLs de acceso de la fase 1, una línea `Directorio de datos: <ruta absoluta>` y una línea `Contraseña: configurada` o `Contraseña: no configurada (abre el panel para crearla)`, y una línea `URL pública: <url>` si existe URL pública.
  - *Cómo se prueba:* test unitario de la función pura `buildStartupLines({ urls, dataDir, configured, publicUrl })` (`lib/config.js`) con los dos valores de `configured` y con `publicUrl` nulo y definido; comprobación manual de `npm start`.

- **R33.** Cuando un cliente sin sesión pide `/`, `/styles.css`, `/app.js`, `/render.js`, `/app-config.js`, `/api-client.js`, `/manifest.webmanifest` o `/icon.svg`, el sistema debe responder `200` (los estáticos siguen siendo públicos) y el servidor debe seguir escuchando en `0.0.0.0`.
  - *Cómo se prueba:* test de integración sin cookie sobre las ocho rutas y comprobación de `server.address().address === "0.0.0.0"`.

- **R34.** Cuando existe `<datos>/public-url.txt` y su contenido recortado empieza por `https://`, el sistema debe incluir ese valor en `publicUrl` de `GET /api/auth/status`; si el fichero no existe, está vacío o no empieza por `https://`, debe devolver `publicUrl: null`.
  - *Cómo se prueba:* test unitario de `parsePublicUrl(text)` (`lib/public-url.js`) con `"https://x.trycloudflare.com\n"`, `""`, `"http://inseguro"` y `"basura"`; test de integración que escribe el fichero y comprueba el campo en `status` sin fichero, con URL válida y con contenido vacío.

- **R35.** Cuando `extractTunnelUrl(line)` (`lib/tunnel.js`) recibe una línea de la salida de `cloudflared`, el sistema debe devolver la primera URL `https://<subdominio>.trycloudflare.com` que contenga (con subdominio `[a-z0-9-]+`) o `null` si no hay ninguna.
  - *Cómo se prueba:* test unitario con la línea real de cloudflared (`|  https://abc-def-123.trycloudflare.com  |`), una línea `INF Starting tunnel` y una línea con `http://localhost:4310`.

- **R36.** Cuando `runTunnel({ bin, args, dataDir, spawn })` arranca el proceso de `cloudflared` y en su `stdout` o `stderr` aparece una URL de túnel, el sistema debe escribir esa URL en `<datos>/public-url.txt`, anexar toda la salida a `<datos>/cloudflared.log`, y cuando el proceso termina debe vaciar `public-url.txt` y resolver con el código de salida del proceso.
  - *Cómo se prueba:* test unitario con un `spawn` falso (EventEmitter con `stdout`/`stderr`) que emite una línea sin URL, otra con URL y después `exit 0`: se comprueba el fichero tras la URL, su vaciado tras `exit` y el código devuelto; se comprueba que `spawn` se llamó con `bin` y `args` dados.

## F. Interfaz de usuario (mobile-first, mismos estilos)

- **R37.** Cuando la página carga, el sistema debe pedir `GET /api/auth/status` antes que `/api/projects` y mostrar: con `configured: false` la vista `#auth-view` en modo `setup` (título "Crear contraseña", campos contraseña y confirmación, botón "Crear contraseña"); con `authenticated: false` el modo `login` (título "Iniciar sesión", campo contraseña, botón "Entrar"); con ambos `true` el panel (`#list-view`) y los botones "Salir" y "Cambiar contraseña" en el encabezado.
  - *Cómo se prueba:* test unitario de `resolveAuthView(status)` (`public/render.js`) → `"setup"`, `"login"`, `"panel"`; test unitario de `renderAuthForm(mode)` que comprueba títulos, `data-mode`, `name="password"`, `name="confirm"` solo en setup y textos de botón; test estático de `index.html` con `#auth-view`, `#logout-button` ("Salir") y `#change-password-button` ("Cambiar contraseña"); flujo completo manual.

- **R38.** Cuando el usuario envía el formulario de creación o de cambio de contraseña con una contraseña de menos de 10 caracteres o con confirmación distinta, el sistema debe mostrar el error en un elemento `role="alert"` ("La contraseña debe tener al menos 10 caracteres" / "Las contraseñas no coinciden") sin enviar ninguna petición al servidor.
  - *Cómo se prueba:* test unitario de `validateNewPassword(password, confirm)` con los tres casos (corta, distinta, válida) y de `renderAuthError(message)` (`role="alert"` y texto).

- **R39.** Cuando el frontend hace cualquier petición a `/api/*`, el sistema debe enviarla con `credentials: "same-origin"` y la cabecera `X-Requested-With: fetch`, y si la respuesta es `401` en una ruta distinta de `/api/auth/login` debe invocar el callback `onUnauthorized` (que muestra la vista de login, oculta el panel y detiene el refresco automático) y lanzar un error con `status = 401`.
  - *Cómo se prueba:* test unitario de `createApiClient({ fetch, onUnauthorized })` (`public/api-client.js`) con un `fetch` falso: comprueba cabecera y `credentials` en la llamada, que un `401` en `/api/projects` invoca `onUnauthorized` una vez y rechaza con `status 401`, y que un `401` en `/api/auth/login` no invoca el callback.

- **R40.** Cuando el login o el setup responden `2xx`, el sistema debe ocultar `#auth-view`, mostrar `#list-view`, cargar los proyectos y mostrar los botones del encabezado; si responden `4xx`, debe mostrar el `error` devuelto en `role="alert"` dentro de `#auth-view` conservando la vista; y el pie de página no debe contener el texto "sin autenticación".
  - *Cómo se prueba:* test unitario de `renderAuthError(payload.error)`; test estático que comprueba que `index.html` no contiene "sin autenticación"; flujo completo manual con contraseña correcta e incorrecta.

- **R41.** Cuando el usuario pulsa "Salir", el sistema debe llamar a `POST /api/auth/logout` y mostrar la vista de login; y cuando pulsa "Cambiar contraseña" debe mostrar el formulario `#change-password-form` (campos `currentPassword`, `newPassword`, `confirm`), enviarlo a `POST /api/auth/change-password`, mostrar "Contraseña cambiada" en `role="status"` si responde `204` y el `error` en `role="alert"` si responde `4xx`.
  - *Cómo se prueba:* test unitario de `handleLogout({ request })` (llama con `POST` a `/api/auth/logout`), de `renderChangePasswordForm()` (tres campos con esos `name` y botón "Guardar contraseña") y de `buildChangePasswordPayload(formValues)` (omite `confirm`); flujo manual.

- **R42.** Cuando existe URL pública en `GET /api/auth/status`, el sistema debe mostrarla en el encabezado como enlace (`<a href="<url>">` con el texto de la URL) dentro de `#public-url`, visible también sin sesión en la vista de login; si `publicUrl` es `null`, `#public-url` debe quedar vacío.
  - *Cómo se prueba:* test unitario de `renderPublicUrl(url)` con una URL (contiene `href` y texto escapados) y con `null` (cadena vacía); test estático de `index.html` con `id="public-url"`; manual desde el móvil en la red local.

- **R43.** Cuando el ancho de la ventana es menor o igual a 600 px, el sistema debe mostrar la vista de autenticación a ancho completo con los campos apilados, sin ningún `width`/`min-width` en píxeles mayor que 360 en `styles.css`, y los botones de autenticación y del encabezado deben usar la clase `.btn` (área táctil mínima de 44 px).
  - *Cómo se prueba:* test estático sobre `styles.css` (regla `.auth-card` presente, `.auth-card input` con `width: 100%`, y el test existente de anchos máximos sigue pasando) y sobre `index.html` (los botones `#logout-button` y `#change-password-button` llevan `class="btn…"`); verificación manual a 360×640.

## G. Publicación con Cloudflare Tunnel y arranque automático en Windows

- **R44.** Cuando se lee `panel/deploy/cloudflared-config.example.yml`, el sistema (repo) debe contener `tunnel: <TUNNEL-ID>`, `credentials-file:`, una lista `ingress` con una regla `hostname:` cuyo `service` es `http://localhost:4310` y una regla final `service: http_status:404`.
  - *Cómo se prueba:* test estático que lee el fichero y busca las cinco cadenas.

- **R45.** Cuando se lee `docs/acceso-web.md`, el sistema (repo) debe contener, en este orden, una sección principal "Paso a paso principal: URL temporal de Cloudflare" con `winget install Cloudflare.cloudflared`, `cloudflared tunnel --url http://localhost:4310`, `trycloudflare.com`, `public-url.txt`, `install-service.ps1` y `uninstall-service.ps1`; una tabla de variables de entorno con `PORT`, `PANEL_DATA_DIR`, `PANEL_SECURE_COOKIES` y `PANEL_TRUST_PROXY`; una sección "Si olvidas la contraseña" con `npm run reset-password`; y una sección final "Opción avanzada: dominio propio" con `cloudflared tunnel login`, `cloudflared tunnel create`, `cloudflared tunnel route dns`, `cloudflared service install`, `cloudflared-config.example.yml` y "Cloudflare Access".
  - *Cómo se prueba:* test estático que lee el fichero y comprueba la presencia de cada cadena y que el índice de "Opción avanzada" es mayor que el de "Paso a paso principal".

- **R46.** Cuando se lee `panel/deploy/install-service.ps1`, el sistema (repo) debe contener `Register-ScheduledTask`, `New-ScheduledTaskAction`, `New-ScheduledTaskTrigger`, `-AtStartup`, `-AtLogOn`, `-MultipleInstances IgnoreNew`, `-LogonType S4U`, los nombres de tarea `PuestoDeMandoMUVER` y `PuestoDeMandoMUVER-Tunnel`, `server.js`, `scripts/run-tunnel.js`, `panel.log`, un parámetro `-NoTunnel`, y no debe contener la cadena `nssm` (sin distinguir mayúsculas); y `uninstall-service.ps1` debe contener `Unregister-ScheduledTask` y los dos nombres de tarea.
  - *Cómo se prueba:* test estático sobre ambos ficheros.

- **R47.** **[MANUAL — Windows]** Cuando el humano ejecuta `panel\deploy\install-service.ps1` en PowerShell como administrador y reinicia el PC sin iniciar sesión, el sistema debe quedar escuchando en `http://localhost:4310` sin ninguna ventana visible, `Get-ScheduledTask -TaskName PuestoDeMandoMUVER` debe mostrar estado `Ready` o `Running`, y `panel\data\panel.log` debe contener las líneas de arranque.
  - *Cómo se prueba:* MANUAL en el PC Windows del humano siguiendo `docs/acceso-web.md`; resultado anotado en `docs/verification.md`.

- **R48.** **[MANUAL — Windows]** Cuando el humano ejecuta `panel\deploy\uninstall-service.ps1` como administrador, el sistema debe eliminar las tareas `PuestoDeMandoMUVER` y `PuestoDeMandoMUVER-Tunnel` (`Get-ScheduledTask` ya no las lista) y tras reiniciar el panel no debe estar escuchando en el puerto 4310.
  - *Cómo se prueba:* MANUAL en Windows; resultado anotado en `docs/verification.md`.

- **R49.** **[MANUAL — Windows]** Cuando la tarea `PuestoDeMandoMUVER-Tunnel` arranca con el PC y `cloudflared` está instalado, el sistema debe escribir la URL `https://<subdominio>.trycloudflare.com` en `panel\data\public-url.txt` en menos de 60 segundos, y el panel abierto desde el móvil en la red local debe mostrar esa URL en el encabezado.
  - *Cómo se prueba:* MANUAL en Windows: reiniciar, esperar un minuto, abrir `http://<ip-lan>:4310` desde el móvil y comparar la URL del encabezado con `public-url.txt`.

- **R50.** **[MANUAL — Internet]** Cuando el humano abre la URL pública desde el móvil con datos móviles (fuera de la Wi-Fi), el sistema debe mostrar la vista de login, aceptar la contraseña, dejar la cookie con el atributo solo-HTTPS (visible en las herramientas de desarrollo del navegador de escritorio con la misma URL) y mostrar el listado de proyectos; y al mismo tiempo `http://<ip-lan>:4310` debe seguir funcionando desde la red local con su propia sesión.
  - *Cómo se prueba:* MANUAL con la URL de trycloudflare (o la del dominio propio) y desde la red local; resultado anotado en `docs/verification.md`.

## Supuestos y dudas para el leader (no inventados; se marcan para confirmar)

- **S1.** La entidad `Usuario` de `docs/constitution.md` es la plantilla de ejemplo del arnés (campos `email`, `role`); esta feature NO modela usuarios (una sola contraseña para un solo humano) y por tanto no la usa ni la contradice. Si el humano quiere que `auth.json` siga ese esquema, hay que decidirlo antes de implementar.
- **S2.** El límite de intentos vive solo en memoria: reiniciar el panel lo reinicia. Se acepta porque el reinicio exige acceso al PC.
- **S3.** Con `PANEL_SECURE_COOKIES=1` el navegador no envía la cookie por `http://` en la red local: ese modo solo tiene sentido si el panel se usa únicamente a través del túnel. Por defecto está desactivado y la cookie solo lleva el atributo solo-HTTPS cuando la petición entra por Cloudflare.
- **S4.** Las tareas programadas se registran con el usuario actual y `LogonType S4U` (arranca sin iniciar sesión, sin guardar la contraseña de Windows); requiere ejecutar PowerShell como administrador. No hay acceso a unidades de red desde la tarea; los proyectos deben estar en disco local.
- **S5.** La URL de trycloudflare cambia en cada arranque de `cloudflared`; por eso se guarda en `public-url.txt` y se muestra en el panel. Cloudflare no garantiza disponibilidad de ese servicio gratuito; el camino con dominio propio queda documentado como opción avanzada.
- **S6.** `cloudflared` debe estar en el `PATH` del usuario (o indicarse con `CLOUDFLARED_BIN`); el entorno de tests no lo tiene y los tests del túnel usan un `spawn` falso.
- **S7.** `reset-password` requiere reiniciar el panel después (el estado de autenticación se mantiene en memoria mientras el proceso vive); el script lo indica en su mensaje.
