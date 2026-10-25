// Navegação até a locação: os links usam o POÇO como destino e o app oferece a rota
// (1) ao escolher o poço no cabeçalho e (2) ao registrar um deslocamento/mobilização no BDO.
// Usa a base FICTÍCIA (tests/fixtures/pocos-teste.csv): TST-001 = -12.3524, -38.3791.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, openTab } = require('./helpers');
const { parseFile } = require('../src/shared/pocos-parser.js');

const FIXTURE_CSV = path.join(__dirname, 'fixtures', 'pocos-teste.csv');
const GOOGLE_TST001 = 'https://www.google.com/maps/dir/?api=1&destination=-12.352400,-38.379100&travelmode=driving';
const WAZE_TST001 = 'https://waze.com/ul?ll=-12.352400,-38.379100&navigate=yes';

function fixtureJson() {
  const { pocos } = parseFile(fs.readFileSync(FIXTURE_CSV), FIXTURE_CSV);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-pocos-')), 'pocos.json');
  fs.writeFileSync(file, JSON.stringify({ fonte: 'pocos-teste.csv', total: pocos.length, pocos }));
  return file;
}

async function pickWell(page, nome) {
  await page.locator('[data-field=poco]').fill(nome);
  await page.locator('.combo__opt').first().click();
}

const activity = (page, row = 0) => page.locator(`[data-table=atividades][data-row="${row}"][data-col=atividade]`);

let ctx;
test.beforeEach(async () => { ctx = await launchApp({ env: { BDOE_POCOS_FILE: fixtureJson() } }); });
test.afterEach(async () => { await ctx.close(); });

for (const tab of ['bdo']) {
  test(`${tab}: escolher o poço oferece a navegação com o poço como destino`, async () => {
    const { page } = ctx;
    await openTab(page, tab);
    await pickWell(page, 'TST-001');

    const prompt = page.locator('.route-prompt[data-route-prompt=poco]');
    await expect(prompt).toContainText('Deseja iniciar a navegação GPS para a locação TST-001?');
    await expect(prompt.locator('[data-route-link=google]')).toHaveAttribute('href', GOOGLE_TST001);
    await expect(prompt.locator('[data-route-link=waze]')).toHaveAttribute('href', WAZE_TST001);

    // o botão de rota do formulário fica pronto com o mesmo destino
    await expect(page.locator('.geo__route [data-route-link=google]')).toHaveAttribute('href', GOOGLE_TST001);
    await expect(page.locator('.geo__route')).toContainText('TST-001');

    await prompt.getByRole('button', { name: 'Agora não' }).click();
    await expect(prompt).toHaveCount(0);
  });
}

test('o aviso aparece uma vez por poço e fecha ao trocar de aba', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await pickWell(page, 'TST-001');
  const prompt = page.locator('.route-prompt');
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Agora não' }).click();

  await pickWell(page, 'TST-001'); // mesmo poço de novo: não pergunta outra vez
  await page.waitForTimeout(400);
  await expect(prompt).toHaveCount(0);

  await pickWell(page, 'TST-002'); // outro poço: pergunta de novo
  await expect(prompt).toContainText('TST-002');
  await openTab(page, 'visita_tecnica');
  await expect(prompt).toHaveCount(0);
});

test('BDO: atividade de deslocamento oferece a rota até o poço do cabeçalho', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await pickWell(page, 'TST-001');
  await page.locator('.route-prompt [data-route-close]').first().click();

  await activity(page).fill('Iniciando deslocamento para a locação');
  await activity(page).press('Tab'); // a detecção roda ao terminar de digitar
  const prompt = page.locator('.route-prompt[data-route-prompt=deslocamento]');
  await expect(prompt).toContainText('Identificamos um deslocamento. Deseja abrir a rota no Google Maps/Waze para o poço TST-001?');
  await expect(prompt.locator('[data-route-link=google]')).toHaveAttribute('href', GOOGLE_TST001);
  await expect(prompt.locator('[data-route-link=waze]')).toHaveAttribute('href', WAZE_TST001);
  await prompt.getByRole('button', { name: 'Agora não' }).click();

  // mesma linha não pergunta de novo; atividade comum não dispara
  await activity(page).fill('Iniciando deslocamento para a locação (atualizado)');
  await activity(page).press('Tab');
  await page.waitForTimeout(900);
  await expect(page.locator('.route-prompt')).toHaveCount(0);
});

test('BDO: deslocamento para OUTRO poço inclui o poço no mesmo campo (todos os poços do dia); rota e Visita vão para o atual', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await pickWell(page, 'TST-001');
  await page.locator('.route-prompt [data-route-close]').first().click();

  await activity(page).fill('Deslocando para o poço TST-002');
  await activity(page).press('Tab');
  const poco = page.locator('[data-field=poco]');
  await expect(poco).toHaveValue('TST-001, TST-002');
  await expect(page.locator('#toasts')).toContainText('Poço TST-002 incluído no Poço / Locação');
  await expect(page.locator('.route-prompt[data-route-prompt=deslocamento]')).toContainText('TST-002');
  // a navegação do cabeçalho segue para o poço atual (o último da lista), sem imagem de mapa
  await expect(page.locator('.geo__route')).toHaveAttribute('data-route-target', '-12.360000,-38.390000');
  await expect(page.locator('iframe')).toHaveCount(0);

  // voltar ao mesmo poço não repete o nome
  await page.locator('[data-action=add-row][data-table=atividades]').click();
  await activity(page, 1).fill('Retornando para o poço TST-001');
  await activity(page, 1).press('Tab');
  await page.waitForTimeout(600);
  await expect(poco).toHaveValue('TST-001, TST-002');

  // Visita Técnica herda o poço atual (o último), não a lista
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('[data-field=poco]')).toHaveValue('TST-002');
});

test('BDO: "mobilização" sem poço informado pede o Poço / Locação', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await activity(page).fill('Troca da válvula VM');
  await activity(page).press('Tab');
  await page.waitForTimeout(900);
  await expect(page.locator('.route-prompt')).toHaveCount(0);

  await activity(page).fill('Mobilização da equipe');
  await activity(page).press('Tab');
  const prompt = page.locator('.route-prompt[data-route-prompt=deslocamento]');
  await expect(prompt).toContainText('Informe o Poço / Locação');
  await expect(prompt.locator('[data-route-link]')).toHaveCount(0);
});

test('palavras-chave de deslocamento (com e sem acento)', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  const result = await page.evaluate(async () => {
    const { isTravel } = await import('./src/ui/form.js');
    return ['deslocamento', 'Iniciando deslocamento', 'Deslocando para locação', 'MOBILIZAÇÃO', 'desmobilização da sonda',
      'Troca da válvula VM', 'Teste de estanqueidade'].map(isTravel);
  });
  expect(result).toEqual([true, true, true, true, true, false, false]);
});
