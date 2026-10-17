// Coordenadas GPS: presença nos cabeçalhos, botão "Obter Localização Atual", edição manual e PDF.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, fill, openTab } = require('./helpers');

const REPORTS = ['bdo', 'visita_tecnica', 'handover'];
const toast = (page) => page.locator('#toasts .toast').last();

/** Substitui o GPS do Windows por uma posição fixa (ou um erro), para o teste ser determinístico. */
async function mockGps(page, result) {
  await page.evaluate((r) => {
    navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => (
      r.error ? fail({ code: r.error, message: 'simulado' }) : ok({ coords: r })
    ), 50);
  }, result);
}

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('os 3 relatórios têm Latitude, Longitude e "Obter Localização Atual" no bloco de identificação', async () => {
  const { page } = ctx;
  for (const tab of REPORTS) {
    await openTab(page, tab);
    const header = page.locator('#sec-0'); // primeira seção = identificação / cabeçalho
    await expect(header.locator('[data-geo=coordenadas][data-part=lat]')).toBeVisible();
    await expect(header.locator('[data-geo=coordenadas][data-part=lng]')).toBeVisible();
    await expect(header.getByRole('button', { name: 'Obter Localização Atual' })).toBeVisible();
  }
});

test('"Obter Localização Atual" preenche as coordenadas e mostra os links de mapa', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await mockGps(page, { latitude: -12.3524123, longitude: -38.3791456, accuracy: 8 });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();

  await expect(page.locator('[data-part=lat]')).toHaveValue('-12.352412');
  await expect(page.locator('[data-part=lng]')).toHaveValue('-38.379146');
  await expect(page.locator('.geo__meta')).toContainText('Capturado por GPS');
  await expect(page.locator('.geo__meta')).toContainText('±8 m');
  await expect(page.locator('.geo__links a').first()).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=-12.352412,-38.379146');
  await expect(toast(page)).toContainText('Coordenadas capturadas');
});

test('sem sinal: avisa o erro e aceita digitação manual (com validação)', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await mockGps(page, { error: 3 }); // timeout do GPS
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(toast(page)).toContainText('não respondeu');
  await expect(page.locator('[data-part=lat]')).toBeEditable();

  // coordenada impossível é recusada ao finalizar
  await page.locator('[data-part=lat]').fill('123');
  await page.locator('[data-part=lng]').fill('-38.4');
  await page.locator('#btn-finalize').click();
  await expect(page.locator('[data-wrap=coordenadas] .field__error')).toContainText('Coordenadas inválidas');

  // coordenada válida digitada à mão
  await page.locator('[data-part=lat]').fill('-12,3456'); // vírgula decimal aceita
  await page.locator('[data-part=lat]').blur();
  await expect(page.locator('.geo__meta')).toContainText('digitadas manualmente');
  await expect(page.locator('.geo__links a')).toHaveCount(3);
});

test('coordenadas aparecem no cabeçalho da prévia e viram links clicáveis no PDF', async () => {
  const { app, page, userData } = ctx;
  const pdfPath = path.join(userData, 'gps.pdf');
  await app.evaluate(({ dialog, shell }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    shell.openPath = async () => '';
  }, pdfPath);

  await openTab(page, 'handover');
  await fill(page, 'poco', 'RCB-34');
  await page.locator('[data-part=lat]').fill('-12.3524');
  await page.locator('[data-part=lng]').fill('-38.3791');
  await page.locator('[data-part=lng]').blur();

  await page.locator('#btn-preview').click();
  const preview = page.locator('dialog.modal[open]');
  await expect(preview.locator('.modal__header .geo-head')).toContainText('-12.352400, -38.379100');
  // no corpo não se repete (PDF compacto)
  await expect(preview.locator('.modal__body dt', { hasText: 'Coordenadas GPS' })).toHaveCount(0);

  await preview.locator('[data-pdf]').click();
  await expect(toast(page)).toContainText('PDF salvo', { timeout: 15_000 });
  const raw = fs.readFileSync(pdfPath).toString('latin1');
  const uris = [...raw.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1]);
  expect(uris).toContain('https://www.google.com/maps/search/?api=1&query=-12.3524,-38.3791');
  expect(uris).toContain('https://waze.com/ul?ll=-12.3524,-38.3791&navigate=yes');
});

test('coordenadas ficam salvas no rascunho ao reabrir o app', async () => {
  const { page, userData } = ctx;
  await openTab(page, 'bdo');
  await mockGps(page, { latitude: -10.6512, longitude: -36.9871, accuracy: 15 });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(page.locator('[data-part=lat]')).toHaveValue('-10.651200');
  await ctx.close({ keepData: true });

  ctx = await launchApp({ userData });
  await openTab(ctx.page, 'bdo');
  await expect(ctx.page.locator('[data-part=lat]')).toHaveValue('-10.651200');
  await expect(ctx.page.locator('[data-part=lng]')).toHaveValue('-36.987100');
});
