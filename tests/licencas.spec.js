// Painel de Licenças Multi-App (/licencas/): página web servida por HTTP local, com o Supabase do
// projeto de licenciamento SIMULADO (o servidor de teste troca ../src/vendor/supabase.js por um mock).
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

// Mock do supabase-js: tabelas em memória + RPCs; cada chamada fica em window.__calls
const MOCK = `(() => {
  const dia = 864e5, agora = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const db = {
    apps: [{ id: 'a1', code: 'winapp-os', name: 'WinAppOS Desktop' }, { id: 'a2', code: 'bdo-e', name: 'BDO-e SaaS' }, { id: 'a3', code: 'novo-app', name: 'Novo App' }],
    clients: [
      { id: 'c1', name: 'Perbras', email: 'ti@perbras.com', phone: '71999990000', document: '11222333000181', created_at: iso(agora - 90 * dia) },
      { id: 'c2', name: '<img src=x data-xss>Cliente', email: null, phone: null, document: null, created_at: iso(agora - 10 * dia) }
    ],
    licenses: [
      { id: 'l1', license_key: 'WOS-AAAA-1111', app_id: 'a1', client_id: 'c1', status: 'active', max_devices: 3, starts_at: iso(agora - 30 * dia), expires_at: iso(agora + 200 * dia), created_at: iso(agora - 30 * dia) },
      { id: 'l2', license_key: 'BDO-BBBB-2222', app_id: 'a2', client_id: 'c1', status: 'blocked', max_devices: 1, starts_at: iso(agora - 20 * dia), expires_at: iso(agora + 100 * dia), created_at: iso(agora - 20 * dia) },
      { id: 'l3', license_key: 'BDO-CCCC-3333', app_id: 'a2', client_id: 'c2', status: 'active', max_devices: 2, starts_at: iso(agora - 400 * dia), expires_at: iso(agora - 5 * dia), created_at: iso(agora - 400 * dia) }
    ],
    license_devices: [
      { id: 'd1', license_id: 'l1', device_id: 'PC-CAMPO-01', device_name: 'Notebook Campo', activated_at: iso(agora - 20 * dia), last_seen_at: iso(agora - 3600e3) },
      { id: 'd2', license_id: 'l1', device_id: 'IPH-02', device_name: 'iPhone Técnico', activated_at: iso(agora - 10 * dia), last_seen_at: iso(agora - 9 * dia) }
    ],
    license_logs: [{ id: 'g1', license_id: 'l1', event_type: 'license_created', details: { by: 'admin@winapp.com' }, created_at: iso(agora - 30 * dia) }]
  };
  const calls = window.__calls = [];
  const enrich = {
    licenses: (l) => ({ ...l, apps: db.apps.find((a) => a.id === l.app_id) || null, clients: db.clients.find((c) => c.id === l.client_id) || null,
      license_devices: [{ count: db.license_devices.filter((d) => d.license_id === l.id).length }] }),
    license_logs: (g) => ({ ...g, licenses: db.licenses.find((l) => l.id === g.license_id) || null })
  };
  const from = (table) => {
    const q = { op: 'select', filters: [] };
    const run = () => {
      calls.push({ table, op: q.op, filters: q.filters, row: q.row });
      const casa = (r) => q.filters.every(([c, v]) => r[c] === v);
      if (q.op === 'insert') { const row = { id: 'novo-' + db[table].length, created_at: iso(Date.now()), ...q.row }; db[table].push(row); return { data: q.single ? row : [row], error: null }; }
      if (q.op === 'delete') { const fora = db[table].filter(casa); db[table] = db[table].filter((r) => !casa(r)); return { data: fora.map((r) => ({ id: r.id })), error: null }; }
      return { data: db[table].filter(casa).map(enrich[table] || ((r) => r)), error: null };
    };
    const api = {
      select: () => api, order: () => api, limit: () => api,
      single: () => { q.single = true; return api; },
      eq: (c, v) => { q.filters.push([c, v]); return api; },
      insert: (row) => { q.op = 'insert'; q.row = row; return api; },
      delete: () => { q.op = 'delete'; return api; },
      then: (ok, falha) => Promise.resolve().then(run).then(ok, falha)
    };
    return api;
  };
  const rpc = async (nome, args) => {
    calls.push({ rpc: nome, args });
    const log = (id, tipo) => db.license_logs.unshift({ id: 'g' + db.license_logs.length + 1, license_id: id, event_type: tipo, details: args, created_at: iso(Date.now()) });
    if (nome === 'create_license') {
      const app = db.apps.find((a) => a.code === args.p_app_code);
      const l = { id: 'l-novo', license_key: 'NEW-KEY-9999', app_id: app.id, client_id: args.p_client_id, status: 'active', max_devices: args.p_max_devices,
        starts_at: iso(Date.now()), expires_at: iso(Date.now() + args.p_duration_days * dia), created_at: iso(Date.now()) };
      db.licenses.unshift(l); log(l.id, 'license_created');
      return { data: { license_key: l.license_key }, error: null };
    }
    const l = db.licenses.find((x) => x.id === args.p_license_id);
    if (nome === 'renew_license') { l.expires_at = iso(Math.max(Date.now(), Date.parse(l.expires_at)) + args.p_days * dia); log(l.id, 'license_renewed'); return { data: true, error: null }; }
    if (nome === 'set_license_status') { l.status = args.p_status; log(l.id, 'status_changed'); return { data: true, error: null }; }
    return { data: null, error: { code: 'PGRST202', message: 'função ' + nome } };
  };
  let session = null;
  const subs = [];
  const avisar = (ev) => subs.forEach((cb) => cb(ev, session));
  const auth = {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: (cb) => { subs.push(cb); setTimeout(() => cb('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithPassword: async ({ email, password }) => {
      if (password !== 'segredo123') return { data: {}, error: { status: 400, message: 'Invalid login credentials' } };
      session = { user: { id: 'u1', email } }; avisar('SIGNED_IN');
      return { data: { session }, error: null };
    },
    signOut: async () => { session = null; avisar('SIGNED_OUT'); return { error: null }; }
  };
  window.supabase = { createClient: (url, key, opts) => { window.__client = { url, key, storageKey: opts && opts.auth && opts.auth.storageKey }; return { from, rpc, auth }; } };
})();`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1);
      if (rel === 'src/vendor/supabase.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(MOCK); }
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const metrica = (page, titulo) => page.locator(`[data-metrica="${titulo}"]`);
const linha = (page, chave) => page.locator('tr[data-licenca]', { hasText: chave });
const confirmarDialogo = (page) => page.locator('#modal-confirmar [data-resposta=sim]').click();

test('painel de licenças: login, métricas, filtro por app, licenças, dispositivos, clientes e auditoria', async () => {
  const server = await startServer();
  const ctx = await launchApp();
  try {
    const [page] = await Promise.all([
      ctx.app.waitForEvent('window'),
      ctx.app.evaluate(({ BrowserWindow }, u) => {
        const w = new BrowserWindow({ show: false, width: 1366, height: 900, webPreferences: { sandbox: true, contextIsolation: true } });
        w.loadURL(u);
      }, `http://127.0.0.1:${server.address().port}/licencas/`)
    ]);
    // CDNs (Tailwind / Font Awesome) não são necessários para o teste
    await page.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/, (r) => r.abort());
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // ---- login
    await page.locator('#form-login').waitFor();
    expect(await page.evaluate(() => window.__client)).toEqual({
      url: 'https://gdqkontotzaexknuprac.supabase.co', key: 'sb_publishable_a6VfOUiGfOm492OZFgN7yg_P4rdAVnY', storageKey: 'winappos.licencas.auth'
    });
    await page.locator('#login-email').fill('admin@winapp.com');
    await page.locator('#login-senha').fill('errada1');
    await page.locator('#form-login [type=submit]').click();
    await expect(page.locator('#login-erro')).toHaveText('E-mail ou senha incorretos.');
    await page.locator('#login-senha').fill('segredo123');
    await page.locator('#form-login [type=submit]').click();
    await expect(page.locator('#tela-painel')).toBeVisible();
    await expect(page.locator('#usuario')).toHaveText('admin@winapp.com');

    // ---- métricas (todos os apps): l1 ativa, l2 bloqueada, l3 expirada; 2 dispositivos
    await expect(metrica(page, 'Total de Licenças')).toHaveText('3');
    await expect(metrica(page, 'Licenças Ativas')).toHaveText('1');
    await expect(metrica(page, 'Expiradas / Bloqueadas')).toHaveText('2');
    await expect(metrica(page, 'Dispositivos Conectados')).toHaveText('2');
    await expect(linha(page, 'BDO-CCCC-3333').locator('[data-status]')).toHaveText('Expirada');
    await expect(linha(page, 'BDO-BBBB-2222').locator('[data-status]')).toHaveText('Bloqueada');

    // ---- filtro global: apps padrão + os novos da tabela apps
    const opcoes = await page.locator('#filtro-app option').allTextContents();
    expect(opcoes).toEqual(expect.arrayContaining(['Todos os Aplicativos', 'WinAppOS Desktop', 'BDO-e SaaS', 'Novo App']));
    await page.locator('#filtro-app').selectOption('bdo-e');
    await expect(metrica(page, 'Total de Licenças')).toHaveText('2');
    await expect(metrica(page, 'Licenças Ativas')).toHaveText('0');
    await expect(page.locator('tr[data-licenca]')).toHaveCount(2);
    await page.locator('#filtro-app').selectOption('all');

    // ---- copiar chave
    await linha(page, 'WOS-AAAA-1111').locator('[data-acao=copiar]').click();
    await expect(page.locator('#toasts')).toContainText('Chave copiada');

    // ---- nova licença (RPC create_license)
    await page.getByRole('button', { name: 'Nova Licença' }).first().click();
    const modal = page.locator('#modal-licenca');
    await modal.locator('[name=app]').selectOption('bdo-e');
    await modal.locator('[name=cliente]').selectOption('c1');
    await modal.locator('[name=max_devices]').fill('5');
    await modal.locator('[data-dias="90"]').click();
    await modal.locator('[type=submit]').click();
    await expect(modal).toBeHidden();
    await expect(linha(page, 'NEW-KEY-9999')).toBeVisible();
    let calls = await page.evaluate(() => window.__calls.filter((c) => c.rpc));
    expect(calls.at(-1)).toEqual({ rpc: 'create_license', args: { p_app_code: 'bdo-e', p_client_id: 'c1', p_max_devices: 5, p_duration_days: 90 } });
    await expect(metrica(page, 'Total de Licenças')).toHaveText('4');

    // ---- renovar a expirada (+365 dias): volta a ficar ativa
    await linha(page, 'BDO-CCCC-3333').locator('[data-acao=renovar]').click();
    await confirmarDialogo(page);
    await expect(linha(page, 'BDO-CCCC-3333').locator('[data-status]')).toHaveText('Ativa');
    calls = await page.evaluate(() => window.__calls.filter((c) => c.rpc));
    expect(calls.at(-1)).toEqual({ rpc: 'renew_license', args: { p_license_id: 'l3', p_days: 365 } });

    // ---- bloquear / ativar
    await linha(page, 'WOS-AAAA-1111').locator('[data-acao=status]').click();
    await confirmarDialogo(page);
    await expect(linha(page, 'WOS-AAAA-1111').locator('[data-status]')).toHaveText('Bloqueada');
    calls = await page.evaluate(() => window.__calls.filter((c) => c.rpc));
    expect(calls.at(-1)).toEqual({ rpc: 'set_license_status', args: { p_license_id: 'l1', p_status: 'blocked' } });
    await linha(page, 'BDO-BBBB-2222').locator('[data-acao=status]').click();
    await confirmarDialogo(page);
    await expect(linha(page, 'BDO-BBBB-2222').locator('[data-status]')).toHaveText('Ativa');

    // ---- dispositivos: lista e desconecta (DELETE em license_devices)
    await linha(page, 'WOS-AAAA-1111').locator('[data-acao=dispositivos]').click();
    const disp = page.locator('#modal-dispositivos');
    await expect(disp.locator('[data-dispositivo]')).toHaveCount(2);
    await expect(disp).toContainText('Notebook Campo');
    await disp.locator('[data-dispositivo="d1"] [data-acao=remover-dispositivo]').click();
    await confirmarDialogo(page);
    await expect(disp.locator('[data-dispositivo]')).toHaveCount(1);
    const del = await page.evaluate(() => window.__calls.filter((c) => c.op === 'delete'));
    expect(del).toEqual([{ table: 'license_devices', op: 'delete', filters: [['id', 'd1']] }]);
    await disp.locator('[data-fechar]').click();
    await expect(linha(page, 'WOS-AAAA-1111').locator('[data-uso]')).toHaveText('1 / 3');

    // ---- clientes: texto do banco é escapado; cadastro valida CPF/CNPJ
    await page.locator('[data-aba=clientes]').click();
    await expect(page.locator('#lista-clientes')).toContainText('<img src=x data-xss>Cliente');
    expect(await page.locator('[data-xss]').count()).toBe(0);
    await page.locator('#aba-clientes [data-acao=novo-cliente]').click();
    const cli = page.locator('#modal-cliente');
    await cli.locator('[name=name]').fill('Petro Serviços');
    await cli.locator('[name=email]').fill('Contato@Petro.com');
    await cli.locator('[name=phone]').fill('71988887777');
    await cli.locator('[name=document]').fill('12345678900');
    await cli.locator('[type=submit]').click();
    await expect(cli.locator('[data-erro]')).toHaveText('CPF ou CNPJ inválido.');
    await cli.locator('[name=document]').fill('52998224725');
    await expect(cli.locator('[name=document]')).toHaveValue('529.982.247-25');
    await cli.locator('[type=submit]').click();
    await expect(cli).toBeHidden();
    await expect(page.locator('#lista-clientes')).toContainText('Petro Serviços');
    const ins = await page.evaluate(() => window.__calls.find((c) => c.op === 'insert'));
    expect(ins).toMatchObject({ table: 'clients', row: { name: 'Petro Serviços', email: 'contato@petro.com', phone: '71988887777', document: '52998224725' } });

    // ---- auditoria: eventos das RPCs, filtro por tipo
    await page.locator('[data-aba=logs]').click();
    await expect(page.locator('#lista-logs')).toContainText('license_created');
    await expect(page.locator('#lista-logs')).toContainText('license_renewed');
    await page.locator('#filtro-evento').selectOption('status_changed');
    await expect(page.locator('#lista-logs tbody tr')).toHaveCount(2);

    // ---- sair
    await page.locator('[data-acao=sair]').click();
    await expect(page.locator('#form-login')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
    server.close();
  }
});
