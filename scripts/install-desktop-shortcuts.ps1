param(
  [string]$InstallDir = "E:\AI-Models\PR",
  [string]$AppInstallDir = "E:\AI-Apps\PR-Desktop",
  [switch]$AllowScriptFallback
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Desktop = [Environment]::GetFolderPath("Desktop")
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source

function Remove-OldShortcut {
  param([string]$Name)

  $path = Join-Path $Desktop "$Name.lnk"
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Force
    Write-Host "Removed: $path"
  }
}

function Find-PrDesktopExe {
  $candidates = @(
    (Join-Path $AppInstallDir "PR Desktop.exe"),
    (Join-Path $RepoRoot "desktop\dist\win-unpacked\PR Desktop.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  $portable = Get-ChildItem -Path (Join-Path $RepoRoot "outputs\pr-desktop") -Filter "PR-Desktop-Portable-*-x64.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($portable) {
    return $portable.FullName
  }

  return $null
}

function New-AppShortcut {
  param(
    [string]$TargetPath,
    [string]$WorkingDirectory
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcutPath = Join-Path $Desktop "PR Desktop.lnk"
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = ""
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.IconLocation = "$TargetPath,0"
  $shortcut.Save()

  Write-Host "Created: $shortcutPath"
  Write-Host "Target: $TargetPath"
}

function New-ScriptFallbackShortcut {
  $launcher = Join-Path $PSScriptRoot "start-pr-desktop.ps1"
  $shell = New-Object -ComObject WScript.Shell
  $shortcutPath = Join-Path $Desktop "PR Desktop.lnk"
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $PowerShell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -InstallDir `"$InstallDir`""
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.IconLocation = "$PowerShell,0"
  $shortcut.Save()

  Write-Host "Created fallback shortcut: $shortcutPath"
  Write-Host "Run scripts\build-desktop.ps1 and scripts\install-local-app.ps1 for the window-only desktop app."
}

$legacyShortcuts = @(
  "PR Auto Update",
  "PR Configure SillyTavern Chinese Proxy",
  "PR Desktop Launcher",
  "PR Download Core Models",
  "PR Download Primary Model",
  "PR PC App",
  "PR Set DeepSeek Key",
  "PR Start Model Proxy",
  "PR Download Models",
  "PR Configure",
  "PR Desktop"
)

foreach ($name in $legacyShortcuts) {
  Remove-OldShortcut -Name $name
}

$target = Find-PrDesktopExe
if ($target) {
  New-AppShortcut -TargetPath $target -WorkingDirectory (Split-Path $target -Parent)
  Write-Host ""
  Write-Host "Desktop shortcut installed. Only one PR shortcut remains."
  exit 0
}

if ($AllowScriptFallback) {
  New-ScriptFallbackShortcut
  exit 0
}

throw "Packaged PR Desktop app not found. Build first with scripts\build-desktop.ps1, then run scripts\install-local-app.ps1."
