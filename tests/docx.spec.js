// Relatório em Word (.docx): pacote OpenXML válido, cabeçalho só com a identificação (sem GPS),
// fotos lado a lado em 2 colunas (inclusive a medição do flange) e a imagem da assinatura no bloco final.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, fill, openTab, preencherVisita, vincularContratos } = require('./helpers');

const toast = (page) => page.locator('#toasts .toast').last();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const foto = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const vaga = (page, field, category) => page.locator(`input[data-kind=photos][data-photos-field="${field}"][data-category="${category}"]`);

/** Lê um ZIP sem compressão (como o gerado pelo app): { nome: Buffer }. */
function lerZip(buf) {
  const out = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    expect(buf.readUInt16LE(i + 8)).toBe(0); // método "store"
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extra;
    out[name] = buf.slice(start, start + size);
    i = start + size;
  }
  return out;
}

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('Visita Técnica em Word: identificação sem GPS, fotos em 2 colunas e assinatura em imagem', async () => {
  const { app, page, userData } = ctx;
  const docxPath = path.join(userData, 'visita.docx');
  await app.evaluate(({ dialog, shell }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    shell.openPath = async () => '';
  }, docxPath);

  await vincularContratos(page, ['OS-Mans']); // Contrato = lista dos contratos da conta
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, 'FBM-89');
  await fill(page, 'campo', 'Campo de Buracica');
  await fill(page, 'contrato', 'OS-Mans');
  await vaga(page, 'fotos_chegada', 'Placa do poço').setInputFiles(foto('placa.png'));
  await vaga(page, 'fotos_vc', 'Válvula da coluna (VC)').setInputFiles(foto('vc.png'));
  await vaga(page, 'fotos_flange_inf', 'Medição com paquímetro / trena').setInputFiles(foto('paquimetro.png'));
  await expect(page.locator('[data-wrap=fotos_flange_inf] .photo img')).toHaveCount(1);
  // assinatura a partir de um arquivo de imagem
  await page.locator('input[data-kind=signature-file][data-target=assinatura]').setInputFiles(foto('assinatura.png'));
  // a imagem vai para o quadro da assinatura (diferente de um quadro em branco)
  await expect.poll(() => page.evaluate(() => {
    const c = document.querySelector('canvas[data-signature=assinatura]');
    const blank = document.createElement('canvas');
    blank.width = c.width; blank.height = c.height;
    const ctx = blank.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL() !== blank.toDataURL();
  })).toBe(true);

  await page.locator('#btn-preview').click();
  const prev = page.locator('dialog.modal[open]');
  // prévia: fotos lado a lado em 2 colunas
  const cols = await prev.locator('.preview__photos .photo-grid').first().evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);
  await expect(prev.locator('[data-ident]')).toContainText('OS-Mans');
  await expect(prev.locator('.preview__signature')).toHaveCount(1);

  await prev.locator('[data-docx]').click();
  await expect(toast(page)).toContainText('Word salvo', { timeout: 15_000 });

  const zip = lerZip(fs.readFileSync(docxPath));
  for (const parte of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/header1.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels']) {
    expect(Object.keys(zip)).toContain(parte);
  }
  // 3 fotos + assinatura
  expect(Object.keys(zip).filter((n) => n.startsWith('word/media/'))).toHaveLength(4);

  // todo XML do pacote é bem formado
  const xmls = Object.entries(zip).filter(([n]) => /\.(xml|rels)$/.test(n)).map(([n, b]) => [n, b.toString('utf8')]);
  const erros = await page.evaluate((lista) => lista
    .filter(([, x]) => new DOMParser().parseFromString(x, 'application/xml').getElementsByTagName('parsererror').length)
    .map(([n]) => n), xmls);
  expect(erros).toEqual([]);

  const doc = zip['word/document.xml'].toString('utf8');
  const texto = doc.replace(/<[^>]+>/g, '');
  expect(texto).toContain('Poço / Locação');
  expect(texto).toContain('FBM-89');
  expect(texto).toContain('Campo de Buracica');
  expect(texto).toContain('OS-Mans');
  expect(texto).toContain('João (Técnico)');
  expect(texto).toMatch(/fizemos uma visita técnica ao poço FBM-89, localizado em Campo de Buracica, com a equipe formada por João \(Técnico\), com o objetivo de/);
  expect(texto).toContain('Figura 3');
  expect(texto).toContain('Medição com paquímetro / trena');
  expect(texto).not.toMatch(/Coordenadas|Rota até|google\.com\/maps|waze/i);
  // grade de fotos: 2 colunas de 48% da largura útil (+ espaço no meio)
  expect(doc).toContain('<w:tblGrid><w:gridCol w:w="4626"/><w:gridCol w:w="386"/><w:gridCol w:w="4626"/></w:tblGrid>');
  expect(texto).toContain('Assinatura do gestor técnico / responsável');
  expect(texto).toContain('Gestor Teste');
});
