const { contextBridge, ipcRenderer } = require('electron');

// Credenciais do Supabase vindas das variáveis de ambiente (main.js → additionalArguments)
function supabaseEnv() {
  const arg = process.argv.find((a) => a.startsWith('--bdoe-supabase='));
  try { return arg ? JSON.parse(arg.slice('--bdoe-supabase='.length)) : null; } catch { return null; }
}

// Ponte mínima e segura entre o Electron e a interface.
contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  supabaseEnv: supabaseEnv(),
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome
  },
  /** Abre "Salvar como" e grava o HTML do relatório em PDF. → { saved, filePath } */
  savePdf: (html, fileName) => ipcRenderer.invoke('pdf:save', { html, fileName }),
  renderPdf: (html) => ipcRenderer.invoke('pdf:render', { html }),
  /** "Salvar como" do relatório em Word (bytes do .docx gerado na interface). → { saved, filePath } */
  saveDocx: (bytes, fileName) => ipcRenderer.invoke('docx:save', { bytes, fileName }),
  /** Base de poços: { origem, fonte, importadoEm, total, pocos: [[nome, lat, lng], ...] } */
  getPocos: () => ipcRenderer.invoke('pocos:list'),
  pocosStatus: () => ipcRenderer.invoke('pocos:status'),
  /** Envia o conteúdo do .csv/.kml para o parser do processo principal. */
  importPocos: (name, bytes) => ipcRenderer.invoke('pocos:import', { name, bytes }),
  clearPocos: () => ipcRenderer.invoke('pocos:clear'),
  /** A janela vai fechar: grave o que estiver pendente e chame readyToClose(). */
  onBeforeClose: (cb) => ipcRenderer.on('app:before-close', () => cb()),
  readyToClose: () => ipcRenderer.send('app:ready-to-close')
});
