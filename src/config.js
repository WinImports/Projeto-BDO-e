// Configuração do Supabase.
// Preencha com os dados do seu projeto (Supabase → Project Settings → API).
// A chave "anon/publishable" é pública por natureza; a proteção dos dados vem das políticas RLS
// e da função submit_reports definidas em supabase/schema.sql.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

export const SYNC = {
  rpcName: 'submit_reports',     // função no banco que grava em lote de forma idempotente
  photoBucket: 'report-photos',  // bucket do Supabase Storage
  batchSize: 10,                 // relatórios por requisição
  immediateRetries: 3,           // tentativas seguidas dentro de uma rodada (1s, 2s, 4s)
  baseDelayMs: 1000,
  backoffBaseMs: 30_000,         // após falhar a rodada: 30s, 1min, 2min, 4min...
  backoffMaxMs: 15 * 60_000,     // ...até no máximo 15 min entre tentativas
  heartbeatMs: 30_000            // verificação periódica de itens prontos para reenvio
};

export const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
