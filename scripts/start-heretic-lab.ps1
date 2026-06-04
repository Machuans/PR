param(
  [string]$ModelId,
  [string]$OutputDir = "E:\AI-Models\PR\Heretic",
  [string]$Python = "python",
  [switch]$OpenFolder,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$HereticArgs
)

$ErrorActionPreference = "Stop"

function Get-PythonCommand {
  param([string]$Preferred)

  $command = Get-Command $Preferred -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    return $py.Source
  }

  throw "Python 3.10+ was not found. Install Python first, then rerun this script."
}

function Test-PythonVersion {
  param([string]$PythonExe)

  $code = @"
import sys
major, minor = sys.version_info[:2]
print(f"{major}.{minor}")
raise SystemExit(0 if (major, minor) >= (3, 10) else 1)
"@

  $version = & $PythonExe -c $code
  if ($LASTEXITCODE -ne 0) {
    throw "Python 3.10+ is required. Detected: $version"
  }
  return $version
}

if (-not $ModelId) {
  Write-Host "Heretic Lab"
  Write-Host "This helper installs heretic-llm in a local virtual environment and runs the Heretic CLI."
  Write-Host "Example model id: Qwen/Qwen3-4B-Instruct-2507"
  Write-Host ""
  $ModelId = Read-Host "Enter Hugging Face model id"
}

if (-not $ModelId.Trim()) {
  throw "Model id is required."
}

$pythonExe = Get-PythonCommand -Preferred $Python
$pythonVersion = Test-PythonVersion -PythonExe $pythonExe

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$venvDir = Join-Path $OutputDir ".venv"
$cacheDir = Join-Path $OutputDir "hf-cache"
$runsDir = Join-Path $OutputDir "runs"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $runsDir | Out-Null

if (-not (Test-Path (Join-Path $venvDir "Scripts\python.exe"))) {
  Write-Host "Creating Python venv: $venvDir"
  & $pythonExe -m venv $venvDir
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
$pip = Join-Path $venvDir "Scripts\pip.exe"
$heretic = Join-Path $venvDir "Scripts\heretic.exe"

Write-Host "Python: $pythonVersion"
Write-Host "Installing/updating heretic-llm..."
& $pip install --upgrade pip
& $pip install --upgrade heretic-llm

if (-not (Test-Path $heretic)) {
  throw "Heretic CLI was not found after installation: $heretic"
}

$env:HF_HOME = $cacheDir
$env:HF_HUB_ENABLE_HF_TRANSFER = "1"
$env:PYTORCH_ENABLE_MPS_FALLBACK = "1"

Write-Host ""
Write-Host "Running Heretic for model: $ModelId"
Write-Host "Output workspace: $OutputDir"
Write-Host "Extra args: $($HereticArgs -join ' ')"
Write-Host ""
Write-Host "After Heretic finishes, convert or quantize the resulting model to GGUF, then load it in LM Studio."
Write-Host "PR Desktop will detect the loaded LM Studio model automatically."
Write-Host ""

Push-Location $runsDir
try {
  $arguments = @($ModelId) + @($HereticArgs)
  & $heretic @arguments
}
finally {
  Pop-Location
}

if ($OpenFolder) {
  Start-Process explorer.exe $OutputDir
}
