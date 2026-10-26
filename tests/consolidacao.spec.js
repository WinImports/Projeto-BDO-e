// Consolidação da quinzena (14x14) no Relatório de Execução, a partir do histórico local.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, openTab, fill, vincularContratos } = require('./helpers');

// Base de poços vazia: o autocompletar não interfere nos cliques do teste
function noWellBase() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-vazio-')), 'vazio.json');
  fs.writeFileSync(file, JSON.stringify({ total: 0, pocos: [] }));
  return { BDOE_POCOS_FILE: file };
}

const ymd = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const br = (iso) => iso.split('-').reverse().join('/');

/** Grava relatórios finalizados direto no histórico local (como se viessem de quinzenas de uso). */
async function seedHistory(page, records) {
  await page.evaluate((recs) => new Promise((resolve, reject) => {
    const req = indexedDB.open('bdo-e');
    req.onsuccess = () => {
      const tx = req.result.transaction('history', 'readwrite');
      recs.forEach((r) => tx.objectStore('history').put({ createdAt: new Date().toISOString(), photosCount: 0, ...r }));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), records);
}

const HISTORY = [
  { uniqueId: 'bdo-1', module: 'bdo', data: {
    poco: 'TST-78', data: ymd(2), rpt: 'Sim', ocorrencia_sms: 'Não',
    atividades: [{ data_inicio: ymd(2), hora_inicio: '07:00', hora_fim: '09:30', atividade: 'Troca da válvula VM', duracao: '2h30' }],
    paradas: [{ inicio: '10:00', fim: '11:00', duracao: '1h00', codigo: '5', motivo: 'Aguardando carro sugador' }]
  } },
  { uniqueId: 'bdo-2', module: 'bdo', data: {
    poco: 'tst 78', data: ymd(1), rpt: 'Não', ocorrencia_sms: 'Sim', descricao_sms: 'Pequeno vazamento contido',
    atividades: [{ data_inicio: ymd(1), hora_inicio: '13:00', hora_fim: '16:00', atividade: 'Teste de estanqueidade', duracao: '3h00' }]
  } },
  { uniqueId: 'bdo-outro-poco', module: 'bdo', data: { poco: 'TST-99', data: ymd(1), atividades: [{ atividade: 'Não deve aparecer', duracao: '9h00' }] } },
  { uniqueId: 'bdo-fora-periodo', module: 'bdo', data: { poco: 'TST-78', data: ymd(30), atividades: [{ atividade: 'Quinzena anterior', duracao: '8h00' }] } },
  { uniqueId: 'visita-antiga', module: 'visita_tecnica', data: {
    poco: 'TST-78', data: ymd(20), valvulas: [{ item: 'VM (Válvula Mestra)', status: 'Danificada / Substituir' }]
  } },
  { uniqueId: 'visita-recente', module: 'visita_tecnica', data: {
    poco: 'TST-78', data: ymd(5),
    valvulas: [{ item: 'VM (Válvula Mestra)', status: 'Vazamento / Sem Estanqueidade', obs: 'Haste' }, { item: 'VA1-A', status: 'OK / Funcional' }],
    fixadores: [{ item: 'Cabeça de produção', status: 'Oxidado' }],
    pressoes: [{ item: 'Coluna', valor: '450', unidade: 'psi' }]
  } }
];

let ctx;
test.beforeEach(async () => { ctx = await launchApp({ env: noWellBase() }); });
test.afterEach(async () => { await ctx.close(); });

test('ao informar poço e período, agrupa BDOs (atividades, horas, paradas, SMS) e a última Visita', async () => {
  const { page } = ctx;
  await seedHistory(page, HISTORY);
  await openTab(page, 'handover');
  await expect(page.locator('[data-field=periodo_inicio]')).toHaveValue(ymd(13)); // quinzena padrão: últimos 14 dias
  await expect(page.locator('[data-field=periodo_fim]')).toHaveValue(ymd(0));

  await fill(page, 'poco', 'TST-78');
  await page.locator('[data-field=poco]').press('Tab');
  const consol = page.locator('[data-consol]');
  await expect(consol.locator('.consol__chip')).toContainText(['2 BDOs', 'Atividades: 5h30', 'Paradas: 1h00', 'RPT/APR realizada em 1 de 2 boletins']);
  await expect(consol).toContainText('Troca da válvula VM');
  await expect(consol).toContainText('Teste de estanqueidade');
  await expect(consol).not.toContainText('Não deve aparecer');
  await expect(consol).not.toContainText('Quinzena anterior');
  await expect(consol).toContainText('Aguardando carro sugador');
  await expect(consol).toContainText('Pequeno vazamento contido');
  await expect(consol).toContainText(`última Visita Técnica (${br(ymd(5))})`);
  await expect(consol).toContainText('Vazamento / Sem Estanqueidade');
  await expect(consol).not.toContainText('Danificada / Substituir'); // visita antiga ignorada
  await expect(consol).toContainText('450 psi');

  // período menor: só o BDO de ontem → sem paradas, e o bloco de paradas some
  await page.locator('[data-field=periodo_inicio]').fill(ymd(1));
  await expect(consol.locator('.consol__chip')).toContainText(['1 BDO', 'Atividades: 3h00']);
  await expect(consol).not.toContainText('Ocorrências e paradas imprevistas');

  // prévia/PDF: consolidação presente, pendências críticas em destaque e assinatura mantidas no relatório
  await page.locator('#btn-preview').click();
  const preview = page.locator('dialog.modal[open]');
  await expect(preview.locator('.preview__consol')).toContainText('Teste de estanqueidade');
  await expect(preview.locator('.preview__consol')).not.toContainText('Ocorrências e paradas');
  await expect(preview.locator('.notice--warn')).toContainText('Pendências críticas');
  await expect(preview.locator('.notice--warn')).toContainText('Assinatura');
});

test('sem relatórios do poço no período: avisa e o bloco fica fora da prévia/PDF', async () => {
  const { page } = ctx;
  await seedHistory(page, HISTORY);
  await openTab(page, 'handover');
  await fill(page, 'poco', 'POCO-SEM-DADOS');
  await page.locator('[data-field=poco]').press('Tab');
  await expect(page.locator('[data-consol-body]')).toContainText('Nenhum BDO ou Visita Técnica finalizados');
  await page.locator('#btn-preview').click();
  await expect(page.locator('dialog.modal[open] .preview__consol')).toHaveCount(0);
});

test('BDO finalizado pelo app entra na consolidação (inclusive depois de sair da Caixa de Saída)', async () => {
  const { page } = ctx;
  await vincularContratos(page, ['OS-Mans']); // Contrato = lista dos contratos da conta
  await openTab(page, 'bdo');
  for (const [field, value] of [['cliente', 'PETROBRAS'], ['contrato', 'OS-Mans'], ['poco', 'TST-500'], ['cidade_uf', 'Catu - BA'],
    ['turno', 'Diurno'], ['atividade_principal', 'Manutenção de válvulas'], ['tecnico', 'TÉCNICO TESTE'], ['matricula', '123']]) {
    await fill(page, field, value);
  }
  await page.locator('[data-table=atividades][data-row="0"][data-col=hora_inicio]').fill('08:00');
  await page.locator('[data-table=atividades][data-row="0"][data-col=atividade]').fill('Hot bolt na VA2-B');
  await page.locator('[data-table=atividades][data-row="0"][data-col=hora_fim]').fill('10:15');
  await page.locator('[data-field=rpt][value=Sim]').check();
  await page.locator('[data-field=ocorrencia_sms][value="Não"]').check();
  await expect(page.locator('#ready-status')).toContainText('Pronto para finalizar');
  await page.locator('#btn-finalize').click();
  await page.locator('dialog.modal[open] [data-confirm]').click();
  await expect(page.locator('#outbox-badge')).toHaveText('1');

  // simula a confirmação do servidor: o item sai da fila, mas continua no histórico local
  await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('bdo-e');
    req.onsuccess = () => {
      const tx = req.result.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').clear();
      tx.oncomplete = () => resolve();
    };
  }));

  await openTab(page, 'handover');
  await fill(page, 'poco', 'TST-500');
  await page.locator('[data-field=poco]').press('Tab');
  await expect(page.locator('[data-consol] .consol__chip')).toContainText(['1 BDO', 'Atividades: 2h15']);
  await expect(page.locator('[data-consol]')).toContainText('Hot bolt na VA2-B');
});

test('Tempos de operação vêm dos BDOs do poço: chegada = 1ª atividade no poço, saída = última; deslocamentos e outros poços ficam de fora', async () => {
  const { page } = ctx;
  await seedHistory(page, [
    // dia simples: sai da base, trabalha no poço, volta
    { uniqueId: 'bdo-a', module: 'bdo', data: { poco: 'AR-182', data: ymd(3), atividades: [
      { hora_inicio: '07:00', hora_fim: '07:45', atividade: 'DDS na base' },
      { hora_inicio: '07:45', hora_fim: '08:30', atividade: 'Deslocamento para o poço AR-182' },
      { hora_inicio: '08:30', hora_fim: '12:00', atividade: 'Substituição dos parafusos do flange superior' },
      { hora_inicio: '12:00', hora_fim: '15:50', atividade: 'Instalação de kerotest na VA-2' },
      { hora_inicio: '15:50', hora_fim: '16:40', atividade: 'Retornando para a base' }
    ] } },
    // dia com dois poços: só o trecho do AR-182 conta
    { uniqueId: 'bdo-b', module: 'bdo', data: { poco: 'AR-100, AR-182', data: ymd(1), atividades: [
      { hora_inicio: '07:00', hora_fim: '09:00', atividade: 'Reaperto de flange' },
      { hora_inicio: '09:00', hora_fim: '09:40', atividade: 'Deslocando para AR-182' },
      { hora_inicio: '09:40', hora_fim: '10:55', atividade: 'Visita técnica: teste de estanqueidade' },
      { hora_inicio: '10:55', hora_fim: '11:30', atividade: 'Retornando para a base' }
    ] } },
    { uniqueId: 'bdo-c', module: 'bdo', data: { poco: 'AR-100', data: ymd(2), atividades: [{ hora_inicio: '08:00', hora_fim: '09:00', atividade: 'Outro poço' }] } }
  ]);
  const r = await page.evaluate(async () => {
    const { tempoNoPoco } = await import('./src/core/consolidar.js');
    return tempoNoPoco({ poco: 'AR-182', atividades: [{ hora_inicio: '06:00', hora_fim: '18:00', atividade: 'Troca de válvula' }] }, 'AR-182');
  });
  expect(r).toEqual({ chegada: '06:00', saida: '18:00', visita: false });

  await openTab(page, 'handover');
  await fill(page, 'poco', 'AR-182');
  await page.locator('[data-field=poco]').press('Tab');
  const linhas = page.locator('[data-table=tempos_operacao][data-col=chegada]');
  await expect(linhas.first()).toHaveValue('08:30');
  const col = (c) => page.locator(`[data-table=tempos_operacao][data-col=${c}]`).evaluateAll((els) => els.map((e) => e.value));
  expect((await col('data')).slice(0, 2)).toEqual([ymd(3), ymd(1)]);
  expect((await col('chegada')).slice(0, 2)).toEqual(['08:30', '09:40']);
  expect((await col('saida')).slice(0, 2)).toEqual(['15:50', '10:55']);
  expect((await col('etapa')).slice(0, 2)).toEqual(['Operação', 'Visita']);
  await expect(page.locator('[data-computed="tempos_operacao:0:tempo"]')).toHaveText('7h20');
});
