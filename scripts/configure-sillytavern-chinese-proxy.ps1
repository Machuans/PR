param(
  [string]$SettingsPath = "E:\AI-Apps\SillyTavern\data\default-user\settings.json",
  [string]$ProxyBaseUrl = "http://127.0.0.1:7821/v1",
  [string]$Model = "pr-auto"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$NodeScript = Join-Path $PSScriptRoot "configure-sillytavern-chinese-proxy.js"

Push-Location $RepoRoot
try {
  node $NodeScript "--settings=$SettingsPath" "--proxy=$ProxyBaseUrl" "--model=$Model"
}
finally {
  Pop-Location
}
