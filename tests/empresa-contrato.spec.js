// Empresa e logo POR CONTRATO (migração 003; core/contratos.js › empresaParaContrato, app.js › companyChipHtml,
// ui/equipe-view.js › empresa do contrato): trocar o contrato do relatório troca a logo; contrato sem empresa
// definida não mostra a logo de outro contrato; nas Configurações a empresa fica só para consulta; o gestor grava
// a empresa do contrato (team_set_company). Servidor sem a migração → continua valendo a das Configurações.
const { test, expect } = require('@playwright/test');
const { launchApp, openTab, entrar } = require('./helpers');

const URL_TESTE = 'https://projeto-teste.supabase.co';
const LOGO_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const LOGO_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Supabase simulado: my_access / my_contract_companies a partir de window.__sb; registra as chamadas. */
async function supabaseFalso(page, { acesso, empresas }) {
  await page.evaluate(({ acesso, empresas }) => {
    window.__sb = { rpc: [], args: {}, session: null, acesso, empresas };
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.supabase.createClient = () => ({
      rpc: async (name, args) => {
        window.__sb.rpc.push(name);
        window.__sb.args[name] = args;
        const sb = window.__sb;
        if (name === 'my_access') return { status: 200, error: null, data: sb.acesso };
        if (name === 'my_contract_companies') {
          return sb.empresas === 'sem-migracao'
            ? { status: 404, error: { code: 'PGRST202', message: 'Could not find the function public.my_contract_companies' }, data: null }
            : { status: 200, error: null, data: sb.empresas };
        }
        if (name === 'team_list') return { status: 200, error: null, data: { contrato_id: args.p_contrato_id, max_technicians: 2, tecnicos_ativos: 0, membros: [] } };
        if (name === 'team_set_company') {
          const e = { id: args.p_contrato_id, nome: 'OS-Mans', empresa_nome: args.p_nome, empresa_cnpj: args.p_cnpj, empresa_logo: args.p_logo, atualizada_em: new Date().toISOString() };
          return { status: 200, error: null, data: e };
        }
        if (name === 'list_team_reports') return { status: 200, error: null, data: [] };
        if (name === 'my_company_settings') return { status: 200, error: null, data: null };
        return { status: 200, error: null, data: args?.p_device_id ?? null };
      },
      storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: 'sem' } }), getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: {
        signInWithPassword: async ({ email }) => {
          window.__sb.session = { user: { email } };
          return { data: { user: { id: 'u-1', user_metadata: {} }, session: window.__sb.session }, error: null };
        },
        signOut: async () => { window.__sb.session = null; return { error: null }; },
        getSession: async () => ({ data: { session: window.__sb.session } }),
        updateUser: async () => ({ data: {}, error: null })
      }
    });
  }, { acesso, empresas });
}

async function entrarComConta(page) {
  await openTab(page, 'settings');
  await page.locator('[data-server=url]').fill(URL_TESTE);
  await page.locator('[data-server=key]').fill('chave-anon-de-teste');
  await page.locator('[data-action=save-server]').click();
  await page.getByRole('button', { name: 'Sair / Logout' }).click();
  await page.locator('dialog.modal--confirm[open] [data-ok]').click();
  await entrar(page, 'tecnico@teste.com', 'senha-certa');
  await expect.poll(() => page.evaluate(() => window.__sb.rpc.includes('my_contract_companies'))).toBe(true);
}

const ACESSO = (role = 'tecnico') => ({ contratos: [
  { id: 'c-a', nome: 'OS-Mans', role },
  { id: 'c-b', nome: 'Contrato Bahia Terra', role: 'tecnico' },
  { id: 'c-c', nome: 'Contrato Sem Empresa', role: 'tecnico' }
] });
const EMPRESAS = [
  { id: 'c-a', nome: 'OS-Mans', empresa_nome: 'Empresa A', empresa_cnpj: '', empresa_logo: LOGO_A, atualizada_em: '2026-10-24T10:00:00Z' },
  { id: 'c-b', nome: 'Contrato Bahia Terra', empresa_nome: 'Empresa B', empresa_cnpj: '', empresa_logo: LOGO_B, atualizada_em: '2026-10-24T10:00:00Z' },
  { id: 'c-c', nome: 'Contrato Sem Empresa', empresa_nome: '', empresa_cnpj: '', empresa_logo: '', atualizada_em: null }
];

const chip = (page) => page.locator('.doc-head .company-chip');
const campo = (page) => page.locator('[data-field=contrato]');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('trocar o contrato troca a logo; contrato sem empresa não mostra a logo de outro; a das Configurações não vale mais', async () => {
  const { page } = ctx;
  // logo antiga nas Configurações do aparelho (era o que vazava para os outros contratos)
  await page.evaluate((logo) => localStorage.setItem('bdoe.settings', JSON.stringify({ empresa_nome: 'Logo Antiga', empresa_logo: logo })), LOGO_B);
  await supabaseFalso(page, { acesso: ACESSO(), empresas: EMPRESAS });
  await entrarComConta(page);

  await openTab(page, 'bdo');
  await campo(page).selectOption('OS-Mans');
  await expect(chip(page)).toContainText('Empresa A');
  await expect(chip(page).locator('img')).toHaveAttribute('src', LOGO_A);

  await campo(page).selectOption('Contrato Bahia Terra');
  await expect(chip(page)).toContainText('Empresa B');
  await expect(chip(page).locator('img')).toHaveAttribute('src', LOGO_B);

  await campo(page).selectOption('Contrato Sem Empresa');
  await expect(chip(page)).toContainText('Empresa do contrato não definida');
  await expect(chip(page).locator('img')).toHaveCount(0);
  await expect(chip(page)).not.toContainText('Logo Antiga');

  // a prévia segue o contrato do relatório
  await campo(page).selectOption('OS-Mans');
  await page.locator('#btn-preview').click();
  await expect(page.locator('dialog.modal[open] [data-empresa]')).toContainText('Empresa A');
  await expect(page.locator('dialog.modal[open] [data-empresa] img')).toHaveAttribute('src', LOGO_A);
  await page.locator('dialog.modal[open] [data-back]').click();

  // Configurações: empresa só para consulta, por contrato (sem o campo da logo do aparelho)
  await openTab(page, 'settings');
  await expect(page.locator('[data-empresa-por-contrato]')).toBeVisible();
  await expect(page.locator('[data-setting=empresa_nome]')).toHaveCount(0);
  await expect(page.locator('[data-empresa-contrato="Contrato Sem Empresa"]')).toContainText('não definida');
  // salvar as Configurações continua funcionando (sem pedir o nome da empresa)
  await page.locator('[data-action=save]').click();
  await expect(page.locator('.toast').last()).toContainText('Configurações salvas');
});

test('gestor grava a empresa do contrato em Gestão de Equipe e o cabeçalho já usa a nova', async () => {
  const { page } = ctx;
  await supabaseFalso(page, { acesso: ACESSO('gestor'), empresas: EMPRESAS });
  await entrarComConta(page);

  await openTab(page, 'equipe');
  await expect(page.locator('[data-empresa-form]')).toContainText('Empresa do contrato OS-Mans');
  await expect(page.locator('#eq-empresa-nome')).toHaveValue('Empresa A');
  await page.locator('#eq-empresa-nome').fill('Empresa A Renomeada');
  await page.locator('[data-action=remover-logo-empresa]').click();
  await expect(page.locator('[data-empresa-preview] img')).toHaveCount(0);
  await page.locator('#eq-salvar-empresa').click();
  await expect(page.locator('.toast').last()).toContainText('Empresa do contrato salva');
  expect(await page.evaluate(() => window.__sb.args.team_set_company)).toEqual({ p_contrato_id: 'c-a', p_nome: 'Empresa A Renomeada', p_cnpj: '', p_logo: '' });

  await openTab(page, 'bdo');
  await campo(page).selectOption('OS-Mans');
  await expect(chip(page)).toContainText('Empresa A Renomeada');
  await expect(chip(page).locator('img')).toHaveCount(0);
});

test('servidor sem a migração 003: continua valendo a empresa das Configurações', async () => {
  const { page } = ctx;
  await page.evaluate((logo) => localStorage.setItem('bdoe.settings', JSON.stringify({ empresa_nome: 'Empresa do Aparelho', empresa_logo: logo })), LOGO_A);
  await supabaseFalso(page, { acesso: ACESSO(), empresas: 'sem-migracao' });
  await entrarComConta(page);
  await openTab(page, 'bdo');
  await campo(page).selectOption('Contrato Bahia Terra');
  await expect(chip(page)).toContainText('Empresa do Aparelho');
  await expect(chip(page).locator('img')).toHaveAttribute('src', LOGO_A);
  await openTab(page, 'settings');
  await expect(page.locator('[data-setting=empresa_nome]')).toHaveValue('Empresa do Aparelho');
});
