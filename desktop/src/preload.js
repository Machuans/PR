const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prDesktop', {
  onServiceStatus(callback) {
    ipcRenderer.on('service-status', (_event, status) => callback(status));
  },
  onUpdateState(callback) {
    ipcRenderer.on('update-state', (_event, status) => callback(status));
  },
});
