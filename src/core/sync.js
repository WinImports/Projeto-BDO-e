// Sincronização em lote com o Supabase.
//
// Garantias:
//  1. Trava de confirmação — um relatório só sai da caixa de saída se o servidor responder
//     HTTP 200/201 E devolver o `id` gravado para aquele `unique_id`.
//  2. Idempotência — o `uniqueId` é a chave única no banco; reenviar o mesmo relatório
//     (ex.: resposta perdida no caminho) devolve o id já existente, sem duplicar.
//  3. Exponential backoff — tentativas imediatas 1s/2s/4s; se a rodada falhar, o item é
//     reagendado em 30s, 1min, 2min... até 15min, com jitter.
//  4. Fila no IndexedDB (store "outbox" = sync_queue): "Pendente de Envio" até a confirmação; ao voltar
//     a internet (evento online) a fila é enviada sozinha e o relatório fica "Sincronizado" no Histórico.
// O servidor separa por tipo (bdo_reports / technical_visits / execution_reports) e registra o técnico
// pelo token do Supabase Auth; user_email/device_id do aparelho vão como informação complementar.
// Junto com as fotos sobem as cópias do relatório em PDF e Word (.docx) para o bucket report-share
// (<módulo>/<uniqueId>.pdf|.docx). Falha nas cópias não segura o relatório na fila: os dados vêm primeiro.

import { SYNC, isSupabaseConfigured } from '../config.js';
import { getClient } from './supabase.js';
import * as outbox from './outbox.js';
import { syncSettings, pullSettings, getDeviceId } from './settings.js';
import { currentUser } from './auth.js';
import { pullTeamHistory } from './pull.js';

const state = { running: false, lastRunAt: null, lastError: null, pullError: null, pullPending: false };
const listeners = new Set();
export const onSyncState = (fn) => { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); };
const snapshot = () => ({ ...state, online: navigator.onLine, configured: isSupabaseConfigured() });
const emit = () => listeners.forEach((fn) => fn(snapshot()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.random() * ms * 0.2;

export const nextDelay = (attempts) =>
  jitter(Math.min(SYNC.backoffBaseMs * 2 ** attempts, SYNC.backoffMaxMs));

async function withRetry(fn) {
  let lastErr;
  for (let i = 0; i < SYNC.immediateRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!navigator.onLine) break;
      if (i < SYNC.immediateRetries - 1) await sleep(jitter(SYNC.baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

const safeName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_');

const isAlreadyExists = (error) =>
  String(error?.statusCode) === '409' || error?.status === 409 || /already exists|duplicate/i.test(error?.message || '');

// Envia as fotos de um relatório. Caminho determinístico por uniqueId → reenvio não duplica.
// Fotos já enviadas ficam marcadas no registro local e não são reenviadas.
async function uploadPhotos(client, rec) {
  let changed = false;
  for (let i = 0; i < rec.photos.length; i++) {
    const photo = rec.photos[i];
    if (photo.path) continue;
    const prefix = photo.category ? `${safeName(photo.category)}-` : '';
    const path = `${rec.module}/${rec.uniqueId}/${String(i + 1).padStart(2, '0')}-${prefix}${safeName(photo.name)}`;
    await withRetry(async () => {
      const { error } = await client.storage.from(SYNC.photoBucket)
        .upload(path, photo.blob, { contentType: photo.type, upsert: false });
      if (error && !isAlreadyExists(error)) throw error;
    });
    photo.path = path;
    changed = true;
  }
  if (changed) await outbox.updateRecord(rec);
  return rec.photos.map((p) => ({ path: p.path, category: p.category || null, name: p.name, field: p.field || null, fase: p.fase || null, legenda: p.legenda || '' }));
}

const toRow = (rec, photos) => ({
  unique_id: rec.uniqueId,
  base: rec.base || null, // legado: relatórios criados quando havia seleção BA/SE
  module: rec.module,
  content_hash: rec.contentHash,
  payload: rec.data,
  photos,
  client_created_at: rec.createdAt,
  device_id: getDeviceId(),
  user_email: currentUser()?.email || null
});

// Gerador das cópias PDF + Word (registrado pelo app: a montagem dos arquivos fica na interface)
let documentPublisher = null;
export const setDocumentPublisher = (fn) => { documentPublisher = fn; };

async function uploadDocuments(rec) {
  if (!documentPublisher || rec.docsAt) return;
  try {
    await documentPublisher(rec);
    rec.docsAt = new Date().toISOString();
    await outbox.updateRecord(rec);
  } catch (err) {
    console.warn('[sync] cópias PDF/Word não enviadas', err);
  }
}

async function deliverBatch(client, batch) {
  const failures = new Map();
  const rows = [];

  for (const rec of batch) {
    try {
      const photos = await uploadPhotos(client, rec);
      await uploadDocuments(rec);
      rows.push(toRow(rec, photos));
    } catch (err) {
      failures.set(rec.uniqueId, new Error(`Falha no envio de fotos: ${err.message || err}`));
    }
  }

  if (rows.length) {
    let response;
    try {
      response = await withRetry(async () => {
        const res = await client.rpc(SYNC.rpcName, { reports: rows });
        if (res.error) throw res.error;
        return res;
      });
    } catch (err) {
      rows.forEach((r) => failures.set(r.unique_id, err));
      return failures;
    }

    // Trava de confirmação: status 200/201 + id devolvido para cada unique_id
    const okStatus = response.status === 200 || response.status === 201;
    const confirmed = new Map(
      (Array.isArray(response.data) ? response.data : [])
        .filter((r) => r && r.unique_id && r.id != null)
        .map((r) => [r.unique_id, r.id])
    );
    for (const row of rows) {
      if (okStatus && confirmed.has(row.unique_id)) {
        await outbox.confirmDelivered(row.unique_id);
      } else {
        failures.set(row.unique_id, new Error(`Servidor não confirmou a gravação (HTTP ${response.status})`));
      }
    }
  }
  return failures;
}

/**
 * Envia a fila, as configurações e baixa o histórico da equipe (pull).
 * force: reagenda os itens com erro para já; pull: baixa a equipe sem esperar o intervalo
 * (login, volta da internet, abrir o app, "Sincronizar agora").
 */
export async function syncNow({ force = false, pull = false } = {}) {
  if (state.running) { state.pullPending ||= pull || force; return; }
  if (!navigator.onLine || !isSupabaseConfigured()) { emit(); return; }

  state.running = true;
  state.lastError = null;
  emit();
  try {
    if (force) await outbox.resetSchedule();
    const client = getClient();
    const items = await outbox.due();
    for (let i = 0; i < items.length; i += SYNC.batchSize) {
      const batch = items.slice(i, i + SYNC.batchSize);
      const failures = await deliverBatch(client, batch);
      for (const rec of batch) {
        const err = failures.get(rec.uniqueId);
        if (err) {
          state.lastError = err.message || String(err);
          await outbox.markFailure(rec.uniqueId, err, Date.now() + nextDelay(rec.attempts));
        }
      }
      if (!navigator.onLine) break;
    }
    try {
      await syncSettings(client);
    } catch (err) {
      state.lastError = `Configurações: ${err.message || err}`;
    }
    // empresa/logo do cabeçalho: traz a versão mais recente do técnico logado (company_settings)
    if ((pull || force) && currentUser() && currentUser().modo !== 'local') {
      try {
        await pullSettings(client);
      } catch (err) {
        console.warn('[sync] configurações do servidor não lidas', err);
      }
    }
    if (navigator.onLine) {
      try {
        await pullTeamHistory({ force: pull || force });
        state.pullError = null;
      } catch (err) {
        state.pullError = err.message || String(err);
      }
    }
  } catch (err) {
    state.lastError = err.message || String(err);
    console.error('[sync]', err);
  } finally {
    state.running = false;
    state.lastRunAt = new Date().toISOString();
    emit();
    if (state.pullPending) { state.pullPending = false; syncNow({ pull: true }); }
  }
}

export function startSyncScheduler() {
  // ao voltar a internet: envia a fila e baixa o histórico da equipe
  window.addEventListener('online', () => { emit(); syncNow({ pull: true }); });
  window.addEventListener('offline', emit);
  setInterval(() => syncNow(), SYNC.heartbeatMs);
  syncNow({ pull: true });
}
