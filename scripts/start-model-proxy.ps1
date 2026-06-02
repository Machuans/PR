param(
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ProxyScript = Join-Path $RepoRoot "desktop\src\proxy-server.js"
$LogDir = Join-Path $env:APPDATA "PR Desktop\logs"
$LogPath = Join-Path $LogDir "model-proxy.log"

function Test-Proxy {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:7821/v1/models" -UseBasicParsing -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (Test-Proxy) {
  Write-Host "PR model proxy is already running: http://127.0.0.1:7821/v1"
  return
}

if (-not (Test-Path $ProxyScript)) {
  throw "Proxy script not found: $ProxyScript"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if ($Foreground) {
  Push-Location $RepoRoot
  try {
    node $ProxyScript
  }
  finally {
    Pop-Location
  }
} else {
  Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $RepoRoot -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", "node `"$ProxyScript`" *> `"$LogPath`""
  )
  Start-Sleep -Seconds 2
  Write-Host "PR model proxy started: http://127.0.0.1:7821/v1"
  Write-Host "Log: $LogPath"
}
