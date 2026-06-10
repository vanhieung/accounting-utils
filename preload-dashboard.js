const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectZips: () => ipcRenderer.invoke('select-zips'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  extractZips: (data) => ipcRenderer.invoke('extract-zips', data),
  openBatchDownload: () => ipcRenderer.send('open-batch-download')
});
