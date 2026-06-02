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

let mainWindow = null;
let updateState = {
  status: 'idle',
  message: 'Updater is idle.',
};

function sendUpdateState() {
  mainWindow?.webContents.send('update-state', updateState);
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    updateState = { status: 'checking', message: 'Checking GitHub release updates...' };
    sendUpdateState();
  });

  autoUpdater.on('update-available', (info) => {
    updateState = { status: 'available', message: `Update available: ${info.version}` };
    sendUpdateState();
  });

  autoUpdater.on('update-not-available', (info) => {
    updateState = { status: 'current', message: `Already current: ${info.version}` };
    sendUpdateState();
  });

  autoUpdater.on('download-progress', (progress) => {
    updateState = {
      status: 'downloading',
      message: `Downloading update: ${Math.round(progress.percent)}%`,
    };
    sendUpdateState();
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateState = { status: 'ready', message: `Update ${info.version} downloaded. It installs after exit.` };
    sendUpdateState();
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'PR Desktop update ready',
      message: `PR Desktop ${info.version} is ready.`,
      detail: 'Close the app to install it, or keep working and install later.',
      buttons: ['OK'],
    });
  });

  autoUpdater.on('error', (error) => {
    updateState = { status: 'error', message: error.message };
    sendUpdateState();
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    return {
      ok: false,
      packaged: false,
      reason: 'Auto update runs after building and installing PR Desktop from a GitHub Release.',
    };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, packaged: true, updateInfo: result?.updateInfo || null };
  } catch (error) {
    return { ok: false, packaged: true, error: error.message };
  }
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
    openExternal: (url) => shell.openExternal(url),
    openPath: (target) => shell.openPath(target),
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
