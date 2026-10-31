// @ts-nocheck — JavaScript puro (sem tipos) para rodar igual no Deno e nos testes em Node
// Edge Function create-technician — o GESTOR do contrato cadastra um técnico pelo app (Gestão de Equipe).
//
// POST { name, email, matricula, password, contrato_id }  (Authorization: Bearer <token do gestor logado>)
//   201 { ok: true, conta_criada, equipe }   equipe = team_list do contrato (cota atualizada)
//   400 dados inválidos · 401 sem login · 403 sem permissão OU cota atingida · 409 e-mail/matrícula já usados
//
// Passos: (1) team_add_technician com p_somente_validar, COM O TOKEN DO GESTOR (papel + cota + matrícula
// conferidos no banco, migração 001); (2) cria a conta no Supabase Auth com a chave de serviço, e-mail já
// confirmado e must_change_password (troca obrigatória no 1º acesso); se o e-mail já tem conta (técnico de
// outro contrato), só vincula, sem mexer na senha; (3) team_add_technician de verdade (contrato travado: dois
// cadastros simultâneos não furam a cota). Se (3) falhar, a conta criada em (2) é apagada.
//
// Publicar: Supabase › Edge Functions › Deploy a new function › nome "create-technician" › colar este arquivo.
// "Verify JWT" pode ficar DESLIGADO: o token do gestor é conferido aqui dentro (auth.getUser).
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente das Edge Functions.
//
// Escrito sem sintaxe exclusiva de TypeScript: o mesmo arquivo roda nos testes (Node) — tests/edge-functions.spec.js.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const falha = (status, erro, codigo) => json(status, { ok: false, erro, codigo });

export const SENHA_MIN = 8;

/** Erro do banco (PostgREST / Postgres) → resposta HTTP com a mensagem do próprio banco (em português). */
function respostaDoBanco(err) {
  const msg = err?.message || 'Erro no servidor.';
  if (err?.code === '42501') return falha(403, msg, 'sem_permissao');
  if (err?.code === 'P0001' && (err?.hint === 'cota' || /^Limite de/.test(msg))) return falha(403, msg, 'cota');
  if (err?.code === '23505') return falha(409, msg, 'duplicado');
  if (err?.code === '22023') return falha(400, msg, 'invalido');
  if (err?.code === 'P0002') return falha(404, msg, 'nao_encontrado');
  return falha(500, msg, 'erro');
}

/**
 * deps: { clienteDoUsuario(authorization) → cliente com auth.getUser() e rpc(), admin → cliente com
 * auth.admin.createUser / deleteUser }. No Supabase são clientes do supabase-js (ver o fim do arquivo).
 */
export async function handler(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return falha(405, 'Use POST.', 'metodo');

  const authorization = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return falha(401, 'Entre com a sua conta para cadastrar técnicos.', 'sem_login');
  const usuario = deps.clienteDoUsuario(authorization);
  const { data: quem, error: erroLogin } = await usuario.auth.getUser();
  if (erroLogin || !quem?.user) return falha(401, 'Sessão expirada. Entre de novo com a sua conta.', 'sem_login');

  let corpo;
  try { corpo = await req.json(); } catch { return falha(400, 'Corpo da requisição inválido.', 'invalido'); }
  const nome = String(corpo?.name ?? '').trim().replace(/\s+/g, ' ');
  const email = String(corpo?.email ?? '').trim().toLowerCase();
  const matricula = String(corpo?.matricula ?? '').trim();
  const senha = String(corpo?.password ?? '');
  const contratoId = String(corpo?.contrato_id ?? '').trim();
  if (nome.length < 3) return falha(400, 'Informe o nome completo.', 'invalido');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return falha(400, 'E-mail inválido.', 'invalido');
  if (!matricula) return falha(400, 'Informe a matrícula funcional.', 'invalido');
  if (!/^[0-9a-f-]{36}$/i.test(contratoId)) return falha(400, 'Escolha o contrato.', 'invalido');
  if (senha.length < SENHA_MIN) return falha(400, `A senha inicial precisa ter pelo menos ${SENHA_MIN} caracteres.`, 'invalido');

  const args = { p_contrato_id: contratoId, p_email: email, p_nome: nome, p_matricula: matricula };

  // (1) papel, cota e matrícula — antes de criar qualquer conta
  const validacao = await usuario.rpc('team_add_technician', { ...args, p_somente_validar: true });
  if (validacao.error) return respostaDoBanco(validacao.error);

  // (2) conta no Supabase Auth (ou a que já existe para este e-mail)
  let criadaId = null;
  const criada = await deps.admin.auth.admin.createUser({
    email, password: senha, email_confirm: true,
    user_metadata: { nome, matricula, must_change_password: true }
  });
  if (criada.error) {
    const jaExiste = criada.error.code === 'email_exists' || /already (been )?registered|already exists/i.test(criada.error.message || '');
    if (!jaExiste) return falha(500, `Não foi possível criar a conta: ${criada.error.message}`, 'auth');
  } else {
    criadaId = criada.data?.user?.id || null;
  }

  // (3) vínculo ao contrato (cota conferida de novo, com o contrato travado)
  const vinculo = await usuario.rpc('team_add_technician', { ...args, p_somente_validar: false });
  if (vinculo.error) {
    if (criadaId) await deps.admin.auth.admin.deleteUser(criadaId); // não deixa conta solta
    return respostaDoBanco(vinculo.error);
  }
  return json(201, { ok: true, conta_criada: Boolean(criadaId), equipe: vinculo.data });
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
