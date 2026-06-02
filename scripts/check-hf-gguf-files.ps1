param(
  [string[]]$ModelIds = @(
    "LuffyTheFox/Qwen3.5-9B-Claude-4.6-Opus-Uncensored-Distilled-GGUF",
    "Qwen/Qwen3-8B-GGUF",
    "bartowski/NemoMix-Unleashed-12B-GGUF",
    "TheDrummer/UnslopNemo-12B-v4.1-GGUF",
    "mradermacher/Qwen3.5-27B-heretic-GGUF"
  )
)

$result = foreach ($id in $ModelIds) {
  $model = Invoke-RestMethod -Uri ("https://huggingface.co/api/models/" + $id) -UseBasicParsing
  [pscustomobject]@{
    model_id = $id
    gguf_files = @($model.siblings | Where-Object { $_.rfilename -match "\.gguf$" } | Select-Object -ExpandProperty rfilename)
  }
}

$result | ConvertTo-Json -Depth 5
