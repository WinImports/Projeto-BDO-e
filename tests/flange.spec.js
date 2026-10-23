// Assistente Técnico de Flanges (src/shared/flangeTable.js + src/core/flange.js + card no form.js) na Visita
// Técnica: busca por Flange + Pressão ("3/5M" vale para 3M e 5M), desempate pelos furos, edição manual
// preservada, card de apoio (chave / torque + nota) e os campos novos no PDF e no Word (relatório antigo: "—").
const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const { launchApp, openTab } = require('./helpers');

const NOTA = 'Torque de referência. Siga o procedimento aprovado do cliente.';

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

const flange = (page) => page.evaluate(() => import('./src/core/flange.js').then((m) => m));

test('busca por Flange + Pressão, "3/5M" vale para 3M e 5M e os furos desempatam', async () => {
  const r = await ctx.page.evaluate(async () => {
    const { buscarFlange, sugestoes, MODELOS } = await import('./src/core/flange.js');
    const resumo = (x) => ({ status: x.status, aneis: x.linhas.map((l) => `${l.anel}/${l.furos}`) });
    return {
      unico: buscarFlange('7 1/16"', '3M'),
      sug: sugestoes(buscarFlange('7 1/16"', '3M').linha),
      tresM: resumo(buscarFlange('2 1/16"', '3M')),
      cincoM: resumo(buscarFlange('2 1/16"', '5M')),
      seisFuros: resumo(buscarFlange('2 1/16"', '5M', 6)),
      oitoFuros: resumo(buscarFlange('2 1/16"', '3M', '8')),
      furosSemPar: resumo(buscarFlange('2 1/16"', '3M', 10)),
      dezM: resumo(buscarFlange('2 1/16"', '10M')),
      dois9_16_5M: resumo(buscarFlange('2 9/16"', '5M')),
      tres1_8_5M: resumo(buscarFlange('3 1/8"', '5M')),
      nenhum: resumo(buscarFlange('9"', '2M')),
      incompleto: resumo(buscarFlange('9"', '')),
      divergem: buscarFlange('7 1/16"', '3M', 16).furosDivergem,
      modelos: MODELOS
    };
  });
  expect(r.unico).toMatchObject({ status: 'unico', linha: { anel: 'R-45', furos: 12, pressao: '3M' }, furosDivergem: false });
  expect(r.sug).toEqual({ diametro: '1 1/8" (28,58 mm)', comprimento: '8" (203,2 mm)', anel: 'R-45', chave: '46 mm / 1-13/16"', torque: '925 Nm / 686 lbf·ft' });
  // "3/5M" casa com 3M e com 5M; 2 1/16" tem a variação DL (6 furos) e a normal (8 furos)
  expect(r.tresM).toEqual({ status: 'multiplo', aneis: ['RX-24/6', 'R-24/8'] });
  expect(r.cincoM).toEqual({ status: 'multiplo', aneis: ['RX-24/6', 'R-24/8'] });
  expect(r.seisFuros).toEqual({ status: 'unico', aneis: ['RX-24/6'] });
  expect(r.oitoFuros).toEqual({ status: 'unico', aneis: ['R-24/8'] });
  expect(r.furosSemPar).toEqual({ status: 'multiplo', aneis: ['RX-24/6', 'R-24/8'] }); // não chuta
  expect(r.dezM).toEqual({ status: 'unico', aneis: ['BX-152/8'] });                    // 3/5M não vale para 10M
  expect(r.dois9_16_5M).toEqual({ status: 'unico', aneis: ['R-27/8'] });
  expect(r.tres1_8_5M).toEqual({ status: 'unico', aneis: ['R-35/8'] });                // 3 1/8" tem linha própria de 5M
  expect(r.nenhum).toEqual({ status: 'nenhum', aneis: [] });
  expect(r.incompleto).toEqual({ status: 'incompleto', aneis: [] });
  expect(r.divergem).toBe(true);
  expect(r.modelos[0]).toBe('2 1/16"');
  expect(r.modelos).not.toContain('2 1/16" DL');
  expect(r.modelos.at(-1)).toBe('21 1/4"');
});

test('sugestões: preenche o que está vazio ou ainda sugerido; o que o técnico editou à mão fica', async () => {
  const r = await ctx.page.evaluate(async () => {
    const { aplicarSugestao } = await import('./src/core/flange.js');
    const d = { flange_sup_modelo: '7 1/16"', flange_sup_pressao: '3M' };
    const passos = [];
    passos.push(aplicarSugestao(d, 'flange_sup').mudou);
    d.flange_sup_anel = 'R-45 inox (trocado em campo)'; // edição manual
    d.flange_sup_pressao = '5M';
    passos.push(aplicarSugestao(d, 'flange_sup').mudou);
    const depois5M = { ...d };
    d.flange_sup_modelo = '2 1/16"'; // vira "mais de uma opção": sugestões antigas saem, o manual fica
    passos.push(aplicarSugestao(d, 'flange_sup').mudou);
    const multiplo = { ...d };
    d.flange_sup_anel = ''; // técnico apagou: volta a receber sugestão
    d.flange_sup_parafusos = '8';
    aplicarSugestao(d, 'flange_sup');
    return { passos, depois5M, multiplo, final: d };
  });
  expect(r.passos[0]).toEqual(['flange_sup_diametro', 'flange_sup_comprimento', 'flange_sup_anel', 'flange_sup_chave', 'flange_sup_torque']);
  expect(r.depois5M).toMatchObject({ flange_sup_anel: 'R-45 inox (trocado em campo)', flange_sup_torque: '1.727 Nm / 1.281 lbf·ft', flange_sup_chave: '55 mm / 2-1/8"' });
  expect(r.passos[1]).not.toContain('flange_sup_anel');
  expect(r.multiplo).toMatchObject({ flange_sup_anel: 'R-45 inox (trocado em campo)', flange_sup_torque: '', flange_sup_chave: '', flange_sup_diametro: '' });
  expect(r.final).toMatchObject({ flange_sup_anel: 'R-24', flange_sup_torque: '429 Nm / 319 lbf·ft', flange_sup_comprimento: '6" (152,4 mm)' });
});

test('na Visita: escolher Flange e Pressão preenche os campos e o card de apoio; edição manual preservada; opções quando há mais de uma linha', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  const campo = (id) => page.locator(`[data-field="${id}"]`);
  const card = (p) => page.locator(`[data-flange-card="${p}"]`);

  await expect(card('flange_sup')).toHaveAttribute('data-estado', 'incompleto');
  await campo('flange_sup_modelo').selectOption('7 1/16"');
  await campo('flange_sup_pressao').selectOption('3M');
  await expect(campo('flange_sup_anel')).toHaveValue('R-45');
  await expect(campo('flange_sup_diametro')).toHaveValue('1 1/8" (28,58 mm)');
  await expect(campo('flange_sup_comprimento')).toHaveValue('8" (203,2 mm)');
  await expect(campo('flange_sup_chave')).toHaveValue('46 mm / 1-13/16"');
  await expect(campo('flange_sup_torque')).toHaveValue('925 Nm / 686 lbf·ft');
  await expect(card('flange_sup')).toHaveAttribute('data-estado', 'unico');
  await expect(card('flange_sup').locator('[data-flange-chave]')).toHaveText('46 mm / 1-13/16"');
  await expect(card('flange_sup').locator('[data-flange-torque]')).toHaveText('925 Nm / 686 lbf·ft');
  await expect(card('flange_sup').locator('[data-flange-nota]')).toHaveText(NOTA);

  // continua editável; o que foi editado à mão não é sobrescrito ao trocar a pressão
  await campo('flange_sup_anel').fill('R-45 inox');
  await campo('flange_sup_pressao').selectOption('5M');
  await expect(campo('flange_sup_anel')).toHaveValue('R-45 inox');
  await expect(campo('flange_sup_torque')).toHaveValue('1.727 Nm / 1.281 lbf·ft');
  await expect(card('flange_sup').locator('[data-flange-torque]')).toHaveText('1.727 Nm / 1.281 lbf·ft');
  await campo('flange_sup_torque').fill('1.700 Nm (procedimento do cliente)');
  await campo('flange_sup_parafusos').fill('16'); // furos diferentes da tabela: avisa, não muda o torque digitado
  await expect(card('flange_sup').locator('[data-flange-furos]')).toContainText('diferente da tabela (12 furos)');
  await expect(campo('flange_sup_torque')).toHaveValue('1.700 Nm (procedimento do cliente)');

  // mais de uma linha: não preenche sozinho, mostra as opções
  await campo('flange_inf_modelo').selectOption('2 1/16"');
  await campo('flange_inf_pressao').selectOption('3M');
  await expect(card('flange_inf')).toHaveAttribute('data-estado', 'multiplo');
  await expect(card('flange_inf').locator('[data-action=flange-opcao]')).toHaveCount(2);
  await expect(campo('flange_inf_anel')).toHaveValue('');
  await card('flange_inf').locator('[data-action=flange-opcao][data-furos="6"]').click();
  await expect(campo('flange_inf_parafusos')).toHaveValue('6');
  await expect(campo('flange_inf_anel')).toHaveValue('RX-24');
  await expect(card('flange_inf')).toHaveAttribute('data-estado', 'unico');

  // fica no rascunho
  await openTab(page, 'bdo');
  await openTab(page, 'visita_tecnica');
  await expect(campo('flange_sup_anel')).toHaveValue('R-45 inox');
  await expect(campo('flange_inf_anel')).toHaveValue('RX-24');
  await expect(card('flange_sup')).toHaveAttribute('data-estado', 'unico');
  await expect(page.locator('[data-field=flange_sup_tamanho]')).toHaveCount(0); // campo antigo fora do formulário
});

/** Gera PDF (jsPDF) e Word da Visita; devolve o texto do Word e o texto dos fluxos do PDF. */
async function gerar(page, data) {
  const { pdf, docx } = await page.evaluate(async (d) => {
    const { getModule } = await import('./src/modules/index.js');
    const { buildPdfBlob } = await import('./src/ui/pdf-doc.js');
    const { buildDocxBlob } = await import('./src/ui/docx-doc.js');
    const module = getModule('visita_tecnica');
    const args = { module, uniqueId: '6b1d5f0e-4a8e-4c51-9a8b-2f6c3d7e9a01', data: d, photos: [] };
    const b64 = async (blob) => btoa(Array.from(new Uint8Array(await blob.arrayBuffer()), (c) => String.fromCharCode(c)).join(''));
    return { pdf: await b64(await buildPdfBlob(args)), docx: await b64(await buildDocxBlob(args)) };
  }, data);
  const bytesPdf = Buffer.from(pdf, 'base64');
  const raw = bytesPdf.toString('latin1');
  let texto = '';
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try { texto += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { /* fluxo não comprimido */ }
  }
  const word = Buffer.from(docx, 'base64').toString('utf8'); // ZIP "store": o XML vai sem compressão
  return { pdfOk: raw.startsWith('%PDF-'), pdf: texto, word };
}

test('PDF e Word: relatório novo traz Pressão/Modelo, Anel, Chave e Torque com a nota; relatório antigo sai com "—"', async () => {
  const { page } = ctx;
  const base = { poco: 'FBM-89', data: '2026-10-20', cliente: 'PETROBRAS' };

  const novo = await gerar(page, { ...base,
    flange_sup_modelo: '7 1/16"', flange_sup_pressao: '3M', flange_sup_parafusos: '12', flange_sup_anel: 'R-45',
    flange_sup_diametro: '1 1/8" (28,58 mm)', flange_sup_comprimento: '8" (203,2 mm)', flange_sup_chave: '46 mm / 1-13/16"',
    flange_sup_torque: '925 Nm / 686 lbf·ft', flange_sup_corrosao: 'Leve' });
  expect(novo.pdfOk).toBe(true);
  for (const t of ['Modelo do flange', '7 1/16&quot;', 'Pressão do flange', '3M', 'Tipo de anel de vedação', 'R-45', 'Tamanho da chave', '46 mm / 1-13/16&quot;',
    'Torque recomendado (Nm / lbf·ft)', `925 Nm / 686 lbf·ft — ${NOTA}`]) {
    expect(novo.word).toContain(t);
  }
  // no PDF os rótulos saem em maiúsculas e o texto em WinAnsi ("—" = byte 0x97)
  for (const t of ['(MODELO DO FLANGE)', '(R-45)', '46 mm / 1-13/16', '925 Nm / 686 lbf', ' Torque de refer']) expect(novo.pdf).toContain(t);

  // relatório antigo (antes do assistente): só corrosão e o tamanho digitado à mão
  const antigo = await gerar(page, { ...base, flange_sup_corrosao: 'Moderada', flange_sup_tamanho: '7/8" x 6"' });
  expect(antigo.pdfOk).toBe(true);
  expect(antigo.word).toContain('Tamanho dos parafusos');
  expect(antigo.word).toContain('7/8&quot; x 6&quot;');
  for (const t of ['Modelo do flange', 'Pressão do flange', 'Tipo de anel de vedação', 'Tamanho da chave', 'Torque recomendado (Nm / lbf·ft)']) {
    expect(antigo.word).toContain(t);
  }
  expect(antigo.word).toContain('—');
  expect(antigo.word).not.toContain(NOTA); // sem torque, sem nota
  expect(antigo.pdf).toContain('(MODELO DO FLANGE)');
  expect(antigo.pdf).toContain('(7/8" x 6")');
  expect(antigo.pdf).toContain('()'); // campo vazio: "—"
  // o flange inferior não tem dado: o bloco dele não aparece (nem com "—")
  expect(antigo.word).not.toContain('Flange inferior');

  // prévia / PDF do desktop (HTML): mesma regra
  const html = await page.evaluate(async () => {
    const { getModule } = await import('./src/modules/index.js');
    const { reportBodyHtml } = await import('./src/ui/preview.js');
    return reportBodyHtml(getModule('visita_tecnica'), { poco: 'X', flange_sup_corrosao: 'Leve' }, [], []);
  });
  expect(html).toContain('Modelo do flange');
  expect(html).toMatch(/Torque recomendado \(Nm \/ lbf·ft\)<\/dt><dd[^>]*>—/);
});
