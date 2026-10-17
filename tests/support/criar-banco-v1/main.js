// (apoio aos testes) Cria um banco IndexedDB no formato ANTIGO (v1: outbox + drafts) na pasta indicada.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
app.setPath('userData', process.argv[2]);
app.whenReady().then(async () => {
  const page = path.join(process.argv[2], 'page.html');
  fs.writeFileSync(page, '<!doctype html><p>v1</p>');
  const win = new BrowserWindow({ show: false });
  await win.loadFile(page);
  const r = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const req = indexedDB.open('bdo-e', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('outbox', { keyPath: 'uniqueId' }).createIndex('createdAt', 'createdAt');
      db.createObjectStore('drafts', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(['outbox', 'drafts'], 'readwrite');
      tx.objectStore('outbox').put({ uniqueId: 'antigo-1', module: 'bdo', base: 'BA', createdAt: new Date().toISOString(),
        data: { poco: 'TST-V1', data: '${new Date().toISOString().slice(0, 10)}', atividades: [{ atividade: 'Registro da versão antiga', duracao: '1h00' }] },
        photos: [], status: 'pending', attempts: 0, nextAttemptAt: new Date().toISOString() });
      tx.objectStore('drafts').put({ key: 'BA:handover', uniqueId: 'rasc-1', module: 'handover', data: { poco: 'TST-V1' }, photos: [] });
      tx.oncomplete = () => { req.result.close(); resolve('banco v1 criado'); };
      tx.onerror = () => reject(tx.error);
    };
  })`);
  console.log(r);
  app.quit();
});
