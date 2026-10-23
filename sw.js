// Service Worker do BDO-e (PWA): funciona offline e se atualiza sozinho.
//
// - Na instalação, guarda todos os arquivos do app (lista abaixo) no cache desta versão.
// - Páginas: rede primeiro (pega a versão nova), cache quando estiver offline.
// - Demais arquivos: cache primeiro e atualiza em segundo plano.
// - VERSION muda sempre que qualquer arquivo do app muda (npm run pwa) → o navegador
//   detecta o sw.js novo, instala, apaga o cache antigo e a versão nova é usada na próxima abertura.
// - Supabase e mapas (outros domínios) vão direto para a rede.

// <precache> — gerado por `npm run pwa`; não editar à mão
const VERSION = 'bdc7e3473ed2';
const PRECACHE = [
  './',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './index.html',
  './manifest.json',
  './src/app.js',
  './src/config.js',
  './src/core/auth.js',
  './src/core/busca.js',
  './src/core/consolidar.js',
  './src/core/contratos.js',
  './src/core/db.js',
  './src/core/deslocamento.js',
  './src/core/distancia.js',
  './src/core/drafts.js',
  './src/core/fotos.js',
  './src/core/heranca.js',
  './src/core/ids.js',
  './src/core/licenca.js',
  './src/core/outbox.js',
  './src/core/platform.js',
  './src/core/pocos.js',
  './src/core/prefs.js',
  './src/core/pull.js',
  './src/core/relatorio-json.js',
  './src/core/settings.js',
  './src/core/share.js',
  './src/core/supabase.js',
  './src/core/sync.js',
  './src/core/telefone.js',
  './src/env.js',
  './src/modules/bdo.js',
  './src/modules/common.js',
  './src/modules/handover.js',
  './src/modules/index.js',
  './src/modules/resumo-bdo.js',
  './src/modules/visita-tecnica.js',
  './src/shared/pocos-parser.js',
  './src/styles.css',
  './src/ui/bdo-pdf.js',
  './src/ui/cabecalho.js',
  './src/ui/camera.js',
  './src/ui/compress.js',
  './src/ui/confirm.js',
  './src/ui/consolidacao-view.js',
  './src/ui/contrato-campo.js',
  './src/ui/docx-doc.js',
  './src/ui/dom.js',
  './src/ui/equipe-view.js',
  './src/ui/form.js',
  './src/ui/icons.js',
  './src/ui/importar-json.js',
  './src/ui/licenca-view.js',
  './src/ui/login-view.js',
  './src/ui/outbox-view.js',
  './src/ui/pdf-doc.js',
  './src/ui/pdf-sheet.js',
  './src/ui/preview.js',
  './src/ui/report-pdf.js',
  './src/ui/route-prompt.js',
  './src/ui/settings-view.js',
  './src/ui/share-prompt.js',
  './src/ui/toast.js',
  './src/vendor/jspdf.plugin.autotable.min.js',
  './src/vendor/jspdf.umd.min.js',
  './src/vendor/supabase.js'
];
// </precache>

const CACHE = `bdoe-${VERSION}`;
const LICENCAS = new URL('./licencas/', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bdoe-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Painel de licenças (/licencas/): fora do PWA — sem cache e nunca gravado como a página do app
  if (`${url.pathname}/`.startsWith(LICENCAS)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => hit || Response.error());
      return hit || network;
    })
  );
});
