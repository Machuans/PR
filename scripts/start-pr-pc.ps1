param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DesktopDir = Join-Path $RepoRoot "desktop"

if (-not (Test-Path (Join-Path $DesktopDir "package.json"))) {
  throw "Desktop package not found: $DesktopDir"
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue

if (-not $node -or -not $npm) {
  throw "Node.js and npm are required. Install Node.js LTS, then run this script again."
}

Push-Location $DesktopDir
try {
  if (-not $SkipInstall -and -not (Test-Path (Join-Path $DesktopDir "node_modules\electron"))) {
    Write-Host "Installing desktop dependencies..."
    if (-not $env:ELECTRON_MIRROR) {
      $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
    }
    npm install
  }

  Write-Host "Starting PR Desktop..."
  npm run dev
}
finally {
  Pop-Location
}
