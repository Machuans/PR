param(
  [string]$ApiKey,
  [string]$BaseUrl = "https://api.openai.com/v1"
)

$ErrorActionPreference = "Stop"

if (-not $ApiKey) {
  $secure = Read-Host "Paste your OpenAI API key" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if (-not $ApiKey) {
  throw "OpenAI API key is empty."
}

[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $ApiKey, "User")
[Environment]::SetEnvironmentVariable("OPENAI_BASE_URL", $BaseUrl, "User")
$env:OPENAI_API_KEY = $ApiKey
$env:OPENAI_BASE_URL = $BaseUrl

Write-Host "OpenAI API key saved to the current Windows user."
Write-Host "Base URL: $BaseUrl"
Write-Host "Restart PR Desktop after setting the key."
