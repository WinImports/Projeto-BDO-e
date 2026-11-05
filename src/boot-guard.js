// Proteção de abertura (script clássico, roda antes do app): se em 10 s o app não mostrar nada
// (formulário, login, licença ou troca de senha), aparece um painel com o erro que aconteceu e as opções
// "Tentar de novo" e "Reparar o app" — este apaga só os arquivos do app guardados pelo navegador (cache do
// PWA) e baixa a versão atual de novo. Rascunhos, relatórios, fotos e o login ficam (IndexedDB e localStorage).
(function () {
  var erros = [];
  function anota(msg) { if (msg && erros.length < 5) erros.push(String(msg).slice(0, 300)); }
  window.addEventListener('error', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag && tag !== 'SCRIPT' && tag !== 'LINK') return; // imagem que não carregou não trava o app
    var alvo = tag && (e.target.src || e.target.href);
    anota(alvo ? 'Falha ao carregar ' + alvo : (e.message || 'Erro') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) { anota(e.reason && (e.reason.message || e.reason)); });
  window.__bootErro = anota;

  function abriu() {
    var view = document.getElementById('view');
    return (view && view.children.length > 0)
      || document.getElementById('login-form') || document.getElementById('licenca-form') || document.getElementById('troca-senha-form');
  }

  function reparar() {
    var tarefas = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      tarefas.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    }
    if (window.caches && caches.keys) {
      tarefas.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
    }
    Promise.all(tarefas).catch(function () {}).then(function () {
      location.replace(location.pathname + '?reparo=' + Date.now());
    });
  }

  function painel() {
    if (abriu() || document.getElementById('boot-guard')) return;
    var box = document.createElement('div');
    box.id = 'boot-guard';
    box.className = 'boot-guard';
    box.setAttribute('role', 'alert');
    var h = document.createElement('h2'); h.textContent = 'O app não terminou de abrir';
    var p = document.createElement('p');
    p.textContent = 'Toque em "Reparar o app" para baixar a versão atual de novo. Seus rascunhos e relatórios salvos no aparelho não são apagados.';
    var det = document.createElement('pre'); det.className = 'boot-guard__erro';
    det.textContent = erros.length ? erros.join('\n') : 'Nenhum erro registrado (o app ficou esperando).';
    var b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'btn btn--primary'; b1.textContent = 'Reparar o app';
    b1.onclick = function () { b1.disabled = true; b1.textContent = 'Reparando…'; reparar(); };
    var b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'btn btn--ghost'; b2.textContent = 'Tentar de novo';
    b2.onclick = function () { location.reload(); };
    var acoes = document.createElement('div'); acoes.className = 'boot-guard__acoes'; acoes.append(b2, b1);
    box.append(h, p, det, acoes);
    document.body.appendChild(box);
  }

  window.addEventListener('load', function () { setTimeout(painel, 10000); });
})();
