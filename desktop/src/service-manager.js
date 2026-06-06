const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
  canHandleModelProxy,
  getProviderStatus,
  getSmartModelStatus,
} = require('./model-proxy');

const CONFIG = {
  sillyTavernDir: process.env.PR_SILLYTAVERN_DIR || 'E:\\AI-Apps\\SillyTavern',
  modelDir: process.env.PR_MODEL_DIR || 'E:\\AI-Models\\PR',
  sillyTavernUrl: process.env.PR_SILLYTAVERN_URL || 'http://127.0.0.1:8000',
  lmStudioBaseUrl: process.env.PR_LMSTUDIO_URL || 'http://127.0.0.1:1234/v1',
  lmStudioRestBaseUrl: process.env.PR_LMSTUDIO_REST_URL || '',
  preferredLmStudioModel: process.env.PR_LMSTUDIO_MODEL || '',
  preferredModelId: process.env.PR_MODEL_ID || 'pr-qwen35-9b',
  defaultProxyModelId: process.env.PR_PROXY_MODEL_ID || 'pr-agent',
  backendStartPort: Number(process.env.PR_BACKEND_PORT || 7821),
};

const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'PR Desktop');
const logDir = path.join(appDataDir, 'logs');
const sillyTavernLog = path.join(logDir, 'sillytavern.log');
const lmStudioLog = path.join(logDir, 'lmstudio.log');
const themeMarkers = ['PR Desktop chat app theme', 'PR WeChat-inspired chat theme'];
const themeFileName = 'sillytavern_wechat_user.css';
const configDir = path.join(appDataDir, 'config');
const memoryDir = path.join(appDataDir, 'memory');
const localCharacterDir = path.join(appDataDir, 'characters');
const settingsFile = path.join(configDir, 'settings.json');
const memoryFile = path.join(memoryDir, 'memory.json');

const defaultSettings = {
  appearance: {
    theme: 'dark',
    fontSize: 16,
    pageWidth: 'comfortable',
    avatarStyle: 'rounded',
  },
  chat: {
    style: 'wechat',
    bubbleWidth: 72,
    messageSpacing: 12,
    showAvatar: true,
  },
  background: {
    image: '',
    blur: 18,
    opacity: 0.62,
    shadow: true,
  },
  advanced: {
    customCss: '',
    visualEffects: true,
    performanceMode: false,
  },
};

const defaultMemory = {
  shortTerm: [],
  longTerm: [],
  plotSummary: '',
  userMemory: {
    preferredName: '',
    relationship: '',
    events: [],
    promises: [],
    preferences: [],
    blockedTopics: [],
  },
  options: {
    enabled: true,
    maxItems: 50,
    summarizeEveryTurns: 20,
    allowManualEdit: true,
  },
  updatedAt: null,
};

let sillyTavernProcess = null;
let lmStudioServerProcess = null;
let backendServer = null;
let backendPort = null;
let characterScanJob = null;
let characterScanCache = null;
let characterScanSequence = 0;

function ensureRuntimeDirs() {
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(CONFIG.modelDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(localCharacterDir, { recursive: true });
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return base;
  }

  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && base[key]
      && typeof base[key] === 'object'
      && !Array.isArray(base[key])
    ) {
      next[key] = deepMerge(base[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function readJsonFile(filePath, fallback) {
  ensureRuntimeDirs();
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return deepMerge(fallback, JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    return {
      ...fallback,
      readError: error.message,
    };
  }
}

function writeJsonFile(filePath, data) {
  ensureRuntimeDirs();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function getLocalSettings() {
  return readJsonFile(settingsFile, defaultSettings);
}

function saveLocalSettings(patch = {}) {
  const settings = deepMerge(getLocalSettings(), patch);
  settings.updatedAt = new Date().toISOString();
  writeJsonFile(settingsFile, settings);
  return settings;
}

function getMemoryState() {
  return readJsonFile(memoryFile, defaultMemory);
}

function saveMemoryState(patch = {}) {
  const memory = deepMerge(getMemoryState(), patch);
  memory.updatedAt = new Date().toISOString();
  writeJsonFile(memoryFile, memory);
  return memory;
}

function safeFileName(name) {
  return String(name || 'character')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'character';
}

function getTemplatePath(fileName) {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'templates', fileName),
    process.resourcesPath ? path.join(process.resourcesPath, 'templates', fileName) : null,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function readCharacterTemplate() {
  const templatePath = getTemplatePath('character_card_v2_template.json');
  if (!templatePath) {
    return { path: null, data: null, error: 'Character template was not found.' };
  }

  try {
    return {
      path: templatePath,
      data: JSON.parse(fs.readFileSync(templatePath, 'utf8')),
    };
  } catch (error) {
    return { path: templatePath, data: null, error: error.message };
  }
}

function readWorldInfoTemplate() {
  const templatePath = getTemplatePath('world_info_entries.jsonl');
  if (!templatePath) {
    return { path: null, entries: [], error: 'World info template was not found.' };
  }

  try {
    const entries = fs.readFileSync(templatePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { path: templatePath, entries };
  } catch (error) {
    return { path: templatePath, entries: [], error: error.message };
  }
}

function summarizeCharacterJson(filePath, source) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const data = raw.data || raw;
    const name = data.name || path.basename(filePath, path.extname(filePath));
    return {
      id: `${source}:${filePath}`,
      name,
      subtitle: data.character_version || data.creator_notes || data.scenario || '',
      description: data.description || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      source,
      filePath,
      type: 'json',
    };
  } catch (error) {
    return {
      id: `${source}:${filePath}`,
      name: path.basename(filePath, path.extname(filePath)),
      subtitle: '读取失败',
      description: error.message,
      tags: [],
      source,
      filePath,
      type: 'json',
      error: error.message,
    };
  }
}

function summarizeCharacterFile(filePath, source) {
  if (/\.json$/i.test(filePath)) {
    return summarizeCharacterJson(filePath, source);
  }

  return {
    id: `${source}:${filePath}`,
    name: path.basename(filePath, path.extname(filePath)),
    subtitle: '图片角色卡',
    description: '图片角色卡会由 SillyTavern 读取，PR Desktop 仅展示文件入口。',
    tags: [],
    source,
    filePath,
    type: path.extname(filePath).replace('.', '').toLowerCase() || 'file',
  };
}

function listCharacterFilesInDir(dir, source) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(json|png|webp)$/i.test(entry.name))
    .map((entry) => summarizeCharacterFile(path.join(dir, entry.name), source));
}

function getSillyTavernCharacterDirs() {
  const dataDir = path.join(CONFIG.sillyTavernDir, 'data');
  if (!fs.existsSync(dataDir)) {
    return [];
  }

  return fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dataDir, entry.name, 'characters'))
    .filter((dir) => fs.existsSync(dir));
}

function getCharacterScanStatus() {
  if (characterScanJob) {
    return {
      id: characterScanJob.id,
      status: characterScanJob.status,
      progress: characterScanJob.progress,
      startedAt: characterScanJob.startedAt,
      finishedAt: characterScanJob.finishedAt || null,
      error: characterScanJob.error || null,
      result: characterScanJob.status === 'done' ? characterScanJob.result : null,
    };
  }

  if (characterScanCache) {
    return {
      id: characterScanCache.id,
      status: 'done',
      progress: characterScanCache.progress,
      startedAt: characterScanCache.startedAt,
      finishedAt: characterScanCache.finishedAt,
      error: null,
      result: characterScanCache.result,
    };
  }

  return {
    id: null,
    status: 'idle',
    progress: {
      phase: '等待扫描',
      scannedDirs: 0,
      scannedFiles: 0,
      foundCharacters: 0,
    },
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
  };
}

function startCharacterScan(options = {}) {
  ensureRuntimeDirs();

  if (characterScanJob && characterScanJob.status === 'running') {
    return getCharacterScanStatus();
  }

  if (!options.force && characterScanCache) {
    return getCharacterScanStatus();
  }

  const id = `character-scan-${Date.now()}-${characterScanSequence += 1}`;
  const progress = {
    phase: '准备扫描',
    scannedDirs: 0,
    scannedFiles: 0,
    foundCharacters: 0,
  };
  const worker = new Worker(path.join(__dirname, 'character-scan-worker.js'), {
    workerData: {
      localCharacterDir,
      sillyTavernDir: CONFIG.sillyTavernDir,
      characterTemplatePath: getTemplatePath('character_card_v2_template.json'),
      worldInfoTemplatePath: getTemplatePath('world_info_entries.jsonl'),
    },
  });

  const job = {
    id,
    status: 'running',
    progress,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
    worker,
  };

  job.promise = new Promise((resolve, reject) => {
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        job.progress = message.progress;
      } else if (message.type === 'result') {
        job.status = 'done';
        job.finishedAt = new Date().toISOString();
        job.result = message.payload;
        job.progress = {
          phase: '完成',
          scannedDirs: job.progress.scannedDirs,
          scannedFiles: job.progress.scannedFiles,
          foundCharacters: message.payload?.characters?.length || job.progress.foundCharacters,
        };
        characterScanCache = {
          id: job.id,
          status: job.status,
          progress: job.progress,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          result: job.result,
        };
        resolve(job.result);
      } else if (message.type === 'error') {
        const error = new Error(message.error || 'Character scan worker failed.');
        job.status = 'error';
        job.finishedAt = new Date().toISOString();
        job.error = error.message;
        reject(error);
      }
    });

    worker.on('error', (error) => {
      job.status = 'error';
      job.finishedAt = new Date().toISOString();
      job.error = error.message;
      reject(error);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && job.status === 'running') {
        const error = new Error(`Character scan worker exited with code ${code}.`);
        job.status = 'error';
        job.finishedAt = new Date().toISOString();
        job.error = error.message;
        reject(error);
      }
    });
  }).finally(() => {
    job.worker = null;
  });
  job.promise.catch((error) => {
    appendLog(sillyTavernLog, `Character scan failed: ${error.message}`);
  });

  characterScanJob = job;
  return getCharacterScanStatus();
}

async function getCharactersState(options = {}) {
  const current = getCharacterScanStatus();
  if (current.status === 'done' && current.result && !options.force) {
    return current.result;
  }

  startCharacterScan(options);
  const result = await characterScanJob.promise;
  return {
    ...result,
    scan: getCharacterScanStatus(),
  };
}

function createCharacterFromTemplate(options = {}) {
  const template = readCharacterTemplate();
  if (!template.data) {
    return { ok: false, reason: template.error || 'Character template is not available.' };
  }

  const name = String(options.name || '本地角色模板').trim() || '本地角色模板';
  const next = JSON.parse(JSON.stringify(template.data));
  next.data = next.data || {};
  next.data.name = name;
  next.data.character_version = options.characterVersion || '1.0';

  const filePath = path.join(localCharacterDir, `${safeFileName(name)}-${timestamp()}.json`);
  writeJsonFile(filePath, next);
  characterScanCache = null;
  if (characterScanJob?.status !== 'running') {
    characterScanJob = null;
  }
  return {
    ok: true,
    character: summarizeCharacterJson(filePath, 'PR Local'),
    filePath,
  };
}

function appendLog(file, message) {
  ensureRuntimeDirs();
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(file, `${line}\n`, 'utf8');
}

function timestamp() {
  const pad = (value) => String(value).padStart(2, '0');
  const now = new Date();
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

function getThemeTemplatePath() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'templates', themeFileName),
    process.resourcesPath ? path.join(process.resourcesPath, 'templates', themeFileName) : null,
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getSillyTavernThemeTarget() {
  return path.join(CONFIG.sillyTavernDir, 'data', '_css', 'user.css');
}

function checkSillyTavernTheme() {
  const target = getSillyTavernThemeTarget();
  if (!fs.existsSync(target)) {
    return { installed: false, target };
  }

  try {
    const css = fs.readFileSync(target, 'utf8');
    return { installed: themeMarkers.some((marker) => css.includes(marker)), target };
  } catch (error) {
    return { installed: false, target, error: error.message };
  }
}

function ensureSillyTavernTheme() {
  const source = getThemeTemplatePath();
  const target = getSillyTavernThemeTarget();

  if (!source) {
    const reason = `SillyTavern theme template was not found: ${themeFileName}`;
    appendLog(sillyTavernLog, reason);
    return { ok: false, installed: false, target, reason };
  }

  if (!fs.existsSync(CONFIG.sillyTavernDir)) {
    const reason = `SillyTavern directory not found: ${CONFIG.sillyTavernDir}`;
    appendLog(sillyTavernLog, reason);
    return { ok: false, installed: false, target, reason };
  }

  try {
    const cssDir = path.dirname(target);
    const next = fs.readFileSync(source, 'utf8');
    let backup = null;

    fs.mkdirSync(cssDir, { recursive: true });

    if (fs.existsSync(target)) {
      const current = fs.readFileSync(target, 'utf8');
      if (current === next) {
        return { ok: true, installed: true, changed: false, target };
      }

      backup = path.join(cssDir, `user.css.pr-backup-${timestamp()}`);
      fs.copyFileSync(target, backup);
    }

    fs.writeFileSync(target, next, 'utf8');
    appendLog(sillyTavernLog, `Installed SillyTavern WeChat-style theme: ${target}`);
    return { ok: true, installed: true, changed: true, target, backup };
  } catch (error) {
    appendLog(sillyTavernLog, `Failed to install SillyTavern theme: ${error.message}`);
    return { ok: false, installed: false, target, error: error.message };
  }
}

function pipeProcessLogs(child, logFile, name) {
  child.stdout?.on('data', (chunk) => appendLog(logFile, `${name}: ${chunk.toString().trimEnd()}`));
  child.stderr?.on('data', (chunk) => appendLog(logFile, `${name} error: ${chunk.toString().trimEnd()}`));
  child.on('error', (error) => appendLog(logFile, `${name} spawn error: ${error.message}`));
  child.on('exit', (code, signal) => appendLog(logFile, `${name} exited code=${code} signal=${signal || ''}`));
}

function requestText(url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, body });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });

    req.on('error', reject);
  });
}

function requestJson(url, options = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const req = client.request(
      {
        method: options.method || (body ? 'POST' : 'GET'),
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers: {
          ...(body ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          let data = null;
          if (responseBody.trim()) {
            try {
              data = JSON.parse(responseBody);
            } catch (error) {
              reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
              return;
            }
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: responseBody,
            data,
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
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

function getLmStudioRestBaseUrl() {
  if (CONFIG.lmStudioRestBaseUrl) {
    return CONFIG.lmStudioRestBaseUrl.replace(/\/$/, '');
  }

  return CONFIG.lmStudioBaseUrl
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '')
    .concat('/api/v1');
}

function isLmStudioChatModel(model) {
  return model?.type === 'llm' && typeof model.key === 'string' && model.key.trim();
}

function hasLoadedInstances(model) {
  return Array.isArray(model?.loaded_instances) && model.loaded_instances.length > 0;
}

function toLmStudioModelSummary(model) {
  return {
    id: model.key,
    key: model.key,
    label: model.display_name || model.key,
    type: model.type || null,
    publisher: model.publisher || null,
    architecture: model.architecture || null,
    params: model.params_string || null,
    quantization: model.quantization?.name || null,
    sizeBytes: model.size_bytes || null,
    format: model.format || null,
    maxContextLength: model.max_context_length || null,
    selectedVariant: model.selected_variant || null,
    variants: Array.isArray(model.variants) ? model.variants : [],
    loaded: hasLoadedInstances(model),
    loadedInstances: Array.isArray(model.loaded_instances) ? model.loaded_instances : [],
    capabilities: model.capabilities || {},
  };
}

function choosePreferredLmStudioModel(models = []) {
  const chatModels = models.filter(isLmStudioChatModel);
  if (!chatModels.length) {
    return null;
  }

  const preferred = CONFIG.preferredLmStudioModel.trim();
  if (preferred) {
    const matched = chatModels.find((model) => (
      model.key === preferred
      || model.selected_variant === preferred
      || (Array.isArray(model.variants) && model.variants.includes(preferred))
    ));
    if (matched) {
      return matched;
    }
  }

  const scoreModel = (model) => {
    const haystack = [
      model.key,
      model.display_name,
      model.publisher,
      model.architecture,
      model.selected_variant,
      ...(model.variants || []),
    ].join(' ').toLowerCase();
    let score = 0;

    if (hasLoadedInstances(model)) score += 100;
    if (haystack.includes('qwen')) score += 50;
    if (haystack.includes('deepseek')) score += 35;
    if (haystack.includes('yi-') || haystack.includes('01-ai')) score += 20;
    if (haystack.includes('gemma')) score += 5;
    if (model.capabilities?.vision) score -= 4;

    return score;
  };

  return [...chatModels].sort((left, right) => scoreModel(right) - scoreModel(left))[0];
}

async function checkSillyTavern() {
  try {
    const response = await requestText(`${CONFIG.sillyTavernUrl}/`, 2500);
    return {
      ok: response.statusCode >= 200 && response.statusCode < 500,
      statusCode: response.statusCode,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function checkLmStudio() {
  let openAiStatusCode = 0;
  let nativeStatusCode = 0;
  let openAiError = null;
  let nativeError = null;
  let openAiModels = [];
  let nativeModels = [];

  try {
    const response = await requestText(`${CONFIG.lmStudioBaseUrl}/models`, 2500);
    openAiStatusCode = response.statusCode;
    const parsed = JSON.parse(response.body);
    openAiModels = Array.isArray(parsed.data) ? parsed.data.map((item) => item.id).filter(Boolean) : [];
  } catch (error) {
    openAiError = error.message;
  }

  try {
    const response = await requestJson(`${getLmStudioRestBaseUrl()}/models`, {}, 3500);
    nativeStatusCode = response.statusCode;
    nativeModels = Array.isArray(response.data?.models) ? response.data.models : [];
  } catch (error) {
    nativeError = error.message;
  }

  const availableModels = nativeModels.map(toLmStudioModelSummary);
  const availableChatModels = availableModels.filter((model) => model.type === 'llm');
  const loadedChatModels = availableChatModels.filter((model) => model.loaded);
  const usableOpenAiModels = openAiModels.filter((model) => !/embed|embedding|rerank/i.test(model));
  const proxyModels = loadedChatModels.length
    ? loadedChatModels.map((model) => model.id)
    : nativeModels.length
      ? []
      : usableOpenAiModels;
  const recommendedModel = choosePreferredLmStudioModel(nativeModels);
  const recommendedLoadModel = recommendedModel ? toLmStudioModelSummary(recommendedModel) : null;
  const ok = (
    (openAiStatusCode >= 200 && openAiStatusCode < 300)
    || (nativeStatusCode >= 200 && nativeStatusCode < 300)
  );

  return {
    ok,
    statusCode: openAiStatusCode || nativeStatusCode,
    openAiStatusCode,
    nativeStatusCode,
    restBaseUrl: getLmStudioRestBaseUrl(),
    models: proxyModels,
    openAiModels,
    availableModels,
    availableChatModels,
    loadedChatModels,
    recommendedLoadModel,
    preferredModelLoaded: proxyModels.includes(CONFIG.preferredModelId),
    activeModel: loadedChatModels[0]?.id || usableOpenAiModels[0] || recommendedLoadModel?.id || null,
    error: openAiError || nativeError || null,
    openAiError,
    nativeError,
  };
}

async function loadLmStudioModel(options = {}) {
  const before = await checkLmStudio();
  const requestedModel = String(
    options.modelId
      || options.model
      || options.id
      || before.recommendedLoadModel?.id
      || '',
  ).trim();

  if (!requestedModel) {
    return {
      ok: false,
      reason: 'No local chat model was found in LM Studio.',
      before,
    };
  }

  const knownModel = before.availableChatModels.find((model) => (
    model.id === requestedModel
    || model.selectedVariant === requestedModel
    || model.variants?.includes(requestedModel)
  ));
  if (knownModel?.loaded) {
    return {
      ok: true,
      statusCode: 200,
      requestedModel,
      loadedModel: knownModel.id,
      result: { status: 'already_loaded', model: knownModel.id },
      before,
      after: before,
    };
  }

  const modelCandidates = [
    options.variant,
    requestedModel,
    knownModel?.key,
    knownModel?.selectedVariant,
    ...(knownModel?.variants || []),
  ].filter(Boolean);
  const uniqueModelCandidates = [...new Set(modelCandidates)];

  const buildLoadBody = (modelToLoad) => {
    const loadBody = { model: modelToLoad };
    const contextLength = Number(options.contextLength || options.context_length || 0);
    if (contextLength > 0) {
      loadBody.context_length = contextLength;
    }
    if (options.flash_attention !== undefined) {
      loadBody.flash_attention = Boolean(options.flash_attention);
    }
    if (options.ttl !== undefined) {
      loadBody.ttl = options.ttl;
    }
    return loadBody;
  };

  let response = null;
  let modelToLoad = uniqueModelCandidates[0];
  const attemptedModels = [];
  for (const candidate of uniqueModelCandidates) {
    modelToLoad = candidate;
    attemptedModels.push(candidate);
    response = await requestJson(
      `${getLmStudioRestBaseUrl()}/models/load`,
      { method: 'POST', body: buildLoadBody(candidate) },
      Number(options.timeoutMs || 120000),
    );
    if (response.statusCode >= 200 && response.statusCode < 300) {
      break;
    }
  }
  const after = await checkLmStudio();
  const ok = response.statusCode >= 200 && response.statusCode < 300;

  return {
    ok,
    statusCode: response.statusCode,
    requestedModel,
    loadedModel: modelToLoad,
    attemptedModels,
    reason: ok ? null : (response.data?.error || response.data?.message || response.body || 'LM Studio model load failed.'),
    result: response.data,
    before,
    after,
  };
}

async function ensureLmStudioModelLoaded() {
  const before = await checkLmStudio();
  if (before.loadedChatModels?.length || !before.availableChatModels?.length) {
    return before;
  }

  const result = await loadLmStudioModel({ modelId: before.recommendedLoadModel?.id });
  return result.after || checkLmStudio();
}

function findLmStudioExe() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'LM Studio', 'LM Studio.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'LMStudio', 'LM Studio.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function findLmsCli() {
  const candidates = [
    path.join(os.homedir(), '.lmstudio', 'bin', 'lms.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'LM Studio', 'resources', 'lms.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function findWindowsCommand(candidates) {
  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate)) || null;
}

function findNpmCommand() {
  if (process.platform !== 'win32') {
    return 'npm';
  }

  return findWindowsCommand([
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'npm.cmd'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'npm.cmd'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'nodejs', 'npm.cmd'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npm.cmd'),
  ]);
}

function findNodeCommand() {
  if (process.platform !== 'win32') {
    return 'node';
  }

  return findWindowsCommand([
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'nodejs', 'node.exe'),
  ]);
}

function startLmStudioApp() {
  const exe = findLmStudioExe();
  if (!exe) {
    appendLog(lmStudioLog, 'LM Studio executable was not found.');
    return { started: false, reason: 'LM Studio executable was not found.' };
  }

  childProcess.spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref();

  appendLog(lmStudioLog, `Started LM Studio app: ${exe}`);
  return { started: true, path: exe };
}

function startLmStudioServer() {
  const lms = findLmsCli();
  if (!lms) {
    appendLog(lmStudioLog, 'lms.exe was not found; opening LM Studio app instead.');
    return startLmStudioApp();
  }

  if (lmStudioServerProcess && !lmStudioServerProcess.killed) {
    return { started: false, reason: 'LM Studio server process is already managed by PR Desktop.' };
  }

  lmStudioServerProcess = childProcess.spawn(lms, ['server', 'start', '--port', '1234'], {
    cwd: path.dirname(lms),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipeProcessLogs(lmStudioServerProcess, lmStudioLog, 'lms server');
  lmStudioServerProcess.on('exit', () => {
    lmStudioServerProcess = null;
  });
  appendLog(lmStudioLog, `Started lms server: ${lms}`);

  return { started: true, path: lms };
}

function startSillyTavern() {
  ensureRuntimeDirs();

  if (sillyTavernProcess && !sillyTavernProcess.killed) {
    return { started: false, reason: 'SillyTavern process is already managed by PR Desktop.' };
  }

  if (!fs.existsSync(path.join(CONFIG.sillyTavernDir, 'package.json'))) {
    const reason = `SillyTavern directory not found: ${CONFIG.sillyTavernDir}`;
    appendLog(sillyTavernLog, reason);
    return { started: false, reason };
  }

  const nodeCommand = findNodeCommand();
  const npmCommand = findNpmCommand();
  let command = null;
  let args = [];

  if (nodeCommand && fs.existsSync(path.join(CONFIG.sillyTavernDir, 'server.js'))) {
    command = nodeCommand;
    args = ['server.js', '--browserLaunchEnabled=false'];
  } else if (npmCommand) {
    command = npmCommand;
    args = ['start', '--', '--browserLaunchEnabled=false'];
  }

  if (!command) {
    const reason = 'Node.js/npm was not found. Install Node.js LTS or start SillyTavern manually.';
    appendLog(sillyTavernLog, reason);
    return { started: false, reason };
  }

  sillyTavernProcess = childProcess.spawn(command, args, {
    cwd: CONFIG.sillyTavernDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pipeProcessLogs(sillyTavernProcess, sillyTavernLog, 'sillytavern');
  sillyTavernProcess.on('exit', () => {
    sillyTavernProcess = null;
  });
  appendLog(sillyTavernLog, `Started SillyTavern from ${CONFIG.sillyTavernDir} with ${command} ${args.join(' ')}`);
  return { started: true, path: CONFIG.sillyTavernDir };
}

async function getStatus() {
  const [sillyTavern, lmStudio] = await Promise.all([checkSillyTavern(), checkLmStudio()]);
  return {
    config: CONFIG,
    backendPort,
    backend: {
      port: backendPort,
      preferredPort: CONFIG.backendStartPort,
      fallbackPortUsed: Boolean(backendPort && backendPort !== CONFIG.backendStartPort),
      baseUrl: backendPort ? `http://127.0.0.1:${backendPort}` : null,
    },
    proxy: {
      baseUrl: backendPort ? `http://127.0.0.1:${backendPort}/v1` : null,
      forceChinese: process.env.PR_FORCE_CHINESE !== 'false',
      providers: getProviderStatus(),
      smart: getSmartModelStatus(),
    },
    sillyTavern,
    sillyTavernTheme: checkSillyTavernTheme(),
    lmStudio,
    paths: {
      appDataDir,
      logDir,
      sillyTavernLog,
      lmStudioLog,
    },
    managedProcesses: {
      sillyTavern: Boolean(sillyTavernProcess && !sillyTavernProcess.killed),
      lmStudioServer: Boolean(lmStudioServerProcess && !lmStudioServerProcess.killed),
    },
  };
}

async function startServices() {
  const theme = ensureSillyTavernTheme();
  const before = await getStatus();
  const actions = [];

  if (!before.lmStudio.ok) {
    actions.push({ service: 'lmStudio', ...startLmStudioServer() });
  }

  if (!before.sillyTavern.ok) {
    actions.push({ service: 'sillyTavern', ...startSillyTavern() });
  }

  return {
    actions,
    theme,
    status: await getStatus(),
  };
}

async function waitForSillyTavern(options = {}) {
  const timeoutMs = options.timeoutMs || 90000;
  const intervalMs = options.intervalMs || 1200;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getStatus();
    options.onTick?.(status);
    if (status.sillyTavern.ok) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return getStatus();
}

function sendJson(res, statusCode, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(json);
}

function listenOnAvailablePort(server, startPort, attempts = 20) {
  return new Promise((resolve, reject) => {
    let port = startPort;

    const tryListen = () => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && port < startPort + attempts) {
          port += 1;
          tryListen();
          return;
        }
        reject(error);
      });

      server.listen(port, '127.0.0.1', () => resolve(port));
    };

    tryListen();
  });
}

async function openPathResult(handlers, target) {
  if (!handlers.openPath) {
    return { ok: false, reason: 'Open path handler is not available.', path: target };
  }

  const error = await handlers.openPath(target);
  if (error) {
    return { ok: false, reason: error, path: target };
  }

  return { ok: true, path: target };
}

async function createBackendServer(handlers = {}) {
  if (backendServer) {
    return { server: backendServer, port: backendPort };
  }

  backendServer = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 200, { ok: true });
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');

    try {
      if (url.pathname.startsWith('/v1/')) {
        let lmStudio = await checkLmStudio();
        if (req.method === 'POST' && url.pathname === '/v1/chat/completions' && !lmStudio.models?.length) {
          lmStudio = await ensureLmStudioModelLoaded();
        }
        const localModels = Array.isArray(lmStudio.models) ? lmStudio.models : [];
        if (canHandleModelProxy(req, res, url, localModels)) {
          return;
        }
      } else if (canHandleModelProxy(req, res, url, [])) {
        return;
      }

      if (url.pathname === '/api/status') {
        sendJson(res, 200, await getStatus());
        return;
      }

      if (url.pathname === '/api/start') {
        sendJson(res, 200, await startServices());
        return;
      }

      if (url.pathname === '/api/settings') {
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, { ok: true, settings: saveLocalSettings(body.settings || body) });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          settings: getLocalSettings(),
          path: settingsFile,
        });
        return;
      }

      if (url.pathname === '/api/memory') {
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, { ok: true, memory: saveMemoryState(body.memory || body) });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          memory: getMemoryState(),
          path: memoryFile,
        });
        return;
      }

      if (url.pathname === '/api/characters') {
        sendJson(res, 200, await getCharactersState({ force: url.searchParams.get('force') === 'true' }));
        return;
      }

      if (url.pathname === '/api/characters/scan') {
        const force = url.searchParams.get('force') === 'true' || req.method === 'POST';
        sendJson(res, 200, { ok: true, scan: startCharacterScan({ force }) });
        return;
      }

      if (url.pathname === '/api/characters/scan-status') {
        sendJson(res, 200, { ok: true, scan: getCharacterScanStatus() });
        return;
      }

      if (url.pathname === '/api/characters/create-template') {
        const body = await readJsonBody(req);
        const result = createCharacterFromTemplate(body);
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (url.pathname === '/api/models/local') {
        const lmStudio = await checkLmStudio();
        sendJson(res, 200, {
          ok: lmStudio.ok,
          lmStudio,
          models: lmStudio.availableModels,
          chatModels: lmStudio.availableChatModels,
          loadedChatModels: lmStudio.loadedChatModels,
          recommendedLoadModel: lmStudio.recommendedLoadModel,
        });
        return;
      }

      if (url.pathname === '/api/models/load') {
        const body = await readJsonBody(req);
        const result = await loadLmStudioModel(body);
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }

      if (url.pathname === '/api/open/model-folder') {
        const result = await openPathResult(handlers, CONFIG.modelDir);
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (url.pathname === '/api/open/sillytavern-folder') {
        const result = await openPathResult(handlers, CONFIG.sillyTavernDir);
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (url.pathname === '/api/open/characters-folder') {
        const result = await openPathResult(handlers, localCharacterDir);
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (url.pathname === '/api/open/settings-folder') {
        const result = await openPathResult(handlers, configDir);
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (url.pathname === '/api/open/sillytavern') {
        const result = await handlers.openSillyTavernApp?.(CONFIG.sillyTavernUrl);
        if (!result) {
          handlers.openExternal?.(CONFIG.sillyTavernUrl);
        }
        sendJson(res, 200, result || { ok: true, url: CONFIG.sillyTavernUrl, mode: 'external' });
        return;
      }

      if (url.pathname === '/api/update/check') {
        const result = await handlers.checkForUpdates?.();
        sendJson(res, 200, result || { ok: false, reason: 'Update handler is not available.' });
        return;
      }

      if (url.pathname === '/api/update/state') {
        const state = handlers.getUpdateState?.();
        sendJson(res, 200, { ok: true, state: state || null });
        return;
      }

      if (url.pathname === '/api/update/install') {
        const result = handlers.installDownloadedUpdate?.();
        sendJson(res, 200, result || { ok: false, reason: 'Install handler is not available.' });
        return;
      }

      if (url.pathname === '/api/update/releases') {
        const result = await handlers.openReleases?.();
        sendJson(res, result?.ok === false ? 500 : 200, result || { ok: true });
        return;
      }

      sendJson(res, 404, { ok: false, reason: 'Not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  backendServer.on('close', () => {
    backendServer = null;
    backendPort = null;
  });

  try {
    backendPort = await listenOnAvailablePort(backendServer, CONFIG.backendStartPort);
  } catch (error) {
    backendServer = null;
    backendPort = null;
    throw error;
  }
  return { server: backendServer, port: backendPort };
}

function stopSpawnedServices() {
  for (const child of [sillyTavernProcess, lmStudioServerProcess]) {
    if (child && !child.killed) {
      child.kill();
    }
  }
}

module.exports = {
  CONFIG,
  checkLmStudio,
  ensureSillyTavernTheme,
  createBackendServer,
  getStatus,
  loadLmStudioModel,
  startServices,
  stopSpawnedServices,
  waitForSillyTavern,
};
