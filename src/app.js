// Ponto de entrada da interface: liga abas, formulários, caixa de saída e sincronização.

import { MODULES, getModule } from './modules/index.js';
import { openDb, requestPersistence } from './core/db.js';
import { loadDraft, saveDraft, discardDraft, hasDraft, restoreDraft } from './core/drafts.js';
import { enqueue, pendingCount, onOutboxChange, takeBack, saveLocalOnly, sendFromHistory, takeBackLocal } from './core/outbox.js';
import { shareMessage, waUrl, publishReportDocuments, whatsappConfigurado } from './core/share.js';
import { reportFiles } from './ui/report-pdf.js';
import { showSharePrompt } from './ui/share-prompt.js';
import { syncNow, startSyncScheduler, onSyncState, setDocumentPublisher } from './core/sync.js';
import { getPref, setPref } from './core/prefs.js';
import { newUniqueId } from './core/ids.js';
import { bdoAtivo, herdar } from './core/heranca.js';
import { currentUser, displayName, logout } from './core/auth.js';
import { showLogin, showTrocaSenha } from './ui/login-view.js';
import { licenciamentoAtivo, licencaLocal, verificarLicenca, avaliarSemRede } from './core/licenca.js';
import { showLicenca } from './ui/licenca-view.js';
import { onContratosChange, souGestor, empresaPorContrato } from './core/contratos.js';
import { EquipeView } from './ui/equipe-view.js';
import { importarArquivoJson } from './ui/importar-json.js';
import { limparEquipeDeOutroUsuario } from './core/pull.js';
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
const EQUIPE_TAB = 'equipe'; // Gestão de Equipe: só aparece (e só abre) para gestor de contrato

const state = {
  tab: getPref('tab', 'bdo'),
  module: null,
  draft: null,
  formView: null,
  saveTimer: null,
  sectionObserver: null,
  navSeq: 0 // cada troca de aba incrementa: tarefas assíncronas sabem se o usuário navegou enquanto rodavam
};

let outboxView;
let settingsView;
let equipeView;

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

/** Rótulos curtos da barra inferior do celular (o título completo continua no aria/desktop). */
const ROTULO_CURTO = { bdo: 'BDO-e', visita_tecnica: 'Visita', handover: 'Execução' };

function renderTabs() {
  $('#tabs').innerHTML = `
    ${MODULES.map((m) => `
      <button type="button" role="tab" class="tab" data-tab="${m.id}" aria-label="${esc(m.shortTitle)}">
        <span class="tab__icon">${icon(m.icon, 18)}</span>
        <span class="tab__text"><span class="tab__title">${esc(m.shortTitle)}</span><span class="tab__sub">${esc(m.subtitle)}</span></span>
        <span class="tab__short" aria-hidden="true">${esc(ROTULO_CURTO[m.id] || m.shortTitle)}</span>
      </button>`).join('')}
    <span class="tabs__spacer"></span>
    ${souGestor() ? `
    <button type="button" role="tab" class="tab" data-tab="${EQUIPE_TAB}" aria-label="Gestão de Equipe">
      <span class="tab__icon">${icon('users', 18)}</span>
      <span class="tab__text"><span class="tab__title">Gestão de Equipe</span><span class="tab__sub">Técnicos e licenças do contrato</span></span>
      <span class="tab__short" aria-hidden="true">Equipe</span>
    </button>` : ''}
    <button type="button" role="tab" class="tab" data-tab="${OUTBOX_TAB}" aria-label="Histórico">
      <span class="tab__icon">${icon('inbox', 18)}<span id="outbox-badge" class="badge tab__badge" hidden>0</span></span>
      <span class="tab__text"><span class="tab__title">Histórico</span><span class="tab__sub">Relatórios salvos e Caixa de Saída</span></span>
      <span class="tab__short" aria-hidden="true">Histórico</span>
    </button>
    <button type="button" role="tab" class="tab" data-tab="${SETTINGS_TAB}" aria-label="Configurações">
      <span class="tab__icon">${icon('sliders', 18)}</span>
      <span class="tab__text"><span class="tab__title">Configurações</span><span class="tab__sub">Empresa, contrato e técnico</span></span>
      <span class="tab__short" aria-hidden="true">Ajustes</span>
    </button>`;
  updateBadge();
  marcarAba(state.tab);
}

function marcarAba(tab) {
  $$('#tabs .tab').forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
  });
}

function isTabAvailable(tab) {
  if (tab === EQUIPE_TAB) return souGestor(); // técnico não abre nem pelo endereço / preferência salva
  return tab === OUTBOX_TAB || tab === SETTINGS_TAB || MODULES.some((m) => m.id === tab);
}

async function showTab(tab) {
  state.navSeq += 1;
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

  marcarAba(tab);

  const view = $('#view');
  view.classList.toggle('view--form', !!getModule(tab));
  view.classList.remove('is-checked'); // pendências voltam ao tom neutro até a próxima tentativa de finalizar
  delete view.dataset.ready; // marcado de novo quando a tela terminar de montar (usado nos testes E2E)
  window.scrollTo(0, 0);
  if (tab === SETTINGS_TAB) {
    settingsView.render();
    view.replaceChildren(settingsView.root);
    view.dataset.ready = tab;
    return;
  }
  if (tab === EQUIPE_TAB) {
    view.replaceChildren(equipeView.root);
    await equipeView.refresh();
    if (state.tab !== tab) return;
    view.dataset.ready = tab;
    return;
  }
  if (tab === OUTBOX_TAB) {
    view.replaceChildren(outboxView.root);
    await outboxView.refresh();
    if (state.tab !== tab) return; // outra aba assumiu enquanto a lista carregava: não marca pronto
    view.dataset.ready = tab;
    return;
  }

  const module = getModule(tab);
  const draft = await loadDraft(module.id);
  // Visita Técnica / Execução: Poço, Locação, Data e Cliente vêm do BDO-e ativo
  const bdo = module.herdaDoBdo ? await bdoAtivo() : null;
  if (state.tab !== tab) return; // usuário trocou de aba enquanto carregava
  const herdados = module.herdaDoBdo ? herdar(module, draft, bdo) : [];
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
            ${companyChipHtml(draft.data?.contrato)}
            ${module.subtitle && module.subtitle.toLowerCase() !== module.title.toLowerCase() ? `<p class="eyebrow doc-head__eyebrow">${esc(module.subtitle)}</p>` : ''}
            <h2 class="doc-head__title">${esc(module.title)}</h2>
            <div class="doc-head__meta">
              <span class="meta-chip">${icon('mapPin', 14)}<span id="meta-poco"></span></span>
              <span class="meta-chip">${icon('hash', 14)}<span>ID <code>${esc(draft.uniqueId.slice(0, 8))}</code></span></span>
              <span class="meta-chip"${Number(draft.data?._revisao) > 1 ? ' data-atualizando' : ''}>${icon('calendar', 14)}<span>${Number(draft.data?._revisao) > 1 ? `Atualizando · versão ${Number(draft.data._revisao)}` : draft.isNew ? 'Novo relatório' : 'Rascunho recuperado'}</span></span>
            </div>
          </div>
          <div class="doc-head__side">
            <div class="progress" aria-live="polite">
              <div class="progress__label"><span>Campos obrigatórios</span><strong id="progress-count"></strong></div>
              <div class="progress__track"><span class="progress__fill" id="progress-fill"></span></div>
            </div>
            ${module.id === 'handover' ? `<label class="btn btn--ghost btn--sm" id="btn-import-json" title="Importar um relatório exportado em JSON: ele fica no Histórico e vira o ANTES desta Execução">
              <input type="file" accept=".json,application/json" class="sr-only" data-import-json>${icon('upload', 15)} Upload de Relatório (JSON)
            </label>` : ''}
            <button type="button" class="btn btn--text btn--sm btn--danger-text" id="btn-discard">${icon('trash', 15)} Limpar formulário</button>
          </div>
        </header>
        ${module.herdaDoBdo ? herancaNoticeHtml(bdo, herdados) : ''}
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
  $('[data-import-json]')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (file) await importarJson(file);
  });
  $('#section-nav').addEventListener('click', (e) => {
    const item = e.target.closest('[data-goto-section]');
    if (!item) return;
    e.preventDefault();
    $(`#sec-${item.dataset.gotoSection}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  refreshFormChrome();
  observeSections();
  if (herdados.length) scheduleSave();
  view.dataset.ready = module.id;
}

/** Aviso no topo da Visita / Execução: de qual BDO-e vieram os dados (ou como trazê-los). */
function herancaNoticeHtml(bdo, herdados) {
  if (!bdo) {
    return `<div class="notice notice--warn notice--icon" data-heranca>${icon('info', 16)}<span>O poço, a data e o cliente vêm do BDO-e. <button type="button" class="link-btn" data-goto="bdo">Abra o BDO-e</button> e escolha o Poço / Locação (a busca de poços, o GPS e as rotas ficam lá).</span></div>`;
  }
  const origem = bdo.origem === 'rascunho' ? 'BDO-e em andamento' : 'último BDO-e finalizado';
  const texto = herdados.length
    ? `${herdados.join(', ')} preenchido${herdados.length > 1 ? 's' : ''} com os dados do ${origem} (poço ${bdo.data.poco}).`
    : `Dados herdados do ${origem} (poço ${bdo.data.poco}). Campos alterados aqui não são sobrescritos.`;
  return `<div class="notice notice--info notice--icon" data-heranca>${icon('clipboard', 16)}<span>${esc(texto)}</span></div>`;
}

function companyChipHtml(contrato) {
  const c = companyInfo(contrato);
  if (!c && empresaPorContrato()) {
    // a empresa vem do contrato: sem contrato escolhido, ou o gestor ainda não definiu a do contrato
    const texto = String(contrato || '').trim() ? 'Empresa do contrato não definida pelo gestor' : 'Escolha o contrato para ver a empresa';
    return `<div class="company-chip company-chip--empty" data-empresa-contrato>${icon('building', 15)} ${esc(texto)}</div>`;
  }
  if (!c) {
    return `<button type="button" class="company-chip company-chip--empty" data-goto="${SETTINGS_TAB}">${icon('building', 15)} Empresa não configurada — abrir Configurações</button>`;
  }
  return `<div class="company-chip">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : icon('building', 16)}<span><strong>${esc(c.nome || '')}</strong>${c.cnpj ? ` · CNPJ ${esc(c.cnpj)}` : ''}</span></div>`;
}

/** Empresa no topo do formulário: segue o contrato escolhido (a logo troca junto com o contrato). */
function refreshCompanyChip() {
  const chip = document.querySelector('.doc-head .company-chip');
  if (!chip || !state.draft) return;
  const html = companyChipHtml(state.draft.data?.contrato);
  if (chip.outerHTML !== html) chip.outerHTML = html;
}

// Índice lateral, progresso, poço no cabeçalho e "pronto para finalizar"
function refreshFormChrome() {
  const { formView, module, draft } = state;
  if (!formView) return;
  refreshCompanyChip();

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
    $('#view').classList.add('is-checked'); // a partir daqui as pendências aparecem em cor de atenção
    state.formView.showErrors(errors);
    toast(`Verifique ${errors.length} campo${errors.length > 1 ? 's' : ''} antes de finalizar.`, 'error');
    return;
  }

  const data = cleanData(module, draft.data);
  data._empresa = companyInfo(data.contrato); // congela empresa/logo (a do contrato do relatório) no relatório finalizado
  const choice = await openPreview({ module, uniqueId: draft.uniqueId, data, photos: draft.photos, onNewReport: () => newReport(module) });
  if (!choice) return;

  const report = { uniqueId: draft.uniqueId, module: module.id, data, photos: draft.photos.map(photoMeta) };
  const navAntes = state.navSeq;
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

  // formulário novo; se o técnico já foi para outra aba enquanto gravava, não o puxa de volta
  // (o rascunho novo é criado quando ele voltar a esta aba)
  if (state.navSeq === navAntes) await showTab(module.id);
  if (choice === 'local') {
    toast(`Relatório salvo na memória local deste aparelho. Para guardar o arquivo no celular, use 'Baixar / Compartilhar PDF' (na prévia ou em Histórico › Ver / PDF). Para enviar depois: Histórico › Enviar.`, 'success', 10000);
    return;
  }
  toast(`${navigator.onLine ? 'Relatório na Caixa de Saída. Enviando ao servidor…' : 'Relatório na Caixa de Saída. Será enviado quando houver conexão.'} Uma cópia fica na memória local deste aparelho; para guardar o arquivo no celular, use 'Baixar / Compartilhar PDF' (na prévia ou em Histórico › Ver / PDF).`, 'success', 10000);
  syncNow();
  await shareReport(module, report);
}

/** Cópias PDF + Word do relatório finalizado no Storage (uma vez por relatório; ver core/share.js). */
function publicarDocumentos(module, report) {
  return publishReportDocuments(module, report.uniqueId, () => reportFiles({
    module, uniqueId: report.uniqueId, data: report.data, photos: report.photos, company: report.data._empresa
  }), report.data?._revisao);
}

/**
 * Depois do envio: gera o link do relatório (Supabase Storage) e abre o WhatsApp para o número
 * das Configurações. Sem número, mostra o botão "Abrir WhatsApp" (o técnico escolhe o contato).
 */
async function shareReport(module, report) {
  let link = null;
  let wordLink = null;
  let aviso = '';
  try {
    const urls = await publicarDocumentos(module, report);
    link = urls?.pdf || null;
    wordLink = urls?.docx || null;
  } catch (err) {
    console.error('[share]', err);
    aviso = 'Não foi possível gerar o link agora.';
  }
  const url = waUrl(getSettings().whatsapp_padrao, shareMessage(module, report.data, report.uniqueId, link, wordLink));
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
const NOT_REUSED = new Set(['date', 'datetime', 'time', 'signature', 'photos', 'consolidation', 'visitaNota']);

/**
 * Histórico › Reutilizar.
 * Relatório do próprio aparelho: abre para ATUALIZAÇÃO com o MESMO ID (dados, datas e fotos), e ao
 * finalizar a versão nova substitui a anterior no Histórico e no servidor — não duplica.
 * Relatório de outro técnico (equipe / servidor): não é nosso para alterar → vira um rascunho novo (novo ID).
 */
async function reuseReport(rec) {
  const module = getModule(rec.module);
  if (!module) return;
  const proprio = !rec.remote && rec.status !== 'team' && rec.status !== 'server';
  if (proprio) return atualizarRelatorio(module, rec);
  return reutilizarComoNovo(module, rec);
}

/** Abre o relatório salvo para atualização, com o mesmo ID (data._revisao conta as versões). */
async function atualizarRelatorio(module, rec) {
  const draft = (await hasDraft(module.id)) ? await loadDraft(module.id) : null;
  if (draft && draft.uniqueId !== rec.uniqueId) {
    const ok = await confirmDialog({
      title: 'Substituir o rascunho atual?',
      message: `Já existe um rascunho de "${module.shortTitle}" em andamento. Ele será substituído pelo relatório escolhido, que abre para atualização.`,
      confirmLabel: 'Substituir e atualizar', danger: true
    });
    if (!ok) return;
  }
  const data = rehydrate(module, structuredClone(rec.data));
  data._revisao = (Number(rec.data?._revisao) || 1) + 1;
  await flushSave();
  await restoreDraft({ uniqueId: rec.uniqueId, module: module.id, photos: rec.photos || [] }, data);
  await showTab(module.id);
  window.scrollTo(0, 0);
  toast('Relatório aberto para atualização. Ao finalizar, a versão nova substitui a anterior no Histórico e no servidor (sem duplicar).', 'success', 7000);
}

/** Relatório de outro técnico → rascunho novo (novo ID) preenchido com os dados dele. */
async function reutilizarComoNovo(module, rec) {
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
  const [kind, text, dica] = !s.configured ? ['local', 'Local', 'Sem conexão com o servidor da empresa: os relatórios ficam guardados com segurança neste aparelho.']
    : !s.online ? ['offline', 'Sem conexão', 'Sem internet: os relatórios ficam na Caixa de Saída e são enviados quando a conexão voltar.']
    : s.running ? ['syncing', 'Sincronizando', 'Enviando e recebendo relatórios do servidor da empresa.']
    : ['online', 'Online', 'Conectado ao servidor da empresa.'];
  el.className = `conn conn--${kind}`;
  el.innerHTML = `<span class="conn__dot" aria-hidden="true"></span><span class="conn__text">${text}</span>`;
  el.title = dica;
  el.setAttribute('aria-label', `${text}. ${dica}`);
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

// ---------- Usuário logado ----------

function renderUser() {
  const el = $('#user-chip');
  const user = currentUser();
  if (!el) return;
  el.hidden = !user;
  if (!user) return;
  const nome = user.nome || getSettings().tecnico_nome || displayName(user);
  el.innerHTML = `${icon('user', 16)}<span class="user-chip__name">${esc(nome)}</span>`;
  el.title = `${user.email}${user.modo === 'supabase' ? '' : user.modo === 'offline' ? ' · acesso offline' : ' · usuário local'}`;
}

/** Configurações › Sair: grava o rascunho, encerra a sessão e volta para a tela de login. */
async function signOut() {
  const ok = await confirmDialog({
    title: 'Sair do aplicativo?',
    message: 'Os rascunhos e relatórios continuam guardados neste aparelho. Para voltar, entre de novo com o e-mail e a senha (funciona sem internet depois do primeiro acesso).',
    confirmLabel: 'Sair', cancelLabel: 'Cancelar', iconName: 'user'
  });
  if (!ok) return;
  await flushSave();
  logout();
  renderUser();
  // a tela de login cobre o app (sem recarregar: o Electron bloqueia navegação na janela)
  await showLogin();
  if (currentUser()?.trocarSenha) await showTrocaSenha(); // conta nova: senha inicial do gestor
  await limparEquipeDeOutroUsuario(currentUser()?.email);
  renderUser();
  await showTab(state.tab);
  syncNow({ pull: true }); // login: baixa o histórico da equipe (últimos 30 dias)
}

// ---------- Upload de Relatório (JSON) na Execução ----------

/** Importa o arquivo; salvo, o relatório vira a referência "Antes" da Execução aberta. */
async function importarJson(file) {
  const res = await importarArquivoJson(file);
  if (!res) return;
  const [rel] = res.relatorios;
  const fotos = res.relatorios.reduce((n, r) => n + r.photos.length, 0);
  const comoAntes = await usarComoAntes(rel);
  toast(`${res.relatorios.length} relatório${res.relatorios.length > 1 ? 's' : ''} importado${res.relatorios.length > 1 ? 's' : ''} (${fotos} foto${fotos === 1 ? '' : 's'}) e salvo${res.relatorios.length > 1 ? 's' : ''} no Histórico${res.modo === 'send' ? ' — enviando ao servidor' : ''}.${comoAntes ? ' As fotos aparecem como ANTES nesta Execução.' : ''}`, 'success', 8000);
  if (res.modo === 'send') syncNow();
}

/** Fotos do relatório importado → coluna "Antes" do Relatório de Execução aberto (e o poço, se vazio). */
async function usarComoAntes(rel) {
  if (state.tab !== 'handover' || !state.draft || !rel?.photos?.length) return false;
  if (state.draft.data.poco && rel.data.poco && normPoco(state.draft.data.poco) !== normPoco(rel.data.poco)) return false;
  await flushSave();
  const draft = state.draft;
  if (!draft.data.poco && rel.data.poco) draft.data.poco = rel.data.poco;
  draft.data._antes_fixo = rel.uniqueId;
  await saveDraft(draft);
  await showTab('handover');
  const d = String(rel.data.data || rel.data.data_hora || '').slice(0, 10);
  await state.formView?.importBefore({ uniqueId: rel.uniqueId, data: /^d{4}-d{2}-d{2}$/.test(d) ? d.split('-').reverse().join('/') : '' });
  if (state.draft) await saveDraft(state.draft);
  return true;
}

const normPoco = (t) => String(t || '').toUpperCase().replace(/[^p{L}p{N}]+/gu, '');

// ---------- Licença (core/licenca.js) ----------

const REVALIDAR_LICENCA_MS = 6 * 60 * 60_000;

/** Bloqueia o app com a tela da licença até uma chave ser validada. */
async function bloquearPorLicenca(motivo) {
  await flushSave();
  await showLicenca({ motivo, chave: licencaLocal()?.chave || '' });
}

/** Valida no servidor; valid=false (ou tolerância offline esgotada) bloqueia o app. */
async function revalidarLicenca({ avisarOffline = false } = {}) {
  let r;
  try { r = await verificarLicenca(); } catch (err) { console.error('[licença]', err); return; }
  if (r.status === 'offline' && avisarOffline) {
    toast(`Sem conexão com o servidor de licenças: uso liberado offline por mais ${r.diasRestantes} dia${r.diasRestantes === 1 ? '' : 's'}.`, 'warn', 7000);
  }
  if (r.status === 'bloqueado' || r.status === 'sem-licenca') await bloquearPorLicenca(r.motivo);
}

/**
 * Abertura do app. Com validação ok recente (dentro dos 7 dias) o app abre na hora e a validação roda em
 * segundo plano — sinal ruim no campo não atrasa a abertura; se o servidor disser valid=false, bloqueia.
 * Sem licença válida guardada, espera o servidor (ou a ativação) antes de continuar.
 */
async function exigirLicenca() {
  if (!licenciamentoAtivo()) return;
  if (avaliarSemRede().status === 'offline') {
    revalidarLicenca({ avisarOffline: true });
  } else {
    const r = await verificarLicenca();
    if (r.status !== 'ok' && r.status !== 'offline') await showLicenca({ motivo: r.motivo, chave: licencaLocal()?.chave || '' });
  }
  // app aberto por muito tempo (desktop) e volta da internet: valida de novo
  window.addEventListener('online', () => revalidarLicenca());
  setInterval(() => revalidarLicenca(), REVALIDAR_LICENCA_MS);
}

// ---------- Inicialização ----------

async function init() {
  initTheme();
  await openDb();
  requestPersistence();

  // Licença: ativação na primeira abertura; bloqueio com o motivo se o servidor recusar
  await exigirLicenca();

  // Login: primeira tela quando não há sessão salva neste aparelho
  if (!currentUser()) await showLogin();
  // conta criada pelo gestor: troca de senha obrigatória antes de usar o app
  if (currentUser()?.trocarSenha) await showTrocaSenha();
  await limparEquipeDeOutroUsuario(currentUser()?.email);
  renderUser();

  settingsView = new SettingsView();
  equipeView = new EquipeView();
  settingsView.onSaved = () => syncNow();
  settingsView.onLogout = signOut;
  settingsView.onServerChanged = () => syncNow({ force: true });
  onSettingsChange(() => { settingsView.refreshStatus(); renderUser(); });
  // lista de contratos chegou do servidor (login / sincronização): refaz o campo Contrato aberto
  onContratosChange(() => {
    state.formView?.atualizarContratos();
    refreshCompanyChip(); // empresa/logo dos contratos pode ter mudado
    if (state.tab === SETTINGS_TAB && !settingsView.dirty) settingsView.render();
    // papel mudou (virou ou deixou de ser gestor): refaz as abas; a de equipe some se não for mais gestor
    renderTabs();
    if (state.tab === EQUIPE_TAB) { if (souGestor()) equipeView.refresh(); else showTab(MODULES[0].id); }
  });
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
  setDocumentPublisher(async (rec) => {
    const module = getModule(rec.module);
    if (module) await publicarDocumentos(module, rec);
  });
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
