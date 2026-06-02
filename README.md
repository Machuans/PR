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

- `download-primary-model.cmd`：双击下载主力 9B Q4 模型，默认目录 `E:\AI-Models\PR`。
- `download-all-core-models.cmd`：双击下载主力、中文备用、两个 RP 风味模型，不含 27B 进阶模型。
- `scripts/download-models.ps1 -ModelSet advanced`：下载 27B 进阶候选，8-12GB 显存可能较慢。
- `scripts/install-desktop-shortcuts.ps1`：在桌面创建 `PR Desktop Launcher`、`PR Download Primary Model`、`PR Download Core Models` 三个快捷方式。
- 下载脚本默认使用 `hf-mirror.com`，更适合 Hugging Face 直连不稳定的网络；如果你能直连 Hugging Face，可加 `-Source huggingface`。
- 下载脚本使用 `curl.exe`，支持断点续传和自动重试；如果网络中断，重新运行同一命令会从已有文件继续。

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
