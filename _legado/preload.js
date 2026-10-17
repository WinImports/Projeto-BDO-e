const { contextBridge } = require('electron');

// Ponte mínima entre o processo principal e a página.
// Adicione aqui APIs via ipcRenderer quando o index.html precisar de recursos nativos.
contextBridge.exposeInMainWorld('bdoElectron', {
  isElectron: true,
  platform: process.platform
});
