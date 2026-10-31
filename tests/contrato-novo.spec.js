// Conta de OUTRO contrato (outra empresa, ou a mesma empresa com outro contrato) abre os relatórios em branco:
// o rascunho do contrato anterior fica guardado à parte e volta quando uma conta daquele contrato entrar.
const { test, expect } = require('@playwright/test');
const { launchApp, fill, openTab, vincularContratos } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('outro contrato: BDO-e, Visita e Execução em branco; o rascunho do contrato anterior volta depois', async () => {
  const { page } = ctx;
  // Ajustes: cliente padrão ligado ao contrato padrão Perbras-BA
  await vincularContratos(page, ['Perbras-BA']);
  await openTab(page, 'settings');
  await page.locator('#s-cliente_padrao').fill('PETROBRAS');
  await page.locator('#s-contrato_padrao').selectOption('Perbras-BA');
  const empresa = page.locator('#s-empresa_nome');
  if (await empresa.count() && !(await empresa.inputValue())) await empresa.fill('Empresa Teste');
  await page.locator('[data-action=save]').click();
  await page.locator('#toasts').getByText('Configurações salvas').last().waitFor();

  await openTab(page, 'bdo');
  await expect(page.locator('[data-field=cliente]')).toHaveValue('PETROBRAS');
  await fill(page, 'poco', 'RCB-34');
  await page.locator('[data-field=poco]').press('Escape');
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-34');
  await fill(page, 'status_locacao', 'OK');
  await page.waitForTimeout(1500); // salvamento automático do rascunho

  // entra uma conta de outro contrato (mesma empresa, outro contrato)
  await vincularContratos(page, ['Perbras-SE'], 'outro@teste.com');
  for (const tab of ['bdo', 'visita_tecnica', 'handover']) {
    await openTab(page, tab);
    await expect(page.locator('[data-field=poco]')).toHaveValue('');
    await expect(page.locator('[data-field=cliente]')).toHaveValue('');
  }

  // volta a conta do contrato anterior: o rascunho dele volta
  await vincularContratos(page, ['Perbras-BA']);
  await openTab(page, 'bdo');
  await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-34');
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('[data-field=status_locacao]')).toHaveValue('OK');
});
