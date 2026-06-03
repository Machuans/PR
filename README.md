# 高尺度低限制中文 RP 本地套件

生成日期：2026-06-02

这个套件用于把方案落到可执行配置：SillyTavern 作为前端，LM Studio 作为本地主力入口，OpenRouter 作为云端补强。默认目标是“成人尺度/低限制 > 中文 RP 语感 > 恋爱陪伴”，并把内容限定在虚构、成年、双方自愿的角色 RP 中。

## 目录

- `model_manifest.json`：本地/云端模型清单、推荐用途、具体 GGUF 文件名。
- `prompts/system_prompt_cn_adult_rp.txt`：复制到 SillyTavern 的 System Prompt。
- `prompts/authors_note_cn.txt`：复制到 Author's Note。
- `prompts/summary_prompt_cn.txt`：用于 Summarize/记忆整理的提示词。
- `templates/character_card_v2_template.json`：角色卡 V2 骨架。
- `templates/world_info_entries.jsonl`：World Info 条目模板，每行一个可复制条目。
- `test_matrix.csv`：模型实测评分表。
- `scripts/check-openrouter-models.ps1`：检查 OpenRouter 模型是否仍在、上下文和价格。
- `scripts/check-hf-gguf-files.ps1`：检查 Hugging Face GGUF 文件名。

## 快速配置

1. 安装并打开 SillyTavern。
2. 双击 `download-primary-model.cmd` 一键下载本地主力模型到 `E:\AI-Models\PR`。
3. 安装并打开 LM Studio，加载已下载的 GGUF 模型：
   - 首选：`LuffyTheFox/Qwen3.5-9B-Claude-4.6-Opus-Uncensored-Distilled-GGUF`
   - 推荐文件：`Qwen3.5-9B.Q4_K_M.gguf`
4. 在 LM Studio 开启 Local Server。
   - SillyTavern local/OpenAI-compatible base URL：`http://localhost:1234/v1`
5. 在 SillyTavern 导入角色卡，填入本套件的 System Prompt、Author's Note、World Info。
6. OpenRouter 只作为补强：
   - 中文 RP：`minimax/minimax-m2-her`
   - 成人 RP 风味：`sao10k/l3.3-euryale-70b`、`anthracite-org/magnum-v4-72b`
   - 低成本长聊/总结：`deepseek/deepseek-v3.2`、`z-ai/glm-4.7-flash`

## 一键下载与桌面入口

- `build-pr-desktop.cmd`：本地打包并安装统一的 Windows 桌面端，桌面只保留一个 `PR Desktop` 快捷方式。
- `start-pr-pc.cmd`：旧版备用启动器。优先使用打包后的 `PR Desktop` 应用。
- `start-model-proxy.cmd`：只启动多模型中文代理后端，适合你已经在浏览器里打开 SillyTavern 时使用。
- `configure-sillytavern-chinese-proxy.cmd`：把 SillyTavern 设置切到 `http://127.0.0.1:7821/v1`，并把系统提示改为中文输出优先。
- `set-deepseek-key.cmd`：保存 DeepSeek API Key 到 Windows 用户环境变量。
- `set-openai-key.cmd`：保存 OpenAI API Key 到 Windows 用户环境变量。
- `download-primary-model.cmd`：双击下载主力 9B Q4 模型，默认目录 `E:\AI-Models\PR`。
- `download-all-core-models.cmd`：双击下载主力、中文备用、两个 RP 风味模型，不含 27B 进阶模型。
- `scripts/download-models.ps1 -ModelSet advanced`：下载 27B 进阶候选，8-12GB 显存可能较慢。
- `scripts/install-local-app.ps1`：把 `desktop/dist/win-unpacked` 安装到 `E:\AI-Apps\PR-Desktop`，并刷新唯一桌面快捷方式。
- `scripts/install-desktop-shortcuts.ps1`：清理旧 PR 快捷方式，只创建一个 `PR Desktop` 快捷方式。
- `scripts/update-pr-kit.ps1`：从 GitHub 拉取本仓库最新版本，安装桌面端依赖，并刷新桌面快捷方式。
- 下载脚本默认使用 `hf-mirror.com`，更适合 Hugging Face 直连不稳定的网络；如果你能直连 Hugging Face，可加 `-Source huggingface`。
- 下载脚本使用 `curl.exe`，支持断点续传和自动重试；如果网络中断，重新运行同一命令会从已有文件继续。

## PC 桌面端与自动更新

桌面端源码在 `desktop/`。它内置一个本地后端，负责：

- 检查 `http://127.0.0.1:1234/v1/models` 是否可用。
- 检查并启动 `E:\AI-Apps\SillyTavern` 的 SillyTavern 服务。
- 提供统一多模型接口 `http://127.0.0.1:7821/v1`。
- 自动为聊天请求注入中文输出规则，让本地模型和云端模型默认使用简体中文回复。
- 直连 DeepSeek API，模型名：`deepseek-v4-flash`、`deepseek-v4-pro`。
- 直连 OpenAI API，模型名：`gpt-5.4-mini`、`gpt-5.5`、`gpt-5.5-pro`、`gpt-4.1`、`gpt-4o`。
- 提供智能体模型名 `pr-agent`：参考 CrewAI 的角色/任务分工和 AIRI 的本地陪伴优先思路，自动判断任务类型、注入专员提示词并选择本地/DeepSeek/OpenAI。
- 保留智能模型名 `pr-auto`：只做轻量模型路由，不加专员分工提示词。
- 打开默认模型目录 `E:\AI-Models\PR`。
- 打包安装后通过 GitHub Release 自动检查更新。

### SillyTavern 多模型接口

在 SillyTavern 中选择 Chat Completion / Custom OpenAI-compatible：

- Base URL：`http://127.0.0.1:7821/v1`
- API Key：本地代理可填任意占位文本，例如 `pr-desktop`
- 智能体默认模型：`pr-agent`
- 轻量智能路由：`pr-auto`
- 本地主力模型：`pr-qwen35-9b`
- DeepSeek 速度优先：`deepseek-v4-flash`
- DeepSeek 质量优先：`deepseek-v4-pro`
- OpenAI 速度优先：`openai-fast` / `gpt-5.4-mini`
- OpenAI 质量优先：`openai-quality` / `gpt-5.5`
- OpenAI 高质量：`openai-premium` / `gpt-5.5-pro`

代理会按模型名自动分流：`pr-agent` 自动识别 RP、总结、记忆、角色卡、世界书、剧情导演、中文润色等场景；本地模型走 LM Studio，DeepSeek 模型走 DeepSeek API，OpenAI 模型走 OpenAI API。LM Studio 当前加载的本地模型会自动加入模型列表，`pr-qwen35-9b` 会优先映射到实际加载的非 embedding 模型。`pr-premium` / `auto-openai` 会在总结和规划类任务上优先使用 OpenAI。`deepseek-chat` 和 `deepseek-reasoner` 也能识别，但官方已给出弃用时间，建议优先使用 `deepseek-v4-flash` / `deepseek-v4-pro`。

### PR Agent 分工

- `pr-agent`：总控智能体，自动判断任务并分派专员。
- `pr-rp-agent`：角色扮演/陪伴专员，优先使用 LM Studio 本地模型。
- `pr-memory-agent`：记忆整理专员，负责 Summary、关系进展、偏好、承诺和伏笔压缩。
- `pr-lore-agent`：世界书/角色卡架构师，负责设定一致性、World Info 和角色卡结构。
- `pr-director-agent`：剧情导演专员，负责节奏、冲突、伏笔和场景推进。
- `pr-style-agent`：中文文风润色专员，负责中文语感、语气统一和改写。

### DeepSeek API Key

先保存你的 DeepSeek API Key：

```powershell
.\set-deepseek-key.cmd
```

也可以手动设置 Windows 用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "你的 DeepSeek Key", "User")
[Environment]::SetEnvironmentVariable("DEEPSEEK_BASE_URL", "https://api.deepseek.com", "User")
```

设置后重启 PR Desktop。

### OpenAI API Key

先保存你的 OpenAI API Key：

```powershell
.\set-openai-key.cmd
```

也可以手动设置 Windows 用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "你的 OpenAI Key", "User")
[Environment]::SetEnvironmentVariable("OPENAI_BASE_URL", "https://api.openai.com/v1", "User")
```

设置后重启 PR Desktop。

如果你不打开 PR Desktop，只用浏览器访问 SillyTavern，请先双击 `start-model-proxy.cmd`，否则 SillyTavern 连接不到 `7821/v1`。

本地开发：

```powershell
cd desktop
npm install
npm run dev
```

本地打包：

```powershell
.\build-pr-desktop.cmd
```

GitHub 自动构建：

- 推送 `v*` 标签会触发 `.github/workflows/desktop-release.yml`。
- 工作流会在 Windows 上构建 NSIS 安装包和 portable 包，并发布到 GitHub Release。
- 已安装的 PR Desktop 会从 `Machuans/PR` 的 GitHub Release 检查更新。

## 推荐运行参数

- Temperature：`0.85-1.05`
- Top P：`0.9`
- Repetition Penalty：`1.05-1.12`
- Max Response Tokens：`500-900`
- Context：本地 8B/9B 先从 `8192-16384` 开始，稳定后再上调。

## 使用规则

- 高尺度会话优先使用本地模型。
- 云端模型只在其服务条款允许范围内使用。
- 不使用 jailbreak 或规程规避提示词。
- 角色卡、World Info、Summary 都必须持续保留：虚构、成年、自愿、不替用户行动。
