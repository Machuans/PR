param(
  [switch]$InstallDesktopDependencies
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

  if ($InstallDesktopDependencies -and (Test-Path "desktop\package.json")) {
    Push-Location "desktop"
    try {
      npm install
    }
    finally {
      Pop-Location
    }
  }

  & (Join-Path $PSScriptRoot "install-desktop-shortcuts.ps1")
}
finally {
  Pop-Location
}
