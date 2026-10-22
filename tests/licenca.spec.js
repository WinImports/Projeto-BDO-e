// Licença do app (core/licenca.js): ativação na 1ª abertura, validação a cada abertura, bloqueio com o
// motivo do servidor e tolerância de 7 dias sem internet. O servidor de licenças é simulado interceptando
// a chamada validate_license (nada vai para o projeto real).
const { test, expect } = require('@playwright/test');
const { launchApp, entrar } = require('./helpers');

const DIA = 864e5;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

test('licença: ativa, valida a cada abertura, bloqueia com o motivo e libera 7 dias sem internet', async () => {
  const ctx = await launchApp({ licenca: true, login: false });
  const { page } = ctx;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const pedidos = [];
  let resposta = null; // null = sem internet
  await ctx.app.context().route('**/rest/v1/rpc/validate_license', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    pedidos.push({ url: req.url(), apikey: req.headers().apikey, body: req.postDataJSON() });
    if (!resposta) return route.abort('internetdisconnected');
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(resposta) });
  });

  const licenca = () => page.evaluate(() => JSON.parse(localStorage.getItem('bdoe.licenca')));
  const editarLicenca = (campos) => page.evaluate((c) => {
    localStorage.setItem('bdoe.licenca', JSON.stringify({ ...JSON.parse(localStorage.getItem('bdoe.licenca')), ...c }));
  }, campos);
  const reabrir = async () => { await page.reload(); await page.waitForSelector('#tabs .tab, #login-form, #licenca-form'); };
  const iso = (ms) => new Date(Date.now() + ms).toISOString();

  try {
    // ---- 1ª abertura: tela de ativação, sem chamar o servidor
    await expect(page.locator('#licenca-title')).toHaveText('Ativar o BDO-e');
    await expect(page.locator('#login-form')).toHaveCount(0);
    await expect(page.locator('[data-licenca-aparelho]')).toContainText('BDO-e Desktop');

    // chave inválida: mostra o motivo do servidor
    resposta = { valid: false, reason: 'Chave de licença não encontrada para este aplicativo' };
    await page.locator('#licenca-chave').fill('CHAVE-ERRADA');
    await page.locator('#licenca-submit').click();
    await expect(page.locator('#licenca-erro')).toHaveText('Chave de licença não encontrada para este aplicativo');
    const deviceId = await page.evaluate(() => localStorage.getItem('bdoe.deviceId'));
    expect(pedidos[0]).toMatchObject({
      url: 'https://gdqkontotzaexknuprac.supabase.co/rest/v1/rpc/validate_license',
      apikey: 'sb_publishable_a6VfOUiGfOm492OZFgN7yg_P4rdAVnY',
      body: { p_app_code: 'bdo-e', p_license_key: 'CHAVE-ERRADA', p_device_id: deviceId }
    });
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(pedidos[0].body.p_device_name).toMatch(/BDO-e Desktop/);

    // chave válida: guarda a chave e segue para o login
    resposta = { valid: true, reason: null, expires_at: iso(200 * DIA), max_devices: 3 };
    await page.locator('#licenca-chave').fill('  BDOE-TESTE-0001 ');
    await page.locator('#licenca-submit').click();
    await expect(page.locator('#login-form')).toBeVisible();
    expect(await licenca()).toMatchObject({ chave: 'BDOE-TESTE-0001', maxDispositivos: 3 });
    expect((await licenca()).ultimaValidacao).toBeTruthy();
    await entrar(page);

    // ---- nova abertura: abre direto e valida em segundo plano com a MESMA chave e o MESMO aparelho
    const antes = pedidos.length;
    await reabrir();
    await expect(page.locator('#tabs .tab').first()).toBeVisible();
    await expect.poll(() => pedidos.length).toBe(antes + 1);
    expect(pedidos.at(-1).body).toMatchObject({ p_license_key: 'BDOE-TESTE-0001', p_device_id: deviceId });
    await expect(page.locator('#licenca')).toHaveCount(0);

    // ---- servidor recusa (bloqueada): o app é bloqueado com o motivo
    resposta = { valid: false, reason: 'Licença bloqueada pelo administrador' };
    await reabrir();
    await expect(page.locator('#licenca-title')).toHaveText('Acesso bloqueado');
    await expect(page.locator('#licenca-erro')).toHaveText('Licença bloqueada pelo administrador');
    await expect(page.locator('#licenca-chave')).toHaveValue('BDOE-TESTE-0001');
    expect((await licenca()).ultimaValidacao).toBeNull();

    // ficar sem internet não escapa do bloqueio
    resposta = null;
    await reabrir();
    await expect(page.locator('#licenca-erro')).toHaveText('Licença bloqueada pelo administrador');

    // desbloqueada no painel: "Validar licença" libera o app
    resposta = { valid: true, expires_at: iso(200 * DIA), max_devices: 3 };
    await page.locator('#licenca-submit').click();
    await expect(page.locator('#licenca')).toHaveCount(0);
    await expect(page.locator('#tabs .tab').first()).toBeVisible();

    // ---- sem internet, última validação há 3 dias: abre e avisa quantos dias restam
    resposta = null;
    await editarLicenca({ ultimaValidacao: iso(-3 * DIA), ultimoUso: iso(-3 * DIA) });
    await reabrir();
    await expect(page.locator('#tabs .tab').first()).toBeVisible();
    await expect(page.locator('#toasts')).toContainText('uso liberado offline por mais 4 dias');
    await expect(page.locator('#licenca')).toHaveCount(0);

    // ---- sem internet há mais de 7 dias: bloqueia
    await editarLicenca({ ultimaValidacao: iso(-8 * DIA), ultimoUso: iso(-8 * DIA) });
    await reabrir();
    await expect(page.locator('#licenca-erro')).toContainText('mais de 7 dias sem validar');

    // ---- relógio do aparelho voltado para trás não ganha prazo extra
    await editarLicenca({ ultimaValidacao: iso(-1 * DIA), ultimoUso: iso(2 * DIA) });
    await reabrir();
    await expect(page.locator('#licenca-erro')).toContainText('data e a hora do aparelho');

    // ---- licença vencida (expires_at) sem internet: bloqueia mesmo dentro dos 7 dias
    await editarLicenca({ ultimaValidacao: iso(-1 * DIA), ultimoUso: iso(-1 * DIA), expiraEm: iso(-2 * 3600e3) });
    await reabrir();
    await expect(page.locator('#licenca-erro')).toContainText('A licença venceu em');

    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
