// Download (pull) do histórico da equipe: relatórios dos últimos 30 dias dos contratos do técnico logado,
// com as fotos, gravados no Histórico local (IndexedDB) para consulta offline no campo, consolidação 14x14
// e "Antes x Depois" da Execução.
//
// Quem é de qual contrato é decidido pelo SERVIDOR (tabela contract_members, ver supabase/schema.sql):
// o app só pede "os relatórios da minha equipe" com o token do Supabase Auth. Sem login no servidor
// (usuário local / offline), nada é baixado.
//
// Relatórios do próprio aparelho nunca são sobrescritos. Os recebidos ficam com remote: true, autor e
// baixadoPor (e-mail de quem estava logado): se OUTRO técnico entrar neste aparelho, eles são apagados
// (limparEquipeDeOutroUsuario) — o mesmo técnico continua com o histórico offline depois de sair e entrar.

import { SYNC, isSupabaseConfigured } from '../config.js';
import { getClient } from './supabase.js';
import { STORES, get, put, getAll, remove } from './db.js';
import { currentUser } from './auth.js';
import { photoMeta } from './fotos.js';
import { notifyHistory } from './outbox.js';
import { atualizarContratos } from './contratos.js';

const INFO_KEY = 'bdoe.pull';
export const PULL_DIAS = 30;

const listeners = new Set();
export const onPullChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Última sincronização da equipe: { lastAt, contratos[], total, novos, erro } */
export function pullInfo() {
  try { return JSON.parse(localStorage.getItem(INFO_KEY)) || {}; } catch { return {}; }
}

function saveInfo(info) {
  try { localStorage.setItem(INFO_KEY, JSON.stringify(info)); } catch { /* não crítico */ }
  listeners.forEach((fn) => fn(info));
}

/** Logout: esquece de quais contratos o aparelho recebeu (os relatórios baixados continuam no Histórico). */
export function resetPullInfo() {
  try { localStorage.removeItem(INFO_KEY); } catch { /* ignora */ }
}

/** Fotos do relatório recebido. As que falharem ficam para a próxima sincronização (fotosPendentes). */
export async function baixarFotos(client, row, anteriores = []) {
  const jaTem = new Map(anteriores.filter((p) => p.blob && p.path).map((p) => [p.path, p]));
  const fotos = [];
  let falhas = 0;
  for (const p of Array.isArray(row.photos) ? row.photos : []) {
    if (!p?.path) continue;
    const salva = jaTem.get(p.path);
    if (salva) { fotos.push(salva); continue; }
    try {
      const { data, error } = await client.storage.from(SYNC.photoBucket).download(p.path);
      if (error || !data) throw error || new Error('sem conteúdo');
      fotos.push({ ...photoMeta({ ...p, blob: data, type: data.type || 'image/jpeg', name: p.name || p.path.split('/').pop() }), path: p.path });
    } catch (err) {
      falhas++;
      console.warn('[pull] foto', p.path, err);
    }
  }
  return { fotos, falhas };
}

/** Registro do Histórico para um relatório recebido da equipe. */
const paraHistorico = (row, fotos, falhas) => ({
  uniqueId: row.unique_id,
  module: row.module,
  data: row.payload || {},
  createdAt: row.client_created_at,
  sentAt: row.received_at,
  photos: fotos,
  photosCount: Array.isArray(row.photos) ? row.photos.length : 0,
  remote: true,
  autor: row.user_email || '',
  contrato: row.contrato || '',
  baixadoPor: currentUser()?.email || '',
  fotosPendentes: falhas
});

/** Ao entrar: apaga relatórios da equipe baixados por outro usuário deste aparelho. Retorna quantos. */
export async function limparEquipeDeOutroUsuario(email) {
  const meus = String(email || '').toLowerCase();
  const alheios = (await getAll(STORES.history)).filter((h) => h.remote && String(h.baixadoPor || '').toLowerCase() !== meus);
  for (const h of alheios) await remove(STORES.history, h.uniqueId);
  if (alheios.length) {
    resetPullInfo();
    await notifyHistory();
  }
  return alheios.length;
}

let rodando = null;

/**
 * Baixa o histórico da equipe. force: ao entrar no app, ao fazer login e ao voltar a internet;
 * sem force, respeita o intervalo SYNC.pullIntervalMs (verificação periódica).
 * Retorna { novos, total } ou { skipped: motivo }.
 */
export function pullTeamHistory({ force = false } = {}) {
  rodando ||= executar(force).finally(() => { rodando = null; });
  return rodando;
}

async function executar(force) {
  if (!isSupabaseConfigured() || !navigator.onLine) return { skipped: 'offline' };
  const client = getClient();
  const { data: sessao } = await client.auth.getSession();
  if (!sessao?.session) return { skipped: 'sem-login' };
  const info = pullInfo();
  if (!force && info.lastAt && Date.now() - Date.parse(info.lastAt) < SYNC.pullIntervalMs) return { skipped: 'recente' };

  try {
    const desde = new Date(Date.now() - PULL_DIAS * 864e5).toISOString();
    // contratos: a lista guardada por core/contratos.js (a sincronização acabou de atualizá-la; sozinha, consulta)
    const [nomes, lista] = await Promise.all([
      atualizarContratos(client),
      client.rpc('list_team_reports', { p_since: desde })
    ]);
    if (lista.error) throw lista.error;

    let novos = 0;
    for (const row of lista.data || []) {
      const local = await get(STORES.history, row.unique_id);
      if (local && !(local.remote && local.fotosPendentes)) continue; // do próprio aparelho ou já baixado completo
      const { fotos, falhas } = await baixarFotos(client, row, local?.photos);
      await put(STORES.history, paraHistorico(row, fotos, falhas));
      if (!local) novos++;
    }
    const resultado = { lastAt: new Date().toISOString(), contratos: nomes, total: (lista.data || []).length, novos, erro: '' };
    saveInfo(resultado);
    if (novos || (lista.data || []).length) await notifyHistory();
    return resultado;
  } catch (err) {
    console.error('[pull]', err);
    saveInfo({ ...info, erro: err.message || String(err) });
    throw err;
  }
}
