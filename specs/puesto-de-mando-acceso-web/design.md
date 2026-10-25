# Diseño — Feature 2: Puesto de Mando MUVER (fase 2: acceso web con contraseña)

> CÓMO se construye lo descrito en `requirements.md`. El implementer debe poder trabajar leyendo solo esta
> carpeta más `docs/conventions.md`. Se construye ENCIMA del código de la fase 1 (`panel/`): nada de lo que
> funciona se rompe; los tests existentes se adaptan para autenticarse.

## 1. Decisiones técnicas (resumen)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | Autenticación propia con **una sola contraseña** (sin usuarios), hash `scrypt` de `node:crypto`, **cero dependencias npm**. | Un solo humano; `node:crypto` trae scrypt, HMAC, `randomBytes` y `timingSafeEqual`. Mantiene el paquete sin `node_modules` (decisión D1 de la fase 1). |
| D2 | Sesión = cookie `muver_session` con token `<id>.<firma>`; `id` aleatorio (32 bytes) y `firma` = HMAC-SHA256(`sessionSecret`, `id`). Las sesiones viven en `sessions.json` (lista blanca): un token con firma correcta pero `id` no listado NO vale. | La firma impide forjar ids sin el secreto; la lista en disco permite caducidad deslizante, logout real y revocar al cambiar la contraseña. Sobrevive a reinicios. |
| D3 | Cookie `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` y atributo `Secure` solo cuando la petición entra por HTTPS (`X-Forwarded-Proto: https` de Cloudflare, con proxy de confianza) o con `PANEL_SECURE_COOKIES=1`. | El servidor habla HTTP plano en la LAN y HTTPS solo a través del túnel; si `Secure` fuera incondicional, el login por `http://<ip-lan>` no funcionaría. |
| D4 | Defensa CSRF doble: `SameSite=Lax` + cabecera obligatoria `X-Requested-With: fetch` en toda mutación (`POST`/`DELETE`) a `/api/*`. | Un formulario HTML de otro origen no puede añadir cabeceras personalizadas; `fetch` cross-origin con cabecera dispara CORS preflight y el servidor no responde a `OPTIONS`. Sin tokens CSRF ni estado extra. |
| D5 | Límite de intentos **en memoria** por IP del cliente: 5 fallos → 15 min de bloqueo (`429` + `Retry-After`). IP = `CF-Connecting-IP` (proxy de confianza) o `remoteAddress`. | Frena fuerza bruta sobre la URL pública. En memoria basta (reiniciar el panel exige acceso al PC). |
| D6 | Estado privado en un **directorio de datos** (`PANEL_DATA_DIR`, por defecto `panel/data/`), ignorado por git, con escritura atómica (`.tmp` + `rename`) como en `registry.js`. | Separa secretos del código; el mismo patrón ya probado en la fase 1. |
| D7 | Middleware en `lib/app.js`: orden fijo `estáticos públicos → (api) cabecera anti-CSRF en mutaciones → /api/auth/* → resto exige sesión`. | Orden determinista y testeable; los estáticos siguen públicos porque la UI decide qué pintar según `GET /api/auth/status`. |
| D8 | Publicación con **Cloudflare Tunnel**. Camino principal: URL temporal gratuita (`cloudflared tunnel --url http://localhost:4310`, `*.trycloudflare.com`), lanzada por `scripts/run-tunnel.js`, que captura la URL de la salida de cloudflared y la escribe en `<datos>/public-url.txt`. Opción avanzada: túnel con nombre + dominio propio (`cloudflared-config.example.yml`). | Decisión del humano. El túnel es saliente: sin abrir puertos en el router ni IP fija. La URL temporal cambia en cada arranque, así que el panel la muestra (`publicUrl`) para leerla desde el móvil en la LAN. |
| D9 | Arranque automático en Windows con **tareas programadas** (`Register-ScheduledTask`), dos tareas: panel (`node server.js`) y túnel (`node scripts/run-tunnel.js`), con disparadores `AtStartup` + `AtLogOn`, `MultipleInstances IgnoreNew`, principal = usuario actual con `LogonType S4U`. Sin NSSM ni otros binarios. | Herramientas nativas de Windows; S4U arranca sin iniciar sesión y sin guardar la contraseña de Windows; `IgnoreNew` evita dos instancias (`EADDRINUSE`). La salida se redirige a `panel.log`. |
| D10 | Todo lo inyectable sigue inyectable: `now`, `spawn`, `fetch`, `trustProxy`, `secureCookies`, `dataDir`. | Tests deterministas sin reloj real, sin red y sin cloudflared (decisión D7 de la fase 1). |

## 2. Estructura de ficheros

```
.gitignore                      (tocar) añadir la línea `panel/data/` tras el bloque de negaciones del arnés
panel/
├── package.json                (tocar) script "reset-password": "node scripts/reset-password.js"
├── server.js                   (tocar) readConfig → createApp({ dataDir, trustProxy, secureCookies }); imprime datos/contraseña/URL pública
├── scripts/
│   ├── reset-password.js       (crear) borra auth.json y sessions.json del directorio de datos
│   └── run-tunnel.js           (crear) lanza cloudflared (URL temporal) vía lib/tunnel.js
├── lib/
│   ├── config.js               (crear) readConfig(env, { panelDir }), buildStartupLines(...)
│   ├── auth.js                 (crear) scrypt: hashPassword, verifyPassword, validatePassword, loadAuth, saveAuth, createAuthRecord
│   ├── sessions.js             (crear) createSessionStore: tokens firmados, sessions.json, caducidad deslizante
│   ├── rate-limit.js           (crear) createRateLimiter: 5 fallos / 15 min por clave
│   ├── public-url.js           (crear) parsePublicUrl(text), readPublicUrl(file)
│   ├── tunnel.js               (crear) extractTunnelUrl(line), runTunnel({ bin, args, dataDir, spawn })
│   ├── http-utils.js           (tocar) añadir parseCookies, buildSetCookie, getClientIp, isHttpsRequest
│   ├── app.js                  (tocar) middleware de sesión/CSRF, rutas /api/auth/*, opciones dataDir/trustProxy/secureCookies
│   ├── registry.js             (NO tocar)
│   ├── git-info.js             (NO tocar)
│   ├── project-state.js        (NO tocar)
│   └── network.js              (NO tocar)
├── public/
│   ├── index.html              (tocar) #auth-view, #public-url, botones Salir / Cambiar contraseña, #change-password-view, pie nuevo
│   ├── styles.css              (tocar) .auth-card, .topbar-actions, .public-url
│   ├── app.js                  (tocar) flujo de autenticación; usa api-client.js y las nuevas funciones de render.js
│   ├── api-client.js           (crear) createApiClient({ fetch, onUnauthorized }) — puro, importable en Node
│   ├── render.js               (tocar) resolveAuthView, renderAuthForm, renderAuthError, validateNewPassword, renderChangePasswordForm, buildChangePasswordPayload, handleLogout, renderPublicUrl
│   └── app-config.js           (tocar) MIN_PASSWORD_LENGTH = 10, MAX_PASSWORD_LENGTH = 128
├── deploy/
│   ├── cloudflared-config.example.yml  (crear) opción avanzada: túnel con nombre y dominio propio
│   ├── install-service.ps1             (crear) registra las dos tareas programadas
│   └── uninstall-service.ps1           (crear) las elimina
└── test/
    ├── helpers.js              (tocar) startApp acepta dataDir/password/now…; request añade X-Requested-With; loginAs
    ├── api.test.js             (tocar) before() hace login; peticiones con cookie y cabecera
    ├── auth.test.js            (crear) unitarios de lib/auth.js y lib/sessions.js
    ├── rate-limit.test.js      (crear) unitarios de lib/rate-limit.js y getClientIp
    ├── auth-api.test.js        (crear) integración: setup, login, logout, status, middleware, CSRF, 429, change-password, reinicio
    ├── config.test.js          (crear) readConfig, buildStartupLines, reset-password.js
    ├── tunnel.test.js          (crear) parsePublicUrl, extractTunnelUrl, runTunnel con spawn falso, publicUrl en status
    ├── render.test.js          (tocar) nuevas funciones puras + api-client.js
    ├── styles.test.js          (tocar) #auth-view, botones, .auth-card, pie sin "sin autenticación", #public-url
    └── deploy.test.js          (crear) tests estáticos de deploy/*.yml, *.ps1, docs/acceso-web.md y .gitignore

docs/acceso-web.md              (crear) guía paso a paso en español para Windows
docs/architecture.md            (tocar) sección de seguridad y despliegue (fase 2)
docs/verification.md            (tocar) nueva tabla de trazabilidad de la feature 2
```

## 3. Modelo de datos (directorio de datos)

### 3.1 `auth.json`

```json
{
  "version": 1,
  "algorithm": "scrypt",
  "salt": "9f86d081884c7d659a2feaa0c55ad015",
  "hash": "<128 caracteres hex = 64 bytes>",
  "params": { "N": 16384, "r": 8, "p": 1, "keylen": 64 },
  "sessionSecret": "<64 caracteres hex = 32 bytes>",
  "createdAt": "2026-10-25T10:00:00.000Z",
  "updatedAt": "2026-10-25T10:00:00.000Z"
}
```

- `salt`: `crypto.randomBytes(16)` nuevo en cada `hashPassword`. `sessionSecret`: `crypto.randomBytes(32)`, se genera en el setup y se **conserva** al cambiar la contraseña (las cookies vivas siguen verificando; se revocan por lista, no por secreto).
- Fichero "ilegible" = no parsea, o falta alguno de `salt`, `hash`, `sessionSecret`, o no son cadenas hex. En ese caso `/api/auth/status`, `login` y `setup` responden `500` con el mensaje de R5 y **nunca** se sobrescribe.
- La contraseña se usa tal cual (sin `trim`), codificada en UTF-8. Longitud válida: 10–128 caracteres (`[...password].length`).

### 3.2 `sessions.json`

```json
{
  "version": 1,
  "sessions": {
    "<id hex 64>": { "createdAt": 1761390000000, "lastSeenAt": 1761390000000, "expiresAt": 1763982000000 }
  }
}
```

- Tiempos en ms epoch (enteros) para comparar con `now()` sin parsear.
- `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000`; `TOUCH_INTERVAL_MS = 60 * 1000`.
- Carga perezosa en la primera petición (`ensureLoaded()`); JSON roto → `console.error('[panel] sessions.json ilegible, se ignora')` y mapa vacío (se sobrescribirá en la siguiente escritura).
- Al cargar y en cada `verify` se eliminan (y persisten) las sesiones con `expiresAt <= now`.

### 3.3 `public-url.txt`

Texto plano con una sola línea: la URL (`https://<sub>.trycloudflare.com` o, en la opción avanzada, la URL del dominio propio escrita a mano por el humano). Vacío = sin URL. `parsePublicUrl(text)`: `trim()`; devuelve el texto si empieza por `https://` y no contiene espacios; si no, `null`.

### 3.4 Otros ficheros del directorio

- `panel.log`: salida de `node server.js` cuando lo lanza la tarea programada (redirección en el `.ps1`).
- `cloudflared.log`: salida completa de cloudflared anexada por `runTunnel`.

## 4. API HTTP

### 4.1 Tabla de rutas (nuevas y existentes)

| Método | Ruta | Pública | Anti-CSRF | Respuesta | Requisitos |
|--------|------|---------|-----------|-----------|-----------|
| GET | `/api/auth/status` | sí | no | `200 { configured, authenticated, publicUrl }` / `500` | R1, R5, R22, R34 |
| POST | `/api/auth/setup` | sí (solo si no configurada) | sí | `201 { authenticated: true }` + cookie / `400` / `409` / `500` | R2–R5 |
| POST | `/api/auth/login` | sí | sí | `200 { authenticated: true }` + cookie / `400` / `401` / `409` / `429` / `500` | R8–R11, R23–R25 |
| POST | `/api/auth/logout` | sí | sí | `204` + cookie de borrado | R20 |
| POST | `/api/auth/change-password` | no | sí | `204` / `400` / `403` / `401` | R27–R29 |
| GET | `/api/projects`, `/api/projects/:id` | no | no | como fase 1 / `401` | R16, R17 |
| POST | `/api/projects` | no | sí | como fase 1 / `401` / `403` | R16, R17, R26 |
| DELETE | `/api/projects/:id` | no | sí | como fase 1 / `401` / `403` | R16, R17, R26 |
| * | `/api/...` desconocida | — | — | `403` si mutación sin cabecera; `401` si no autenticada; si no `404 { error: "Ruta no encontrada" }` | R4 (fase 1) |
| GET | `/`, estáticos | sí | no | como fase 1 | R33 |

### 4.2 Orden del middleware en `createApp` (`handle(req, res)`)

1. `pathname` no empieza por `/api` → estáticos (sin cambios).
2. Si `method` ∈ {`POST`, `DELETE`} y `req.headers['x-requested-with'] !== 'fetch'` → `403 { error: "Cabecera X-Requested-With requerida" }`. (Comparación exacta, sin distinguir mayúsculas en el valor: `String(v).toLowerCase() === 'fetch'`.)
3. `pathname` empieza por `/api/auth/` → `routeAuth` (§4.3).
4. Resto de `/api`: `session = await sessions.verify(parseCookies(req).muver_session, now())`; si `null` → `401 { error: "No autenticado" }`. Si válida → `touch` (§5.3) y, si renovó, `Set-Cookie`; después el enrutado de la fase 1 sin cambios.

Nota: `GET /api/auth/status` responde `publicUrl` leyendo el fichero en cada petición (`readPublicUrl`), sin caché, igual que el resto del estado del panel.

### 4.3 Cuerpos y errores

Todos los errores siguen el formato de la fase 1: `{ "error": "<texto en español>" }` y `"field"` cuando se refiere a un campo (`password`, `newPassword`, `currentPassword`). Textos exactos:

| Código | Texto | Cuándo |
|--------|-------|--------|
| 400 | `La contraseña debe tener entre 10 y 128 caracteres` (+ `field`) | setup / change-password |
| 400 | `Falta la contraseña` (`field: "password"`) | login sin `password` cadena |
| 400 | `Cuerpo JSON inválido` | como fase 1 (`readJsonBody`) |
| 401 | `Contraseña incorrecta` | login |
| 401 | `No autenticado` | middleware |
| 403 | `Cabecera X-Requested-With requerida` | mutación sin cabecera |
| 403 | `La contraseña actual no es correcta` (`field: "currentPassword"`) | change-password |
| 409 | `La contraseña ya está configurada` | setup repetido |
| 409 | `Contraseña no configurada` | login sin auth.json |
| 429 | `Demasiados intentos. Espera 15 minutos.` + `retryAfterSeconds` | límite de intentos |
| 500 | `Fichero de autenticación ilegible; ejecuta npm run reset-password` | auth.json roto |

Ejemplo de login:

```http
POST /api/auth/login
Content-Type: application/json
X-Requested-With: fetch

{ "password": "mi-contraseña-larga" }

→ 200
Set-Cookie: muver_session=3f…(64).a1…(64); HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
{ "authenticated": true }
```

### 4.4 Flujo de login en secuencia

```
Navegador                          panel (app.js)                         disco (<datos>/)
   | GET /api/auth/status ------------>|  loadAuth → ¿auth.json?               |
   |<-- 200 {configured, authenticated,|  readPublicUrl(public-url.txt)        |
   |        publicUrl} ----------------|                                       |
   | (UI: setup | login | panel)       |                                       |
   | POST /api/auth/login              |  1. cabecera X-Requested-With → 403?  |
   |   X-Requested-With: fetch ------->|  2. limiter.check(ip) → 429?          |
   |   {password}                      |  3. verifyPassword (scrypt +           |
   |                                   |     timingSafeEqual) → 401 + failure  |
   |                                   |  4. sessions.create(now) ------------>| sessions.json (+id)
   |<-- 200 + Set-Cookie --------------|  5. limiter.reset(ip)                 |
   | GET /api/projects (cookie) ------>|  verify(token): firma HMAC → id en     |
   |                                   |  mapa → expiresAt > now → touch       |
   |<-- 200 listado -------------------|                                       |
```

## 5. Módulos y funciones (contratos)

### 5.1 `lib/config.js`
- `readConfig(env = process.env, { panelDir }) → { port, dataDir, secureCookies, trustProxy }` (R31). `port`: misma regla que el `server.js` actual. `dataDir = path.resolve(panelDir, env.PANEL_DATA_DIR || 'data')`. `secureCookies = ['1','true'].includes(String(env.PANEL_SECURE_COOKIES).toLowerCase())`. `trustProxy = !['0','false'].includes(String(env.PANEL_TRUST_PROXY).toLowerCase())`.
- `buildStartupLines({ urls, dataDir, configured, publicUrl }) → string[]` (R32): `['Puesto de Mando MUVER escuchando en:', ...urls.map(u => '  ' + u), 'Directorio de datos: <dataDir>', 'Contraseña: configurada' | 'Contraseña: no configurada (abre el panel para crearla)', ...(publicUrl ? ['URL pública: ' + publicUrl] : []), 'Pulsa Ctrl+C para parar.']`.

### 5.2 `lib/http-utils.js` (añadidos)
- `parseCookies(req) → Record<string,string>` (cabecera `cookie`, separador `;`, `decodeURIComponent` tolerante).
- `COOKIE_NAME = 'muver_session'`.
- `buildSetCookie(value, { maxAge, secure }) → string`: `muver_session=<value>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<maxAge>` + `; Secure` si `secure`. Borrado: `buildSetCookie('', { maxAge: 0, secure })`. **El atributo solo-HTTPS de `requirements.md` es exactamente `Secure`.**
- `isHttpsRequest(req, { trustProxy, secureCookies }) → boolean`: `secureCookies || (trustProxy && String(req.headers['x-forwarded-proto']).split(',')[0].trim().toLowerCase() === 'https')`.
- `getClientIp(req, { trustProxy }) → string`: `trustProxy && req.headers['cf-connecting-ip']` (primer valor, recortado) o `req.socket.remoteAddress || 'unknown'`.

### 5.3 `lib/sessions.js`
- `signId(id, secret) → hex` = `createHmac('sha256', secret).update(id).digest('hex')`.
- `verifyToken(token, secret) → id | null`: formato `^([0-9a-f]{64})\.([0-9a-f]{64})$`; recalcula la firma y compara con `timingSafeEqual` sobre `Buffer.from(hex, 'hex')`; devuelve `id` o `null`. Nunca lanza.
- `createSessionStore({ file, secret, now = () => Date.now(), ttlMs = SESSION_TTL_MS, touchIntervalMs = TOUCH_INTERVAL_MS })` →
  - `ensureLoaded()`; `create() → { id, token, expiresAt }` (persiste); `verify(token) → { id, ...session } | null` (elimina caducadas y persiste si eliminó); `touch(id) → { renewed: boolean }` (renueva si `now - lastSeenAt >= touchIntervalMs`; persiste solo al renovar); `destroy(id)`; `destroyOthers(id)`; `count()`.
  - Persistencia atómica (`writeFile` a `.tmp` + `rename`), `mkdir` recursivo del directorio.

### 5.4 `lib/auth.js`
- `MIN_PASSWORD_LENGTH = 10`, `MAX_PASSWORD_LENGTH = 128`, `SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 }`.
- `validatePassword(value) → { ok: true } | { ok: false, error: 'La contraseña debe tener entre 10 y 128 caracteres' }`.
- `hashPassword(password, { salt = randomBytes(16), params = SCRYPT_PARAMS }) → Promise<{ salt: hex, hash: hex, params }>` con `promisify(crypto.scrypt)` y `maxmem` suficiente (`128 * N * r * 2`).
- `verifyPassword(password, record) → Promise<boolean>`: recalcula con el `salt`/`params` del registro y compara con `timingSafeEqual`; longitudes distintas o hex inválido → `false`.
- `createAuthRecord(password) → Promise<AuthRecord>` (§3.1, `sessionSecret = randomBytes(32).toString('hex')`).
- `loadAuth(file) → Promise<{ state: 'missing' } | { state: 'ok', record } | { state: 'corrupt' }>`.
- `saveAuth(file, record) → Promise<void>` (atómico).

### 5.5 `lib/rate-limit.js`
- `createRateLimiter({ maxFailures = 5, windowMs = 15*60*1000, blockMs = 15*60*1000, now })` →
  - `check(key) → { blocked: false } | { blocked: true, retryAfterMs }`.
  - `recordFailure(key)`: si `now - lastFailureAt > windowMs` reinicia el contador; incrementa; si llega a `maxFailures` → `blockedUntil = now + blockMs`.
  - `reset(key)`: borra la entrada. `check` borra la entrada si `blockedUntil <= now` (bloqueo expirado → contador a cero).
  - Estado: `Map<key, { failures, lastFailureAt, blockedUntil }>` en memoria.

### 5.6 `lib/public-url.js`
- `parsePublicUrl(text) → string | null` (§3.3). `readPublicUrl(file) → Promise<string|null>` (ENOENT → `null`).

### 5.7 `lib/tunnel.js`
- `TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/`; `extractTunnelUrl(line) → string | null`.
- `runTunnel({ bin = 'cloudflared', args = ['tunnel', '--url', 'http://localhost:4310'], dataDir, spawn = child_process.spawn, log = console.log }) → Promise<number>`: `spawn(bin, args, { windowsHide: true })`; por cada línea de `stdout`/`stderr`: anexa a `cloudflared.log`, y si `extractTunnelUrl` devuelve URL (y aún no se había escrito) la escribe en `public-url.txt` y la imprime (`URL pública: …`). En `exit` (o `error` del spawn, p. ej. cloudflared no instalado → imprime `No se pudo ejecutar cloudflared: <mensaje>`), vacía `public-url.txt` y resuelve con `code ?? 1`.

### 5.8 `scripts/run-tunnel.js` y `scripts/reset-password.js`
- `run-tunnel.js`: `readConfig(process.env, { panelDir })`; `bin = process.env.CLOUDFLARED_BIN || 'cloudflared'`; `args` con el puerto de `config.port`; `process.exit(await runTunnel(...))`.
- `reset-password.js`: `readConfig` → borra `auth.json` y `sessions.json` (`fs.rm` con `force`), detecta si existían para elegir el mensaje de R30; código 0.

### 5.9 `lib/app.js` (cambios)
- `createApp({ projectsFile, publicDir, dataDir, now, runner, trustProxy = true, secureCookies = false })`; `dataDir` obligatorio (`throw` si falta, como los otros dos).
- Estado interno: `authFile`, `sessionsFile`, `publicUrlFile`; `authState` cacheado tras la primera carga (`loadAuth`) y actualizado por setup/change-password; `sessions` creado perezosamente cuando hay `record.sessionSecret`; `limiter = createRateLimiter({ now })`.
- `routeAuth` implementa §4.1–§4.3. En `login`: `check` → `429` (cabecera `Retry-After: Math.ceil(retryAfterMs/1000)`); `validate` cuerpo → `400`; `verifyPassword` → `401` + `recordFailure`; éxito → `reset(ip)` + `create` + cookie. En `change-password`: exige sesión (`401`), `validatePassword(newPassword)` → `400`, `verifyPassword(currentPassword)` → `403` + `recordFailure`; éxito → `hashPassword` nuevo, `saveAuth`, `destroyOthers(session.id)`, `204`.
- `setup` tras éxito también crea sesión y devuelve cookie (`201`).

### 5.10 `server.js`
- `const config = readConfig(process.env, { panelDir: PANEL_DIR })`; `createApp({ ..., dataDir: config.dataDir, trustProxy, secureCookies })`; en `listen`: `loadAuth` + `readPublicUrl` y `console.log(buildStartupLines(...).join('\n'))`.

### 5.11 Frontend
- `public/app-config.js`: añade `MIN_PASSWORD_LENGTH = 10`, `MAX_PASSWORD_LENGTH = 128`.
- `public/api-client.js`: `createApiClient({ fetch = globalThis.fetch, onUnauthorized = () => {} }) → request(url, init)`: añade `Accept`, `X-Requested-With: fetch`, `Content-Type` si hay body, `credentials: 'same-origin'`; parsea JSON (204 → `null`); si `!res.ok` lanza `Error` con `status` y `payload`; si `status === 401` y `url` no termina en `/api/auth/login` → `onUnauthorized()` antes de lanzar. Sustituye a la función `request` interna de `app.js`.
- `public/render.js` (puras, devuelven strings o valores):
  - `resolveAuthView({ configured, authenticated })` → `'setup' | 'login' | 'panel'`.
  - `renderAuthForm(mode)` → `<form id="auth-form" data-mode="setup|login">` con `<h2>` "Crear contraseña" / "Iniciar sesión", `<input type="password" name="password" autocomplete="new-password|current-password" minlength=10>`, en setup además `name="confirm"` y un párrafo explicando que es la contraseña única del panel, `<div id="auth-error">`, botón `.btn.primary` "Crear contraseña" / "Entrar".
  - `renderAuthError(message)` → `<p class="form-error" role="alert">…</p>` (reutiliza estilos de `renderFormError`).
  - `validateNewPassword(password, confirm)` → `{ ok: true } | { ok: false, error }` con los textos de R38.
  - `renderChangePasswordForm()` → `<form id="change-password-form">` con `currentPassword`, `newPassword`, `confirm`, botón "Guardar contraseña" y botón "Cancelar" (`data-action="cancel-change"`).
  - `buildChangePasswordPayload(formValues)` → `{ currentPassword, newPassword }`.
  - `handleLogout({ request })` → `await request('/api/auth/logout', { method: 'POST' }); return true`.
  - `renderPublicUrl(url)` → `''` si `null`; si no `<a class="public-url" href="<esc>" target="_blank" rel="noopener">URL pública: <esc></a>`.
- `public/index.html`: en `.topbar-inner` añadir `<div id="public-url" class="public-url-slot"></div>` y `<nav class="topbar-actions" id="session-actions" hidden><button type="button" class="btn" id="change-password-button">Cambiar contraseña</button><button type="button" class="btn" id="logout-button">Salir</button></nav>`; en `<main>` añadir `<section id="auth-view" class="auth-card" hidden></section>` y `<section id="change-password-view" class="auth-card" hidden></section>`; `#list-view` arranca `hidden`; pie: "Acceso protegido por contraseña. Se actualiza automáticamente cada minuto."
- `public/app.js`: `boot()` → `status = await api('/api/auth/status')` → `renderPublicUrl` → `resolveAuthView` → `showAuth(mode)` o `showPanel()`. `showPanel()` quita `hidden` a `#list-view` y `#session-actions`, llama a `load()` y arranca el `setInterval` (una sola vez; `load()` sale si `!authenticated`). `onUnauthorized` → `authenticated = false`, `showAuth('login')`. Submit de `#auth-form`: validación local en setup (R38) → `POST /api/auth/setup|login` → éxito `showPanel()`; `4xx` → `renderAuthError(err.payload.error)`. "Salir" → `handleLogout` → `showAuth('login')`. "Cambiar contraseña" → muestra `#change-password-view`; submit → `validateNewPassword` → `POST /api/auth/change-password` → `role="status"` "Contraseña cambiada" / `role="alert"` error.
- `public/styles.css`: `.auth-card { width: 100%; max-width: 100%; margin: 16px auto; padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; }`, `.auth-card input { width: 100%; }`, `@media (min-width: 601px) { .auth-card { max-width: 28rem; } }` (en `rem`, no en px, para no chocar con el test de anchos), `.topbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }`, `.public-url { word-break: break-all; }`.

## 6. Tests (`node --test`, sin dependencias)

- `test/helpers.js`:
  - `startApp(options)`: si no recibe `dataDir`, crea uno temporal (`makeTempDir('muver-data-')`) y lo devuelve en el resultado; si recibe `password`, escribe `auth.json` con `createAuthRecord(password)` antes de arrancar; acepta `now`, `trustProxy`, `secureCookies`. Devuelve `{ server, baseUrl, dataDir, close, login(password?) → Promise<cookieHeader> }`.
  - `request(baseUrl, path, init)`: añade `X-Requested-With: fetch` a `POST`/`DELETE` salvo `init.csrf === false`; `init.cookie` → cabecera `Cookie`; devuelve además `setCookie` (valor de `Set-Cookie` o `null`).
  - `makeClock(start)` → `{ now: () => current, advance(ms) }` para `now` inyectado.
  - `parseSetCookie(header) → { name, value, attributes: Set<string> }` (atributos en minúsculas, p. ej. `httponly`, `secure`, `samesite=lax`, `max-age=2592000`).
- Nombres de test: `[F2-R<n>] …` (prefijo `F2-` para distinguirlos de los `[R<n>]` de la fase 1 en `docs/verification.md`).
- Los tests de integración de `api.test.js` hacen login en `before` con la contraseña del `startApp` y pasan `cookie` en cada petición; el test "[R4] excepción inesperada…" también debe autenticarse (el `runner` roto solo se invoca tras pasar el middleware).
- scrypt con `N = 16384` tarda decenas de ms por verificación: los tests del límite de intentos (≈ 6–12 verificaciones) siguen por debajo de 2 s.
- Tests estáticos (`deploy.test.js`) leen ficheros y buscan cadenas exactas (R7, R44–R46); los requisitos **[MANUAL]** se anotan en `docs/verification.md` como "MANUAL — pendiente del humano" hasta que los ejecute.

## 7. Ficheros que NO se tocan

- `panel/lib/project-state.js`, `panel/lib/git-info.js`, `panel/lib/registry.js`, `panel/lib/network.js`, `panel/projects.json`, `panel/legacy/`.
- `.claude/`, `CLAUDE.md`, `AGENTS.md`, `CHECKPOINTS.md`, `GUIA-SDD.html`, `sdd-lint.js`, `init.sh` (ya ejecuta `npm test`; no hace falta cambiarlo).
- `docs/specs.md`, `docs/constitution.md`, `docs/conventions.md`, `docs/context_map.json`, `sdd-descubrimiento/`, `specs/_ejemplo-feature/`, `specs/puesto-de-mando-base/`.
- `feature_list.json` y `progress/` los gestiona solo el leader.
- De `docs/architecture.md` solo se añade/actualiza la sección de seguridad y despliegue y se corrige la mención a Tailscale (ahora Cloudflare Tunnel); el resto se mantiene.

## 8. Alternativas consideradas y descartadas

| Alternativa | Por qué se descarta |
|-------------|---------------------|
| JWT (token autocontenido sin lista en servidor) | No permite logout real ni revocar sesiones al cambiar la contraseña sin añadir una lista negra, que acaba siendo lo mismo que `sessions.json`. El token firmado + lista blanca es más simple y revocable. |
| `bcrypt`/`argon2` vía npm | Rompe la regla "sin dependencias"; requieren compilación nativa en Windows. `scrypt` nativo de Node es equivalente para este uso. |
| HTTP Basic Auth | Sin pantalla de login propia, sin logout, la contraseña viaja en cada petición, mala experiencia en móvil y sin límite de intentos integrable con la UI. |
| Tailscale / VPN | Exige instalar un cliente en cada móvil/PC y cuenta en un tercero; el humano decidió Cloudflare Tunnel (URL pública normal). Sigue siendo válido como alternativa personal, fuera del repo. |
| Servidor en la nube (VPS/PaaS) | Los proyectos y Claude Code viven en el PC Windows; el panel debe leer ese disco. Mover el panel obligaría a sincronizar datos. |
| NSSM / WinSW para el servicio de Windows | Binario externo que hay que descargar y mantener; las tareas programadas nativas (`Register-ScheduledTask`) cubren el arranque con el PC sin añadir nada. |
| Servicio Windows real (`sc create`) con Node | Node no implementa el protocolo de control de servicios sin un wrapper; una tarea programada S4U consigue el mismo efecto práctico. |
| Cloudflare Access (SSO de Cloudflare) como única autenticación | Depende de cuenta/plan y de dominio propio; se documenta como capa opcional delante del panel en la opción avanzada, pero el panel debe seguir protegido por sí mismo (p. ej. en la LAN). |
| Rate limit persistido en disco | Complejidad extra para un beneficio marginal: reiniciar el panel exige acceso al PC. |
| Parsear la salida de cloudflared en PowerShell | Menos portable y no testeable en Linux; hacerlo en Node (`lib/tunnel.js`) permite un `spawn` falso en los tests y sirve igual en Windows. |

## 9. Guía `docs/acceso-web.md` (estructura obligatoria)

1. **Qué vas a conseguir** (una URL `https://` para móvil y PC; el PC sigue siendo el servidor).
2. **Antes de empezar**: Node >= 18, el panel arranca con `npm start`, crear la contraseña la primera vez abriendo `http://localhost:4310`.
3. **Paso a paso principal: URL temporal de Cloudflare** — `winget install Cloudflare.cloudflared` (o descarga del `.msi`), prueba manual `cloudflared tunnel --url http://localhost:4310`, dónde aparece la URL `https://….trycloudflare.com`, limitaciones (cambia en cada arranque, servicio gratuito sin garantía).
4. **Dejarlo arrancando con el PC** — `install-service.ps1` (PowerShell como administrador; `Set-ExecutionPolicy -Scope Process Bypass`; parámetros `-Port`, `-NoTunnel`), qué dos tareas crea, dónde están los logs (`panel\data\panel.log`, `panel\data\cloudflared.log`), cómo leer la URL actual (`panel\data\public-url.txt` o el encabezado del panel desde `http://<ip-lan>:4310` en el móvil), `uninstall-service.ps1`.
5. **Variables de entorno** (tabla `PORT`, `PANEL_DATA_DIR`, `PANEL_SECURE_COOKIES`, `PANEL_TRUST_PROXY`, `CLOUDFLARED_BIN`) y cómo fijarlas para la tarea (`setx`, variables de usuario; la tarea S4U las lee al arrancar).
6. **Si olvidas la contraseña**: `npm run reset-password` en `panel\`, reiniciar el panel, volver a crearla.
7. **Opción avanzada: dominio propio** — `cloudflared tunnel login`, `cloudflared tunnel create muver`, `cloudflared tunnel route dns muver panel.tudominio.com`, copiar `cloudflared-config.example.yml` a `%USERPROFILE%\.cloudflared\config.yml`, `cloudflared service install`, escribir la URL fija en `public-url.txt`, recomendación opcional de Cloudflare Access.
8. **Problemas frecuentes**: puerto ocupado, `cloudflared` no en PATH, tarea en estado `Ready` pero sin escuchar (ver `panel.log`), cookie no guardada (`PANEL_SECURE_COOKIES=1` en LAN).

## 10. Scripts PowerShell (contrato)

- `install-service.ps1 [-Port 4310] [-NoTunnel] [-TaskName PuestoDeMandoMUVER]`: localiza `node.exe` (`Get-Command node`), resuelve la carpeta `panel\` relativa al script, crea `panel\data\`, registra:
  - Tarea `PuestoDeMandoMUVER`: acción `cmd.exe /c "<node> server.js >> data\panel.log 2>&1"` con `WorkingDirectory = panel\`; disparadores `New-ScheduledTaskTrigger -AtStartup` y `-AtLogOn`; `New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -Hidden`; principal `New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited`; `Register-ScheduledTask -Force`.
  - Tarea `PuestoDeMandoMUVER-Tunnel` (salvo `-NoTunnel`): acción `<node> scripts\run-tunnel.js` con la misma carpeta de trabajo y los mismos disparadores/ajustes; antes comprueba `Get-Command cloudflared` y, si falta, avisa y no registra la tarea del túnel.
  - Al final `Start-ScheduledTask` de ambas y muestra `Get-ScheduledTask`.
- `uninstall-service.ps1 [-TaskName PuestoDeMandoMUVER]`: `Stop-ScheduledTask` + `Unregister-ScheduledTask -Confirm:$false` de ambas tareas (ignorando si no existen).
- Ambos con `#requires -RunAsAdministrator`, comentarios en español y sin descargar nada.

## 11. Riesgos y notas de implementación

- **Node 18 y `fetch` en tests:** `fetch` no sigue redirecciones ni gestiona cookies: los tests pasan la cabecera `Cookie` a mano (ya previsto en `helpers.request`).
- **`timingSafeEqual` lanza si las longitudes difieren:** comprobar `a.length === b.length` antes y devolver `false`.
- **Doble `Set-Cookie`:** al renovar la sesión en una ruta que también envía JSON, usar `res.setHeader('Set-Cookie', …)` antes de `sendJson` (que usa `writeHead` con cabeceras adicionales; ajustar `sendJson` para no pisar cabeceras ya puestas: `writeHead(status, {...})` conserva las fijadas con `setHeader`).
- **Un solo `Set-Cookie` por respuesta:** basta (una cookie).
- **Windows y rutas:** `path.resolve(panelDir, env.PANEL_DATA_DIR)` acepta `C:\...` absolutas y relativas; `windowsHide: true` en `spawn`.
- **Scrypt y memoria:** pasar `maxmem: 64 * 1024 * 1024` para N=16384 (necesita ~16 MB).
- **Cambios en `api.test.js`:** mínimo imprescindible (login en `before`, `cookie` en `request`); la lógica probada no cambia.
- **UI sin sesión:** el `setInterval` de refresco debe arrancar solo tras `showPanel()` y `load()` debe salir si `!authenticated` para no generar `401` en bucle.
- **`CF-Connecting-IP` falsificable desde la LAN:** con proxy de confianza, un cliente en la LAN puede cambiar la cabecera para esquivar el límite por IP; se acepta (red de confianza) y se documenta `PANEL_TRUST_PROXY=0` para quien no use Cloudflare.
