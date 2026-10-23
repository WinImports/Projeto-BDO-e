// Assistente Técnico de Flanges (src/shared/flangeTable.js + src/core/flange.js + form.js) na Visita Técnica:
// busca CRUZADA em qualquer ordem (flange, pressão, furos, anel, diâmetro/comprimento em pol ou mm, chave em mm
// ou pol, torque), opções que estreitam nas outras caixas, "3/5M", anotação que não trava, conflito com
// "limpar", escolha no card, edição manual preservada e os campos novos no PDF e no Word (antigo: "—").
const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const { launchApp, openTab } = require('./helpers');

const NOTA = 'Torque de referência. Siga o procedimento aprovado do cliente.';

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

// A lógica (core/flange.js + a tabela) é JavaScript puro: testada direto no Node, sem abrir tela
let flange;
test.beforeAll(async () => {
  flange = await import(require('url').pathToFileURL(require('path').join(__dirname, '..', 'src', 'core', 'flange.js')).href);
});
const noApp = async (_page, fn, arg) => fn(flange, arg);

test('cruza qualquer campo, em qualquer ordem: anel sozinho, chave em mm ou pol, diâmetro em mm; "3/5M" vale para 3M e 5M', async () => {
  const r = await noApp(ctx.page, (m) => {
    const com = (campos) => {
      const d = Object.fromEntries(Object.entries(campos).map(([c, v]) => [`f_${c}`, v]));
      const { resultado } = m.aplicarSugestao(d, 'f');
      return { status: resultado.status, n: resultado.linhas.length, aneis: resultado.linhas.map((l) => l.anel), d };
    };
    const so = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith('f_')).map(([k, v]) => [k.slice(2), v]));
    const anel = com({ anel: 'bx 160' });
    const chaveMm = com({ chave: '36' });
    const chavePol = com({ chave: '1-7/16"' });
    const diamMm = com({ diametro: '22,23 mm' });
    const chaveEFuros = com({ chave: '36 mm', parafusos: '6' });
    const torque = com({ torque: '2.146 lbf·ft' });
    return {
      anel: { ...anel, campos: so(anel.d) },
      chaveMm: { status: chaveMm.status, aneis: chaveMm.aneis, campos: so(chaveMm.d) },
      chavePol: chavePol.aneis, diamMm: diamMm.aneis,
      chaveEFuros: { status: chaveEFuros.status, campos: so(chaveEFuros.d) },
      torque: torque.aneis,
      tresM: com({ modelo: '2 1/16"', pressao: '3M' }).aneis,
      cincoM: com({ modelo: '2 1/16"', pressao: '5M' }).aneis,
      dezM: com({ modelo: '2 1/16"', pressao: '10M' }).aneis,
      psi: com({ modelo: '2 1/16"', pressao: '10.000 psi' }).aneis,
      vazio: com({}).status
    };
  });
  // só o anel isola o flange e completa todo o resto
  expect(r.anel.status).toBe('unico');
  expect(r.anel.campos).toEqual({ anel: 'bx 160', modelo: '13 5/8"', pressao: '5M', parafusos: '16', diametro: '1 5/8" (41,28 mm)',
    comprimento: '12 1/2" (317,5 mm)', chave: '65 mm / 2-9/16"', torque: '2.894 Nm / 2.146 lbf·ft' });
  // só a chave: 4 flanges; o que é comum a todos já é preenchido (prisioneiro 7/8" x 6", torque 429 Nm)
  expect(r.chaveMm.status).toBe('multiplo');
  expect(r.chaveMm.aneis).toEqual(['RX-24', 'R-24', 'R-31', 'BX-153']);
  expect(r.chaveMm.campos).toMatchObject({ chave: '36', diametro: '7/8" (22,23 mm)', comprimento: '6" (152,4 mm)', torque: '429 Nm / 319 lbf·ft' });
  expect(r.chaveMm.campos.modelo || '').toBe(''); // flange e anel ainda não definidos
  expect(r.chaveMm.campos.anel || '').toBe('');
  expect(r.chavePol).toEqual(r.chaveMm.aneis); // em polegadas dá o mesmo
  expect(r.diamMm).toEqual(r.chaveMm.aneis);
  // chave + furos isolam o 2 1/16" DL; a pressão fica vazia (vale 3M e 5M)
  expect(r.chaveEFuros.status).toBe('unico');
  expect(r.chaveEFuros.campos).toMatchObject({ modelo: '2 1/16"', anel: 'RX-24' });
  expect(r.chaveEFuros.campos.pressao || '').toBe('');
  expect(r.torque).toEqual(['R-73', 'R-50', 'BX-160']); // 2.146 lbf·ft
  expect(r.tresM).toEqual(['RX-24', 'R-24']);
  expect(r.cincoM).toEqual(['RX-24', 'R-24']);
  expect(r.dezM).toEqual(['BX-152']);
  expect(r.psi).toEqual(['BX-152']); // "10.000 psi" = 10M
  expect(r.vazio).toBe('incompleto');
});

test('as outras caixas estreitam com o que já foi preenchido (o select mostra o resto separado)', async () => {
  const r = await noApp(ctx.page, (m) => ({
    pressoesDo2_1_16: m.opcoesDe({ f_modelo: '2 1/16"' }, 'f', 'pressao'),
    flangesDe2M: m.opcoesDe({ f_pressao: '2M' }, 'f', 'modelo').combinam,
    aneisDaChave80: m.opcoesDe({ f_chave: '80' }, 'f', 'anel').combinam,
    furosDe7_1_16: m.opcoesDe({ f_modelo: '7 1/16"' }, 'f', 'parafusos').combinam,
    // o próprio campo não se filtra: com anel R-45 preenchido, a lista de anéis ainda mostra todos os de 7 1/16"
    aneisCom45: m.opcoesDe({ f_modelo: '7 1/16"', f_anel: 'R-45' }, 'f', 'anel').combinam
  }));
  expect(r.pressoesDo2_1_16).toEqual({ combinam: ['3M', '5M', '10M'], outras: ['2M'] });
  expect(r.flangesDe2M).toEqual(['7 1/16"', '21 1/4"']);
  expect(r.aneisDaChave80).toEqual(['R-74', 'BX-165']);
  expect(r.furosDe7_1_16).toEqual(['12']);
  expect(r.aneisCom45).toEqual(['R-45', 'R-46', 'BX-156']);
});

test('o que o app preencheu não trava a busca; o que o técnico digitou fica; anotação fora da tabela não filtra; conflito mostra o que limpar', async () => {
  const r = await noApp(ctx.page, (m) => {
    const d = { f_modelo: '7 1/16"', f_pressao: '3M' };
    m.aplicarSugestao(d, 'f');
    const passo1 = { ...d };
    d.f_anel = 'R-45 inox';                 // anotação do técnico: não existe na tabela
    d.f_pressao = '5M';                     // troca: o anel/torque preenchidos pelo app NÃO travam
    const passo2 = m.aplicarSugestao(d, 'f');
    const depois5M = { ...d };
    d.f_parafusos = '16';                   // contradiz 7 1/16" 5M (12 furos)
    const conflito = m.aplicarSugestao(d, 'f').resultado;
    m.limparCampo(d, 'f', 'parafusos');
    const limpo = m.aplicarSugestao(d, 'f').resultado;
    return { passo1, ignorados: passo2.resultado.ignorados, depois5M, conflito: { status: conflito.status, semCampo: conflito.semCampo }, limpo: { status: limpo.status, furos: d.f_parafusos } };
  });
  expect(r.passo1).toMatchObject({ f_anel: 'R-45', f_parafusos: '12', f_torque: '925 Nm / 686 lbf·ft' });
  expect(r.ignorados).toEqual({ anel: 'R-45 inox' });
  expect(r.depois5M).toMatchObject({ f_anel: 'R-45 inox', f_torque: '1.727 Nm / 1.281 lbf·ft', f_chave: '55 mm / 2-1/8"', f_parafusos: '12' });
  expect(r.conflito).toEqual({ status: 'nenhum', semCampo: { modelo: 1, pressao: 0, parafusos: 1 } });
  expect(r.limpo).toEqual({ status: 'unico', furos: '12' });
});

test('na Visita: começar pela chave, estreitar pelo anel, conflito com "limpar", escolher no card e rascunho salvo', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  const campo = (id) => page.locator(`[data-field="${id}"]`);
  const card = (p) => page.locator(`[data-flange-card="${p}"]`);
  const lista = (id) => page.locator(`#dl-${id} option`).evaluateAll((os) => os.map((o) => o.value));

  await expect(card('flange_sup')).toHaveAttribute('data-estado', 'incompleto');
  // começa pela chave (mm): 2 flanges; anéis e flanges que sobram aparecem nas outras caixas
  await campo('flange_sup_chave').fill('80');
  await expect(card('flange_sup')).toHaveAttribute('data-estado', 'multiplo');
  await expect(card('flange_sup').locator('[data-action=flange-opcao]')).toHaveCount(2);
  expect(await lista('flange_sup_anel')).toEqual(['R-74', 'BX-165']);
  expect(await campo('flange_sup_modelo').locator(':scope > option').allTextContents()).toEqual(['Selecione…', '20 3/4"', '21 1/4"']);
  await expect(campo('flange_sup_modelo').locator('optgroup')).toHaveAttribute('label', 'Não combinam com o já preenchido');
  await expect(campo('flange_sup_diametro')).toHaveValue('2" (50,8 mm)'); // comum aos dois
  await expect(campo('flange_sup_chave')).toHaveValue('80');              // o que foi digitado fica como está

  // o anel isola: o resto é completado
  await campo('flange_sup_anel').fill('BX-165');
  await expect(card('flange_sup')).toHaveAttribute('data-estado', 'unico');
  await expect(campo('flange_sup_modelo')).toHaveValue('21 1/4"');
  await expect(campo('flange_sup_pressao')).toHaveValue('5M');
  await expect(campo('flange_sup_parafusos')).toHaveValue('24');
  await expect(campo('flange_sup_torque')).toHaveValue('5.476 Nm / 4.061 lbf·ft');
  await expect(card('flange_sup').locator('[data-flange-torque]')).toHaveText('5.476 Nm / 4.061 lbf·ft');
  await expect(card('flange_sup').locator('[data-flange-nota]')).toHaveText(NOTA);

  // conflito: furos que não existem para esse flange → o card oferece limpar
  await campo('flange_sup_parafusos').fill('20');
  await expect(card('flange_sup')).toHaveAttribute('data-estado', 'nenhum');
  await card('flange_sup').locator('[data-action=flange-limpar][data-campo=parafusos]').click();
  await expect(card('flange_sup')).toHaveAttribute('data-estado', 'unico');
  await expect(campo('flange_sup_parafusos')).toHaveValue('24');

  // começa pelo diâmetro em polegadas e escolhe a opção no card
  await campo('flange_inf_diametro').fill('7/8"');
  await expect(card('flange_inf')).toHaveAttribute('data-estado', 'multiplo');
  await card('flange_inf').locator('[data-action=flange-opcao]', { hasText: '2 1/16" DL' }).click();
  await expect(card('flange_inf')).toHaveAttribute('data-estado', 'unico');
  await expect(campo('flange_inf_anel')).toHaveValue('RX-24');
  await expect(campo('flange_inf_parafusos')).toHaveValue('6');
  await expect(card('flange_inf').locator('[data-flange-pressao]')).toContainText('vale para 3M e 5M');
  await campo('flange_inf_pressao').selectOption('5M');
  await expect(card('flange_inf').locator('[data-flange-pressao]')).toHaveCount(0);

  // fica no rascunho
  await openTab(page, 'bdo');
  await openTab(page, 'visita_tecnica');
  await expect(campo('flange_sup_anel')).toHaveValue('BX-165');
  await expect(campo('flange_inf_pressao')).toHaveValue('5M');
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
