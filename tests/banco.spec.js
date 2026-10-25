// Banco (supabase/schema.sql + supabase/migrations/001_equipe.sql) rodando num Postgres local (PGlite),
// com auth/storage/papéis do Supabase simulados (tests/sql/supabase-stub.sql). Valida a Gestão de Equipe:
// papéis gestor/técnico (sem "master geral" no app), cota max_technicians, matrícula, login por matrícula, busca ilimitada,
// envio só para os próprios contratos e isolamento entre contratos. Não abre o Electron.
const { test, expect } = require('@playwright/test');
const { SCHEMA, MIGRACAO, ANTES, novoBanco, usuario, como, rpc, um, erro, cenario } = require('./sql/pg');

test('migrações = trecho final do schema.sql (em ordem) e rodam duas vezes sem erro (idempotentes)', async () => {
  expect(SCHEMA).toBe(ANTES + MIGRACAO);
  const db = await novoBanco();
  await db.exec(MIGRACAO);
  await db.exec(SCHEMA);
  // quem rodou a primeira versão desta migração (com "master geral"): a versão atual remove
  await db.exec(`create table public.masters (email text primary key);
    create function public.is_master() returns boolean language sql as $$ select true $$;`);
  await db.exec(MIGRACAO);
  expect(await um(db, "select to_regclass('public.masters') as t, to_regprocedure('public.is_master()') as f")).toEqual({ t: null, f: null });
});

test('migração sobre os dados de hoje: contratos em texto viram public.contracts (mesma regra de comparação) e membros são ligados', async () => {
  const db = await novoBanco({ antigo: true });
  const u = await usuario(db, 'tec@empresa.com');
  await db.query(`insert into public.contract_members (email, contrato) values
    ('tec@empresa.com', 'OS-Mans'), ('outro@empresa.com', 'os mans'), ('x@empresa.com', 'Contrato Bahia Terra')`);
  await db.exec(MIGRACAO);
  const contratos = await rpc(db, 'select nome, nome_norm, max_technicians from public.contracts order by nome_norm');
  expect(contratos).toEqual([
    { nome: 'Contrato Bahia Terra', nome_norm: 'CONTRATO BAHIA TERRA', max_technicians: 2 },
    { nome: 'OS-Mans', nome_norm: 'OS MANS', max_technicians: 2 }
  ]);
  const membros = await rpc(db, 'select m.email, m.contrato, m.role, m.ativo, m.user_id, c.nome as c from public.contract_members m join public.contracts c on c.id = m.contrato_id order by m.email');
  expect(membros).toHaveLength(3);
  expect(membros.every((m) => m.role === 'tecnico' && m.ativo)).toBe(true);
  expect(membros.find((m) => m.email === 'outro@empresa.com').c).toBe('OS-Mans');
  expect(membros.find((m) => m.email === 'tec@empresa.com').user_id).toBe(u);
  // o app continua funcionando: my_contracts devolve o contrato do técnico
  expect(await como(db, { id: u, email: 'tec@empresa.com' }, () => rpc(db, 'select * from public.my_contracts()'))).toEqual([{ my_contracts: 'OS-Mans' }]);
  // cadastro à mão do jeito antigo (só e-mail + contrato em texto) ainda funciona e liga ao contrato
  await db.query("insert into public.contract_members (email, contrato) values ('Novo@Empresa.com ', 'OS.MANS')");
  expect(await um(db, "select email, contrato from public.contract_members where email = 'novo@empresa.com'")).toEqual({ email: 'novo@empresa.com', contrato: 'OS-Mans' });
});

test('papéis: cada um vê só os próprios contratos (sem "master geral" no app); e-mail não confirmado não vale', async () => {
  const { db, gestorA, gestorB, tec1 } = await cenario();
  const acesso = (q) => como(db, q, () => um(db, 'select public.my_access() as a')).then((r) => r.a);
  expect(await acesso(gestorA)).toEqual({ contratos: [{ id: expect.any(String), nome: 'OS-Mans', role: 'gestor' }] });
  expect((await acesso(gestorB)).contratos.map((c) => [c.nome, c.role])).toEqual([['Contrato Bahia Terra', 'gestor']]);
  expect((await acesso(tec1)).contratos.map((c) => [c.nome, c.role])).toEqual([['OS-Mans', 'tecnico']]);
  // não sobra nada de "master" no banco do app
  expect(await um(db, "select to_regclass('public.masters') as t, to_regprocedure('public.is_master()') as f")).toEqual({ t: null, f: null });

  const sem = { id: await usuario(db, 'naoconfirmado@empresa-a.com', { confirmado: false }), email: 'naoconfirmado@empresa-a.com' };
  await db.query("insert into public.contract_members (email, contrato) values ('naoconfirmado@empresa-a.com', 'OS-Mans')");
  expect((await acesso(sem)).contratos).toEqual([]);
});

test('cota max_technicians: gestor cadastra até o limite; o seguinte é recusado com mensagem para o master; gestores não contam', async () => {
  const { db, A, gestorA } = await cenario();
  const add = (email, mat, validar = false) => como(db, gestorA, () => um(db,
    'select public.team_add_technician($1, $2, $3, $4, $5) as r', [A, email, `Nome ${mat}`, mat, validar]));

  // A tem cota 2 e já 1 técnico ativo: a validação prévia não grava nada
  expect((await add('tec2@empresa-a.com', 'T-002', true)).r).toMatchObject({ ok: true, max_technicians: 2, tecnicos_ativos: 1 });
  expect((await um(db, 'select count(*)::int as n from public.contract_members where contrato_id = $1', [A])).n).toBe(2);

  const lista = (await add('tec2@empresa-a.com', 'T-002')).r;
  expect(lista).toMatchObject({ contrato: 'OS-Mans', max_technicians: 2, tecnicos_ativos: 2 });
  expect(lista.membros.map((x) => [x.email, x.role])).toContainEqual(['tec2@empresa-a.com', 'tecnico']);

  const e = await erro(add('tec3@empresa-a.com', 'T-003'));
  expect(e.message).toBe('Limite de 2 técnicos liberados para este contrato atingido. Entre em contato com o Master para ampliar a licença.');
  expect(e.code).toBe('P0001');

  // o Master (dono da licença) amplia a cota pelo SQL Editor → cadastra
  await db.query('update public.contracts set max_technicians = 3 where id = $1', [A]);
  expect((await add('tec3@empresa-a.com', 'T-003')).r.tecnicos_ativos).toBe(3);
});

test('permissões do cadastro: técnico não cadastra; gestor de outro contrato não cadastra nem vê a equipe; o gestor do contrato pode', async () => {
  const { db, A, tec1, gestorB, gestorA } = await cenario();
  const add = (q) => como(db, q, () => um(db, 'select public.team_add_technician($1, $2, $3, $4) as r', [A, 'novo@empresa-a.com', 'Novo', 'T-050']));
  expect((await erro(add(tec1))).code).toBe('42501');
  expect((await erro(add(gestorB))).code).toBe('42501');
  expect((await erro(como(db, gestorB, () => um(db, 'select public.team_list($1)', [A])))).code).toBe('42501');
  expect((await erro(como(db, 'anon', () => um(db, 'select public.team_list($1)', [A])))).message).toMatch(/permission denied/);
  expect((await add(gestorA)).r.tecnicos_ativos).toBe(2);
});

test('matrícula: única por pessoa no sistema inteiro (sem espaços / maiúsculas); a mesma pessoa pode estar em dois contratos', async () => {
  const { db, A, B, gestorA } = await cenario();
  // T-900 já é do técnico B, em outro contrato
  const e = await erro(como(db, gestorA, () => um(db, 'select public.team_add_technician($1, $2, $3, $4)', [A, 'x@empresa-a.com', 'X', 't 900'])));
  expect(e.message).toBe('Matrícula T 900 já está cadastrada para outra pessoa.'); // "t 900" = "T-900"
  // a mesma pessoa (mesmo e-mail e matrícula) entra em outro contrato
  await como(db, gestorA, () => um(db, 'select public.team_add_technician($1, $2, $3, $4)', [A, 'tecb@empresa-b.com', 'Técnico B', 'T-900']));
  expect((await rpc(db, "select contrato from public.contract_members where email = 'tecb@empresa-b.com' order by contrato")).map((r) => r.contrato))
    .toEqual(['Contrato Bahia Terra', 'OS-Mans']);
  // e-mail com outra matrícula é recusado (direto na tabela também)
  const e2 = await erro(db.query("insert into public.contract_members (email, contrato_id, matricula) values ('tec1@empresa-a.com', $1, 'OUTRA')", [B]));
  expect(e2.message).toBe('Este e-mail já tem outra matrícula cadastrada.');
});

test('ativar / desativar: desativado perde o acesso aos dados do contrato e libera a cota; reativar respeita a cota; gestor não mexe em gestor', async () => {
  const { db, A, gestorA, tec1 } = await cenario();
  await como(db, gestorA, () => um(db, 'select public.team_add_technician($1, $2, $3, $4)', [A, 'tec2@empresa-a.com', 'Tec 2', 'T-002']));
  const id = async (email) => (await um(db, 'select id from public.contract_members where email = $1 and contrato_id = $2', [email, A])).id;
  const set = (q, mid, v) => como(db, q, () => um(db, 'select public.team_set_active($1, $2) as r', [mid, v]));

  const r = (await set(gestorA, await id('tec1@empresa-a.com'), false)).r;
  expect(r.tecnicos_ativos).toBe(1);
  expect(await como(db, tec1, () => rpc(db, 'select * from public.my_contracts()'))).toEqual([]);

  // com a vaga livre, outro técnico entra; reativar o primeiro passaria da cota
  await como(db, gestorA, () => um(db, 'select public.team_add_technician($1, $2, $3, $4)', [A, 'tec3@empresa-a.com', 'Tec 3', 'T-003']));
  const e = await erro(set(gestorA, await id('tec1@empresa-a.com'), true));
  expect(e.message).toBe('Limite de 2 técnicos liberados para este contrato atingido. Entre em contato com o Master para ampliar a licença.');

  expect((await erro(set(gestorA, await id('gestor.a@empresa-a.com'), false))).message).toBe('O acesso de gestores é alterado pelo Master da licença.');
  expect((await erro(set(tec1, await id('tec2@empresa-a.com'), false))).code).toBe('42501'); // técnico não mexe em ninguém
});

test('login por matrícula: o banco confere a senha e só devolve o e-mail com a senha certa; inativo = falha; 5 falhas bloqueiam por 15 min', async () => {
  const { db, A } = await cenario();
  // senhas (no stub, crypt(senha) = 'h:' || senha)
  await db.query("update auth.users set encrypted_password = 'h:' || split_part(email, '@', 1) || '-senha'");
  const login = (m, senha, quem = 'anon') => como(db, quem, () => um(db, 'select public.login_matricula($1, $2) as r', [m, senha])).then((x) => x.r);

  expect(await login(' t-001 ', 'tec1-senha')).toEqual({ ok: true, email: 'tec1@empresa-a.com' }); // "t-001" = "T-001"
  expect(await login('T-001', 'errada')).toEqual({ ok: false, bloqueado: false });                  // sem e-mail
  expect(await login('NAO-EXISTE', 'qualquer')).toEqual({ ok: false, bloqueado: false });
  expect(await login('', 'x')).toEqual({ ok: false, bloqueado: false });

  await db.query("update public.contract_members set ativo = false where email = 'tec1@empresa-a.com' and contrato_id = $1", [A]);
  expect(await login('T-001', 'tec1-senha')).toEqual({ ok: false, bloqueado: false });

  for (let i = 0; i < 5; i++) await login('T-900', 'errada');
  expect(await login('T-900', 'tecb-senha')).toEqual({ ok: false, bloqueado: true }); // nem a senha certa passa
  await db.query("update public.login_tentativas set quando = now() - interval '16 minutes'");
  expect((await login('T-900', 'tecb-senha')).ok).toBe(true);

  // as funções antigas (001) foram removidas; a tabela de tentativas não é lida pela API
  expect(await um(db, "select to_regprocedure('public.login_matricula_preparar(text)') as f")).toEqual({ f: null });
});

/** Relatório gravado no servidor (direto na tabela, como o submit_reports grava). */
async function relatorio(db, tabela, { contrato, poco, dias = 0, cliente = 'PETROBRAS' }) {
  const quando = new Date(Date.now() - dias * 864e5).toISOString();
  const r = await um(db, `insert into public.${tabela} (unique_id, content_hash, payload, poco, report_date, cliente, contrato, client_created_at)
    values (gen_random_uuid(), 'h', $1, $2, $3, $4, $5, $6) returning unique_id`,
  [JSON.stringify({ poco, contrato, cliente }), poco, quando.slice(0, 10), cliente, contrato, quando]);
  return r.unique_id;
}

test('busca no histórico sem limite: todo o acervo do contrato (anos atrás), sem acento, em páginas; nunca o de outro contrato', async () => {
  const { db, tec1 } = await cenario();
  await relatorio(db, 'bdo_reports', { contrato: 'OS-Mans', poco: 'FBM-89', dias: 900 });
  await relatorio(db, 'technical_visits', { contrato: 'os mans', poco: 'RCB-34', dias: 400, cliente: 'Petrobrás' });
  for (let i = 0; i < 5; i++) await relatorio(db, 'execution_reports', { contrato: 'OS-Mans', poco: `EXE-${i}`, dias: i });
  await relatorio(db, 'bdo_reports', { contrato: 'Contrato Bahia Terra', poco: 'OUTRO-1', dias: 1 });

  const busca = (q, mod = null, antes = null, lim = 50) => como(db, tec1, () =>
    rpc(db, 'select poco, module, client_created_at from public.search_team_reports($1, $2, $3, $4) join public.bdo_reports b using (unique_id) union all select 1', [q, mod, antes, lim]).catch(() => null));
  const buscar = (q, mod = null, antes = null, lim = 50) => como(db, tec1, () =>
    rpc(db, "select payload->>'poco' as poco, module, client_created_at from public.search_team_reports($1, $2, $3, $4)", [q, mod, antes, lim]));
  void busca;

  const tudo = await buscar('');
  expect(tudo).toHaveLength(7); // inclusive o de 900 dias atrás
  expect(tudo.map((r) => r.poco)).not.toContain('OUTRO-1');
  expect((await buscar('fbm')).map((r) => r.poco)).toEqual(['FBM-89']);
  expect((await buscar('petrobras rcb')).map((r) => r.poco)).toEqual(['RCB-34']); // "Petrobrás" sem acento
  expect((await buscar('visita tecnica')).map((r) => r.poco)).toEqual(['RCB-34']);
  expect((await buscar('', 'handover')).length).toBe(5);

  // páginas: 3 + 3 + 1, sem repetir
  const p1 = await buscar('', null, null, 3);
  const p2 = await buscar('', null, p1.at(-1).client_created_at, 3);
  const p3 = await buscar('', null, p2.at(-1).client_created_at, 3);
  expect([...p1, ...p2, ...p3].map((r) => r.poco)).toEqual(tudo.map((r) => r.poco));
  expect(p3).toHaveLength(1);

  expect((await erro(como(db, 'anon', () => rpc(db, "select * from public.search_team_reports('')")))).message).toMatch(/permission denied/);
});

test('envio: só logado; relatório do próprio contrato (ou sem contrato) é gravado e confirmado; de outro contrato não', async () => {
  const { db, tec1 } = await cenario();
  const rel = (contrato) => ({
    unique_id: crypto.randomUUID(), module: 'bdo', content_hash: 'h', client_created_at: new Date().toISOString(),
    payload: { poco: 'P-1', data: '2026-10-22', contrato }
  });
  const meu = rel('os.mans'); const semContrato = rel(''); const alheio = rel('Contrato Bahia Terra');
  const enviar = (q, lista) => como(db, q, () => rpc(db, 'select * from public.submit_reports($1)', [JSON.stringify(lista)]));

  expect((await erro(enviar('anon', [meu]))).message).toMatch(/permission denied/);
  const ok = await enviar(tec1, [meu, semContrato, alheio]);
  expect(ok.map((r) => r.unique_id).sort()).toEqual([meu.unique_id, semContrato.unique_id].sort());
  expect((await um(db, 'select count(*)::int as n from public.bdo_reports where unique_id = $1', [alheio.unique_id])).n).toBe(0);
  // reenvio: idempotente, devolve o mesmo id
  const de_novo = await enviar(tec1, [meu]);
  expect(de_novo).toEqual(ok.filter((r) => r.unique_id === meu.unique_id));
});

test('relatório atualizado (Reutilizar): mesmo unique_id com conteúdo novo substitui a versão anterior, sem duplicar; só o autor atualiza', async () => {
  const { db, tec1, gestorA } = await cenario();
  const enviar = (q, lista) => como(db, q, () => rpc(db, 'select * from public.submit_reports($1)', [JSON.stringify(lista)]));
  const uid = crypto.randomUUID();
  const versao = (n, poco) => ({
    unique_id: uid, module: 'bdo', content_hash: `h${n}`, client_created_at: new Date().toISOString(),
    payload: { poco, data: '2026-10-22', contrato: 'OS-Mans', _revisao: n }
  });
  const [v1] = await enviar(tec1, [versao(1, 'FBM-89')]);
  const [v2] = await enviar(tec1, [versao(2, 'FBM-89, FBM-12')]);
  expect(v2).toEqual(v1); // mesma linha, mesmo id
  const linha = () => um(db, "select count(*)::int as n, max(poco) as poco, max(payload->>'_revisao') as rev, bool_or(updated_at is not null) as atualizado from public.bdo_reports where unique_id = $1", [uid]);
  expect(await linha()).toEqual({ n: 1, poco: 'FBM-89, FBM-12', rev: '2', atualizado: true });

  // outro usuário (mesmo contrato) não sobrescreve nem recebe confirmação
  expect(await enviar(gestorA, [versao(3, 'OUTRO')])).toEqual([]);
  expect((await linha()).poco).toBe('FBM-89, FBM-12');

  // o mesmo relatório duas vezes no mesmo lote: vale a última versão (sem erro de linha afetada duas vezes)
  const lote = await enviar(tec1, [versao(4, 'A'), versao(5, 'B')]);
  expect(lote).toEqual([v1]);
  expect((await linha()).poco).toBe('B');
});

test('isolamento: pela API ninguém lê as tabelas direto (RLS sem políticas); dados só pelas funções', async () => {
  const { db, tec1, gestorA } = await cenario();
  await relatorio(db, 'bdo_reports', { contrato: 'OS-Mans', poco: 'FBM-89' });
  for (const quem of ['anon', tec1, gestorA]) {
    for (const t of ['contract_members', 'contracts', 'bdo_reports', 'technical_visits', 'execution_reports', 'login_tentativas']) {
      const r = await erro(como(db, quem, () => rpc(db, `select * from public.${t}`)).then((rows) => { if (rows.length) throw new Error(`${t} vazou ${rows.length} linha(s)`); }));
      expect(r).toBeNull();
    }
    const escrita = await erro(como(db, quem, () => db.query("update public.contracts set max_technicians = 99")).then(async () => {
      if ((await um(db, 'select max(max_technicians) as m from public.contracts')).m === 99) throw new Error('cota alterada pela API');
      throw new Error('row-level security: nada alterado');
    }));
    expect(escrita?.message).toMatch(/row-level security|permission denied/);
  }
});

const LOGO_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('empresa por contrato (migração 003): gestor grava; todos do contrato recebem; outro contrato não vê nem altera', async () => {
  const { db, A, B, gestorA, gestorB, tec1, tecB } = await cenario();
  const empresas = (q) => como(db, q, () => um(db, 'select public.my_contract_companies() as e')).then((r) => r.e);
  const gravar = (q, contrato, nome, cnpj, logo) => como(db, q, () => um(db, 'select public.team_set_company($1, $2, $3, $4) as e', [contrato, nome, cnpj, logo]));

  // sem empresa definida: vem vazia (o app mostra "Empresa Prestadora", sem logo)
  expect(await empresas(tec1)).toEqual([{ id: A, nome: 'OS-Mans', empresa_nome: '', empresa_cnpj: '', empresa_logo: '', atualizada_em: null }]);

  const r = await gravar(gestorA, A, ' Empresa A ', '12.345.678/0001-95', LOGO_PNG);
  expect(r.e).toMatchObject({ id: A, empresa_nome: 'Empresa A', empresa_logo: LOGO_PNG });
  expect((await empresas(tec1))[0]).toMatchObject({ empresa_nome: 'Empresa A', empresa_cnpj: '12.345.678/0001-95', empresa_logo: LOGO_PNG, atualizada_em: expect.any(String) });
  // o contrato B não recebe a empresa do A
  expect((await empresas(tecB)).map((e) => [e.nome, e.empresa_nome, e.empresa_logo])).toEqual([['Contrato Bahia Terra', '', '']]);

  // técnico não altera; gestor de outro contrato também não
  expect((await erro(gravar(tec1, A, 'X', '', '')))?.message).toMatch(/Somente o gestor/);
  expect((await erro(gravar(gestorB, A, 'X', '', '')))?.message).toMatch(/Somente o gestor/);
  // só PNG/JPEG
  expect((await erro(gravar(gestorA, A, 'Empresa A', '', 'data:image/svg+xml;base64,PHN2Zz4=')))?.message).toMatch(/PNG ou JPEG/);
  // remover a logo: texto vazio
  expect((await gravar(gestorA, A, 'Empresa A', '', '')).e.empresa_logo).toBe('');
  await gravar(gestorB, B, 'Empresa B', '', LOGO_PNG);
  expect((await empresas(gestorB))[0]).toMatchObject({ nome: 'Contrato Bahia Terra', empresa_nome: 'Empresa B' });
  // anon não chama
  expect(await erro(como(db, 'anon', () => um(db, 'select public.my_contract_companies() as e')))).not.toBeNull();
});

test('empresa por contrato (migração 003): contrato sem empresa recebe a das Configurações de quem usa ele como "Contrato padrão"', async () => {
  const db = await novoBanco({ antigo: true });
  await db.query(`insert into public.contract_members (email, contrato) values ('tec@empresa.com', 'OS-MANS'), ('b@empresa.com', 'Bahia Terra')`);
  await db.query(`insert into public.company_settings (device_id, user_email, contrato_padrao, settings, updated_at) values
    (gen_random_uuid(), 'tec@empresa.com', 'os mans', $1, now() - interval '2 days'),
    (gen_random_uuid(), 'tec@empresa.com', 'OS.Mans', $2, now()),
    (gen_random_uuid(), 'b@empresa.com', 'Bahia Terra', '{"empresa_nome": ""}', now())`,
  [JSON.stringify({ empresa_nome: 'Antiga', empresa_logo: '' }), JSON.stringify({ empresa_nome: 'Nova Ltda', empresa_cnpj: '1', empresa_logo: LOGO_PNG })]);
  await db.exec(MIGRACAO);
  const c = await rpc(db, 'select nome, empresa_nome, empresa_cnpj, empresa_logo from public.contracts order by nome');
  expect(c).toEqual([
    { nome: 'Bahia Terra', empresa_nome: null, empresa_cnpj: null, empresa_logo: null },
    { nome: 'OS-MANS', empresa_nome: 'Nova Ltda', empresa_cnpj: '1', empresa_logo: LOGO_PNG }
  ]);
  // rodar de novo não sobrescreve o que o gestor definiu
  await db.query("update public.contracts set empresa_nome = 'Definida pelo gestor' where nome = 'OS-MANS'");
  await db.exec(MIGRACAO);
  expect((await um(db, "select empresa_nome from public.contracts where nome = 'OS-MANS'")).empresa_nome).toBe('Definida pelo gestor');
});
