# PR Desktop

PR Desktop is a Windows desktop wrapper for the local PR setup. It launches and checks:

- SillyTavern at `http://127.0.0.1:8000`
- LM Studio OpenAI-compatible API at `http://127.0.0.1:1234/v1`
- The default model folder at `E:\AI-Models\PR`

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

The packaged app can update from GitHub Releases when releases are created from `v*` tags.
