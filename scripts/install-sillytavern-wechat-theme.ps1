param(
  [string]$SillyTavernDir = "E:\AI-Apps\SillyTavern"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Source = Join-Path $RepoRoot "templates\sillytavern_wechat_user.css"

if (-not (Test-Path -LiteralPath $Source)) {
  throw "Theme template not found: $Source"
}

$SillyTavernPath = (Resolve-Path -LiteralPath $SillyTavernDir).Path
$CssDir = Join-Path $SillyTavernPath "data\_css"
$Target = Join-Path $CssDir "user.css"

New-Item -ItemType Directory -Path $CssDir -Force | Out-Null

$Backup = $null
if (Test-Path -LiteralPath $Target) {
  $Current = Get-Content -LiteralPath $Target -Raw
  $Next = Get-Content -LiteralPath $Source -Raw
  if ($Current -ne $Next) {
    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $Backup = Join-Path $CssDir "user.css.pr-backup-$Stamp"
    Copy-Item -LiteralPath $Target -Destination $Backup -Force
  }
}

Copy-Item -LiteralPath $Source -Destination $Target -Force

Write-Host "SillyTavern WeChat-style theme installed."
Write-Host "Target: $Target"
if ($Backup) {
  Write-Host "Backup: $Backup"
}
