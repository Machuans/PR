param(
  [string[]]$ModelIds = @(
    "minimax/minimax-m2-her",
    "sao10k/l3.3-euryale-70b",
    "anthracite-org/magnum-v4-72b",
    "deepseek/deepseek-v3.2",
    "z-ai/glm-4.7-flash",
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"
  )
)

$models = Invoke-RestMethod -Uri "https://openrouter.ai/api/v1/models" -UseBasicParsing

$models.data |
  Where-Object { $ModelIds -contains $_.id } |
  Select-Object `
    id,
    name,
    context_length,
    @{n="usd_per_million_input"; e={[double]$_.pricing.prompt * 1000000}},
    @{n="usd_per_million_output"; e={[double]$_.pricing.completion * 1000000}},
    @{n="top_provider_moderated"; e={$_.top_provider.is_moderated}} |
  ConvertTo-Json -Depth 4

