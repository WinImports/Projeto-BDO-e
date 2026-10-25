// Aba "Configurações do Sistema": empresa prestadora, contrato/cliente e técnico padrão.
import { sanitizarWhatsApp } from '../core/telefone.js';
import { icon } from './icons.js';
import { esc, $, $$, formatDateTime } from './dom.js';
import { toast } from './toast.js';
import { getSettings, saveSettings, formatCnpj, isValidCnpj, getDeviceId } from '../core/settings.js';
import { pocosStatus, importPocosFile, clearPocosBase } from '../core/pocos.js';
import { confirmDialog } from './confirm.js';
import { currentUser, displayName } from '../core/auth.js';
import { supabaseConfig, saveSupabaseOverride, urlSupabaseValida } from '../config.js';
import { resetClient } from '../core/supabase.js';
import { contratoSelectHtml } from './contrato-campo.js';
import { LOGO_MAX, resizeLogo } from './logo.js';
import { empresaPorContrato, empresasDosContratos, souGestor } from '../core/contratos.js';

const ORIGEM_SERVIDOR = {
  aparelho: 'Configurado neste aparelho',
  ambiente: 'Configurado pelas variáveis de ambiente do computador (BDOE_SUPABASE_URL / BDOE_SUPABASE_ANON_KEY)',
  publicacao: 'Configurado na publicação do site',
  config: 'Configurado no app (src/config.js)'
};

/** Chave secreta (service_role / sb_secret_) nunca pode ir para o aparelho. */
function chaveSecreta(chave) {
  if (/^sb_secret_/i.test(chave)) return true;
  try {
    const payload = JSON.parse(atob(chave.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch { return false; }
}

const MODO_LOGIN = {
  supabase: 'Conta confirmada no servidor da empresa',
  offline: 'Acesso offline com a última senha confirmada neste aparelho',
  local: 'Usuário local deste aparelho'
};

const GROUPS = [
  {
    title: 'Dados da empresa prestadora',
    icon: 'building',
    hint: 'Aparecem no topo de todos os relatórios e no cabeçalho do PDF.',
    fields: [
      { id: 'empresa_nome', label: 'Nome da empresa', placeholder: 'Ex.: Nome da sua empresa', required: true },
      { id: 'empresa_cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00', inputmode: 'numeric' }
    ],
    logo: true
  },
  {
    title: 'Dados do contrato / cliente',
    icon: 'clipboard',
    hint: 'Preenchidos automaticamente em cada relatório novo (podem ser alterados no próprio relatório).',
    fields: [
      { id: 'cliente_padrao', label: 'Cliente padrão', placeholder: 'Ex.: PETROBRAS' },
      { id: 'contrato_padrao', label: 'Contrato padrão', contratos: true, hint: 'Contratos vinculados à sua conta no servidor.' }
    ]
  },
  {
    title: 'Dados do usuário / técnico',
    icon: 'user',
    hint: 'Preenchem o técnico responsável e a matrícula nos relatórios novos.',
    fields: [
      { id: 'tecnico_nome', label: 'Nome do técnico padrão', placeholder: 'Ex.: ANDERSON SOUZA' },
      { id: 'tecnico_matricula', label: 'Matrícula / Chave', placeholder: 'Ex.: 30882' },
      { id: 'tecnico_cargo', label: 'Cargo', placeholder: 'Ex.: Técnico / Encarregado de Campo' }
    ]
  },
  {
    title: 'Envio de relatórios',
    icon: 'send',
    hint: 'Ao enviar um relatório, o app abre o WhatsApp com a mensagem e o link do relatório para este número.',
    fields: [
      { id: 'whatsapp_padrao', label: 'Telefone Padrão para Envio de Relatórios (WhatsApp)', placeholder: 'Ex.: (71) 99961-2118 — vira 5571999612118', inputmode: 'tel' }
    ]
  },
  {
    title: 'Bases e locais personalizados (deslocamentos)',
    icon: 'mapPin',
    hint: 'Destinos reconhecidos na apropriação do BDO ("Indo para Taquipe") além dos poços da base e das cidades da região. Um local por linha: Nome; latitude; longitude.',
    fields: [
      { id: 'locais_personalizados', label: 'Locais (Nome; latitude; longitude)', multiline: true, placeholder: 'Base Taquipe; -12.5500; -38.4000\nFazenda Imbé; -12.3000; -38.1000', hint: 'Use as coordenadas do Google Maps (toque e segure no local › copie os números).' }
    ]
  }
];

export class SettingsView {
  constructor() {
    this.root = document.createElement('div');
    this.root.addEventListener('click', (e) => this.handleClick(e));
    this.root.addEventListener('input', (e) => this.handleInput(e));
    this.root.addEventListener('change', (e) => this.handleChange(e));
  }

  render() {
    const s = getSettings();
    this.logo = s.empresa_logo;
    this.dirty = false;
    const porContrato = empresaPorContrato(); // empresa/logo definidas por contrato (migração 003)
    this.root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Sistema</p>
          <h2>Configurações do Sistema</h2>
          <p class="muted small" id="settings-status">${this.statusText(s)}</p>
        </div>
      </div>
      ${this.contaSectionHtml()}
      ${this.pocosSectionHtml()}
      <form class="report-form settings-form" novalidate>
        ${GROUPS.map((g) => g.logo && porContrato ? this.empresaContratoHtml(g) : `
          <section class="card form-section">
            <header class="form-section__head">
              <span class="form-section__icon">${icon(g.icon, 20)}</span>
              <div class="form-section__titles">
                <h3 class="form-section__title">${esc(g.title)}</h3>
                ${g.hint ? `<p class="form-section__hint">${esc(g.hint)}</p>` : ''}
              </div>
            </header>
            <div class="form-grid">
              ${g.fields.map((f) => `
                <div class="field${f.multiline ? ' span-12' : ''}" data-wrap="${f.id}">
                  <label class="field__label-wrap" for="s-${f.id}"><span class="field__label">${esc(f.label)}${f.required ? '<span class="req">*</span>' : ''}</span></label>
                  ${f.contratos
                    ? contratoSelectHtml({ id: `s-${f.id}`, attrs: `data-setting="${f.id}"`, valor: s[f.id] })
                    : f.multiline
                    ? `<textarea id="s-${f.id}" data-setting="${f.id}" rows="4" placeholder="${esc(f.placeholder || '')}">${esc(s[f.id])}</textarea>`
                    : `<input id="s-${f.id}" data-setting="${f.id}" type="text" value="${esc(s[f.id])}" placeholder="${esc(f.placeholder || '')}"${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}>`}
                  ${f.hint ? `<small class="field__hint">${esc(f.hint)}</small>` : ''}
                  <small class="field__error"></small>
                </div>`).join('')}
              ${g.logo ? `
                <div class="field span-12">
                  <span class="field__label">Logo da empresa</span>
                  <div class="logo-upload">
                    <div class="logo-upload__preview" id="logo-preview">${this.logoHtml()}</div>
                    <div class="logo-upload__actions">
                      <label class="btn btn--ghost btn--sm">
                        <input type="file" accept="image/png,image/jpeg" class="sr-only" data-logo-input>${icon('upload', 15)} Escolher logo (.png / .jpg)
                      </label>
                      <button type="button" class="btn btn--ghost btn--sm" data-action="remove-logo"${this.logo ? '' : ' hidden'}>${icon('trash', 15)} Remover logo</button>
                      <small class="muted">Aparece no cabeçalho dos relatórios e do PDF. Redimensionado para até ${LOGO_MAX.w}×${LOGO_MAX.h} px.</small>
                    </div>
                  </div>
                </div>` : ''}
            </div>
          </section>`).join('')}
      </form>
      <details class="card advanced" id="servidor-avancado">
        <summary class="advanced__summary">
          <span class="form-section__icon">${icon('shield', 20)}</span>
          <span class="advanced__titles">
            <strong>Avançado (administrador)</strong>
            <span class="muted small">Conexão com o servidor da empresa. Já vem configurada na instalação; altere só com orientação do administrador.</span>
          </span>
          <span class="advanced__chevron" aria-hidden="true">${icon('chevronDown', 18)}</span>
        </summary>
        ${this.servidorSectionHtml()}
      </details>
      <div class="action-bar">
        <span class="save-status">${icon('info', 16)}<span>Salvas neste computador e enviadas ao servidor · ID do computador <code>${esc(getDeviceId().slice(0, 8))}</code></span></span>
        <div class="action-bar__buttons">
          <button type="button" class="btn btn--primary" data-action="save">${icon('save', 17)} Salvar configurações</button>
        </div>
      </div>`;
    this.bindDropzone();
    this.refreshPocos();
  }

  // ---------- Empresa por contrato (somente leitura aqui; quem altera é o gestor em Gestão de Equipe) ----------

  empresaContratoHtml(g) {
    const empresas = empresasDosContratos();
    const gestor = souGestor();
    return `
      <section class="card form-section" data-empresa-por-contrato>
        <header class="form-section__head">
          <span class="form-section__icon">${icon(g.icon, 20)}</span>
          <div class="form-section__titles">
            <h3 class="form-section__title">${esc(g.title)}</h3>
            <p class="form-section__hint">Definidos por contrato pelo gestor. Cada relatório usa a empresa e a logo do contrato escolhido nele.</p>
          </div>
        </header>
        <ul class="empresa-contratos">
          ${empresas.map((e) => `
            <li class="empresa-contratos__item" data-empresa-contrato="${esc(e.nome)}">
              <div class="logo-upload__preview">${e.empresa_logo ? `<img src="${esc(e.empresa_logo)}" alt="Logo de ${esc(e.empresa_nome || e.nome)}">` : '<span class="muted small">Sem logo</span>'}</div>
              <div>
                <strong>${esc(e.nome)}</strong>
                <span class="muted small">${e.empresa_nome ? `${esc(e.empresa_nome)}${e.empresa_cnpj ? ` · CNPJ ${esc(e.empresa_cnpj)}` : ''}` : 'Empresa ainda não definida pelo gestor'}</span>
              </div>
            </li>`).join('') || '<li class="muted">Nenhum contrato vinculado à sua conta.</li>'}
        </ul>
        ${gestor ? `<p class="small"><button type="button" class="link-btn" data-goto="equipe">Alterar em Gestão de Equipe</button></p>` : ''}
      </section>`;
  }

  // ---------- Conta (login) ----------

  contaSectionHtml() {
    const user = currentUser();
    if (!user) return '';
    return `
      <section class="card form-section conta-section" id="conta-section">
        <header class="form-section__head">
          <span class="form-section__icon">${icon('user', 20)}</span>
          <div class="form-section__titles">
            <h3 class="form-section__title">Conta</h3>
            <p class="form-section__hint">A sessão fica salva neste aparelho: não é preciso entrar de novo a cada abertura, mesmo sem sinal.</p>
          </div>
        </header>
        <div class="conta">
          <div class="conta__info">
            <strong data-conta-nome>${esc(user.nome || getSettings().tecnico_nome || displayName(user))}</strong>
            <span class="muted small" data-conta-email>${esc(user.email)} · ${esc(MODO_LOGIN[user.modo] || '')}</span>
            ${user.modo !== 'supabase' && supabaseConfig().origem ? '<span class="small" data-conta-vincular>Para vincular os envios à sua conta no servidor, toque em Sair e entre de novo com internet.</span>' : ''}
          </div>
          <button type="button" class="btn btn--ghost btn--danger-text" data-action="logout">${icon('arrowLeft', 16)} Sair / Logout</button>
        </div>
      </section>`;
  }

  // ---------- Servidor (Supabase) ----------

  servidorSectionHtml() {
    const cfg = supabaseConfig();
    const local = cfg.origem === 'aparelho';
    return `
      <section class="form-section advanced__body" id="servidor-section">
        <header class="form-section__head">
          <span class="form-section__icon">${icon('cloud', 20)}</span>
          <div class="form-section__titles">
            <h3 class="form-section__title">Servidor da empresa</h3>
            <p class="form-section__hint">Login, envio dos relatórios, fotos e links do WhatsApp. Dados técnicos fornecidos pelo administrador (Supabase › Project Settings › API: Project URL e chave anon / publishable). Nunca use a chave secreta (service_role).</p>
          </div>
        </header>
        <div class="form-grid">
          <p class="span-12 notice notice--${cfg.origem ? 'ok' : 'warn'}" data-servidor-status>${esc(cfg.origem ? `${ORIGEM_SERVIDOR[cfg.origem]}: ${cfg.url}` : 'Servidor não configurado: os relatórios ficam só neste aparelho e o login é local.')}</p>
          <div class="field span-6" data-wrap="supabase_url">
            <label class="field__label-wrap" for="s-supabase_url"><span class="field__label">Project URL</span></label>
            <input id="s-supabase_url" data-server="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://xxxxxxxx.supabase.co" value="${esc(local ? cfg.url : '')}">
            <small class="field__error"></small>
          </div>
          <div class="field span-6" data-wrap="supabase_key">
            <label class="field__label-wrap" for="s-supabase_key"><span class="field__label">Chave anon / publishable</span></label>
            <input id="s-supabase_key" data-server="key" type="password" autocomplete="off" spellcheck="false" placeholder="eyJhbGciOi… ou sb_publishable_…" value="${esc(local ? cfg.anonKey : '')}">
            <small class="field__error"></small>
          </div>
          <div class="span-12 servidor__acoes">
            <button type="button" class="btn btn--primary btn--sm" data-action="save-server">${icon('save', 15)} Salvar servidor</button>
            ${local ? `<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-action="clear-server">${icon('trash', 15)} Remover deste aparelho</button>` : ''}
          </div>
        </div>
      </section>`;
  }

  /** Redesenha só esta seção (as outras podem ter alterações ainda não salvas). */
  refreshServer() {
    const sec = $('#servidor-section', this.root);
    if (sec) sec.outerHTML = this.servidorSectionHtml();
    const conta = $('#conta-section', this.root); // aviso "vincular a conta" depende do servidor
    if (conta) conta.outerHTML = this.contaSectionHtml();
  }

  async saveServer() {
    const url = $('[data-server=url]', this.root).value.trim();
    const key = $('[data-server=key]', this.root).value.trim();
    const erro = (campo, msg) => {
      const wrap = $(`[data-wrap=${campo}]`, this.root);
      wrap.classList.add('has-error');
      $('.field__error', wrap).textContent = msg;
    };
    $$('#servidor-section .has-error', this.root).forEach((w) => { w.classList.remove('has-error'); $('.field__error', w).textContent = ''; });
    if (!urlSupabaseValida(url)) return erro('supabase_url', 'Use a Project URL no formato https://<projeto>.supabase.co');
    if (!key) return erro('supabase_key', 'Informe a chave anon / publishable');
    if (chaveSecreta(key)) return erro('supabase_key', 'Esta é a chave secreta (service_role). Use a chave anon / publishable.');
    saveSupabaseOverride(url, key);
    resetClient();
    this.refreshServer();
    toast('Servidor salvo neste aparelho. Os relatórios pendentes serão enviados.', 'success');
    this.onServerChanged?.();
  }

  async clearServer() {
    const ok = await confirmDialog({
      title: 'Remover o servidor deste aparelho?',
      message: 'Os relatórios continuam guardados aqui; o envio volta a usar a configuração do app (se houver).',
      confirmLabel: 'Remover', danger: true
    });
    if (!ok) return;
    saveSupabaseOverride('', '');
    resetClient();
    this.refreshServer();
    this.onServerChanged?.();
  }

  // ---------- Base de Poços e Locações ----------

  pocosSectionHtml() {
    return `
      <section class="card form-section pocos-section" id="pocos-section">
        <header class="form-section__head">
          <span class="form-section__icon">${icon('map', 20)}</span>
          <div class="form-section__titles">
            <h3 class="form-section__title">Base Local de Poços e Locações</h3>
            <p class="form-section__hint">Alimenta o autocompletar do campo Poço / Locação do BDO-e (que repassa o poço à Visita Técnica e ao Relatório de Execução) e preenche as coordenadas. Fica salva neste computador e funciona sem internet. A importação vale na hora (não precisa "Salvar configurações").</p>
          </div>
        </header>
        <div class="pocos-body">
          <label class="dropzone" data-dropzone>
            <input type="file" accept=".csv,.kml" class="sr-only" data-pocos-input>
            <span class="dropzone__icon">${icon('upload', 26)}</span>
            <strong class="dropzone__title" data-dropzone-title><span class="only-mouse">Arraste o arquivo .csv ou .kml aqui</span><span class="only-touch">Toque para escolher o arquivo .csv ou .kml</span></strong>
            <span class="dropzone__sub only-mouse">ou <u>clique para selecionar</u></span>
            <small class="dropzone__help">CSV: colunas com o nome do poço, latitude e longitude (separador ; ou , — vírgula decimal e graus/min/seg aceitos). KML: marcadores exportados do Google Earth/Maps.</small>
          </label>
          <div class="pocos-status" data-pocos-status role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Verificando base…</div>
          <div data-pocos-report aria-live="polite"></div>
        </div>
      </section>`;
  }

  async refreshPocos() {
    const box = $('[data-pocos-status]', this.root);
    if (!box) return;
    const st = await pocosStatus();
    if (!st.total) {
      box.className = 'pocos-status pocos-status--empty';
      box.innerHTML = `<span class="pocos-status__icon">${icon('info', 22)}</span>
        <div><strong class="pocos-status__count" data-pocos-count>Nenhuma base carregada</strong>
        <span class="muted small">O campo Poço / Locação aceita digitação livre e o GPS continua funcionando.</span></div>`;
      return;
    }
    const when = st.importadoEm ? new Date(st.importadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const imported = st.origem === 'importada';
    box.className = 'pocos-status pocos-status--ok';
    box.innerHTML = `<span class="pocos-status__icon">${icon('checkCircle', 22)}</span>
      <div>
        <strong class="pocos-status__count" data-pocos-count>Base Ativa: ${st.total.toLocaleString('pt-BR')} poços carregados</strong>
        <span class="muted small">${imported ? 'Importada' : 'Base padrão do app'}${st.fonte ? ` · ${esc(st.fonte)}` : ''}${when ? ` · ${when}` : ''}</span>
      </div>
      ${imported
        ? `<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-action="clear-pocos">${icon('trash', 15)} Limpar Base</button>`
        : ''}`;
  }

  bindDropzone() {
    const zone = $('[data-dropzone]', this.root);
    if (!zone) return;
    const over = (on) => (e) => { e.preventDefault(); zone.classList.toggle('is-dragover', on); };
    zone.addEventListener('dragenter', over(true));
    zone.addEventListener('dragover', over(true));
    zone.addEventListener('dragleave', over(false));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.importPocos(file);
    });
  }

  async importPocos(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    const report = $('[data-pocos-report]', this.root);
    if (!['csv', 'kml', 'kmz', 'txt'].includes(ext)) {
      report.innerHTML = `<div class="notice notice--error">Formato .${esc(ext)} não suportado. Use um arquivo .csv ou .kml.</div>`;
      return;
    }
    const zone = $('[data-dropzone]', this.root);
    const title = $('[data-dropzone-title]', this.root);
    zone.classList.add('is-busy');
    title.innerHTML = `<span class="spinner" aria-hidden="true"></span> Processando ${esc(file.name)}…`;
    report.innerHTML = '';
    let res;
    try {
      res = await importPocosFile(file);
    } catch (err) {
      res = { ok: false, error: err.message };
    } finally {
      zone.classList.remove('is-busy');
      title.innerHTML = '<span class="only-mouse">Arraste o arquivo .csv ou .kml aqui</span><span class="only-touch">Toque para escolher o arquivo .csv ou .kml</span>';
      const input = $('[data-pocos-input]', this.root);
      if (input) input.value = '';
    }

    const problemsHtml = (list = [], count = 0) => (count
      ? `<details class="pocos-problems"><summary>${count} registro${count > 1 ? 's' : ''} ignorado${count > 1 ? 's' : ''} ou com aviso</summary>
          <ul>${list.map((p) => `<li>${esc(p)}</li>`).join('')}${count > list.length ? `<li>… e mais ${count - list.length}</li>` : ''}</ul></details>`
      : '');

    if (!res.ok) {
      report.innerHTML = `<div class="notice notice--error notice--icon">${icon('alert', 18)}<div>
        <strong>Não foi possível importar ${esc(file.name)}</strong><br>${esc(res.error)}
        ${problemsHtml(res.problems, res.problemsCount)}<br><span class="small">A base anterior foi mantida.</span></div></div>`;
      toast('Importação não concluída. Veja os detalhes na tela.', 'error');
      return;
    }
    const n = res.total.toLocaleString('pt-BR');
    report.innerHTML = `<div class="notice notice--ok notice--icon">${icon('checkCircle', 18)}<div>
        <strong class="pocos-success">${n} poços importados com sucesso para a memória local!</strong>
        <br><span class="small">Arquivo ${esc(res.fonte)} · ${res.formato} · ${res.lidos.toLocaleString('pt-BR')} registros lidos. O autocompletar dos relatórios já usa esta base.</span>
        ${res.foraDaRegiao ? `<br>Atenção: ${res.foraDaRegiao} poço(s) com coordenadas fora da região BA/SE — confira o arquivo.` : ''}
        ${problemsHtml(res.problems, res.problemsCount)}</div></div>`;
    toast(`${n} poços importados com sucesso para a memória local!`, 'success', 5000);
    this.refreshPocos();
  }

  async clearPocos() {
    const st = await pocosStatus();
    const ok = await confirmDialog({
      title: 'Limpar a base de poços?',
      message: `Os ${st.total.toLocaleString('pt-BR')} poços importados serão removidos deste computador. Relatórios já preenchidos não mudam.`,
      confirmLabel: 'Limpar Base', danger: true, iconName: 'trash'
    });
    if (!ok) return;
    const after = await clearPocosBase();
    $('[data-pocos-report]', this.root).innerHTML = '';
    toast(after.total ? `Base importada removida. Voltando à base padrão do app (${after.total.toLocaleString('pt-BR')} poços).` : 'Base de poços removida.', 'info');
    this.refreshPocos();
  }

  logoHtml() {
    return this.logo ? `<img src="${esc(this.logo)}" alt="Logo da empresa">` : '<span class="muted small">Sem logo</span>';
  }

  statusText(s) {
    if (!s.updatedAt) return 'Ainda não configurado.';
    const when = `Salvo em ${formatDateTime(s.updatedAt)}`;
    return s.syncPending ? `${when} · aguardando envio ao servidor` : `${when} · sincronizado com o servidor em ${formatDateTime(s.syncedAt)}`;
  }

  refreshStatus() {
    const el = $('#settings-status', this.root);
    if (el) el.textContent = this.statusText(getSettings());
  }

  handleInput(e) {
    const t = e.target;
    if (t.dataset.setting === 'empresa_cnpj') {
      const pos = t.value.length;
      t.value = formatCnpj(t.value);
      if (document.activeElement === t && pos === t.value.length) t.setSelectionRange(pos, pos);
    }
    if (t.dataset.setting) {
      this.dirty = true;
      this.clearError(t.dataset.setting);
    }
  }

  async handleChange(e) {
    if (e.target.dataset.setting === 'whatsapp_padrao') {
      // ao sair do campo: só dígitos, com o 55 do Brasil — ex.: (71) 99961-2118 → 5571999612118
      const raw = e.target.value.trim();
      const limpo = sanitizarWhatsApp(raw);
      if (raw && !limpo) toast('Número de WhatsApp incompleto: informe DDD + número (ex.: 71 99961-2118).', 'warn', 6000);
      if (limpo) e.target.value = limpo;
      return;
    }
    if (e.target.matches('[data-pocos-input]')) {
      const file = e.target.files[0];
      if (file) this.importPocos(file);
      return;
    }
    if (!e.target.matches('[data-logo-input]')) return;
    const file = e.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return toast('Use uma imagem .png ou .jpg.', 'error');
    try {
      this.logo = await resizeLogo(file);
      this.dirty = true;
      $('#logo-preview', this.root).innerHTML = this.logoHtml();
      $('[data-action=remove-logo]', this.root).hidden = false;
    } catch {
      toast('Não foi possível ler a imagem.', 'error');
    }
  }

  handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'remove-logo') {
      this.logo = '';
      this.dirty = true;
      $('#logo-preview', this.root).innerHTML = this.logoHtml();
      btn.hidden = true;
    }
    if (btn.dataset.action === 'save') this.save();
    if (btn.dataset.action === 'clear-pocos') this.clearPocos();
    if (btn.dataset.action === 'logout') this.onLogout?.();
    if (btn.dataset.action === 'save-server') this.saveServer();
    if (btn.dataset.action === 'clear-server') this.clearServer();
  }

  save() {
    const values = Object.fromEntries($$('[data-setting]', this.root).map((i) => [i.dataset.setting, i.value]));
    values.empresa_logo = this.logo || '';
    const errors = [];
    if (!('empresa_nome' in values)) {
      // empresa por contrato: os campos não aparecem aqui; mantém o que estava guardado
      const s = getSettings();
      Object.assign(values, { empresa_nome: s.empresa_nome, empresa_cnpj: s.empresa_cnpj, empresa_logo: s.empresa_logo });
    } else {
      if (!values.empresa_nome.trim()) errors.push(['empresa_nome', 'Informe o nome da empresa']);
      if (values.empresa_cnpj.trim() && !isValidCnpj(values.empresa_cnpj)) errors.push(['empresa_cnpj', 'CNPJ inválido (confira os dígitos)']);
    }
    if (errors.length) {
      errors.forEach(([id, msg]) => this.showError(id, msg));
      return toast('Corrija os campos destacados.', 'error');
    }
    try {
      saveSettings(values);
    } catch (err) {
      console.error('[settings]', err);
      return toast('Não foi possível salvar (armazenamento local cheio?). Tente um logo menor.', 'error', 7000);
    }
    this.dirty = false;
    this.refreshStatus();
    toast('Configurações salvas. Relatórios novos já usarão esses dados.', 'success');
    this.onSaved?.();
  }

  showError(id, msg) {
    const wrap = $(`[data-wrap="${id}"]`, this.root);
    wrap?.classList.add('has-error');
    if (wrap) $('.field__error', wrap).textContent = msg;
  }

  clearError(id) {
    const wrap = $(`[data-wrap="${id}"]`, this.root);
    if (!wrap?.classList.contains('has-error')) return;
    wrap.classList.remove('has-error');
    $('.field__error', wrap).textContent = '';
  }
}
