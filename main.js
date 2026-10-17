const { app, BrowserWindow, shell, session, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { registerPocosIpc } = require('./electron/pocos');

const isDev = !app.isPackaged;

// Testes (Playwright) usam uma pasta de dados própria para não tocar nos rascunhos reais
if (process.env.BDOE_USER_DATA) app.setPath('userData', process.env.BDOE_USER_DATA);
const ALLOWED_PERMISSIONS = new Set(['media', 'geolocation']); // câmera e GPS; o resto é negado

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'BDO-e & Inspeção Técnica',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html')); // mesma página do PWA (raiz do projeto)
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // A janela nunca sai do app (ex.: arquivo solto sobre a janela)
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  // Links externos (mapas, etc.) abrem no navegador padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
      if (level === 'error' || level === 'warning') {
        console.log(`[renderer:${level}] ${message} (${path.basename(sourceId || '')}:${lineNumber})`);
      }
    });
  }

  // Antes de fechar, pede à interface para gravar o rascunho pendente (máx. 3 s)
  let readyToClose = false;
  mainWindow.on('close', (e) => {
    if (readyToClose) return;
    e.preventDefault();
    const win = mainWindow;
    const finish = () => { readyToClose = true; if (!win.isDestroyed()) win.close(); };
    ipcMain.once('app:ready-to-close', finish);
    setTimeout(finish, 3000);
    win.webContents.send('app:before-close');
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Base de poços/locações: listar, status, importar (CSV/KML) e limpar — ver electron/pocos.js
registerPocosIpc(ipcMain, app);

// Gera o PDF a partir de um HTML autocontido montado pela interface (ui/report-pdf.js)
ipcMain.handle('pdf:save', async (event, { html, fileName }) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Salvar relatório em PDF',
    defaultPath: path.join(app.getPath('documents'), fileName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { saved: false };

  const tmp = path.join(os.tmpdir(), `bdoe-${Date.now()}.html`);
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await fs.writeFile(tmp, html, 'utf8');
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
    await fs.writeFile(filePath, pdf);
  } finally {
    win.destroy();
    fs.unlink(tmp).catch(() => {});
  }
  shell.openPath(filePath);
  return { saved: true, filePath };
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const audio = (details.mediaTypes || []).includes('audio');
    callback(ALLOWED_PERMISSIONS.has(permission) && !audio);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
