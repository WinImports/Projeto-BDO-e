// Cliente Supabase carregado do build UMD local (node_modules), sem bundler e sem CDN.
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from '../config.js';

let client = null;

export function getClient() {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    if (!window.supabase?.createClient) throw new Error('Biblioteca do Supabase não carregada');
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}
