// BDO-e: "Resumo das Atividades Executadas" gerado a partir da Apropriação e das paradas, protegido
// ("Editar Resumo"), mantido quando editado à mão e regerado pelo botão; sai na prévia / PDF.
const { test, expect } = require('@playwright/test');
const { launchApp, openTab, cell } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('gerador: jornada, poços / locações, atividades em ordem e paradas', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  const texto = await page.evaluate(async () => {
    const { resumoBdo } = await import('./src/modules/resumo-bdo.js');
    return resumoBdo({
      data: '2026-10-19', turno: 'Diurno', poco: 'FBM-89', cidade_uf: 'Catu - BA',
      atividades: [
        { data_inicio: '2026-10-19', hora_inicio: '08:00', atividade: 'Troca da válvula VM', data_fim: '2026-10-19', hora_fim: '11:30' },
        { data_inicio: '2026-10-19', hora_inicio: '07:00', atividade: 'Deslocamento para o poço FBM-89', data_fim: '2026-10-19', hora_fim: '08:00' },
        { data_inicio: '2026-10-19', hora_inicio: '13:00', atividade: 'Seguindo para RCB-34', data_fim: '2026-10-19', hora_fim: '17:00' }
      ],
      paradas: [{ inicio: '10:00', fim: '10:30', codigo: '5', motivo: 'Aguardando carro sugador' }]
    });
  });
  expect(texto).toBe('No dia 19/10/2026 (turno Diurno), a jornada teve início às 07:00 e término às 17:00, totalizando 8h30 de atividades apropriadas. '
    + 'Poços / locações atendidos: FBM-89 e RCB-34, em Catu - BA. '
    + 'Principais atividades executadas: das 07:00 às 08:00, deslocamento para o poço FBM-89; das 08:00 às 11:30, troca da válvula VM; das 13:00 às 17:00, seguindo para RCB-34. '
    + 'Parada operacional: das 10:00 às 10:30 (0h30, código 5), aguardando carro sugador — total de 0h30 parado.');
  // sem paradas: o trecho de paradas não aparece; sem atividades: vazio
  const semParada = await page.evaluate(async () => (await import('./src/modules/resumo-bdo.js')).resumoBdo({ atividades: [{ hora_inicio: '07:00', atividade: 'Reunião de pré-tarefa', hora_fim: '07:30' }] }));
  expect(semParada).not.toContain('Parada');
  expect(await page.evaluate(async () => (await import('./src/modules/resumo-bdo.js')).resumoBdo({ atividades: [{}] }))).toBe('');
});

test('o resumo acompanha a apropriação; editado à mão fica como está até "Gerar de novo"', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  const resumo = page.locator('[data-field=resumo_atividades]');
  const status = page.locator('[data-autotext-status=resumo_atividades]');
  await expect(resumo).toHaveValue('');
  await expect(resumo).not.toBeEditable();

  await cell(page, 'atividades', 0, 'hora_inicio').fill('07:00');
  await cell(page, 'atividades', 0, 'atividade').fill('Reunião de pré-tarefa (RPT)');
  await cell(page, 'atividades', 0, 'hora_fim').fill('07:30');
  await page.locator('[data-action=add-row][data-table=atividades]').click();
  await cell(page, 'atividades', 1, 'atividade').fill('Troca da válvula VM');
  await cell(page, 'atividades', 1, 'hora_fim').fill('11:30');
  await cell(page, 'paradas', 0, 'inicio').fill('10:00');
  await cell(page, 'paradas', 0, 'fim').fill('10:30');
  await cell(page, 'paradas', 0, 'motivo').fill('Aguardando carro sugador');

  await expect(resumo).toHaveValue(/a jornada teve início às 07:00 e término às 11:30, totalizando 4h30/);
  await expect(resumo).toHaveValue(/das 07:00 às 07:30, reunião de pré-tarefa \(RPT\); das 07:30 às 11:30, troca da válvula VM\./);
  await expect(resumo).toHaveValue(/Parada operacional: das 10:00 às 10:30 \(0h30\), aguardando carro sugador/);
  await expect(status).toHaveText('Atualizado automaticamente com a apropriação.');
  await expect(page.locator('[data-action=regen-text]')).toBeHidden();

  // "Editar Resumo": acréscimo manual do técnico
  await page.getByRole('button', { name: 'Editar Resumo' }).click();
  await expect(resumo).toBeEditable();
  await resumo.press('End');
  await resumo.pressSequentially(' Equipe liberada às 11:30.');
  await page.getByRole('button', { name: 'Concluir edição' }).click();
  await expect(status).toHaveText('Editado manualmente: não é mais atualizado sozinho.');

  // nova atividade não apaga o texto editado
  await cell(page, 'atividades', 1, 'atividade').fill('Troca da válvula VM e teste de estanqueidade');
  await expect(resumo).toHaveValue(/Equipe liberada às 11:30\.$/);
  await expect(resumo).not.toHaveValue(/teste de estanqueidade/);

  await page.locator('[data-action=regen-text]').click();
  await expect(resumo).toHaveValue(/troca da válvula VM e teste de estanqueidade\./);
  await expect(resumo).not.toHaveValue(/Equipe liberada/);
  await expect(status).toHaveText('Atualizado automaticamente com a apropriação.');

  // vai para a prévia / PDF
  await page.locator('#btn-preview').click();
  await expect(page.locator('dialog.modal[open] .modal__body')).toContainText('Resumo das Atividades Executadas');
  await expect(page.locator('dialog.modal[open] .modal__body')).toContainText('troca da válvula VM e teste de estanqueidade');
});
