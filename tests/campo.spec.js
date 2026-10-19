// Uso em campo: número do WhatsApp, deslocamentos com destino (poço / cidade / base) na apropriação
// do BDO, câmera com controles fixos e zoom, e o PDF gerado no próprio aparelho (iPhone / PWA).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, fill, openTab, cell } = require('./helpers');
const { parseFile } = require('../src/shared/pocos-parser.js');

const FIXTURE_CSV = path.join(__dirname, 'fixtures', 'pocos-teste.csv');
function fixtureJson() {
  const { pocos } = parseFile(fs.readFileSync(FIXTURE_CSV), FIXTURE_CSV);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-pocos-')), 'pocos.json');
  fs.writeFileSync(file, JSON.stringify({ fonte: 'pocos-teste.csv', total: pocos.length, pocos }));
  return file;
}

// mesma conta do app (core/distancia.js): linha reta × 1,3, 1 casa decimal
const km = (a, b) => {
  const r = (g) => (g * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3 * 10) / 10;
};
const TST001 = { lat: -12.3524, lng: -38.3791 };
const TST002 = { lat: -12.36, lng: -38.39 };
const CATU = { lat: -12.3536, lng: -38.3786 };
const POJUCA = { lat: -12.4303, lng: -38.3317 };

async function mockGps(page, c) {
  await page.evaluate((x) => {
    navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok({ coords: { accuracy: 5, latitude: x.lat, longitude: x.lng } }), 20);
  }, c);
}

async function salvarConfig(page, valores) {
  await openTab(page, 'settings');
  await page.locator('[data-setting=empresa_nome]').fill('EMPRESA TESTE');
  for (const [k, v] of Object.entries(valores)) await page.locator(`[data-setting=${k}]`).fill(v);
  await page.locator('[data-action=save]').click();
  await expect(page.locator('#toasts')).toContainText('salv');
}

let ctx;
test.beforeEach(async () => { ctx = await launchApp({ env: { BDOE_POCOS_FILE: fixtureJson() } }); });
test.afterEach(async () => { await ctx.close(); });

test('WhatsApp: número limpo com o 55 (Brasil) e link oficial api.whatsapp.com', async () => {
  const { page } = ctx;
  await openTab(page, 'settings');
  const campo = page.locator('[data-setting=whatsapp_padrao]');
  await campo.fill('(71) 99961-2118');
  await campo.press('Tab');
  await expect(campo).toHaveValue('5571999612118');

  const casos = await page.evaluate(async () => {
    const { sanitizarWhatsApp } = await import('./src/core/telefone.js');
    const { waUrl } = await import('./src/core/share.js');
    return {
      a: sanitizarWhatsApp('71999612118'),
      b: sanitizarWhatsApp('+55 (71) 99961-2118'),
      c: sanitizarWhatsApp('071 99961-2118'),
      d: sanitizarWhatsApp('9961-2118'), // sem DDD: inválido
      url: waUrl('(71) 99961-2118', 'Relatório FBM-89'),
      semNumero: waUrl('', 'oi')
    };
  });
  expect(casos).toEqual({
    a: '5571999612118', b: '5571999612118', c: '5571999612118', d: '',
    url: 'https://api.whatsapp.com/send?phone=5571999612118&text=Relat%C3%B3rio%20FBM-89',
    semNumero: 'https://api.whatsapp.com/send?text=oi'
  });
});

test('deslocamento para um POÇO: atualiza o cabeçalho, soma o KM e oferece a rota até o destino', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await mockGps(page, TST001); // aparelho na locação TST-001
  await cell(page, 'atividades', 0, 'atividade').fill('Iniciando deslocamento para o poço TST-002');
  await cell(page, 'atividades', 0, 'atividade').press('Tab');

  await expect(page.locator('[data-field=poco]')).toHaveValue('TST-002');
  await expect(page.locator('[data-field=km_total]')).toHaveValue(String(km(TST001, TST002)));
  const prompt = page.locator('.route-prompt[data-route-prompt=deslocamento]');
  await expect(prompt).toContainText('Deslocamento identificado para TST-002. Deseja abrir a rota no GPS?');
  await expect(prompt.locator('[data-route-link=google]')).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=-12.360000,-38.390000&travelmode=driving');
  await expect(page.locator('[data-part=lat]')).toHaveText('-12.360000'); // coordenadas do poço de destino
});

test('deslocamento para CIDADE e para BASE cadastrada: cabeçalho, KM somado por trecho e edição sem duplicar', async () => {
  const { page } = ctx;
  await salvarConfig(page, { locais_personalizados: 'Base Taquipe; -12.5500; -38.4000' });
  await openTab(page, 'bdo');
  await mockGps(page, TST002);
  await cell(page, 'atividades', 0, 'atividade').fill('Deslocando para Catu');
  await cell(page, 'atividades', 0, 'atividade').press('Tab');
  await expect(page.locator('[data-field=cidade_uf]')).toHaveValue('Catu - BA');
  const k1 = km(TST002, CATU);
  await expect(page.locator('[data-field=km_total]')).toHaveValue(String(k1));
  await expect(page.locator('.route-prompt')).toContainText('Deslocamento identificado para Catu. Deseja abrir a rota no GPS?');

  // segunda linha: de Catu até a base cadastrada pelo usuário
  await page.locator('[data-action=add-row][data-table=atividades]').click();
  await cell(page, 'atividades', 1, 'atividade').fill('Indo para Taquipe');
  await cell(page, 'atividades', 1, 'atividade').press('Tab');
  await expect(page.locator('[data-field=cidade_uf]')).toHaveValue('Base Taquipe');
  const k2 = km(CATU, { lat: -12.55, lng: -38.4 });
  await expect(page.locator('[data-field=km_total]')).toHaveValue(String(Math.round((k1 + k2) * 10) / 10));

  // corrigir o destino da 1ª linha troca o trecho dela (não soma de novo)
  await cell(page, 'atividades', 0, 'atividade').fill('Deslocando para Pojuca');
  await cell(page, 'atividades', 0, 'atividade').press('Tab');
  await expect(page.locator('.route-prompt')).toContainText('Deslocamento identificado para Pojuca');
  const k1b = km({ lat: -12.55, lng: -38.4 }, POJUCA); // parte da última posição conhecida (Taquipe)
  await expect(page.locator('[data-field=km_total]')).toHaveValue(String(Math.round((k2 + k1b) * 10) / 10));

  // destino desconhecido: avisa como cadastrar
  await page.locator('[data-action=add-row][data-table=atividades]').click();
  await cell(page, 'atividades', 2, 'atividade').fill('Seguindo para Lugar Inexistente');
  await cell(page, 'atividades', 2, 'atividade').press('Tab');
  await expect(page.locator('.route-prompt')).toContainText('não está na base de poços nem nas cidades / bases');
});

test('câmera: controles fixos na base da tela, alternar câmera e zoom quando o aparelho suporta', async () => {
  const { app, page } = ctx;
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(320, 480); w.setSize(390, 844); });
  await openTab(page, 'visita_tecnica');
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const g = canvas.getContext('2d');
    g.fillStyle = '#2a7'; g.fillRect(0, 0, 640, 480);
    setInterval(() => { g.fillStyle = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`; g.fillRect(0, 0, 20, 20); }, 100);
    window.__zoom = [];
    window.__gum = [];
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__gum.push(c.video.deviceId?.exact || 'padrão');
      const s = canvas.captureStream(10);
      const t = s.getVideoTracks()[0];
      t.getCapabilities = () => ({ zoom: { min: 1, max: 5, step: 0.1 } });
      t.getSettings = () => ({ deviceId: c.video.deviceId?.exact || 'cam1', zoom: 1 });
      t.applyConstraints = async (x) => { window.__zoom.push(x.advanced[0].zoom); };
      return s;
    };
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: 'videoinput', deviceId: 'cam1', label: 'Traseira' }, { kind: 'videoinput', deviceId: 'cam2', label: 'Frontal' }
    ];
  });
  await page.locator('[data-wrap=fotos_vc] [data-action=camera]').first().click();
  const cam = page.locator('dialog.camera-full[open]');
  const bar = cam.locator('.camera__bar');
  await expect(cam.getByRole('button', { name: 'Tirar Foto' })).toBeEnabled();
  expect(await bar.evaluate((el) => { const s = getComputedStyle(el); return [s.position, s.bottom, s.zIndex, s.left]; })).toEqual(['fixed', '0px', '99999', '0px']);
  const box = await bar.boundingBox();
  expect(Math.round(box.y + box.height)).toBe(844 - (844 - (await page.evaluate(() => innerHeight)))); // colada na base da tela

  // zoom da câmera
  await expect(cam.locator('.camera__zoom')).toBeVisible();
  await cam.getByRole('button', { name: 'Aumentar zoom' }).click();
  await expect.poll(() => page.evaluate(() => window.__zoom)).toEqual([1.4]);
  await expect(cam.locator('[data-zoom-label]')).toHaveText('1.4×');

  // alternar câmera
  await cam.getByRole('button', { name: 'Alternar câmera' }).click();
  await expect.poll(() => page.evaluate(() => window.__gum.slice(-1)[0])).toBe('cam2');

  await cam.getByRole('button', { name: 'Tirar Foto' }).click();
  await expect(cam).toHaveCount(0);
  await expect(page.locator('[data-wrap=fotos_vc] .photo img')).toHaveCount(1);
});

test('PDF gerado no aparelho (jsPDF): arquivo válido, com fotos, tabelas e links de rota', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  const info = await page.evaluate(async () => {
    const { buildPdfBlob } = await import('./src/ui/pdf-doc.js');
    const { default: module } = await import('./src/modules/visita-tecnica.js');
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 300;
    canvas.getContext('2d').fillRect(0, 0, 400, 300);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
    const photos = Array.from({ length: 7 }, (_, i) => ({ name: `f${i}.jpg`, type: 'image/jpeg', blob, field: 'fotos_vc', category: 'Válvula da coluna (VC)', legenda: `Foto ${i + 1} da VC` }));
    const data = {
      poco: 'FBM-89', data: '2026-10-19', cliente: 'PETROBRAS', objetivo: 'Avaliar válvulas', introducao: 'No dia 19/10/2026 fizemos uma visita técnica ao poço FBM-89.',
      equipe: [{ nome: 'João', funcao: 'Técnico' }], vc_estanqueidade: 'Sem estanqueidade (vazamento)', vc_intervencao: 'Sim',
      correcoes: [{ acao: 'VC: Necessária substituição da válvula devido à falta de estanqueidade', necessario: true, prioridade: 'Alta' }],
      coordenadas: { lat: '-12.352400', lng: '-38.379100', source: 'base', poco: 'FBM-89' }
    };
    const pdf = await buildPdfBlob({ module, uniqueId: '00000000-0000-4000-8000-000000000000', data, photos, company: { nome: 'EMPRESA TESTE' } });
    const raw = new TextDecoder('latin1').decode(await pdf.arrayBuffer());
    return {
      type: pdf.type, head: raw.slice(0, 5), size: pdf.size,
      pages: (raw.match(/\/Type\s*\/Page[^s]/g) || []).length,
      images: (raw.match(/\/Subtype\s*\/Image/g) || []).length,
      uris: [...raw.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1])
    };
  });
  expect(info.type).toBe('application/pdf');
  expect(info.head).toBe('%PDF-');
  expect(info.pages).toBeGreaterThanOrEqual(1);
  expect(info.images).toBeGreaterThanOrEqual(1); // a mesma imagem pode ser reaproveitada
  expect(info.uris).toContain('https://www.google.com/maps/dir/?api=1&destination=-12.352400,-38.379100&travelmode=driving');
  expect(info.uris).toContain('https://waze.com/ul?ll=-12.352400,-38.379100&navigate=yes');
});
