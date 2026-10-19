// PWA / GitHub Pages: arquivos de publicação e o app rodando como PÁGINA WEB (sem Electron),
// servido por HTTP local num subcaminho (/Projeto-BDO-e/), igual ao GitHub Pages — e sem a base de poços.
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchApp, preencherVisita } = require('./helpers');

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
    await expect(page.locator('[data-part=lat]')).toHaveText('-12.370500');
    // rota até o poço também no navegador (PWA): aviso com o poço como DESTINO
    const rota = page.locator('.route-prompt[data-route-prompt=poco]');
    await expect(rota).toContainText('TST-010');
    await expect(rota.locator('[data-route-link=google]')).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=-12.370500,-38.401200&travelmode=driving');
    await rota.getByRole('button', { name: 'Agora não' }).click();

    // PDF no navegador / iPhone: arquivo PDF gerado no aparelho (jsPDF) + painel "PDF pronto" com
    // Compartilhar / Salvar em Arquivos (Web Share), Baixar e Imprimir — sem janela nova (o iOS bloqueia)
    await page.evaluate(() => {
      window.open = () => { window.__popup = true; return null; };
      navigator.canShare = (d) => Boolean(d?.files?.length);
      navigator.share = async (d) => {
        const f = d.files[0];
        const raw = new TextDecoder('latin1').decode(await f.arrayBuffer());
        window.__shared = { title: d.title, name: f.name, type: f.type, size: f.size, head: raw.slice(0, 5), uris: [...raw.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1]) };
      };
      window.print = () => {
        const root = document.getElementById('print-root');
        window.__printed = { title: document.title, styled: document.adoptedStyleSheets.length, text: root ? root.textContent : '' };
      };
    });
    await page.locator('#btn-preview').click();
    await page.locator('dialog.modal[open] [data-pdf]').click();
    const sheet = page.locator('dialog[data-pdf-sheet][open]');
    await expect(sheet).toContainText('PDF pronto');
    await expect(sheet.locator('[data-download]')).toHaveAttribute('download', /^BDO-e_TST-010_.*\.pdf$/);
    await sheet.getByRole('button', { name: 'Compartilhar / Salvar em Arquivos' }).click();
    await expect.poll(() => page.evaluate(() => window.__shared || null), { timeout: 20_000 }).not.toBeNull();
    const shared = await page.evaluate(() => window.__shared);
    expect(shared.type).toBe('application/pdf');
    expect(shared.head).toBe('%PDF-');
    expect(shared.name).toMatch(/^BDO-e_TST-010_.*\.pdf$/);
    expect(shared.uris).toContain('https://www.google.com/maps/dir/?api=1&destination=-12.370500,-38.401200&travelmode=driving');
    expect(await page.evaluate(() => window.__popup || false)).toBe(false);

    // "Imprimir" continua disponível no painel (impressão dentro da própria página)
    await page.locator('dialog.modal[open] [data-pdf]').click();
    await sheet.getByRole('button', { name: 'Imprimir' }).click();
    await expect.poll(() => page.evaluate(() => window.__printed || null)).not.toBeNull();
    const printed = await page.evaluate(() => window.__printed);
    expect(printed.styled).toBeGreaterThanOrEqual(1);
    expect(printed.title).toMatch(/^BDO-e_TST-010_/); // nome sugerido do arquivo
    expect(printed.text).toContain('Boletim Diário Operacional Eletrônico');
    expect(printed.text).toContain('TST-010');

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

test('PWA: relatório finalizado fica no Histórico do navegador, reabre na prévia e imprime o PDF', async () => {
  test.setTimeout(150_000); // página servida por HTTP + Service Worker + recarga: mais lento que os demais
  const server = await startPagesServer();
  const url = `http://127.0.0.1:${server.address().port}${BASE}`;
  const ctx = await launchApp();
  try {
    const [page] = await Promise.all([
      ctx.app.waitForEvent('window'),
      ctx.app.evaluate(({ BrowserWindow }, u) => {
        const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { sandbox: true, contextIsolation: true } });
        w.loadURL(u);
      }, url)
    ]);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('#view[data-ready]').waitFor();
    const tab = async (id) => { await page.locator(`#tabs [data-tab=${id}]`).click(); await page.locator(`#view[data-ready=${id}]`).waitFor(); };

    await tab('visita_tecnica');
    await preencherVisita(page);
    await page.locator('.route-prompt [data-route-close]').first().click().catch(() => {});
    await page.locator('#btn-finalize').click();
    await page.locator('dialog.modal[open] [data-confirm]').click();
    await expect(page.locator('#toasts .toast').last()).toContainText('Caixa de Saída');
    await expect(page.locator('#outbox-badge')).toHaveText('1');

    // recarregar a página (como fechar e abrir o app no celular): continua no Histórico
    await page.reload();
    await page.locator('#view[data-ready]').waitFor();
    await tab('outbox');
    const item = page.locator('[data-history] .outbox-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('FBM-89');
    await expect(item.locator('.status')).toHaveText('Aguardando envio');

    await page.evaluate(() => {
      window.print = () => { window.__printed = { text: document.getElementById('print-root')?.textContent || '' }; };
    });
    await item.locator('.outbox-item__main').click();
    const preview = page.locator('dialog.modal[open]').first();
    await expect(preview.getByRole('button', { name: 'Voltar ao histórico' })).toBeVisible();
    await preview.getByRole('button', { name: 'Baixar / Compartilhar PDF' }).click();
    const sheet = page.locator('dialog[data-pdf-sheet][open]');
    await expect(sheet.locator('[data-download]')).toHaveAttribute('download', /\.pdf$/);
    await sheet.getByRole('button', { name: 'Imprimir' }).click();
    await expect.poll(() => page.evaluate(() => window.__printed || null)).not.toBeNull();
    expect((await page.evaluate(() => window.__printed)).text).toContain('FBM-89');

    await preview.getByRole('button', { name: 'Reutilizar / Editar como novo' }).click();
    await page.locator('#view[data-ready=visita_tecnica]').waitFor();
    await expect(page.locator('[data-table=equipe][data-row="0"][data-col=nome]')).toHaveValue('João');
    expect(errors).toEqual([]);
  } finally {
    server.close();
    await ctx.close();
  }
});
