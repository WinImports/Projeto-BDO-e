// Caixa de Saída (Outbox Pattern).
// Todo relatório finalizado entra aqui ANTES de qualquer tentativa de rede.
// Só sai daqui por confirmação explícita do Supabase (ver sync.js).

import { STORES, put, get, remove, count, getAll, toHistory } from './db.js';
import { sha256 } from './ids.js';

const listeners = new Set();
export const onOutboxChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = async () => {
  const n = await pendingCount();
  listeners.forEach((fn) => fn(n));
};

/**
 * Grava o relatório na fila local. Resolve apenas após a transação ser confirmada em disco.
 * @param {{uniqueId:string, module:string, data:object, photos:Array<{name:string,type:string,blob:Blob}>}} report
 */
export async function enqueue(report) {
  const now = new Date().toISOString();
  const record = {
    uniqueId: report.uniqueId,
    module: report.module,
    data: report.data,
    photos: report.photos || [],
    contentHash: await sha256({ module: report.module, data: report.data }),
    createdAt: now,
    status: 'pending',      // pending | error
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    nextAttemptAt: now
  };
  await put(STORES.outbox, record);
  await put(STORES.history, toHistory(record)); // fica no computador mesmo após o envio
  await notify();
  return record;
}

export const list = () => getAll(STORES.outbox, 'createdAt');
export const pendingCount = () => count(STORES.outbox);

export async function due(now = Date.now()) {
  const all = await list();
  return all.filter((r) => new Date(r.nextAttemptAt).getTime() <= now);
}

export async function markFailure(uniqueId, error, nextAttemptAt) {
  const rec = await get(STORES.outbox, uniqueId);
  if (!rec) return;
  rec.status = 'error';
  rec.attempts += 1;
  rec.lastError = String(error?.message || error);
  rec.lastAttemptAt = new Date().toISOString();
  rec.nextAttemptAt = new Date(nextAttemptAt).toISOString();
  await put(STORES.outbox, rec);
  await notify();
}

export async function updateRecord(rec) {
  await put(STORES.outbox, rec);
  await notify();
}

/** Remove da fila. Chamado SOMENTE pelo sync após confirmação do servidor. */
export async function confirmDelivered(uniqueId) {
  await remove(STORES.outbox, uniqueId);
  await notify();
}

/**
 * Um item pode voltar para edição somente se NUNCA houve tentativa de envio:
 * depois disso o servidor pode já ter gravado esse uniqueId e ignoraria a versão editada.
 */
export const canEdit = (rec) => rec.attempts === 0 && !rec.lastAttemptAt && !rec.photos.some((p) => p.path);

/** Retira o item da fila para voltar a ser rascunho. Devolve o registro (ou null se não puder). */
export async function takeBack(uniqueId) {
  const rec = await get(STORES.outbox, uniqueId);
  if (!rec || !canEdit(rec)) return null;
  await remove(STORES.outbox, uniqueId);
  await remove(STORES.history, uniqueId); // volta a ser rascunho; entra de novo ao finalizar
  await notify();
  return rec;
}

/** Libera todos os itens para nova tentativa imediata (botão "Sincronizar agora"). */
export async function resetSchedule() {
  const now = new Date().toISOString();
  for (const rec of await list()) {
    rec.nextAttemptAt = now;
    await put(STORES.outbox, rec);
  }
  await notify();
}
