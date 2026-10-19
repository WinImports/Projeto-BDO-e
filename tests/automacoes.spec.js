// Automações e fluxo final: hora início encadeada, KM rodado automático, equipe (nome + função),
// Quadro de Ações automático da Visita, "Salvar e Finalizar" (só salvar / enviar + WhatsApp) e
// compressão das fotos.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { launchApp, fill, openTab, preencherVisita, cell } = require('./helpers');
const { parseFile } = require('../src/shared/pocos-parser.js');

const toast = (page) => page.locator('#toasts .toast').last();
const FIXTURE_CSV = path.join(__dirname, 'fixtures', 'pocos-teste.csv');

function fixtureJson() {
  const { pocos } = parseFile(fs.readFileSync(FIXTURE_CSV), FIXTURE_CSV);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-pocos-')), 'pocos.json');
  fs.writeFileSync(file, JSON.stringify({ fonte: 'pocos-teste.csv', total: pocos.length, pocos }));
  return file;
}

/** GPS do aparelho numa posição fixa (todas as chamadas seguintes). */
async function mockGps(page, coords) {
  await page.evaluate((c) => {
    navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok({ coords: { accuracy: 5, ...c } }), 20);
  }, coords);
}

/** PNG de cor sólida w x h (para testar a compressão). */
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h, 120);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let x = 0xffffffff; for (const v of buf) x = table[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let ctx;
test.beforeEach(async () => { ctx = await launchApp({ env: { BDOE_POCOS_FILE: fixtureJson() } }); });
test.afterEach(async () => { await ctx.close(); });

test('apropriação: a linha nova começa na hora fim da anterior', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await cell(page, 'atividades', 0, 'hora_inicio').fill('07:00');
  await cell(page, 'atividades', 0, 'atividade').fill('RPT e liberação');
  await cell(page, 'atividades', 0, 'hora_fim').fill('07:45');
  await page.locator('[data-action=add-row][data-table=atividades]').click();
  await expect(cell(page, 'atividades', 1, 'hora_inicio')).toHaveValue('07:45');

  // corrigir a hora fim da linha 1 atualiza o início da linha 2 (que veio dela)
  await cell(page, 'atividades', 0, 'hora_fim').fill('08:00');
  await expect(cell(page, 'atividades', 1, 'hora_inicio')).toHaveValue('08:00');
  await cell(page, 'atividades', 1, 'hora_fim').fill('09:30');
  await expect(page.locator('[data-computed="atividades:1:duracao"]')).toHaveText('1h30');
});

test('KM rodado: estimado até o poço escolhido e somado a cada nova captura de GPS', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await expect(page.locator('[data-field=km_inicial]')).toHaveCount(0); // só a caixa unificada
  await mockGps(page, { latitude: -12.4424, longitude: -38.3791 }); // ~10 km ao sul do TST-001
  await page.locator('[data-field=poco]').fill('TST-001');
  await page.locator('.combo__opt').first().click();
  await expect(page.locator('[data-field=km_total]')).toHaveValue('13'); // 10 km em linha reta × 1,3

  // chegou na locação: nova captura soma o trecho
  await mockGps(page, { latitude: -12.3524, longitude: -38.3791 });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(page.locator('[data-field=km_total]')).toHaveValue('26');
  await expect(page.locator('#toasts')).toContainText('km somados ao KM rodado');

  // o técnico pode corrigir à mão; novas capturas somam sobre o valor corrigido
  await page.locator('[data-field=km_total]').fill('30');
  await mockGps(page, { latitude: -12.4424, longitude: -38.3791 });
  await page.getByRole('button', { name: 'Obter Localização Atual' }).click();
  await expect(page.locator('[data-field=km_total]')).toHaveValue('43');
});

test('equipe: nome + função (lista fixa) nos 3 relatórios, com o técnico das Configurações', async () => {
  const { page } = ctx;
  await openTab(page, 'settings');
  await page.locator('[data-setting=empresa_nome]').fill('EMPRESA TESTE');
  await page.locator('[data-setting=tecnico_nome]').fill('ANDERSON SOUZA');
  await page.locator('[data-action=save]').click();
  for (const tab of ['bdo', 'visita_tecnica', 'handover']) {
    await openTab(page, tab);
    const wrap = page.locator('[data-wrap=equipe]');
    await expect(wrap.locator('legend')).toContainText('Equipe');
    await expect(cell(page, 'equipe', 0, 'nome')).toHaveValue('ANDERSON SOUZA');
    await expect(cell(page, 'equipe', 0, 'funcao')).toHaveValue('Técnico');
    await expect(cell(page, 'equipe', 0, 'funcao').locator('option')).toHaveText(['—', 'Técnico', 'Operador', 'Supervisor', 'Técnico de Segurança', 'Gestor Técnico', 'Fiscal']);
  }
  await expect(page.locator('[data-field=frente], [data-field=turma_entrega]')).toHaveCount(0);
});

test('Visita: diagnóstico do componente preenche o Quadro de Ações automaticamente', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  const acoes = () => page.locator('[data-table=correcoes][data-col=acao]').evaluateAll((els) => els.map((e) => e.value));

  await fill(page, 'va1_estanqueidade', 'Sem estanqueidade (vazamento)');
  expect(await acoes()).not.toContain('VA-1: Necessária substituição da válvula devido à falta de estanqueidade');
  await page.locator('[data-field=va1_intervencao][value=Sim]').check();
  await expect.poll(acoes).toContain('VA-1: Necessária substituição da válvula devido à falta de estanqueidade');
  await expect(toast(page)).toContainText('Adicionado ao Quadro de Ações');

  await fill(page, 'flange_inf_corrosao', 'Severa');
  await page.locator('[data-field=flange_inf_intervencao][value=Sim]').check();
  await page.locator('[data-table=antepoco_checklist][data-row="0"][data-col=situacao]').selectOption('Sim');
  await expect.poll(acoes).toEqual(expect.arrayContaining([
    'Flange inferior: Necessária substituição dos parafusos / prisioneiros devido à corrosão severa',
    'Antipoço: Limpeza com carro sugador'
  ]));

  // deixou de precisar de intervenção: a linha automática sai do quadro
  await page.locator('[data-field=va1_intervencao][value=Não]').check();
  await expect.poll(acoes).not.toContain('VA-1: Necessária substituição da válvula devido à falta de estanqueidade');

  // vai para a prévia/PDF
  await page.locator('#btn-preview').click();
  await expect(page.locator('dialog.modal[open] [data-wrap], dialog.modal[open] .preview__section', { hasText: 'Recomendações' }).first())
    .toContainText('Flange inferior: Necessária substituição dos parafusos');
});

test('"Salvar e Finalizar": só salvar fica no Histórico; "Enviar" depois vai para o banco e abre o WhatsApp', async () => {
  const { app, page } = ctx;
  await app.evaluate(({ shell }) => { shell.openExternal = async (u) => { global.__opened = u; }; });
  await openTab(page, 'settings');
  await page.locator('[data-setting=empresa_nome]').fill('EMPRESA TESTE');
  await page.locator('[data-setting=whatsapp_padrao]').fill('(71) 99999-8888');
  await page.locator('[data-action=save]').click();

  await openTab(page, 'visita_tecnica');
  await preencherVisita(page);
  await page.locator('#btn-finalize').click();
  const modal = page.locator('dialog.modal[open]');
  await expect(modal.locator('.finalize-ask')).toContainText('Deseja enviar este relatório?');
  await expect(modal.locator('[data-pdf]')).toBeVisible();
  await modal.getByRole('button', { name: 'Não, só salvar no aparelho' }).click();
  await expect(page.locator('#toasts')).toContainText('memória local do app (IndexedDB)');
  await expect(page.locator('#outbox-badge')).toBeHidden(); // não foi para a fila de envio

  await openTab(page, 'outbox');
  const item = page.locator('[data-history] .outbox-item');
  await expect(item.locator('.status')).toHaveText('Salvo no aparelho (não enviado)');
  await item.locator('[data-action=send]').click();
  await expect(page.locator('#outbox-badge')).toHaveText('1');
  await expect(item.locator('.status')).toHaveText('Aguardando envio');

  const share = page.locator('[data-share-prompt]');
  const href = await share.locator('[data-share-whatsapp]').getAttribute('href');
  expect(href).toMatch(/^https:\/\/api\.whatsapp\.com\/send\?phone=5571999998888&text=/);
  const texto = decodeURIComponent(href.split('text=')[1]);
  expect(texto).toContain('Relatório de Visita Técnica');
  expect(texto).toContain('Poço / Locação: FBM-89');
  // com número configurado, o WhatsApp abre sozinho
  await expect.poll(() => app.evaluate(() => global.__opened || '')).toBe(href);
});

test('"Sim, enviar" sem número configurado: mostra o botão do WhatsApp para escolher o contato', async () => {
  const { app, page } = ctx;
  await app.evaluate(({ shell }) => { shell.openExternal = async (u) => { global.__opened = u; }; });
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page);
  await page.locator('#btn-finalize').click();
  await page.locator('dialog.modal[open]').getByRole('button', { name: 'Sim, enviar' }).click();
  await expect(page.locator('#outbox-badge')).toHaveText('1');
  await expect(page.locator('[data-share-whatsapp]')).toHaveAttribute('href', /^https:\/\/api\.whatsapp\.com\/send\?text=/);
  await page.waitForTimeout(500);
  expect(await app.evaluate(() => global.__opened || '')).toBe(''); // não abre sozinho
});

test('fotos são comprimidas para no máximo 1280 px em JPEG', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await page.locator('input[data-kind=photos][data-photos-field=fotos_vc]').first()
    .setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: png(3000, 2000) });
  const img = page.locator('[data-wrap=fotos_vc] .photo img');
  await expect(img).toHaveCount(1);
  const tamanho = await img.evaluate(async (el) => { await el.decode(); return { w: el.naturalWidth, h: el.naturalHeight }; });
  expect(tamanho).toEqual({ w: 1280, h: 853 });
  // rascunho guardado com a foto já em JPEG
  await page.keyboard.press('Control+s');
  const salva = await page.evaluate(() => new Promise((resolve) => {
    indexedDB.open('bdo-e').onsuccess = (e) => {
      const g = e.target.result.transaction('drafts').objectStore('drafts').get('visita_tecnica');
      g.onsuccess = () => { const p = g.result.photos[0]; resolve({ type: p.type, nome: p.name, bytes: p.blob.size }); };
    };
  }));
  expect(salva.type).toBe('image/jpeg');
  expect(salva.nome).toBe('grande.jpg');
  expect(salva.bytes).toBeLessThan(400_000);
});
