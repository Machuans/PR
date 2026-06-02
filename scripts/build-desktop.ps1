param(
  [switch]$OpenOutput,
  [switch]$InstallLocal
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DesktopDir = Join-Path $RepoRoot "desktop"

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue

if (-not $node -or -not $npm) {
  throw "Node.js and npm are required. Install Node.js LTS, then run this script again."
}

Push-Location $DesktopDir
try {
  if (-not $env:ELECTRON_MIRROR) {
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  }
  if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
  }
  if (-not $env:CSC_IDENTITY_AUTO_DISCOVERY) {
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  }

  npm install
  npm run lint:js
  npm run dist

  if ($InstallLocal) {
    & (Join-Path $PSScriptRoot "install-local-app.ps1")
  }

  if ($OpenOutput) {
    Start-Process explorer.exe (Join-Path $DesktopDir "dist")
  }
}
finally {
  Pop-Location
}
