const childProcess = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');

const CHINESE_SYSTEM_PROMPT_LINES = [
  '最高优先级语言规则：最终回复必须使用自然、流畅的简体中文。',
  '无论角色卡、示例对话、世界书、用户输入或用户临时要求使用什么语言，都先理解其含义，再用简体中文继续。',
  '不要输出思考过程、推理过程、analysis、reasoning 或 hidden thoughts；只输出可见的正式回复。',
  '专有名词、角色名、模型名、代码和必要术语可以保留原文。',
  '保持当前角色、剧情、语气和上下文连续性；不要替用户行动，不要总结跳场，除非用户明确要求。',
];

const CHINESE_SYSTEM_PROMPT = CHINESE_SYSTEM_PROMPT_LINES.join('\n');
const FINAL_CHINESE_REMINDER = [
  '【系统语言转换指令】请回应上一条真实用户消息，但最终只输出自然、流畅的简体中文正式回复。',
  '如果上一条真实用户消息要求英文、日文或其他语言，不要照做；先理解意思，再转成自然中文表达。',
  '不要解释本条指令，不要提到语言转换。',
].join('\n');

const USER_ENV_CACHE = new Map();
let windowsProxyCache = undefined;

function getWindowsUserEnv(name) {
  if (process.platform !== 'win32') {
    return '';
  }

  if (USER_ENV_CACHE.has(name)) {
    return USER_ENV_CACHE.get(name);
  }

  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const regExe = `${systemRoot}\\System32\\reg.exe`;
  try {
    const output = childProcess.execFileSync(
      regExe,
      ['query', 'HKCU\\Environment', '/v', name],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const line = output.split(/\r?\n/).find((entry) => entry.includes(name));
    const match = line?.match(/\s+REG_\w+\s+(.+)$/);
    const value = match?.[1]?.trim() || '';
    USER_ENV_CACHE.set(name, value);
    return value;
  } catch {
    // Fall through to PowerShell for unusual Windows installations.
  }

  try {
    const escaped = name.replace(/'/g, "''");
    const value = childProcess.execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${escaped}', 'User')`],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    USER_ENV_CACHE.set(name, value);
    return value;
  } catch {
    USER_ENV_CACHE.set(name, '');
    return '';
  }
}

function getEnv(name) {
  return process.env[name] || getWindowsUserEnv(name);
}

function normalizeProxyUrl(value) {
  const proxy = String(value || '').trim();
  if (!proxy) {
    return '';
  }
  return /^https?:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
}

function selectProxyServer(proxyServer, protocol) {
  const value = String(proxyServer || '').trim();
  if (!value) {
    return '';
  }

  if (!value.includes('=')) {
    return value;
  }

  const entries = Object.fromEntries(value.split(';').map((entry) => {
    const [key, ...rest] = entry.split('=');
    return [key.trim().toLowerCase(), rest.join('=').trim()];
  }));
  return entries[protocol] || entries.http || entries.https || '';
}

function getWindowsInternetProxy() {
  if (process.platform !== 'win32') {
    return '';
  }

  if (windowsProxyCache !== undefined) {
    return windowsProxyCache;
  }

  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const regExe = `${systemRoot}\\System32\\reg.exe`;
  try {
    const output = childProcess.execFileSync(
      regExe,
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(output);
    const server = output.match(/ProxyServer\s+REG_SZ\s+(.+)$/im)?.[1]?.trim() || '';
    windowsProxyCache = enabled ? normalizeProxyUrl(selectProxyServer(server, 'https')) : '';
    return windowsProxyCache;
  } catch {
    windowsProxyCache = '';
    return '';
  }
}

function getProxyForUrl(url) {
  if (url.protocol !== 'https:') {
    return '';
  }

  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    return '';
  }

  return normalizeProxyUrl(getEnv('HTTPS_PROXY') || getEnv('HTTP_PROXY') || getWindowsInternetProxy());
}

const DEFAULT_LOCAL_MODEL = getEnv('PR_MODEL_ID') || 'pr-qwen35-9b';
const DEFAULT_PROXY_MODEL = getEnv('PR_PROXY_MODEL_ID') || 'pr-agent';
const DEFAULT_OPENAI_FAST_MODEL = getEnv('PR_OPENAI_FAST_MODEL') || 'gpt-5.4-mini';
const DEFAULT_OPENAI_QUALITY_MODEL = getEnv('PR_OPENAI_QUALITY_MODEL') || 'gpt-5.5';
const DEFAULT_OPENAI_PREMIUM_MODEL = getEnv('PR_OPENAI_PREMIUM_MODEL') || 'gpt-5.5-pro';
const SMART_MODEL_IDS = ['pr-auto', 'auto', 'smart', 'default', 'pr-premium', 'auto-openai'];
const AGENT_MODES = [
  {
    id: 'pr-agent',
    aliases: ['agent', 'crew-agent', 'agent-manager'],
    scene: 'auto',
    label: 'PR Agent Manager',
    role: '任务管理智能体',
    description: '自动判断任务类型，分派给 RP、记忆、设定、剧情导演或润色专员。',
  },
  {
    id: 'pr-rp-agent',
    aliases: ['agent-rp', 'rp-agent', 'companion-agent'],
    scene: 'roleplay',
    label: 'PR RP Agent',
    role: '角色扮演专员',
    description: '优先使用本地模型，负责沉浸式中文角色互动和陪伴感。',
  },
  {
    id: 'pr-memory-agent',
    aliases: ['agent-memory', 'memory-agent', 'summary-agent'],
    scene: 'memory',
    label: 'PR Memory Agent',
    role: '记忆整理专员',
    description: '负责 Summary、关系进展、偏好、承诺和伏笔压缩。',
  },
  {
    id: 'pr-lore-agent',
    aliases: ['agent-lore', 'lore-agent', 'world-agent'],
    scene: 'lore',
    label: 'PR Lore Agent',
    role: '世界书与角色卡架构师',
    description: '负责角色卡、世界书、设定一致性和长期剧情骨架。',
  },
  {
    id: 'pr-director-agent',
    aliases: ['agent-director', 'director-agent', 'plot-agent'],
    scene: 'director',
    label: 'PR Director Agent',
    role: '剧情导演专员',
    description: '负责剧情节奏、冲突、伏笔和场景推进建议。',
  },
  {
    id: 'pr-style-agent',
    aliases: ['agent-style', 'style-agent', 'rewrite-agent'],
    scene: 'style',
    label: 'PR Style Agent',
    role: '中文文风润色专员',
    description: '负责中文语感、语气统一、润色和改写。',
  },
];

const SUMMARY_KEYWORDS = [
  'summary',
  'summarize',
  'memory',
  'lorebook',
  'world info',
  'author note',
  '总结',
  '摘要',
  '记忆',
  '回顾',
  '归纳',
  '提炼',
  '世界书',
  '作者注',
  '聊天补全',
  '关系进展',
];
const PLANNING_KEYWORDS = [
  'analyze',
  'analysis',
  'outline',
  'profile',
  'character card',
  'worldbuilding',
  '分析',
  '推理',
  '规划',
  '大纲',
  '设定',
  '角色卡',
  '世界观',
  '长篇',
  '结构',
];
const STYLE_KEYWORDS = [
  'rewrite',
  'polish',
  'style',
  'tone',
  '改写',
  '润色',
  '扩写',
  '文风',
  '语感',
  '措辞',
  '翻译',
];
const DIRECTOR_KEYWORDS = [
  'plot',
  'director',
  'beat',
  'pacing',
  '剧情',
  '导演',
  '节奏',
  '冲突',
  '伏笔',
  '转场',
  '分镜',
];

const AGENT_PROMPTS = {
  roleplay: [
    '【PR Agent：角色扮演专员】',
    '职责：维持当前角色、关系张力、陪伴感和中文网文语感。',
    '边界：不要替用户行动，不要无故总结跳场，不要暴露模型分工。',
    '策略：优先回应眼前互动；需要设定时只轻量补全，不抢剧情控制权。',
  ].join('\n'),
  memory: [
    '【PR Agent：记忆整理专员】',
    '职责：只保留长期有用的信息：关系变化、关键事件、偏好、承诺、未解决伏笔、角色状态。',
    '输出：简洁、可贴入 Summary / Lorebook / Author Note 的中文条目。',
    '边界：不要扩写剧情，不要添加没有依据的新事实。',
  ].join('\n'),
  lore: [
    '【PR Agent：世界书与角色卡架构师】',
    '职责：整理角色固定设定、世界规则、关系约束、触发条件和长期一致性。',
    '输出：结构清晰、可执行、便于导入 SillyTavern World Info / 角色卡。',
    '边界：保持虚构、成年、自愿互动前提；不要替用户决定角色行为。',
  ].join('\n'),
  director: [
    '【PR Agent：剧情导演专员】',
    '职责：判断剧情节奏、冲突、场景目标、伏笔回收和下一步推进。',
    '输出：优先给可直接进入 RP 的正文；用户要求方案时再给简短分镜/节奏建议。',
    '边界：不要把剧情讲成报告，不要过早总结或跳场。',
  ].join('\n'),
  style: [
    '【PR Agent：中文文风润色专员】',
    '职责：提升中文自然度、情绪细腻度、语气统一和画面感。',
    '输出：只给润色后的正文或用户要求的格式。',
    '边界：保留原意和必要术语，不添加无依据的新事实。',
  ].join('\n'),
};

const PROVIDERS = [
  {
    id: 'local',
    label: 'LM Studio Local',
    baseUrl: getEnv('PR_LMSTUDIO_URL') || 'http://127.0.0.1:1234/v1',
    apiKeyEnv: null,
    models: [
      {
        id: DEFAULT_LOCAL_MODEL,
        label: 'PR Qwen 9B Local',
        aliases: ['local/pr-qwen35-9b', 'local', 'lmstudio'],
      },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API',
    baseUrl: getEnv('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: [
      {
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        aliases: ['deepseek/deepseek-v4-flash', 'deepseek-chat'],
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        aliases: ['deepseek/deepseek-v4-pro', 'deepseek-reasoner'],
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    baseUrl: getEnv('OPENAI_BASE_URL') || 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: [
      {
        id: DEFAULT_OPENAI_FAST_MODEL,
        label: 'OpenAI GPT Fast',
        aliases: ['openai-fast', 'openai-gpt-5.4-mini', 'openai/gpt-5.4-mini'],
      },
      {
        id: DEFAULT_OPENAI_QUALITY_MODEL,
        label: 'OpenAI GPT Quality',
        aliases: ['openai-quality', 'openai-gpt-5.5', 'openai/gpt-5.5'],
      },
      {
        id: DEFAULT_OPENAI_PREMIUM_MODEL,
        label: 'OpenAI GPT Premium',
        aliases: ['openai-premium', 'openai-gpt-5.5-pro', 'openai/gpt-5.5-pro'],
      },
      {
        id: 'gpt-4.1',
        label: 'OpenAI GPT-4.1',
        aliases: ['openai-gpt-4.1', 'openai/gpt-4.1'],
      },
      {
        id: 'gpt-4o',
        label: 'OpenAI GPT-4o',
        aliases: ['openai-gpt-4o', 'openai/gpt-4o'],
      },
      {
        id: 'gpt-4o-mini',
        label: 'OpenAI GPT-4o Mini',
        aliases: ['openai-gpt-4o-mini', 'openai/gpt-4o-mini'],
      },
    ],
  },
];

function getAllModelIds() {
  return [
    ...SMART_MODEL_IDS,
    ...AGENT_MODES.flatMap((agent) => [agent.id, ...(agent.aliases || [])]),
    ...PROVIDERS.flatMap((provider) => provider.models.flatMap((model) => [model.id, ...(model.aliases || [])])),
  ];
}

function getProviderApiKey(provider) {
  return provider.apiKeyEnv ? getEnv(provider.apiKeyEnv) : '';
}

function isProviderConfigured(provider) {
  return provider.apiKeyEnv ? Boolean(getProviderApiKey(provider)) : true;
}

function textFromContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part?.type === 'text') {
        return part.text || '';
      }
      return '';
    }).join('\n');
  }

  return '';
}

function messagesToText(messages) {
  return Array.isArray(messages)
    ? messages.map((message) => textFromContent(message?.content)).filter(Boolean).join('\n')
    : '';
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function getAgentMode(modelId) {
  return AGENT_MODES.find((agent) => agent.id === modelId || agent.aliases?.includes(modelId)) || null;
}

function isLocalModelAlias(modelId) {
  return [
    DEFAULT_LOCAL_MODEL,
    'local/pr-qwen35-9b',
    'local',
    'lmstudio',
    'pr-local',
  ].includes(modelId);
}

function getUsableLocalModels(localModels = []) {
  return [...new Set((Array.isArray(localModels) ? localModels : [])
    .filter((modelId) => typeof modelId === 'string' && modelId.trim())
    .filter((modelId) => !/embed|embedding|rerank/i.test(modelId)))];
}

function resolveLocalModel(modelId, localModels = []) {
  const usable = getUsableLocalModels(localModels);
  if (!usable.length) {
    return modelId || DEFAULT_LOCAL_MODEL;
  }

  if (usable.includes(modelId)) {
    return modelId;
  }

  if (!modelId || isLocalModelAlias(modelId)) {
    return usable[0];
  }

  return modelId;
}

function getCloudModelForScene(scene, mode = DEFAULT_PROXY_MODEL) {
  const deepseek = PROVIDERS.find((provider) => provider.id === 'deepseek');
  const openai = PROVIDERS.find((provider) => provider.id === 'openai');
  const deepseekConfigured = deepseek ? isProviderConfigured(deepseek) : false;
  const openaiConfigured = openai ? isProviderConfigured(openai) : false;
  const openaiPreferred = ['pr-premium', 'auto-openai', 'pr-agent-openai'].includes(mode);
  const memoryModel = openaiPreferred && openaiConfigured
    ? DEFAULT_OPENAI_FAST_MODEL
    : deepseekConfigured
      ? 'deepseek-v4-flash'
      : openaiConfigured
        ? DEFAULT_OPENAI_FAST_MODEL
        : DEFAULT_LOCAL_MODEL;
  const planningModel = openaiPreferred && openaiConfigured
    ? DEFAULT_OPENAI_QUALITY_MODEL
    : deepseekConfigured
      ? 'deepseek-v4-pro'
      : openaiConfigured
        ? DEFAULT_OPENAI_QUALITY_MODEL
        : DEFAULT_LOCAL_MODEL;

  if (scene === 'memory' || scene === 'style') {
    return memoryModel;
  }

  if (scene === 'lore' || scene === 'director' || scene === 'planning') {
    return planningModel;
  }

  return DEFAULT_LOCAL_MODEL;
}

function selectSmartModel(messages = [], mode = DEFAULT_PROXY_MODEL) {
  const deepseek = PROVIDERS.find((provider) => provider.id === 'deepseek');
  const openai = PROVIDERS.find((provider) => provider.id === 'openai');
  const text = messagesToText(messages);
  const normalized = text.toLowerCase();
  const deepseekConfigured = deepseek ? isProviderConfigured(deepseek) : false;
  const openaiConfigured = openai ? isProviderConfigured(openai) : false;

  if (getEnv('PR_SMART_LOCAL_ONLY') === 'true' || (!deepseekConfigured && !openaiConfigured)) {
    return {
      model: DEFAULT_LOCAL_MODEL,
      reason: deepseekConfigured || openaiConfigured ? 'local_only' : 'cloud_not_configured',
      scene: 'local_default',
    };
  }

  if (hasAny(normalized, SUMMARY_KEYWORDS)) {
    return {
      model: getCloudModelForScene('memory', mode),
      reason: 'summary_memory',
      scene: 'memory',
    };
  }

  if (text.length > 7000 || hasAny(normalized, PLANNING_KEYWORDS) || hasAny(normalized, DIRECTOR_KEYWORDS)) {
    return {
      model: getCloudModelForScene('planning', mode),
      reason: text.length > 7000 ? 'long_context' : 'planning_or_rewrite',
      scene: 'planning',
    };
  }

  if (hasAny(normalized, STYLE_KEYWORDS)) {
    return {
      model: getCloudModelForScene('style', mode),
      reason: 'style_rewrite',
      scene: 'style',
    };
  }

  return {
    model: DEFAULT_LOCAL_MODEL,
    reason: 'roleplay_default',
    scene: 'roleplay',
  };
}

function classifyAgentScene(messages = [], mode = DEFAULT_PROXY_MODEL) {
  const agentMode = getAgentMode(mode);
  if (agentMode && agentMode.scene !== 'auto') {
    return agentMode.scene;
  }

  const text = messagesToText(messages);
  const normalized = text.toLowerCase();

  if (hasAny(normalized, SUMMARY_KEYWORDS)) {
    return 'memory';
  }
  if (hasAny(normalized, STYLE_KEYWORDS)) {
    return 'style';
  }
  if (hasAny(normalized, DIRECTOR_KEYWORDS)) {
    return 'director';
  }
  if (text.length > 7000 || hasAny(normalized, PLANNING_KEYWORDS)) {
    return 'lore';
  }
  return 'roleplay';
}

function selectAgent(messages = [], mode = DEFAULT_PROXY_MODEL) {
  const agentMode = getAgentMode(mode) || getAgentMode('pr-agent');
  const scene = classifyAgentScene(messages, mode);
  const model = scene === 'roleplay' ? DEFAULT_LOCAL_MODEL : getCloudModelForScene(scene, mode);
  const prompt = AGENT_PROMPTS[scene] || AGENT_PROMPTS.roleplay;

  return {
    id: agentMode.id,
    label: agentMode.label,
    role: agentMode.role,
    mode,
    scene,
    model,
    prompt,
    reason: `agent_${scene}`,
  };
}

function findRoute(modelId, messages = [], localModels = []) {
  const normalized = modelId || DEFAULT_PROXY_MODEL;
  const agentMode = getAgentMode(normalized);

  if (agentMode) {
    const agent = selectAgent(messages, normalized);
    const route = findRoute(agent.model, messages, localModels);
    return {
      ...route,
      requestedModel: normalized,
      agent,
      smart: true,
      smartModel: agent.model,
      smartReason: agent.reason,
      smartScene: agent.scene,
    };
  }

  if (SMART_MODEL_IDS.includes(normalized)) {
    const smart = selectSmartModel(messages, normalized);
    const route = findRoute(smart.model, messages, localModels);
    return {
      ...route,
      requestedModel: normalized,
      smart: true,
      smartModel: smart.model,
      smartReason: smart.reason,
      smartScene: smart.scene,
    };
  }

  for (const provider of PROVIDERS) {
    for (const model of provider.models) {
      if (model.id === normalized || model.aliases?.includes(normalized)) {
        return {
          provider,
          model: provider.id === 'local' ? resolveLocalModel(model.id, localModels) : model.id,
          requestedModel: normalized,
        };
      }
    }
  }

  return {
    provider: PROVIDERS[0],
    model: resolveLocalModel(normalized, localModels),
    requestedModel: normalized,
  };
}

function getProviderStatus() {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    configured: provider.apiKeyEnv ? Boolean(getProviderApiKey(provider)) : true,
    source: provider.apiKeyEnv && getProviderApiKey(provider) ? 'environment' : null,
    apiKeyEnv: provider.apiKeyEnv,
    models: provider.models.map((model) => ({
      id: model.id,
      label: model.label,
      aliases: model.aliases || [],
    })),
  }));
}

function getSmartModelStatus() {
  return {
    defaultModel: DEFAULT_PROXY_MODEL,
    smartModels: SMART_MODEL_IDS,
    localFallback: DEFAULT_LOCAL_MODEL,
    rules: [
      { scene: 'roleplay', model: DEFAULT_LOCAL_MODEL, description: '常规 RP、陪伴和短聊天优先走本地模型。' },
      { scene: 'memory', model: 'deepseek-v4-flash / gpt-5.4-mini', description: '总结、记忆、世界书整理优先走 DeepSeek Flash；DeepSeek 不可用时可走 OpenAI Fast。' },
      { scene: 'planning', model: 'deepseek-v4-pro / gpt-5.5', description: '长上下文、角色卡、设定、润色和复杂规划优先走 DeepSeek Pro；DeepSeek 不可用时可走 OpenAI Quality。' },
    ],
    agents: AGENT_MODES.map((agent) => ({
      id: agent.id,
      label: agent.label,
      role: agent.role,
      aliases: agent.aliases,
      scene: agent.scene,
      description: agent.description,
    })),
  };
}

function withAgentSystemPrompt(messages, agent) {
  if (!agent?.prompt || !Array.isArray(messages)) {
    return messages;
  }

  return [
    {
      role: 'system',
      content: agent.prompt,
    },
    ...messages,
  ];
}

function withChineseSystemPrompt(messages, providerId) {
  if (getEnv('PR_FORCE_CHINESE') === 'false') {
    return Array.isArray(messages) ? messages : [];
  }

  const original = Array.isArray(messages) ? messages : [];
  const normalized = providerId === 'local'
    ? original.map((message, index) => {
      if (index !== original.length - 1 || message.role !== 'user' || typeof message.content !== 'string') {
        return message;
      }
      return {
        ...message,
        content: `/no_think\n${message.content}`,
      };
    })
    : original;
  const prompt = providerId === 'local' ? `/no_think\n${CHINESE_SYSTEM_PROMPT}` : CHINESE_SYSTEM_PROMPT;
  return [
    {
      role: 'system',
      content: prompt,
    },
    ...normalized,
    {
      role: 'system',
      content: FINAL_CHINESE_REMINDER,
    },
  ];
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(json);
}

function getModelOwner(modelId) {
  if (modelId.startsWith('deepseek') || modelId.startsWith('deepseek/')) {
    return 'deepseek';
  }
  if (modelId.startsWith('gpt-') || modelId.startsWith('openai')) {
    return 'openai';
  }
  return 'pr-desktop';
}

function createModelList(extraLocalModels = []) {
  const known = new Set();
  const data = [];

  for (const modelId of getAllModelIds()) {
    if (known.has(modelId)) {
      continue;
    }
    known.add(modelId);
    data.push({
      id: modelId,
      object: 'model',
      owned_by: getModelOwner(modelId),
    });
  }

  for (const modelId of extraLocalModels) {
    if (known.has(modelId)) {
      continue;
    }
    known.add(modelId);
    data.push({
      id: modelId,
      object: 'model',
      owned_by: 'lm-studio',
    });
  }

  return {
    object: 'list',
    data,
  };
}

function prepareProviderPayload(payload, provider) {
  const prepared = { ...payload };

  if (provider.id === 'openai' && prepared.max_tokens !== undefined && prepared.max_completion_tokens === undefined) {
    prepared.max_completion_tokens = prepared.max_tokens;
    delete prepared.max_tokens;
  }

  if (provider.id === 'openai') {
    delete prepared.include_reasoning;
  }

  return prepared;
}

function forwardHttpsViaProxy(url, body, headers, proxyUrl) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const proxyPort = proxy.port || (proxy.protocol === 'https:' ? 443 : 8080);
    const targetPort = url.port || 443;
    const connect = http.request({
      method: 'CONNECT',
      hostname: proxy.hostname,
      port: proxyPort,
      path: `${url.hostname}:${targetPort}`,
      headers: {
        Host: `${url.hostname}:${targetPort}`,
      },
    });

    connect.on('connect', (connectRes, socket) => {
      if ((connectRes.statusCode || 500) < 200 || (connectRes.statusCode || 500) >= 300) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed with status ${connectRes.statusCode || 0}`));
        return;
      }

      const tlsSocket = tls.connect({
        socket,
        servername: url.hostname,
      }, () => {
        const req = https.request({
          method: 'POST',
          hostname: url.hostname,
          port: targetPort,
          path: `${url.pathname}${url.search}`,
          createConnection: () => tlsSocket,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...headers,
          },
        }, (upstream) => {
          resolve(upstream);
        });

        req.on('error', reject);
        req.write(body);
        req.end();
      });

      tlsSocket.on('error', reject);
    });

    connect.on('error', reject);
    connect.end();
  });
}

function forwardJsonRequest(targetUrl, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const body = JSON.stringify(payload);
    const proxy = getProxyForUrl(url);
    if (proxy) {
      forwardHttpsViaProxy(url, body, headers, proxy).then(resolve, reject);
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (upstream) => {
        resolve(upstream);
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function collectResponseBody(stream) {
  return new Promise((resolve, reject) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      body += chunk;
    });
    stream.on('end', () => resolve(body));
    stream.on('error', reject);
  });
}

function stripReasoningFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripReasoningFields);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const cleaned = {};
  for (const [key, nested] of Object.entries(value)) {
    if (['reasoning', 'reasoning_content', 'thoughts', 'hidden_thoughts'].includes(key)) {
      continue;
    }
    cleaned[key] = stripReasoningFields(nested);
  }
  return cleaned;
}

function needsChineseRewrite(text) {
  if (getEnv('PR_AUTO_CHINESE_REWRITE') === 'false') {
    return false;
  }

  const content = String(text || '').trim();
  if (!content) {
    return false;
  }

  const cjkCount = (content.match(/[\u3400-\u9fff]/g) || []).length;
  const letterCount = (content.match(/[A-Za-z\u3400-\u9fff]/g) || []).length;
  return cjkCount < 2 || (letterCount > 0 && cjkCount / letterCount < 0.18);
}

async function rewriteTextToChinese(text, provider, model, headers) {
  const rewritePrompt = [
    provider.id === 'local' ? '/no_think' : '',
    '把用户提供的文本改写为自然、流畅的简体中文。',
    '只输出改写后的正文，不要解释，不要总结，不要添加新事实。',
    '保留角色名、专有名词、代码、URL 和必要术语的原文。',
  ].filter(Boolean).join('\n');

  const payload = {
    model,
    stream: false,
    temperature: 0.1,
    max_tokens: Math.min(2000, Math.max(900, Math.ceil(String(text).length * 3))),
    messages: [
      {
        role: 'system',
        content: rewritePrompt,
      },
      {
        role: 'user',
        content: provider.id === 'local' ? `/no_think\n${String(text)}` : String(text),
      },
      {
        role: 'system',
        content: '只允许输出简体中文正文。不要输出英文，不要解释。',
      },
    ],
  };
  const upstreamBody = prepareProviderPayload(payload, provider);

  const upstream = await forwardJsonRequest(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, upstreamBody, headers);
  const body = await collectResponseBody(upstream);
  if ((upstream.statusCode || 500) < 200 || (upstream.statusCode || 500) >= 300) {
    return null;
  }

  try {
    const parsed = stripReasoningFields(JSON.parse(body));
    return parsed?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

async function rewriteResponseChoicesToChinese(payload, provider, model, headers) {
  if (!payload?.choices || !Array.isArray(payload.choices)) {
    return payload;
  }

  for (const choice of payload.choices) {
    const message = choice?.message;
    if (!message?.content || !needsChineseRewrite(message.content)) {
      continue;
    }

    const rewritten = await rewriteTextToChinese(message.content, provider, model, headers);
    if (rewritten) {
      message.content = rewritten;
    }
  }

  return payload;
}

async function sendUpstreamResponse(res, upstream, requestBody, provider, headers) {
  if (requestBody.stream) {
    res.writeHead(upstream.statusCode || 502, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': upstream.headers['content-type'] || 'application/json; charset=utf-8',
    });
    upstream.pipe(res);
    return;
  }

  const body = await collectResponseBody(upstream);
  const contentType = upstream.headers['content-type'] || 'application/json; charset=utf-8';

  if (!contentType.includes('application/json') || getEnv('PR_STRIP_REASONING') === 'false') {
    res.writeHead(upstream.statusCode || 502, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': contentType,
    });
    res.end(body);
    return;
  }

  try {
    const cleaned = stripReasoningFields(JSON.parse(body));
    const rewritten = await rewriteResponseChoicesToChinese(cleaned, provider, requestBody.model, headers);
    sendJson(res, upstream.statusCode || 502, rewritten);
  } catch {
    res.writeHead(upstream.statusCode || 502, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': contentType,
    });
    res.end(body);
  }
}

async function handleChatCompletions(req, res, localModels = []) {
  const requestBody = await readJsonBody(req);
  const route = findRoute(requestBody.model, requestBody.messages, localModels);
  const provider = route.provider;

  if (provider.apiKeyEnv && !getProviderApiKey(provider)) {
    sendJson(res, 401, {
      error: {
        message: `${provider.label} is not configured. Set ${provider.apiKeyEnv} first.`,
        type: 'missing_api_key',
        provider: provider.id,
      },
    });
    return;
  }

  const upstreamBody = {
    ...requestBody,
    model: route.model,
    messages: withChineseSystemPrompt(withAgentSystemPrompt(requestBody.messages, route.agent), provider.id),
  };

  if (provider.id === 'local') {
    upstreamBody.include_reasoning = false;
  }

  const headers = {};
  if (provider.apiKeyEnv) {
    headers.Authorization = `Bearer ${getProviderApiKey(provider)}`;
  } else if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  const preparedBody = prepareProviderPayload(upstreamBody, provider);
  const upstream = await forwardJsonRequest(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, preparedBody, headers);
  await sendUpstreamResponse(res, upstream, preparedBody, provider, headers);
}

function canHandleModelProxy(req, res, url, localModels = []) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    sendJson(res, 200, createModelList(localModels));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    handleChatCompletions(req, res, localModels).catch((error) => {
      sendJson(res, 502, {
        error: {
          message: error.message,
          type: 'proxy_error',
        },
      });
    });
    return true;
  }

  return false;
}

module.exports = {
  CHINESE_SYSTEM_PROMPT,
  DEFAULT_PROXY_MODEL,
  SMART_MODEL_IDS,
  canHandleModelProxy,
  createModelList,
  findRoute,
  getEnv,
  getProviderStatus,
  getSmartModelStatus,
  selectAgent,
  selectSmartModel,
  withChineseSystemPrompt,
};
