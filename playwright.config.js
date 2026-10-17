// Playwright para o app Electron (não usa navegadores: os testes abrem o Electron real).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1, // uma janela Electron por vez
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  outputDir: 'test-results'
});
