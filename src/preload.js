const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taxAssist', {
  recognizeInvoice: (imageDataUrl) => ipcRenderer.invoke('invoice:recognize', imageDataUrl),
  issueInvoice: (invoice) => ipcRenderer.invoke('invoice:issue', invoice)
});
