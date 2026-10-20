// Cliente Supabase carregado do build UMD local (src/vendor/supabase.js), sem bundler e sem CDN.
// A sessão do Supabase Auth fica no localStorage (persistSession) e é renovada sozinha quando há
// internet: os envios (RPC e Storage) vão com o token do técnico logado — o servidor registra quem
// enviou. Sem sessão válida (usuário local / token vencido), os envios seguem pela chave anon.
import { supabaseConfig, isSupabaseConfigured } from '../config.js';

export const AUTH_STORAGE_KEY = 'bdoe.supabase.auth';

let client = null;
let clientKey = '';

export function getClient() {
  if (!isSupabaseConfigured()) return null;
  const { url, anonKey } = supabaseConfig();
  if (!client || clientKey !== `${url}|${anonKey}`) {
    if (!window.supabase?.createClient) throw new Error('Biblioteca do Supabase não carregada');
    client = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY, detectSessionInUrl: false }
    });
    clientKey = `${url}|${anonKey}`;
  }
  return client;
}

/** Credenciais trocadas nas Configurações: o próximo getClient() cria um cliente novo. */
export function resetClient() {
  client = null;
  clientKey = '';
}
