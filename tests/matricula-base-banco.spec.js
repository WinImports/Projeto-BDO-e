// Migração 009 no banco local (PGlite + schema.sql): matrícula real no 1º acesso (set_my_matricula) e base de
// poços por contrato (team_set_pocos / team_clear_pocos só para o gestor; my_pocos_bases / my_pocos_base para
// quem é do contrato).
const { test, expect } = require('@playwright/test');
const { cenario, como, um, rpc, erro } = require('./sql/pg');

const chamar = (db, quem, sql, params = []) => como(db, quem, () => um(db, sql, params));

test('1º acesso: a pessoa troca a matrícula provisória pela real em todos os vínculos; matrícula de outra pessoa é recusada', async () => {
  const { db, A, B, gestorA } = await cenario();
  // gestor A também está no contrato B (com a mesma matrícula provisória)
  await db.query("update public.contract_members set matricula = 'G-482193' where email = 'gestor.a@empresa-a.com'");
  await db.query("insert into public.contract_members (email, contrato_id, role, nome, matricula) values ('gestor.a@empresa-a.com', $1, 'tecnico', 'Gestor A', 'G-482193')", [B]);

  const r = await chamar(db, gestorA, "select public.set_my_matricula(' g-77 ') as r");
  expect(r.r).toBe('G-77');
  expect(await rpc(db, "select contrato_id, matricula from public.contract_members where email = 'gestor.a@empresa-a.com' order by contrato_id = $1 desc", [A]))
    .toEqual([{ contrato_id: A, matricula: 'G-77' }, { contrato_id: B, matricula: 'G-77' }]);

  const dup = await erro(chamar(db, gestorA, "select public.set_my_matricula('t-001')")); // T-001 é do técnico 1
  expect(dup.code).toBe('23505');
  expect(dup.message).toBe('Matrícula T-001 já está cadastrada para outra pessoa.');
  expect((await erro(chamar(db, gestorA, "select public.set_my_matricula('  ')"))).code).toBe('22023');
  expect(await erro(chamar(db, 'anon', "select public.set_my_matricula('X-1')"))).toBeInstanceOf(Error);
  // a matrícula antiga continua valendo até ser trocada, e só a dele mudou
  expect((await um(db, "select matricula from public.contract_members where email = 'tec1@empresa-a.com'")).matricula).toBe('T-001');
});

test('base de poços: só o gestor envia/apaga; quem é do contrato baixa; outro contrato não vê', async () => {
  const { db, A, gestorA, gestorB, tec1, tecB } = await cenario();
  const pocos = JSON.stringify([['FBM-89', -12.1, -38.2], ['TST-001', -12.3, -38.4]]);

  for (const quem of [tec1, gestorB]) {
    const e = await erro(chamar(db, quem, 'select public.team_set_pocos($1, $2, $3::jsonb)', [A, 'base.csv', pocos]));
    expect(e.code).toBe('42501');
  }
  expect((await erro(chamar(db, gestorA, 'select public.team_set_pocos($1, $2, $3::jsonb)', [A, 'x', '[]']))).message).toBe('A base está vazia.');
  expect((await erro(chamar(db, gestorA, 'select public.team_set_pocos($1, $2, $3::jsonb)', [A, 'x', '[["só nome"]]']))).code).toBe('22023');

  const salvo = (await chamar(db, gestorA, 'select public.team_set_pocos($1, $2, $3::jsonb) as r', [A, 'base.csv', pocos])).r;
  expect(salvo).toMatchObject({ contrato_id: A, fonte: 'base.csv', total: 2 });

  const resumo = (await chamar(db, tec1, 'select public.my_pocos_bases() as r')).r;
  expect(resumo).toEqual([expect.objectContaining({ contrato_id: A, contrato: 'OS-Mans', fonte: 'base.csv', total: 2 })]);
  expect(resumo[0]).not.toHaveProperty('pocos');
  const base = (await chamar(db, tec1, 'select public.my_pocos_base($1) as r', [A])).r;
  expect(base.pocos).toEqual(JSON.parse(pocos));

  expect((await chamar(db, tecB, 'select public.my_pocos_bases() as r')).r).toEqual([]);
  expect((await erro(chamar(db, tecB, 'select public.my_pocos_base($1)', [A]))).code).toBe('42501');

  // técnico desativado perde a base
  await db.query("update public.contract_members set ativo = false where email = 'tec1@empresa-a.com'");
  expect((await chamar(db, tec1, 'select public.my_pocos_bases() as r')).r).toEqual([]);

  expect((await erro(chamar(db, tec1, 'select public.team_clear_pocos($1)', [A]))).code).toBe('42501');
  await chamar(db, gestorA, 'select public.team_clear_pocos($1)', [A]);
  expect((await chamar(db, gestorA, 'select public.my_pocos_bases() as r')).r).toEqual([]);
  expect((await chamar(db, gestorA, 'select public.my_pocos_base($1) as r', [A])).r).toBeNull();
});

test('a tabela da base não é lida direto pela API (RLS sem políticas)', async () => {
  const { db, A, gestorA, tec1 } = await cenario();
  await chamar(db, gestorA, 'select public.team_set_pocos($1, $2, $3::jsonb)', [A, 'b', '[["P-1", -12, -38]]']);
  const direto = await como(db, tec1, () => rpc(db, 'select * from public.contract_pocos')).catch((e) => e);
  expect(Array.isArray(direto) ? direto.length : 0).toBe(0);
});
