// Coordenadas GPS: campo no BDO-e (fora do relatório impresso), botão "Obter Localização Atual" (somente leitura, sem digitação) e PDF.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, fill, openTab } = require('./helpers');

// GPS e rotas só no BDO-e (Visita / Execução herdam as coordenadas dele)
const REPORTS = ['bdo'];
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

test('o BDO-e tem o selo de localização (sem caixas de latitude/longitude) e "Obter Localização Atual"; Visita e Execução não têm GPS', async () => {
  const { page } = ctx;
  for (const tab of REPORTS) {
    await openTab(page, tab);
    const header = page.locator('#sec-0'); // primeira seção = identificação / cabeçalho
    await expect(header.locator('[data-geo-badge=coordenadas]')).toHaveText('Localização não capturada');
    await expect(header.locator('[data-geo=coordenadas][data-part=lat]')).toHaveClass(/sr-only/); // números fora da tela
    await expect(header.locator('.geo__value-box')).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'Obter Localização Atual' })).toBeVisible();
    // não existe digitação manual de coordenadas
    await expect(header.locator('input[data-geo], [data-geo] input')).toHaveCount(0);
  }
  for (const tab of ['visita_tecnica', 'handover']) {
    await openTab(page, tab);
    await expect(page.locator('[data-geo-badge]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Obter Localização Atual' })).toHaveCount(0);
  }
});

test('"Obter Localização Atual" preenche as coordenadas e mostra a rota com destino', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await mockGps(page, { latitude: -12.3524123, longitude: -38.3791456, accuracy: 8 });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();

  await expect(page.locator('[data-part=lat]')).toHaveText('-12.352412');
  await expect(page.locator('[data-part=lng]')).toHaveText('-38.379146');
  await expect(page.locator('[data-geo-badge=coordenadas]')).toHaveText('Localização capturada');
  await expect(page.locator('.geo__meta')).toContainText('Capturado pelo GPS');
  await expect(page.locator('.geo__meta')).toContainText('±8 m');
  // botão compacto "Navegar até…" (sem caixa de rota nem mapa): abre o aviso com Google Maps / Waze
  await page.locator('.geo__route[data-action=navigate]').click();
  await expect(page.locator('.route-prompt[data-route-prompt=navegar] [data-route-link=google]')).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=-12.352412,-38.379146&travelmode=driving');
  await expect(toast(page)).toContainText('Coordenadas capturadas');
});

test('sem sinal: avisa o erro sem oferecer digitação; "Limpar" apaga a captura', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await mockGps(page, { error: 3 }); // timeout do GPS
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(toast(page)).toContainText('não respondeu');
  await expect(toast(page)).not.toContainText('digit');
  await expect(page.locator('[data-part=lat]')).toHaveText('');
  await expect(page.locator('[data-action=clear-geo]')).toHaveCount(0);

  await mockGps(page, { latitude: -12.3456, longitude: -38.4, accuracy: 5 });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(page.locator('[data-part=lat]')).toHaveText('-12.345600');
  await page.locator('[data-action=clear-geo]').click();
  await expect(page.locator('[data-part=lat]')).toHaveText('');
  await expect(page.locator('.geo__route')).toHaveCount(0);
});

test('coordenadas e links de rota não saem na prévia nem no PDF; o cabeçalho traz só a identificação', async () => {
  const { app, page, userData } = ctx;
  const pdfPath = path.join(userData, 'gps.pdf');
  await app.evaluate(({ dialog, shell }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    shell.openPath = async () => '';
  }, pdfPath);

  await openTab(page, 'bdo');
  await fill(page, 'poco', 'LOCACAO SEM CADASTRO');
  await mockGps(page, { latitude: -12.3524, longitude: -38.3791, accuracy: 6 });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(page.locator('[data-part=lat]')).toHaveText('-12.352400');

  await page.locator('#btn-preview').click();
  const preview = page.locator('dialog.modal[open]');
  await expect(preview.locator('.geo-head')).toHaveCount(0);
  await expect(preview).not.toContainText('-12.352400');
  await expect(preview.locator('.modal__body dt', { hasText: 'Coordenadas GPS' })).toHaveCount(0);
  await expect(preview.locator('[data-ident] dt').first()).toHaveText('Poço / Locação');
  await expect(preview.locator('[data-ident] dd').first()).toHaveText('LOCACAO SEM CADASTRO');

  await preview.locator('[data-pdf]').click();
  await expect(toast(page)).toContainText('PDF salvo', { timeout: 15_000 });
  const raw = fs.readFileSync(pdfPath).toString('latin1');
  const uris = [...raw.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1]);
  expect(uris.filter((u) => /maps|waze|openstreetmap/.test(u))).toEqual([]);
});

test('coordenadas ficam salvas no rascunho ao reabrir o app', async () => {
  const { page, userData } = ctx;
  await openTab(page, 'bdo');
  await mockGps(page, { latitude: -10.6512, longitude: -36.9871, accuracy: 15 });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(page.locator('[data-part=lat]')).toHaveText('-10.651200');
  await ctx.close({ keepData: true });

  ctx = await launchApp({ userData });
  await openTab(ctx.page, 'bdo');
  await expect(ctx.page.locator('[data-part=lat]')).toHaveText('-10.651200');
  await expect(ctx.page.locator('[data-part=lng]')).toHaveText('-36.987100');
});
