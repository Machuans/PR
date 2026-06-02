param(
  [string]$InstallDir = "E:\AI-Models\PR"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$DownloadScript = Join-Path $PSScriptRoot "download-models.ps1"

function Open-ModelFolder {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Start-Process explorer.exe $InstallDir
}

function Open-Readme {
  Start-Process (Join-Path $RepoRoot "README.md")
}

function Start-Downloader {
  param([string]$ModelSet)

  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-File", "`"$DownloadScript`"",
    "-ModelSet", $ModelSet,
    "-InstallDir", "`"$InstallDir`"",
    "-Source", "hf-mirror",
    "-OpenFolder"
  )
}

function Open-LMStudio {
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\LM Studio\LM Studio.exe",
    "$env:LOCALAPPDATA\Programs\LMStudio\LM Studio.exe"
  )

  $exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($exe) {
    Start-Process $exe
  } else {
    Start-Process "https://lmstudio.ai/"
  }
}

while ($true) {
  Clear-Host
  Write-Host "PR Desktop Launcher"
  Write-Host "Default model directory: $InstallDir"
  Write-Host ""
  Write-Host "1. Open model folder"
  Write-Host "2. Open README"
  Write-Host "3. Download primary model"
  Write-Host "4. Download all core models"
  Write-Host "5. Open LM Studio"
  Write-Host "6. Open SillyTavern local UI"
  Write-Host "7. Exit"
  Write-Host ""

  $choice = Read-Host "Choose"
  switch ($choice) {
    "1" { Open-ModelFolder }
    "2" { Open-Readme }
    "3" { Start-Downloader -ModelSet "primary" }
    "4" { Start-Downloader -ModelSet "all" }
    "5" { Open-LMStudio }
    "6" { Start-Process "http://localhost:8000" }
    "7" { break }
    default {
      Write-Host "Unknown choice."
      Start-Sleep -Seconds 1
    }
  }
}
