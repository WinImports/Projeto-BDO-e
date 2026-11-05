// Foto ampliada: tocar na foto abre em tela cheia; tocar de novo (ou no "x" / Esc) fecha.
const { test, expect } = require('@playwright/test');
const { launchApp, openTab, anexarFoto } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('formulário e prévia: tocar na foto amplia; tocar de novo, no "x" ou Esc fecha', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await anexarFoto(page, 'fotos_chegada');
  await page.locator('[data-wrap=fotos_chegada] .photo__caption').fill('Placa do FBM-89');

  const amp = page.locator('dialog[data-foto-ampliada][open]');
  await page.locator('[data-wrap=fotos_chegada] figure.photo img').click();
  await expect(amp).toBeVisible();
  await expect(amp.locator('.foto-ampliada__legenda')).toHaveText('Placa do FBM-89');
  const box = await amp.locator('img').boundingBox();
  expect(box.width).toBeGreaterThan(300); // em tela cheia, bem maior que a miniatura
  await amp.locator('img').click(); // tocar de novo fecha
  await expect(page.locator('dialog[data-foto-ampliada]')).toHaveCount(0);

  await page.locator('[data-wrap=fotos_chegada] figure.photo img').click();
  await amp.locator('[data-fechar]').click();
  await expect(page.locator('dialog[data-foto-ampliada]')).toHaveCount(0);

  // na prévia também; fechar a foto não fecha a prévia
  await page.locator('#btn-preview').click();
  const prev = page.locator('dialog.modal[open]');
  await prev.locator('figure.photo img').first().click();
  await expect(amp).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[data-foto-ampliada]')).toHaveCount(0);
  await expect(prev).toBeVisible();
});
