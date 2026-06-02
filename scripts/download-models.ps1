param(
  [ValidateSet("primary", "stable", "rp", "all", "advanced")]
  [string]$ModelSet = "primary",

  [string]$InstallDir = "E:\AI-Models\PR",

  [ValidateSet("hf-mirror", "huggingface")]
  [string]$Source = "hf-mirror",

  [switch]$OpenFolder,

  [switch]$DryRun,

  [int]$MaxRetries = 10,

  [int]$RetryDelaySeconds = 10
)

$ErrorActionPreference = "Stop"

$catalog = @(
  [pscustomobject]@{
    Set = "primary"
    Name = "Qwen3.5-9B uncensored primary"
    Repo = "LuffyTheFox/Qwen3.5-9B-Claude-4.6-Opus-Uncensored-Distilled-GGUF"
    File = "Qwen3.5-9B.Q4_K_M.gguf"
    MinFreeGB = 8
  },
  [pscustomobject]@{
    Set = "stable"
    Name = "Qwen3-8B stable Chinese backup"
    Repo = "Qwen/Qwen3-8B-GGUF"
    File = "Qwen3-8B-Q4_K_M.gguf"
    MinFreeGB = 7
  },
  [pscustomobject]@{
    Set = "rp"
    Name = "NemoMix Unleashed 12B RP flavor"
    Repo = "bartowski/NemoMix-Unleashed-12B-GGUF"
    File = "NemoMix-Unleashed-12B-Q4_K_M.gguf"
    MinFreeGB = 9
  },
  [pscustomobject]@{
    Set = "rp"
    Name = "UnslopNemo 12B RP flavor"
    Repo = "TheDrummer/UnslopNemo-12B-v4.1-GGUF"
    File = "Rocinante-12B-v2j-Q4_K_M.gguf"
    MinFreeGB = 9
  },
  [pscustomobject]@{
    Set = "advanced"
    Name = "Qwen3.5-27B heretic advanced candidate"
    Repo = "mradermacher/Qwen3.5-27B-heretic-GGUF"
    File = "Qwen3.5-27B-heretic.Q3_K_M.gguf"
    MinFreeGB = 14
  }
)

function Get-SelectedModels {
  param([string]$SetName)

  switch ($SetName) {
    "primary" { $catalog | Where-Object { $_.Set -eq "primary" } }
    "stable" { $catalog | Where-Object { $_.Set -eq "stable" } }
    "rp" { $catalog | Where-Object { $_.Set -eq "rp" } }
    "all" { $catalog | Where-Object { $_.Set -in @("primary", "stable", "rp") } }
    "advanced" { $catalog | Where-Object { $_.Set -eq "advanced" } }
  }
}

function Get-HuggingFaceUrl {
  param(
    [string]$Repo,
    [string]$File,
    [string]$Source
  )

  $encodedFile = [uri]::EscapeDataString($File)
  $baseUrl = switch ($Source) {
    "hf-mirror" { "https://hf-mirror.com" }
    "huggingface" { "https://huggingface.co" }
  }

  "$baseUrl/$Repo/resolve/main/$encodedFile`?download=true"
}

function Get-ModelTargetPath {
  param(
    [string]$Repo,
    [string]$File
  )

  $repoFolder = $Repo -replace "[\\/]", "__"
  Join-Path (Join-Path $InstallDir $repoFolder) $File
}

function Assert-FreeSpace {
  param([object[]]$Models)

  $driveName = ([System.IO.Path]::GetPathRoot($InstallDir)).TrimEnd("\").TrimEnd(":")
  if (-not $driveName) {
    throw "InstallDir must be an absolute Windows path, for example E:\AI-Models\PR"
  }

  $drive = Get-PSDrive -Name $driveName -ErrorAction Stop
  $requiredGB = ($Models | Measure-Object -Property MinFreeGB -Sum).Sum
  $freeGB = [math]::Round($drive.Free / 1GB, 2)

  Write-Host "InstallDir: $InstallDir"
  Write-Host "Free space on ${driveName}: ${freeGB} GB"
  Write-Host "Estimated required space for this set: ${requiredGB} GB"

  if (($drive.Free / 1GB) -lt $requiredGB) {
    throw "Not enough free space on ${driveName}. Free: ${freeGB} GB, required: ${requiredGB} GB."
  }
}

function Download-Model {
  param([object]$Model)

  $target = Get-ModelTargetPath -Repo $Model.Repo -File $Model.File
  $targetDir = Split-Path -Parent $target
  $url = Get-HuggingFaceUrl -Repo $Model.Repo -File $Model.File -Source $Source

  Write-Host ""
  Write-Host "Model: $($Model.Name)"
  Write-Host "Source: $Source"
  Write-Host "Repo:  $($Model.Repo)"
  Write-Host "File:  $($Model.File)"
  Write-Host "Path:  $target"

  if ((Test-Path $target) -and ((Get-Item $target).Length -gt 0)) {
    $existing = Get-Item $target
    $existingGB = [math]::Round($existing.Length / 1GB, 2)
    Write-Host "Existing partial or complete file found: ${existingGB} GB. curl will resume or verify it."
  }

  if ($DryRun) {
    Write-Host "Dry run: would download $url"
    return [pscustomobject]@{
      name = $Model.Name
      repo = $Model.Repo
      file = $Model.File
      path = $target
      status = "dry_run"
    }
  }

  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

  $curl = Get-Command curl.exe -ErrorAction Stop
  $curlArgs = @(
    "-L",
    "--fail",
    "--continue-at", "-",
    "--speed-limit", "1024",
    "--speed-time", "120",
    "--create-dirs",
    "--output", $target,
    $url
  )

  $success = $false
  for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
    Write-Host "Download attempt $attempt of $MaxRetries"
    & $curl.Source @curlArgs
    if ($LASTEXITCODE -eq 0) {
      $success = $true
      break
    }

    Write-Host "curl failed with exit code $LASTEXITCODE."
    if ($attempt -lt $MaxRetries) {
      Write-Host "Retrying in $RetryDelaySeconds seconds..."
      Start-Sleep -Seconds $RetryDelaySeconds
    }
  }

  if (-not $success) {
    throw "curl failed after $MaxRetries attempts while downloading $($Model.File)."
  }

  $finalFile = Get-Item $target

  return [pscustomobject]@{
    name = $Model.Name
    repo = $Model.Repo
    file = $Model.File
    path = $target
    size_bytes = $finalFile.Length
    status = "downloaded"
  }
}

$selected = @(Get-SelectedModels -SetName $ModelSet)
if ($selected.Count -eq 0) {
  throw "No models selected for ModelSet '$ModelSet'."
}

Assert-FreeSpace -Models $selected

$results = foreach ($model in $selected) {
  Download-Model -Model $model
}

if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $record = [pscustomobject]@{
    downloaded_at = (Get-Date).ToString("s")
    model_set = $ModelSet
    install_dir = $InstallDir
    results = $results
  }
  $record | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $InstallDir "downloaded-models.json") -Encoding UTF8

  Write-Host ""
  Write-Host "Done. Download record written to:"
  Write-Host (Join-Path $InstallDir "downloaded-models.json")
} else {
  Write-Host ""
  Write-Host "Dry run complete. No files were written."
}

if ($OpenFolder) {
  Start-Process explorer.exe $InstallDir
}
