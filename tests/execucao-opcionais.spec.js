// Relatório de Execução: Pendências críticas e Assinatura são opcionais; sem pendências, o bloco não sai no relatório.
const { test, expect } = require('@playwright/test');
const { launchApp, fill, openTab } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('finaliza sem pendências e sem assinatura; a prévia e o PDF não mostram pendências vazias', async () => {
  const { page } = ctx;
  await openTab(page, 'handover');
  await fill(page, 'poco', 'OPC-1');
  await page.locator('[data-field=poco]').press('Tab');
  await page.waitForTimeout(500); // consolidação ao mudar o poço redesenha partes do formulário
  await page.locator('[data-field=tipo_passagem]').selectOption({ index: 1 });
  await page.locator('[data-field=status_poco]').selectOption({ index: 1 });
  await fill(page, 'servico_executado', 'VC: troca da válvula');
  await fill(page, 'responsavel_entrega', 'Ana');
  await fill(page, 'matricula_entrega', '123');
  await fill(page, 'responsavel_recebe', 'Bia');
  await page.locator('[data-field=liberado][value=Sim]').check();
  if (!(await page.locator('[data-table=equipe][data-row="0"][data-col=nome]').count())) await page.locator('[data-action=add-row][data-table=equipe]').click();
  await page.locator('[data-table=equipe][data-row="0"][data-col=nome]').fill('João');
  await page.locator('[data-table=equipe][data-row="0"][data-col=nome]').press('Tab');
  await page.locator('[data-field=responsavel_recebe]').press('Tab');

  // nem pendências nem assinatura contam como obrigatórios
  await expect(page.locator('#ready-status')).toContainText('Pronto para finalizar');
  await expect(page.locator('[data-wrap=pendencias_criticas] .req, [data-wrap=assinatura] .req')).toHaveCount(0);

  await page.locator('#btn-finalize').click();
  const modal = page.locator('dialog.modal[open]');
  const corpo = modal.locator('.preview__section');
  await expect(corpo.filter({ hasText: 'Validação' }).first()).toBeVisible();
  await expect(corpo.filter({ hasText: 'Pendências críticas' })).toHaveCount(0);
  await expect(corpo.filter({ hasText: 'Assinatura do técnico' })).toHaveCount(0);

  // PDF (jsPDF) e Word do relatório finalizado também sem o bloco de pendências
  await modal.getByRole('button', { name: 'Não, só salvar no aparelho' }).click();
  await expect(page.locator('#toasts')).toContainText('memória local deste aparelho');
  const textos = await page.evaluate(async () => {
    const { reports } = await import('./src/core/outbox.js');
    const { getModule } = await import('./src/modules/index.js');
    const { buildDocxBlob } = await import('./src/ui/docx-doc.js');
    const r = (await reports())[0];
    const args = { module: getModule('handover'), uniqueId: r.uniqueId, data: r.data, photos: r.photos, company: r.data._empresa };
    const docx = new TextDecoder('latin1').decode(new Uint8Array(await (await buildDocxBlob(args)).arrayBuffer()));
    return { docx };
  });
  expect(textos.docx).toContain('VC: troca da v'); // a seção com dados sai
  expect(textos.docx).toMatch(/Respons.{1,2}vel que recebe/); // mesmo tipo de busca acha um rótulo acentuado
  expect(textos.docx).not.toMatch(/Pend.{1,2}ncias cr.{1,2}ticas/);
});
