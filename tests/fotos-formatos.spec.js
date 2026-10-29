// Fotos em formato que o PDF/Word não aceitam (WebP, HEIC do iPhone, arquivo sem tipo) entram no relatório
// convertidas para JPEG; foto ilegível não some sem aviso: a vaga fica "(imagem indisponível)" e aparece um alerta.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, openTab, fill } = require('./helpers');

const WEBP = fs.readFileSync(path.join(__dirname, 'fixtures', 'foto-teste.webp')).toString('base64');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

/** Gera PDF (jsPDF), PDF HTML do desktop e Word do Relatório de Execução com as fotos dadas (base64 + tipo). */
async function gerar(page, fotos) {
  return page.evaluate(async (fotos) => {
    const { getModule } = await import('./src/modules/index.js');
    const { buildPdfBlob } = await import('./src/ui/pdf-doc.js');
    const { buildDocxBlob } = await import('./src/ui/docx-doc.js');
    const { reportFiles } = await import('./src/ui/report-pdf.js');
    const module = getModule('handover');
    const photos = fotos.map(([b64, type], i) => ({
      name: `f${i}`, type, field: 'fotos_vc', fase: 'depois', legenda: `Foto ${i + 1}`,
      blob: new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type })
    }));
    const args = { module, uniqueId: '0f9c2b1a-1111-4222-8333-944455556666', data: { poco: 'FMT-1' }, photos };
    const latin = async (b) => new TextDecoder('latin1').decode(new Uint8Array(await b.arrayBuffer()));
    const imagens = (t) => (t.match(/\/Subtype\s*\/Image/g) || []).length;
    const jspdf = await latin(await buildPdfBlob(args));
    const docx = await latin(await buildDocxBlob(args));
    const html = await latin((await reportFiles(args)).find((f) => f.ext === 'pdf').blob);
    return {
      jspdf: imagens(jspdf), html: imagens(html),
      docxJpeg: (docx.match(/word\/media\/image\d+\.jpeg/g) || []).length > 0,
      docxIndisponivel: docx.includes('(imagem indispon')
    };
  }, fotos);
}

test('WebP (ou outro formato fora de JPEG/PNG) entra no PDF e no Word convertido para JPEG', async () => {
  const r = await gerar(ctx.page, [[WEBP, 'image/webp']]);
  expect(r.jspdf).toBe(1);
  expect(r.html).toBe(1);
  expect(r.docxJpeg).toBe(true);
  expect(r.docxIndisponivel).toBe(false);
  // tipo declarado errado (WebP rotulado como JPEG) também é convertido: vale o conteúdo, não o rótulo
  const r2 = await gerar(ctx.page, [[WEBP, 'image/jpeg']]);
  expect(r2.jspdf).toBe(1);
  expect(r2.docxJpeg).toBe(true);
});

test('foto ilegível: o relatório sai com "(imagem indisponível)" na vaga e o técnico é avisado', async () => {
  const { page } = ctx;
  const lixo = Buffer.from('isto nao e uma imagem heic de verdade').toString('base64');
  const r = await gerar(page, [[lixo, 'image/heic'], [WEBP, 'image/webp']]);
  expect(r.jspdf).toBe(1); // a outra foto continua lá
  expect(r.docxIndisponivel).toBe(true);
  await expect(page.locator('#toasts')).toContainText('1 foto não pôde ser incluída no relatório');
});

test('arquivo de foto sem tipo (HEIC do celular) não é descartado ao escolher', async () => {
  const { page } = ctx;
  await openTab(page, 'handover');
  await fill(page, 'poco', 'FMT-2');
  const input = page.locator('[data-wrap="fotos_vc"] input[data-kind=photos][data-fase="depois"]').first();
  await input.setInputFiles({ name: 'IMG_0001.webp', mimeType: '', buffer: Buffer.from(WEBP, 'base64') });
  await expect(page.locator('[data-wrap=fotos_vc] img')).toHaveCount(1);
  await openTab(page, 'bdo'); // grava o rascunho
  const tipos = await page.evaluate(async () => (await (await import('./src/core/drafts.js')).loadDraft('handover')).photos.map((p) => p.type));
  expect(tipos).toEqual(['image/jpeg']); // convertida na entrada
});
