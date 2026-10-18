// Wrapper mínimo do IndexedDB. Cada gravação só é considerada concluída quando a
// transação dispara "complete" — ou seja, quando o dado já está persistido em disco.

import { photoMeta } from './fotos.js';

const DB_NAME = 'bdo-e';
const DB_VERSION = 2;
// history: cópia local (com fotos) de todo relatório finalizado, mesmo depois de enviado ao
// servidor — lista "Histórico" (reabrir, gerar PDF, reutilizar) e consolidação da quinzena.
export const STORES = { outbox: 'outbox', drafts: 'drafts', history: 'history' };

let dbPromise = null;

/** Registro do histórico a partir de um item da caixa de saída (fotos guardadas para refazer o PDF). */
export const toHistory = (rec) => ({
  uniqueId: rec.uniqueId, module: rec.module, data: rec.data, createdAt: rec.createdAt,
  photos: (rec.photos || []).map(photoMeta),
  photosCount: (rec.photos || []).length
});

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.outbox)) {
        const store = db.createObjectStore(STORES.outbox, { keyPath: 'uniqueId' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORES.drafts)) {
        db.createObjectStore(STORES.drafts, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.history)) {
        const hist = db.createObjectStore(STORES.history, { keyPath: 'uniqueId' });
        hist.createIndex('module', 'module');
        // v1 → v2: o que ainda está na caixa de saída entra no histórico
        if (event.oldVersion >= 1) {
          const tx = req.transaction;
          tx.objectStore(STORES.outbox).getAll().onsuccess = (e) => {
            for (const rec of e.target.result) tx.objectStore(STORES.history).put(toHistory(rec));
          };
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode, { durability: 'strict' });
    const store = tx.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
  }));
}

export const put = (storeName, value) => run(storeName, 'readwrite', (s) => s.put(value));
export const get = (storeName, key) => run(storeName, 'readonly', (s) => s.get(key));
export const remove = (storeName, key) => run(storeName, 'readwrite', (s) => s.delete(key));
export const count = (storeName) => run(storeName, 'readonly', (s) => s.count());
export const getAll = (storeName, indexName) =>
  run(storeName, 'readonly', (s) => (indexName ? s.index(indexName).getAll() : s.getAll()));

// Pede ao Chromium para não descartar os dados locais sob pressão de disco
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* não crítico */ }
  return false;
}
