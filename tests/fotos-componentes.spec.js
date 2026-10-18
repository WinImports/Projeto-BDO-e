// Visita Técnica e Relatório de Execução: sequência cronológica do modelo oficial, um bloco de fotos
// por componente (legenda e "Figura N" no PDF), comparativo Antes (Visita) x Depois (Execução),
// relatórios no formato anterior e BDO intacto.
const { test, expect } = require('@playwright/test');
const { launchApp, fill, openTab, preencherVisita } = require('./helpers');

const toast = (page) => page.locator('#toasts .toast').last();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const foto = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const pad = (n) => String(n).padStart(2, '0');
const hojeBR = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };

/** Botão "Arquivo" de uma vaga de fotos (campo + legenda sugerida), opcionalmente na coluna "Depois". */
const vaga = (page, field, category, fase) =>
  page.locator(`input[data-kind=photos][data-photos-field="${field}"][data-category="${category}"]${fase ? `[data-fase="${fase}"]` : ''}`);

const ORDEM_VISITA = ['Cabeçalho', 'Chegada ao poço', 'Pressões', 'Antipoço', 'VC', 'VA-1', 'VA-2', 'VB-1', 'VB-2',
  'Flange superior', 'Flange inferior', 'Outras fotos', 'Recomendações'];
const BLOCOS_FOTOS = ['fotos_chegada', 'fotos_manometros', 'fotos_antepoco', 'fotos_vc', 'fotos_va1', 'fotos_va2',
  'fotos_vb1', 'fotos_vb2', 'fotos_flange_sup', 'fotos_flange_inf', 'fotos'];

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('Visita Técnica segue a sequência de campo, com um bloco de fotos em cada componente', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('#section-nav .section-nav__label')).toHaveText(ORDEM_VISITA);
  for (const id of BLOCOS_FOTOS) {
    await expect(page.locator(`[data-wrap="${id}"] input[data-kind=photos]`).first()).toBeAttached();
  }
  // o bloco de fotos fica DENTRO da seção do componente, logo abaixo dos campos dele
  const vc = page.locator('.form-section', { hasText: 'VC — Válvula da Coluna' });
  await expect(vc.locator('[data-field=vc_estanqueidade]')).toBeAttached();
  await expect(vc.locator('[data-wrap=fotos_vc] .photo-cat__title')).toHaveText(['Válvula da coluna (VC) (0)', 'Teste de estanqueidade / backup (0)']);
  await expect(page.locator('[data-wrap=fotos_vb1] .photo-cat__title').last()).toContainText('Teste com Enerpac');
  await expect(page.locator('[data-wrap=fotos_chegada] .photo-cat__title')).toHaveText(['Placa do poço (0)', 'Conjunto / Árvore de Natal (0)']);
  await expect(page.locator('[data-wrap=pressoes] .cell--locked')).toHaveText(['Coluna', 'Anular superior', 'Anular inferior']);
  // formato anterior não aparece no formulário
  await expect(page.locator('[data-wrap=valvulas]')).toHaveCount(0);
});

test('parágrafo de abertura é gerado a partir do cabeçalho', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await fill(page, 'poco', 'RCB-34');
  await fill(page, 'campo', 'Campo de Buracica');
  await fill(page, 'tecnicos', 'João, Maria');
  await fill(page, 'acompanhantes', 'operador Carlos');
  await fill(page, 'objetivo', 'Avaliar as válvulas e flanges.');
  await expect(page.locator('[data-computed-field=introducao]')).toHaveText(
    `No dia ${hojeBR()} fizemos uma visita técnica ao poço RCB-34, localizado em Campo de Buracica, com a equipe formada por João e Maria, acompanhados por operador Carlos, com o objetivo de avaliar as válvulas e flanges.`
  );
  await page.locator('#btn-preview').click();
  const prev = page.locator('dialog.modal[open]');
  await expect(prev.locator('.preview__item', { hasText: 'Introdução' })).toContainText('fizemos uma visita técnica ao poço RCB-34');
});

test('fotos ficam no bloco do componente, com legenda, e viram "Figura N" na ordem do relatório', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await vaga(page, 'fotos_vc', 'Teste de estanqueidade / backup').setInputFiles(foto('vc.png'));
  await vaga(page, 'fotos_chegada', 'Placa do poço').setInputFiles(foto('placa.png'));
  await vaga(page, 'fotos_flange_inf', 'Medição com paquímetro / trena').setInputFiles(foto('flange.png'));
  await expect(page.locator('[data-wrap=fotos_vc] .photo img')).toHaveCount(1);
  await expect(page.locator('[data-wrap=fotos_chegada] .photo img')).toHaveCount(1);
  await expect(page.locator('[data-wrap=fotos_va1] .photo img')).toHaveCount(0);

  await page.locator('[data-wrap=fotos_vc] .photo__caption').fill('Teste de estanqueidade da VC com backup');
  await page.locator('[data-wrap=fotos_vc] .photo__caption').blur();

  await page.locator('#btn-preview').click();
  const prev = page.locator('dialog.modal[open]');
  const figs = prev.locator('.preview__photos figcaption');
  await expect(figs).toHaveText([
    'Figura 1 — Placa do poço',
    'Figura 2 — Teste de estanqueidade da VC com backup',
    'Figura 3 — Medição com paquímetro / trena'
  ]);
  await expect(prev.locator('.preview__section', { hasText: 'VC — Válvula da Coluna' }).locator('figcaption')).toHaveText('Figura 2 — Teste de estanqueidade da VC com backup');
  await expect(prev.locator('.preview__section', { hasText: 'Flange inferior' }).locator('img')).toHaveCount(1);
  await prev.getByRole('button', { name: 'Voltar e editar' }).click();

  // remover a foto de um componente não mexe nos outros blocos
  await page.locator('[data-wrap=fotos_vc] [data-action=remove-photo]').click();
  await expect(page.locator('[data-wrap=fotos_vc] .photo img')).toHaveCount(0);
  await expect(page.locator('[data-wrap=fotos_chegada] .photo img')).toHaveCount(1);
});

test('Relatório de Execução traz as fotos da Visita como "Antes" em cada componente, ao lado do "Depois"', async () => {
  const { page } = ctx;
  // Visita Técnica finalizada com fotos da VC e da placa
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, 'TST-AD');
  await vaga(page, 'fotos_vc', 'Válvula da coluna (VC)').setInputFiles(foto('vc-antes.png'));
  await vaga(page, 'fotos_chegada', 'Placa do poço').setInputFiles(foto('placa.png'));
  await page.locator('[data-wrap=fotos_vc] .photo__caption').fill('VC com vazamento na haste');
  await page.locator('#btn-finalize').click();
  await page.locator('dialog.modal[open] [data-confirm]').click();
  await expect(toast(page)).toContainText('Caixa de Saída');

  await openTab(page, 'handover');
  await expect(page.locator('#section-nav .section-nav__label')).toContainText(['Cabeçalho', 'Consolidação 14x14', 'Chegada ao poço', 'Pressões', 'Antipoço', 'VC']);
  await fill(page, 'poco', 'TST-AD');
  await page.locator('[data-field=poco]').press('Tab');

  const vc = page.locator('[data-wrap=fotos_vc]');
  await expect(vc.locator('[data-fase=antes] img')).toHaveCount(1);
  await expect(vc.locator('[data-fase=antes] .photo-compare__title')).toContainText(`Antes — Visita Técnica de ${hojeBR()}`);
  await expect(vc.locator('[data-fase=antes] .photo__caption')).toHaveValue('VC com vazamento na haste');
  await expect(page.locator('[data-wrap=fotos_chegada] [data-fase=antes] img')).toHaveCount(1);
  await expect(page.locator('[data-wrap=fotos_va1] [data-fase=antes]')).toContainText('não tem fotos deste componente');

  // foto do "Depois" na VC
  await vaga(page, 'fotos_vc', 'Válvula da coluna (VC)', 'depois').setInputFiles(foto('vc-depois.png'));
  await expect(vc.locator('[data-fase=depois] img')).toHaveCount(1);
  await fill(page, 'vc_servico', 'Substituída a gaxeta da haste');
  await fill(page, 'vc_situacao', 'Estanque');

  await page.locator('#btn-preview').click();
  const bloco = page.locator('dialog.modal[open] .preview__photos[data-photos=fotos_vc]');
  await expect(bloco.locator('.photo-compare__col--antes figcaption')).toHaveText(/Figura \d+ — VC com vazamento na haste/);
  await expect(bloco.locator('.photo-compare__col--depois img')).toHaveCount(1);
  await expect(bloco.locator('.photo-compare__col--antes .photo-compare__title')).toContainText(hojeBR());
  await page.locator('dialog.modal[open]').getByRole('button', { name: 'Voltar e editar' }).click();

  // reabrir a tela não duplica as fotos "Antes"
  await openTab(page, 'bdo');
  await openTab(page, 'handover');
  await expect(page.locator('[data-wrap=fotos_vc] [data-fase=antes] img')).toHaveCount(1);
  await expect(page.locator('[data-wrap=fotos_vc] [data-fase=depois] img')).toHaveCount(1);
});

test('relatório no formato anterior continua completo na prévia (tabelas antigas e fotos em "Outras fotos")', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await page.evaluate(async (png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('bdo-e');
      req.onsuccess = () => {
        const tx = req.result.transaction('history', 'readwrite');
        tx.objectStore('history').put({
          uniqueId: 'antigo-visita', module: 'visita_tecnica', createdAt: new Date().toISOString(), photosCount: 1,
          data: { poco: 'LEG-01', data: '2026-01-10', valvulas: [{ item: 'VM (Válvula Mestra)', status: 'Vazamento / Sem Estanqueidade' }], estado_antepoco: 'Limpo' },
          photos: [{ name: 'm.png', type: 'image/png', blob, category: 'Manômetro Coluna' }]
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
    });
  }, PNG.toString('base64'));
  await openTab(page, 'outbox');
  await page.locator('[data-history] .outbox-item__main').click();
  const prev = page.locator('dialog.modal[open]');
  await expect(prev.locator('.preview__section', { hasText: 'Inspeção (formato anterior)' })).toContainText('Vazamento / Sem Estanqueidade');
  await expect(prev.locator('.preview__section', { hasText: 'Outras fotos' }).locator('figcaption')).toHaveText('Figura 1 — Manômetro Coluna');
});

test('BDO não foi alterado: mesmas seções e sem fotos', async () => {
  const { page } = ctx;
  await openTab(page, 'bdo');
  await expect(page.locator('#section-nav .section-nav__label')).toHaveText(['Cabeçalho', 'Apropriação', 'Paradas', 'Materiais', 'SMS & Segurança', 'Observações']);
  await expect(page.locator('input[data-kind=photos]')).toHaveCount(0);
});
