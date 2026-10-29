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
    const latin = async (b) => new TextDecoder('latin1').decode(new Uint8Array(await (window.__abOriginal || Blob.prototype.arrayBuffer).call(b)));
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

test('iPhone: foto que aparece na tela mas não deixa ler os bytes ainda entra no PDF e no Word', async () => {
  const { page } = ctx;
  // simula o Safari do iPhone com foto guardada no aparelho: leitura direta dos bytes falha, o <img> funciona
  await page.evaluate(() => {
    window.__abOriginal = Blob.prototype.arrayBuffer; // só o teste lê o PDF gerado
    Blob.prototype.arrayBuffer = () => Promise.reject(new Error('NotReadableError'));
    FileReader.prototype.readAsDataURL = function () { setTimeout(() => this.onerror?.(new Error('NotReadableError'))); };
  });
  const r = await gerar(page, [[WEBP, 'image/jpeg']]);
  expect(r.jspdf).toBe(1);
  expect(r.html).toBe(1);
  expect(r.docxJpeg).toBe(true);
  expect(r.docxIndisponivel).toBe(false);
  expect(await page.locator('#toasts').count() ? await page.locator('#toasts').innerText() : '').not.toContain('não pôde ser incluída');
});

test('PDF compacto: 4 fotos por linha (Antes x Depois com 2 de cada lado), sem uma foto por página', async () => {
  const { page } = ctx;
  const res = await page.evaluate(async (b64) => {
    const { getModule } = await import('./src/modules/index.js');
    const { buildPdfBlob } = await import('./src/ui/pdf-doc.js');
    const blob = () => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/webp' });
    const photos = [];
    // 8 componentes com 2 fotos "antes" e 2 "depois" cada + 8 fotos no registro final
    for (const f of ['fotos_chegada', 'fotos_manometros', 'fotos_vc', 'fotos_va1', 'fotos_va2', 'fotos_vb1', 'fotos_vb2', 'fotos_flange_inf']) {
      for (const fase of ['antes', 'antes', 'depois', 'depois']) photos.push({ name: f, type: 'image/webp', field: f, fase, legenda: `${f} ${fase}`, blob: blob() });
    }
    for (let i = 0; i < 8; i++) photos.push({ name: 'final', type: 'image/webp', field: 'fotos_final', legenda: `Final ${i}`, blob: blob() });
    await import('./src/ui/pdf-doc.js').then((m) => m.buildPdfBlob({ module: getModule('handover'), uniqueId: 'x', data: {}, photos: [] })); // carrega o jsPDF
    let desenhadas = 0;
    const api = window.jspdf.jsPDF.API;
    const addImage = api.addImage;
    api.addImage = function (...a) { desenhadas += 1; return addImage.apply(this, a); };
    const pdf = await buildPdfBlob({ module: getModule('handover'), uniqueId: '0f9c2b1a-1111-4222-8333-944455556667', data: { poco: 'FMT-3', _visita_ref: 'x', _visita_data: '25/08/2026' }, photos });
    const t = new TextDecoder('latin1').decode(new Uint8Array(await pdf.arrayBuffer()));
    api.addImage = addImage;
    return { paginas: (t.match(/\/Type\s*\/Page[^s]/g) || []).length, imagens: desenhadas };
  }, WEBP);
  expect(res.imagens).toBe(40);
  expect(res.paginas).toBeLessThanOrEqual(8); // antes: ~1 linha (2 fotos) por página → mais de 20 páginas
});

test('fotos ficam guardadas como bytes e voltam como foto legível no rascunho, no histórico e na fila', async () => {
  const { page } = ctx;
  const r = await page.evaluate(async (b64) => {
    const { put, get, getAll, STORES } = await import('./src/core/db.js');
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/webp' });
    const foto = { name: 'a', type: 'image/webp', field: 'fotos_vc', blob };
    await put(STORES.drafts, { key: 't', uniqueId: 'u1', module: 'handover', data: {}, photos: [foto] });
    const lido = await get(STORES.drafts, 't');
    await put(STORES.drafts, { ...lido, key: 't2' }); // regravar o que foi lido (o caso que quebrava no iPhone)
    const relido = await get(STORES.drafts, 't2');
    const cru = await new Promise((ok) => { indexedDB.open('bdo-e').onsuccess = (e) => {
      const g = e.target.result.transaction('drafts').objectStore('drafts').get('t2'); g.onsuccess = () => ok(g.result.photos[0]); }; });
    const todos = await getAll(STORES.drafts);
    return {
      tamanho: relido.photos[0].blob.size, original: blob.size, tipo: relido.photos[0].blob.type,
      cruTemBlob: Boolean(cru.blob), cruBytes: cru.bytes instanceof ArrayBuffer,
      getAllBlob: todos.every((d) => !d.photos?.length || d.photos[0].blob instanceof Blob)
    };
  }, WEBP);
  expect(r.tamanho).toBe(r.original);
  expect(r.tipo).toBe('image/webp');
  expect(r.cruTemBlob).toBe(false);
  expect(r.cruBytes).toBe(true);
  expect(r.getAllBlob).toBe(true);
});

test('foto escolhida chega mesmo se o bloco for redesenhado com o seletor aberto (fotos "Antes" chegando)', async () => {
  const { page } = ctx;
  await openTab(page, 'handover');
  await fill(page, 'poco', 'FMT-4');
  const [seletor] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-wrap="fotos_vc"] label.photo-add__btn').first().click()
  ]);
  // enquanto o técnico escolhe, o bloco é redesenhado (o campo de arquivo antigo sai da tela)
  await page.evaluate(async () => {
    const f = document.querySelector('[data-wrap="fotos_vc"]');
    f.innerHTML = f.innerHTML; // mesmo HTML, elementos novos
  });
  await seletor.setFiles({ name: 'depois.webp', mimeType: 'image/webp', buffer: Buffer.from(WEBP, 'base64') });
  await expect(page.locator('[data-wrap=fotos_vc] img')).toHaveCount(1);
});

test('salvamentos seguidos do rascunho terminam na ordem: a foto mais nova não é apagada por um salvamento antigo', async () => {
  const { page } = ctx;
  const fotos = await page.evaluate(async (b64) => {
    const { put, get, STORES } = await import('./src/core/db.js');
    const grande = new Blob([new Uint8Array(3_000_000)], { type: 'image/jpeg' }); // leitura mais lenta
    const nova = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/webp' });
    const a = put(STORES.drafts, { key: 'ordem', photos: [{ name: 'g', blob: grande }] });
    const b = put(STORES.drafts, { key: 'ordem', photos: [{ name: 'g', blob: grande }, { name: 'nova', blob: nova }] });
    await Promise.all([a, b]);
    return (await get(STORES.drafts, 'ordem')).photos.map((p) => p.name);
  }, WEBP);
  expect(fotos).toEqual(['g', 'nova']);
});

test('foto que o aparelho não consegue mais abrir aparece marcada para tirar de novo', async () => {
  const { page } = ctx;
  await openTab(page, 'handover');
  await fill(page, 'poco', 'FMT-5');
  await page.locator('[data-wrap="fotos_vc"] input[data-kind=photos][data-fase="depois"]').first()
    .setInputFiles({ name: 'ok.webp', mimeType: 'image/webp', buffer: Buffer.from(WEBP, 'base64') });
  await expect(page.locator('[data-wrap=fotos_vc] img')).toHaveCount(1);
  await page.evaluate(() => { document.querySelector('[data-wrap=fotos_vc] .photo img').src = 'blob:null/inexistente'; });
  await expect(page.locator('[data-wrap=fotos_vc] .photo--perdida')).toHaveCount(1);
});
