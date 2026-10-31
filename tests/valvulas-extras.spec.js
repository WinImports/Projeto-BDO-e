// Válvulas adicionais (VL — Válvula Lateral, VM — Válvula Mestre; até 2 de cada) na Visita Técnica e na Execução:
// o bloco só aparece no relatório em que foi incluído, entra no Quadro de Ações / prévia e passa da Visita
// para a Execução de referência.
const { test, expect } = require('@playwright/test');
const { launchApp, fill, openTab, preencherVisita } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('Visita: inclui VL e VM (até 2 de cada), preenche como as outras válvulas e remove', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  for (const p of ['vl1', 'vl2', 'vm1', 'vm2']) await expect(page.locator(`[data-opcional=${p}]`)).toBeHidden();
  await expect(page.locator('#section-nav .section-nav__label')).not.toContainText(['VL-1']);

  await page.locator('[data-action=add-valvula][data-tipo=VL]').click();
  await expect(page.locator('[data-opcional=vl1]')).toBeVisible();
  await expect(page.locator('[data-opcional=vl1] .form-section__title')).toContainText('Válvula adicional · VL-1 — Válvula Lateral 1');
  await expect(page.locator('#section-nav .section-nav__label', { hasText: 'VL-1' })).toHaveCount(1);
  await fill(page, 'vl1_estanqueidade', 'Sem estanqueidade (vazamento)');
  await page.locator('[data-field=vl1_intervencao][value=Sim]').check();
  await expect(page.locator('[data-wrap=correcoes] [data-col=acao]').last()).toHaveValue('VL-1: Necessária a substituição da válvula devido à falta de estanqueidade');

  await page.locator('[data-action=add-valvula][data-tipo=VL]').click();
  await expect(page.locator('[data-opcional=vl2]')).toBeVisible();
  await expect(page.locator('[data-action=add-valvula][data-tipo=VL]')).toBeDisabled(); // no máximo 2
  await page.locator('[data-action=add-valvula][data-tipo=VM]').click();
  await expect(page.locator('[data-opcional=vm1] .form-section__title')).toContainText('VM-1 — Válvula Mestre 1');
  await expect(page.locator('[data-valvula-extra]')).toHaveText([/VL-1/, /VL-2/, /VM-1/]);

  // remover sem dados: some na hora; com dados: pede confirmação e apaga
  await page.locator('[data-action=remove-valvula][data-p=vl2]').click();
  await expect(page.locator('[data-opcional=vl2]')).toBeHidden();
  await expect(page.locator('[data-action=add-valvula][data-tipo=VL]')).toBeEnabled();
  await page.locator('[data-action=remove-valvula][data-p=vm1]').click();
  await expect(page.locator('[data-opcional=vm1]')).toBeHidden();

  // continua depois de reabrir a tela (fica no rascunho)
  await openTab(page, 'bdo');
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('[data-opcional=vl1]')).toBeVisible();
  await expect(page.locator('[data-field=vl1_estanqueidade]')).toHaveValue('Sem estanqueidade (vazamento)');

  await page.locator('[data-action=remove-valvula][data-p=vl1]').click();
  await expect(page.locator('dialog.modal--confirm[open]')).toContainText('Remover a VL-1?');
  await page.locator('dialog.modal--confirm[open] [data-ok]').click();
  await expect(page.locator('[data-opcional=vl1]')).toBeHidden();
  await expect(page.locator('[data-wrap=correcoes] [data-col=acao]', { hasText: 'VL-1' })).toHaveCount(0);
  await page.locator('[data-action=add-valvula][data-tipo=VL]').click();
  await expect(page.locator('[data-field=vl1_estanqueidade]')).toHaveValue(''); // volta vazia
});

test('a válvula adicional da Visita aparece na prévia e passa para a Execução, com a situação da Visita', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, 'TST-VL');
  await page.locator('[data-action=add-valvula][data-tipo=VM]').click();
  await fill(page, 'vm1_estanqueidade', 'Estanque');
  await fill(page, 'vm1_obs', 'Válvula mestre nova');
  await page.locator('#btn-finalize').click();
  await expect(page.locator('dialog.modal[open]')).toContainText('VM-1 — Válvula Mestre 1');
  await page.locator('dialog.modal[open] [data-confirm]').click();

  await openTab(page, 'handover');
  await expect(page.locator('[data-opcional=vm1]')).toBeHidden();
  await fill(page, 'poco', 'TST-VL');
  await page.locator('[data-field=poco]').press('Tab');
  await expect(page.locator('[data-opcional=vm1]')).toBeVisible();
  await expect(page.locator('[data-visita-nota=vm1_na_visita]')).toContainText('Estanque — Válvula mestre nova');
  await expect(page.locator('[data-opcional=vl1]')).toBeHidden();
});
