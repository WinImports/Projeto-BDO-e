// Campo "Contrato" como lista dos contratos do usuário logado (core/contratos.js + ui/contrato-campo.js):
// my_contracts() é baixado ao entrar / sincronizar e guardado no aparelho (funciona offline). Cenários:
// 1 contrato (já vem selecionado), vários (padrão das Configurações), nenhum (desabilitado + aviso, salva
// mesmo assim), offline (lista guardada) e edição de relatório antigo (valor fora da lista é mantido).
const { test, expect } = require('@playwright/test');
const { launchApp, openTab, entrar, abrirAvancado } = require('./helpers');

const URL_TESTE = 'https://projeto-teste.supabase.co';
const AVISO = 'Nenhum contrato vinculado à sua conta. Peça ao administrador para cadastrar.';

/** Supabase simulado: my_contracts devolve window.__sb.contratos; registra as chamadas em window.__sb.rpc. */
async function supabaseFalso(page, contratos) {
  await page.evaluate((lista) => {
    window.__sb = { rpc: [], session: null, contratos: lista };
    let online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    window.__setOnline = (v) => { online = v; window.dispatchEvent(new Event(v ? 'online' : 'offline')); };
    window.supabase.createClient = () => ({
      rpc: async (name, args) => {
        window.__sb.rpc.push(name);
        if (name === 'my_contracts') return { status: 200, error: null, data: window.__sb.contratos };
        if (name === 'list_team_reports') return { status: 200, error: null, data: [] };
        if (name === 'my_company_settings') return { status: 200, error: null, data: null };
        if (name === 'submit_reports') return { status: 200, error: null, data: args.reports.map((r, i) => ({ unique_id: r.unique_id, id: i + 1 })) };
        return { status: 200, error: null, data: args?.p_device_id ?? null };
      },
      storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: 'sem' } }), getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
      auth: {
        signInWithPassword: async ({ email }) => {
          window.__sb.session = { user: { email } };
          return { data: { user: { id: 'u-1', user_metadata: {} }, session: window.__sb.session }, error: null };
        },
        signOut: async () => { window.__sb.session = null; return { error: null }; },
        getSession: async () => ({ data: { session: window.__sb.session } })
      }
    });
  }, contratos);
}

/** Configura o servidor e entra de novo com a conta (login no Supabase → baixa my_contracts). */
async function entrarComConta(page) {
  await openTab(page, 'settings');
  await abrirAvancado(page);
  await page.locator('[data-server=url]').fill(URL_TESTE);
  await page.locator('[data-server=key]').fill('chave-anon-de-teste');
  await page.locator('[data-action=save-server]').click();
  await page.getByRole('button', { name: 'Sair / Logout' }).click();
  await page.locator('dialog.modal--confirm[open] [data-ok]').click();
  await entrar(page, 'tecnico@teste.com', 'senha-certa');
  await expect.poll(() => page.evaluate(() => window.__sb.rpc.includes('my_contracts'))).toBe(true);
}

const campo = (page) => page.locator('[data-field=contrato]');
const opcoes = (page) => campo(page).locator('option').allTextContents();
const guardada = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('bdoe.contratos')));

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('normalização igual à do servidor (_norm_contrato): separadores viram um espaço, sem separador é outro contrato', async () => {
  const r = await ctx.page.evaluate(async () => {
    const { normContrato, contratoDaLista } = await import('./src/core/contratos.js');
    const iguais = ['Os Mans', 'OS-MANS', 'os.mans', 'os_mans', '  os -- mans  ', 'OS\tMANS'].map(normContrato);
    return {
      iguais,
      semSeparador: normContrato('OSMANS'),
      acento: normContrato('Manutenção - Água Grande'),
      vazio: normContrato(null),
      daLista: contratoDaLista('os.mans', ['OS-Mans', 'OSMANS']),
      semSepDaLista: contratoDaLista('osmans', ['OS-Mans'])
    };
  });
  expect(new Set(r.iguais)).toEqual(new Set(['OS MANS']));
  expect(r.semSeparador).toBe('OSMANS');
  expect(r.acento).toBe('MANUTENÇÃO ÁGUA GRANDE');
  expect(r.vazio).toBe('');
  expect(r.daLista).toBe('OS-Mans');
  expect(r.semSepDaLista).toBeNull();
});

test('um contrato: já vem selecionado nos três relatórios e nas Configurações', async () => {
  const { page } = ctx;
  await supabaseFalso(page, ['OS-Mans']);
  await entrarComConta(page);
  expect(await guardada(page)).toMatchObject({ email: 'tecnico@teste.com', lista: ['OS-Mans'] });

  await openTab(page, 'bdo');
  await expect(page.locator('[data-wrap=contrato] .req')).toHaveCount(1); // com contrato, obrigatório no BDO
  for (const tab of ['bdo', 'visita_tecnica', 'handover']) {
    await openTab(page, tab);
    await expect(campo(page)).toHaveJSProperty('tagName', 'SELECT');
    await expect(campo(page)).toBeEnabled();
    await expect(campo(page)).toHaveValue('OS-Mans');
    expect(await opcoes(page)).toEqual(['Selecione o contrato…', 'OS-Mans']);
  }
  await openTab(page, 'settings');
  await expect(page.locator('[data-setting=contrato_padrao]')).toBeEnabled();
  expect(await page.locator('[data-setting=contrato_padrao] option').allTextContents()).toEqual(['Selecione o contrato…', 'OS-Mans']);
});

test('vários contratos: lista em ordem; o contrato padrão das Configurações vem selecionado (mesma regra do servidor)', async () => {
  const { page } = ctx;
  // padrão antigo digitado à mão: "os manutec.ne" é o mesmo contrato que "OS-MANUTEC NE" para o servidor
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('bdoe.settings') || '{}');
    localStorage.setItem('bdoe.settings', JSON.stringify({ ...s, contrato_padrao: 'os manutec.ne' }));
  });
  await supabaseFalso(page, ['OS-Mans', 'OS-MANUTEC NE', 'Contrato Bahia Terra']);
  await entrarComConta(page);

  await openTab(page, 'bdo');
  expect(await opcoes(page)).toEqual(['Selecione o contrato…', 'Contrato Bahia Terra', 'OS-Mans', 'OS-MANUTEC NE']);
  await expect(campo(page)).toHaveValue('OS-MANUTEC NE');
  await campo(page).selectOption('OS-Mans');
  await openTab(page, 'visita_tecnica'); // grava o rascunho do BDO ao trocar de aba
  await openTab(page, 'bdo');
  await expect(campo(page)).toHaveValue('OS-Mans'); // a escolha do técnico fica

  // Configurações: escolhe outro padrão → vale para relatórios novos
  await openTab(page, 'settings');
  await page.locator('[data-setting=contrato_padrao]').selectOption('Contrato Bahia Terra');
  await page.locator('[data-setting=empresa_nome]').fill('WIN IMPORTS'); // obrigatório para salvar
  await page.locator('[data-action=save]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bdoe.settings')).contrato_padrao)).toBe('Contrato Bahia Terra');
  await openTab(page, 'handover');
  await expect(campo(page)).toHaveValue('Contrato Bahia Terra');
});

test('nenhum contrato: campo vazio e desabilitado com aviso; o relatório salva mesmo assim', async () => {
  const { page } = ctx;
  // usuário local (sem conta no servidor): lista vazia
  await openTab(page, 'bdo');
  await expect(campo(page)).toBeDisabled();
  await expect(campo(page)).toHaveValue('');
  await expect(page.locator('[data-wrap=contrato] [data-contratos-aviso]')).toHaveText(AVISO);
  await expect(page.locator('[data-wrap=contrato] .req')).toHaveCount(0); // sem asterisco: não é exigido
  // o Contrato é obrigatório no BDO, mas sem contrato vinculado não bloqueia a finalização
  const erros = await page.evaluate(async () => {
    const { validate } = await import('./src/ui/form.js');
    const { getModule } = await import('./src/modules/index.js');
    return validate(getModule('bdo'), {}).map((e) => e.field);
  });
  expect(erros).not.toContain('contrato');
  expect(erros.length).toBeGreaterThan(0); // os outros obrigatórios continuam valendo

  // conta no servidor sem contrato em contract_members: mesmo comportamento, e nas Configurações também
  await supabaseFalso(page, []);
  await entrarComConta(page);
  await openTab(page, 'visita_tecnica');
  await expect(campo(page)).toBeDisabled();
  await expect(page.locator('[data-wrap=contrato] [data-contratos-aviso]')).toHaveText(AVISO);
  await openTab(page, 'settings');
  await expect(page.locator('[data-setting=contrato_padrao]')).toBeDisabled();
  await expect(page.locator('[data-wrap=contrato_padrao] [data-contratos-aviso]')).toHaveText(AVISO);

  // com contrato vinculado, o obrigatório volta a valer
  const comLista = await page.evaluate(async () => {
    const { guardarContratos } = await import('./src/core/contratos.js');
    guardarContratos(['OS-Mans']);
    const { validate } = await import('./src/ui/form.js');
    const { getModule } = await import('./src/modules/index.js');
    return validate(getModule('bdo'), {}).map((e) => e.field);
  });
  expect(comLista).toContain('contrato');
});

test('offline: usa a lista guardada no aparelho, também depois de reabrir o app sem internet', async () => {
  const { page } = ctx;
  await supabaseFalso(page, ['OS-Mans', 'OS-MANUTEC NE']);
  await entrarComConta(page);

  // sem internet: o servidor mudou, mas a sincronização não roda — fica a lista guardada
  await page.evaluate(() => { window.__setOnline(false); window.__sb.contratos = ['Outro']; });
  await page.evaluate(async () => (await import('./src/core/sync.js')).syncNow({ force: true }));
  await openTab(page, 'handover');
  expect(await opcoes(page)).toEqual(['Selecione o contrato…', 'OS-Mans', 'OS-MANUTEC NE']);

  // reabre o app sem rede: a lista vem do aparelho
  await ctx.app.context().setOffline(true);
  await page.reload();
  await page.waitForSelector('#view[data-ready]');
  await openTab(page, 'visita_tecnica');
  await expect(campo(page)).toBeEnabled();
  expect(await opcoes(page)).toEqual(['Selecione o contrato…', 'OS-Mans', 'OS-MANUTEC NE']);
  await ctx.app.context().setOffline(false);
});

test('edição de relatório antigo: contrato fora da lista continua como opção extra; variação de escrita vira o nome da lista', async () => {
  const { page } = ctx;
  await supabaseFalso(page, ['OS-Mans']);
  await entrarComConta(page);

  // dois relatórios salvos só no aparelho, de antes da lista (texto livre)
  await page.evaluate(async () => {
    const { saveLocalOnly } = await import('./src/core/outbox.js');
    await saveLocalOnly({ uniqueId: crypto.randomUUID(), module: 'visita_tecnica', data: { poco: 'ANT-01', contrato: 'CONTRATO-ANTIGO 2024' }, photos: [] });
    await saveLocalOnly({ uniqueId: crypto.randomUUID(), module: 'handover', data: { poco: 'ANT-02', contrato: 'os mans' }, photos: [] });
  });

  await openTab(page, 'outbox');
  await page.locator('.outbox-item', { hasText: 'ANT-01' }).locator('[data-action=edit]').click();
  const substituir = page.locator('dialog.modal--confirm[open] [data-ok]');
  if (await substituir.isVisible().catch(() => false)) await substituir.click();
  await page.locator('#view[data-ready=visita_tecnica]').waitFor();
  await expect(campo(page)).toHaveValue('CONTRATO-ANTIGO 2024');
  expect(await opcoes(page)).toEqual(['Selecione o contrato…', 'OS-Mans', 'CONTRATO-ANTIGO 2024 (não vinculado à sua conta)']);
  // o dado não se perde: continua no rascunho
  const rascunho = await page.evaluate(async () => (await (await import('./src/core/drafts.js')).loadDraft('visita_tecnica')).data.contrato);
  expect(rascunho).toBe('CONTRATO-ANTIGO 2024');

  await openTab(page, 'outbox');
  await page.locator('.outbox-item', { hasText: 'ANT-02' }).locator('[data-action=edit]').click();
  if (await substituir.isVisible().catch(() => false)) await substituir.click();
  await page.locator('#view[data-ready=handover]').waitFor();
  await expect(campo(page)).toHaveValue('OS-Mans');
  expect(await opcoes(page)).toEqual(['Selecione o contrato…', 'OS-Mans']);
});
