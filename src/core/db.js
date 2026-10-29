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

// ---------- fotos guardadas como bytes (ArrayBuffer), não como Blob ----------
// No Safari do iPhone, um Blob lido do IndexedDB e gravado de novo (o rascunho é salvo a cada alteração;
// a Execução copia as fotos da Visita do histórico) pode virar um arquivo ilegível depois que o app
// recarrega: a foto some do PDF/Word. Bytes não têm esse problema. Na leitura, cada foto volta a ter
// um Blob novo, em memória.

const bytesDe = new WeakMap(); // Blob → bytes já lidos (não relê a foto a cada gravação do rascunho)
const ilegiveis = new WeakSet(); // Blob que não abriu: não tenta de novo (cada tentativa podia demorar)
const LEITURA_MS = 4000; // foto antiga quebrada no iPhone pode nunca responder: não trava o salvamento

const ehBlob = (b) => b && typeof b === 'object' && typeof b.size === 'number' && typeof b.slice === 'function';

function lerBytes(blob) {
  return Promise.race([
    blob.arrayBuffer(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Leitura da foto demorou demais')), LEITURA_MS))
  ]);
}

async function fotoParaGravar(p) {
  if (!p || typeof p !== 'object' || !ehBlob(p.blob)) return p;
  let bytes = bytesDe.get(p.blob);
  if (!bytes) {
    if (ilegiveis.has(p.blob)) return p;
    try {
      bytes = await lerBytes(p.blob);
      bytesDe.set(p.blob, bytes);
    } catch {
      ilegiveis.add(p.blob);
      return p; // ilegível: grava como está (não piora)
    }
  }
  const { blob, ...resto } = p;
  return { ...resto, type: p.type || blob.type || 'image/jpeg', bytes };
}

function fotoLida(p) {
  if (!p || typeof p !== 'object' || !(p.bytes instanceof ArrayBuffer)) return p;
  const { bytes, ...resto } = p;
  const blob = new Blob([bytes], { type: p.type || 'image/jpeg' });
  bytesDe.set(blob, bytes);
  return { ...resto, blob };
}

async function paraGravar(value) {
  if (!value || !Array.isArray(value.photos)) return value;
  return { ...value, photos: await Promise.all(value.photos.map(fotoParaGravar)) };
}

function lido(value) {
  if (!value || !Array.isArray(value.photos)) return value;
  value.photos = value.photos.map(fotoLida);
  return value;
}

// Gravações uma de cada vez, na ordem em que foram pedidas: com a leitura das fotos antes da transação,
// um salvamento mais antigo podia terminar depois de um mais novo e apagar a foto recém-tirada.
let fila = Promise.resolve();

export const put = (storeName, value) => {
  const job = fila.then(async () => {
    const v = await paraGravar(value); // fora da transação (await dentro dela a encerraria)
    return run(storeName, 'readwrite', (s) => s.put(v));
  });
  fila = job.catch(() => {});
  return job;
};
export const get = (storeName, key) => run(storeName, 'readonly', (s) => s.get(key)).then(lido);
export const remove = (storeName, key) => {
  const job = fila.then(() => run(storeName, 'readwrite', (s) => s.delete(key))); // na mesma ordem das gravações
  fila = job.catch(() => {});
  return job;
};
export const count = (storeName) => run(storeName, 'readonly', (s) => s.count());
export const getAll = (storeName, indexName) =>
  run(storeName, 'readonly', (s) => (indexName ? s.index(indexName).getAll() : s.getAll()))
    .then((lista) => (lista || []).map(lido));

// Pede ao Chromium para não descartar os dados locais sob pressão de disco
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* não crítico */ }
  return false;
}
