// Valida a tela inicial e o menu unificado de relatórios.
const { test, expect } = require('@playwright/test');
const { launchApp, openTab } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('abre a janela com título, abas e barra de ações', async () => {
  const { page } = ctx;
  await expect(page).toHaveTitle('BDO-e & Inspeção Técnica');
  await expect(page.locator('#tabs [data-tab=outbox]')).toBeVisible();
  await expect(page.locator('#tabs [data-tab=settings]')).toBeVisible();

  await openTab(page, 'bdo');
  await expect(page.locator('#view h2')).toHaveText('Boletim Diário Operacional Eletrônico');
  await expect(page.locator('#btn-save')).toBeVisible();
  await expect(page.locator('#btn-preview')).toBeVisible();
  await expect(page.locator('#btn-finalize')).toBeVisible();
});

test('menu tem exatamente 3 abas de relatório, na ordem definida, e sem seletor de base', async () => {
  const { page } = ctx;
  const reportTabs = page.locator('#tabs [data-tab]:not([data-tab=outbox]):not([data-tab=settings])');
  await expect(reportTabs).toHaveCount(3);
  await expect(reportTabs.locator('.tab__title')).toHaveText(['BDO-e', 'Relatório de Visita Técnica', 'Relatório de Execução']);
  await expect(page.locator('input[name=base]')).toHaveCount(0);
  await expect(page.getByText('Sergipe')).toHaveCount(0);
});

test('finalizar sem preencher aponta os campos obrigatórios', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await page.locator('#btn-finalize').click();
  await expect(page.locator('.field.has-error').first()).toBeVisible();
  await expect(page.locator('#ready-status')).toContainText('obrigatório');
});
