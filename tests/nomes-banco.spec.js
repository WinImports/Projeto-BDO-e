// Migração 011 no banco local: nomes das válvulas e flanges por contrato (só o gestor altera; todos do contrato recebem).
const { test, expect } = require('@playwright/test');
const { cenario, como, um, erro } = require('./sql/pg');

const chamar = (db, quem, sql, params = []) => como(db, quem, () => um(db, sql, params));

test('nomes por contrato: gestor define, equipe recebe em my_contract_companies, outros não alteram', async () => {
  const { db, A, gestorA, gestorB, tec1 } = await cenario();
  const nomes = { vc: { short: 'VC-01' }, flange_sup: { nome: 'Flange do adaptador' } };
  for (const quem of [tec1, gestorB]) {
    expect((await erro(chamar(db, quem, 'select public.team_set_nomes($1, $2)', [A, JSON.stringify(nomes)]))).code).toBe('42501');
  }
  expect((await erro(chamar(db, gestorA, 'select public.team_set_nomes($1, $2)', [A, '[1]']))).code).toBe('22023');
  const r = (await chamar(db, gestorA, 'select public.team_set_nomes($1, $2) as r', [A, JSON.stringify(nomes)])).r;
  expect(r).toEqual({ id: A, nome: 'OS-Mans', nomes_componentes: nomes });
  const lista = (await chamar(db, tec1, 'select public.my_contract_companies() as r')).r;
  expect(lista).toEqual([expect.objectContaining({ id: A, nomes_componentes: nomes })]);
});
