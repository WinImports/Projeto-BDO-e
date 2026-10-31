// Edge Function reset-technician-password (supabase/functions/reset-technician-password/index.ts) + migração 008
// (team_reset_password_target) rodando no Node contra o banco local (PGlite + schema.sql). Valida: o gestor do
// contrato gera senha provisória com troca obrigatória; técnico, gestor de outro contrato, alvo gestor, técnico
// desativado e técnico com acesso a outro contrato são recusados sem mexer em nenhuma senha.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { cenario, como, um, rpc } = require('./sql/pg');

const EDGE = pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'reset-technician-password', 'index.ts')).href;

function deps(db, tokens) {
  const chamarRpc = (quem) => async (nome, args) => {
    const nomes = Object.keys(args);
    const sql = `select public.${nome}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
    try {
      const r = await como(db, quem, () => um(db, sql, nomes.map((n) => args[n])));
      return { data: r.r, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message, hint: e.hint } };
    }
  };
  return {
    gerarSenha: () => 'Prov-1234-Abcd',
    clienteDoUsuario: (authorization) => {
      const quem = tokens[authorization];
      return {
        auth: { getUser: async () => (quem ? { data: { user: quem }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) },
        rpc: chamarRpc(quem || 'anon')
      };
    },
    admin: {
      auth: {
        admin: {
          getUserById: async (id) => {
            const u = await um(db, 'select id, email, raw_user_meta_data as meta from auth.users where id = $1', [id]);
            return u ? { data: { user: { id: u.id, email: u.email, user_metadata: u.meta } }, error: null } : { data: null, error: { message: 'User not found' } };
          },
          updateUserById: async (id, { password, user_metadata }) => {
            await db.query("update auth.users set encrypted_password = 'h:' || $2, raw_user_meta_data = $3 where id = $1", [id, password, JSON.stringify(user_metadata)]);
            return { data: { user: { id } }, error: null };
          }
        }
      }
    }
  };
}

const pedido = (token, corpo, metodo = 'POST') => new Request('https://projeto.supabase.co/functions/v1/reset-technician-password', {
  method: metodo, headers: token ? { Authorization: token, 'Content-Type': 'application/json' } : {}, body: metodo === 'POST' ? JSON.stringify(corpo) : undefined
});
const resposta = async (r) => ({ status: r.status, corpo: r.status === 204 ? null : await r.json() });

let edge;
test.beforeAll(async () => {
  const codigo = require('fs').readFileSync(new URL(EDGE), 'utf8');
  edge = await import(`data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`);
});

async function montar() {
  const c = await cenario();
  await c.db.query("update auth.users set encrypted_password = 'h:antiga', raw_user_meta_data = '{\"nome\":\"Técnico Um\",\"matricula\":\"T-001\"}' where email = 'tec1@empresa-a.com'");
  const tokens = { 'Bearer gestorA': c.gestorA, 'Bearer tec1': c.tec1, 'Bearer gestorB': c.gestorB };
  const chamar = async (token, corpo, metodo) => resposta(await edge.handler(pedido(token, corpo, metodo), deps(c.db, tokens)));
  const membro = async (email, contrato = c.A) => (await um(c.db, 'select id from public.contract_members where email = $1 and contrato_id = $2', [email, contrato])).id;
  const senhaDe = async (email) => (await um(c.db, 'select encrypted_password as s, raw_user_meta_data as meta from auth.users where email = $1', [email]));
  return { ...c, chamar, membro, senhaDe };
}

test('gestor gera senha provisória: grava a senha, liga a troca obrigatória e mantém o resto do cadastro', async () => {
  const { chamar, membro, senhaDe } = await montar();
  const r = await chamar('Bearer gestorA', { member_id: await membro('tec1@empresa-a.com') });
  expect(r).toEqual({ status: 200, corpo: { ok: true, senha: 'Prov-1234-Abcd', nome: 'Técnico Um', email: 'tec1@empresa-a.com', matricula: 'T-001' } });
  expect(await senhaDe('tec1@empresa-a.com')).toEqual({ s: 'h:Prov-1234-Abcd', meta: { nome: 'Técnico Um', matricula: 'T-001', must_change_password: true } });
});

test('recusa sem mexer na senha: técnico, gestor de outro contrato, alvo gestor, técnico desativado; sem login = 401', async () => {
  const { db, A, chamar, membro, senhaDe } = await montar();
  const tec1 = await membro('tec1@empresa-a.com');
  for (const token of ['Bearer tec1', 'Bearer gestorB']) {
    const r = await chamar(token, { member_id: tec1 });
    expect(r.status).toBe(403);
    expect(r.corpo.codigo).toBe('sem_permissao');
  }
  const gestor = await chamar('Bearer gestorA', { member_id: await membro('gestor.a@empresa-a.com') });
  expect(gestor).toEqual({ status: 403, corpo: { ok: false, codigo: 'sem_permissao', erro: 'A senha de gestores é redefinida pelo Master da licença.' } });

  await db.query("update public.contract_members set ativo = false where email = 'tec1@empresa-a.com' and contrato_id = $1", [A]);
  const inativo = await chamar('Bearer gestorA', { member_id: tec1 });
  expect(inativo).toEqual({ status: 400, corpo: { ok: false, codigo: 'invalido', erro: 'Reative o acesso antes de gerar uma nova senha.' } });

  expect((await chamar('Bearer token-invalido', { member_id: tec1 })).status).toBe(401);
  expect((await chamar(null, { member_id: tec1 })).status).toBe(401);
  expect((await chamar('Bearer gestorA', { member_id: 'x' })).status).toBe(400);
  expect((await senhaDe('tec1@empresa-a.com')).s).toBe('h:antiga');
});

test('técnico que também está em outro contrato (ou é gestor em algum): só o Master redefine', async () => {
  const { db, A, B, chamar, membro, senhaDe } = await montar();
  // técnico B também entra no contrato A: o gestor A não pode trocar a senha (daria acesso ao contrato B)
  await db.query("insert into public.contract_members (email, contrato_id, role, nome, matricula) values ('tecb@empresa-b.com', $1, 'tecnico', 'Técnico B', 'T-900')", [A]);
  const antes = (await senhaDe('tecb@empresa-b.com')).s;
  const r = await chamar('Bearer gestorA', { member_id: await membro('tecb@empresa-b.com') });
  expect(r).toEqual({ status: 403, corpo: { ok: false, codigo: 'sem_permissao', erro: 'Este técnico também tem acesso a outro contrato. Peça ao Master da licença para redefinir a senha.' } });
  expect((await senhaDe('tecb@empresa-b.com')).s).toBe(antes);

  // desativado no contrato B: aí o gestor A já pode
  await db.query("update public.contract_members set ativo = false where email = 'tecb@empresa-b.com' and contrato_id = $1", [B]);
  expect((await chamar('Bearer gestorA', { member_id: await membro('tecb@empresa-b.com') })).status).toBe(200);
});

test('a função do banco não é chamável sem login e o OPTIONS responde o CORS', async () => {
  const { db, membro } = await montar();
  const id = await membro('tec1@empresa-a.com');
  const semLogin = await como(db, 'anon', () => um(db, 'select public.team_reset_password_target($1) as r', [id])).catch((e) => e);
  expect(semLogin).toBeInstanceOf(Error);
  expect((await rpc(db, "select 1 from information_schema.routine_privileges where routine_name = 'team_reset_password_target' and grantee = 'anon'")).length).toBe(0);
  const op = await edge.handler(pedido(null, null, 'OPTIONS'), {});
  expect(op.status).toBe(204);
});
