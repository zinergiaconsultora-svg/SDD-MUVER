#requires -RunAsAdministrator
<#
.SYNOPSIS
  Elimina las tareas programadas del Puesto de Mando MUVER (panel y túnel).

.DESCRIPTION
  Detiene y desregistra PuestoDeMandoMUVER y PuestoDeMandoMUVER-Tunnel (o el nombre dado en -TaskName y su
  variante "-Tunnel"). No borra el código ni la carpeta panel\data (contraseña, sesiones y logs se conservan;
  si quieres empezar de cero, ejecuta después `npm run reset-password` en panel\).

.PARAMETER TaskName
  Nombre base de las tareas (por defecto PuestoDeMandoMUVER).

.EXAMPLE
  Set-ExecutionPolicy -Scope Process Bypass
  .\uninstall-service.ps1
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'PuestoDeMandoMUVER'
)

$ErrorActionPreference = 'Stop'
$panelDir = Split-Path -Parent $PSScriptRoot

foreach ($name in @($TaskName, "$TaskName-Tunnel")) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "Tarea '$name' detenida y eliminada."
  } else {
    Write-Host "La tarea '$name' no existía."
  }
}

# Por si Windows no cerró los procesos hijos (node.exe) al detener las tareas: solo los de ESTA carpeta del panel.
$pattern = [regex]::Escape($panelDir)
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match $pattern) -and ($_.CommandLine -match 'server\.js|run-tunnel\.js') } |
  ForEach-Object {
    Write-Host "Cerrando proceso node.exe (PID $($_.ProcessId)) del panel."
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

# Fase 4 (mejora M5 de la fase 2): tampoco deben quedar túneles rápidos de cloudflared hacia el panel local.
Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--url http://localhost:') } |
  ForEach-Object {
    Write-Host "Cerrando proceso cloudflared.exe (PID $($_.ProcessId)) del túnel del panel."
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host ''
Write-Host 'Listo. El panel ya no arranca con Windows. Comprueba con: Get-ScheduledTask -TaskName PuestoDeMandoMUVER*'
