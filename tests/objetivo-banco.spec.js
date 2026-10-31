// Migração 010 no banco local: objetivo dos relatórios por contrato (só o gestor altera; todos do contrato recebem).
const { test, expect } = require('@playwright/test');
const { cenario, como, um, erro } = require('./sql/pg');

const chamar = (db, quem, sql, params = []) => como(db, quem, () => um(db, sql, params));

test('objetivos por contrato: gestor define, equipe recebe em my_contract_companies, outros não alteram', async () => {
  const { db, A, gestorA, gestorB, tec1 } = await cenario();
  for (const quem of [tec1, gestorB]) {
    expect((await erro(chamar(db, quem, 'select public.team_set_objetivos($1, $2, $3)', [A, 'x', 'y']))).code).toBe('42501');
  }
  const r = (await chamar(db, gestorA, 'select public.team_set_objetivos($1, $2, $3) as r', [A, ' Inspecionar a ANM ', ''])).r;
  expect(r).toEqual({ id: A, nome: 'OS-Mans', objetivo_visita: 'Inspecionar a ANM', objetivo_execucao: '' });
  const lista = (await chamar(db, tec1, 'select public.my_contract_companies() as r')).r;
  expect(lista).toEqual([expect.objectContaining({ id: A, objetivo_visita: 'Inspecionar a ANM', objetivo_execucao: '' })]);
});
