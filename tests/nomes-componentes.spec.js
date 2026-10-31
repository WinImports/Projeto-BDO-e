// Nomes das válvulas e flanges definidos pelo gestor em Ajustes (sem servidor: nas Configurações; com conta: por
// contrato, migração 011). Formulário, índice, Quadro de Ações e prévia usam os nomes; em branco = nome do app.
const { test, expect } = require('@playwright/test');
const { launchApp, fill, openTab, preencherVisita } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('gestor renomeia VC e o flange superior: formulário, índice, Quadro de Ações e prévia usam os nomes novos', async () => {
  const { page } = ctx;
  await openTab(page, 'settings');
  const secao = page.locator('#nomes-section');
  await expect(secao).toContainText('Nomes das válvulas e flanges (gestor)');
  await expect(secao.locator('[data-nome-comp=vm1][data-nome-parte=short]')).toHaveAttribute('placeholder', 'VM-1');
  await secao.locator('[data-nome-comp=vc][data-nome-parte=short]').fill('VC-01');
  await secao.locator('[data-nome-comp=flange_sup][data-nome-parte=nome]').fill('Flange do adaptador');
  const empresa = page.locator('#s-empresa_nome');
  if (await empresa.count() && !(await empresa.inputValue())) await empresa.fill('Empresa Teste');
  await page.locator('[data-action=save]').click();
  await page.locator('#toasts').getByText('Configurações salvas').last().waitFor();

  await openTab(page, 'visita_tecnica');
  await expect(page.locator('#section-nav .section-nav__label', { hasText: 'VC-01' })).toHaveCount(1);
  const vc = page.locator('section.form-section', { has: page.locator('[data-field=vc_estanqueidade]') });
  await expect(vc.locator('.form-section__title')).toContainText('VC-01 — Válvula da Coluna');
  await expect(vc.locator('[data-wrap=fotos_vc]')).toContainText('Fotos — VC-01');
  await expect(page.locator('section.form-section', { has: page.locator('[data-field=flange_sup_corrosao]') }).locator('.form-section__title')).toContainText('Flange do adaptador');

  await preencherVisita(page, 'TST-NM');
  await fill(page, 'vc_estanqueidade', 'Sem estanqueidade (vazamento)');
  await page.locator('[data-field=vc_intervencao][value=Sim]').check();
  await expect(page.locator('[data-wrap=correcoes] [data-col=acao]').last()).toHaveValue(/^VC-01: /);
  await fill(page, 'flange_sup_corrosao', 'Leve');
  await page.locator('#btn-finalize').click();
  await expect(page.locator('dialog.modal[open]')).toContainText('VC-01 — Válvula da Coluna');
  await expect(page.locator('dialog.modal[open]')).toContainText('Flange do adaptador');

  // apagar os nomes volta aos do app nos relatórios novos
  await page.locator('dialog.modal[open] [data-confirm]').click();
  await openTab(page, 'settings');
  await page.locator('[data-nome-comp=vc][data-nome-parte=short]').fill('');
  await page.locator('[data-nome-comp=flange_sup][data-nome-parte=nome]').fill('');
  await page.locator('[data-action=save]').click();
  await page.locator('#toasts').getByText('Configurações salvas').last().waitFor();
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('#section-nav .section-nav__label', { hasText: 'VC-01' })).toHaveCount(0);
});
