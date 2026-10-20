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
    window.__sb = { rpc: [], uploads: [], logins: [], signOuts: 0 };
    let online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    window.__setOnline = (v) => { online = v; window.dispatchEvent(new Event(v ? 'online' : 'offline')); };
    window.supabase.createClient = (url, key, opts) => {
      window.__sb.client = { url, key, auth: opts.auth };
      return {
        rpc: async (name, args) => {
          window.__sb.rpc.push({ name, args });
          if (name === 'submit_reports') return { status: 200, error: null, data: args.reports.map((r, i) => ({ unique_id: r.unique_id, id: i + 1 })) };
          return { status: 200, error: null, data: args.p_device_id };
        },
        storage: {
          from: (bucket) => ({
            upload: async (path) => { window.__sb.uploads.push({ bucket, path }); return { error: null }; },
            getPublicUrl: (path) => ({ data: { publicUrl: `${base}/storage/v1/object/public/${bucket}/${path}` } })
          })
        },
        auth: {
          signInWithPassword: async ({ email, password }) => {
            window.__sb.logins.push(email);
            return password === 'senha-certa'
              ? { data: { user: { id: 'u-1', user_metadata: { nome: 'Técnico Servidor' } }, session: {} }, error: null }
              : { data: {}, error: { status: 400, message: 'Invalid login credentials' } };
          },
          signOut: async () => { window.__sb.signOuts++; return { error: null }; },
          getSession: async () => ({ data: { session: null } })
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
  await expect(item.locator('.status')).toHaveText('Sincronizado');

  const sb = await page.evaluate(() => window.__sb);
  const envio = sb.rpc.find((c) => c.name === 'submit_reports').args.reports[0];
  expect(envio).toMatchObject({ module: 'visita_tecnica', user_email: 'tecnico@teste.com' });
  expect(envio.payload.poco).toBe('RCB-34');
  expect(envio.device_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(envio.photos[0].path).toMatch(/^visita_tecnica\/.+placa\.jpg$/); // fotos são comprimidas para JPEG ao entrar
  expect(sb.uploads).toContainEqual({ bucket: 'report-photos', path: envio.photos[0].path });
  expect(sb.rpc.find((c) => c.name === 'save_company_settings').args.p_settings).toMatchObject({ empresa_nome: 'WIN IMPORTS' });
});

test('com internet: PDF no report-share e o link vai na mensagem do WhatsApp', async () => {
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
  expect(decodeURIComponent(wa)).toContain(`Relatório completo: ${link}`);
  expect(await page.evaluate(() => window.__sb.uploads)).toContainEqual({ bucket: 'report-share', path: `visita_tecnica/${id}.pdf` });
});
