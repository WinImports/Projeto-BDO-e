// Aba "Configurações do Sistema": empresa prestadora, contrato/cliente e técnico padrão.
import { icon } from './icons.js';
import { esc, $, $$, formatDateTime } from './dom.js';
import { toast } from './toast.js';
import { getSettings, saveSettings, formatCnpj, isValidCnpj, getDeviceId } from '../core/settings.js';
import { pocosStatus, importPocosFile, clearPocosBase } from '../core/pocos.js';
import { confirmDialog } from './confirm.js';

const LOGO_MAX = { w: 480, h: 240 };

// Redimensiona o logo (mantém transparência de PNG) para não pesar no armazenamento local
async function resizeLogo(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, LOGO_MAX.w / bmp.width, LOGO_MAX.h / bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
}

const GROUPS = [
  {
    title: 'Dados da empresa prestadora',
    icon: 'building',
    hint: 'Aparecem no topo de todos os relatórios e no cabeçalho do PDF.',
    fields: [
      { id: 'empresa_nome', label: 'Nome da empresa', placeholder: 'Ex.: WIN IMPORTS', required: true },
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
      { id: 'contrato_padrao', label: 'Nome do contrato', placeholder: 'Ex.: OS-Mans / OS-MANUTEC NE' }
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
    this.root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Sistema</p>
          <h2>Configurações do Sistema</h2>
          <p class="muted small" id="settings-status">${this.statusText(s)}</p>
        </div>
      </div>
      ${this.pocosSectionHtml()}
      <form class="report-form settings-form" novalidate>
        ${GROUPS.map((g) => `
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
                <div class="field" data-wrap="${f.id}">
                  <label class="field__label-wrap" for="s-${f.id}"><span class="field__label">${esc(f.label)}${f.required ? '<span class="req">*</span>' : ''}</span></label>
                  <input id="s-${f.id}" data-setting="${f.id}" type="text" value="${esc(s[f.id])}" placeholder="${esc(f.placeholder || '')}"${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}>
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
      <div class="action-bar">
        <span class="save-status">${icon('info', 16)}<span>Salvas neste computador e enviadas ao servidor · ID do computador <code>${esc(getDeviceId().slice(0, 8))}</code></span></span>
        <div class="action-bar__buttons">
          <button type="button" class="btn btn--primary" data-action="save">${icon('save', 17)} Salvar configurações</button>
        </div>
      </div>`;
    this.bindDropzone();
    this.refreshPocos();
  }

  // ---------- Base de Poços e Locações ----------

  pocosSectionHtml() {
    return `
      <section class="card form-section pocos-section" id="pocos-section">
        <header class="form-section__head">
          <span class="form-section__icon">${icon('map', 20)}</span>
          <div class="form-section__titles">
            <h3 class="form-section__title">Base Local de Poços e Locações</h3>
            <p class="form-section__hint">Alimenta o autocompletar do campo Poço / Locação nos 3 relatórios e preenche as coordenadas. Fica salva neste computador e funciona sem internet. A importação vale na hora (não precisa "Salvar configurações").</p>
          </div>
        </header>
        <div class="pocos-body">
          <div class="pocos-status" data-pocos-status><span class="spinner" aria-hidden="true"></span> Verificando base…</div>
          <label class="dropzone" data-dropzone>
            <input type="file" accept=".csv,.kml" class="sr-only" data-pocos-input>
            <span class="dropzone__icon">${icon('upload', 26)}</span>
            <strong class="dropzone__title" data-dropzone-title>Arraste o arquivo .csv ou .kml aqui</strong>
            <span class="dropzone__sub">ou <u>clique para selecionar</u></span>
            <small class="dropzone__help">CSV: colunas com o nome do poço, latitude e longitude (separador ; ou , — vírgula decimal e graus/min/seg aceitos). KML: marcadores exportados do Google Earth/Maps.</small>
          </label>
          <div data-pocos-report></div>
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
        <div><strong class="pocos-status__count">Nenhuma base carregada</strong>
        <span class="muted small">O campo Poço / Locação aceita digitação livre e o GPS continua funcionando.</span></div>`;
      return;
    }
    const when = st.importadoEm ? new Date(st.importadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const imported = st.origem === 'importada';
    box.className = 'pocos-status pocos-status--ok';
    box.innerHTML = `<span class="pocos-status__icon">${icon('checkCircle', 22)}</span>
      <div>
        <strong class="pocos-status__count" data-pocos-count>${st.total.toLocaleString('pt-BR')} poços carregados</strong>
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
      title.textContent = 'Arraste o arquivo .csv ou .kml aqui';
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
        <strong>${n} poços importados de ${esc(res.fonte)}</strong> (${res.formato}, ${res.lidos.toLocaleString('pt-BR')} registros lidos).
        ${res.foraDaRegiao ? `<br>Atenção: ${res.foraDaRegiao} poço(s) com coordenadas fora da região BA/SE — confira o arquivo.` : ''}
        ${problemsHtml(res.problems, res.problemsCount)}</div></div>`;
    toast(`${n} poços carregados. O autocompletar dos relatórios já usa a nova base.`, 'success', 5000);
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
  }

  save() {
    const values = Object.fromEntries($$('[data-setting]', this.root).map((i) => [i.dataset.setting, i.value]));
    values.empresa_logo = this.logo || '';
    const errors = [];
    if (!values.empresa_nome.trim()) errors.push(['empresa_nome', 'Informe o nome da empresa']);
    if (values.empresa_cnpj.trim() && !isValidCnpj(values.empresa_cnpj)) errors.push(['empresa_cnpj', 'CNPJ inválido (confira os dígitos)']);
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
