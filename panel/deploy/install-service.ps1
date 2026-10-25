#requires -RunAsAdministrator
<#
.SYNOPSIS
  Deja el Puesto de Mando MUVER arrancando con Windows mediante dos tareas programadas nativas.

.DESCRIPTION
  Registra (con Register-ScheduledTask, sin binarios externos):
    - PuestoDeMandoMUVER         → node server.js            (el panel, puerto $Port)
    - PuestoDeMandoMUVER-Tunnel  → node scripts/run-tunnel.js (Cloudflare Tunnel con URL temporal trycloudflare.com)
  Ambas se disparan al arrancar el PC (-AtStartup) y al iniciar sesión (-AtLogOn), con -MultipleInstances IgnoreNew
  para que nunca haya dos copias (evita EADDRINUSE). El principal es el usuario actual con -LogonType S4U: arranca
  sin iniciar sesión y sin guardar tu contraseña de Windows. La salida del panel va a panel\data\panel.log; la de
  cloudflared, a panel\data\cloudflared.log (la escribe scripts/run-tunnel.js).

.PARAMETER Port
  Puerto del panel (por defecto 4310). Se pasa como variable PORT a ambos procesos.

.PARAMETER NoTunnel
  No registra la tarea del túnel (solo red local).

.PARAMETER TaskName
  Nombre base de las tareas (por defecto PuestoDeMandoMUVER; la del túnel añade "-Tunnel").

.EXAMPLE
  Set-ExecutionPolicy -Scope Process Bypass
  .\install-service.ps1
  .\install-service.ps1 -Port 4311 -NoTunnel
#>
[CmdletBinding()]
param(
  [int]$Port = 4310,
  [switch]$NoTunnel,
  [string]$TaskName = 'PuestoDeMandoMUVER'
)

$ErrorActionPreference = 'Stop'

# --- Rutas (relativas a este script: panel\deploy\ → panel\) ---
$panelDir = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $panelDir 'data'
$panelLog = Join-Path $dataDir 'panel.log'
$tunnelLog = Join-Path $dataDir 'tunnel.log'   # salida de run-tunnel.js; cloudflared.log lo escribe el propio script
$tunnelTaskName = "$TaskName-Tunnel"

if (-not (Test-Path (Join-Path $panelDir 'server.js'))) {
  Write-Error "No se encuentra server.js en $panelDir. Ejecuta este script desde panel\deploy\."
  exit 1
}
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# --- Node.js ---
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Error 'No se encuentra node.exe en el PATH. Instala Node.js (>= 18) desde https://nodejs.org y vuelve a ejecutar.'
  exit 1
}
$node = $nodeCmd.Source
Write-Host "Node.js: $node"
Write-Host "Carpeta del panel: $panelDir"
Write-Host "Directorio de datos: $dataDir"

# --- Disparadores, ajustes y principal comunes a las dos tareas ---
$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -AtLogOn)
)
# ExecutionTimeLimit 0 = sin límite (los procesos viven mientras el PC esté encendido).
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -Hidden
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

# cmd.exe /c "set PORT=<puerto>&& "<node>" <script> >> "<log>" 2>&1"
# (cmd quita las comillas exteriores; las interiores protegen rutas con espacios.)
function New-PanelAction([string]$script, [string]$log) {
  $cmdLine = "/c `"set PORT=$Port&& `"$node`" $script >> `"$log`" 2>&1`""
  return New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdLine -WorkingDirectory $panelDir
}

# --- Tarea 1: el panel (node server.js) ---
$panelAction = New-PanelAction -script 'server.js' -log $panelLog
Register-ScheduledTask -TaskName $TaskName -Action $panelAction -Trigger $triggers -Settings $settings -Principal $principal `
  -Description "Puesto de Mando MUVER: panel web local (node server.js) en el puerto $Port. Log: $panelLog" -Force | Out-Null
Write-Host "Tarea '$TaskName' registrada (panel en http://localhost:$Port, log en $panelLog)."

# --- Tarea 2: el túnel de Cloudflare (node scripts/run-tunnel.js) ---
if ($NoTunnel) {
  Write-Host "Se omite la tarea del túnel (-NoTunnel). El panel solo será accesible en la red local."
} else {
  $cloudflared = $null
  if ($env:CLOUDFLARED_BIN -and (Test-Path $env:CLOUDFLARED_BIN)) {
    $cloudflared = $env:CLOUDFLARED_BIN
  } else {
    $cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cfCmd) { $cloudflared = $cfCmd.Source }
  }
  if (-not $cloudflared) {
    Write-Warning "No se encuentra cloudflared en el PATH (ni en CLOUDFLARED_BIN). Instálalo con 'winget install Cloudflare.cloudflared' y vuelve a ejecutar este script para registrar la tarea '$tunnelTaskName'. El panel se registra igualmente."
  } else {
    Write-Host "cloudflared: $cloudflared"
    $tunnelAction = New-PanelAction -script 'scripts/run-tunnel.js' -log $tunnelLog
    Register-ScheduledTask -TaskName $tunnelTaskName -Action $tunnelAction -Trigger $triggers -Settings $settings -Principal $principal `
      -Description "Puesto de Mando MUVER: Cloudflare Tunnel (URL temporal trycloudflare.com). URL en $dataDir\public-url.txt; log en $dataDir\cloudflared.log" -Force | Out-Null
    Write-Host "Tarea '$tunnelTaskName' registrada (URL pública en $dataDir\public-url.txt, log en $dataDir\cloudflared.log)."
  }
}

# --- Arranque inmediato y resumen ---
Start-ScheduledTask -TaskName $TaskName
if (-not $NoTunnel -and (Get-ScheduledTask -TaskName $tunnelTaskName -ErrorAction SilentlyContinue)) {
  Start-ScheduledTask -TaskName $tunnelTaskName
}
Start-Sleep -Seconds 2
Get-ScheduledTask -TaskName "$TaskName*" | Format-Table TaskName, State -AutoSize

Write-Host ''
Write-Host "Listo. Abre http://localhost:$Port (o http://<ip-de-este-pc>:$Port desde el móvil en la misma Wi-Fi)."
Write-Host "La URL pública aparece en $dataDir\public-url.txt y en el encabezado del panel en menos de un minuto."
Write-Host "Para desinstalar: .\uninstall-service.ps1"
