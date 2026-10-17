// Importação da base de poços/locações em Configurações (CSV e KML) e uso no autocompletar.
// Bases FICTÍCIAS em tests/fixtures (poços "TST-…" e "KML-…").
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, openTab } = require('./helpers');
const { parseFile } = require('../src/shared/pocos-parser.js');

const CSV = path.join(__dirname, 'fixtures', 'pocos-teste.csv');
const KML = path.join(__dirname, 'fixtures', 'pocos-teste.kml');
const toast = (page) => page.locator('#toasts .toast').last();

// Sem base embutida, para o teste não depender da base real que vier junto com o app
function emptyBundled() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-vazio-')), 'vazio.json');
  fs.writeFileSync(file, JSON.stringify({ fonte: null, total: 0, pocos: [] }));
  return { BDOE_POCOS_FILE: file };
}

/** Simula arrastar e soltar um arquivo sobre a área de importação. */
async function dropFile(page, filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  await page.evaluate(({ name, content }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], name));
    const zone = document.querySelector('[data-dropzone]');
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { name: path.basename(filePath), content });
}

test('parser KML: Point, CDATA, ExtendedData, espaços na vírgula, centro do polígono e marcador sem coordenada', () => {
  const r = parseFile(fs.readFileSync(KML), KML);
  expect(r.formato).toBe('KML');
  expect(r.pocos.map((p) => p[0])).toEqual(['KML-101', 'KML-102 & CIA', 'KML-103', 'KML-104', 'LOCACAO KML-200']);
  expect(r.pocos.find((p) => p[0] === 'KML-104')).toEqual(['KML-104', -12.344, -38.404]);
  expect(r.foraDaRegiao).toBe(0);
  expect(r.pocos[0]).toEqual(['KML-101', -12.341, -38.401]); // KML é longitude,latitude
  const loc = r.pocos.find((p) => p[0] === 'LOCACAO KML-200');
  expect(loc[1]).toBeCloseTo(-12.501, 6);
  expect(loc[2]).toBeCloseTo(-38.501, 6);
  expect(r.problems.some((p) => p.includes('KML-SEM-COORD'))).toBe(true);
});

test.describe('Configurações → Base de Poços e Locações', () => {
  let ctx;
  test.beforeEach(async () => { ctx = await launchApp({ env: emptyBundled() }); });
  test.afterEach(async () => { await ctx.close(); });

  test('importa CSV pelo botão, mostra a contagem e o autocompletar preenche as coordenadas', async () => {
    const { page } = ctx;
    await openTab(page, 'settings');
    await expect(page.locator('[data-pocos-status]')).toContainText('Nenhuma base carregada');

    await page.locator('[data-pocos-input]').setInputFiles(CSV);
    await expect(page.locator('[data-pocos-count]')).toHaveText('5 poços carregados');
    await expect(page.locator('[data-pocos-report]')).toContainText('5 poços importados de pocos-teste.csv');
    await expect(page.locator('[data-pocos-report] summary')).toContainText('2 registros ignorados');
    await expect(toast(page)).toContainText('5 poços carregados');

    await openTab(page, 'bdo');
    await expect(page.locator('[data-pocos-hint]')).toContainText('Base importada: 5 poços');
    await page.locator('[data-field=poco]').fill('tst-01');
    await page.locator('.combo__opt').first().click();
    await expect(page.locator('[data-field=poco]')).toHaveValue('TST-010');
    await expect(page.locator('[data-part=lat]')).toHaveValue('-12.370500');
    await expect(page.locator('[data-part=lng]')).toHaveValue('-38.401200');
  });

  test('importa KML arrastando o arquivo; locação em polígono usa o ponto central', async () => {
    const { page } = ctx;
    await openTab(page, 'settings');
    await dropFile(page, KML);
    await expect(page.locator('[data-pocos-count]')).toHaveText('5 poços carregados');
    await expect(page.locator('[data-pocos-report]')).toContainText('(KML');

    await openTab(page, 'handover');
    await page.locator('[data-field=poco]').fill('kml 200');
    await page.locator('[data-field=poco]').press('ArrowDown');
    await page.locator('[data-field=poco]').press('Enter');
    await expect(page.locator('[data-field=poco]')).toHaveValue('LOCACAO KML-200');
    await expect(page.locator('[data-part=lat]')).toHaveValue('-12.501000');
    await expect(page.locator('[data-part=lng]')).toHaveValue('-38.501000');
  });

  test('arquivo inválido não substitui a base atual', async () => {
    const { page, userData } = ctx;
    await openTab(page, 'settings');
    await page.locator('[data-pocos-input]').setInputFiles(CSV);
    await expect(page.locator('[data-pocos-count]')).toHaveText('5 poços carregados');

    const bad = path.join(userData, 'sem-coordenadas.csv');
    fs.writeFileSync(bad, 'Poço;Campo\nTST-999;X\n');
    await page.locator('[data-pocos-input]').setInputFiles(bad);
    await expect(page.locator('[data-pocos-report] .notice--error')).toContainText('latitude, longitude');
    await expect(page.locator('[data-pocos-report]')).toContainText('A base anterior foi mantida');
    await expect(page.locator('[data-pocos-count]')).toHaveText('5 poços carregados');

    // latitude e longitude trocadas: tudo cai fora da BA/SE → recusa
    const swapped = path.join(userData, 'trocado.csv');
    fs.writeFileSync(swapped, ['poco;latitude;longitude', 'TST-500;-38.43;-12.79', 'TST-501;-38.44;-12.80'].join('\n'));
    await page.locator('[data-pocos-input]').setInputFiles(swapped);
    await expect(page.locator('[data-pocos-report] .notice--error')).toContainText('fora da região BA/SE');
    await expect(page.locator('[data-pocos-count]')).toHaveText('5 poços carregados');

    const xlsx = path.join(userData, 'planilha.xlsx');
    fs.writeFileSync(xlsx, 'x');
    await page.locator('[data-pocos-input]').setInputFiles(xlsx);
    await expect(page.locator('[data-pocos-report] .notice--error')).toContainText('não suportado');
  });
});

test('base importada continua após reabrir; Limpar Base volta à digitação livre com GPS funcionando', async () => {
  const env = emptyBundled();
  let ctx = await launchApp({ env });
  await openTab(ctx.page, 'settings');
  await ctx.page.locator('[data-pocos-input]').setInputFiles(CSV);
  await expect(ctx.page.locator('[data-pocos-count]')).toHaveText('5 poços carregados');
  await ctx.close({ keepData: true });

  ctx = await launchApp({ userData: ctx.userData, env });
  const { page } = ctx;
  await openTab(page, 'settings');
  await expect(page.locator('[data-pocos-count]')).toHaveText('5 poços carregados');
  await expect(page.locator('[data-pocos-status]')).toContainText('pocos-teste.csv');

  await page.locator('[data-action=clear-pocos]').click();
  await page.locator('dialog.modal--confirm[open] [data-ok]').click();
  await expect(page.locator('[data-pocos-status]')).toContainText('Nenhuma base carregada');

  await openTab(page, 'visita_tecnica');
  await expect(page.locator('[data-pocos-hint]')).toContainText('Nenhuma base de poços carregada');
  await page.locator('[data-field=poco]').fill('TST-001');
  await expect(page.locator('.combo__list')).toBeHidden();
  await expect(page.locator('[data-field=poco]')).toHaveValue('TST-001');

  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: -12.44, longitude: -38.33, accuracy: 5 } });
  });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(page.locator('[data-part=lat]')).toHaveValue('-12.440000');
  await ctx.close();
});
