param(
  [string]$SettingsPath = "E:\AI-Apps\SillyTavern\data\default-user\settings.json",
  [string]$ProxyBaseUrl = "http://127.0.0.1:7821/v1",
  [string]$Model = "pr-agent",
  [string]$SillyTavernDir = "E:\AI-Apps\SillyTavern",
  [switch]$SkipTheme
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$NodeScript = Join-Path $PSScriptRoot "configure-sillytavern-chinese-proxy.js"

Push-Location $RepoRoot
try {
  node $NodeScript "--settings=$SettingsPath" "--proxy=$ProxyBaseUrl" "--model=$Model"
  if (-not $SkipTheme) {
    & (Join-Path $PSScriptRoot "install-sillytavern-wechat-theme.ps1") -SillyTavernDir $SillyTavernDir
  }
}
finally {
  Pop-Location
}
