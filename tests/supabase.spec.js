// Integração com o Supabase (cliente simulado no lugar de window.supabase): servidor nas Configurações,
// login no Supabase Auth, fila offline ("Pendente de Envio" → "Sincronizado" ao voltar a internet),
// tabela por tipo no servidor, fotos no Storage e link do report-share na mensagem do WhatsApp.
const { test, expect } = require('@playwright/test');
const { launchApp, openTab, preencherVisita, entrar } = require('./helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const URL_TESTE = 'https://projeto-teste.supabase.co';

/** Troca o createClient do Supabase por um cliente falso que registra as chamadas em window.__sb. */
async function supabaseFalso(page) {
  await page.evaluate((base) => {
    window.__sb = { rpc: [], uploads: [], downloads: [], logins: [], signOuts: 0, session: null, equipe: [], contratos: ['OS-Mans'] };
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    let online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    window.__setOnline = (v) => { online = v; window.dispatchEvent(new Event(v ? 'online' : 'offline')); };
    window.supabase.createClient = (url, key, opts) => {
      window.__sb.client = { url, key, auth: opts.auth };
      return {
        rpc: async (name, args) => {
          window.__sb.rpc.push({ name, args });
          if (name === 'submit_reports') return { status: 200, error: null, data: args.reports.map((r, i) => ({ unique_id: r.unique_id, id: i + 1 })) };
          if (name === 'my_contracts') return { status: 200, error: null, data: window.__sb.contratos };
          if (name === 'list_team_reports') return { status: 200, error: null, data: window.__sb.equipe };
          if (name === 'my_company_settings') return { status: 200, error: null, data: window.__sb.empresa || null };
          return { status: 200, error: null, data: args.p_device_id };
        },
        storage: {
          from: (bucket) => ({
            upload: async (path) => { window.__sb.uploads.push({ bucket, path }); return { error: null }; },
            download: async (path) => { window.__sb.downloads.push({ bucket, path }); return { data: new Blob([png], { type: 'image/png' }), error: null }; },
            getPublicUrl: (path) => ({ data: { publicUrl: `${base}/storage/v1/object/public/${bucket}/${path}` } })
          })
        },
        auth: {
          signInWithPassword: async ({ email, password }) => {
            window.__sb.logins.push(email);
            if (password !== 'senha-certa') return { data: {}, error: { status: 400, message: 'Invalid login credentials' } };
            window.__sb.session = { user: { email } };
            return { data: { user: { id: 'u-1', user_metadata: { nome: 'Técnico Servidor' } }, session: window.__sb.session }, error: null };
          },
          signOut: async () => { window.__sb.signOuts++; window.__sb.session = null; return { error: null }; },
          getSession: async () => ({ data: { session: window.__sb.session } })
        }
      };
    };
  }, URL_TESTE);
}

async function configurarServidor(page, key = 'chave-anon-de-teste') {
  await openTab(page, 'settings');
  await page.locator('[data-server=url]').fill(URL_TESTE);
  await page.locator('[data-server=key]').fill(key);
  await page.locator('[data-action=save-server]').click();
}

/** Sair e entrar de novo (agora com o servidor configurado → login no Supabase Auth). */
async function reentrar(page, email = 'tecnico@teste.com') {
  await openTab(page, 'settings');
  await page.getByRole('button', { name: 'Sair / Logout' }).click();
  await page.locator('dialog.modal--confirm[open] [data-ok]').click();
  await entrar(page, email, 'senha-certa');
}

/** Relatório gravado no servidor por outro técnico do contrato (linha de list_team_reports). */
const daEquipe = (id, module, payload, photos = [], autor = 'colega@empresa.com', dias = 2) => ({
  unique_id: id, module, payload: { contrato: 'OS-Mans', ...payload }, photos, contrato: 'OS-Mans', user_email: autor,
  client_created_at: new Date(Date.now() - dias * 864e5).toISOString(), received_at: new Date(Date.now() - dias * 864e5 + 6e4).toISOString()
});

let ctx;
test.beforeEach(async () => {
  ctx = await launchApp();
  await supabaseFalso(ctx.page);
});
test.afterEach(async () => { await ctx.close(); });

test('servidor nas Configurações (recusa a chave secreta) e login no Supabase Auth com sessão salva', async () => {
  const { page } = ctx;
  await openTab(page, 'settings');
  await expect(page.locator('[data-servidor-status]')).toContainText('Servidor não configurado');

  // chave service_role (JWT com role service_role) nunca pode ir para o aparelho
  const secreta = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y`;
  await configurarServidor(page, secreta);
  await expect(page.locator('[data-wrap=supabase_key] .field__error')).toContainText('chave secreta');

  await configurarServidor(page);
  await expect(page.locator('[data-servidor-status]')).toContainText(`Configurado neste aparelho: ${URL_TESTE}`);
  await expect(page.locator('#conn')).not.toContainText('Somente local');
  await expect(page.locator('[data-conta-vincular]')).toBeVisible(); // entrou como usuário local antes do servidor

  // Sair e entrar de novo: agora pelo Supabase Auth
  await page.getByRole('button', { name: 'Sair / Logout' }).click();
  await page.locator('dialog.modal--confirm[open] [data-ok]').click();
  await expect(page.locator('#login-form')).toBeVisible();
  await page.locator('#login-email').fill('tecnico@teste.com');
  await page.locator('#login-senha').fill('senha-errada');
  await page.locator('#login-submit').click();
  await expect(page.locator('#login-error')).toContainText('E-mail ou senha incorretos');
  await entrar(page, 'tecnico@teste.com', 'senha-certa');
  await expect(page.locator('#user-chip')).toContainText('Técnico Servidor');

  const sb = await page.evaluate(() => window.__sb);
  expect(sb.logins).toEqual(['tecnico@teste.com', 'tecnico@teste.com']);
  expect(sb.signOuts).toBeGreaterThan(0);
  expect(sb.client.auth).toMatchObject({ persistSession: true, autoRefreshToken: true }); // sessão do Supabase guardada no aparelho
  await openTab(page, 'settings');
  await expect(page.locator('#conta-section')).toContainText('Conta confirmada no servidor');
  await expect(page.locator('[data-conta-vincular]')).toHaveCount(0);
});

test('sem internet o relatório fica "Pendente de Envio"; ao voltar a conexão sobe sozinho e fica "Sincronizado"', async () => {
  const { page } = ctx;
  await configurarServidor(page);
  await page.evaluate(() => window.__setOnline(false));
  await page.locator('[data-setting=empresa_nome]').fill('WIN IMPORTS'); // configurações também esperam a conexão
  await page.locator('[data-action=save]').click();

  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, 'RCB-34');
  await page.locator('input[data-kind=photos]').first().setInputFiles({ name: 'placa.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#btn-finalize').click();
  await page.locator('dialog.modal[open] [data-confirm]').click();
  await page.locator('#view[data-ready=visita_tecnica]').waitFor();
  await expect(page.locator('.share-prompt__link, [data-share-link]')).toHaveCount(0); // offline: mensagem sem link

  await openTab(page, 'outbox');
  const item = page.locator('[data-history] .outbox-item').first();
  await expect(item.locator('.status')).toHaveText('Pendente de Envio');
  expect(await page.evaluate(() => window.__sb.rpc.filter((c) => c.name === 'submit_reports').length)).toBe(0);

  await page.evaluate(() => window.__setOnline(true)); // evento "online" dispara o envio da fila
  // o envio gera o PDF e o Word do relatório antes do submit_reports (~2-3 s; mais com a máquina carregada)
  await expect(item.locator('.status')).toHaveText('Sincronizado', { timeout: 15_000 });

  const sb = await page.evaluate(() => window.__sb);
  const envio = sb.rpc.find((c) => c.name === 'submit_reports').args.reports[0];
  expect(envio).toMatchObject({ module: 'visita_tecnica', user_email: 'tecnico@teste.com' });
  expect(envio.payload.poco).toBe('RCB-34');
  expect(envio.device_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(envio.photos[0].path).toMatch(/^visita_tecnica\/.+placa\.jpg$/); // fotos são comprimidas para JPEG ao entrar
  expect(sb.uploads).toContainEqual({ bucket: 'report-photos', path: envio.photos[0].path });
  expect(sb.rpc.find((c) => c.name === 'save_company_settings').args.p_settings).toMatchObject({ empresa_nome: 'WIN IMPORTS' });
});

test('com internet: PDF e Word no report-share e os links vão na mensagem do WhatsApp', async () => {
  const { page } = ctx;
  await configurarServidor(page);
  await openTab(page, 'visita_tecnica');
  await preencherVisita(page, 'FBM-89');
  const curto = await page.locator('.doc-head__meta code').innerText(); // 8 primeiros caracteres do uniqueId
  await page.locator('#btn-finalize').click();
  await page.locator('dialog.modal[open] [data-confirm]').click();

  const shareLink = page.locator('[data-share-link]');
  await expect(shareLink).toHaveText(new RegExp(`^${URL_TESTE}/storage/v1/object/public/report-share/visita_tecnica/${curto}[0-9a-f-]{28}\\.pdf$`), { timeout: 20_000 });
  const link = await shareLink.innerText();
  const id = link.split('/').pop().replace('.pdf', '');
  const wa = await page.locator('[data-share-whatsapp]').getAttribute('href');
  expect(decodeURIComponent(wa)).toContain(`Relatório completo (PDF): ${link}`);
  expect(decodeURIComponent(wa)).toContain(`Versão Word (.docx): ${link.replace(/.pdf$/, '.docx')}`);
  const uploads = await page.evaluate(() => window.__sb.uploads);
  expect(uploads).toContainEqual({ bucket: 'report-share', path: `visita_tecnica/${id}.pdf` });
  expect(uploads).toContainEqual({ bucket: 'report-share', path: `visita_tecnica/${id}.docx` });
  // envio e WhatsApp compartilham a mesma geração: cada arquivo sobe uma vez só
  expect(uploads.filter((u) => u.path === `visita_tecnica/${id}.docx`)).toHaveLength(1);
});

test('histórico da equipe: login baixa os relatórios do contrato (30 dias) com fotos; outro usuário não vê', async () => {
  const { page } = ctx;
  const hoje = new Date().toISOString().slice(0, 10);
  const VISITA = 'e0000000-0000-4000-8000-000000000001';
  const BDO = 'e0000000-0000-4000-8000-000000000002';
  const linhas = [
    daEquipe(VISITA, 'visita_tecnica', { poco: 'RCB-34', data: hoje, cliente: 'PETROBRAS', objetivo: 'Avaliar', equipe: [{ nome: 'Colega', funcao: 'Técnico' }] },
      [{ path: `visita_tecnica/${VISITA}/01-placa.jpg`, category: 'Placa do poço', name: 'placa.jpg', field: 'fotos_chegada' }]),
    daEquipe(BDO, 'bdo', { poco: 'RCB-34', data: hoje, cidade_uf: 'Catu - BA', cliente: 'PETROBRAS', atividades: [{ hora_inicio: '07:00', atividade: 'Troca da VA-1', hora_fim: '12:00' }] }, [], 'colega@empresa.com', 1)
  ];
  await page.evaluate((l) => { window.__sb.equipe = l; }, linhas);
  await configurarServidor(page);
  await reentrar(page);

  const sb = () => page.evaluate(() => window.__sb);
  await expect.poll(async () => (await sb()).rpc.filter((c) => c.name === 'list_team_reports').length).toBeGreaterThan(0);
  const pedido = (await sb()).rpc.find((c) => c.name === 'list_team_reports').args.p_since;
  expect(Math.round((Date.now() - Date.parse(pedido)) / 864e5)).toBe(30); // janela de 30 dias

  await openTab(page, 'outbox');
  const itens = page.locator('[data-history] .outbox-item--team');
  await expect(itens).toHaveCount(2);
  await expect(itens.first().locator('.status')).toHaveText('Da equipe');
  await expect(itens.first().locator('[data-autor]')).toHaveText('por colega@empresa.com');
  await expect(page.locator('[data-equipe-status]')).toContainText('Histórico da equipe (OS-Mans): 2 relatórios de outros técnicos');
  expect((await sb()).downloads).toEqual([{ bucket: 'report-photos', path: `visita_tecnica/${VISITA}/01-placa.jpg` }]);
  // relatório da equipe: só consulta (sem Editar / Enviar)
  await expect(itens.locator('[data-action=edit], [data-action=edit-local], [data-action=send]')).toHaveCount(0);

  // consulta offline: abre a Visita da equipe com a foto baixada
  await page.evaluate(() => window.__setOnline(false));
  await page.locator('[data-history] .outbox-item--team', { hasText: 'Visita' }).locator('.outbox-item__main').click();
  await expect(page.locator('dialog.modal[open] img').first()).toBeVisible();
  await page.locator('dialog.modal[open] .icon-btn[data-close]').click();

  // Execução da turma seguinte: poço do último BDO-e (da equipe) e fotos "Antes" da Visita da equipe
  await openTab(page, 'handover');
  await expect(page.locator('[data-field=poco]')).toHaveValue('RCB-34');
  await expect(page.locator('[data-wrap=fotos_chegada] img')).toHaveCount(1);

  // voltou a internet: baixa o que chegou no servidor nesse meio-tempo
  await page.evaluate((l) => { window.__sb.equipe.push(l); }, daEquipe('e0000000-0000-4000-8000-000000000003', 'bdo', { poco: 'FBM-89', data: hoje }, [], 'outro@empresa.com', 0));
  await page.evaluate(() => window.__setOnline(true));
  await openTab(page, 'outbox');
  await expect(itens).toHaveCount(3);

  // outro técnico (sem contrato) entra neste aparelho: não vê o que foi baixado para o anterior
  await page.evaluate(() => { window.__sb.equipe = []; window.__sb.contratos = []; });
  await reentrar(page, 'visitante@outra.com');
  await openTab(page, 'outbox');
  await expect(page.locator('[data-history] .outbox-item--team')).toHaveCount(0);
  await expect(page.locator('[data-equipe-status]')).toContainText('não está cadastrada em nenhum contrato');
});

test('empresa do cabeçalho vem do servidor (company_settings) para o técnico logado num aparelho novo', async () => {
  const { page } = ctx;
  const atualizado = new Date(Date.now() - 3600e3).toISOString();
  await page.evaluate((u) => {
    window.__sb.empresa = { updated_at: u, settings: { empresa_nome: 'WIN IMPORTS', empresa_cnpj: '12.345.678/0001-90', cliente_padrao: 'PETROBRAS', contrato_padrao: 'OS-Mans' } };
  }, atualizado);
  await configurarServidor(page);
  await reentrar(page);

  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bdoe.settings') || '{}').empresa_nome), { timeout: 15_000 }).toBe('WIN IMPORTS');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('bdoe.settings')));
  expect(s).toMatchObject({ empresa_cnpj: '12.345.678/0001-90', contrato_padrao: 'OS-Mans', syncPending: false });
  await openTab(page, 'bdo');
  await page.locator('#btn-preview').click();
  await expect(page.locator('dialog.modal[open] [data-empresa]')).toContainText('WIN IMPORTS');
});
