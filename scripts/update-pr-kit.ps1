param(
  [switch]$InstallDesktopDependencies,
  [switch]$SkipDesktopBuild,
  [switch]$SkipLocalInstall,
  [string]$AppInstallDir = "E:\AI-Apps\PR-Desktop"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location $RepoRoot
try {
  $dirty = git status --porcelain
  if ($dirty) {
    Write-Host "Local changes detected. Commit or stash them before automatic update:"
    Write-Host $dirty
    exit 1
  }

  git fetch origin
  git pull --ff-only origin main

  if ((Test-Path "desktop\package.json") -and ($InstallDesktopDependencies -or -not (Test-Path "desktop\node_modules"))) {
    Push-Location "desktop"
    try {
      npm install
    }
    finally {
      Pop-Location
    }
  }

  if (-not $SkipDesktopBuild -and (Test-Path "desktop\package.json")) {
    Push-Location "desktop"
    try {
      npm run lint:js
      npm run pack
    }
    finally {
      Pop-Location
    }
  }

  $packagedApp = Join-Path $RepoRoot "desktop\dist\win-unpacked\PR Desktop.exe"
  if ((Test-Path $packagedApp) -and -not $SkipLocalInstall) {
    & (Join-Path $PSScriptRoot "install-local-app.ps1") -AppInstallDir $AppInstallDir
  } elseif (-not $SkipLocalInstall) {
    & (Join-Path $PSScriptRoot "install-desktop-shortcuts.ps1") -AllowScriptFallback
  }

  Write-Host "PR kit update complete."
}
finally {
  Pop-Location
}
