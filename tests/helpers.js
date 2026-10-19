// Abre o app Electron real com uma pasta de dados temporária (isolada dos dados do usuário).
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const newUserData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bdoe-test-'));

/**
 * @param {{ userData?: string }} [opts] reutilize `userData` para simular reabrir o app
 */
async function launchApp({ userData = newUserData(), env: extraEnv = {} } = {}) {
  const env = { ...process.env, BDOE_USER_DATA: userData, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE; // o VS Code define essa variável e ela impede a janela de abrir

  const app = await electron.launch({ args: [path.join(__dirname, '..')], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#tabs .tab');

  /** Fecha o app; com keepData mantém a pasta para reabrir depois. */
  const close = async ({ keepData = false } = {}) => {
    await app.close();
    if (!keepData) fs.rmSync(userData, { recursive: true, force: true });
  };
  return { app, page, close, userData };
}

/** Preenche um campo do formulário (input, select ou textarea) pelo data-field. */
async function fill(page, field, value) {
  const el = page.locator(`[data-field="${field}"]`);
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
    ['objetivo', 'Avaliar as válvulas da cabeça de poço'], ['status_locacao', 'OK'], ['estado_antepoco', 'Limpo'],
    ['vc_estanqueidade', 'Sem estanqueidade (vazamento)'], ['flange_inf_corrosao', 'Moderada'], ['gestor_nome', 'Gestor Teste']
  ]) await fill(page, f, v);
}

module.exports = { launchApp, newUserData, fill, openTab, preencherVisita, cell };
