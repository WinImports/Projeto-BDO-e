// Fluxo local (offline): regras BA/SE, salvar, reabrir, limpar, prévia/PDF, finalizar e editar.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, fill, openTab } = require('./helpers');

const toast = (page) => page.locator('#toasts .toast').last();

test.describe('rascunhos por relatório', () => {
  let ctx;
  test.beforeEach(async () => { ctx = await launchApp(); });
  test.afterEach(async () => { await ctx.close(); });

  test('cada aba de relatório tem o seu próprio rascunho', async () => {
    const { page } = ctx;
    await openTab(page, 'bdo');
    await fill(page, 'poco', 'FBM-89');
    await openTab(page, 'handover');
    await expect(page.locator('[data-field=poco]')).toHaveValue('');
    await openTab(page, 'bdo');
    await expect(page.locator('[data-field=poco]')).toHaveValue('FBM-89');
  });

  test('rascunho antigo (gravado por base BA/SE) é migrado e aparece na aba', async () => {
    const { page } = ctx;
    await openTab(page, 'visita_tecnica');
    // simula um rascunho salvo pela versão anterior, com a base na chave
    await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('bdo-e');
      req.onsuccess = () => {
        const tx = req.result.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put({ key: 'SE:bdo', uniqueId: crypto.randomUUID(), base: 'SE', module: 'bdo', data: { poco: 'LEGADO-SE' }, photos: [], updatedAt: new Date().toISOString() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    }));
    await openTab(page, 'bdo');
    await expect(page.locator('[data-field=poco]')).toHaveValue('LEGADO-SE');
  });
});

test.describe('salvamento local', () => {
  test('Salvar rascunho confirma e os dados sobrevivem ao reabrir o app', async () => {
    let ctx = await launchApp();
    let { page } = ctx;
    await openTab(page, 'bdo');
    await fill(page, 'poco', 'RCB-34');
    await fill(page, 'cidade_uf', 'Catu - BA');
    await page.locator('#btn-save').click();
    await expect(toast(page)).toContainText('Rascunho salvo');
    await expect(page.locator('#draft-status')).toContainText('Salvo neste computador');
    await ctx.close({ keepData: true });

    ctx = await launchApp({ userData: ctx.userData });
    page = ctx.page;
    await openTab(page, 'bdo');
    await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-34');
    await expect(page.locator('[data-field=cidade_uf]')).toHaveValue('Catu - BA');
    await ctx.close();
  });

  test('fechar a janela logo após digitar não perde o último dado', async () => {
    let ctx = await launchApp();
    await openTab(ctx.page, 'bdo');
    await fill(ctx.page, 'poco', 'FAV-117');
    await ctx.close({ keepData: true }); // fecha imediatamente, antes do salvamento automático

    ctx = await launchApp({ userData: ctx.userData });
    await openTab(ctx.page, 'bdo');
    await expect(ctx.page.locator('[data-field=poco]')).toHaveValue('FAV-117');
    await ctx.close();
  });

  test('Limpar formulário pede confirmação no diálogo do app', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    await openTab(page, 'bdo');
    await fill(page, 'poco', 'RCB-04');

    await page.locator('#btn-discard').click();
    const dialog = page.locator('dialog.modal--confirm[open]');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-cancel]').click();
    await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-04');

    await page.locator('#btn-discard').click();
    await page.locator('dialog.modal--confirm[open] [data-ok]').click();
    await expect(page.locator('[data-field=poco]')).toHaveValue('');
    await expect(toast(page)).toContainText('Formulário limpo');
    await ctx.close();
  });
});

test.describe('prévia, PDF, finalizar e editar', () => {
  let ctx;
  test.beforeEach(async () => { ctx = await launchApp(); });
  test.afterEach(async () => { await ctx.close(); });

  test('prévia avisa pendências e blocos vazios; PDF é gerado', async () => {
    const { app, page, userData } = ctx;
    const pdfPath = path.join(userData, 'teste.pdf');
    // evita a janela "Salvar como" e a abertura do leitor de PDF
    await app.evaluate(({ dialog, shell }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
      shell.openPath = async () => '';
    }, pdfPath);

    await openTab(page, 'bdo');
    await fill(page, 'poco', 'FBM-78');
    await page.locator('#btn-preview').click();
    const preview = page.locator('dialog.modal[open]');
    await expect(preview.locator('.notice--warn')).toContainText('obrigatório');
    await expect(preview.locator('.notice--info')).toContainText('Paradas');

    await preview.locator('[data-pdf]').click();
    await expect(toast(page)).toContainText('PDF salvo', { timeout: 15_000 });
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(10_000);
  });

  test('finalizar envia para a Caixa de Saída; Editar devolve ao formulário com tudo preenchido', async () => {
    const { page } = ctx;
    await openTab(page, 'visita_tecnica');
    await fill(page, 'poco', 'FBM-89');
    await fill(page, 'turno', 'Diurno');
    await fill(page, 'frente', 'Equipe 02');
    await fill(page, 'tecnicos', 'João');
    await fill(page, 'cliente', 'PETROBRAS');
    await fill(page, 'status_locacao', 'OK');
    await fill(page, 'estado_antepoco', 'Limpo');
    await page.locator('[data-table=valvulas][data-row="4"][data-col=status]').selectOption('Vazamento / Sem Estanqueidade');
    await page.locator('[data-table=fixadores][data-row="0"][data-col=status]').selectOption('Oxidado');
    await expect(page.locator('#ready-status')).toContainText('Pronto para finalizar');

    await page.locator('#btn-finalize').click();
    await page.locator('dialog.modal[open] [data-confirm]').click();
    await expect(toast(page)).toContainText('Caixa de Saída');
    await expect(page.locator('#outbox-badge')).toHaveText('1');
    await expect(page.locator('[data-field=poco]')).toHaveValue(''); // novo relatório em branco

    await openTab(page, 'outbox');
    await page.locator('[data-action=edit]').click();
    await page.locator('#view[data-ready=visita_tecnica]').waitFor();
    await expect(page.locator('#tabs .tab.is-active')).toHaveAttribute('data-tab', 'visita_tecnica');
    await expect(page.locator('[data-field=poco]')).toHaveValue('FBM-89');
    // tabela com linhas fixas reconstruída: VM no lugar certo, demais válvulas vazias
    await expect(page.locator('[data-wrap=valvulas] .cell--locked')).toHaveCount(7);
    await expect(page.locator('[data-table=valvulas][data-row="4"][data-col=status]')).toHaveValue('Vazamento / Sem Estanqueidade');
    await expect(page.locator('#outbox-badge')).toBeHidden();

    await fill(page, 'frente', 'Equipe 03');
    await page.locator('#btn-finalize').click();
    await page.locator('dialog.modal[open] [data-confirm]').click();
    await expect(page.locator('#outbox-badge')).toHaveText('1');
  });
});

test('tema escuro aplica-se também aos diálogos', async () => {
  const ctx = await launchApp();
  const { page } = ctx;
  await page.locator('#theme-toggle').click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await openTab(page, 'bdo');
  await page.locator('#btn-discard').click();
  const bg = await page.locator('dialog.modal--confirm[open]').evaluate((d) => getComputedStyle(d).backgroundColor);
  const expected = theme === 'dark' ? 'rgb(17, 26, 42)' : 'rgb(255, 255, 255)';
  expect(bg).toBe(expected);
  await ctx.close();
});
