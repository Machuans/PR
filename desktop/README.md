# PR Desktop

PR Desktop is a Windows desktop wrapper for the local PR setup. It launches and checks:

- SillyTavern at `http://127.0.0.1:8000`
- LM Studio OpenAI-compatible API at `http://127.0.0.1:1234/v1`
- PR multi-model proxy at `http://127.0.0.1:7821/v1`
- The default model folder at `E:\AI-Models\PR`

The multi-model proxy exposes `pr-agent` as the default model. It classifies requests into roleplay, memory, lore, director, and style agents, injects a small specialist system prompt, and chooses the best configured model. Normal RP stays on the local LM Studio model, memory/summary can use `deepseek-v4-flash`, and long-context planning, character-card, worldbuilding, and rewrite tasks can use `deepseek-v4-pro` or OpenAI quality models. Direct model IDs still work: `pr-qwen35-9b`, `pr-auto`, `deepseek-v4-flash`, `deepseek-v4-pro`, `openai-fast`, `openai-quality`, and `openai-premium`.

LM Studio loaded models are listed automatically. The `pr-qwen35-9b` local alias maps to the first loaded non-embedding LM Studio model when one is available.

The launcher uses a Chinese desktop control panel and automatically keeps a WeChat-inspired SillyTavern chat theme installed with left/right bubbles and a compact input bar.

Set `DEEPSEEK_API_KEY` before using DeepSeek models. Set `OPENAI_API_KEY` before using OpenAI models.

## Development

```powershell
npm install
npm run dev
```

## Build Windows Package

```powershell
npm install
npm run dist
```

Install the unpacked app locally and refresh the single desktop shortcut:

```powershell
..\scripts\install-local-app.ps1
```

The packaged app can update from GitHub Releases when releases are created from `v*` tags.
