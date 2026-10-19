// Ponto de entrada da interface: liga abas, formulários, caixa de saída e sincronização.

import { MODULES, getModule } from './modules/index.js';
import { openDb, requestPersistence } from './core/db.js';
import { loadDraft, saveDraft, discardDraft, hasDraft, restoreDraft } from './core/drafts.js';
import { enqueue, pendingCount, onOutboxChange, takeBack, saveLocalOnly, sendFromHistory, takeBackLocal } from './core/outbox.js';
import { shareMessage, waUrl, uploadShareCopy, whatsappConfigurado } from './core/share.js';
import { reportFile } from './ui/report-pdf.js';
import { isSupabaseConfigured } from './config.js';
import { showSharePrompt } from './ui/share-prompt.js';
import { syncNow, startSyncScheduler, onSyncState } from './core/sync.js';
import { getPref, setPref } from './core/prefs.js';
import { newUniqueId } from './core/ids.js';
import { photoMeta } from './core/fotos.js';
import { FormView, validate, cleanData, requiredProgress, rehydrate } from './ui/form.js';
import { confirmDialog } from './ui/confirm.js';
import { closeRoutePrompt } from './ui/route-prompt.js';
import { openPreview } from './ui/preview.js';
import { OutboxView } from './ui/outbox-view.js';
import { SettingsView } from './ui/settings-view.js';
import { companyInfo, onSettingsChange, getSettings } from './core/settings.js';
import { toast } from './ui/toast.js';
import { icon } from './ui/icons.js';
import { $, $$, esc } from './ui/dom.js';

const OUTBOX_TAB = 'outbox';
const SETTINGS_TAB = 'settings';

const state = {
  tab: getPref('tab', 'bdo'),
  module: null,
  draft: null,
  formView: null,
  saveTimer: null,
  sectionObserver: null
};

let outboxView;
let settingsView;

const timeNow = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// ---------- Tema ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#theme-toggle');
  const label = theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 18);
}

function initTheme() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(getPref('theme', prefersDark ? 'dark' : 'light'));
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setPref('theme', next);
    applyTheme(next);
  });
}

// ---------- Rascunho (salvamento contínuo) ----------

function scheduleSave() {
  clearTimeout(state.saveTimer);
  setDraftStatus('saving', 'Salvando…');
  state.saveTimer = setTimeout(flushSave, 250);
}

// Grava o rascunho se houver alteração pendente (chamado pelo timer ou antes de trocar de tela)
async function flushSave() {
  if (!state.saveTimer) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.draft) return;
  try {
    await saveDraft(state.draft);
    state.draft.isNew = false;
    setDraftStatus('saved', `Salvo neste computador às ${timeNow()}`);
  } catch (err) {
    console.error('[draft]', err);
    setDraftStatus('error', 'Falha ao salvar o rascunho');
  }
}

function setDraftStatus(kind, text) {
  const el = $('#draft-status');
  if (!el) return;
  const ico = { saving: '<span class="spinner" aria-hidden="true"></span>', saved: icon('checkCircle', 16), error: icon('alert', 16), idle: icon('info', 16) }[kind];
  el.className = `save-status save-status--${kind}`;
  el.innerHTML = `${ico}<span>${esc(text)}</span>`;
}

// ---------- Base e abas ----------

function renderTabs() {
  $('#tabs').innerHTML = `
    ${MODULES.map((m) => `
      <button type="button" role="tab" class="tab" data-tab="${m.id}">
        <span class="tab__icon">${icon(m.icon, 18)}</span>
        <span class="tab__text"><span class="tab__title">${esc(m.shortTitle)}</span><span class="tab__sub">${esc(m.subtitle)}</span></span>
      </button>`).join('')}
    <span class="tabs__spacer"></span>
    <button type="button" role="tab" class="tab" data-tab="${OUTBOX_TAB}">
      <span class="tab__icon">${icon('inbox', 18)}</span>
      <span class="tab__text"><span class="tab__title">Histórico <span id="outbox-badge" class="badge" hidden>0</span></span><span class="tab__sub">Relatórios salvos e Caixa de Saída</span></span>
    </button>
    <button type="button" role="tab" class="tab" data-tab="${SETTINGS_TAB}">
      <span class="tab__icon">${icon('sliders', 18)}</span>
      <span class="tab__text"><span class="tab__title">Configurações</span><span class="tab__sub">Empresa, contrato e técnico</span></span>
    </button>`;
  updateBadge();
}

function isTabAvailable(tab) {
  return tab === OUTBOX_TAB || tab === SETTINGS_TAB || MODULES.some((m) => m.id === tab);
}

async function showTab(tab) {
  if (!isTabAvailable(tab)) tab = MODULES[0].id;
  if (state.tab === SETTINGS_TAB && tab !== SETTINGS_TAB && settingsView.dirty) {
    const leave = await confirmDialog({
      title: 'Descartar alterações nas Configurações?',
      message: 'Você alterou dados da empresa, contrato ou técnico e ainda não salvou.',
      confirmLabel: 'Descartar alterações', cancelLabel: 'Continuar editando', danger: true
    });
    if (!leave) {
      $$('#tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === SETTINGS_TAB));
      return;
    }
    settingsView.dirty = false;
  }
  await flushSave();
  closeRoutePrompt();
  state.formView?.destroy();
  state.sectionObserver?.disconnect();
  state.formView = null;
  state.draft = null;
  state.module = null;
  state.tab = tab;
  setPref('tab', tab);

  $$('#tabs .tab').forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
  });

  const view = $('#view');
  view.classList.toggle('view--form', !!getModule(tab));
  delete view.dataset.ready; // marcado de novo quando a tela terminar de montar (usado nos testes E2E)
  window.scrollTo(0, 0);
  if (tab === SETTINGS_TAB) {
    settingsView.render();
    view.replaceChildren(settingsView.root);
    view.dataset.ready = tab;
    return;
  }
  if (tab === OUTBOX_TAB) {
    view.replaceChildren(outboxView.root);
    await outboxView.refresh();
    view.dataset.ready = tab;
    return;
  }

  const module = getModule(tab);
  const draft = await loadDraft(module.id);
  if (state.tab !== tab) return; // usuário trocou de aba enquanto carregava
  state.draft = draft;
  state.module = module;
  if (draft.legacyLeft) {
    toast(`Havia rascunhos deste relatório nas bases BA e SE. O mais recente foi aberto; o outro continua guardado neste computador.`, 'warn', 8000);
  }

  view.innerHTML = `
    <div class="form-layout">
      <aside class="section-nav" aria-label="Seções do relatório">
        <p class="section-nav__title">Seções do relatório</p>
        <ol class="section-nav__list" id="section-nav"></ol>
        <p class="section-nav__hint">${icon('save', 14)}<span>Salvo automaticamente a cada alteração.<br>Salvar agora: <span class="nowrap"><kbd>Ctrl</kbd> + <kbd>S</kbd></span></span></p>
      </aside>
      <div class="form-main">
        <header class="doc-head card">
          <div class="doc-head__main">
            ${companyChipHtml()}
            <p class="eyebrow">${esc(module.subtitle)}</p>
            <h2 class="doc-head__title">${esc(module.title)}</h2>
            <div class="doc-head__meta">
              <span class="meta-chip">${icon('mapPin', 14)}<span id="meta-poco"></span></span>
              <span class="meta-chip">${icon('hash', 14)}<span>ID <code>${esc(draft.uniqueId.slice(0, 8))}</code></span></span>
              <span class="meta-chip">${icon('calendar', 14)}<span>${draft.isNew ? 'Novo relatório' : 'Rascunho recuperado'}</span></span>
            </div>
          </div>
          <div class="doc-head__side">
            <div class="progress" aria-live="polite">
              <div class="progress__label"><span>Campos obrigatórios</span><strong id="progress-count"></strong></div>
              <div class="progress__track"><span class="progress__fill" id="progress-fill"></span></div>
            </div>
            <button type="button" class="btn btn--text btn--sm btn--danger-text" id="btn-discard">${icon('trash', 15)} Limpar formulário</button>
          </div>
        </header>
        <div id="form-root"></div>
      </div>
    </div>
    <div class="action-bar" role="toolbar" aria-label="Ações do relatório">
      <div class="action-bar__info">
        <span id="draft-status"></span>
        <span id="ready-status" class="ready-status"></span>
      </div>
      <div class="action-bar__buttons">
        <button type="button" class="btn btn--ghost" id="btn-preview">${icon('fileText', 17)}<span class="lbl">Prévia do PDF</span><span class="lbl-short">Prévia</span></button>
        <button type="button" class="btn btn--primary" id="btn-finalize">${icon('save', 17)}<span class="lbl">Salvar e Finalizar</span><span class="lbl-short">Salvar e Finalizar</span></button>
      </div>
    </div>`;

  setDraftStatus('idle', draft.isNew ? 'Novo relatório — salvo automaticamente ao preencher' : 'Rascunho recuperado deste computador');
  state.formView = new FormView($('#form-root'), module, draft, {
    onChange: () => { scheduleSave(); refreshFormChrome(); }
  });
  $('#btn-preview').addEventListener('click', () => previewDraft(module));
  $('#btn-finalize').addEventListener('click', () => finalize(module));
  $('#btn-discard').addEventListener('click', () => discard(module));
  $('#section-nav').addEventListener('click', (e) => {
    const item = e.target.closest('[data-goto-section]');
    if (!item) return;
    e.preventDefault();
    $(`#sec-${item.dataset.gotoSection}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  refreshFormChrome();
  observeSections();
  view.dataset.ready = module.id;
}

function companyChipHtml() {
  const c = companyInfo();
  if (!c) {
    return `<button type="button" class="company-chip company-chip--empty" data-goto="${SETTINGS_TAB}">${icon('building', 15)} Empresa não configurada — abrir Configurações</button>`;
  }
  return `<div class="company-chip">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : icon('building', 16)}<span><strong>${esc(c.nome || '')}</strong>${c.cnpj ? ` · CNPJ ${esc(c.cnpj)}` : ''}</span></div>`;
}

// Índice lateral, progresso, poço no cabeçalho e "pronto para finalizar"
function refreshFormChrome() {
  const { formView, module, draft } = state;
  if (!formView) return;

  const nav = $('#section-nav');
  const active = nav.querySelector('.is-active')?.dataset.gotoSection;
  nav.innerHTML = formView.status().map((st) => `
    <li>
      <a href="#sec-${st.index}" class="section-nav__item section-nav__item--${st.state}${String(st.index) === active ? ' is-active' : ''}" data-goto-section="${st.index}">
        <span class="section-nav__num">${st.state === 'done' ? icon('check', 14) : st.index + 1}</span>
        <span class="section-nav__text">
          <span class="section-nav__label">${esc(st.short)}</span>
          <span class="section-nav__state">${st.state === 'pending' ? `${st.missing} pendente${st.missing > 1 ? 's' : ''}` : st.state === 'done' ? 'Completo' : 'Opcional'}</span>
        </span>
      </a>
    </li>`).join('');

  const { total, filled } = requiredProgress(module, draft.data);
  const pct = total ? Math.round((filled / total) * 100) : 100;
  $('#progress-count').textContent = `${filled} de ${total}`;
  const fill = $('#progress-fill');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('is-complete', filled === total);

  $('#meta-poco').textContent = draft.data.poco ? `Poço ${draft.data.poco}` : 'Poço não informado';

  const missing = total - filled;
  const ready = $('#ready-status');
  ready.className = `ready-status ready-status--${missing ? 'pending' : 'ok'}`;
  ready.innerHTML = missing
    ? `${icon('alert', 15)} Falta${missing > 1 ? 'm' : ''} ${missing} campo${missing > 1 ? 's' : ''} obrigatório${missing > 1 ? 's' : ''}`
    : `${icon('checkCircle', 15)} Pronto para finalizar`;
}

// Destaca no índice a seção visível na tela
function observeSections() {
  state.sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    const idx = visible.target.dataset.section;
    $$('#section-nav .section-nav__item').forEach((a) => a.classList.toggle('is-active', a.dataset.gotoSection === idx));
  }, { rootMargin: '-110px 0px -55% 0px' });
  $$('.form-section').forEach((s) => state.sectionObserver.observe(s));
}

// ---------- Ações do relatório ----------

/** Salvamento explícito no dispositivo (o salvamento automático continua ativo). */
async function saveNow() {
  if (!state.draft) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  try {
    await saveDraft(state.draft);
    state.draft.isNew = false;
    setDraftStatus('saved', `Salvo neste computador às ${timeNow()}`);
    toast('Rascunho salvo neste computador.', 'success', 2500);
  } catch (err) {
    console.error('[draft]', err);
    setDraftStatus('error', 'Falha ao salvar o rascunho');
    toast('Não foi possível salvar o rascunho.', 'error');
  }
}

/** Prévia a qualquer momento, mesmo com campos pendentes (avisados no topo). */
async function previewDraft(module) {
  const draft = state.draft;
  if (!draft) return;
  await flushSave();
  await openPreview({
    module, uniqueId: draft.uniqueId, data: cleanData(module, draft.data),
    photos: draft.photos, mode: 'draft', pending: validate(module, draft.data),
    onNewReport: () => newReport(module)
  });
}

async function finalize(module) {
  const draft = state.draft;
  if (!draft) return;

  const errors = validate(module, draft.data);
  if (errors.length) {
    state.formView.showErrors(errors);
    toast(`Verifique ${errors.length} campo${errors.length > 1 ? 's' : ''} antes de finalizar.`, 'error');
    return;
  }

  const data = cleanData(module, draft.data);
  data._empresa = companyInfo(); // congela empresa/logo no relatório finalizado
  const choice = await openPreview({ module, uniqueId: draft.uniqueId, data, photos: draft.photos, onNewReport: () => newReport(module) });
  if (!choice) return;

  const report = { uniqueId: draft.uniqueId, module: module.id, data, photos: draft.photos.map(photoMeta) };
  try {
    // 1) grava no aparelho (persistido em disco antes de seguir): fila de envio ou só o histórico
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (choice === 'send') await enqueue(report);
    else await saveLocalOnly(report);
    // 2) só então descarta o rascunho
    state.draft = null;
    await discardDraft(module.id);
  } catch (err) {
    console.error('[enqueue]', err);
    toast('Não foi possível salvar o relatório localmente. O rascunho foi mantido.', 'error', 8000);
    return;
  }

  await showTab(module.id);
  if (choice === 'local') {
    toast(`Relatório salvo na memória local do app (IndexedDB). Para salvar na pasta de Arquivos do seu celular, clique em 'Baixar / Compartilhar PDF' (na prévia ou em Histórico › Ver / PDF). Para enviar depois: Histórico › Enviar.`, 'success', 10000);
    return;
  }
  toast(`${navigator.onLine ? 'Relatório na Caixa de Saída. Enviando ao servidor…' : 'Relatório na Caixa de Saída. Será enviado quando houver conexão.'} Relatório salvo na memória local do app (IndexedDB). Para salvar na pasta de Arquivos do seu celular, clique em 'Baixar / Compartilhar PDF' (na prévia ou em Histórico › Ver / PDF).`, 'success', 10000);
  syncNow();
  await shareReport(module, report);
}

/**
 * Depois do envio: gera o link do relatório (Supabase Storage) e abre o WhatsApp para o número
 * das Configurações. Sem número, mostra o botão "Abrir WhatsApp" (o técnico escolhe o contato).
 */
async function shareReport(module, report) {
  let link = null;
  let aviso = '';
  try {
    if (isSupabaseConfigured() && navigator.onLine) {
      const file = await reportFile({ module, uniqueId: report.uniqueId, data: report.data, photos: report.photos, company: report.data._empresa });
      link = await uploadShareCopy(module, report.uniqueId, file);
    }
  } catch (err) {
    console.error('[share]', err);
    aviso = 'Não foi possível gerar o link agora.';
  }
  const url = waUrl(getSettings().whatsapp_padrao, shareMessage(module, report.data, report.uniqueId, link));
  showSharePrompt({ url, link, titulo: 'Enviar pelo WhatsApp', aviso });
  // com número configurado, abre direto (no iPhone a janela pode ser bloqueada: o botão do painel resolve)
  if (whatsappConfigurado()) window.open(url, '_blank', 'noopener');
}

/** Histórico › Enviar: relatório salvo só no aparelho vai para a Caixa de Saída + WhatsApp. */
async function sendSaved(rec) {
  const module = getModule(rec.module);
  if (!module) return;
  const sent = await sendFromHistory(rec.uniqueId);
  if (!sent) return toast('Relatório não encontrado neste aparelho.', 'error');
  toast('Relatório na Caixa de Saída. Enviando ao servidor…', 'success');
  syncNow();
  await shareReport(module, sent);
}

/** Histórico › Editar (relatório salvo, nunca enviado): volta a ser rascunho com o mesmo ID. */
async function editLocal(rec) {
  const module = getModule(rec.module);
  if (!module) return;
  if (await hasDraft(rec.module)) {
    const ok = await confirmDialog({
      title: 'Substituir o rascunho atual?',
      message: `Já existe um rascunho de "${module.shortTitle}". Ele será substituído pelo relatório que você vai editar.`,
      confirmLabel: 'Substituir e editar', danger: true
    });
    if (!ok) return;
  }
  const taken = await takeBackLocal(rec.uniqueId);
  if (!taken) return toast('Este relatório já foi enviado e não pode mais ser editado.', 'error');
  await restoreDraft({ ...taken, photos: taken.photos || [] }, rehydrate(module, taken.data));
  await showTab(rec.module);
  toast('Relatório voltou para edição com o mesmo ID.', 'success', 5000);
}

async function discard(module) {
  const ok = await confirmDialog({
    title: 'Limpar este formulário?',
    message: 'Todos os dados preenchidos e as fotos deste rascunho serão apagados deste computador. Esta ação não pode ser desfeita.',
    confirmLabel: 'Limpar formulário', danger: true, iconName: 'trash'
  });
  if (!ok) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.draft = null;
  await discardDraft(module.id);
  await showTab(module.id);
  toast('Formulário limpo. Um novo relatório foi iniciado.', 'info');
}

/** "Início / Novo relatório" (prévia): apaga o rascunho atual e abre o formulário em branco, no topo. */
async function newReport(module) {
  const ok = await confirmDialog({
    title: 'Iniciar um novo relatório?',
    message: `Os dados preenchidos e as fotos deste rascunho de "${module.shortTitle}" serão apagados deste aparelho. Relatórios já finalizados continuam no Histórico.`,
    confirmLabel: 'Limpar e começar novo', cancelLabel: 'Continuar editando', danger: true, iconName: 'home'
  });
  if (!ok) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.draft = null;
  await discardDraft(module.id);
  await showTab(module.id);
  window.scrollTo(0, 0);
  toast('Novo relatório iniciado.', 'info', 2500);
}

// Campos que não fazem sentido copiar para um relatório novo
const NOT_REUSED = new Set(['date', 'datetime', 'time', 'signature', 'photos', 'consolidation']);

/** Histórico → novo rascunho (novo ID) preenchido com os dados de um relatório salvo. */
async function reuseReport(rec) {
  const module = getModule(rec.module);
  if (!module) return;
  if (await hasDraft(module.id)) {
    const ok = await confirmDialog({
      title: 'Substituir o rascunho atual?',
      message: `Já existe um rascunho de "${module.shortTitle}" em andamento. Ele será substituído por um novo relatório preenchido com os dados do relatório escolhido.`,
      confirmLabel: 'Substituir e reutilizar', danger: true
    });
    if (!ok) return;
  }
  const data = rehydrate(module, structuredClone(rec.data));
  for (const f of module.sections.flatMap((s) => s.fields)) {
    if (NOT_REUSED.has(f.type)) delete data[f.id];
  }
  await flushSave();
  await saveDraft({ key: module.id, uniqueId: newUniqueId(), module: module.id, data, photos: [] });
  await showTab(module.id);
  window.scrollTo(0, 0);
  toast('Novo relatório preenchido com os dados do relatório salvo. Confira datas, horários, fotos e assinatura.', 'success', 7000);
}

/** Caixa de Saída → volta a ser rascunho para correção (só se nunca foi enviado). */
async function editFromOutbox(rec) {
  const module = getModule(rec.module);
  if (!module) return;
  if (await hasDraft(rec.module)) {
    const ok = await confirmDialog({
      title: 'Substituir o rascunho atual?',
      message: `Já existe um rascunho de "${module.shortTitle}". Ele será substituído pelo relatório que você vai editar.`,
      confirmLabel: 'Substituir e editar', danger: true
    });
    if (!ok) return;
  }
  const taken = await takeBack(rec.uniqueId);
  if (!taken) {
    toast('Este relatório já teve tentativa de envio e não pode mais ser editado.', 'error');
    return;
  }
  try {
    await restoreDraft(taken, rehydrate(module, taken.data));
  } catch (err) {
    console.error('[edit]', err);
    await enqueue({ uniqueId: taken.uniqueId, module: taken.module, data: taken.data, photos: taken.photos });
    toast('Não foi possível abrir para edição. O relatório continua na Caixa de Saída.', 'error');
    return;
  }
  await showTab(rec.module);
  toast('Relatório voltou para edição. Ao finalizar de novo, ele retorna à Caixa de Saída com o mesmo ID.', 'success', 6000);
}

// ---------- Indicadores ----------

async function updateBadge(n) {
  const count = n ?? await pendingCount();
  const badge = $('#outbox-badge');
  if (!badge) return;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
  badge.setAttribute('aria-label', `${count} pendente${count === 1 ? '' : 's'}`);
}

function updateConnection(s) {
  const el = $('#conn');
  const [kind, text] = !s.configured ? ['local', 'Somente local']
    : !s.online ? ['offline', 'Sem conexão']
    : s.running ? ['syncing', 'Sincronizando']
    : ['online', 'Online'];
  el.className = `conn conn--${kind}`;
  el.innerHTML = `<span class="conn__dot" aria-hidden="true"></span>${text}`;
  el.title = !s.configured ? 'Configure o Supabase em src/config.js para habilitar o envio' : '';
}

// ---------- PWA (navegador / celular) ----------

// Cache offline e atualização automática. No Electron (file://) não se aplica.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // não recarrega sozinho para não atrapalhar quem está preenchendo (o rascunho já está salvo)
    if (hadController) toast('Nova versão do app instalada. Ela será usada na próxima vez que você abrir o app.', 'info', 8000);
  });
  navigator.serviceWorker.register('./sw.js').catch((err) => console.error('[pwa]', err));
}

// ---------- Inicialização ----------

async function init() {
  initTheme();
  await openDb();
  requestPersistence();

  settingsView = new SettingsView();
  settingsView.onSaved = () => syncNow();
  onSettingsChange(() => settingsView.refreshStatus());
  outboxView = new OutboxView(document.createElement('div'), { onSyncNow: () => syncNow({ force: true }), onEdit: editFromOutbox, onReuse: reuseReport, onSend: sendSaved, onEditLocal: editLocal });

  renderTabs();
  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab && tab.dataset.tab !== state.tab) showTab(tab.dataset.tab);
  });
  $('#view').addEventListener('click', (e) => {
    const link = e.target.closest('[data-goto]');
    if (link) showTab(link.dataset.goto);
  });

  // Arquivo solto fora da área de importação: impede o Electron de "abrir" o arquivo no lugar do app
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (e) => { if (!e.target.closest?.('[data-dropzone]')) e.preventDefault(); });
  }

  // Ctrl+S salva o rascunho
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (state.draft) saveNow();
    }
  });

  onOutboxChange((n) => {
    updateBadge(n);
    if (state.tab === OUTBOX_TAB) outboxView.refresh();
  });
  onSyncState((s) => {
    updateConnection(s);
    outboxView.setSyncState(s);
  });

  await showTab(state.tab);
  startSyncScheduler();
  registerServiceWorker();

  window.addEventListener('beforeunload', flushSave);
  window.desktop?.onBeforeClose?.(async () => {
    try { await flushSave(); } finally { window.desktop.readyToClose(); }
  });
}

init().catch((err) => {
  console.error('[init]', err);
  toast(`Erro ao iniciar: ${err.message}`, 'error', 15000);
});
