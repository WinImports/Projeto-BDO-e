// Edge Function create-technician (supabase/functions/create-technician/index.ts) rodando no Node contra o
// banco local (PGlite + schema.sql): os clientes do supabase-js são simulados — rpc() executa as funções
// REAIS do banco como o usuário do token; auth.admin grava em auth.users. Valida papel, cota (403 amigável),
// conta com troca de senha obrigatória, vínculo e desfazer a conta se o vínculo falhar.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { cenario, como, um, rpc } = require('./sql/pg');

const EDGE = pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'create-technician', 'index.ts')).href;

/** Clientes do supabase-js simulados sobre o banco local. tokens: { 'Bearer x': { id, email } } */
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
          createUser: async ({ email, password, email_confirm, user_metadata }) => {
            if ((await rpc(db, 'select 1 from auth.users where lower(email) = lower($1)', [email])).length) {
              return { data: null, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } };
            }
            const u = await um(db, `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
              values ($1, 'h:' || $2, case when $3 then now() end, $4) returning id`, [email, password, email_confirm, JSON.stringify(user_metadata)]);
            return { data: { user: { id: u.id, email } }, error: null };
          },
          deleteUser: async (id) => { await db.query('delete from auth.users where id = $1', [id]); return { error: null }; }
        }
      }
    }
  };
}

const pedido = (token, corpo, metodo = 'POST') => new Request('https://projeto.supabase.co/functions/v1/create-technician', {
  method: metodo, headers: token ? { Authorization: token, 'Content-Type': 'application/json' } : {}, body: metodo === 'POST' ? JSON.stringify(corpo) : undefined
});
const resposta = async (r) => ({ status: r.status, corpo: r.status === 204 ? null : await r.json() });

// O arquivo não tem sintaxe exclusiva de TypeScript: carregado como módulo JS (data URL), fora do carregador
// do Playwright, que transformaria o import em require e quebraria o "await" do trecho do Deno.
let edge;
test.beforeAll(async () => {
  const codigo = require('fs').readFileSync(new URL(EDGE), 'utf8');
  edge = await import(`data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`);
});

async function montar() {
  const c = await cenario();
  const tokens = { 'Bearer gestorA': c.gestorA, 'Bearer tec1': c.tec1, 'Bearer gestorB': c.gestorB };
  const chamar = async (token, corpo, metodo) => resposta(await edge.handler(pedido(token, corpo, metodo), deps(c.db, tokens)));
  const tecnico = (extra = {}) => ({ name: 'Maria da Silva', email: 'maria@empresa-a.com', matricula: 'T-010', password: 'inicial123', contrato_id: c.A, ...extra });
  return { ...c, chamar, tecnico };
}

test('gestor cadastra técnico: conta no Auth com e-mail confirmado e troca de senha obrigatória, vínculo e cota atualizada', async () => {
  const { db, chamar, tecnico, A } = await montar();
  const r = await chamar('Bearer gestorA', tecnico());
  expect(r.status).toBe(201);
  expect(r.corpo).toMatchObject({ ok: true, conta_criada: true, equipe: { contrato_id: A, max_technicians: 2, tecnicos_ativos: 2 } });
  expect(r.corpo.equipe.membros).toContainEqual(expect.objectContaining({ email: 'maria@empresa-a.com', matricula: 'T-010', nome: 'Maria da Silva', role: 'tecnico', ativo: true }));

  const conta = await um(db, "select email_confirmed_at is not null as confirmado, raw_user_meta_data as meta from auth.users where email = 'maria@empresa-a.com'");
  expect(conta).toEqual({ confirmado: true, meta: { nome: 'Maria da Silva', matricula: 'T-010', must_change_password: true } });
  // já entra pela matrícula com a senha inicial
  expect(await como(db, 'anon', () => um(db, "select public.login_matricula('t010', 'inicial123') as r")).then((x) => x.r)).toEqual({ ok: true, email: 'maria@empresa-a.com' });
});

test('cota atingida: 403 com a mensagem para o Master e NENHUMA conta criada', async () => {
  const { db, chamar, tecnico } = await montar();
  expect((await chamar('Bearer gestorA', tecnico())).status).toBe(201); // 2 de 2
  const r = await chamar('Bearer gestorA', tecnico({ email: 'joao@empresa-a.com', matricula: 'T-011', name: 'João Souza' }));
  expect(r).toEqual({ status: 403, corpo: { ok: false, codigo: 'cota', erro: 'Limite de 2 técnicos liberados para este contrato atingido. Entre em contato com o Master para ampliar a licença.' } });
  expect((await rpc(db, "select 1 from auth.users where email = 'joao@empresa-a.com'")).length).toBe(0);
});

test('sem permissão: técnico (403), gestor de outro contrato (403), sem login (401) — nada é criado', async () => {
  const { db, chamar, tecnico } = await montar();
  for (const token of ['Bearer tec1', 'Bearer gestorB']) {
    const r = await chamar(token, tecnico());
    expect(r.status).toBe(403);
    expect(r.corpo.codigo).toBe('sem_permissao');
  }
  expect((await chamar('Bearer token-invalido', tecnico())).status).toBe(401);
  expect((await chamar(null, tecnico())).status).toBe(401);
  expect((await rpc(db, "select 1 from auth.users where email = 'maria@empresa-a.com'")).length).toBe(0);
});

test('dados inválidos (400), matrícula de outra pessoa (409); OPTIONS responde o CORS', async () => {
  const { chamar, tecnico } = await montar();
  expect((await chamar('Bearer gestorA', tecnico({ password: '123' }))).corpo.erro).toBe('A senha inicial precisa ter pelo menos 8 caracteres.');
  expect((await chamar('Bearer gestorA', tecnico({ email: 'sem-arroba' }))).status).toBe(400);
  expect((await chamar('Bearer gestorA', tecnico({ matricula: ' ' }))).corpo.erro).toBe('Informe a matrícula funcional.');
  expect((await chamar('Bearer gestorA', tecnico({ contrato_id: 'x' }))).corpo.erro).toBe('Escolha o contrato.');
  const dup = await chamar('Bearer gestorA', tecnico({ matricula: 't-900' })); // T-900 é do técnico B
  expect(dup).toEqual({ status: 409, corpo: { ok: false, codigo: 'duplicado', erro: 'Matrícula T-900 já está cadastrada para outra pessoa.' } });
  const op = await edge.handler(pedido(null, null, 'OPTIONS'), {});
  expect(op.status).toBe(204);
  expect(op.headers.get('Access-Control-Allow-Origin')).toBe('*');
});

test('e-mail que já tem conta (técnico de outro contrato): só vincula, sem criar conta nem trocar a senha', async () => {
  const { db, chamar, tecnico } = await montar();
  const antes = await um(db, "select id, encrypted_password from auth.users where email = 'tecb@empresa-b.com'");
  const r = await chamar('Bearer gestorA', tecnico({ email: 'tecb@empresa-b.com', matricula: 'T-900', name: 'Técnico B' }));
  expect(r.status).toBe(201);
  expect(r.corpo.conta_criada).toBe(false);
  expect(await um(db, "select id, encrypted_password from auth.users where email = 'tecb@empresa-b.com'")).toEqual(antes);
});

test('vínculo falha depois de criar a conta (outro cadastro ocupou a última vaga): a conta criada é apagada', async () => {
  const { db, A, gestorA, tecnico } = await montar();
  const d = deps(db, { 'Bearer gestorA': gestorA });
  // entre a validação e o vínculo, outro cadastro ocupa a vaga (simula duas telas cadastrando ao mesmo tempo)
  const criarOriginal = d.admin.auth.admin.createUser;
  d.admin.auth.admin.createUser = async (dados) => {
    const r = await criarOriginal(dados);
    await como(db, gestorA, () => um(db, 'select public.team_add_technician($1, $2, $3, $4)', [A, 'rapido@empresa-a.com', 'Rápido', 'T-099']));
    return r;
  };
  const r = await resposta(await edge.handler(pedido('Bearer gestorA', tecnico()), d));
  expect(r.status).toBe(403);
  expect(r.corpo.codigo).toBe('cota');
  expect((await rpc(db, "select 1 from auth.users where email = 'maria@empresa-a.com'")).length).toBe(0);
});
