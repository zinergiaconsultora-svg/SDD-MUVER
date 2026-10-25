# Revisión — Feature 2: `puesto-de-mando-acceso-web`

**Veredicto: RECHAZADO** por un único defecto bloqueante, pequeño y acotado (ver B1). El resto de la feature está
en orden: `init.sh` en verde (167 tests), trazabilidad R1–R50 completa, diseño respetado, sin bypass del middleware,
sin fugas de secretos. Corregido B1 (con su test), la revisión pasa a APROBADO. T30/T31 (manuales del humano en
Windows/Internet) quedan pendientes y no son motivo de rechazo.

## Checklist

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad R1–R50 ↔ tests | OK. R1–R46 tienen tests automáticos reales, leídos uno a uno (integración con app real en puerto 0, `now` inyectado, ficheros temporales; unitarios de auth/sesiones/limitador/config/túnel; estáticos de deploy/guía). R47–R50 son **[MANUAL]** por la propia spec y constan así en `docs/verification.md`. No hay tests triviales ni falsos positivos (comprueban código, cuerpo exacto, cabeceras, ficheros antes/después). |
| 2 | `bash init.sh` desde la raíz | OK: 167 tests, 0 fallos, `sdd-lint` 0 errores/0 advertencias, salida 0 (Node 22.22). Aviso TDD de `init.sh` es porque el árbol está limpio (todo commiteado). |
| 3 | Tareas de `tasks.md` | T1–T29 y T32–T34 `[x]`; T30 y T31 `[ ]` (manuales del humano). |
| 4 | Convenciones | OK: código en inglés, comentarios y textos visibles en español, `camelCase`/`MAYUSCULAS`, errores capturados con mensaje útil, nada sensible en respuestas ni logs (no se registran contraseñas, cookies ni hashes; `console.error` solo recibe método, URL y stack). Excepción: B1 (una petición puede quedarse sin respuesta). |
| 5 | Checkpoints | Pendiente B1; el registro en `progress/history.md` corresponde al leader al pasar a `done`. |
| 6 | Diseño (`design.md`) | OK: rutas y textos de error exactos (§4.1/§4.3), orden del middleware §4.2 (estáticos → anti-CSRF → `/api/auth/*` → sesión), cookie `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` + `Secure` solo con `X-Forwarded-Proto: https` (proxy de confianza) o `secureCookies`, scrypt N=16384/r=8/p=1/keylen=64 con `maxmem`, `timingSafeEqual` en hash y firma con comprobación previa de longitud, HMAC-SHA256 del id, lista blanca en `sessions.json`, renovación deslizante a 60 s, limitador 5/15 min por IP, escritura atómica `.tmp`+`rename` con `mkdir` recursivo, `.gitignore` con `panel/data/` y negaciones del arnés intactas. Ficheros "NO tocar" (§7) sin cambios entre `2919310` y `HEAD`; `docs/architecture.md` solo amplía lo previsto y sustituye Tailscale. Extras no previstos e inocuos: `tunnel.log` para la salida del lanzador (documentado en la guía), cierre de procesos `node.exe` huérfanos en `uninstall-service.ps1`, `-UserId "$env:USERDOMAIN\$env:USERNAME"` en vez de `$env:USERNAME`. |

## Seguridad (mentalidad de atacante) — sondeo sobre la app real

Comprobado con peticiones reales (script temporal, no incluido en el repo):

- **Bypass del middleware:** `/API/projects`, `/Api/auth/status`, `//api/projects` → 404 (van a estáticos; no existe
  tal fichero); `/api//projects`, `/api/auth/../projects`, `/api/auth/%2e%2e/projects`, `/api/projects?x=1`,
  `/api/projects/`, `/api/projects%2f`, `/api`, `HEAD`, `OPTIONS`, `PUT` → 401 sin sesión. `PATCH /api/auth/login`
  → 404. Enrutado y comprobación de sesión usan el mismo `pathname` normalizado por `URL`; no hay ruta pública fuera
  de las cinco de `routeAuth`. Sin bypass.
- **Anti-CSRF:** `POST` sin cabecera → 403 antes de la sesión y sin contar fallo; `Fetch`/`FETCH` aceptados (diseño).
- **Fijación de sesión:** el login ignora la cookie entrante y emite siempre un id nuevo (`randomBytes(32)`); la
  renovación reenvía solo el token ya verificado. Logout borra la entrada y manda `Max-Age=0`. OK.
- **Timing:** `verifyPassword` siempre deriva scrypt y compara con `timingSafeEqual`; `verifyToken` valida formato
  por regex y compara en tiempo constante. No hay enumeración posible (una sola contraseña).
- **Fuga de hash/secret:** `/api/auth/status` devuelve solo `configured/authenticated/publicUrl`; errores 500
  genéricos; `auth.json` fuera de `public/` y de git. `GET /data/auth.json` → 404.
- **Path traversal en estáticos:** `/../package.json`, `/%2e%2e/package.json`, `/..%5cpackage.json`,
  `/%5c..%5c..%5cetc/passwd` → 404. Intacto respecto a la fase 1.
- **XSS vía `public-url.txt`:** `https://x.com/"onmouseover="alert(1)` pasa `parsePublicUrl` (sin espacios) pero
  `renderPublicUrl` escapa `"` → `&quot;` en `href` y texto; el `href` siempre empieza por `https://` (sin
  `javascript:`). Contenido multilínea → `null`. OK.
- **`CF-Connecting-IP` falsa con `PANEL_TRUST_PROXY=1` (por defecto):** desde la LAN un cliente puede cambiar la
  cabecera en cada intento y esquivar el bloqueo por IP (verificado: cada valor tiene su contador). Desde Internet
  no es posible: Cloudflare sobrescribe la cabecera. Riesgo aceptado explícitamente en `design.md` §11 y
  documentado en la guía (§5, `PANEL_TRUST_PROXY=0`). Valoración: aceptable para red local de confianza; anotado
  como mejora M2.
- **Inyección en logs:** solo `req.method`/`req.url` (sin CR/LF posibles en la línea de petición) y mensajes fijos.
  Las contraseñas viajan en el cuerpo y nunca se registran.

## Hallazgos

### Bloqueantes

**B1. Cuerpo JSON cuyo valor es falsy deja la petición sin respuesta (cuelgue)** — `panel/lib/app.js:102-109` y
`:127, :150, :174, :217`. R10 (y R3, R29, R20 de la fase 1).
`readBody()` devuelve `null` cuando ya ha respondido 400, y los llamantes hacen `if (!body) return undefined;`.
Pero si el cuerpo es el literal JSON `null`, `false`, `0` o `""`, `readJsonBody` lo parsea con éxito, `readBody`
devuelve ese valor falsy **sin haber respondido**, y el handler sale sin enviar nada: la conexión queda abierta
hasta el `requestTimeout` de Node (300 s). Reproducido: `POST /api/auth/login` con cuerpo `null` → sin respuesta
(timeout); `POST /api/auth/change-password` con cookie válida y cuerpo `null` → igual. Afecta a una ruta
**pública** (login/setup) y es una regresión respecto a la fase 1 (que no tenía `readBody` y respondía 400).
R10 exige `400 { "error": "Falta la contraseña", "field": "password" }` cuando falta `password`.
*Corrección:* en `readBody` distinguir "ya respondí" del valor parseado (p. ej. devolver un objeto
`{ ok: true, body }` / `{ ok: false }`, o rechazar en `readJsonBody` todo lo que no sea un objeto plano con
`400 Cuerpo JSON inválido`), y añadir un test `[F2-R10]` que envíe `null`, `""`, `0` y `[]` a login/setup/
change-password y a `POST /api/projects` comprobando 400 en todos.

### Mejoras (no bloquean; candidatas a tarea `sdd: false`)

**M1. `change-password` no consulta el limitador (`limiter.check`)** — `panel/lib/app.js:170-181`, R28.
Registra el fallo (`recordFailure`) pero nunca bloquea: quien tenga una cookie robada puede probar contraseñas
actuales sin límite (a ~50 ms por scrypt) para obtener la contraseña y mantener acceso tras una revocación.
Cumple la spec tal cual está escrita (R28 solo pide "contar el fallo"); recomiendo añadir `check` → 429 también
en esta ruta y reflejarlo en `design.md` §5.9.

**M2. `install-service.ps1` resuelve la ruta completa de `cloudflared` y luego la descarta** —
`panel/deploy/install-service.ps1:91-103`, R46/R49. La tarea S4U arranca sin cargar el perfil de usuario, así que
el `PATH` de usuario (donde `winget` instala a veces) y las variables fijadas con `setx` pueden no estar
disponibles; `run-tunnel.js` haría `spawn cloudflared ENOENT` aunque el script lo hubiera encontrado. Pasar la ruta
en la línea de `cmd` (`set CLOUDFLARED_BIN=<ruta>&& …`) como ya se hace con `PORT` y con `node.exe` elimina el
riesgo. Afecta también a la afirmación de la guía §5 sobre `setx`. Lo detectará T30/T31 si ocurre.

**M3. `CF-Connecting-IP` falsificable desde la LAN con el valor por defecto `PANEL_TRUST_PROXY=1`** (ver sección
de seguridad). Alternativa barata: aceptar la cabecera solo si `remoteAddress` es loopback (cloudflared corre en el
mismo PC) o seguir documentando `PANEL_TRUST_PROXY=0`. Decisión del humano.

**M4. Carrera en el primer `setup`** — `panel/lib/app.js:122-136`, R2/R4. Dos `setup` concurrentes pasan ambos
la comprobación `missing` antes de leer el cuerpo; el segundo sobrescribe `auth.json` con otro `sessionSecret`
mientras el almacén de sesiones conserva el primero (cookies inválidas tras reinicio). Solo durante la ventana de
primer arranque; la guía ya indica crear la contraseña desde `localhost` antes de publicar. Un cerrojo en memoria
(`setupInProgress`) lo evita. Relacionado: tras `npm run reset-password` el panel queda abierto a quien primero
llegue a la URL pública hasta que el humano cree la contraseña (S7); conviene decirlo en la guía §6 (parar el túnel
o crearla de inmediato).

**M5. `uninstall-service.ps1` no cierra `cloudflared.exe`** — `panel/deploy/uninstall-service.ps1:157-164`.
Mata los `node.exe` del panel pero el hijo `cloudflared` sigue vivo hasta reiniciar (el túnel sigue publicando el
puerto). Añadir el mismo barrido para `cloudflared.exe` cuyo `CommandLine` contenga `--url http://localhost:`.

**M6. `PATCH`/`PUT` no pasan por la comprobación anti-CSRF** — `panel/lib/app.js:27`. Hoy no hay rutas con esos
métodos (responden 401/404), pero si la fase 4 las añade conviene que `MUTATING_METHODS` sea "todo lo que no sea
`GET`/`HEAD`".

### Notas

- **S4U en Windows (T30):** requiere que el usuario tenga el derecho "Iniciar sesión como proceso por lotes" (lo
  tienen los administradores) y da problemas conocidos con cuentas Microsoft (MSA) en algunos equipos. Si la tarea
  queda en `Ready` sin ejecutarse con código `0x80070569`/`0x8007052E`, la alternativa es `-LogonType Password`
  o `ServiceAccount`. La guía §8 ya remite a `panel.log`.
- **`-ExecutionTimeLimit (New-TimeSpan -Seconds 0)`** es la forma correcta de "sin límite" (`PT0S`) en PS 5.1;
  los `.ps1` van en UTF-8 con BOM y CRLF (correcto para PS 5.1 con `ñ`/acentos). `cmd.exe /c "set PORT=…&& "node"
  … >> "log" 2>&1"` sigue la regla de comillas de `cmd` (más de dos comillas → quita la primera y la última):
  correcto, incluso con espacios en las rutas.
- **Guía ↔ código:** nombres de tareas, rutas (`panel\data\*.log`, `public-url.txt`, `tunnel.log`), variables,
  mensajes (`Contraseña y sesiones eliminadas…`, `No se pudo ejecutar cloudflared: spawn cloudflared ENOENT`,
  `Fichero de autenticación ilegible…`) y comandos coinciden con lo que hace el código. Sección 7 coherente con
  `cloudflared-config.example.yml`.
- **Portabilidad Windows:** rutas con `path.join/resolve`, `spawn`/`execFile` con `windowsHide`, `fs.rename`
  sobre fichero existente, BOM tolerado al leer JSON/`public-url.txt`, `PANEL_DATA_DIR` absoluto `C:\…` o
  relativo. Tests con `os.tmpdir()`.
- **Limitador en memoria** (S2) y **`panel.log` sin rotación**: aceptados por diseño; si el panel vive meses, el
  log crece sin límite (anotar para una fase posterior).
- `docs/verification.md` ya incluye las filas R47–R50 como "MANUAL — pendiente del humano"; falta que el humano
  anote fecha y resultado tras T30/T31.
- No existe `progress/impl_puesto-de-mando-acceso-web.md`; el estado está en `progress/current.md`. Sin impacto.

## Para el implementer

1. Corregir **B1** en `panel/lib/app.js` (`readBody` y sus cuatro llamantes) y añadir el test `[F2-R10]` descrito.
2. Opcional pero recomendado en la misma pasada (son líneas sueltas): **M1** (`limiter.check` en change-password)
   y **M2** (`set CLOUDFLARED_BIN=…` en `install-service.ps1`), actualizando `design.md` §5.9/§10 si se hace.
3. Ejecutar `bash init.sh` y devolver a revisión.

## Para el leader

- No marcar `done` hasta que B1 esté corregido y `init.sh` siga en verde.
- T30/T31 siguen a cargo del humano; sus resultados van a `docs/verification.md` (R47–R50) y, si M2 se materializa
  en su PC, la causa está descrita arriba.
