// Atualização do banco local de computadores que já usavam a versão anterior (v1 → v2 com histórico).
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, openTab } = require('./helpers');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const CRIAR_V1 = path.join(__dirname, 'support', 'criar-banco-v1');

test('banco v1 existente é atualizado para v2 sem perder nada', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-v1-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(ELECTRON, [CRIAR_V1, userData], { env });

  const ctx = await launchApp({ userData });
  const { page } = ctx;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('#outbox-badge')).toHaveText('1'); // fila antiga preservada
  const hist = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('bdo-e');
    req.onsuccess = () => {
      const r = req.result;
      const g = r.transaction('history').objectStore('history').getAll();
      g.onsuccess = () => resolve({ version: r.version, items: g.result.map((x) => x.uniqueId) });
    };
  }));
  expect(hist.version).toBe(2);
  expect(hist.items).toEqual(['antigo-1']);

  await openTab(page, 'handover');
  await expect(page.locator('[data-field=poco]')).toHaveValue('TST-V1'); // rascunho BA migrado
  await expect(page.locator('[data-consol]')).toContainText('Registro da versão antiga'); // entrou na consolidação
  expect(errors).toEqual([]);
  await ctx.close();
});
