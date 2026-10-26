// Uso no celular: seletores nativos de data/hora e alvos de toque nas tabelas dinâmicas.
const { test, expect } = require('@playwright/test');
const { launchApp, openTab } = require('./helpers');

// campos de data/hora de cada relatório → tipo nativo esperado
const NATIVE = {
  bdo: {
    '[data-field=data]': 'date',
    '[data-table=atividades][data-col=data_inicio]': 'date',
    '[data-table=atividades][data-col=hora_inicio]': 'time',
    '[data-table=atividades][data-col=data_fim]': 'date',
    '[data-table=atividades][data-col=hora_fim]': 'time',
    '[data-table=paradas][data-col=inicio]': 'time',
    '[data-table=paradas][data-col=fim]': 'time'
  },
  visita_tecnica: {
    '[data-field=data]': 'date',
    '[data-field=hora_leitura]': 'time'
  },
  handover: {
    '[data-field=data_hora]': 'datetime-local',
    '[data-field=periodo_inicio]': 'date',
    '[data-field=periodo_fim]': 'date'
  }
};

// 44 px de alvo de toque; tolerância para arredondamento de subpixel da tela (ex.: 43,99997)
const TOUCH = 43.5;

let ctx;
test.beforeEach(async () => {
  ctx = await launchApp();
  // janela do tamanho de um celular (iPhone 14 / Android médio)
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(320, 480); // a janela desktop tem mínimo de 900 px
    win.setContentSize(390, 844);
  });
  await ctx.page.waitForFunction(() => window.innerWidth <= 400);
});
test.afterEach(async () => { await ctx.close(); });

test('datas e horas usam os seletores nativos (date / time / datetime-local) nos 3 relatórios', async () => {
  const { page } = ctx;
  for (const [tab, fields] of Object.entries(NATIVE)) {
    await openTab(page, tab);
    for (const [sel, type] of Object.entries(fields)) {
      await expect(page.locator(sel).first(), `${tab} ${sel}`).toHaveAttribute('type', type);
    }
    // nenhum campo de data/hora digitado como texto livre
    const textual = await page.$$eval('input[type=text]', (els) => els
      .map((e) => e.dataset.field || e.dataset.col || '')
      .filter((n) => /^(data|hora|periodo|inicio|fim)(_|$)/.test(n)));
    expect(textual, tab).toEqual([]);
  }
});

test('tabelas dinâmicas: Adicionar e Remover com alvo de toque ≥ 44 px e bem espaçados', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  for (const table of ['atividades', 'paradas', 'materiais']) {
    const add = page.locator(`[data-action=add-row][data-table=${table}]`);
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await add.click();
    const addBox = await add.boundingBox();
    expect(addBox.height, `${table}: altura do Adicionar`).toBeGreaterThanOrEqual(TOUCH);

    const removes = page.locator(`[data-action=remove-row][data-table=${table}]`);
    await expect(removes).toHaveCount(3);
    const boxes = [];
    for (let i = 0; i < 3; i++) {
      await removes.nth(i).scrollIntoViewIfNeeded();
      boxes.push(await removes.nth(i).boundingBox());
    }
    for (const b of boxes) {
      expect(b.width, `${table}: largura do Remover`).toBeGreaterThanOrEqual(TOUCH);
      expect(b.height, `${table}: altura do Remover`).toBeGreaterThanOrEqual(TOUCH);
    }
    // espaço entre os botões de remover de linhas vizinhas (evita tocar no errado)
    for (let i = 1; i < boxes.length; i++) {
      const gap = boxes[i].y - (boxes[i - 1].y + boxes[i - 1].height);
      expect(gap, `${table}: espaço entre Remover`).toBeGreaterThanOrEqual(8);
    }
    // e o Adicionar fica separado da última linha
    const lastRemove = boxes[boxes.length - 1];
    const addAfter = await add.boundingBox();
    expect(addAfter.y - (lastRemove.y + lastRemove.height), `${table}: espaço até o Adicionar`).toBeGreaterThanOrEqual(8);

    await removes.first().click();
    await expect(removes).toHaveCount(2);
  }
});

test('sem rolagem lateral da página e botões do rodapé com rótulo legível no celular', async () => {
  const { page } = ctx;
  for (const tab of ['bdo', 'visita_tecnica', 'handover', 'outbox', 'settings']) {
    await openTab(page, tab);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw, `${tab}: largura da página`).toBeLessThanOrEqual(cw);
  }
  await openTab(page, 'bdo');
  await expect(page.locator('#btn-preview')).toHaveText('Prévia', { useInnerText: true });
  await expect(page.locator('#btn-finalize')).toHaveText('Salvar e Finalizar', { useInnerText: true });
});

test('campos de data/hora com altura confortável para toque', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  for (const sel of ['[data-field=data]', '[data-table=atividades][data-col=hora_inicio]']) {
    const box = await page.locator(sel).first().boundingBox();
    expect(box.height, sel).toBeGreaterThanOrEqual(TOUCH);
  }
});

test('atividade do BDO no celular: tocar abre o editor ampliado com o texto inteiro; Enter conclui e grava na tabela', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  const cel = page.locator('[data-table=atividades][data-row="0"][data-col=atividade]');
  await expect(cel).toHaveAttribute('data-expand', '');
  await expect(cel).toHaveAttribute('aria-label', /Atividade/);
  const antes = await page.evaluate(() => window.scrollX);
  await cel.click();
  const editor = page.locator('dialog.modal--texto[open]');
  await expect(editor).toContainText('Atividade executada');
  const area = editor.locator('textarea');
  await expect(area).toBeFocused();
  const texto = 'Retirada dos parafusos de 1 3/8" do flange da cabeça de revestimento e limpeza das roscas';
  await area.fill(texto);
  // a caixa mostra o texto inteiro (quebra linha, sem rolagem lateral)
  expect(await area.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await area.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(cel).toHaveValue(texto);
  expect(await page.evaluate(() => window.scrollX)).toBe(antes);
  // gravado no rascunho (o resumo automático já usa o texto)
  await expect(page.locator('[data-field=resumo_atividades], [data-autotext-status]').first()).toBeVisible();
  const salvo = await page.evaluate(async () => {
    const { STORES, get } = await import('./src/core/db.js');
    for (let i = 0; i < 20; i++) {
      const d = await get(STORES.drafts, 'bdo');
      const v = d?.data?.atividades?.[0]?.atividade;
      if (v) return v;
      await new Promise((r) => setTimeout(r, 200));
    }
    return '';
  });
  expect(salvo).toBe(texto);
});
