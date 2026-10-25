// Fase 3 no app (Supabase simulado): login por e-mail OU matrícula, troca de senha obrigatória no 1º acesso,
// aba "Gestão de Equipe" só para gestor (cota "X de Y liberados", cadastro pela Edge Function, ativar/desativar),
// busca sem limite no histórico do servidor e mensagem clara quando o servidor recusa um envio.
const { test, expect } = require('@playwright/test');
const { launchApp, openTab, entrar, abrirAvancado } = require('./helpers');

const URL_TESTE = 'https://projeto-teste.supabase.co';
const CONTRATO = { id: '11111111-1111-4111-8111-111111111111', nome: 'OS-Mans' };

/** Supabase simulado. Tudo configurável em window.__sb (usuarios, matriculas, acesso, equipe, busca...). */
async function supabaseFalso(page, cfg) {
  await page.evaluate((c) => {
    const norm = (t) => String(t ?? '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');
    window.__sb = { rpc: [], invocacoes: [], updates: [], session: null, bloqueado: false, ...c };
    let online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    window.__setOnline = (v) => { online = v; window.dispatchEvent(new Event(v ? 'online' : 'offline')); };
    const sb = window.__sb;
    const contarAtivos = () => sb.equipe.membros.filter((m) => m.role === 'tecnico' && m.ativo).length;
    const comCota = () => ({ ...sb.equipe, tecnicos_ativos: contarAtivos() });
    window.supabase.createClient = () => ({
      rpc: async (name, args = {}) => {
        sb.rpc.push({ name, args });
        if (name === 'login_matricula') {
          if (sb.bloqueado) return { data: { ok: false, bloqueado: true }, error: null };
          const email = sb.matriculas[norm(args.p_matricula)];
          const ok = email && sb.usuarios[email]?.senha === args.p_senha;
          return { data: ok ? { ok: true, email } : { ok: false, bloqueado: false }, error: null };
        }
        if (name === 'my_access') return { data: sb.acesso, error: null };
        if (name === 'my_contracts') return { data: sb.acesso.contratos.map((x) => x.nome), error: null };
        if (name === 'team_list') return { data: comCota(), error: null };
        if (name === 'team_set_active') {
          sb.equipe.membros.find((m) => m.id === args.p_member_id).ativo = args.p_ativo;
          return { data: comCota(), error: null };
        }
        if (name === 'search_team_reports') {
          const antes = args.p_before ? Date.parse(args.p_before) : Infinity;
          const q = String(args.p_query || '').toLowerCase();
          const lista = sb.busca.filter((r) => Date.parse(r.client_created_at) < antes && (!q || JSON.stringify(r.payload).toLowerCase().includes(q)));
          return { data: lista.slice(0, args.p_limit), error: null };
        }
        if (name === 'submit_reports') {
          const aceitos = args.reports.filter((r) => !r.payload.contrato || sb.acesso.contratos.some((x) => x.nome === r.payload.contrato));
          return { status: 200, error: null, data: aceitos.map((r, i) => ({ unique_id: r.unique_id, id: i + 1 })) };
        }
        if (name === 'list_team_reports') return { status: 200, error: null, data: [] };
        if (name === 'my_company_settings') return { status: 200, error: null, data: null };
        return { status: 200, error: null, data: args.p_device_id ?? null };
      },
      functions: {
        invoke: async (name, { body }) => {
          sb.invocacoes.push({ name, body });
          if (sb.erroInvoke) {
            return { data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ ok: false, erro: sb.erroInvoke })) } };
          }
          sb.equipe.membros.push({ id: `m-${sb.equipe.membros.length + 1}`, nome: body.name, email: body.email, matricula: body.matricula, role: 'tecnico', ativo: true });
          return { data: { ok: true, conta_criada: true, equipe: comCota() }, error: null };
        }
      },
      storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: new Blob(['x'], { type: 'image/png' }), error: null }), getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
      auth: {
        signInWithPassword: async ({ email, password }) => {
          const u = sb.usuarios[email];
          if (!u || u.senha !== password) return { data: {}, error: { status: 400, message: 'Invalid login credentials' } };
          sb.session = { user: { email } };
          return { data: { user: { id: `u-${email}`, user_metadata: { ...u.meta } }, session: sb.session }, error: null };
        },
        updateUser: async ({ password, data }) => {
          const email = sb.session?.user?.email;
          sb.updates.push({ email, password, data });
          sb.usuarios[email].senha = password;
          Object.assign(sb.usuarios[email].meta, data);
          return { data: {}, error: null };
        },
        signOut: async () => { sb.session = null; return { error: null }; },
        getSession: async () => ({ data: { session: sb.session } })
      }
    });
  }, cfg);
}

async function configurarServidor(page) {
  await openTab(page, 'settings');
  await abrirAvancado(page);
  await page.locator('[data-server=url]').fill(URL_TESTE);
  await page.locator('[data-server=key]').fill('chave-anon-de-teste');
  await page.locator('[data-action=save-server]').click();
}

/** Sai e volta para a tela de login (sem entrar). */
async function sair(page) {
  await openTab(page, 'settings');
  await page.getByRole('button', { name: 'Sair / Logout' }).click();
  await page.locator('dialog.modal--confirm[open] [data-ok]').click();
  await page.locator('#login-form').waitFor();
}

/** A tela de login cobre o app (o #view continua com o data-ready de antes): espera ela sumir de fato. */
async function aguardarEntrada(page) {
  await expect(page.locator('#login')).toHaveCount(0);
  await page.locator('#view[data-ready]').waitFor();
}

async function digitarLogin(page, id, senha) {
  await page.locator('#login-email').fill(id);
  await page.locator('#login-senha').fill(senha);
  await page.locator('#login-submit').click();
}

const tecnico = { 'maria@empresa.com': { senha: 'inicial123', meta: { nome: 'Maria da Silva', matricula: 'T-010', must_change_password: true } } };

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('login por matrícula com troca de senha obrigatória no 1º acesso; depois entra pela matrícula sem internet', async () => {
  const { page } = ctx;
  await supabaseFalso(page, { usuarios: structuredClone(tecnico), matriculas: { T010: 'maria@empresa.com' }, acesso: { contratos: [{ ...CONTRATO, role: 'tecnico' }] }, equipe: { membros: [] }, busca: [] });
  await configurarServidor(page);
  await sair(page);
  await expect(page.locator('label[for=login-email]')).toHaveText('E-mail ou matrícula');

  await digitarLogin(page, 'T-010', 'errada12');
  await expect(page.locator('#login-error')).toHaveText('Matrícula ou senha incorretos.');
  await page.evaluate(() => { window.__sb.bloqueado = true; });
  await digitarLogin(page, 'T-010', 'inicial123');
  await expect(page.locator('#login-error')).toContainText('Muitas tentativas com esta matrícula');
  await page.evaluate(() => { window.__sb.bloqueado = false; });

  // matrícula digitada com outra pontuação: "t 010" = "T-010"
  await digitarLogin(page, 't 010', 'inicial123');
  await expect(page.locator('#troca-senha-form')).toBeVisible();
  expect(await page.evaluate(() => window.__sb.rpc.find((c) => c.name === 'login_matricula').args)).toEqual({ p_matricula: 'T-010', p_senha: 'errada12' });
  await expect(page.locator('#tabs .tab')).toHaveCount(5); // o app fica coberto, não dá para pular
  await expect(page.locator('#troca-senha')).toBeVisible();

  await page.locator('#nova-senha').fill('curta');
  await page.locator('#nova-senha-2').fill('curta');
  await page.locator('#troca-senha-submit').click();
  await expect(page.locator('#troca-senha-erro')).toHaveText('A nova senha precisa ter pelo menos 8 caracteres.');
  await page.locator('#nova-senha').fill('MinhaSenha#2026');
  await page.locator('#nova-senha-2').fill('OutraSenha#2026');
  await page.locator('#troca-senha-submit').click();
  await expect(page.locator('#troca-senha-erro')).toHaveText('A confirmação não é igual à nova senha.');
  await page.locator('#nova-senha-2').fill('MinhaSenha#2026');
  await page.locator('#troca-senha-submit').click();
  await expect(page.locator('#troca-senha')).toHaveCount(0);
  await expect(page.locator('#view[data-ready]')).toBeVisible();
  expect(await page.evaluate(() => window.__sb.updates)).toEqual([{ email: 'maria@empresa.com', password: 'MinhaSenha#2026', data: { must_change_password: false } }]);

  // sem internet: entra pela matrícula com a NOVA senha (guardada neste aparelho), sem pedir troca de novo
  await sair(page);
  await page.evaluate(() => window.__setOnline(false));
  await digitarLogin(page, 'T-010', 'inicial123');
  await expect(page.locator('#login-error')).toHaveText('Matrícula ou senha incorretos.');
  await digitarLogin(page, 'T-010', 'MinhaSenha#2026');
  await expect(page.locator('#login')).toHaveCount(0);
  await expect(page.locator('#troca-senha')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bdoe.auth.session')))).toMatchObject({ email: 'maria@empresa.com', modo: 'offline', matricula: 'T-010' });
});

test('técnico não vê a Gestão de Equipe e não abre pela aba salva; gestor vê', async () => {
  const { page } = ctx;
  const cfg = { usuarios: { 'tec@empresa.com': { senha: 'senha-certa', meta: {} } }, matriculas: {}, acesso: { contratos: [{ ...CONTRATO, role: 'tecnico' }] }, equipe: { membros: [] }, busca: [] };
  await supabaseFalso(page, cfg);
  await configurarServidor(page);
  await sair(page);
  await digitarLogin(page, 'tec@empresa.com', 'senha-certa');
  await aguardarEntrada(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bdoe.contratos'))?.vinculos)).toEqual([{ ...CONTRATO, role: 'tecnico' }]);
  await expect(page.locator('#tabs [data-tab=equipe]')).toHaveCount(0);

  // "rota" salva: a aba lembrada não abre para técnico
  await page.evaluate(() => localStorage.setItem('bdoe.pref.tab', JSON.stringify('equipe')));
  await page.reload();
  await page.locator('#view[data-ready]').waitFor();
  await expect(page.locator('#view')).not.toHaveAttribute('data-ready', 'equipe');
  await expect(page.locator('#tabs [data-tab=equipe]')).toHaveCount(0);

  // o mesmo usuário vira gestor no servidor → a aba aparece na próxima sincronização
  await supabaseFalso(page, { ...cfg, acesso: { contratos: [{ ...CONTRATO, role: 'gestor' }] } });
  await page.evaluate(async () => {
    window.__sb.session = { user: { email: 'tec@empresa.com' } };
    (await import('./src/core/supabase.js')).resetClient(); // o app recarregado já tinha criado o cliente real
  });
  await page.evaluate(async () => (await import('./src/core/sync.js')).syncNow({ force: true }));
  await expect(page.locator('#tabs [data-tab=equipe]')).toBeVisible();
});

test('Gestão de Equipe: cota "X de Y liberados", cadastro pela Edge Function, limite bloqueia o botão, desativar libera a vaga', async () => {
  const { page } = ctx;
  await supabaseFalso(page, {
    usuarios: { 'gestor@empresa.com': { senha: 'senha-certa', meta: { nome: 'Gestor' } } }, matriculas: {},
    acesso: { contratos: [{ ...CONTRATO, role: 'gestor' }] }, busca: [],
    equipe: { contrato_id: CONTRATO.id, contrato: 'OS-Mans', max_technicians: 2, membros: [
      { id: 'm-g', nome: 'Gestor', email: 'gestor@empresa.com', matricula: 'G-1', role: 'gestor', ativo: true },
      { id: 'm-1', nome: 'Técnico Um', email: 'um@empresa.com', matricula: 'T-001', role: 'tecnico', ativo: true }
    ] }
  });
  await configurarServidor(page);
  await sair(page);
  await digitarLogin(page, 'gestor@empresa.com', 'senha-certa');
  await page.locator('#tabs [data-tab=equipe]').waitFor();
  await openTab(page, 'equipe');

  await expect(page.locator('[data-cota-texto]')).toHaveText('Técnicos cadastrados: 1 de 2 liberados');
  await expect(page.locator('#eq-cadastrar')).toBeEnabled();
  await expect(page.locator('[data-equipe-lista] tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-membro=m-g] [data-action]')).toHaveCount(0); // gestor não é alterado aqui

  await page.locator('#eq-nome').fill('Maria da Silva');
  await page.locator('#eq-matricula').fill('T-010');
  await page.locator('#eq-email').fill('maria@empresa.com');
  await page.locator('[data-action=gerar-senha]').click();
  const senha = await page.locator('#eq-senha').inputValue();
  expect(senha).toMatch(/^[A-Za-z2-9]{10}$/);
  await page.locator('#eq-cadastrar').click();
  await expect(page.locator('#toasts')).toContainText('Maria da Silva foi cadastrado');
  expect(await page.evaluate(() => window.__sb.invocacoes)).toEqual([{ name: 'create-technician', body: { name: 'Maria da Silva', matricula: 'T-010', email: 'maria@empresa.com', contrato_id: CONTRATO.id, password: senha } }]);

  // 2 de 2: botão desabilitado e aviso para o Master
  await expect(page.locator('[data-cota-texto]')).toHaveText('Técnicos cadastrados: 2 de 2 liberados');
  await expect(page.locator('#eq-cadastrar')).toBeDisabled();
  await expect(page.locator('[data-cota-aviso]')).toHaveText('Limite de técnicos liberados atingido. Entre em contato com o Master para ampliar a licença.');

  // desativar um técnico libera a vaga
  await page.locator('[data-membro=m-1] [data-action=desativar]').click();
  await page.locator('dialog.modal--confirm[open] [data-ok]').click();
  await expect(page.locator('[data-membro=m-1] [data-membro-status]')).toHaveText('Desativado');
  await expect(page.locator('[data-cota-texto]')).toHaveText('Técnicos cadastrados: 1 de 2 liberados');
  await expect(page.locator('#eq-cadastrar')).toBeEnabled();

  // erro da Edge Function: a mensagem do servidor aparece e o formulário mantém o que foi digitado
  await page.evaluate(() => { window.__sb.erroInvoke = 'Matrícula T-777 já está cadastrada para outra pessoa.'; });
  await page.locator('#eq-nome').fill('João Souza');
  await page.locator('#eq-matricula').fill('T-777');
  await page.locator('#eq-email').fill('joao@empresa.com');
  await page.locator('#eq-senha').fill('inicial123');
  await page.locator('#eq-cadastrar').click();
  await expect(page.locator('#toasts')).toContainText('Matrícula T-777 já está cadastrada para outra pessoa.');
  await expect(page.locator('#eq-nome')).toHaveValue('João Souza');
});

test('histórico sem limite: busca no servidor todo o acervo do contrato (anos atrás), em páginas, e abre a prévia', async () => {
  const { page } = ctx;
  const agora = Date.now();
  const busca = Array.from({ length: 60 }, (_, i) => ({
    unique_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, module: 'bdo', contrato: 'OS-Mans', user_email: 'colega@empresa.com',
    payload: { poco: i === 59 ? 'ANTIGO-1' : `P-${i}`, data: new Date(agora - i * 20 * 864e5).toISOString().slice(0, 10), contrato: 'OS-Mans', cliente: 'PETROBRAS' },
    photos: [], client_created_at: new Date(agora - i * 20 * 864e5).toISOString(), received_at: new Date(agora - i * 20 * 864e5).toISOString()
  }));
  await supabaseFalso(page, { usuarios: { 'tec@empresa.com': { senha: 'senha-certa', meta: {} } }, matriculas: {}, acesso: { contratos: [{ ...CONTRATO, role: 'tecnico' }] }, equipe: { membros: [] }, busca });
  await configurarServidor(page);
  await sair(page);
  await digitarLogin(page, 'tec@empresa.com', 'senha-certa');
  await aguardarEntrada(page);
  await openTab(page, 'outbox');

  // nada neste aparelho, mas a busca no servidor está disponível
  await expect(page.locator('[data-history-search]')).toBeVisible();
  await page.locator('[data-action=server-search]').click();
  await expect(page.locator('[data-history-server-list] .outbox-item')).toHaveCount(50);
  await page.locator('[data-action=server-more]').click();
  await expect(page.locator('[data-history-server-list] .outbox-item')).toHaveCount(60); // ~3 anos atrás
  await expect(page.locator('[data-action=server-more]')).toHaveCount(0);
  const chamadas = await page.evaluate(() => window.__sb.rpc.filter((c) => c.name === 'search_team_reports').map((c) => c.args));
  expect(chamadas[0]).toMatchObject({ p_query: '', p_module: null, p_before: null, p_limit: 50 });
  expect(chamadas[1].p_before).toBe(busca[49].client_created_at);

  // busca por texto: a lista do servidor recomeça
  await page.locator('[data-history-search]').fill('antigo');
  await expect(page.locator('[data-action=server-search]')).toHaveText(/Buscar "antigo" no servidor/);
  await page.locator('[data-action=server-search]').click();
  await expect(page.locator('[data-history-server-list] .outbox-item')).toHaveCount(1);
  await page.locator('[data-history-server-list] [data-action=view]').first().click();
  await expect(page.locator('dialog.modal[open]')).toContainText('ANTIGO-1');
});

test('envio recusado pelo servidor (contrato que não é da conta): mensagem clara no Histórico', async () => {
  const { page } = ctx;
  await supabaseFalso(page, { usuarios: { 'tec@empresa.com': { senha: 'senha-certa', meta: {} } }, matriculas: {}, acesso: { contratos: [{ ...CONTRATO, role: 'tecnico' }] }, equipe: { membros: [] }, busca: [] });
  await configurarServidor(page);
  await sair(page);
  await digitarLogin(page, 'tec@empresa.com', 'senha-certa');
  await aguardarEntrada(page);
  await page.evaluate(async () => {
    const { enqueue } = await import('./src/core/outbox.js');
    await enqueue({ uniqueId: crypto.randomUUID(), module: 'visita_tecnica', data: { poco: 'X-1', contrato: 'CONTRATO ANTIGO' }, photos: [] });
    await (await import('./src/core/sync.js')).syncNow({ force: true });
  });
  await openTab(page, 'outbox');
  await expect(page.locator('.outbox-item__error')).toBeVisible();
  const erro = await page.evaluate(async () => (await (await import('./src/core/outbox.js')).list())[0].lastError);
  expect(erro).toBe('O servidor não aceitou este relatório: o contrato "CONTRATO ANTIGO" não está vinculado à sua conta. Peça ao gestor do contrato para vincular você.');
});

test('login por e-mail continua funcionando (usuário local sem servidor)', async () => {
  const { page } = ctx;
  await sair(page);
  await entrar(page, 'outro@teste.com', 'senha123');
  await expect(page.locator('#tabs [data-tab=equipe]')).toHaveCount(0);
});
