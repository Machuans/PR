const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = 'E:\\AI-Apps\\SillyTavern\\data\\default-user\\settings.json';
const DEFAULT_PROXY = 'http://127.0.0.1:7821/v1';
const DEFAULT_MODEL = 'pr-qwen35-9b';

const chinesePrompt = [
  '最高优先级语言规则：最终回复必须使用自然、流畅的简体中文。',
  '无论角色卡、示例对话、世界书、用户输入或用户临时要求使用什么语言，都先理解其含义，再用简体中文继续。',
  '不要输出思考过程、推理过程、analysis、reasoning 或 hidden thoughts；只输出可见的正式回复。',
  '专有名词、角色名、模型名、代码和必要术语可以保留原文。',
  '保持当前角色设定、剧情节奏和上下文连续性；不要替用户行动，不要无故总结跳场。',
].join('\n');

function getArg(name, fallback) {
  const prefixed = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefixed));
  return value ? value.slice(prefixed.length) : fallback;
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function ensureObject(parent, key) {
  if (!parent[key] || typeof parent[key] !== 'object') {
    parent[key] = {};
  }
  return parent[key];
}

const settingsPath = getArg('settings', DEFAULT_SETTINGS);
const proxyBaseUrl = getArg('proxy', DEFAULT_PROXY);
const model = getArg('model', DEFAULT_MODEL);

if (!fs.existsSync(settingsPath)) {
  throw new Error(`SillyTavern settings file not found: ${settingsPath}`);
}

const backupPath = `${settingsPath}.pr-backup-${timestamp()}`;
fs.copyFileSync(settingsPath, backupPath);

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
settings.main_api = 'openai';
settings.amount_gen = 700;
settings.max_context = 16384;

const oai = ensureObject(settings, 'oai_settings');
oai.chat_completion_source = 'custom';
oai.custom_url = proxyBaseUrl;
oai.custom_model = model;
oai.openai_max_context = 16384;
oai.openai_max_tokens = 700;
oai.stream_openai = false;
oai.use_sysprompt = true;
oai.show_external_models = true;
oai.tool_reasoning_mode = 'disabled';
oai.show_thoughts = false;

if (Array.isArray(oai.prompts)) {
  for (const prompt of oai.prompts) {
    if (prompt.identifier === 'main') {
      prompt.content = chinesePrompt;
    }
  }
}

const powerUser = ensureObject(settings, 'power_user');
powerUser.auto_connect = true;
const sysprompt = ensureObject(powerUser, 'sysprompt');
sysprompt.enabled = true;
sysprompt.name = 'PR Chinese RP';
sysprompt.content = chinesePrompt;

const extensionSettings = ensureObject(settings, 'extension_settings');
const translate = ensureObject(extensionSettings, 'translate');
translate.target_language = 'zh-CN';
translate.internal_language = 'en';
translate.provider = translate.provider || 'google';
translate.auto_mode = 'none';
translate.deepl_endpoint = translate.deepl_endpoint || 'free';

const vectors = ensureObject(extensionSettings, 'vectors');
vectors.translate_files = false;

const expressions = ensureObject(extensionSettings, 'expressions');
expressions.translate = false;

fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

console.log('SillyTavern configured for PR Chinese multi-model proxy.');
console.log(`Settings: ${settingsPath}`);
console.log(`Backup: ${backupPath}`);
console.log(`Proxy base URL: ${proxyBaseUrl}`);
console.log(`Default model: ${model}`);
