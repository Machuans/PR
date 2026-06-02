param(
  [string]$ApiKey,
  [string]$BaseUrl = "https://api.deepseek.com"
)

$ErrorActionPreference = "Stop"

if (-not $ApiKey) {
  $secure = Read-Host "Paste your DeepSeek API key" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if (-not $ApiKey) {
  throw "DeepSeek API key is empty."
}

[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", $ApiKey, "User")
[Environment]::SetEnvironmentVariable("DEEPSEEK_BASE_URL", $BaseUrl, "User")
$env:DEEPSEEK_API_KEY = $ApiKey
$env:DEEPSEEK_BASE_URL = $BaseUrl

Write-Host "DeepSeek API key saved to the current Windows user."
Write-Host "Base URL: $BaseUrl"
Write-Host "Restart PR Desktop after setting the key."
