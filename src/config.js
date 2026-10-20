// Configuração do Supabase.
// Onde ficam a URL e a chave "anon/publishable" (Supabase → Project Settings → API), em ordem de prioridade:
//   1. Configurações › Servidor (Supabase) — gravado neste aparelho (localStorage); serve para o PWA no celular
//   2. Desktop: variáveis de ambiente BDOE_SUPABASE_URL / BDOE_SUPABASE_ANON_KEY (repassadas pelo preload)
//   3. As constantes abaixo (valem para todos os aparelhos; o repositório é público)
// A chave anon é pública por natureza; a proteção dos dados vem do RLS e das funções security definer
// de supabase/schema.sql. NUNCA coloque aqui a chave service_role.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

const OVERRIDE_KEY = 'bdoe.supabase';

export const SYNC = {
  rpcName: 'submit_reports',     // função no banco que grava em lote de forma idempotente (bdo_reports / technical_visits / execution_reports)
  settingsRpc: 'save_company_settings', // configurações da empresa/equipe (company_settings)
  photoBucket: 'report-photos',  // bucket do Supabase Storage (privado, só INSERT)
  shareBucket: 'report-share',   // cópias dos relatórios (PDF/HTML) para o link do WhatsApp (público, caminho = uniqueId)
  batchSize: 10,                 // relatórios por requisição
  immediateRetries: 3,           // tentativas seguidas dentro de uma rodada (1s, 2s, 4s)
  baseDelayMs: 1000,
  backoffBaseMs: 30_000,         // após falhar a rodada: 30s, 1min, 2min, 4min...
  backoffMaxMs: 15 * 60_000,     // ...até no máximo 15 min entre tentativas
  heartbeatMs: 30_000            // verificação periódica de itens prontos para reenvio
};

function lerOverride() {
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY)) || {}; } catch { return {}; }
}

/** { url, anonKey, origem: 'aparelho' | 'ambiente' | 'config' | null } */
export function supabaseConfig() {
  const o = lerOverride();
  if (o.url && o.anonKey) return { url: o.url, anonKey: o.anonKey, origem: 'aparelho' };
  const env = globalThis.desktop?.supabaseEnv;
  if (env?.url && env?.anonKey) return { url: env.url, anonKey: env.anonKey, origem: 'ambiente' };
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, origem: 'config' };
  return { url: '', anonKey: '', origem: null };
}

export const isSupabaseConfigured = () => Boolean(supabaseConfig().url);

/** URL do projeto válida para a CSP do app (https://<projeto>.supabase.co). */
export const urlSupabaseValida = (url) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(url || '').trim());

/** Grava (ou apaga, com valores vazios) as credenciais deste aparelho. */
export function saveSupabaseOverride(url, anonKey) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  const k = String(anonKey || '').trim();
  if (!u && !k) localStorage.removeItem(OVERRIDE_KEY);
  else localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ url: u, anonKey: k }));
}
