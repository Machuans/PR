const http = require('node:http');
const https = require('node:https');

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

const PROVIDERS = [
  {
    id: 'local',
    label: 'LM Studio Local',
    baseUrl: process.env.PR_LMSTUDIO_URL || 'http://127.0.0.1:1234/v1',
    apiKeyEnv: null,
    models: [
      {
        id: process.env.PR_MODEL_ID || 'pr-qwen35-9b',
        label: 'PR Qwen 9B Local',
        aliases: ['local/pr-qwen35-9b'],
      },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
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
];

function getAllModelIds() {
  return PROVIDERS.flatMap((provider) => provider.models.flatMap((model) => [model.id, ...(model.aliases || [])]));
}

function findRoute(modelId) {
  const normalized = modelId || process.env.PR_MODEL_ID || 'pr-qwen35-9b';

  for (const provider of PROVIDERS) {
    for (const model of provider.models) {
      if (model.id === normalized || model.aliases?.includes(normalized)) {
        return {
          provider,
          model: model.id,
          requestedModel: normalized,
        };
      }
    }
  }

  return {
    provider: PROVIDERS[0],
    model: normalized,
    requestedModel: normalized,
  };
}

function getProviderStatus() {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    configured: provider.apiKeyEnv ? Boolean(process.env[provider.apiKeyEnv]) : true,
    apiKeyEnv: provider.apiKeyEnv,
    models: provider.models.map((model) => ({
      id: model.id,
      label: model.label,
      aliases: model.aliases || [],
    })),
  }));
}

function withChineseSystemPrompt(messages, providerId) {
  if (process.env.PR_FORCE_CHINESE === 'false') {
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
      owned_by: modelId.startsWith('deepseek') || modelId.startsWith('deepseek/') ? 'deepseek' : 'pr-desktop',
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

function forwardJsonRequest(targetUrl, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const body = JSON.stringify(payload);
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
  if (process.env.PR_AUTO_CHINESE_REWRITE === 'false') {
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

  const upstream = await forwardJsonRequest(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, payload, headers);
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

  if (!contentType.includes('application/json') || process.env.PR_STRIP_REASONING === 'false') {
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

async function handleChatCompletions(req, res) {
  const requestBody = await readJsonBody(req);
  const route = findRoute(requestBody.model);
  const provider = route.provider;

  if (provider.apiKeyEnv && !process.env[provider.apiKeyEnv]) {
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
    messages: withChineseSystemPrompt(requestBody.messages, provider.id),
  };

  if (provider.id === 'local') {
    upstreamBody.include_reasoning = false;
  }

  const headers = {};
  if (provider.apiKeyEnv) {
    headers.Authorization = `Bearer ${process.env[provider.apiKeyEnv]}`;
  } else if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  const upstream = await forwardJsonRequest(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, upstreamBody, headers);
  await sendUpstreamResponse(res, upstream, upstreamBody, provider, headers);
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
    handleChatCompletions(req, res).catch((error) => {
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
  canHandleModelProxy,
  createModelList,
  findRoute,
  getProviderStatus,
  withChineseSystemPrompt,
};
