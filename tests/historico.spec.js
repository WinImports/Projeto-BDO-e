// Histórico de relatórios: lista com tipo/poço/data/status, reabrir na prévia, gerar PDF,
// "Reutilizar / Editar como novo" e botões de navegação da prévia ("Voltar e editar", "Início / Novo relatório").
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
  await expect(item.locator('.status')).toHaveText('Aguardando envio');

  // servidor confirmou: sai da fila, continua no histórico como "Enviado"
  await confirmarEnvio(page);
  await expect(page.locator('#outbox-badge')).toBeHidden();
  await expect(item.locator('.status')).toHaveText('Enviado');
  await expect(item.locator('[data-action=edit]')).toHaveCount(0);

  // persiste ao reabrir o app
  await ctx.close({ keepData: true });
  ctx = await launchApp({ userData });
  await openTab(ctx.page, 'outbox');
  await expect(ctx.page.locator('[data-history] .outbox-item')).toContainText('FBM-89');
  await expect(ctx.page.locator('[data-history] .status')).toHaveText('Enviado');
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
  await expect(preview.getByRole('button', { name: 'Reutilizar / Editar como novo' })).toBeVisible();

  await preview.getByRole('button', { name: 'Gerar PDF / Imprimir' }).click();
  await expect(toast(page)).toContainText('PDF salvo', { timeout: 15_000 });
  expect(fs.statSync(pdfPath).size).toBeGreaterThan(5000);

  await preview.getByRole('button', { name: 'Voltar ao histórico' }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('#view[data-ready=outbox]')).toBeVisible();
});

test('"Reutilizar / Editar como novo" abre um rascunho novo com os dados (sem datas, fotos e assinatura)', async () => {
  const { page } = ctx;
  const idOriginal = await finalizarVisita(page);
  await openTab(page, 'outbox');
  await page.locator('[data-history] .outbox-item__main').click();
  await page.locator('dialog.modal[open]').getByRole('button', { name: 'Reutilizar / Editar como novo' }).click();

  await page.locator('#view[data-ready=visita_tecnica]').waitFor();
  await expect(page.locator('[data-field=poco]')).toHaveValue('FBM-89');
  await expect(page.locator('[data-table=equipe][data-row="0"][data-col=nome]')).toHaveValue('João');
  await expect(page.locator('[data-field=data]')).toHaveValue(hojeISO()); // data volta ao padrão (hoje)
  await expect(page.locator('.photo-grid img')).toHaveCount(0);
  await expect(page.locator('.doc-head__meta code')).not.toHaveText(idOriginal); // novo ID: não sobrescreve o original
  await expect(toast(page)).toContainText('Confira datas');

  // o original continua intacto no histórico
  await openTab(page, 'outbox');
  await expect(page.locator('[data-history] .outbox-item')).toHaveCount(1);

  // botão direto na lista também reutiliza (com confirmação, pois já há rascunho)
  await page.locator('[data-history] [data-action=reuse]').click();
  await page.locator('dialog.modal--confirm[open]').getByRole('button', { name: 'Substituir e reutilizar' }).click();
  await page.locator('#view[data-ready=visita_tecnica]').waitFor();
  await expect(page.locator('[data-field=poco]')).toHaveValue('FBM-89');
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
