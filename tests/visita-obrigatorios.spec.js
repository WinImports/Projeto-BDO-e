// Visita Técnica — pedidos do gestor (nov/2026): fotos obrigatórias com janela do que falta, pressão de cada ponto
// ou o motivo de não ter medido, motivo obrigatório de válvula "Não testada", abertura / fechamento em VA / VB,
// sem "hora da leitura" e sem "estado do antipoço"; técnico envia só em Word (o PDF é do gestor).
const { test, expect } = require('@playwright/test');
const { launchApp, fill, openTab, preencherVisita, anexarFoto, cell } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('campos retirados e acrescentados no formulário da Visita', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('[data-field=hora_leitura]')).toHaveCount(0);
  await expect(page.locator('[data-field=estado_antepoco]')).toHaveCount(0);
  for (const p of ['vc', 'va1', 'va2', 'vb1', 'vb2']) await expect(page.locator(`[data-field=${p}_abertura]`)).toHaveCount(1);
  await expect(page.locator('[data-table=pressoes][data-col=motivo]')).toHaveCount(3);
  // nomenclatura: "parafuso" nos campos de medida, "prisioneiro" só na pergunta de baixo
  await expect(page.locator('[data-wrap=flange_sup_diametro]')).toContainText('Diâmetro do parafuso');
  await expect(page.locator('[data-wrap=flange_sup_prisioneiros]')).toContainText('Os parafusos são prisioneiros?');
  await expect(page.locator('[data-wrap=flange_inf_prisioneiros]')).toContainText('Os parafusos são prisioneiros?');
});

test('válvula "Não testada" abre o motivo obrigatório', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  const motivo = page.locator('[data-wrap=va1_motivo_nao_testada]');
  await expect(motivo).toBeHidden();
  await fill(page, 'va1_abertura', 'Não testada');
  await expect(motivo).toBeVisible();
  await preencherVisita(page, 'TST-MT');
  await anexarFoto(page, 'fotos_va1');
  await page.locator('#btn-finalize').click();
  const dlg = page.locator('dialog[data-pendencias][open]');
  await expect(dlg).toContainText('Motivo de não ter testado — Campo obrigatório');
  await dlg.locator('[data-ok]').click();
  await expect(page.locator('[data-wrap=va1_motivo_nao_testada].has-error')).toHaveCount(1);
  await fill(page, 'va1_motivo_nao_testada', 'Sem acesso ao volante');
  await fill(page, 'va1_abertura', 'Abre e fecha normalmente');
  await expect(motivo).toBeHidden();
  await fill(page, 'va1_abertura', 'Não testada');
  await page.locator('#btn-finalize').click();
  await expect(page.locator('dialog.modal[open] [data-confirm]')).toBeVisible(); // sem pendências: prévia de envio
});

test('pressão: cada ponto precisa da leitura ou do motivo; com leitura, a foto do manômetro é obrigatória', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, 'TST-PR');
  await cell(page, 'pressoes', 0, 'motivo').fill('');
  await cell(page, 'pressoes', 0, 'valor').fill('120');
  await cell(page, 'pressoes', 1, 'motivo').fill('');
  await page.locator('#btn-finalize').click();
  const dlg = page.locator('dialog[data-pendencias][open]');
  await expect(dlg).toContainText('Pressão — Anular superior — Informe a pressão ou o motivo de não ter medido');
  await expect(dlg).toContainText('Fotos dos manômetros (uma por medição) — Tire ou anexe ao menos uma foto');
  await expect(dlg).not.toContainText('Pressão — Coluna');
  await dlg.locator('[data-ok]').click();
  await cell(page, 'pressoes', 1, 'valor').fill('80');
  await anexarFoto(page, 'fotos_manometros');
  await page.locator('#btn-finalize').click();
  await expect(page.locator('dialog.modal[open] [data-confirm]')).toBeVisible();
});

test('fotos obrigatórias: chegada, antipoço e componente preenchido; componente em branco não exige', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, 'TST-FT', { fotos: false });
  await page.locator('#btn-finalize').click();
  const dlg = page.locator('dialog[data-pendencias][open]');
  for (const t of ['Placa do poço e conjunto / árvore de natal', 'Fotos — Antipoço', 'Fotos — VC', 'Fotos — Flange inferior']) {
    await expect(dlg).toContainText(`${t}`);
  }
  await expect(dlg).not.toContainText('Fotos — VA-1');
  await expect(dlg).toContainText('Faltam 4 itens');
});

test('técnico: mensagem do WhatsApp só com o Word; gestor recebe PDF e Word', async () => {
  const { page } = ctx;
  const r = await page.evaluate(async () => {
    const { shareMessage } = await import('./src/core/share.js');
    const mod = { title: 'Relatório de Visita Técnica' };
    const d = { poco: 'FBM-89', data: '2026-11-05' };
    return {
      tecnico: shareMessage(mod, d, 'abcdef12-0000', 'https://x/r.pdf', 'https://x/r.docx', { pdf: false }),
      gestor: shareMessage(mod, d, 'abcdef12-0000', 'https://x/r.pdf', 'https://x/r.docx')
    };
  });
  expect(r.tecnico).toContain('Relatório completo (Word .docx): https://x/r.docx');
  expect(r.tecnico).not.toContain('.pdf');
  expect(r.gestor).toContain('Relatório completo (PDF): https://x/r.pdf');
  expect(r.gestor).toContain('Versão Word (.docx): https://x/r.docx');
});
