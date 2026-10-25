// Abre o app Electron real com uma pasta de dados temporária (isolada dos dados do usuário).
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const newUserData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-test-'));

/**
 * @param {{ userData?: string, login?: boolean }} [opts] reutilize `userData` para simular reabrir o app;
 *   login: false para parar na tela de login (por padrão entra com um usuário local de teste)
 */
async function launchApp({ userData = newUserData(), env: extraEnv = {}, login = true, licenca = false } = {}) {
  // licença desligada por padrão (BDOE_LICENCA=off só vale fora do app empacotado); licenca: true liga a trava
  const env = { ...process.env, BDOE_USER_DATA: userData, ...(licenca ? {} : { BDOE_LICENCA: 'off' }), ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE; // o VS Code define essa variável e ela impede a janela de abrir

  const app = await electron.launch({ args: [path.join(__dirname, '..')], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#tabs .tab, #login-form, #licenca-form');
  if (login && await page.locator('#login-form').count()) await entrar(page);

  /** Fecha o app; com keepData mantém a pasta para reabrir depois. */
  const close = async ({ keepData = false } = {}) => {
    await app.close();
    if (!keepData) fs.rmSync(userData, { recursive: true, force: true });
  };
  return { app, page, close, userData };
}

/** Tela de login: entra (sem Supabase configurado, o 1º acesso cria o usuário local). */
async function entrar(page, email = 'tecnico@teste.com', senha = 'senha123') {
  await page.locator('#login-email').fill(email);
  await page.locator('#login-senha').fill(senha);
  await page.locator('#login-submit').click();
  await page.waitForSelector('#tabs .tab');
}

/**
 * Técnico que já entrou com a conta do servidor e tem a lista de contratos guardada no aparelho
 * (core/contratos.js). Sem isso o usuário de teste é "local" e o campo Contrato fica desabilitado.
 * Recarrega a página para os formulários usarem a lista.
 */
async function vincularContratos(page, lista, email = 'tecnico@teste.com') {
  await page.evaluate(({ lista, email }) => {
    const s = JSON.parse(localStorage.getItem('bdoe.auth.session'));
    localStorage.setItem('bdoe.auth.session', JSON.stringify({ ...s, email, modo: 'offline' }));
    localStorage.setItem('bdoe.contratos', JSON.stringify({ email, lista, atualizadoEm: new Date().toISOString() }));
  }, { lista, email });
  await page.reload();
  await page.waitForSelector('#view[data-ready]');
}

/** Preenche um campo do formulário (input, select ou textarea) pelo data-field. */
async function fill(page, field, value) {
  const el = page.locator(`[data-field="${field}"]`);
  // texto protegido (ex.: Objetivo): destrava pelo botão "Editar" antes de digitar
  if (await el.evaluate((n) => n.readOnly === true)) await page.locator(`[data-action=toggle-lock][data-target="${field}"]`).click();
  const tag = await el.evaluate((n) => n.tagName);
  if (tag === 'SELECT') await el.selectOption(value);
  else await el.fill(value);
}

/** Clica numa aba e espera a tela terminar de montar (evita digitar no formulário anterior). */
async function openTab(page, tab) {
  await page.locator(`#tabs [data-tab="${tab}"]`).click();
  await page.locator(`#view[data-ready="${tab}"]`).waitFor();
}

/** Célula de tabela do formulário (data-table / data-row / data-col). */
const cell = (page, table, row, col) => page.locator(`[data-table="${table}"][data-row="${row}"][data-col="${col}"]`);

/** Preenche uma Visita Técnica pronta para finalizar (obrigatórios + alguns componentes). */
async function preencherVisita(page, poco = 'FBM-89') {
  await cell(page, 'equipe', 0, 'nome').fill('João');
  for (const [f, v] of [
    ['poco', poco], ['turno', 'Diurno'], ['cliente', 'PETROBRAS'],
    ['status_locacao', 'OK'], ['estado_antepoco', 'Limpo'],
    ['vc_estanqueidade', 'Sem estanqueidade (vazamento)'], ['flange_inf_corrosao', 'Moderada'], ['gestor_nome', 'Gestor Teste']
  ]) await fill(page, f, v);
}

/** Configurações › "Avançado (administrador)": abre a área recolhida do servidor da empresa. */
async function abrirAvancado(page) {
  const area = page.locator('#servidor-avancado');
  if (!(await area.evaluate((el) => el.open))) await area.locator('summary').click();
}

module.exports = { launchApp, newUserData, fill, openTab, preencherVisita, cell, entrar, vincularContratos, abrirAvancado };
