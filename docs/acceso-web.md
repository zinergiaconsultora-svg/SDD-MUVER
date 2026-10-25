# docs/acceso-web.md — Acceder al Puesto de Mando desde Internet (móvil y PC)

> **¿Qué es esto, en cristiano?** La guía paso a paso para que el panel que corre en tu PC Windows
> se pueda abrir desde cualquier sitio con una dirección `https://`, protegido por tu contraseña,
> y para que arranque solo cada vez que enciendes el PC. Está pensada para seguirla de arriba abajo
> sin saber de redes. Lo técnico está en `specs/puesto-de-mando-acceso-web/design.md`.

## 1. Qué vas a conseguir

- Una dirección **`https://…`** que funciona desde el móvil (con datos o con cualquier Wi-Fi) y desde
  cualquier PC, con pantalla de **inicio de sesión por contraseña**.
- **Tu PC sigue siendo el servidor**: el panel lee tus proyectos de tu disco. No se sube nada a la nube.
  Si el PC está apagado, el panel no está disponible.
- Cero puertos abiertos en el router y sin IP fija: usamos **Cloudflare Tunnel**, una conexión *saliente*
  desde tu PC a Cloudflare que reenvía las visitas a `http://localhost:4310`.
- El panel y el túnel **arrancan con Windows** (sin ventanas abiertas) mediante dos tareas programadas.
- En la red local (misma Wi-Fi) todo sigue funcionando como antes en `http://<ip-de-tu-pc>:4310`, también
  con contraseña.

## 2. Antes de empezar

1. **Node.js 18 o superior** instalado (`node --version` en PowerShell debe responder `v18`, `v20`, `v22`…).
2. El panel arranca a mano con:
   ```powershell
   cd C:\ruta\a\SDD-MUVER\panel
   npm start
   ```
   y en la consola aparece `Puesto de Mando MUVER escuchando en:` seguido de las URLs, `Directorio de datos: …`
   y `Contraseña: no configurada (abre el panel para crearla)` la primera vez.
3. **Crea la contraseña la primera vez**: abre `http://localhost:4310` en el navegador del PC. Verás la pantalla
   **Crear contraseña** (de 10 a 128 caracteres, se pide dos veces). Es la **única** contraseña del panel: la
   usarás en el móvil y en el PC. Se guarda cifrada (hash scrypt) en `panel\data\auth.json`; ese directorio
   está fuera de git.
4. Comprueba desde el móvil en la misma Wi-Fi: `http://<ip-de-tu-pc>:4310` (la IP la imprime `npm start`).
   Debe pedirte la contraseña y mostrar los proyectos.

Si esto funciona, el resto es solo "publicar" esa misma web.

## 3. Paso a paso principal: URL temporal de Cloudflare

Es el camino **gratuito, sin cuenta y sin dominio**. Cloudflare te da una dirección del tipo
`https://palabra-palabra-123.trycloudflare.com`.

### 3.1 Instalar cloudflared

En PowerShell (no hace falta administrador):

```powershell
winget install Cloudflare.cloudflared
```

Si no tienes `winget`, descarga el instalador `.msi` de Windows desde la página de descargas de
`cloudflared` (Cloudflare Zero Trust → Connectors) y ejecútalo. Cierra y vuelve a abrir PowerShell y
comprueba que responde:

```powershell
cloudflared --version
```

### 3.2 Prueba manual del túnel

Con el panel arrancado (`npm start` en otra ventana), ejecuta:

```powershell
cloudflared tunnel --url http://localhost:4310
```

Al cabo de unos segundos, entre las líneas de la consola aparece un recuadro con tu URL:

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://palabra-palabra-123.trycloudflare.com                                             |
+--------------------------------------------------------------------------------------------+
```

Ábrela desde el móvil **con los datos móviles** (Wi-Fi apagada): debe salir la pantalla **Iniciar sesión**,
aceptar tu contraseña y mostrar los proyectos. Para parar el túnel, `Ctrl+C`.

### 3.3 Limitaciones que debes conocer

- **La URL cambia cada vez que arranca `cloudflared`.** Por eso, cuando el túnel lo lanza el panel
  (siguiente sección), la URL actual se guarda en `panel\data\public-url.txt` y se muestra en el
  **encabezado del panel**, también en la pantalla de login: desde el móvil en la Wi-Fi abres
  `http://<ip-de-tu-pc>:4310` y copias la URL pública del día.
- Es un servicio gratuito **sin garantía** de disponibilidad ni de velocidad. Para una dirección fija y
  estable, mira la sección 7 (dominio propio).
- Cualquiera que conozca la URL llega a la pantalla de login. Está protegida por tu contraseña y por un
  límite de intentos (5 fallos → 15 minutos de bloqueo por IP), pero usa una contraseña larga y no
  publiques la URL.

## 4. Dejarlo arrancando con el PC

El script `panel\deploy\install-service.ps1` registra dos **tareas programadas de Windows** (herramienta
nativa, nada que descargar):

| Tarea | Qué ejecuta | Para qué |
|-------|-------------|----------|
| `PuestoDeMandoMUVER` | `node server.js` | El panel en `http://localhost:4310` |
| `PuestoDeMandoMUVER-Tunnel` | `node scripts/run-tunnel.js` | Lanza `cloudflared tunnel --url …`, captura la URL y la escribe en `public-url.txt` |

Ambas se disparan **al arrancar el PC y al iniciar sesión**, se ejecutan **ocultas**, con tu usuario y sin
guardar tu contraseña de Windows (`LogonType S4U`), y nunca se duplican (`MultipleInstances IgnoreNew`).

### 4.1 Instalar

1. Abre **PowerShell como administrador** (botón derecho → *Ejecutar como administrador*).
2. Ejecuta:
   ```powershell
   cd C:\ruta\a\SDD-MUVER\panel\deploy
   Set-ExecutionPolicy -Scope Process Bypass
   .\install-service.ps1
   ```
   Parámetros opcionales: `-Port 4311` (otro puerto) y `-NoTunnel` (solo red local, sin Cloudflare).
3. El script localiza `node.exe` y `cloudflared`, crea `panel\data\`, registra las dos tareas, las arranca y
   muestra su estado (`Ready` o `Running`). Si `cloudflared` no está instalado, avisa y registra **solo** la
   tarea del panel; instálalo y vuelve a ejecutar el script.

### 4.2 Dónde mirar

- **Logs**: `panel\data\panel.log` (salida del panel: URLs, directorio de datos, errores) y
  `panel\data\cloudflared.log` (toda la salida de cloudflared). `panel\data\tunnel.log` guarda los
  mensajes del lanzador.
- **URL pública actual**: `panel\data\public-url.txt` (una sola línea), o el **encabezado del panel**
  abriendo `http://<ip-de-tu-pc>:4310` desde el móvil en la red local. Tarda menos de un minuto tras el
  arranque. Si el fichero está vacío, el túnel no está conectado (mira `cloudflared.log`).
- **Estado de las tareas**: `Get-ScheduledTask -TaskName PuestoDeMandoMUVER*` en PowerShell, o el
  *Programador de tareas* de Windows.

### 4.3 Desinstalar

En PowerShell como administrador:

```powershell
cd C:\ruta\a\SDD-MUVER\panel\deploy
.\uninstall-service.ps1
```

Detiene y elimina las dos tareas (`Get-ScheduledTask` deja de listarlas). No borra `panel\data\` ni el código.

## 5. Variables de entorno

Todas son opcionales. El panel las lee al arrancar (`panel/lib/config.js`).

| Variable | Valor por defecto | Para qué |
|----------|-------------------|----------|
| `PORT` | `4310` | Puerto del panel. `install-service.ps1 -Port N` lo fija para las tareas. |
| `PANEL_DATA_DIR` | `panel\data` | Carpeta de datos privados (`auth.json`, `sessions.json`, `public-url.txt`, logs). Ruta absoluta o relativa a `panel\`. |
| `PANEL_SECURE_COOKIES` | desactivado | Con `1` la cookie de sesión lleva siempre el atributo `Secure` (solo HTTPS). **Solo** si usas el panel exclusivamente a través del túnel: con ella activada, el login por `http://<ip-lan>:4310` deja de funcionar. Por defecto el atributo se añade solo cuando la petición entra por Cloudflare. |
| `PANEL_TRUST_PROXY` | activado | Con `0` el panel ignora las cabeceras que añade Cloudflare (`X-Forwarded-Proto`, `CF-Connecting-IP`). Úsalo si **no** publicas con Cloudflare Tunnel y no quieres que un cliente de la red local pueda falsear su IP ante el límite de intentos. |
| `CLOUDFLARED_BIN` | `cloudflared` (en el PATH) | Ruta completa a `cloudflared.exe` si no está en el PATH. |
| `PANEL_ALLOW_EXEC` | activado | Fase 4. Con `0` (o `false`) el panel queda en **solo lectura**: no lanza Claude Code, ni tests, ni commit y push, ni cambia `feature_list.json` (responde `403`). Útil si un día quieres solo mirar desde fuera. |
| `PANEL_MAX_RUNS` | `2` | Fase 4. Ejecuciones a la vez en todo el panel (1–10). Siempre como mucho una por proyecto. |
| `PANEL_RUN_TIMEOUT_MIN` | `30` | Fase 4. Minutos máximos de cada ejecución (1–240); al llegar se detiene con todos sus procesos. |
| `CLAUDE_BIN` | `claude` | Fase 4. Ejecutable de Claude Code. Normalmente no hace falta: se busca `claude.exe` en el PATH, en `%USERPROFILE%\.local\bin` y la instalación de npm. Si solo existe un `claude.cmd`, indica aquí la ruta del `.exe` o del `cli.js`. |
| `PANEL_BASH_BIN` | Git Bash detectado | Fase 4. bash con el que se ejecuta `init.sh` en "Ejecutar tests" si el proyecto no tiene comando de tests. Por defecto `C:\Program Files\Git\bin\bash.exe` (nunca el bash de WSL). |
| `PANEL_CF_ACCESS_TEAM` | sin definir | Fase 4. Nombre del equipo de Cloudflare Zero Trust (lo que va antes de `.cloudflareaccess.com`). Ver sección 9. |
| `PANEL_CF_ACCESS_AUD` | sin definir | Fase 4. "Application Audience (AUD) Tag" de la aplicación de Cloudflare Access. Ver sección 9. |

**Cómo fijarlas para las tareas programadas**: como variables de usuario, que la tarea S4U lee al arrancar.
En PowerShell (sin administrador):

```powershell
setx PANEL_DATA_DIR "D:\muver-datos"
setx CLOUDFLARED_BIN "C:\Program Files (x86)\cloudflared\cloudflared.exe"
```

Después reinicia las tareas (`Stop-ScheduledTask`/`Start-ScheduledTask -TaskName PuestoDeMandoMUVER`) o el PC.
Si ejecutas el panel a mano, en esa misma ventana basta `$env:PORT = "4311"; npm start`.

## 6. Si olvidas la contraseña

Hace falta acceso al PC (no se puede desde el móvil, a propósito):

```powershell
cd C:\ruta\a\SDD-MUVER\panel
npm run reset-password
```

Borra `auth.json` y `sessions.json` del directorio de datos (respeta `PANEL_DATA_DIR`) y muestra
`Contraseña y sesiones eliminadas. Reinicia el panel y abre su URL para crear una contraseña nueva.`
Después **reinicia el panel** (`Stop-ScheduledTask`/`Start-ScheduledTask -TaskName PuestoDeMandoMUVER`, o
`Ctrl+C` y `npm start`) y abre `http://localhost:4310`: volverá a salir **Crear contraseña**. Todas las sesiones
del móvil y del PC quedan cerradas. **Importante:** desde ese momento y hasta que alguien cree la contraseña nueva,
el panel está sin contraseña y quien llegue primero a la URL pública podría crearla; hazlo de inmediato y, a ser
posible, con el túnel parado (`Stop-ScheduledTask -TaskName PuestoDeMandoMUVER-Tunnel`) hasta haberla creado.

Si el panel dice `Fichero de autenticación ilegible; ejecuta npm run reset-password`, es el mismo remedio.

## 7. Opción avanzada: dominio propio

Si tienes un dominio gestionado en Cloudflare (plan gratuito vale), puedes tener una dirección fija como
`https://panel.tudominio.com` que no cambia nunca y arranca como servicio de Windows:

1. `cloudflared tunnel login` → abre el navegador, elige el dominio y autoriza.
2. `cloudflared tunnel create muver` → crea el túnel y muestra su `<TUNNEL-ID>` (guarda las credenciales en
   `%USERPROFILE%\.cloudflared\<TUNNEL-ID>.json`).
3. `cloudflared tunnel route dns muver panel.tudominio.com` → crea el registro DNS.
4. Copia `panel\deploy\cloudflared-config.example.yml` a `%USERPROFILE%\.cloudflared\config.yml` y sustituye
   `<TUNNEL-ID>`, `<USUARIO>` y el `hostname`. El `service` debe seguir siendo `http://localhost:4310` (o tu `PORT`).
5. `cloudflared service install` (PowerShell como administrador) → cloudflared arranca con Windows como servicio.
   En este caso **no** necesitas la tarea `PuestoDeMandoMUVER-Tunnel`: instala el panel con
   `.\install-service.ps1 -NoTunnel`.
6. Escribe la URL fija en `panel\data\public-url.txt` (una línea: `https://panel.tudominio.com`) para que el
   panel la muestre en el encabezado.
7. **Recomendado**: añade **Cloudflare Access** delante del hostname (Zero Trust → Access → Applications) con
   tu correo como única identidad permitida. Es una segunda puerta antes de llegar al login del panel; el panel
   sigue pidiendo su contraseña igualmente (también en la red local).

## 8. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| `El puerto 4310 ya está en uso` en `panel.log` | Otro panel (o la tarea) ya está escuchando | `Get-ScheduledTask -TaskName PuestoDeMandoMUVER` → si está `Running`, ya tienes el panel; si no, busca qué usa el puerto (`netstat -ano | findstr :4310`) o usa `-Port 4311`. |
| `No se pudo ejecutar cloudflared: spawn cloudflared ENOENT` en `tunnel.log` | `cloudflared` no está en el PATH de tu usuario | Instálalo (`winget install Cloudflare.cloudflared`), o fija `CLOUDFLARED_BIN` con `setx` y reinicia la tarea. |
| La tarea está `Ready` pero `http://localhost:4310` no responde | La tarea terminó (error de Node o puerto) | Lee el final de `panel\data\panel.log`. Ejecuta `node server.js` a mano en `panel\` para ver el error en pantalla. |
| `public-url.txt` vacío o sin URL en el encabezado | El túnel no ha conectado todavía o se ha caído | Espera un minuto; mira `cloudflared.log`. La tarea se reintenta sola hasta 3 veces; `Start-ScheduledTask -TaskName PuestoDeMandoMUVER-Tunnel` la relanza. |
| Entras con la contraseña correcta pero vuelve al login | El navegador no guarda la cookie: `PANEL_SECURE_COOKIES=1` y estás entrando por `http://` en la LAN | Quita esa variable (o entra siempre por la URL `https://`). Comprueba también que la hora del PC es correcta. |
| `Demasiados intentos. Espera 15 minutos.` | 5 contraseñas erróneas seguidas desde tu IP | Espera 15 minutos (o reinicia el panel si estás en el PC: el contador vive en memoria). |
| La URL de trycloudflare de ayer ya no funciona | Es temporal: cambia en cada arranque de `cloudflared` | Lee la nueva en `public-url.txt` o en el encabezado del panel desde la Wi-Fi. Para una fija, sección 7. |
| El móvil con datos no carga pero en la Wi-Fi sí | El túnel no está activo | Comprueba la tarea `PuestoDeMandoMUVER-Tunnel` y `cloudflared.log`. |

## 9. Cloudflare Access

Desde la fase 4 el panel puede **lanzar Claude Code, los tests y el commit y push** de tus proyectos. Por eso,
mientras uses la URL temporal de trycloudflare, cada acción de ejecución pedida desde Internet te pide **repetir
la contraseña cada 15 minutos** (desde la Wi-Fi de casa no). Cuando tengas dominio propio, la protección
recomendada es poner **Cloudflare Access** delante: antes de ver siquiera la pantalla de login, Cloudflare te pide
un código de un solo uso que llega a tu email. Con Access activo el panel ya no te repite la contraseña para las
acciones (sigue pidiendo la del login).

1. **Pasa a dominio propio** siguiendo la sección 7 (túnel con nombre, `hostname` fijo, por ejemplo
   `https://panel.tudominio.com`, y `public-url.txt` con esa URL).
2. En el panel de Cloudflare entra en **Zero Trust** (la primera vez te pide un nombre de equipo: es el
   *team name*, por ejemplo `muver`; queda como `muver.cloudflareaccess.com`).
3. **Access → Applications → Add an application → Self-hosted** (aplicación *self-hosted*):
   - *Application domain*: el mismo hostname del túnel (`panel.tudominio.com`).
   - *Session duration*: la que prefieras (por ejemplo 24 horas).
4. Crea una **política** (*policy*) de tipo *Allow* con la regla **Emails** = tu email (solo el tuyo). Como
   método de identificación deja **One-time PIN** (código de un solo uso por email), que no necesita nada más.
5. Guarda la aplicación y, en su pestaña de resumen (*Overview*), copia el **Application Audience (AUD) Tag**.
6. En el PC, en PowerShell (sin administrador), fija las dos variables con el nombre del equipo y el AUD:

   ```powershell
   setx PANEL_CF_ACCESS_TEAM "muver"
   setx PANEL_CF_ACCESS_AUD "pega-aquí-el-AUD-tag"
   ```

7. Reinicia la tarea del panel (`Stop-ScheduledTask -TaskName PuestoDeMandoMUVER` y
   `Start-ScheduledTask -TaskName PuestoDeMandoMUVER`) o el PC. En `panel\data\panel.log` debe aparecer
   `Cloudflare Access: activado (equipo muver)`.
8. Prueba desde el móvil con datos móviles: primero Cloudflare te pide el email y el código; después aparece el
   login del panel. Las acciones ya no piden repetir la contraseña.

Cómo funciona: Cloudflare añade a cada petición la cabecera `Cf-Access-Jwt-Assertion` (un token firmado). El
panel comprueba la firma con las claves públicas de `https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs`,
que el AUD es el tuyo y que no ha caducado. Si alguien llegara al túnel por otro camino sin pasar por Access, el
panel lo rechaza con `403`. Desde la red local (`http://<ip-del-PC>:4310`) no se mira Access.

**Si solo defines una de las dos variables** (o el nombre del equipo no es válido: solo minúsculas, números y
guiones), el panel avisa al arrancar con `AVISO: Cloudflare Access mal configurado (…)` y **rechaza todo acceso
por el túnel** con `403 Cloudflare Access mal configurado en el panel` (la red local sigue funcionando). Corrige
la variable con `setx` y reinicia la tarea. Para volver a la URL temporal sin Access, bórralas
(`[Environment]::SetEnvironmentVariable('PANEL_CF_ACCESS_TEAM', $null, 'User')` y lo mismo con
`PANEL_CF_ACCESS_AUD`) y reinicia la tarea.
