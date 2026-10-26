// Histórico de relatórios: lista com tipo/poço/data/status, reabrir na prévia, gerar PDF,
// "Editar" (mesmo relatório, sem duplicar), gavetas por dia, filtro por data e botões de navegação da prévia ("Voltar e editar", "Início / Novo relatório").
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, fill, openTab, preencherVisita } = require('./helpers');

const toast = (page) => page.locator('#toasts .toast').last();
// PNG 1x1 (foto de teste)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const pad = (n) => String(n).padStart(2, '0');
const hojeBR = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Preenche e finaliza uma Visita Técnica com 1 foto. Devolve o ID curto exibido no cabeçalho. */
async function finalizarVisita(page, poco = 'FBM-89') {
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, poco);
  await page.locator('input[data-kind=photos]').first().setInputFiles({ name: 'cabeca.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.photo-grid img')).toHaveCount(1);
  await expect(page.locator('#ready-status')).toContainText('Pronto para finalizar');
  const id = await page.locator('.doc-head__meta code').innerText();
  await page.locator('#btn-finalize').click();
  await page.locator('dialog.modal[open] [data-confirm]').click();
  await expect(toast(page)).toContainText('Caixa de Saída');
  // o aviso e o data-ready podem ser os da finalização ANTERIOR: só o rascunho novo (outro ID) prova que terminou
  await expect(page.locator('.doc-head__meta code')).not.toHaveText(id);
  await page.locator('#view[data-ready=visita_tecnica]').waitFor();
  return id;
}

/** Simula a confirmação do servidor para todos os itens da fila. */
async function confirmarEnvio(page) {
  await page.evaluate(async () => {
    const outbox = await import('./src/core/outbox.js');
    for (const r of await outbox.list()) await outbox.confirmDelivered(r.uniqueId);
  });
}

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('relatório finalizado fica no Histórico mesmo depois de enviado, com tipo, poço, data e status', async () => {
  const { page, userData } = ctx;
  await finalizarVisita(page);
  await openTab(page, 'outbox');
  const item = page.locator('[data-history] .outbox-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Visita');
  await expect(item).toContainText('FBM-89');
  await expect(item).toContainText(`Relatório de ${hojeBR()}`);
  await expect(item).toContainText('1 foto');
  await expect(item.locator('.status')).toHaveText('Pendente de Envio');

  // servidor confirmou: sai da fila, continua no histórico como "Sincronizado"
  await confirmarEnvio(page);
  await expect(page.locator('#outbox-badge')).toBeHidden();
  await expect(item.locator('.status')).toHaveText('Sincronizado');
  // relatório enviado continua editável: a versão nova substitui a anterior (sem duplicar)
  await expect(item.locator('[data-action=edit]')).toHaveCount(1);
  await expect(item.locator('[data-action=reuse]')).toHaveCount(0); // um botão só nos relatórios do aparelho

  // persiste ao reabrir o app
  await ctx.close({ keepData: true });
  ctx = await launchApp({ userData });
  await openTab(ctx.page, 'outbox');
  await expect(ctx.page.locator('[data-history] .outbox-item')).toContainText('FBM-89');
  await expect(ctx.page.locator('[data-history] .status')).toHaveText('Sincronizado');
});

test('tocar no relatório salvo abre a prévia completa (com fotos) e gera o PDF', async () => {
  const { app, page, userData } = ctx;
  const pdfPath = path.join(userData, 'historico.pdf');
  await app.evaluate(({ dialog, shell }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    shell.openPath = async () => '';
  }, pdfPath);

  await finalizarVisita(page);
  await confirmarEnvio(page); // fotos continuam guardadas no histórico após o envio
  await openTab(page, 'outbox');
  await page.locator('[data-history] .outbox-item__main').click();

  const preview = page.locator('dialog.modal[open]');
  await expect(preview.locator('.eyebrow')).toHaveText('Relatório salvo neste aparelho');
  await expect(preview.locator('.modal__header')).toContainText('FBM-89');
  await expect(preview.locator('.modal__body')).toContainText('João');
  await expect(preview.locator('.photo-grid img')).toHaveCount(1);
  await expect(preview.getByRole('button', { name: 'Voltar ao histórico' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Editar este relatório' })).toBeVisible();

  await preview.getByRole('button', { name: 'Baixar / Compartilhar PDF' }).click();
  await expect(toast(page)).toContainText('PDF salvo', { timeout: 15_000 });
  expect(fs.statSync(pdfPath).size).toBeGreaterThan(5000);

  await preview.getByRole('button', { name: 'Voltar ao histórico' }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('#view[data-ready=outbox]')).toBeVisible();
});

test('"Editar" abre o MESMO relatório (mesmo ID, dados e fotos); ao finalizar substitui a versão anterior, sem duplicar', async () => {
  const { page } = ctx;
  const idOriginal = await finalizarVisita(page);
  await openTab(page, 'outbox');
  await page.locator('[data-history] .outbox-item__main').click();
  await page.locator('dialog.modal[open]').getByRole('button', { name: 'Editar este relatório' }).click();

  await page.locator('#view[data-ready=visita_tecnica]').waitFor();
  await expect(page.locator('.doc-head__meta code')).toHaveText(idOriginal); // mesmo ID: atualiza, não cria outro
  await expect(page.locator('[data-atualizando]')).toContainText('versão 2');
  await expect(page.locator('[data-field=poco]')).toHaveValue('FBM-89');
  await expect(page.locator('[data-table=equipe][data-row="0"][data-col=nome]')).toHaveValue('João');
  await expect(page.locator('.photo-grid img')).toHaveCount(1); // as fotos vêm junto
  await expect(toast(page)).toContainText('substitui a anterior');

  // corrige um dado e finaliza de novo: continua UM relatório no Histórico, agora na versão 2
  await fill(page, 'campo', 'Campo de Buracica');
  await page.locator('#btn-finalize').click();
  await page.locator('dialog.modal[open] [data-confirm]').click();
  await expect(page.locator('.doc-head__meta code')).not.toHaveText(idOriginal);
  await openTab(page, 'outbox');
  const itens = page.locator('[data-history] .outbox-item');
  await expect(itens).toHaveCount(1);
  await expect(itens).toContainText(idOriginal);
  await expect(itens.locator('[data-versao]')).toHaveText('versão 2');
  const fila = await page.evaluate(async () => (await import('./src/core/outbox.js')).list());
  expect(fila).toHaveLength(1);
  expect(fila[0].data.campo).toBe('Campo de Buracica');

  // botão direto na lista: com outro rascunho em andamento, pede confirmação antes de substituir
  await openTab(page, 'visita_tecnica');
  await fill(page, 'poco', 'RASCUNHO-NOVO');
  await openTab(page, 'outbox');
  await page.locator('[data-history] [data-action=edit]').click();
  await page.locator('dialog.modal--confirm[open]').getByRole('button', { name: 'Substituir e atualizar' }).click();
  await page.locator('#view[data-ready=visita_tecnica]').waitFor();
  await expect(page.locator('.doc-head__meta code')).toHaveText(idOriginal);
  await expect(page.locator('[data-atualizando]')).toContainText('versão 3');
});

test('Histórico em gavetas por dia: a do dia mais recente aberta, as antigas recolhidas; filtro por data', async () => {
  const { page } = ctx;
  await finalizarVisita(page, 'FBM-89');
  // um relatório antigo (outro dia) direto no histórico do aparelho
  await page.evaluate(async () => {
    const { saveLocalOnly } = await import('./src/core/outbox.js');
    await saveLocalOnly({ uniqueId: crypto.randomUUID(), module: 'bdo', data: { poco: 'RCB-34', data: '2026-01-15' }, photos: [] });
  });
  await openTab(page, 'outbox');
  const dias = page.locator('[data-history] .history-day');
  await expect(dias).toHaveCount(2);
  await expect(dias.first()).toHaveAttribute('data-history-day', hojeISO());
  await expect(dias.first()).toHaveAttribute('open', '');
  await expect(dias.first().locator('.history-day__rel')).toHaveText('Hoje');
  // o antigo não foi enviado: a gaveta abre sozinha para chamar atenção
  const antigo = page.locator('[data-history-day="2026-01-15"]');
  await expect(antigo).toHaveAttribute('open', '');
  await expect(antigo.locator('.history-day__pend')).toHaveText('1 a enviar');
  await expect(antigo.locator('summary')).toContainText('15/01/2026');

  // fechar a gaveta: fica fechada mesmo quando a lista é redesenhada
  await antigo.locator('summary').click();
  await expect(antigo).not.toHaveAttribute('open', '');
  await page.evaluate(async () => (await import('./src/core/outbox.js')).notifyHistory());
  await expect(page.locator('[data-history-day="2026-01-15"]')).not.toHaveAttribute('open', '');

  // filtro por data: só o dia escolhido, com a gaveta aberta
  await page.locator('[data-history-date]').fill('2026-01-15');
  await expect(dias).toHaveCount(1);
  await expect(page.locator('[data-history-day="2026-01-15"]')).toHaveAttribute('open', '');
  await expect(page.locator('[data-history-count]')).toContainText('15/01/2026');
  await page.locator('[data-history-date]').fill('2025-12-31');
  await expect(page.locator('[data-history-empty]')).toContainText('31/12/2025');
  await page.locator('[data-action=clear-date]').click();
  await expect(dias).toHaveCount(2);
});

test('prévia: "Voltar e editar" mantém os dados; "Início / Novo relatório" limpa e volta ao topo', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await fill(page, 'poco', 'RCB-34');
  await fill(page, 'cidade_uf', 'Catu - BA');

  const preview = page.locator('dialog.modal[open]');
  await page.locator('#btn-preview').click();
  await expect(preview.locator('.modal__nav')).toBeVisible();
  await preview.getByRole('button', { name: 'Voltar e editar' }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-34');

  // pede confirmação; "Continuar editando" mantém tudo
  await page.locator('#btn-preview').click();
  await preview.getByRole('button', { name: 'Início / Novo relatório' }).click();
  await page.locator('dialog.modal--confirm[open]').getByRole('button', { name: 'Continuar editando' }).click();
  await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-34');

  await page.locator('#btn-preview').click();
  await preview.getByRole('button', { name: 'Início / Novo relatório' }).click();
  await page.locator('dialog.modal--confirm[open]').getByRole('button', { name: 'Limpar e começar novo' }).click();
  await expect(page.locator('[data-field=poco]')).toHaveValue('');
  await page.locator('#view[data-ready=bdo]').waitFor();
  await expect(page.locator('[data-field=cidade_uf]')).toHaveValue('');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('filtro por tipo de relatório no Histórico', async () => {
  const { page } = ctx;
  await finalizarVisita(page, 'FBM-89');
  await finalizarVisita(page, 'RCB-34');
  await openTab(page, 'outbox');
  await expect(page.locator('[data-history] .outbox-item')).toHaveCount(2);
  await expect(page.locator('[data-history] .outbox-item').first()).toContainText('RCB-34'); // mais recente primeiro
  await page.locator('[data-filter=bdo]').click();
  await expect(page.locator('[data-history]')).toHaveCount(0);
  await expect(page.locator('#view')).toContainText('Nenhum relatório deste tipo');
  await page.locator('[data-filter=visita_tecnica]').click();
  await expect(page.locator('[data-history] .outbox-item')).toHaveCount(2);
  await page.locator('[data-filter=all]').click();
});
