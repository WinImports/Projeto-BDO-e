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

module.exports = { launchApp, newUserData, fill, openTab };
