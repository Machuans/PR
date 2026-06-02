param(
  [string]$InstallDir = "E:\AI-Models\PR"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Desktop = [Environment]::GetFolderPath("Desktop")
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source

function New-Shortcut {
  param(
    [string]$Name,
    [string]$Arguments
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcutPath = Join-Path $Desktop "$Name.lnk"
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $PowerShell
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.IconLocation = "$PowerShell,0"
  $shortcut.Save()

  Write-Host "Created: $shortcutPath"
}

$launcher = Join-Path $PSScriptRoot "start-pr-desktop.ps1"
$downloader = Join-Path $PSScriptRoot "download-models.ps1"

New-Shortcut `
  -Name "PR Desktop Launcher" `
  -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -InstallDir `"$InstallDir`""

New-Shortcut `
  -Name "PR Download Primary Model" `
  -Arguments "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$downloader`" -ModelSet primary -InstallDir `"$InstallDir`" -Source hf-mirror -OpenFolder"

New-Shortcut `
  -Name "PR Download Core Models" `
  -Arguments "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$downloader`" -ModelSet all -InstallDir `"$InstallDir`" -Source hf-mirror -OpenFolder"

Write-Host ""
Write-Host "Desktop shortcuts installed. Default model directory: $InstallDir"
