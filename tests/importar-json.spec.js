// Upload de Relatório (JSON) na Execução (core/relatorio-json.js + ui/importar-json.js): importa um relatório
// exportado (dados + fotos embutidas), salva no Histórico / fila, usa as fotos como ANTES na Execução e gera o
// PDF em paisagem. "Exportar JSON" na prévia gera o arquivo que volta a ser importado.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, openTab, preencherVisita, vincularContratos } = require('./helpers');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const UID = '6b1d5f0e-4a8e-4c51-9a8b-2f6c3d7e9a01';

const jsonVisita = (extra = {}) => JSON.stringify({
  formato: 'bdo-e/relatorio', versao: 1, exportadoEm: '2026-10-01T12:00:00Z',
  relatorio: {
    uniqueId: UID, module: 'visita_tecnica', createdAt: '2026-10-01T12:00:00Z',
    data: { poco: 'FBM-89', data: '2026-10-01', cliente: 'PETROBRAS', contrato: 'os mans', objetivo: 'Inspeção', ...extra },
    fotos: [
      { field: 'fotos_vc', fase: null, legenda: 'VC com vazamento na haste', name: 'vc.png', dataUrl: PNG },
      { field: 'fotos_chegada', legenda: 'Placa do poço', name: 'placa.png', dataUrl: PNG },
      { field: 'fotos_va1', legenda: 'Só caminho no servidor', path: 'visita_tecnica/x/1.jpg' }
    ]
  }
});

const arquivo = (nome, texto) => ({ name: nome, mimeType: 'application/json', buffer: Buffer.from(texto) });

/** "Salvar como" do Electron respondido automaticamente com este caminho. */
async function salvarEm(app, p) {
  await app.evaluate(({ dialog, shell }, destino) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destino });
    shell.openPath = async () => '';
  }, p);
}

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('Upload de Relatório (JSON) na Execução: resumo, contrato da conta, salva no Histórico com as fotos e vira o ANTES', async () => {
  const { page } = ctx;
  await vincularContratos(page, ['OS-Mans', 'Outro Contrato']);
  await openTab(page, 'handover');
  await page.locator('[data-import-json]').setInputFiles(arquivo('visita-fbm89.json', jsonVisita()));

  const dlg = page.locator('dialog[data-importar-json][open]');
  await expect(dlg).toContainText('visita-fbm89.json');
  await expect(dlg.locator('[data-importado="0"]')).toContainText('Visita Técnica');
  await expect(dlg.locator('[data-importado="0"]')).toContainText('FBM-89');
  await expect(dlg.locator('[data-importado="0"]')).toContainText('Relatório de 01/10/2026 · 2 fotos');
  await expect(dlg).toContainText('1 foto(s) do arquivo não vieram embutidas');
  await expect(dlg.locator('[data-imp-contrato]')).toHaveValue('OS-Mans'); // "os mans" = "OS-Mans"
  await dlg.locator('[data-imp-local]').click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('#toasts')).toContainText('1 relatório importado (2 fotos) e salvo no Histórico');

  // Histórico: o relatório com as fotos e o contrato da lista
  const salvo = await page.evaluate(async (id) => {
    const { STORES, get } = await import('./src/core/db.js');
    const h = await get(STORES.history, id);
    return { module: h.module, poco: h.data.poco, contrato: h.data.contrato, fotos: h.photos.map((p) => [p.field, p.legenda, p.type, p.blob.size > 0]), local: h.localOnly };
  }, UID);
  expect(salvo).toEqual({ module: 'visita_tecnica', poco: 'FBM-89', contrato: 'OS-Mans', local: true,
    fotos: [['fotos_vc', 'VC com vazamento na haste', 'image/png', true], ['fotos_chegada', 'Placa do poço', 'image/png', true]] });

  // Execução: poço preenchido e as fotos na coluna ANTES de cada componente
  await page.locator('#view[data-ready=handover]').waitFor();
  await expect(page.locator('[data-field=poco]')).toHaveValue('FBM-89');
  await expect(page.locator('[data-wrap=fotos_vc] [data-fase=antes] img')).toHaveCount(1);
  await expect(page.locator('[data-wrap=fotos_vc] [data-fase=antes] .photo__caption')).toHaveValue('VC com vazamento na haste');
  await expect(page.locator('[data-wrap=fotos_chegada] [data-fase=antes] img')).toHaveCount(1);
  // o ANTES escolhido fica (a consolidação automática não troca pela última Visita)
  await openTab(page, 'bdo');
  await openTab(page, 'handover');
  await expect(page.locator('[data-wrap=fotos_vc] [data-fase=antes] img')).toHaveCount(1);
  expect(await page.evaluate(async () => (await (await import('./src/core/drafts.js')).loadDraft('handover')).data._antes_fixo)).toBe(UID);
});

test('PDF direto do JSON importado (A4 deitado, como todos os relatórios) e "Importar e enviar" coloca na fila', async () => {
  const { page, app, userData } = ctx;
  const destino = path.join(userData, 'importado.pdf');
  await salvarEm(app, destino);
  await openTab(page, 'handover');
  await page.locator('[data-import-json]').setInputFiles(arquivo('visita.json', jsonVisita()));
  const dlg = page.locator('dialog[data-importar-json][open]');
  await dlg.locator('[data-imp-pdf]').click();
  await expect.poll(() => fs.existsSync(destino) && fs.statSync(destino).size > 1000).toBe(true);
  const pdf = fs.readFileSync(destino).toString('latin1');
  expect(pdf.slice(0, 5)).toBe('%PDF-');
  // 297 × 210 mm: largura > altura (paisagem). jsPDF grava 841,89 × 595,28; o Chromium (desktop), 842,88 × 595,92
  const [, largura, altura] = (/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf) || []).map(Number);
  expect(largura).toBeGreaterThan(altura);
  expect(Math.abs(largura - 842)).toBeLessThan(2);

  await dlg.locator('[data-imp-enviar]').click();
  await expect(dlg).toHaveCount(0);
  const fila = await page.evaluate(async () => (await (await import('./src/core/outbox.js')).list()).map((r) => [r.uniqueId, r.photos.length]));
  expect(fila).toEqual([[UID, 2]]);
});

test('Exportar JSON pelo Histórico e importar de volta (o mesmo relatório, com as fotos)', async () => {
  const { page, app, userData } = ctx;
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, 'RCB-34');
  await page.locator('input[data-kind=photos]').first().setInputFiles({ name: 'placa.png', mimeType: 'image/png', buffer: Buffer.from(PNG.split(',')[1], 'base64') });
  await page.locator('#btn-finalize').click();
  await page.locator('dialog.modal[open] [data-local]').click();
  await expect(page.locator('#toasts')).toContainText('Relatório salvo na memória local');

  await openTab(page, 'outbox');
  await page.locator('.outbox-item [data-action=view]').first().click();
  const destino = path.join(userData, 'exportado.json');
  await salvarEm(app, destino);
  await page.locator('dialog.modal[open] [data-json]').click();
  await expect.poll(() => fs.existsSync(destino)).toBe(true);
  const j = JSON.parse(fs.readFileSync(destino, 'utf8'));
  expect(j).toMatchObject({ formato: 'bdo-e/relatorio', versao: 1, relatorio: { module: 'visita_tecnica', data: { poco: 'RCB-34' } } });
  expect(j.relatorio.fotos).toHaveLength(1);
  expect(j.relatorio.fotos[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/); // fotos são comprimidas em JPEG ao entrar
  await page.locator('dialog.modal[open] [data-close]').first().click();

  // o arquivo exportado volta a ser lido pelo importador
  const lido = await page.evaluate(async (texto) => {
    const { lerRelatoriosJson } = await import('./src/core/relatorio-json.js');
    const r = lerRelatoriosJson(texto).relatorios[0];
    return { id: r.uniqueId, poco: r.data.poco, fotos: r.photos.length };
  }, fs.readFileSync(destino, 'utf8'));
  expect(lido).toEqual({ id: j.relatorio.uniqueId, poco: 'RCB-34', fotos: 1 });
});

test('arquivo inválido não importa e explica o motivo; também lê lista de relatórios e a linha do banco', async () => {
  const { page } = ctx;
  await openTab(page, 'handover');
  await page.locator('[data-import-json]').setInputFiles(arquivo('quebrado.json', '{ isso não é json'));
  await expect(page.locator('#toasts')).toContainText('Não foi possível importar "quebrado.json": O arquivo não é um JSON válido.');
  await expect(page.locator('dialog[data-importar-json]')).toHaveCount(0);
  await page.locator('[data-import-json]').setInputFiles(arquivo('outro.json', JSON.stringify({ formato: 'outro-sistema/v2', dados: {} })));
  await expect(page.locator('#toasts')).toContainText('Formato não reconhecido ("outro-sistema/v2")');

  const r = await page.evaluate(async () => {
    const { lerRelatoriosJson } = await import('./src/core/relatorio-json.js');
    const erro = (t) => { try { lerRelatoriosJson(t); return null; } catch (e) { return e.message; } };
    const lista = lerRelatoriosJson(JSON.stringify({ relatorios: [
      { module: 'bdo', data: { poco: 'A' } },
      { unique_id: '6b1d5f0e-4a8e-4c51-9a8b-2f6c3d7e9a02', module: 'handover', payload: { poco: 'B' }, photos: [{ path: 'x.jpg' }] } // linha do banco
    ] }));
    return {
      modulos: lista.relatorios.map((x) => [x.module, x.data.poco, /^[0-9a-f-]{36}$/.test(x.uniqueId)]),
      idDoBanco: lista.relatorios[1].uniqueId,
      ignoradas: lista.fotosIgnoradas,
      tipo: erro(JSON.stringify({ relatorio: { module: 'xyz', data: {} } })),
      semDados: erro(JSON.stringify({ relatorio: { module: 'bdo' } })),
      versaoNova: erro(JSON.stringify({ formato: 'bdo-e/relatorio', versao: 9, relatorio: { module: 'bdo', data: {} } }))
    };
  });
  expect(r.modulos).toEqual([['bdo', 'A', true], ['handover', 'B', true]]);
  expect(r.idDoBanco).toBe('6b1d5f0e-4a8e-4c51-9a8b-2f6c3d7e9a02');
  expect(r.ignoradas).toBe(1);
  expect(r.tipo).toBe('tipo de relatório desconhecido ("xyz"). Esperado BDO-e, Visita Técnica ou Relatório de Execução.');
  expect(r.semDados).toBe('sem os dados do formulário.');
  expect(r.versaoNova).toBe('Este arquivo foi gerado por uma versão mais nova do app. Atualize o app para importar.');
});

test('botão de upload só na Execução', async () => {
  const { page } = ctx;
  for (const tab of ['bdo', 'visita_tecnica']) {
    await openTab(page, tab);
    await expect(page.locator('[data-import-json]')).toHaveCount(0);
  }
  await openTab(page, 'handover');
  await expect(page.locator('#btn-import-json')).toContainText('Upload de Relatório (JSON)');
});
