// Base de poços: conversão do CSV e autocompletar do "Poço / Locação" com preenchimento das coordenadas.
// Usa uma base FICTÍCIA (tests/fixtures/pocos-teste.csv, poços "TST-…"), independente da base real.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, openTab } = require('./helpers');
const { parseFile, convertCsv, parseCoord, decode } = require('../src/shared/pocos-parser.js');

const REPORTS = ['bdo', 'visita_tecnica', 'handover'];
const FIXTURE_CSV = path.join(__dirname, 'fixtures', 'pocos-teste.csv');
const toast = (page) => page.locator('#toasts .toast').last();

/** Gera o JSON da base fictícia com o mesmo conversor usado em produção. */
function fixtureJson() {
  const { pocos } = parseFile(fs.readFileSync(FIXTURE_CSV), FIXTURE_CSV);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-pocos-')), 'pocos.json');
  fs.writeFileSync(file, JSON.stringify({ fonte: 'pocos-teste.csv', total: pocos.length, pocos }));
  return file;
}

test.describe('conversor CSV → JSON', () => {
  test('lê ; , vírgula decimal, graus/minutos/segundos, ignora inválidos e duplicados', () => {
    const r = convertCsv(decode(fs.readFileSync(FIXTURE_CSV)));
    expect(r.delim).toBe(';');
    expect(r.pocos.map((p) => p[0])).toEqual(['TST-001', 'TST-002', 'TST-010', 'TST-089', 'XYZ 7']);
    expect(r.pocos[0]).toEqual(['TST-001', -12.3524, -38.3791]); // a 1ª ocorrência prevalece
    const xyz = r.pocos.find((p) => p[0] === 'XYZ 7');
    expect(xyz[1]).toBeCloseTo(-12.352389, 5);
    expect(xyz[2]).toBeCloseTo(-38.379167, 5);
    expect(r.problems.some((p) => p.includes('TST-003') && p.includes('coordenada inválida'))).toBe(true);
    expect(r.problems.some((p) => p.includes('duplicado'))).toBe(true);
  });

  test('aceita outros formatos de coordenada', () => {
    expect(parseCoord('-12.3524')).toBeCloseTo(-12.3524, 6);
    expect(parseCoord('-12,3524')).toBeCloseTo(-12.3524, 6);
    expect(parseCoord('12 21 08.6 S')).toBeCloseTo(-12.352389, 5);
    expect(parseCoord('38°22\'45"O')).toBeCloseTo(-38.379167, 5); // O = Oeste
    expect(Number.isNaN(parseCoord(''))).toBe(true);
  });

  test('o arquivo src/data/pocos-ba.json é válido (se existir — não é publicado no GitHub)', () => {
    const file = path.join(__dirname, '..', 'src', 'data', 'pocos-ba.json');
    test.skip(!fs.existsSync(file), 'base real não presente neste computador');
    const real = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Array.isArray(real.pocos)).toBe(true);
    expect(real.total).toBe(real.pocos.length);
    const invalid = real.pocos.filter(([nome, lat, lng]) =>
      typeof nome !== 'string' || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180));
    expect(invalid).toEqual([]);
  });
});

test.describe('autocompletar do Poço / Locação', () => {
  let ctx;
  test.beforeEach(async () => { ctx = await launchApp({ env: { BDOE_POCOS_FILE: fixtureJson() } }); });
  test.afterEach(async () => { await ctx.close(); });

  for (const tab of REPORTS) {
    test(`${tab}: sugere poços ao digitar e preenche latitude/longitude ao escolher (teclado)`, async () => {
      const { page } = ctx;
      await openTab(page, tab);
      await expect(page.locator('[data-pocos-hint]')).toContainText('5 poços');
      const input = page.locator('[data-field=poco]');
      await input.fill('tst-00');
      const options = page.locator('.combo__opt');
      await expect(options).toHaveCount(2); // TST-001, TST-002
      await input.press('ArrowDown');
      await input.press('ArrowDown');
      await input.press('Enter');

      await expect(input).toHaveValue('TST-002');
      await expect(page.locator('.combo__list')).toBeHidden();
      await expect(page.locator('[data-part=lat]')).toHaveText('-12.360000');
      await expect(page.locator('[data-part=lng]')).toHaveText('-38.390000');
      await expect(page.locator('.geo__meta')).toContainText('cadastro oficial de poços (TST-002)');
    });
  }

  test('busca ignora hífen, espaço e maiúsculas; clique com o mouse também seleciona', async () => {
    const { page } = ctx;
    await openTab(page, 'bdo');
    await page.locator('[data-field=poco]').fill('tst89');
    await expect(page.locator('.combo__opt')).toHaveCount(1);
    await page.locator('.combo__opt').click();
    await expect(page.locator('[data-field=poco]')).toHaveValue('TST-089');
    await expect(page.locator('[data-part=lat]')).toHaveText('-12.380000');
    await expect(toast(page)).toContainText('cadastro oficial');
  });

  test('nome fora da base continua aceito (sem sugestões, sem coordenadas)', async () => {
    const { page } = ctx;
    await openTab(page, 'bdo');
    await page.locator('[data-field=poco]').fill('LOCACAO NOVA 1');
    await expect(page.locator('.combo__empty')).toContainText('Nenhum poço da base');
    await page.locator('[data-field=poco]').press('Escape');
    await expect(page.locator('[data-field=poco]')).toHaveValue('LOCACAO NOVA 1');
    await expect(page.locator('[data-part=lat]')).toHaveText('');
  });

  test('digitar o nome exato e sair do campo também preenche as coordenadas vazias', async () => {
    const { page } = ctx;
    await openTab(page, 'handover');
    await page.locator('[data-field=poco]').fill('TST-010');
    await page.locator('[data-field=poco]').press('Tab');
    await expect(page.locator('[data-part=lat]')).toHaveText('-12.370500');
  });

  test('coordenadas de GPS já capturadas não são trocadas sem confirmação', async () => {
    const { page } = ctx;
    await openTab(page, 'visita_tecnica');
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: -12.5, longitude: -38.5, accuracy: 6 } });
    });
    await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
    await expect(page.locator('[data-part=lat]')).toHaveText('-12.500000');

    await page.locator('[data-field=poco]').fill('TST-001');
    await page.locator('.combo__opt').first().click();
    const dialog = page.locator('dialog.modal--confirm[open]');
    await expect(dialog).toContainText('obtidas pelo GPS');
    await dialog.getByRole('button', { name: 'Manter as atuais' }).click();
    await expect(page.locator('[data-part=lat]')).toHaveText('-12.500000');
    await expect(page.locator('[data-field=poco]')).toHaveValue('TST-001');

    await page.locator('[data-field=poco]').fill('TST-002');
    await page.locator('.combo__opt').first().click();
    await page.locator('dialog.modal--confirm[open]').getByRole('button', { name: 'Usar coordenadas do cadastro' }).click();
    await expect(page.locator('[data-part=lat]')).toHaveText('-12.360000');
  });

  test('após escolher o poço, o GPS pode registrar a posição, mas a rota continua indo até o poço', async () => {
    const { page } = ctx;
    await openTab(page, 'bdo');
    await page.locator('[data-field=poco]').fill('TST-001');
    await page.locator('.combo__opt').first().click();
    await expect(page.locator('[data-part=lat]')).toHaveText('-12.352400');
    await expect(page.locator('.geo__meta')).toContainText('cadastro oficial de poços');

    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: -12.351, longitude: -38.378, accuracy: 4 } });
    });
    await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
    const dlg = page.locator('dialog.modal--confirm[open]');
    if (await dlg.isVisible().catch(() => false)) await dlg.getByRole('button').last().click();
    await expect(page.locator('[data-part=lat]')).toHaveText('-12.351000');
    await expect(page.locator('.geo__meta')).toContainText('Capturado pelo GPS');
    // destino = poço da base, não a posição do aparelho
    await expect(page.locator('.geo__route')).toHaveAttribute('data-route-target', '-12.352400,-38.379100');
  });
});

test('sem base importada: o campo avisa e aceita digitação livre', async () => {
  const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-pocos-')), 'vazio.json');
  fs.writeFileSync(empty, JSON.stringify({ fonte: null, total: 0, pocos: [] }));
  const ctx = await launchApp({ env: { BDOE_POCOS_FILE: empty } });
  await openTab(ctx.page, 'bdo');
  await expect(ctx.page.locator('[data-pocos-hint]')).toContainText('Nenhuma base de poços carregada');
  await ctx.page.locator('[data-field=poco]').fill('FBM-89');
  await expect(ctx.page.locator('.combo__list')).toBeHidden();
  await expect(ctx.page.locator('[data-field=poco]')).toHaveValue('FBM-89');
  await ctx.close();
});
