// Base REAL de poços da UO-BA embutida no app (src/data/pocos-ba.json, gerada por `npm run pocos`).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, openTab } = require('./helpers');

// A base real não vai para o GitHub (.gitignore): num clone novo estes testes são pulados
const REAL_FILE = path.join(__dirname, '..', 'src', 'data', 'pocos-ba.json');
const real = fs.existsSync(REAL_FILE) ? JSON.parse(fs.readFileSync(REAL_FILE, 'utf8')) : { total: 0, pocos: [] };
const REGIAO = { latMin: -18.5, latMax: -9.0, lngMin: -46.7, lngMax: -36.8 };

test.describe('base real UO-BA', () => {
  test.skip(!real.total, 'Base real ainda não gerada (npm run pocos -- arquivo.csv)');

  test('arquivo tem os poços com coordenadas dentro da BA/SE e sem nomes repetidos', () => {
    expect(real.total).toBe(real.pocos.length);
    expect(new Set(real.pocos.map((p) => p[0])).size).toBe(real.total);
    const fora = real.pocos.filter(([, lat, lng]) => lat < REGIAO.latMin || lat > REGIAO.latMax || lng < REGIAO.lngMin || lng > REGIAO.lngMax);
    expect(fora).toEqual([]);
  });

  test('app carrega a base real: contagem em Configurações e autocompletar preenche as coordenadas', async () => {
    const ctx = await launchApp(); // sem BDOE_POCOS_FILE: usa a base embutida real
    const { page } = ctx;
    const total = real.total.toLocaleString('pt-BR');
    const [nome, lat, lng] = real.pocos[0];

    await openTab(page, 'settings');
    await expect(page.locator('[data-pocos-count]')).toHaveText(`${total} poços carregados`);
    await expect(page.locator('[data-pocos-status]')).toContainText('Base padrão do app');

    await openTab(page, 'bdo');
    await expect(page.locator('[data-pocos-hint]')).toContainText(`${total} poços`);
    await page.locator('[data-field=poco]').fill(nome);
    await expect(page.locator('.combo__opt').first()).toContainText(nome);
    await page.locator('.combo__opt').first().click();
    await expect(page.locator('[data-field=poco]')).toHaveValue(nome);
    await expect(page.locator('[data-part=lat]')).toHaveValue(lat.toFixed(6));
    await expect(page.locator('[data-part=lng]')).toHaveValue(lng.toFixed(6));
    await ctx.close();
  });
});
