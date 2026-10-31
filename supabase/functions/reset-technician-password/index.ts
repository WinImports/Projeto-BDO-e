// @ts-nocheck — JavaScript puro (sem tipos) para rodar igual no Deno e nos testes em Node
// Edge Function reset-technician-password — o GESTOR do contrato gera uma NOVA SENHA PROVISÓRIA para um técnico
// da equipe (aba Equipe › "Nova senha"), quando o técnico esqueceu a senha.
//
// POST { member_id }  (Authorization: Bearer <token do gestor logado>)
//   200 { ok: true, senha, nome, email, matricula }   senha = provisória, mostrada só nesta resposta
//   400 dados inválidos · 401 sem login · 403 sem permissão (gestor de outro contrato, alvo gestor, técnico com
//   acesso a outro contrato) · 404 sem conta
//
// Passos: (1) team_reset_password_target COM O TOKEN DO GESTOR (regras no banco, migração 008) devolve o
// user_id; (2) com a chave de serviço grava a senha nova e user_metadata.must_change_password = true (o app
// obriga a criar uma senha própria no próximo acesso, igual ao cadastro). A senha não fica guardada em lugar
// nenhum além do Supabase Auth (com hash).
//
// Publicar: Supabase › Edge Functions › nome "reset-technician-password" › colar este arquivo; "Verify JWT"
// pode ficar DESLIGADO (o token do gestor é conferido aqui dentro). Testes: tests/redefinir-senha.spec.js.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const falha = (status, erro, codigo) => json(status, { ok: false, erro, codigo });

/** Senha provisória legível: 3 blocos de 4, sem caracteres que se confundem (0/O, 1/l/I). */
export function gerarSenhaProvisoria() {
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const n = crypto.getRandomValues(new Uint32Array(12));
  const s = Array.from(n, (x) => alfa[x % alfa.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function respostaDoBanco(err) {
  const msg = err?.message || 'Erro no servidor.';
  if (err?.code === '42501') return falha(403, msg, 'sem_permissao');
  if (err?.code === '22023') return falha(400, msg, 'invalido');
  if (err?.code === 'P0002') return falha(404, msg, 'nao_encontrado');
  return falha(500, msg, 'erro');
}

/**
 * deps: { clienteDoUsuario(authorization) → cliente com auth.getUser() e rpc(), admin → cliente com
 * auth.admin.getUserById / updateUserById, gerarSenha? (testes) }.
 */
export async function handler(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return falha(405, 'Use POST.', 'metodo');

  const authorization = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return falha(401, 'Entre com a sua conta para redefinir senhas.', 'sem_login');
  const usuario = deps.clienteDoUsuario(authorization);
  const { data: quem, error: erroLogin } = await usuario.auth.getUser();
  if (erroLogin || !quem?.user) return falha(401, 'Sessão expirada. Entre de novo com a sua conta.', 'sem_login');

  let corpo;
  try { corpo = await req.json(); } catch { return falha(400, 'Corpo da requisição inválido.', 'invalido'); }
  const membroId = String(corpo?.member_id ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(membroId)) return falha(400, 'Escolha o técnico.', 'invalido');

  // (1) regras no banco, com o token do gestor
  const alvo = await usuario.rpc('team_reset_password_target', { p_member_id: membroId });
  if (alvo.error) return respostaDoBanco(alvo.error);
  const { user_id: userId, nome, email, matricula } = alvo.data || {};
  if (!userId) return falha(404, 'Este técnico ainda não tem conta no servidor.', 'nao_encontrado');

  // (2) senha provisória + troca obrigatória no próximo acesso (mantém o resto do cadastro)
  const atual = await deps.admin.auth.admin.getUserById(userId);
  if (atual.error) return falha(500, `Não foi possível ler a conta: ${atual.error.message}`, 'auth');
  const senha = (deps.gerarSenha || gerarSenhaProvisoria)();
  const meta = { ...(atual.data?.user?.user_metadata || {}), must_change_password: true };
  const salva = await deps.admin.auth.admin.updateUserById(userId, { password: senha, user_metadata: meta });
  if (salva.error) return falha(500, `Não foi possível gravar a nova senha: ${salva.error.message}`, 'auth');

  return json(200, { ok: true, senha, nome: nome || '', email, matricula: matricula || '' });
}

// ---- Supabase Edge Runtime (Deno). Nos testes (Node) este trecho não roda. ----
const DenoGlobal = globalThis['Deno'];
if (DenoGlobal?.serve) {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const url = DenoGlobal.env.get('SUPABASE_URL');
  const anon = DenoGlobal.env.get('SUPABASE_ANON_KEY') || DenoGlobal.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const servico = DenoGlobal.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const semSessao = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, servico, semSessao);
  DenoGlobal.serve((req) => handler(req, {
    admin,
    clienteDoUsuario: (authorization) => createClient(url, anon, { ...semSessao, global: { headers: { Authorization: authorization } } })
  }));
}
