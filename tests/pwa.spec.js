// PWA / GitHub Pages: arquivos de publicação e o app rodando como PÁGINA WEB (sem Electron),
// servido por HTTP local num subcaminho (/Projeto-BDO-e/), igual ao GitHub Pages — e sem a base de poços.
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const BASE = '/Projeto-BDO-e/';
const CSV = path.join(__dirname, 'fixtures', 'pocos-teste.csv');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

/** Servidor estático no estilo GitHub Pages: só o que é publicado (sem src/data, sem node_modules). */
function startPagesServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (!url.startsWith(BASE)) { res.writeHead(404); return res.end(); }
      let rel = url.slice(BASE.length) || 'index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(ROOT, rel);
      const blocked = rel.startsWith('src/data/') || rel.startsWith('node_modules/') || !file.startsWith(ROOT);
      if (blocked || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test.describe('arquivos de publicação', () => {
  test('sw.js está atualizado com todos os arquivos do app (npm run pwa)', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gerar-pwa.js'), '--check']);
  });

  test('manifest com caminhos relativos, ícones existentes e .nojekyll presente', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    expect(m.display).toBe('standalone');
    for (const icon of m.icons) {
      expect(icon.src.startsWith('./')).toBe(true);
      expect(fs.existsSync(path.join(ROOT, icon.src))).toBe(true);
    }
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(fs.existsSync(path.join(ROOT, '.nojekyll'))).toBe(true);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
    expect(refs.filter((r) => !r.startsWith('./'))).toEqual([]); // nada absoluto nem fora do projeto
    for (const r of refs) expect(fs.existsSync(path.join(ROOT, r))).toBe(true);
  });

  test('base real de poços não é publicada', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toContain('src/data/pocos-ba.json');
  });
});

test('app como página web (GitHub Pages): abre, funciona offline, importa base e imprime PDF', async () => {
  const server = await startPagesServer();
  const url = `http://127.0.0.1:${server.address().port}${BASE}`;
  const ctx = await launchApp(); // o Electron só serve de navegador aqui
  try {
    const [page] = await Promise.all([
      ctx.app.waitForEvent('window'),
      ctx.app.evaluate(({ BrowserWindow }, u) => {
        const w = new BrowserWindow({ show: false, width: 1280, height: 860, webPreferences: { sandbox: true, contextIsolation: true } });
        w.loadURL(u); // sem preload: igual a um navegador comum
      }, url)
    ]);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('#view[data-ready]').waitFor();
    expect(await page.evaluate(() => typeof window.desktop)).toBe('undefined');
    await expect(page.locator('#tabs [data-tab=bdo]')).toBeVisible();

    // Service Worker ativo e controlando a página
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.locator('#view[data-ready]').waitFor();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // Sem base publicada: o campo avisa e a importação funciona no navegador (mesmo parser do desktop)
    await page.locator('#tabs [data-tab=settings]').click();
    await page.locator('#view[data-ready=settings]').waitFor();
    await expect(page.locator('[data-pocos-count]')).toHaveText('Nenhuma base carregada');
    await page.locator('[data-pocos-input]').setInputFiles(CSV);
    await expect(page.locator('[data-pocos-count]')).toHaveText('Base Ativa: 5 poços carregados');

    await page.locator('#tabs [data-tab=bdo]').click();
    await page.locator('#view[data-ready=bdo]').waitFor();
    await page.locator('[data-field=poco]').fill('tst-01');
    await page.locator('.combo__opt').first().click();
    await expect(page.locator('[data-part=lat]')).toHaveValue('-12.370500');

    // PDF no navegador: abre o relatório formatado e chama a impressão ("Salvar como PDF")
    await page.evaluate(() => {
      const open = window.open.bind(window);
      window.open = (...args) => {
        const w = open(...args);
        w.print = () => { window.__printed = { title: w.document.title, styled: w.document.adoptedStyleSheets.length, text: w.document.body.innerText }; };
        return w;
      };
    });
    await page.locator('#btn-preview').click();
    await page.locator('dialog.modal[open] [data-pdf]').click();
    await expect.poll(() => page.evaluate(() => window.__printed || null)).not.toBeNull();
    const printed = await page.evaluate(() => window.__printed);
    expect(printed.styled).toBe(1);
    expect(printed.text).toContain('Boletim Diário Operacional Eletrônico');
    expect(printed.text).toContain('TST-010');
    await expect(page.locator('#toasts .toast').last()).toContainText('Salvar como PDF');

    // Offline: servidor fora do ar → o app abre pelo cache do Service Worker, com o rascunho salvo
    await page.waitForTimeout(400); // rascunho gravado
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
    await page.reload();
    await page.locator('#view[data-ready]').waitFor();
    await page.locator('#tabs [data-tab=bdo]').click();
    await page.locator('#view[data-ready=bdo]').waitFor();
    await expect(page.locator('[data-field=poco]')).toHaveValue('TST-010');
    expect(errors).toEqual([]);
  } finally {
    server.close();
    await ctx.close();
  }
});
