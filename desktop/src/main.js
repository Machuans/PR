const path = require('node:path');
const { app, BrowserWindow, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const {
  CONFIG,
  createBackendServer,
  startServices,
  stopSpawnedServices,
  waitForSillyTavern,
} = require('./service-manager');

const RELEASES_URL = 'https://github.com/Machuans/PR/releases';
let mainWindow = null;
let sillyTavernWindow = null;
let updateState = {
  status: 'idle',
  message: '等待检查 GitHub Release 更新',
  currentVersion: app.getVersion(),
  canInstall: false,
};
let updateCheckPromise = null;
let downloadedUpdate = false;
let bootPromise = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
});

function sendUpdateState() {
  mainWindow?.webContents.send('update-state', updateState);
}

function setUpdateState(next) {
  updateState = {
    ...updateState,
    ...next,
    currentVersion: app.getVersion(),
    checkedAt: new Date().toISOString(),
  };
  sendUpdateState();
  return updateState;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking',
      message: '正在检查 GitHub Release 更新源',
      canInstall: false,
    });
  });

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      message: `发现新版本 ${info.version}，开始下载`,
      version: info.version,
      canInstall: false,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    setUpdateState({
      status: 'current',
      message: `已是最新 Release 版本 ${info.version || app.getVersion()}`,
      version: info.version || app.getVersion(),
      canInstall: false,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      status: 'downloading',
      message: `正在下载更新：${Math.round(progress.percent)}%`,
      percent: Math.round(progress.percent),
      canInstall: false,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedUpdate = true;
    setUpdateState({
      status: 'ready',
      message: `新版本 ${info.version} 已下载，可立即重启安装`,
      version: info.version,
      percent: 100,
      canInstall: true,
    });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'PR Desktop 更新已就绪',
      message: `PR Desktop ${info.version} 已下载。`,
      detail: '可以立即重启安装，也可以稍后退出应用时自动安装。',
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        installDownloadedUpdate();
      }
    }).catch(() => {});
  });

  autoUpdater.on('error', (error) => {
    setUpdateState({
      status: 'error',
      message: `更新失败：${error.message}`,
      canInstall: downloadedUpdate,
    });
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateState({
      status: 'unsupported',
      message: '开发模式不能使用 Release 自动更新，请用本地更新脚本',
      canInstall: false,
    });
    return {
      ok: false,
      packaged: false,
      state: updateState,
      reason: 'Auto update runs after building and installing PR Desktop from a GitHub Release.',
    };
  }

  if (updateCheckPromise) {
    return { ok: true, packaged: true, pending: true, state: updateState };
  }

  try {
    updateCheckPromise = autoUpdater.checkForUpdates();
    const result = await updateCheckPromise;
    return { ok: true, packaged: true, state: updateState, updateInfo: result?.updateInfo || null };
  } catch (error) {
    setUpdateState({
      status: 'error',
      message: `更新失败：${error.message}`,
      canInstall: downloadedUpdate,
    });
    return { ok: false, packaged: true, state: updateState, error: error.message };
  } finally {
    updateCheckPromise = null;
  }
}

function getUpdateState() {
  return updateState;
}

function installDownloadedUpdate() {
  if (!downloadedUpdate && updateState.status !== 'ready') {
    return { ok: false, reason: 'No downloaded update is ready.', state: updateState };
  }

  setUpdateState({
    status: 'installing',
    message: '正在重启并安装更新',
    canInstall: false,
  });
  setTimeout(() => {
    stopSpawnedServices();
    autoUpdater.quitAndInstall(false, true);
  }, 250);
  return { ok: true, state: updateState };
}

function isLocalSillyTavernUrl(url) {
  try {
    const target = new URL(url);
    const configured = new URL(CONFIG.sillyTavernUrl);
    return target.origin === configured.origin;
  } catch {
    return false;
  }
}

function configureHostedSillyTavern(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalSillyTavernUrl(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (isLocalSillyTavernUrl(url)) {
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });

  webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowedPermissions = new Set([
      'clipboard-read',
      'media',
      'notifications',
      'fullscreen',
      'pointerLock',
      'display-capture',
    ]);
    callback(allowedPermissions.has(permission));
  });
}

async function openSillyTavernInApp() {
  if (sillyTavernWindow && !sillyTavernWindow.isDestroyed()) {
    if (sillyTavernWindow.isMinimized()) {
      sillyTavernWindow.restore();
    }
    sillyTavernWindow.focus();
    return { ok: true, url: CONFIG.sillyTavernUrl, reused: true };
  }

  sillyTavernWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: 'PR SillyTavern',
    backgroundColor: '#0d1017',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  sillyTavernWindow.removeMenu();
  configureHostedSillyTavern(sillyTavernWindow.webContents);
  sillyTavernWindow.once('ready-to-show', () => sillyTavernWindow?.show());
  sillyTavernWindow.on('closed', () => {
    sillyTavernWindow = null;
  });

  await sillyTavernWindow.loadURL(CONFIG.sillyTavernUrl);
  return { ok: true, url: CONFIG.sillyTavernUrl, reused: false };
}

async function createMainWindow(backendPort) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'PR Desktop',
    backgroundColor: '#0d0f0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());

  await mainWindow.loadFile(path.join(__dirname, 'loading.html'), {
    query: { port: String(backendPort) },
  });

  return mainWindow;
}

async function boot() {
  if (!singleInstanceLock) {
    return null;
  }

  if (bootPromise) {
    return bootPromise;
  }

  bootPromise = bootInner().finally(() => {
    bootPromise = null;
  });
  return bootPromise;
}

async function bootInner() {
  configureAutoUpdater();

  const backend = await createBackendServer({
    checkForUpdates,
    getUpdateState,
    installDownloadedUpdate,
    openSillyTavernApp: openSillyTavernInApp,
    openExternal: (url) => shell.openExternal(url),
    openPath: (target) => shell.openPath(target),
    openReleases: () => shell.openExternal(RELEASES_URL),
  });

  await createMainWindow(backend.port);
  await startServices();

  const status = await waitForSillyTavern({
    timeoutMs: 90000,
    onTick: (snapshot) => {
      mainWindow?.webContents.send('service-status', snapshot);
    },
  });

  mainWindow?.webContents.send('service-status', status);

  if (status.sillyTavern.ok && process.env.PR_AUTO_OPEN_SILLYTAVERN === 'true') {
    await openSillyTavernInApp();
  }

  if (app.isPackaged) {
    setTimeout(() => {
      checkForUpdates();
    }, 1500);
  }

  return mainWindow;
}

app.whenReady().then(boot);

app.on('window-all-closed', () => {
  stopSpawnedServices();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    boot();
  }
});
