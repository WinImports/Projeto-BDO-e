// Configuração do Supabase.
// Onde ficam a URL e a chave "anon/publishable" (Supabase → Project Settings → API), em ordem de prioridade:
//   1. Configurações › Servidor (Supabase) — gravado neste aparelho (localStorage); serve para o PWA no celular
//   2. Desktop: variáveis de ambiente BDOE_SUPABASE_URL / BDOE_SUPABASE_ANON_KEY (repassadas pelo preload)
//   3. Site publicado (Cloudflare Pages): NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY gravadas
//      pelo `npm run build` em dist/src/env.js (no repositório o env.js fica vazio)
//   4. As constantes abaixo (valem para todos os aparelhos; o repositório é público)
// A chave anon é pública por natureza; a proteção dos dados vem do RLS e das funções security definer
// de supabase/schema.sql. NUNCA coloque aqui a chave service_role.
import { ENV } from './env.js';

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

const OVERRIDE_KEY = 'bdoe.supabase';

export const SYNC = {
  rpcName: 'submit_reports',     // função no banco que grava em lote de forma idempotente (bdo_reports / technical_visits / execution_reports)
  settingsRpc: 'save_company_settings', // configurações da empresa/equipe (company_settings)
  settingsPullRpc: 'my_company_settings', // leitura das configurações mais recentes do técnico logado
  photoBucket: 'report-photos',  // bucket do Supabase Storage (privado: envio; leitura só pela equipe logada do mesmo contrato)
  shareBucket: 'report-share',   // cópias dos relatórios (PDF/HTML) para o link do WhatsApp (público, caminho = uniqueId)
  batchSize: 10,                 // relatórios por requisição
  immediateRetries: 3,           // tentativas seguidas dentro de uma rodada (1s, 2s, 4s)
  baseDelayMs: 1000,
  backoffBaseMs: 30_000,         // após falhar a rodada: 30s, 1min, 2min, 4min...
  backoffMaxMs: 15 * 60_000,     // ...até no máximo 15 min entre tentativas
  heartbeatMs: 30_000,           // verificação periódica de itens prontos para reenvio
  pullIntervalMs: 15 * 60_000    // histórico da equipe: além de login / volta da internet, no máximo a cada 15 min
};

function lerOverride() {
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY)) || {}; } catch { return {}; }
}

/** { url, anonKey, origem: 'aparelho' | 'ambiente' | 'publicacao' | 'config' | null } */
export function supabaseConfig() {
  const o = lerOverride();
  if (o.url && o.anonKey) return { url: o.url, anonKey: o.anonKey, origem: 'aparelho' };
  const env = globalThis.desktop?.supabaseEnv;
  if (env?.url && env?.anonKey) return { url: env.url, anonKey: env.anonKey, origem: 'ambiente' };
  if (ENV.supabaseUrl && ENV.supabaseAnonKey) return { url: ENV.supabaseUrl, anonKey: ENV.supabaseAnonKey, origem: 'publicacao' };
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, origem: 'config' };
  return { url: '', anonKey: '', origem: null };
}

export const isSupabaseConfigured = () => Boolean(supabaseConfig().url);

/**
 * Endereço oficial do app (NEXT_PUBLIC_APP_URL no build; senão o endereço onde a página está aberta).
 * Base para links e redirects do Supabase Auth (ex.: emailRedirectTo), nunca localhost fixo.
 */
export const appUrl = () => (ENV.appUrl || (/^https?:/.test(globalThis.location?.protocol || '') ? globalThis.location.origin : '')).replace(/\/+$/, '');

/** URL do projeto válida para a CSP do app (https://<projeto>.supabase.co). */
export const urlSupabaseValida = (url) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(url || '').trim());

/** Grava (ou apaga, com valores vazios) as credenciais deste aparelho. */
export function saveSupabaseOverride(url, anonKey) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  const k = String(anonKey || '').trim();
  if (!u && !k) localStorage.removeItem(OVERRIDE_KEY);
  else localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ url: u, anonKey: k }));
}

/** Versão exibida nas telas de acesso (manter igual à "version" do package.json). */
export const APP_VERSAO = '2.2.0';
