param(
  [string]$AppInstallDir = "E:\AI-Apps\PR-Desktop",
  [switch]$SkipShortcut
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SourceDir = Join-Path $RepoRoot "desktop\dist\win-unpacked"
$SourceExe = Join-Path $SourceDir "PR Desktop.exe"

if (-not (Test-Path $SourceExe)) {
  throw "Packaged app not found: $SourceExe. Run scripts\build-desktop.ps1 first."
}

$parent = Split-Path $AppInstallDir -Parent
if (-not (Test-Path $parent)) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}

New-Item -ItemType Directory -Force -Path $AppInstallDir | Out-Null
Copy-Item -Path (Join-Path $SourceDir "*") -Destination $AppInstallDir -Recurse -Force

$installedExe = Join-Path $AppInstallDir "PR Desktop.exe"
if (-not (Test-Path $installedExe)) {
  throw "Install failed: $installedExe was not copied."
}

Write-Host "Installed PR Desktop app: $AppInstallDir"

if (-not $SkipShortcut) {
  & (Join-Path $PSScriptRoot "install-desktop-shortcuts.ps1") -AppInstallDir $AppInstallDir
}
