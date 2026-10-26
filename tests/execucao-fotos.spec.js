// Relatório de Execução: Antes x Depois só quando o bloco tem fotos "Antes" (da Visita Técnica de referência);
// sem elas, uma coluna "Fotos da execução" em largura total — no formulário, na prévia, no PDF e no Word.
// Com Visita, cada componente mostra a linha só de leitura "Na Visita (dd/mm): …".
const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const { launchApp, fill, openTab } = require('./helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const foto = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const pad = (n) => String(n).padStart(2, '0');
const hoje = new Date();
const hojeISO = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
const diaMes = `${pad(hoje.getDate())}/${pad(hoje.getMonth() + 1)}`;
const VISITA_ID = '6b1d5f0e-4a8e-4c51-9a8b-2f6c3d7e9a10';

/** Botão "Arquivo" de uma vaga de fotos da coluna "Depois" (ou da coluna única). */
const vagaDepois = (page, field) => page.locator(`[data-wrap="${field}"] input[data-kind=photos][data-fase="depois"]`).first();

/** Visita Técnica finalizada (Histórico) do poço, com foto da VC e dados de VC e flange inferior. */
async function gravarVisita(page, poco) {
  await page.evaluate(async ({ id, poco, data }) => {
    const { saveLocalOnly } = await import('./src/core/outbox.js');
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    await saveLocalOnly({
      uniqueId: id, module: 'visita_tecnica',
      data: { poco, data, vc_estanqueidade: 'Sem estanqueidade (vazamento)', vc_intervencao: 'Sim', vc_obs: 'vazamento na haste',
        flange_inf_corrosao: 'Moderada', flange_inf_obs: 'prisioneiros oxidados' },
      photos: [{ name: 'vc.png', type: 'image/png', blob: new Blob([png], { type: 'image/png' }), field: 'fotos_vc', legenda: 'VC antes' }]
    });
  }, { id: VISITA_ID, poco, data: hojeISO });
}

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('sem Visita: todos os blocos em uma coluna "Fotos da execução", rótulo sem "antes x depois" e nenhuma linha "Na Visita"', async () => {
  const { page } = ctx;
  await openTab(page, 'handover');
  await fill(page, 'poco', 'SEM-VISITA');
  await page.locator('[data-field=poco]').press('Tab');

  for (const id of ['fotos_chegada', 'fotos_vc', 'fotos_flange_inf', 'fotos']) {
    const bloco = page.locator(`[data-wrap="${id}"]`);
    await expect(bloco.locator('[data-layout=uma-coluna] .photo-compare__title')).toHaveText('Fotos da execução');
    await expect(bloco.locator('[data-fase=antes]')).toHaveCount(0);
  }
  await expect(page.locator('[data-wrap=fotos_vc] .field__label')).toHaveText('Fotos — VC');
  await expect(page.locator('[data-wrap=fotos_chegada] .field__label')).toHaveText('Placa do poço e conjunto / árvore de natal');
  await expect(page.locator('[data-visita-nota]')).toHaveCount(0);
  await expect(page.locator('[data-wrap=vc_na_visita]')).toBeHidden();

  // foto tirada no modo de uma coluna é gravada como "depois"
  await vagaDepois(page, 'fotos_vc').setInputFiles(foto('vc-depois.png'));
  await expect(page.locator('[data-wrap=fotos_vc] img')).toHaveCount(1);
  await openTab(page, 'bdo'); // trocar de aba grava o rascunho na hora
  const fases = await page.evaluate(async () => (await (await import('./src/core/drafts.js')).loadDraft('handover')).photos.map((p) => [p.field, p.fase]));
  expect(fases).toEqual([['fotos_vc', 'depois']]);
});

test('Visita puxada DEPOIS das fotos: o bloco passa para Antes x Depois sem perder nada; "Na Visita" aparece só onde a Visita registrou algo', async () => {
  const { page } = ctx;
  await openTab(page, 'handover');
  await fill(page, 'poco', 'TST-EXE');
  await page.locator('[data-field=poco]').press('Tab');
  await vagaDepois(page, 'fotos_vc').setInputFiles(foto('vc-depois.png'));
  await vagaDepois(page, 'fotos_flange_inf').setInputFiles(foto('flange-depois.png'));
  await expect(page.locator('[data-wrap=fotos_vc] [data-layout=uma-coluna] img')).toHaveCount(1);

  // a Visita do poço aparece no histórico e a consolidação é atualizada
  await gravarVisita(page, 'TST-EXE');
  await page.locator('[data-action=consolidar]').click();

  const vc = page.locator('[data-wrap=fotos_vc]');
  await expect(vc.locator('[data-layout=antes-depois]')).toBeVisible();
  await expect(vc.locator('[data-fase=antes] img')).toHaveCount(1);
  await expect(vc.locator('[data-fase=depois] img')).toHaveCount(1); // a foto tirada antes continua
  await expect(vc.locator('.field__label')).toHaveText('Fotos — VC: antes x depois');
  // flange inferior: a Visita não tem foto dele → continua em uma coluna, com a foto da execução
  await expect(page.locator('[data-wrap=fotos_flange_inf] [data-layout=uma-coluna] img')).toHaveCount(1);

  // linha "Na Visita" (só leitura) nos componentes que a Visita registrou
  await expect(page.locator('[data-visita-nota=vc_na_visita]')).toHaveText(`Na Visita (${diaMes}): Sem estanqueidade (vazamento); necessita intervenção — vazamento na haste`);
  await expect(page.locator('[data-visita-nota=flange_inf_na_visita]')).toHaveText(`Na Visita (${diaMes}): Corrosão moderada — prisioneiros oxidados`);
  await expect(page.locator('[data-wrap=va1_na_visita]')).toBeHidden();
  await expect(page.locator('[data-wrap=vc_na_visita] input, [data-wrap=vc_na_visita] textarea')).toHaveCount(0); // só leitura

  await openTab(page, 'bdo'); // trocar de aba grava o rascunho na hora
  const fotos = await page.evaluate(async () => (await (await import('./src/core/drafts.js')).loadDraft('handover')).photos.map((p) => [p.field, p.fase]).sort());
  expect(fotos).toEqual([['fotos_flange_inf', 'depois'], ['fotos_vc', 'antes'], ['fotos_vc', 'depois']]);
});

/** Prévia (HTML), PDF (texto dos fluxos) e Word (XML) de um Relatório de Execução. */
async function gerar(page, data, comFotos) {
  const r = await page.evaluate(async ({ d, comFotos }) => {
    const { getModule } = await import('./src/modules/index.js');
    const { buildPdfBlob } = await import('./src/ui/pdf-doc.js');
    const { buildDocxBlob } = await import('./src/ui/docx-doc.js');
    const { reportBodyHtml } = await import('./src/ui/preview.js');
    const module = getModule('handover');
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const blob = () => new Blob([png], { type: 'image/png' });
    const photos = comFotos.map(([field, fase]) => ({ name: `${field}-${fase}.png`, type: 'image/png', blob: blob(), field, fase, legenda: `${field} ${fase || ''}`.trim() }));
    const args = { module, uniqueId: '6b1d5f0e-4a8e-4c51-9a8b-2f6c3d7e9a20', data: d, photos };
    const b64 = async (b) => btoa(Array.from(new Uint8Array(await b.arrayBuffer()), (c) => String.fromCharCode(c)).join(''));
    return { pdf: await b64(await buildPdfBlob(args)), docx: await b64(await buildDocxBlob(args)), html: reportBodyHtml(module, d, photos, photos.map(() => 'blob:x')) };
  }, { d: data, comFotos });
  const raw = Buffer.from(r.pdf, 'base64').toString('latin1');
  let pdf = '';
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try { pdf += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { /* fluxo de imagem */ }
  }
  return { pdfOk: raw.startsWith('%PDF-'), pdf, word: Buffer.from(r.docx, 'base64').toString('utf8'), html: r.html };
}

test('PDF, Word e prévia: sem "Antes" uma coluna; com Visita, Antes x Depois e a linha "Na Visita" antes da Situação final', async () => {
  const { page } = ctx;
  const base = { poco: 'TST-EXE', data_hora: `${hojeISO}T08:00`, vc_situacao: 'Estanque', vc_servico: 'Válvula substituída' };

  // sem Visita
  const sem = await gerar(page, base, [['fotos_vc', 'depois']]);
  expect(sem.pdfOk).toBe(true);
  expect(sem.word).toContain('Fotos da execução');
  expect(sem.word).toContain('Fotos — VC<');
  expect(sem.word).not.toContain('antes x depois');
  expect(sem.word).not.toContain('Antes — Visita Técnica');
  expect(sem.word).not.toContain('Situação na Visita Técnica');
  expect(sem.pdf).toContain('(FOTOS DA EXECU');
  expect(sem.pdf).not.toContain('ANTES X DEPOIS');
  expect(sem.html).toContain('data-layout="uma-coluna"');
  expect(sem.html).not.toContain('data-layout="antes-depois"');

  // com Visita de referência: Antes x Depois no bloco que tem "antes"; uma coluna no que não tem
  const notaVc = `Na Visita (${diaMes}): Sem estanqueidade (vazamento); necessita intervenção — vazamento na haste`;
  const com = await gerar(page, { ...base, _visita_ref: VISITA_ID, _visita_data: diaMes, vc_na_visita: notaVc, flange_inf_situacao: 'Reapertado' },
    [['fotos_vc', 'antes'], ['fotos_vc', 'depois'], ['fotos_flange_inf', 'depois']]);
  expect(com.pdfOk).toBe(true);
  expect(com.word).toContain('Fotos — VC: antes x depois');
  expect(com.word).toContain('Antes — Visita Técnica');
  expect(com.word).toContain('Fotos da execução'); // flange inferior sem "antes"
  expect(com.word).toContain(notaVc);
  // a linha da Visita sai logo antes da "Estanqueidade final" (Situação final) da VC
  const iNota = com.word.indexOf('Situação na Visita Técnica');
  const iSit = com.word.indexOf('Estanqueidade final');
  expect(iNota).toBeGreaterThan(-1);
  expect(iNota).toBeLessThan(iSit);
  expect(com.pdf).toContain('(SITUA');            // rótulo "SITUAÇÃO NA VISITA TÉCNICA"
  expect(com.pdf).toContain('vazamento na haste');
  expect(com.pdf).toContain('ANTES X DEPOIS');
  expect(com.html).toContain('data-layout="antes-depois"');
  expect(com.html).toContain('data-layout="uma-coluna"');
  expect(com.html).toContain(notaVc);

  // relatório antigo (antes desta regra): fotos sem fase, sem _visita_ref e sem linha "Na Visita"
  const antigo = await gerar(page, { poco: 'ANTIGO', data_hora: '2026-09-01T08:00', vc_situacao: 'Estanque' }, [['fotos_vc', null]]);
  expect(antigo.pdfOk).toBe(true);
  expect(antigo.word).toContain('Fotos da execução');
  expect(antigo.html).toContain('data-layout="uma-coluna"');
});

test('Execução no formato do relatório pós-serviço: tempos de operação, condições encontradas, resumo das intervenções e registro final', async () => {
  const { page } = ctx;
  await openTab(page, 'handover');
  const view = page.locator('#view');
  // tempos de operação: chegada / saída por dia, tempo no poço calculado
  const tempos = view.locator('.form-section', { hasText: 'Tempos de operação' });
  await tempos.getByRole('button', { name: /Adicionar dia/ }).click();
  const linha = tempos.locator('tbody tr').first();
  await linha.locator('[data-col=chegada]').fill('08:30');
  await linha.locator('[data-col=saida]').fill('15:50');
  await linha.locator('[data-col=saida]').blur();
  await expect(linha.locator('.cell--computed')).toHaveText(/7h ?20/);
  // condições encontradas e pressões na chegada
  await expect(view.locator('[data-field=condicao_geral]')).toBeVisible();
  await expect(view.locator('.form-section', { hasText: 'Pressões encontradas na chegada' })).toBeVisible();
  // resumo das intervenções montado com o serviço de cada componente
  await fill(page, 'va2_servico', 'Instalação de uma kerotest');
  await fill(page, 'flange_sup_servico', 'Substituição dos parafusos');
  const resumo = view.locator('[data-field=servico_executado]');
  await expect(resumo).toHaveValue('VA-2: Instalação de uma kerotest\nFlange superior: Substituição dos parafusos');
  await expect(view.locator('[data-autotext-status=servico_executado]')).toContainText('serviços executados nos componentes');
  // registro final do poço
  const final = view.locator('.form-section', { hasText: 'Registro final do poço' });
  await expect(final).toContainText('Visão geral do poço após o serviço');
  await expect(final.locator('[data-field=obs_finais]')).toBeVisible();
});
