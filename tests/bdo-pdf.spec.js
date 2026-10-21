// PDF do BDO-e em página única: empresa prestadora dinâmica (Configurações; sem cadastro → "Empresa
// Prestadora"), indicadores, apropriação enxuta e resumo executivo sem repetir os horários do quadro.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, fill, openTab, cell } = require('./helpers');

const toast = (page) => page.locator('#toasts .toast').last();

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

/** Gera o PDF do BDO no aparelho e devolve o número de páginas. */
const paginas = (page, n, texto) => page.evaluate(async ({ n, texto }) => {
  const { buildPdfBlob } = await import('./src/ui/pdf-doc.js');
  const { default: module } = await import('./src/modules/bdo.js');
  const atividades = Array.from({ length: n }, (_, i) => {
    const h = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { data_inicio: '2026-10-20', data_fim: '2026-10-20', hora_inicio: h(360 + i * 25), hora_fim: h(385 + i * 25), atividade: `${texto} ${i + 1}` };
  });
  const data = {
    cliente: 'PETROBRAS', contrato: 'OS-MANS', poco: 'FBM-89', cidade_uf: 'Catu - BA', data: '2026-10-20', turno: 'Diurno',
    tecnico: 'ANDERSON', matricula: '1', equipe: [{ nome: 'Anderson', funcao: 'Técnico' }], km_total: '40', atividades,
    paradas: [{ inicio: '10:00', fim: '10:30', codigo: '5', motivo: 'Aguardando carro sugador' }], rpt: 'Sim', ocorrencia_sms: 'Não',
    observacoes: 'Sem pendências.'
  };
  const blob = await buildPdfBlob({ module, uniqueId: '00000000-0000-4000-8000-000000000000', data, company: null });
  const raw = new TextDecoder('latin1').decode(await blob.arrayBuffer());
  return (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
}, { n, texto });

test('turno comum e turno cheio (30 atividades longas) cabem em 1 página A4', async () => {
  const { page } = ctx;
  expect(await paginas(page, 8, 'Troca de válvula com teste de estanqueidade')).toBe(1);
  expect(await paginas(page, 30, 'Substituição dos prisioneiros do flange inferior com corrosão severa, teste com Enerpac e liberação da área para a fiscalização')).toBe(1);
});

test('resumo executivo: sem horários repetidos, sem atividades duplicadas e sem confundir válvula com poço', async () => {
  const { page } = ctx;
  const r = await page.evaluate(async () => {
    const { resumoParaPdf, indicadoresBdo } = await import('./src/ui/bdo-pdf.js');
    const { resumoBdo } = await import('./src/modules/resumo-bdo.js');
    const d = {
      data: '2026-10-20', poco: 'FBM-89', cidade_uf: 'Catu - BA', km_total: '86.4',
      atividades: [
        { hora_inicio: '07:00', hora_fim: '08:00', atividade: 'Deslocamento para o poço FBM-89' },
        { hora_inicio: '08:00', hora_fim: '09:00', atividade: 'Teste com Enerpac na VB-1' },
        { hora_inicio: '09:00', hora_fim: '10:00', atividade: 'Teste com Enerpac na VB-1' }
      ],
      paradas: []
    };
    d.resumo_atividades = resumoBdo(d);
    const manual = { ...d, resumo_atividades: 'Texto escrito pelo técnico.' };
    return { auto: resumoParaPdf(d), manual: resumoParaPdf(manual), kpis: indicadoresBdo(d), completo: d.resumo_atividades };
  });
  expect(r.auto).toBe('Jornada das 07:00 às 10:00 (3h00 apropriadas), no poço / locação FBM-89, em Catu - BA. Principais atividades: deslocamento para o poço FBM-89; teste com Enerpac na VB-1. Sem paradas operacionais.');
  expect(r.auto).not.toMatch(/\d{2}:\d{2} às \d{2}:\d{2},/); // horários de cada linha ficam só no quadro
  expect(r.completo).not.toContain('VB-1 e'); // VB-1 é válvula, não poço
  expect(r.manual).toBe('Texto escrito pelo técnico.'); // texto editado sai como está
  expect(r.kpis).toEqual([['KM rodado', '86,4 km'], ['Horas apropriadas', '3h00'], ['Horas paradas', '0h00'], ['Jornada', '07:00 – 10:00'], ['Atividades', '3']]);
});

test('cabeçalho: empresa das Configurações; sem cadastro sai "Empresa Prestadora"; desktop salva o PDF de 1 página', async () => {
  const { app, page, userData } = ctx;
  const pdfPath = path.join(userData, 'bdo.pdf');
  await app.evaluate(({ dialog, shell }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    shell.openPath = async () => '';
  }, pdfPath);

  await openTab(page, 'bdo');
  await fill(page, 'poco', 'FBM-89');
  await cell(page, 'atividades', 0, 'hora_inicio').fill('07:00');
  await cell(page, 'atividades', 0, 'hora_fim').fill('09:00');
  await cell(page, 'atividades', 0, 'atividade').fill('Troca da válvula VM');
  await page.locator('#btn-preview').click();
  const prev = page.locator('dialog.modal[open]');
  await expect(prev.locator('[data-empresa]')).toHaveText('Empresa Prestadora');
  await prev.locator('[data-pdf]').click();
  await expect(toast(page)).toContainText('PDF salvo', { timeout: 15_000 });
  const raw = fs.readFileSync(pdfPath).toString('latin1');
  expect(raw.slice(0, 5)).toBe('%PDF-');
  expect((raw.match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(1);
  await prev.getByRole('button', { name: 'Voltar e editar' }).click();

  // com a empresa cadastrada, o cabeçalho a usa (nada fixo no código)
  const { nome, comFallback } = await page.evaluate(async () => {
    const s = await import('./src/core/settings.js');
    s.saveSettings({ ...s.getSettings(), empresa_nome: 'WIN IMPORTS', empresa_cnpj: '12.345.678/0001-90' });
    return { nome: s.empresaDoRelatorio(s.companyInfo()).nome, comFallback: s.empresaDoRelatorio(null).nome };
  });
  expect(nome).toBe('WIN IMPORTS');
  expect(comFallback).toBe('Empresa Prestadora');
  await page.locator('#btn-preview').click();
  await expect(page.locator('dialog.modal[open] [data-empresa]')).toHaveText('WIN IMPORTS · CNPJ 12.345.678/0001-90');
});
