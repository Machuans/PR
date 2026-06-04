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
let updateState = {
  status: 'idle',
  message: '等待检查更新',
  currentVersion: app.getVersion(),
  canInstall: false,
};
let updateCheckPromise = null;
let downloadedUpdate = false;

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
      message: '正在检查 GitHub Release 更新',
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
      message: `已是最新版本 ${info.version || app.getVersion()}`,
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
  configureAutoUpdater();

  const backend = await createBackendServer({
    checkForUpdates,
    getUpdateState,
    installDownloadedUpdate,
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

  if (status.sillyTavern.ok) {
    await mainWindow.loadURL(CONFIG.sillyTavernUrl);
  } else {
    mainWindow?.webContents.send('service-status', status);
  }

  if (app.isPackaged) {
    setTimeout(() => {
      checkForUpdates();
    }, 5000);
  }
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
