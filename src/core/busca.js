// Busca no histórico INTEIRO dos contratos do técnico, no servidor (search_team_reports, migração 001):
// sem limite de data nem de quantidade, 50 por página. O aparelho continua guardando só os últimos 30 dias
// (core/pull.js) para uso offline; o acervo mais antigo é consultado aqui, com internet, e as fotos só são
// baixadas ao abrir o relatório (não enchem o armazenamento do aparelho).
import { isSupabaseConfigured } from '../config.js';
import { getClient } from './supabase.js';
import { currentUser } from './auth.js';
import { baixarFotos } from './pull.js';

export const POR_PAGINA = 50;

/** Dá para buscar no servidor agora? (servidor configurado, internet e conta do servidor) */
export const podeBuscarNoServidor = () =>
  isSupabaseConfigured() && navigator.onLine && Boolean(currentUser()) && currentUser().modo !== 'local';

/** Linha do servidor → registro no formato do Histórico (status 'server'; fotos ainda não baixadas). */
const paraRegistro = (row) => ({
  uniqueId: row.unique_id,
  module: row.module,
  data: row.payload || {},
  createdAt: row.client_created_at,
  sentAt: row.received_at,
  photos: [],
  fotosServidor: Array.isArray(row.photos) ? row.photos : [],
  photosCount: Array.isArray(row.photos) ? row.photos.length : 0,
  autor: row.user_email || '',
  contrato: row.contrato || '',
  remote: true,
  status: 'server'
});

/**
 * Uma página de resultados. antes: createdAt do último item da página anterior.
 * Devolve { itens, fim } (fim = não há mais páginas).
 */
export async function buscarNoServidor({ query = '', module = null, antes = null, limite = POR_PAGINA } = {}) {
  const { data, error } = await getClient().rpc('search_team_reports', {
    p_query: query || '', p_module: module || null, p_before: antes || null, p_limit: limite
  });
  if (error) throw error;
  const itens = (data || []).map(paraRegistro);
  return { itens, fim: itens.length < limite };
}

/** Baixa as fotos de um resultado do servidor (para a prévia / PDF). Devolve { fotos, falhas }. */
export async function baixarFotosDoServidor(rec) {
  return baixarFotos(getClient(), { photos: rec.fotosServidor || [] });
}
