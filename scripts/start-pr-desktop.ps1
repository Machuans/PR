param(
  [string]$InstallDir = "E:\AI-Models\PR"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DownloadScript = Join-Path $PSScriptRoot "download-models.ps1"
$PcScript = Join-Path $PSScriptRoot "start-pr-pc.ps1"
$UpdateScript = Join-Path $PSScriptRoot "update-pr-kit.ps1"
$DeepSeekKeyScript = Join-Path $PSScriptRoot "set-deepseek-key.ps1"
$OpenAIKeyScript = Join-Path $PSScriptRoot "set-openai-key.ps1"
$ConfigureProxyScript = Join-Path $PSScriptRoot "configure-sillytavern-chinese-proxy.ps1"
$ModelProxyScript = Join-Path $PSScriptRoot "start-model-proxy.ps1"
$SillyTavernDir = $env:PR_SILLYTAVERN_DIR
if (-not $SillyTavernDir) {
  $SillyTavernDir = "E:\AI-Apps\SillyTavern"
}

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

function Test-Url {
  param([string]$Url)

  try {
    Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-SillyTavernBackend {
  if (Test-Url "http://127.0.0.1:8000/") {
    Write-Host "SillyTavern is already running."
    Start-Sleep -Seconds 1
    return
  }

  if (-not (Test-Path (Join-Path $SillyTavernDir "package.json"))) {
    Write-Host "SillyTavern directory not found: $SillyTavernDir"
    Start-Sleep -Seconds 2
    return
  }

  Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $SillyTavernDir -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", "npm start *> .\pr-desktop-sillytavern.log"
  )

  Write-Host "Starting SillyTavern backend..."
  Start-Sleep -Seconds 4
}

function Start-PCApp {
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PcScript`""
  )
}

function Update-PRKit {
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-File", "`"$UpdateScript`"",
    "-InstallDesktopDependencies"
  )
}

function Set-DeepSeekKey {
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-File", "`"$DeepSeekKeyScript`""
  )
}

function Set-OpenAIKey {
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-File", "`"$OpenAIKeyScript`""
  )
}

function Configure-SillyTavernChineseProxy {
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-File", "`"$ConfigureProxyScript`""
  )
}

function Start-ModelProxy {
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-File", "`"$ModelProxyScript`""
  )
}

while ($true) {
  Clear-Host
  Write-Host "PR Desktop Launcher"
  Write-Host "Default model directory: $InstallDir"
  Write-Host "SillyTavern directory: $SillyTavernDir"
  Write-Host ""
  Write-Host "1. Open model folder"
  Write-Host "2. Open README"
  Write-Host "3. Download primary model"
  Write-Host "4. Download all core models"
  Write-Host "5. Open LM Studio"
  Write-Host "6. Open PR PC app"
  Write-Host "7. Start SillyTavern backend"
  Write-Host "8. Open SillyTavern local UI"
  Write-Host "9. Auto update PR kit"
  Write-Host "10. Set DeepSeek API key"
  Write-Host "11. Set OpenAI API key"
  Write-Host "12. Configure SillyTavern Chinese proxy"
  Write-Host "13. Start model proxy"
  Write-Host "14. Exit"
  Write-Host ""

  $choice = Read-Host "Choose"
  switch ($choice) {
    "1" { Open-ModelFolder }
    "2" { Open-Readme }
    "3" { Start-Downloader -ModelSet "primary" }
    "4" { Start-Downloader -ModelSet "all" }
    "5" { Open-LMStudio }
    "6" { Start-PCApp }
    "7" { Start-SillyTavernBackend }
    "8" {
      Start-SillyTavernBackend
      Start-Process "http://localhost:8000"
    }
    "9" { Update-PRKit }
    "10" { Set-DeepSeekKey }
    "11" { Set-OpenAIKey }
    "12" { Configure-SillyTavernChineseProxy }
    "13" { Start-ModelProxy }
    "14" { break }
    default {
      Write-Host "Unknown choice."
      Start-Sleep -Seconds 1
    }
  }
}
