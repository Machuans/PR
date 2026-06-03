const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
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

let sillyTavernProcess = null;
let lmStudioServerProcess = null;
let backendServer = null;
let backendPort = null;

function ensureRuntimeDirs() {
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(CONFIG.modelDir, { recursive: true });
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
  try {
    const response = await requestText(`${CONFIG.lmStudioBaseUrl}/models`, 2500);
    const parsed = JSON.parse(response.body);
    const models = Array.isArray(parsed.data) ? parsed.data.map((item) => item.id) : [];
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      statusCode: response.statusCode,
      models,
      preferredModelLoaded: models.includes(CONFIG.preferredModelId),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      models: [],
      preferredModelLoaded: false,
    };
  }
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
    args = ['server.js'];
  } else if (npmCommand) {
    command = npmCommand;
    args = ['start'];
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
  appendLog(sillyTavernLog, `Started SillyTavern from ${CONFIG.sillyTavernDir} with ${command} ${args.join(' ')}`);
  return { started: true, path: CONFIG.sillyTavernDir };
}

async function getStatus() {
  const [sillyTavern, lmStudio] = await Promise.all([checkSillyTavern(), checkLmStudio()]);
  return {
    config: CONFIG,
    backendPort,
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
        const lmStudio = await checkLmStudio();
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

      if (url.pathname === '/api/open/model-folder') {
        handlers.openPath?.(CONFIG.modelDir);
        sendJson(res, 200, { ok: true, path: CONFIG.modelDir });
        return;
      }

      if (url.pathname === '/api/open/sillytavern-folder') {
        handlers.openPath?.(CONFIG.sillyTavernDir);
        sendJson(res, 200, { ok: true, path: CONFIG.sillyTavernDir });
        return;
      }

      if (url.pathname === '/api/open/sillytavern') {
        handlers.openExternal?.(CONFIG.sillyTavernUrl);
        sendJson(res, 200, { ok: true, url: CONFIG.sillyTavernUrl });
        return;
      }

      if (url.pathname === '/api/update/check') {
        const result = await handlers.checkForUpdates?.();
        sendJson(res, 200, result || { ok: false, reason: 'Update handler is not available.' });
        return;
      }

      sendJson(res, 404, { ok: false, reason: 'Not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  backendPort = await listenOnAvailablePort(backendServer, CONFIG.backendStartPort);
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
  ensureSillyTavernTheme,
  createBackendServer,
  getStatus,
  startServices,
  stopSpawnedServices,
  waitForSillyTavern,
};
