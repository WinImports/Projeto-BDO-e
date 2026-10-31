// Celular / tablet: o botão "Câmera" das fotos abre o app de câmera nativo do aparelho (input capture), com o
// zoom e o foco do próprio aparelho; no computador continua a câmera dentro do app (webcam).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp, openTab } = require('./helpers');

let ctx;
test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); });

test('toque: Câmera = app nativo (capture) e a foto entra no componente; computador: câmera do app', async () => {
  const { page } = ctx;
  await openTab(page, 'visita_tecnica');
  await expect(page.locator('[data-wrap=fotos_vc] [data-action=camera]').first()).toBeVisible();
  await expect(page.locator('[data-camera-nativa]')).toHaveCount(0);

  // simula um aparelho de toque
  await page.evaluate(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.includes('pointer: coarse') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : orig(q));
  });
  await openTab(page, 'bdo');
  await openTab(page, 'visita_tecnica');
  const vc = page.locator('[data-wrap=fotos_vc]');
  await expect(vc.locator('[data-action=camera]')).toHaveCount(0);
  const camera = vc.locator('[data-camera-nativa] input[capture=environment]').first();
  await expect(camera).toBeAttached();
  await expect(vc.locator('.photo-add__btn').first()).toContainText('Galeria');
  await camera.setInputFiles(path.join(__dirname, 'fixtures', 'foto-teste.webp'));
  await expect(vc.locator('.photo img')).toHaveCount(1);
});
