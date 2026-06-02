# PR Desktop

PR Desktop is a Windows desktop wrapper for the local PR setup. It launches and checks:

- SillyTavern at `http://127.0.0.1:8000`
- LM Studio OpenAI-compatible API at `http://127.0.0.1:1234/v1`
- PR multi-model proxy at `http://127.0.0.1:7821/v1`
- The default model folder at `E:\AI-Models\PR`

The multi-model proxy exposes `pr-auto` as the default model. It keeps normal RP chats on the local LM Studio model, sends memory/summary work to `deepseek-v4-flash`, and sends long-context planning, character-card, worldbuilding, and rewrite tasks to `deepseek-v4-pro` when DeepSeek is configured. Direct model IDs still work: `pr-qwen35-9b`, `deepseek-v4-flash`, and `deepseek-v4-pro`.

Set `DEEPSEEK_API_KEY` before using DeepSeek models.

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
