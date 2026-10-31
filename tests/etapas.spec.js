// Relatório em etapas (Visita Técnica / Execução): seções recolhidas só com o título; tocar abre; "Concluir etapa"
// confere os obrigatórios, marca como concluída, fecha e abre a próxima; tocar numa concluída abre para conferir.
const { test, expect } = require('@playwright/test');
const { launchApp, openTab, cell } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp({ etapas: true }); });
test.afterEach(async () => { await ctx.close(); });

const secao = (page, n) => page.locator(`section#sec-${n}`);

test('Visita em etapas: abre ao tocar, "Concluir etapa" confere obrigatórios, fecha e abre a próxima', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  // tudo recolhido: só os títulos
  await expect(page.locator('.etapa__body:visible')).toHaveCount(0);
  await expect(secao(page, 0).locator('[data-etapa-estado]')).toHaveText('Toque para preencher');

  await secao(page, 0).locator('[data-etapa-toggle]').click();
  await expect(secao(page, 0).locator('.etapa__body')).toBeVisible();
  await expect(secao(page, 0).locator('[data-etapa-toggle]')).toHaveAttribute('aria-expanded', 'true');

  // obrigatórios faltando: não conclui
  await page.locator('[data-field=cliente]').fill('');
  await secao(page, 0).locator('[data-action=concluir-etapa]').click();
  await expect(page.locator('#toasts')).toContainText('Falta preencher');
  await expect(page.locator('[data-wrap=poco].has-error')).toHaveCount(1);
  await expect(secao(page, 0).locator('.etapa__body')).toBeVisible();

  await page.locator('[data-field=poco]').fill('TST-ET');
  await page.locator('[data-field=cliente]').fill('PETROBRAS');
  await cell(page, 'equipe', 0, 'nome').fill('João');
  await secao(page, 0).locator('[data-action=concluir-etapa]').click();
  await expect(secao(page, 0)).toHaveClass(/etapa--concluida/);
  await expect(secao(page, 0).locator('[data-etapa-estado]')).toHaveText('Concluída · toque para conferir');
  await expect(secao(page, 0).locator('.etapa__body')).toBeHidden();
  await expect(secao(page, 1).locator('.etapa__body')).toBeVisible(); // a próxima abriu sozinha

  // sem obrigatórios: conclui direto; a concluída reabre para conferir
  await secao(page, 1).locator('[data-action=concluir-etapa]').click();
  await expect(secao(page, 1)).toHaveClass(/etapa--concluida/);
  await secao(page, 0).locator('[data-etapa-toggle]').click();
  await expect(secao(page, 0).locator('[data-field=poco]')).toHaveValue('TST-ET');
  await expect(secao(page, 2).locator('.etapa__body')).toBeHidden(); // só uma aberta por vez

  // o índice lateral abre a seção escolhida; o estado fica guardado no rascunho
  await openTab(page, 'bdo');
  await openTab(page, 'visita_tecnica');
  await expect(secao(page, 0)).toHaveClass(/etapa--concluida/);
  await expect(secao(page, 1)).toHaveClass(/etapa--concluida/);
  await page.locator('#section-nav [data-goto-section="3"]').click();
  await expect(secao(page, 3).locator('.etapa__body')).toBeVisible();
});

test('Ajustes: desligar as etapas mostra todas as seções abertas', async () => {
  const { page } = ctx;
  await openTab(page, 'settings');
  await page.locator('[data-pref-etapas]').uncheck();
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('[data-etapa-toggle]')).toHaveCount(0);
  await expect(page.locator('[data-field=poco]')).toBeVisible();
  await openTab(page, 'bdo'); // o BDO-e nunca fica em etapas
  await expect(page.locator('[data-etapa-toggle]')).toHaveCount(0);
});
