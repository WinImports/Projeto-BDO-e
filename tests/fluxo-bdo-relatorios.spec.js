// Login, herança do BDO-e para Visita / Execução, Objetivo protegido, Ação / Recomendação detalhada,
// poço sem busca/GPS/rotas fora do BDO-e e busca rápida no Histórico.
const { test, expect } = require('@playwright/test');
const { launchApp, fill, openTab, preencherVisita, entrar, cell, definirObjetivo } = require('./helpers');

const toast = (page) => page.locator('#toasts .toast').last();
const pad = (n) => String(n).padStart(2, '0');
const hojeBR = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };

/** Poço digitado livremente no BDO-e (sem base carregada nos testes). */
async function pocoNoBdo(page, poco) {
  await openTab(page, 'bdo');
  await fill(page, 'poco', poco);
  await page.locator('[data-field=poco]').press('Escape');
}

test.describe('login', () => {
  test('é a primeira tela sem sessão; a sessão fica salva e "Sair" volta para o login', async () => {
    const ctx = await launchApp({ login: false });
    const { page } = ctx;
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#tabs .tab')).toHaveCount(0);
    await expect(page.locator('[data-login-mode]')).toContainText('usuário local');

    // validação na própria tela
    await page.locator('#login-email').fill('tecnico@teste.com');
    await page.locator('#login-senha').fill('123');
    await page.locator('#login-submit').click();
    await expect(page.locator('#login-error')).toContainText('pelo menos 6 caracteres');

    await entrar(page, 'tecnico@teste.com', 'senha123');
    await expect(page.locator('#user-chip')).toContainText('tecnico');

    // reabrir o app: sem nova tela de login
    await ctx.close({ keepData: true });
    const ctx2 = await launchApp({ userData: ctx.userData, login: false });
    const p2 = ctx2.page;
    await expect(p2.locator('#tabs .tab').first()).toBeVisible();
    await expect(p2.locator('#login-form')).toHaveCount(0);

    // Configurações › Sair / Logout
    await openTab(p2, 'settings');
    await expect(p2.locator('#conta-section')).toContainText('tecnico@teste.com');
    await p2.getByRole('button', { name: 'Sair / Logout' }).click();
    await p2.locator('dialog.modal--confirm[open] [data-ok]').click();
    await expect(p2.locator('#login-form')).toBeVisible();

    // usuário local: senha errada não entra (login offline confere o hash guardado)
    await p2.locator('#login-email').fill('tecnico@teste.com');
    await p2.locator('#login-senha').fill('outrasenha');
    await p2.locator('#login-submit').click();
    await expect(p2.locator('#login-error')).toContainText('E-mail ou senha incorretos');
    await entrar(p2, 'TECNICO@teste.com', 'senha123');
    await expect(p2.locator('#user-chip')).toContainText('tecnico');
    await ctx2.close();
  });
});

test('desktop: credenciais do Supabase pelas variáveis de ambiente BDOE_SUPABASE_URL / BDOE_SUPABASE_ANON_KEY', async () => {
  const ctx = await launchApp({ login: false, env: { BDOE_SUPABASE_URL: 'https://env-teste.supabase.co', BDOE_SUPABASE_ANON_KEY: 'chave-env' } });
  const cfg = await ctx.page.evaluate(async () => (await import('./src/config.js')).supabaseConfig());
  expect(cfg).toEqual({ url: 'https://env-teste.supabase.co', anonKey: 'chave-env', origem: 'ambiente' });
  await expect(ctx.page.locator('[data-login-mode]')).not.toContainText('Servidor não configurado');
  await ctx.close();
});

test.describe('BDO-e → Visita Técnica / Relatório de Execução', () => {
  let ctx;
  test.beforeEach(async () => { ctx = await launchApp(); });
  test.afterEach(async () => { await ctx.close(); });

  test('Poço, Locação, Data e Cliente vêm do BDO-e; o que foi alterado à mão é mantido', async () => {
    const { page } = ctx;
    await pocoNoBdo(page, 'RCB-34');
    await fill(page, 'cliente', 'PETROBRAS');
    await fill(page, 'cidade_uf', 'Catu - BA');
    await fill(page, 'data', '2026-10-15');

    await openTab(page, 'visita_tecnica');
    await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-34');
    await expect(page.locator('[data-field=campo]')).toHaveValue('Catu - BA');
    await expect(page.locator('[data-field=data]')).toHaveValue('2026-10-15');
    await expect(page.locator('[data-field=cliente]')).toHaveValue('PETROBRAS');
    await expect(page.locator('[data-heranca]')).toContainText('poço RCB-34');

    await openTab(page, 'handover');
    await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-34');
    await expect(page.locator('[data-field=cliente]')).toHaveValue('PETROBRAS');
    await expect(page.locator('[data-field=data_hora]')).toHaveValue(/^2026-10-15T\d{2}:\d{2}$/);

    // campo alterado na Visita não é sobrescrito; os demais acompanham o BDO-e
    await openTab(page, 'visita_tecnica');
    await fill(page, 'campo', 'Campo de Buracica');
    await pocoNoBdo(page, 'FBM-89');
    await openTab(page, 'visita_tecnica');
    await expect(page.locator('[data-field=poco]')).toHaveValue('FBM-89');
    await expect(page.locator('[data-field=campo]')).toHaveValue('Campo de Buracica');
  });

  test('sem BDO-e com poço: aviso leva ao BDO-e; Visita e Execução não têm busca de poço nem rotas', async () => {
    const { page } = ctx;
    for (const tab of ['visita_tecnica', 'handover']) {
      await openTab(page, tab);
      await expect(page.locator('[data-heranca]')).toContainText('vêm do BDO-e');
      await page.locator('[data-field=poco]').fill('TST-001');
      await expect(page.locator('[data-combo], .combo__list, [data-pocos-hint]')).toHaveCount(0);
      await expect(page.locator('.geo, .geo__route, [data-action=gps]')).toHaveCount(0);
    }
    await page.locator('[data-heranca] [data-goto=bdo]').click();
    await page.locator('#view[data-ready=bdo]').waitFor();
    await expect(page.locator('[data-action=gps]')).toHaveCount(1);
  });

  test('Objetivo não aparece nos relatórios: é definido em Ajustes, por relatório, com o texto padrão como sugestão', async () => {
    const { page } = ctx;
    for (const tab of ['visita_tecnica', 'handover']) {
      await openTab(page, tab);
      await expect(page.locator('[data-field=objetivo]')).toHaveCount(0);
    }
    await openTab(page, 'settings');
    await expect(page.locator('#objetivos-section label[for=s-objetivo_visita]')).toHaveText('Objetivo do Relatório de Visita Técnica');
    await expect(page.locator('#objetivos-section label[for=s-objetivo_execucao]')).toHaveText('Objetivo do Relatório de Execução');
    await expect(page.locator('#s-objetivo_visita')).toHaveAttribute('placeholder', /^Avaliar as condições da cabeça de poço/);
    await expect(page.locator('#s-objetivo_execucao')).toHaveAttribute('placeholder', /^Executar a manutenção da cabeça de poço/);

    await definirObjetivo(page, 'execucao', 'Substituir a VA-1', 'handover');
    await fill(page, 'poco', 'RCB-34');
    await page.getByRole('button', { name: /Visualizar Prévia do Texto de abertura/ }).click();
    await expect(page.locator('dialog.modal--info[open] [data-info-text]')).toContainText('com o objetivo de substituir a VA-1');
  });

  test('Ação / Recomendação traz a instrução derivada do diagnóstico (Visita e Execução)', async () => {
    const { page } = ctx;
    await openTab(page, 'visita_tecnica');
    await expect(page.locator('[data-wrap=correcoes] th').first()).toHaveText('Ação / Recomendação');
    await fill(page, 'vc_estanqueidade', 'Sem estanqueidade (vazamento)');
    await page.locator('[data-field=vc_intervencao][value=Sim]').check();
    const linha = page.locator('[data-wrap=correcoes] tbody tr').last();
    await expect(linha.locator('[data-col=acao]')).toHaveValue('VC: Necessária a substituição da válvula devido à falta de estanqueidade');
    await expect(linha.locator('[data-col=detalhe]')).toHaveValue('Diagnóstico — Estanqueidade: Sem estanqueidade (vazamento); Necessita intervenção: Sim');

    // ajuste do técnico no detalhe é mantido enquanto o diagnóstico não muda
    await linha.locator('[data-col=detalhe]').fill('Válvula gaveta 2 1/16" 5.000 psi');
    await fill(page, 'vc_obs', 'Vazamento pela haste');
    await expect(linha.locator('[data-col=detalhe]')).toHaveValue('Válvula gaveta 2 1/16" 5.000 psi');

    await openTab(page, 'handover');
    await fill(page, 'va1_situacao', 'Sem estanqueidade (vazamento)');
    const pend = page.locator('[data-table=pendencias][data-col=descricao]');
    await expect.poll(() => pend.evaluateAll((els) => els.map((e) => e.value)))
      .toContain('VA-1: Necessária a substituição da válvula devido à falta de estanqueidade');
    await expect(toast(page)).toContainText('Adicionado às Pendências');
  });

  test('Histórico: busca rápida por poço, data ou tipo filtra a lista ao digitar', async () => {
    const { page } = ctx;
    for (const poco of ['FBM-89', 'RCB-34']) {
      await openTab(page, 'visita_tecnica');
      await preencherVisita(page, poco);
      await cell(page, 'equipe', 0, 'nome').fill('João');
      const id = await page.locator('.doc-head__meta code').innerText();
      await page.locator('#btn-finalize').click();
      await page.locator('dialog.modal[open] [data-local]').click();
      // o data-ready pode ser o de antes de finalizar: só o rascunho novo (outro ID) prova que terminou
      await expect(page.locator('.doc-head__meta code')).not.toHaveText(id);
      await page.locator('#view[data-ready=visita_tecnica]').waitFor();
    }
    await openTab(page, 'outbox');
    const busca = page.getByPlaceholder('Buscar por poço, cliente ou tipo...');
    const itens = page.locator('[data-history] .outbox-item');
    await expect(itens).toHaveCount(2);

    await busca.pressSequentially('rcb');
    await expect(itens).toHaveCount(1);
    await expect(itens.first()).toContainText('RCB-34');
    await expect(busca).toBeFocused(); // a lista muda sem redesenhar o campo

    await busca.fill(hojeBR());
    await expect(itens).toHaveCount(2);
    await busca.fill('visita tecnica fbm');
    await expect(itens).toHaveCount(1);
    await busca.fill('bdo');
    await expect(itens).toHaveCount(0);
    await expect(page.locator('[data-history-empty]')).toContainText('Nenhum relatório encontrado para "bdo"');
    await busca.fill('');
    await expect(itens).toHaveCount(2);
  });
});
