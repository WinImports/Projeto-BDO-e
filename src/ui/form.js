// Renderiza um formulário a partir da definição declarativa do módulo e mantém
// draft.data / draft.photos como fonte única da verdade.

import { esc, $, $$ } from './dom.js';
import { openCamera } from './camera.js';
import { toast } from './toast.js';
import { getSettings } from '../core/settings.js';
import { icon } from './icons.js';
import { confirmDialog, infoDialog } from './confirm.js';
import { comprimirFoto } from './compress.js';
import { kmEstrada, posicaoAtual } from '../core/distancia.js';
import { isTravel, resolverDestino } from '../core/deslocamento.js';
import { loadPocos, searchPocos, findPoco, listaPocos, incluirPoco } from '../core/pocos.js';
import { consolidateFromHistory, hasConsolidation, execucaoDoDiaFromHistory } from '../core/consolidar.js';
import { consolidationHtml } from './consolidacao-view.js';
import { routeLinks, showRoutePrompt } from './route-prompt.js';
import { assignPhotoFields, photoFields, photosOf, photoMeta, rotuloFotos, TITULO_EXECUCAO } from '../core/fotos.js';
import { STORES, get } from '../core/db.js';
import { getModule } from '../modules/index.js';
import { meusContratos, valorContrato } from '../core/contratos.js';
import { contratoSelectHtml } from './contrato-campo.js';
import { abrirEditorTexto, usarEditorAmpliado } from './texto-expandido.js';
import { analisar, aplicarSugestao, opcoesDe, sugestoes, rotuloLinha, escolherLinha, limparCampo, NOTA_TORQUE, ROTULOS, CAMPOS, FLANGE_TABLE } from '../core/flange.js';

/** Arquivo de imagem: pelo tipo, ou pela extensão quando o celular não informa o tipo (HEIC/HEIF). */
const ehImagem = (f) => f.type.startsWith('image/') || (!f.type && /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name || ''));

const INPUT_TYPES = { text: 'text', number: 'number', date: 'date', time: 'time', datetime: 'datetime-local' };

const localIso = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString();
};

const isBlank = (v) => v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);

// ---------- Tabelas ----------
// Linhas pré-definidas (presetRows) têm as colunas "locked" fixas (ex.: nome da válvula) e não
// podem ser removidas. Colunas "aux" (ex.: unidade de pressão) não contam como preenchimento.

// newRow(data): valores iniciais de uma linha nova (ex.: data do boletim) — use em colunas "aux"
const newRow = (f, data) => (f.newRow ? f.newRow(data) : {});
/** Linha nova de uma tabela com chain: começa onde a anterior terminou (ex.: hora fim → hora início). */
const chainedRow = (f, data, prev) => {
  const row = newRow(f, data);
  for (const [from, to] of f.chain || []) if (prev?.[from]) row[to] = prev[from];
  return row;
};
const initialRows = (f, data) => (f.presetRows ? f.presetRows.map((r) => ({ ...r, _preset: true })) : [newRow(f, data)]);

const rowFilled = (row, columns) =>
  columns.some((c) => !c.aux && !c.computed && !(row._preset && c.locked) && !isBlank(row[c.id]));

const filledRows = (rows, columns) => (rows || []).filter((row) => rowFilled(row, columns));

export const allFields = (module) => module.sections.flatMap((s) => s.fields);

// ---------- Coordenadas ----------

const toNum = (s) => parseFloat(String(s ?? '').trim().replace(',', '.'));

export function parseCoords(v) {
  const lat = toNum(v?.lat);
  const lng = toNum(v?.lng);
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return valid ? { lat, lng } : null;
}

/** Links de navegação com o ponto como DESTINO da rota (partida = posição atual do aparelho). */
export const mapLinks = (coords) => routeLinks(coords);

// Palavras que indicam deslocamento na apropriação de atividades do BDO
export { isTravel } from '../core/deslocamento.js';

const geoBlank = (v) => isBlank(v?.lat) && isBlank(v?.lng);

/** O campo tem algo a exibir? (tabelas: ao menos uma linha preenchida) */
export function hasContent(f, data, photos = []) {
  switch (f.type) {
    case 'table': return filledRows(data[f.id], f.columns).length > 0;
    case 'geo': return Boolean(parseCoords(data[f.id]));
    case 'photos': return photos.some((p) => p.field === f.id);
    case 'consolidation': return hasConsolidation(data[f.id]);
    default: return !isBlank(data[f.id]);
  }
}

/** Seções sem nenhum campo obrigatório e sem nenhum dado (não entram no PDF). */
export function emptyOptionalSections(module, data, photos = []) {
  return module.sections
    .filter((s) => !s.legacy && !s.fields.some((f) => f.required) && !s.fields.some((f) => hasContent(f, data, photos)))
    .map((s) => s.short || s.title);
}

/** Valor legível para prévia / listagens. */
/**
 * Dados para a prévia, o PDF e o Word: numa seção com algum dado, os campos reportAlways saem sempre ("—"
 * quando vazios, ex.: relatórios antigos) e reportNote acompanha o valor. Devolve uma cópia; o relatório
 * guardado não muda.
 */
export function dadosParaRelatorio(module, data, photos = []) {
  let copia = null;
  for (const s of module.sections) {
    const fixos = s.fields.filter((f) => f.reportAlways);
    if (!fixos.length || !s.fields.some((f) => hasContent(f, data, photos))) continue;
    copia ||= { ...data };
    for (const f of fixos) {
      const v = displayValue(f, data[f.id]);
      copia[f.id] = !v ? '—' : f.reportNote ? `${v} — ${f.reportNote}` : data[f.id];
    }
  }
  return copia || data;
}

export function displayValue(field, value) {
  if (field.type === 'geo') {
    const c = parseCoords(value);
    if (!c) return '';
    const origin = value.source === 'gps' ? `GPS${value.accuracy ? `, ±${value.accuracy} m` : ''}`
      : value.source === 'base' ? 'cadastro de poços' : 'versão anterior';
    return `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)} (${origin})`;
  }
  if (isBlank(value)) return '';
  switch (field.type) {
    case 'date': return new Date(`${value}T00:00`).toLocaleDateString('pt-BR');
    case 'datetime': return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    case 'number': return field.unit ? `${value} ${field.unit}` : String(value);
    case 'checklist': return value.join('; ');
    case 'signature': return 'Assinado';
    default: return String(value);
  }
}

export function displayCell(column, value) {
  if (column.type === 'checkbox') return value ? '✓' : '';
  if (column.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value.split('-').reverse().join('/');
  return isBlank(value) ? '' : String(value);
}

/** Campo obrigatório ainda sem valor? */
export function fieldMissing(f, data) {
  if (!f.required) return false;
  if (f.type === 'geo') return geoBlank(data[f.id]);
  return isBlank(f.type === 'table' ? filledRows(data[f.id], f.columns) : data[f.id]);
}

/**
 * Situação de cada seção (índice lateral e selos):
 * pending (obrigatórios faltando) | done | optional (sem obrigatórios e sem dados)
 */
export function sectionStatus(module, data, photos = []) {
  return module.sections.map((s, index) => {
    const required = s.fields.filter((f) => f.required);
    const missing = required.filter((f) => fieldMissing(f, data)).length;
    const filled = s.fields.some((f) => hasContent(f, data, photos));
    const state = required.length ? (missing ? 'pending' : 'done') : (filled ? 'done' : 'optional');
    return { index, title: s.title, short: s.short || s.title, icon: s.icon, required: required.length, missing, state, legacy: s.legacy };
  }).filter((st) => !st.legacy); // seções do formato anterior não aparecem no formulário
}

export function requiredProgress(module, data) {
  const req = allFields(module).filter((f) => f.required);
  return { total: req.length, filled: req.filter((f) => !fieldMissing(f, data)).length };
}

/** Valida o rascunho. Retorna [{ field, label, message }]. */
export function validate(module, data) {
  const fields = allFields(module);
  const sectionOf = new Map(module.sections.flatMap((s) => s.fields.map((f) => [f, s.short || s.title])));
  const errors = [];
  for (const f of fields) {
    if (f.type === 'geo') {
      const v = data[f.id];
      if (f.required && !parseCoords(v)) errors.push({ field: f.id, label: f.label, message: 'Capture pelo GPS ou escolha o poço na base' });
      continue;
    }
    if (!f.required) continue;
    // sem contrato vinculado à conta o campo fica desabilitado: o relatório segue sem contrato
    if (f.type === 'contrato' && !meusContratos().length) continue;
    const v = f.type === 'table' ? filledRows(data[f.id], f.columns) : data[f.id];
    if (isBlank(v)) {
      errors.push({ field: f.id, label: f.label || sectionOf.get(f), message: f.type === 'table' ? 'Preencha ao menos uma linha' : 'Campo obrigatório' });
    }
  }
  if (typeof module.validate === 'function') {
    const filled = (id) => {
      const f = fields.find((x) => x.id === id);
      return f ? filledRows(data[id], f.columns) : [];
    };
    errors.push(...module.validate(data, { filled }));
  }
  return errors;
}

/**
 * Inverso de cleanData: devolve os dados ao formato de edição. Tabelas com linhas fixas
 * (válvulas, pressões…) voltam a ter todas as linhas, com os valores salvos no lugar certo.
 */
export function rehydrate(module, saved) {
  const { _empresa, ...data } = saved; // a empresa é congelada de novo ao finalizar
  for (const f of allFields(module)) {
    if (f.type !== 'table' || !f.presetRows) continue;
    const rows = Array.isArray(data[f.id]) ? data[f.id] : [];
    const locked = f.columns.filter((c) => c.locked).map((c) => c.id);
    const matches = (row, preset) => locked.every((k) => row[k] === preset[k]);
    const used = new Set();
    const presetRows = f.presetRows.map((p) => {
      const hit = rows.find((r, i) => !used.has(i) && matches(r, p) && used.add(i));
      return { ...p, ...(hit || {}), _preset: true };
    });
    const extra = rows.filter((_, i) => !used.has(i));
    data[f.id] = [...presetRows, ...extra];
  }
  return data;
}

/** Remove linhas vazias e marcações internas de tabelas antes de salvar. */
export function cleanData(module, data) {
  const out = { ...data };
  for (const f of allFields(module)) {
    if (f.type === 'table') out[f.id] = filledRows(data[f.id], f.columns).map(({ _preset, ...row }) => row);
  }
  return out;
}

export class FormView {
  constructor(root, module, draft, { onChange }) {
    this.module = module;
    this.draft = draft;
    this.onChange = onChange;
    this.photoUrls = new Map();
    assignPhotoFields(module, draft.photos); // fotos antigas (sem bloco) vão para "Outras fotos"
    this.fields = new Map(allFields(module).filter((f) => f.id).map((f) => [f.id, f]));
    this.sig = null;

    // Também em rascunhos antigos: preenche só campos que nunca existiram neles (undefined);
    // o que o técnico apagou fica '' e não é tocado (applyDefaults usa ??=).
    this.applyDefaults();
    this.updateAutoTexts();

    this.el = document.createElement('form');
    this.el.className = 'report-form';
    this.el.noValidate = true;
    this.el.innerHTML = module.sections.map((s, i) => (s.legacy ? '' : this.sectionHtml(s, i))).join('');
    this.el.addEventListener('input', (e) => this.handleInput(e));
    this.el.addEventListener('change', (e) => this.handleInput(e));
    this.el.addEventListener('click', (e) => this.handleClick(e));
    this.el.addEventListener('submit', (e) => e.preventDefault());
    this.el.addEventListener('keydown', (e) => {
      if (e.target.matches?.('input[data-expand][readonly]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.expandirCelula(e.target); return; }
      this.handleComboKey(e);
    });
    // celular: a célula de texto longo fica só leitura antes do toque (sem teclado nem página pulando);
    // o clique abre o editor ampliado. No computador continua um campo comum.
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target.matches?.('input[data-expand]')) e.target.readOnly = usarEditorAmpliado();
    });
    this.el.addEventListener('focusout', (e) => {
      if (e.target.dataset.combo && !e.relatedTarget?.closest?.('.combo')) this.closeCombo(e.target);
    });
    this.el.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.combo__opt');
      if (!opt) return;
      e.preventDefault(); // mantém o foco no campo
      const input = opt.closest('.combo').querySelector('[data-combo]');
      this.pickWell(input, this.comboItems[Number(opt.dataset.index)]);
    });
    if ([...this.fields.values()].some((f) => f.autocomplete === 'pocos')) {
      loadPocos().then((base) => { this.pocos = base; this.updatePocosHint(); if (this.el.isConnected) this.refreshGeo(); });
    }
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((t) =>
      this.el.addEventListener(t, (e) => this.handlePointer(e)));
    root.replaceChildren(this.el);
    this.paintSignatures();
    this.updateComputed();
    this.updateSectionBadges();
    const cf = this.consolField();
    // refaz ao abrir: BDOs finalizados depois entram sem precisar clicar em "Atualizar"
    if (cf && draft.data.poco && draft.data.periodo_inicio && draft.data.periodo_fim) this.scheduleConsolidation();
    if (this.module.execucaoDoBdo) this.scheduleExecucaoBdo();
  }

  // ---------- Execução: atividades do BDO do mesmo dia (module.execucaoDoBdo) ----------

  scheduleExecucaoBdo() {
    clearTimeout(this.execTimer);
    this.execTimer = setTimeout(() => this.syncExecucaoBdo(), 350);
  }

  /** Lê o histórico e guarda em data._execucao_bdo as atividades de execução do BDO do dia (vira linhas _auto). */
  async syncExecucaoBdo() {
    const cfg = this.module.execucaoDoBdo;
    const d = this.draft.data;
    const dia = String(d[cfg.campoData] || '').slice(0, 10);
    const lista = await execucaoDoDiaFromHistory({ poco: String(d.poco || '').trim(), dia });
    if (!this.el?.isConnected) return;
    if (JSON.stringify(lista) === JSON.stringify(d._execucao_bdo || [])) return;
    d._execucao_bdo = lista;
    this.changed('_execucao_bdo');
  }

  status() {
    return sectionStatus(this.module, this.draft.data, this.draft.photos);
  }

  updateSectionBadges() {
    for (const st of this.status()) {
      const badge = $(`[data-section-badge="${st.index}"]`, this.el);
      if (!badge) continue;
      badge.className = `section-badge section-badge--${st.state}`;
      badge.innerHTML = st.state === 'pending'
        ? `${icon('alert', 14)} ${st.missing} pendente${st.missing > 1 ? 's' : ''}`
        : st.state === 'done' ? `${icon('check', 14)} Completo` : 'Opcional';
    }
  }

  // Campos calculados (type: 'computed', compute(data)) — valor também vai para o relatório
  updateComputed() {
    for (const f of this.fields.values()) {
      if (f.type !== 'computed') continue;
      this.draft.data[f.id] = f.compute(this.draft.data) || '';
      const out = $(`[data-computed-field="${CSS.escape(f.id)}"]`, this.el);
      if (out) out.textContent = this.draft.data[f.id] || '—';
    }
  }

  // ---------- Assistente Técnico de Flanges (core/flange.js) ----------

  /**
   * Um campo do flange p mudou: cruza tudo o que o técnico preencheu, completa o que der e atualiza as opções das
   * outras caixas e o card. As caixas são atualizadas NO LUGAR (valor e lista), nunca recriadas: o técnico não
   * perde o foco nem o cursor ao passar de um campo para outro.
   */
  atualizarFlange(p) {
    aplicarSugestao(this.draft.data, p);
    for (const c of CAMPOS) this.atualizarCampoFlange(`${p}_${c}`);
    // o card só é redesenhado se mudou: sair de um campo (evento change) não pode recriar o botão que está
    // sendo clicado — o clique se perderia
    const wrap = $(`[data-wrap="${CSS.escape(`${p}_apoio`)}"]`, this.el);
    const html = this.fieldInnerHtml(this.fields.get(`${p}_apoio`));
    this.cardsFlange ||= {};
    if (wrap && this.cardsFlange[p] !== html) { wrap.innerHTML = html; this.cardsFlange[p] = html; }
  }

  atualizarCampoFlange(id) {
    const f = this.fields.get(id);
    const el = $(`[data-field="${CSS.escape(id)}"]`, this.el);
    if (!f?.flangeCampo || !el) return;
    const v = String(this.draft.data[id] ?? '');
    if (el.tagName === 'SELECT') {
      const tmp = document.createElement('div');
      tmp.innerHTML = this.selectFlangeHtml(f, v);
      el.innerHTML = tmp.firstElementChild.innerHTML;
    } else {
      this.atualizarListaFlange(id);
    }
    // o campo que o técnico está digitando já tem em data o mesmo valor; só muda o que o app preencheu
    if (el.value !== v) el.value = v;
  }

  /** Lista de sugestões (datalist) de um campo do flange: só o que ainda combina com os outros campos. */
  listaFlangeHtml(f) {
    const { combinam } = opcoesDe(this.draft.data, f.flange, f.flangeCampo);
    return combinam.map((o) => `<option value="${esc(o)}"></option>`).join('');
  }

  atualizarListaFlange(id) {
    const f = this.fields.get(id);
    const dl = $(`#dl-${CSS.escape(id)}`, this.el);
    if (f?.flangeCampo && dl) dl.innerHTML = this.listaFlangeHtml(f);
  }

  /** Select de Flange / Pressão: primeiro o que combina com o já preenchido; o resto separado (não trava). */
  selectFlangeHtml(f, v) {
    const { combinam, outras } = opcoesDe(this.draft.data, f.flange, f.flangeCampo);
    const opt = (o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`;
    const fora = v && !combinam.includes(v) && !outras.includes(v) ? [v] : []; // valor antigo fora da lista
    const resto = outras.length && combinam.length
      ? `<optgroup label="Não combinam com o já preenchido">${outras.map(opt).join('')}</optgroup>`
      : outras.map(opt).join('');
    return `<select id="f-${esc(f.id)}" data-field="${esc(f.id)}">
      <option value="">Selecione…</option>
      ${[...combinam, ...fora].map(opt).join('')}
      ${resto}
    </select>`;
  }

  /** Card de Apoio: o que foi cruzado, as opções que restam, a chave e o torque do flange identificado. */
  flangeCardHtml(p) {
    const a = analisar(this.draft.data, p);
    const caixa = (estado, html) => `<div class="flange-card flange-card--${estado}" data-flange-card="${esc(p)}" data-estado="${estado}">${html}</div>`;
    const lista = (obj) => Object.entries(obj).map(([c, v]) => `<strong>${esc(ROTULOS[c])}</strong> ${esc(v)}`).join(' · ');
    const usados = Object.keys(a.filtros).length ? `<p class="small" data-flange-filtros>Cruzando: ${lista(a.filtros)}</p>` : '';
    const anotacoes = Object.keys(a.ignorados).length
      ? `<p class="small muted" data-flange-ignorados>${icon('info', 14)} Não estão na tabela (ficam como anotação e não entram na busca): ${lista(a.ignorados)}</p>` : '';
    const opcao = (l) => `<button type="button" class="btn btn--ghost btn--sm" data-action="flange-opcao" data-target="${esc(p)}" data-linha="${FLANGE_TABLE.indexOf(l)}">${esc(rotuloLinha(l))}</button>`;

    if (a.status === 'incompleto') {
      return caixa('incompleto', `<p class="muted small">${icon('wrench', 15)} Preencha <strong>qualquer</strong> dado que você tiver — flange, pressão, nº de parafusos, anel, diâmetro ou comprimento do prisioneiro, chave ou torque — em qualquer ordem. O app cruza com a tabela, mostra nas caixas só o que combina e completa o resto.</p>${anotacoes}`);
    }
    if (a.status === 'nenhum') {
      const limpar = Object.entries(a.semCampo).map(([c, n]) => `<button type="button" class="btn btn--ghost btn--sm" data-action="flange-limpar" data-target="${esc(p)}" data-campo="${c}">Limpar ${esc(ROTULOS[c])} (${esc(a.filtros[c])}) → ${n} ${n === 1 ? 'opção' : 'opções'}</button>`).join('');
      return caixa('nenhum', `<p class="small">${icon('alert', 15)} <strong>Nenhum flange da tabela combina com tudo o que foi preenchido.</strong></p>${usados}
        <div class="flange-card__opcoes" data-flange-limpar>${limpar}</div>${anotacoes}`);
    }
    if (a.status === 'multiplo') {
      const muitas = a.linhas.length > 8;
      return caixa('multiplo', `<p class="small"><strong>${a.linhas.length} flanges combinam.</strong> ${muitas ? 'Preencha mais um campo para estreitar.' : 'Preencha mais um campo ou escolha:'}</p>${usados}
        ${muitas ? '' : `<div class="flange-card__opcoes">${a.linhas.map(opcao).join('')}</div>`}${anotacoes}`);
    }
    const l = a.linhas[0];
    const sug = sugestoes(l);
    const pedePressao = l.pressao === '3/5M' && !this.draft.data[`${p}_pressao`];
    return caixa('unico', `
      <p class="flange-card__titulo">${icon('wrench', 16)} Flange identificado — ${esc(l.flange)} ${esc(l.pressao)} · anel ${esc(l.anel)} · ${l.furos} furos</p>
      ${usados}
      <div class="flange-card__dados">
        <div><span class="flange-card__rotulo">Chave</span><strong data-flange-chave>${esc(sug.chave)}</strong></div>
        <div><span class="flange-card__rotulo">Torque recomendado</span><strong data-flange-torque>${esc(sug.torque)}</strong></div>
      </div>
      ${pedePressao ? '<p class="small muted" data-flange-pressao>Na tabela vale para 3M e 5M: escolha a pressão do flange.</p>' : ''}
      ${anotacoes}
      <p class="flange-card__nota small" data-flange-nota>${esc(NOTA_TORQUE)}</p>`);
  }

  /** A lista de contratos mudou (login / sincronização): refaz o campo e aplica o padrão se estava vazio. */
  atualizarContratos() {
    const settings = getSettings();
    let mudou = false;
    for (const f of this.fields.values()) {
      if (f.type !== 'contrato') continue;
      const antes = this.draft.data[f.id];
      const v = valorContrato(antes, settings[f.settingsKey]);
      if (v !== undefined && v !== antes) { this.draft.data[f.id] = v; mudou = true; }
      const wrap = $(`[data-wrap="${CSS.escape(f.id)}"]`, this.el);
      if (wrap) wrap.innerHTML = this.fieldInnerHtml(f);
    }
    if (mudou) this.onChange(this.draft);
  }

  destroy() {
    clearTimeout(this.travelTimer);
    clearTimeout(this.routeRefreshTimer);
    this.photoUrls.forEach((url) => URL.revokeObjectURL(url));
    this.photoUrls.clear();
  }

  applyDefaults() {
    const now = localIso();
    const settings = getSettings();
    for (const f of this.fields.values()) {
      if (f.type === 'contrato') {
        // só contratos da conta: o único da lista ou o padrão das Configurações, se estiver na lista
        const v = valorContrato(this.draft.data[f.id], settings[f.settingsKey]);
        if (v !== undefined) this.draft.data[f.id] = v;
        continue;
      }
      if (f.settingsKey && settings[f.settingsKey]) this.draft.data[f.id] ??= settings[f.settingsKey];
      if (f.defaultValue != null) this.draft.data[f.id] ??= f.defaultValue;
      if (f.type === 'table' && f.defaultRows && this.draft.data[f.id] === undefined) this.draft.data[f.id] = f.defaultRows(settings);
      if (f.type === 'date' && f.defaultDaysAgo) {
        const d = new Date();
        d.setDate(d.getDate() - f.defaultDaysAgo);
        this.draft.data[f.id] ??= `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      if (f.type === 'date') this.draft.data[f.id] ??= now.slice(0, 10);
      if (f.type === 'datetime') this.draft.data[f.id] ??= now.slice(0, 16);
    }
  }

  // ---------- HTML ----------

  sectionHtml(section, i) {
    return `
      <section class="card form-section" id="sec-${i}" data-section="${i}">
        <header class="form-section__head">
          <span class="form-section__icon">${icon(section.icon || 'clipboard', 20)}</span>
          <div class="form-section__titles">
            <h3 class="form-section__title"><span class="form-section__num">${i + 1}.</span> ${esc(section.title)}</h3>
            ${section.hint ? `<p class="form-section__hint">${esc(section.hint)}</p>` : ''}
          </div>
          <span class="section-badge" data-section-badge="${i}"></span>
        </header>
        <div class="form-grid">${section.fields.filter((f) => !f.formHidden).map((f) => this.fieldHtml(f)).join('')}</div>
      </section>`;
  }

  // Grade de 12 colunas: f.span define a largura; campos longos ocupam a linha toda
  fieldSpan(f) {
    if (f.span) return f.span;
    if (f.full || ['table', 'photos', 'signature', 'geo', 'textarea', 'checklist', 'consolidation'].includes(f.type)) return 12;
    return 3;
  }

  fieldHtml(f) {
    if (f.type === 'divider') {
      return `<div class="field-divider span-12">${f.icon ? icon(f.icon, 15) : ''}<span>${esc(f.label)}</span></div>`;
    }
    const cls = ['field', `span-${this.fieldSpan(f)}`, f.highlight && 'field--highlight'].filter(Boolean).join(' ');
    const oculto = f.type === 'visitaNota' && !this.draft.data[f.id] ? ' hidden' : ''; // sem Visita de referência: nada aparece
    return `<div class="${cls}" data-wrap="${esc(f.id)}"${oculto}>${this.fieldInnerHtml(f)}</div>`;
  }

  fieldInnerHtml(f) {
    if (f.type === 'visitaNota') return this.controlHtml(f);
    const exigido = f.required && !(f.type === 'contrato' && !meusContratos().length); // sem contratos não é exigido
    const label = f.label && !f.previewButton
      ? `<span class="field__label">${esc(f.type === 'photos' ? rotuloFotos(f, this.draft.data) : f.label)}${exigido ? '<span class="req" aria-hidden="true">*</span>' : ''}</span>`
      : '';
    const hint = f.hint ? `<small class="field__hint">${esc(f.hint)}</small>` : '';
    const error = '<small class="field__error" aria-live="polite"></small>';
    const grouped = ['checklist', 'yesno', 'table', 'photos', 'signature', 'geo', 'consolidation', 'flangeCard'].includes(f.type);
    const control = this.controlHtml(f);
    if (f.previewButton) return `${control}${hint}${error}`; // sem <label>: o texto do botão é o nome acessível
    return grouped
      ? `<fieldset class="field__group">${label ? `<legend${f.hideLabel ? ' class="sr-only"' : ''}>${label}</legend>` : `<legend class="sr-only">${esc(f.id)}</legend>`}${control}${hint}${error}</fieldset>`
      : `<label class="field__label-wrap" for="f-${esc(f.id)}">${label}</label>${control}${hint}${error}`;
  }

  controlHtml(f) {
    const v = this.draft.data[f.id];
    const id = esc(f.id);
    switch (f.type) {
      case 'visitaNota':
        return v ? `<p class="visita-nota" data-visita-nota="${id}">${icon('clock', 15)}<span>${esc(v)}</span></p>` : '';

      case 'flangeCard':
        return this.flangeCardHtml(f.flange);

      case 'contrato':
        return contratoSelectHtml({ id: `f-${f.id}`, attrs: `data-field="${id}"`, valor: v });

      case 'select':
        if (f.flangeCampo) return this.selectFlangeHtml(f, v);
        return `<select id="f-${id}" data-field="${id}">
          <option value="">Selecione…</option>
          ${f.options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select>`;

      case 'textarea':
        if (f.lockEdit) {
          // texto padrão protegido contra toques acidentais: só fica editável pelo botão
          return `<div class="locked-text">
            <textarea id="f-${id}" data-field="${id}" rows="${f.autoText ? 6 : 3}" readonly class="is-locked" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>
            ${f.autoText ? `<p class="autotext-status small" data-autotext-status="${id}">${this.autoTextStatus(f)}</p>` : ''}
            <div class="locked-text__actions">
              <button type="button" class="btn btn--ghost btn--sm" data-action="toggle-lock" data-target="${id}" aria-pressed="false">${icon('pen', 15)} <span>${esc(f.lockEdit)}</span></button>
              ${f.autoText ? `<button type="button" class="btn btn--text btn--sm" data-action="regen-text" data-target="${id}"${this.autoTextManual(f) ? '' : ' hidden'}>${icon('refresh', 15)} Gerar de novo${f.autoTextFonte ? '' : ' pela apropriação'}</button>` : ''}
            </div>
          </div>`;
        }
        return `<textarea id="f-${id}" data-field="${id}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;

      case 'checklist':
        return `<div class="checklist">${f.options.map((o) => `
          <label class="check">
            <input type="checkbox" data-field="${id}" data-kind="checklist" value="${esc(o)}"${(v || []).includes(o) ? ' checked' : ''}>
            <span>${esc(o)}</span>
          </label>`).join('')}</div>`;

      case 'yesno':
        return `<div class="segmented" role="radiogroup">${['Sim', 'Não'].map((o) => `
          <label class="segmented__opt">
            <input type="radio" name="f-${id}" data-field="${id}" value="${o}"${v === o ? ' checked' : ''}>
            <span>${o}</span>
          </label>`).join('')}</div>`;

      case 'table':
        return this.tableHtml(f);

      case 'photos':
        return this.photosHtml(f);

      case 'geo':
        return this.geoHtml(f);

      case 'consolidation':
        return `
          <div class="consol" data-consol="${id}">
            <div class="consol__bar">
              <button type="button" class="btn btn--ghost btn--sm" data-action="consolidar" data-target="${id}">${icon('refresh', 15)} Atualizar consolidação</button>
              <span class="muted small" data-consol-meta>${this.consolMetaText(v)}</span>
            </div>
            <div class="consol__body" data-consol-body>${this.consolBodyHtml(v)}</div>
          </div>`;

      case 'computed':
        if (f.previewButton) {
          return `<button type="button" class="btn btn--ghost" id="f-${id}" data-action="preview-computed" data-target="${id}">${icon('eye', 16)} Visualizar Prévia do ${esc(f.label)}</button>`;
        }
        return `<output id="f-${id}" class="computed-value" data-computed-field="${id}">${esc(v) || '—'}</output>`;

      case 'signature':
        return `
          <div class="signature">
            <canvas class="signature__pad" data-signature="${id}" width="720" height="200" aria-label="Área de assinatura"></canvas>
            <div class="signature__bar">
              <span class="muted small">Assine com o mouse, caneta ou dedo — ou use a imagem da assinatura</span>
              <label class="btn btn--ghost btn--sm">
                <input type="file" accept="image/png,image/jpeg" class="sr-only" data-kind="signature-file" data-target="${id}">
                ${icon('image', 15)} Carregar imagem
              </label>
              <button type="button" class="btn btn--ghost btn--sm" data-action="clear-signature" data-target="${id}">${icon('eraser', 15)} Limpar assinatura</button>
            </div>
          </div>`;

      default: {
        const attrs = [
          `id="f-${id}"`, `data-field="${id}"`, `type="${INPUT_TYPES[f.type] || 'text'}"`,
          `value="${esc(v)}"`,
          f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
          f.min != null ? `min="${f.min}"` : '', f.max != null ? `max="${f.max}"` : '',
          f.step != null ? `step="${f.step}"` : '',
          f.type === 'number' ? 'inputmode="decimal"' : ''
        ].filter(Boolean).join(' ');
        if (f.autocomplete === 'pocos') {
          return `<div class="combo">
            <input ${attrs} data-combo="pocos" role="combobox" autocomplete="off" aria-autocomplete="list"
              aria-expanded="false" aria-controls="f-${id}-list">
            <div class="combo__list" id="f-${id}-list" role="listbox" aria-label="Poços da base oficial" hidden></div>
          </div>
          <small class="field__hint" data-pocos-hint>${this.pocosHintText()}</small>`;
        }
        if (f.flangeCampo) {
          return `<input ${attrs} list="dl-${id}" autocomplete="off"><datalist id="dl-${id}">${this.listaFlangeHtml(f)}</datalist>`;
        }
        const input = `<input ${attrs}>`;
        return f.unit ? `<div class="input-unit">${input}<span>${esc(f.unit)}</span></div>` : input;
      }
    }
  }

  tableHtml(f) {
    const data = this.draft.data;
    if (!Array.isArray(data[f.id]) || !data[f.id].length) data[f.id] = initialRows(f, data);
    const rows = data[f.id];
    const id = esc(f.id);
    const removable = (row) => !row._preset && (f.allowAdd !== false);
    return `
      <div class="table-wrap">
        <table class="grid-table">
          <thead><tr>
            ${f.columns.map((c) => `<th class="${c.width ? `col--${c.width}` : ''}${c.type === 'checkbox' ? ' col--center' : ''}">${esc(c.label)}</th>`).join('')}
            ${f.allowAdd !== false ? '<th class="col--action"><span class="sr-only">Ações</span></th>' : ''}
          </tr></thead>
          <tbody>${rows.map((row, i) => `
            <tr${row._preset ? ' class="row--preset"' : ''}>
              ${f.columns.map((c) => this.cellHtml(f, c, row, i)).join('')}
              ${f.allowAdd !== false ? `<td class="col--action">${removable(row)
                ? `<button type="button" class="icon-btn" data-action="remove-row" data-table="${id}" data-row="${i}" title="Remover linha" aria-label="Remover linha ${i + 1}">${icon('x', 16)}</button>`
                : ''}</td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${f.allowAdd !== false ? `<button type="button" class="btn btn--ghost btn--sm" data-action="add-row" data-table="${id}">${icon('plus', 16)} ${esc((f.addLabel || 'Adicionar linha').replace(/^\+\s*/, ''))}</button>` : ''}`;
  }

  // Coordenadas SOMENTE LEITURA: vêm do botão de GPS ou do cadastro do poço escolhido (sem digitação)
  geoHtml(f) {
    const v = this.draft.data[f.id] || {};
    const id = esc(f.id);
    const c = parseCoords(v);
    let meta = 'Sem coordenadas. Toque em "Obter Localização Atual" ou escolha o poço da base no campo Poço / Locação.';
    if (c && v.source === 'gps') {
      meta = `Capturado pelo GPS do aparelho em ${new Date(v.capturedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
        + (v.accuracy ? ` · precisão ±${v.accuracy} m` : '')
        + (v.accuracy > 100 ? ' — precisão baixa' : '');
    } else if (c && v.source === 'base') {
      meta = `Coordenadas do cadastro oficial de poços${v.poco ? ` (${v.poco})` : ''}.`;
    } else if (c) {
      meta = 'Coordenadas registradas numa versão anterior do app.';
    }
    return `
      <div class="geo">
        <div class="geo__readout">
          <span class="geo__badge geo__badge--${c ? 'ok' : 'empty'}" data-geo-badge="${id}">${icon(c ? 'mapPin' : 'crosshair', 16)} ${c ? 'Localização capturada' : 'Localização não capturada'}</span>
          <output class="sr-only" data-geo="${id}" data-part="lat">${c ? c.lat.toFixed(6) : ''}</output>
          <output class="sr-only" data-geo="${id}" data-part="lng">${c ? c.lng.toFixed(6) : ''}</output>
          <div class="geo__actions">
            <button type="button" class="btn btn--primary geo__btn" data-action="gps" data-target="${id}">${icon('crosshair', 17)} Obter Localização Atual</button>
            ${this.routeHtml()}
            ${c ? `<button type="button" class="btn btn--text btn--sm" data-action="clear-geo" data-target="${id}">${icon('x', 15)} Limpar</button>` : ''}
          </div>
        </div>
        <p class="geo__meta muted small">${esc(meta)}</p>
      </div>`;
  }

  /**
   * Destino da rota: o POÇO cadastrado na base (pelo nome no cabeçalho). Sem cadastro, usa as
   * coordenadas do relatório — avisando quando são a posição capturada pelo GPS.
   */
  routeTarget() {
    const d = this.draft.data;
    const geo = [...this.fields.values()].find((f) => f.type === 'geo');
    // vários poços no dia: a rota vai para o mais recente (último da lista) que estiver na base
    const poco = this.pocos && d.poco ? listaPocos(d.poco).reverse().map((n) => findPoco(this.pocos, n)).find(Boolean) || null : null;
    if (poco) return { lat: poco.lat, lng: poco.lng, nome: poco.nome, origem: 'cadastro' };
    const v = geo ? d[geo.id] : null;
    const c = parseCoords(v);
    if (!c) return null;
    return { ...c, nome: (v.source === 'base' && v.poco) || d.poco || '', origem: v.source === 'base' ? 'cadastro' : 'relatorio', gps: v.source === 'gps' };
  }

  /**
   * Botão compacto "Navegar até X" ao lado de "Obter Localização Atual": abre o mesmo aviso de navegação
   * (Google Maps / Waze) dos gatilhos — sem caixa de rota nem mapa ocupando o formulário.
   */
  routeHtml() {
    const t = this.routeTarget();
    if (!t) return '';
    const destino = t.nome ? t.nome : 'o ponto registrado';
    return `<button type="button" class="btn btn--ghost geo__route" data-action="navigate" data-route-target="${t.lat.toFixed(6)},${t.lng.toFixed(6)}"
      title="${esc(t.gps ? 'Poço não encontrado na base: o destino é a posição capturada pelo GPS do aparelho.' : `Abrir a navegação até ${destino}`)}">${icon('navigation', 17)} Navegar até ${esc(destino)}</button>`;
  }

  /** "Navegar até X": mostra o aviso com os botões do Google Maps e do Waze. */
  openNavigation() {
    const t = this.routeTarget();
    if (!t) return;
    showRoutePrompt({
      kind: 'navegar',
      title: 'Navegação até a locação',
      message: t.gps
        ? 'Poço não encontrado na base: a rota vai até a posição capturada pelo GPS do aparelho.'
        : `Abrir a navegação GPS até ${t.nome ? `a locação ${t.nome}` : 'o ponto registrado'}?`,
      target: t
    });
  }

  refreshGeo() {
    const geo = [...this.fields.values()].find((f) => f.type === 'geo');
    if (geo) this.refreshField(geo.id);
  }

  captureGps(id, btn) {
    if (!navigator.geolocation) return toast('Geolocalização não disponível neste dispositivo.', 'error');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Obtendo posição…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        this.draft.data[id] = {
          lat: latitude.toFixed(6), lng: longitude.toFixed(6),
          accuracy: Math.round(accuracy), source: 'gps', capturedAt: new Date().toISOString()
        };
        this.refreshField(id);
        this.changed(id);
        toast(`Coordenadas capturadas (precisão ±${Math.round(accuracy)} m).`, accuracy > 100 ? 'info' : 'success');
        this.addKmFromGps(latitude, longitude);
      },
      (err) => {
        this.refreshField(id);
        const msg = err.code === 1 ? 'Permissão de localização negada. Verifique Configurações do Windows › Privacidade › Localização.'
          : err.code === 3 ? 'O GPS não respondeu a tempo. Tente novamente em local aberto ou escolha o poço na base.'
          : 'Não foi possível obter a posição. Tente novamente ou escolha o poço na base.';
        toast(msg, 'error', 7000);
      },
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 }
    );
  }

  cellHtml(f, c, row, i) {
    const v = row[c.id];
    if (row._preset && c.locked) return `<td class="cell--locked">${esc(v)}</td>`;
    if (c.computed) return `<td class="cell--computed" data-computed="${esc(f.id)}:${i}:${esc(c.id)}">${esc(v) || '—'}</td>`;
    const common = `aria-label="${esc(c.label)} (linha ${i + 1})" data-table="${esc(f.id)}" data-row="${i}" data-col="${esc(c.id)}"`;
    switch (c.type) {
      case 'select':
        return `<td><select ${common}>
          <option value="">—</option>
          ${c.options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select></td>`;
      case 'checkbox':
        return `<td class="col--center"><input type="checkbox" class="cell-check" ${common}${v ? ' checked' : ''}></td>`;
      default: {
        // texto longo (coluna larga): no celular o toque abre o editor ampliado (o texto aparece inteiro)
        if (!c.type && c.width === 'wide') {
          return `<td><input type="text" ${common} value="${esc(v)}" data-expand
            ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''}></td>`;
        }
        return `<td><input type="${INPUT_TYPES[c.type] || 'text'}" ${common} value="${esc(v)}"
          ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''}${c.type === 'number' ? ' step="any" inputmode="decimal"' : ''}></td>`;
      }
    }
  }

  /** Editor ampliado de uma célula de texto (celular): grava a cada tecla e, ao concluir, age como "sair do campo". */
  async expandirCelula(input) {
    const { table, col } = input.dataset;
    const row = Number(input.dataset.row);
    const c = this.fields.get(table)?.columns.find((x) => x.id === col);
    if (!c) return;
    // a tabela pode ser redesenhada enquanto digita: sempre o campo atual da mesma célula
    const celula = () => $(`[data-table="${CSS.escape(table)}"][data-row="${row}"][data-col="${CSS.escape(col)}"]`, this.el);
    const enviar = (tipo, valor) => {
      const el = celula();
      if (!el) return;
      el.value = valor;
      el.dispatchEvent(new Event(tipo, { bubbles: true }));
    };
    const final = await abrirEditorTexto({
      titulo: c.label, subtitulo: `Linha ${row + 1}`, valor: input.value, placeholder: c.placeholder || '',
      onInput: (v) => enviar('input', v)
    });
    enviar('change', final);
  }

  photosHtml(f) {
    if (!f.compare) return `<div class="photo-cats">${this.photoSlotsHtml(f, undefined)}</div>`;
    // Relatório de Execução: "Antes" (fotos da Visita Técnica do poço) x "Depois" (fotos da execução)
    const d = this.draft.data;
    const antes = photosOf(f, this.draft.photos, 'antes');
    if (!antes.length) {
      // sem Visita de referência (ou a Visita não tem foto deste componente): só as fotos da execução
      return `
      <div class="photo-compare photo-compare--uma" data-layout="uma-coluna">
        <div class="photo-compare__col photo-compare__col--depois" data-fase="depois">
          <div class="photo-compare__title">${icon('camera', 15)} ${TITULO_EXECUCAO}</div>
          <div class="photo-cats">${this.photoSlotsHtml(f, 'depois')}</div>
        </div>
      </div>`;
    }
    return `
      <div class="photo-compare" data-layout="antes-depois">
        <div class="photo-compare__col photo-compare__col--antes" data-fase="antes">
          <div class="photo-compare__title">${icon('clock', 15)} Antes — Visita Técnica${d._visita_data ? ` de ${esc(d._visita_data)}` : ''}</div>
          <div class="photo-grid">${antes.map((p) => this.photoFigureHtml(p)).join('')}</div>
        </div>
        <div class="photo-compare__col photo-compare__col--depois" data-fase="depois">
          <div class="photo-compare__title">${icon('checkCircle', 15)} Depois — Execução</div>
          <div class="photo-cats">${this.photoSlotsHtml(f, 'depois')}</div>
        </div>
      </div>`;
  }

  // Uma "vaga" por legenda sugerida (ex.: Placa do poço), cada uma com Arquivo / Câmera
  photoSlotsHtml(f, fase) {
    const cats = f.categories?.length ? f.categories : [null];
    const catOf = (p) => (cats.includes(p.category ?? null) ? (p.category ?? null) : cats[cats.length - 1]);
    const list = photosOf(f, this.draft.photos, fase);
    const attrs = (cat) => `data-photos-field="${esc(f.id)}" data-category="${esc(cat ?? '')}" data-fase="${fase || ''}"`;
    return cats.map((cat) => {
      const items = list.filter((p) => catOf(p) === cat);
      return `
        <div class="photo-cat">
          ${cat ? `<div class="photo-cat__title">${esc(cat)} <span class="muted">(${items.length})</span></div>` : ''}
          <div class="photo-grid">
            ${items.map((p) => this.photoFigureHtml(p)).join('')}
            <div class="photo-add">
              <label class="photo-add__btn">
                <input type="file" accept="image/*" multiple class="sr-only" data-kind="photos" ${attrs(cat)}>
                ${icon('image', 16)} Arquivo
              </label>
              <button type="button" class="photo-add__btn" data-action="camera" ${attrs(cat)}>
                ${icon('camera', 16)} Câmera
              </button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  photoFigureHtml(p) {
    return `
      <figure class="photo">
        <img src="${this.photoUrl(p)}" alt="${esc(p.legenda || p.category || p.name)}">
        <input type="text" class="photo__caption" data-kind="photo-caption" data-photo="${esc(p.id)}" value="${esc(p.legenda || '')}"
          placeholder="${esc(p.category || 'Legenda da foto')}" aria-label="Legenda da foto ${esc(p.name)}" title="Legenda (vai para o PDF como Figura N)">
        <button type="button" class="icon-btn photo__remove" data-action="remove-photo" data-photo="${esc(p.id)}" title="Remover foto" aria-label="Remover ${esc(p.name)}">${icon('x', 14)}</button>
      </figure>`;
  }

  photoUrl(p) {
    if (!this.photoUrls.has(p.id)) this.photoUrls.set(p.id, URL.createObjectURL(p.blob));
    return this.photoUrls.get(p.id);
  }

  refreshField(id) {
    const wrap = $(`[data-wrap="${CSS.escape(id)}"]`, this.el);
    if (!wrap) return; // campo fora do formulário (seção legacy, ex.: coordenadas herdadas do BDO-e)
    wrap.innerHTML = this.fieldInnerHtml(this.fields.get(id));
    this.paintSignatures(wrap);
  }

  async addPhoto(fieldId, category, shot, fase) {
    const { name, type, blob } = await comprimirFoto(shot);
    this.draft.photos.push({ id: crypto.randomUUID(), ...photoMeta({ name, type, blob, category, field: fieldId, fase }) });
    this.refreshField(fieldId);
    this.changed(fieldId);
  }

  // ---------- Assinatura ----------

  paintSignatures(scope = this.el) {
    $$('canvas[data-signature]', scope).forEach((canvas) => {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const v = this.draft.data[canvas.dataset.signature];
      if (v) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = v;
      }
    });
  }

  /** Arquivo de imagem da assinatura (PNG/JPEG): centralizado no quadro, fundo branco, salvo como PNG. */
  loadSignatureImage(id, file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const s = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      this.draft.data[id] = canvas.toDataURL('image/png');
      if (!this.el.isConnected) return;
      this.refreshField(id);
      this.changed(id);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Não foi possível ler a imagem da assinatura.', 'error'); };
    img.src = url;
  }

  handlePointer(e) {
    const point = (canvas) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    };

    if (e.type === 'pointerdown') {
      const canvas = e.target.closest?.('canvas[data-signature]');
      if (!canvas) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const p = point(canvas);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      this.sig = { canvas, ctx, last: p };
      return;
    }
    if (!this.sig) return;
    if (e.type === 'pointermove') {
      const p = point(this.sig.canvas);
      const { ctx, last } = this.sig;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      this.sig.last = p;
    } else {
      const id = this.sig.canvas.dataset.signature;
      this.draft.data[id] = this.sig.canvas.toDataURL('image/png');
      this.sig = null;
      this.changed(id);
    }
  }

  // ---------- Eventos ----------

  handleInput(e) {
    const t = e.target;
    const data = this.draft.data;

    if (t.dataset.kind === 'photo-caption') {
      const photo = this.draft.photos.find((p) => p.id === t.dataset.photo);
      if (photo && photo.legenda !== t.value) { photo.legenda = t.value; this.changed(photo.field); }
      return;
    }

    if (t.dataset.kind === 'signature-file') {
      if (e.type !== 'change') return;
      const file = t.files?.[0];
      t.value = '';
      if (file?.type.startsWith('image/')) this.loadSignatureImage(t.dataset.target, file);
      return;
    }

    if (t.dataset.kind === 'photos') {
      if (e.type !== 'change') return;
      const files = [...t.files].filter(ehImagem); // HEIC do iPhone/Android pode vir sem tipo
      const { photosField, category, fase } = t.dataset;
      t.value = ''; // permite escolher o mesmo arquivo de novo
      Promise.all(files.map((file) => comprimirFoto({ name: file.name, type: file.type || 'image/heic', blob: file }))).then((fotos) => {
        for (const f of fotos) this.draft.photos.push({ id: crypto.randomUUID(), ...photoMeta({ ...f, category, field: photosField, fase }) });
        if (!this.el.isConnected) return;
        this.refreshField(photosField);
        this.changed(photosField);
      });
      return;
    }

    if (t.dataset.table) {
      const table = t.dataset.table;
      const rowIdx = Number(t.dataset.row);
      const row = data[table][rowIdx];
      const anterior = row[t.dataset.col];
      row[t.dataset.col] = t.type === 'checkbox' ? t.checked : t.value;
      this.propagateChain(table, rowIdx, t.dataset.col, anterior);
      for (const c of this.fields.get(table).columns.filter((col) => col.computed)) {
        row[c.id] = c.computed(row) || '';
        const cell = $(`[data-computed="${CSS.escape(`${table}:${rowIdx}:${c.id}`)}"]`, this.el);
        if (cell) cell.textContent = row[c.id] || '—';
      }
      const col = this.fields.get(table).columns.find((x) => x.id === t.dataset.col);
      // ao terminar de digitar (sair do campo): evita reagir a "FBM-18" no meio de "FBM-182"
      if (col?.routeTrigger && e.type === 'change') this.checkTravel(row, t.value);
      return this.changed(table);
    }

    const id = t.dataset.field;
    if (!id) return;
    if (t.dataset.combo) {
      if (e.type === 'input') this.openCombo(t);
      else if (e.type === 'change') this.acceptExactWell(t);
    }
    if (t.dataset.kind === 'checklist') {
      data[id] = $$(`[data-field="${CSS.escape(id)}"]:checked`, this.el).map((c) => c.value);
    } else if (t.type === 'radio') {
      if (t.checked) data[id] = t.value;
    } else {
      data[id] = t.value;
    }
    const campoFlange = this.fields.get(id);
    if (campoFlange?.flangeCampo) this.atualizarFlange(campoFlange.flange);
    this.changed(id);
  }

  async handleClick(e) {
    if (e.target.matches?.('input[data-expand]') && usarEditorAmpliado()) return this.expandirCelula(e.target);
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, table } = btn.dataset;

    if (action === 'flange-opcao' || action === 'flange-limpar') {
      const p = btn.dataset.target;
      if (action === 'flange-opcao') escolherLinha(this.draft.data, p, Number(btn.dataset.linha));
      else limparCampo(this.draft.data, p, btn.dataset.campo);
      this.atualizarFlange(p);
      this.changed(`${p}_modelo`);
      return;
    }

    if (action === 'add-row') {
      const rows = this.draft.data[table];
      rows.push(chainedRow(this.fields.get(table), this.draft.data, rows[rows.length - 1]));
      this.refreshField(table);
      const inputs = $$(`[data-table="${CSS.escape(table)}"][data-row="${this.draft.data[table].length - 1}"]`, this.el);
      inputs[0]?.focus();
      this.changed(table);
    } else if (action === 'remove-row') {
      const rows = this.draft.data[table];
      rows.splice(Number(btn.dataset.row), 1);
      if (!rows.length) this.draft.data[table] = initialRows(this.fields.get(table), this.draft.data);
      this.refreshField(table);
      this.changed(table);
    } else if (action === 'remove-photo') {
      const pid = btn.dataset.photo;
      const url = this.photoUrls.get(pid);
      if (url) URL.revokeObjectURL(url);
      this.photoUrls.delete(pid);
      const removed = this.draft.photos.find((p) => p.id === pid);
      this.draft.photos = this.draft.photos.filter((p) => p.id !== pid);
      if (removed) {
        this.refreshField(removed.field);
        this.changed(removed.field);
      }
    } else if (action === 'camera') {
      const { photosField, category, fase } = btn.dataset;
      try {
        const shot = await openCamera(category || 'Foto');
        if (shot) this.addPhoto(photosField, category, shot, fase);
      } catch (err) {
        toast(err.message, 'error', 6000);
      }
    } else if (action === 'toggle-lock') {
      const f = this.fields.get(btn.dataset.target);
      const input = $(`[data-field="${CSS.escape(f.id)}"]`, this.el);
      const editing = input.readOnly;
      input.readOnly = !editing;
      input.classList.toggle('is-locked', !editing);
      btn.setAttribute('aria-pressed', String(editing));
      btn.innerHTML = editing ? `${icon('check', 15)} <span>Concluir edição</span>` : `${icon('pen', 15)} <span>${esc(f.lockEdit)}</span>`;
      if (editing) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    } else if (action === 'regen-text') {
      const f = this.fields.get(btn.dataset.target);
      this.draft.data[f.id] = f.autoText(this.draft.data) || '';
      const input = $(`[data-field="${CSS.escape(f.id)}"]`, this.el);
      if (input) input.value = this.draft.data[f.id];
      this.changed(f.id);
      toast(`Resumo gerado de novo a partir d${f.autoTextFonte ? 'os serviços dos componentes' : 'a apropriação'}.`, 'info', 3000);
    } else if (action === 'navigate') {
      this.openNavigation();
    } else if (action === 'clear-geo') {
      this.draft.data[btn.dataset.target] = {};
      this.refreshField(btn.dataset.target);
      this.changed(btn.dataset.target);
    } else if (action === 'preview-computed') {
      const f = this.fields.get(btn.dataset.target);
      this.updateComputed();
      infoDialog({
        title: `Prévia do ${f.label.toLowerCase()}`,
        message: this.draft.data[f.id] || 'Preencha o Poço / Locação e a data para montar o texto.',
        note: 'Este texto é gerado automaticamente a partir do cabeçalho e aparece só na prévia e no PDF.'
      });
    } else if (action === 'consolidar') {
      this.runConsolidation({ manual: true });
    } else if (action === 'gps') {
      this.captureGps(btn.dataset.target, btn);
    } else if (action === 'clear-signature') {
      const id = btn.dataset.target;
      this.draft.data[id] = '';
      this.refreshField(id);
      this.changed(id);
    }
  }

  // ---------- Autocompletar de poços ----------

  pocosHintText() {
    if (!this.pocos) return 'Carregando base de poços…';
    if (!this.pocos.total) return 'Nenhuma base de poços carregada. Digite o nome livremente ou <button type="button" class="link-btn" data-goto="settings">importe a base em Configurações</button>.';
    const origem = this.pocos.origem === 'importada' ? 'Base importada' : 'Base padrão';
    return `${origem}: ${this.pocos.total.toLocaleString('pt-BR')} poços. Escolha na lista para preencher as coordenadas.`;
  }

  updatePocosHint() {
    $$('[data-pocos-hint]', this.el).forEach((h) => { h.innerHTML = this.pocosHintText(); }); // texto fixo do app (sem dados do usuário)
  }

  openCombo(input) {
    const list = input.closest('.combo').querySelector('.combo__list');
    const query = (input.value.split(/[,;]/).at(-1) || '').trim(); // vários poços: busca o que está sendo digitado
    this.comboItems = query.length >= 2 ? searchPocos(this.pocos, query) : [];
    this.comboActive = -1;
    if (!this.comboItems.length) {
      const showEmpty = query.length >= 2 && this.pocos?.total;
      list.innerHTML = showEmpty ? '<div class="combo__empty">Nenhum poço da base com esse nome. Você pode digitar livremente.</div>' : '';
      list.hidden = !showEmpty;
      input.setAttribute('aria-expanded', String(Boolean(showEmpty)));
      return;
    }
    const q = query.toUpperCase();
    list.innerHTML = this.comboItems.map((p, i) => {
      const at = p.nome.indexOf(q);
      const name = at >= 0
        ? `${esc(p.nome.slice(0, at))}<mark>${esc(p.nome.slice(at, at + q.length))}</mark>${esc(p.nome.slice(at + q.length))}`
        : esc(p.nome);
      return `<div class="combo__opt" role="option" id="${input.id}-opt-${i}" data-index="${i}" aria-selected="false">
        <span class="combo__name">${icon('mapPin', 14)}<span>${name}</span></span>
        <span class="combo__coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>
      </div>`;
    }).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  closeCombo(input) {
    const list = input.closest('.combo')?.querySelector('.combo__list');
    if (list) { list.hidden = true; list.innerHTML = ''; }
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    this.comboItems = [];
  }

  handleComboKey(e) {
    const input = e.target;
    if (!input.dataset?.combo) return;
    const items = this.comboItems || [];
    if (e.key === 'Escape') return this.closeCombo(input);
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      this.comboActive = (this.comboActive + delta + items.length) % items.length;
      const opts = $$('.combo__opt', input.closest('.combo'));
      opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === this.comboActive)));
      input.setAttribute('aria-activedescendant', opts[this.comboActive].id);
      opts[this.comboActive].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && this.comboActive >= 0) {
      e.preventDefault();
      this.pickWell(input, items[this.comboActive]);
    }
  }

  async pickWell(input, poco) {
    if (!poco) return;
    // vários poços ("FBM-89, FBM-1"): troca só o trecho que está sendo digitado
    const anteriores = listaPocos(input.value.split(/[,;]/).slice(0, -1).join(','));
    input.value = [...anteriores, poco.nome].join(', ');
    this.draft.data[input.dataset.field] = input.value;
    this.closeCombo(input);
    this.changed(input.dataset.field);
    await this.applyWellCoords(poco);
    this.offerRoute(poco);
    this.estimateKm(poco);
  }

  // Digitou o nome exato de um poço da base sem escolher na lista: coordenadas (se vazias) + convite à rota
  async acceptExactWell(input) {
    const poco = findPoco(this.pocos, listaPocos(input.value).at(-1));
    const geo = [...this.fields.values()].find((f) => f.type === 'geo');
    if (!poco || !geo) return;
    if (!parseCoords(this.draft.data[geo.id])) await this.applyWellCoords(poco);
    this.offerRoute(poco);
    this.estimateKm(poco);
  }

  /** Gatilho 1: poço identificado no cabeçalho → convite discreto para navegar até a locação. */
  offerRoute(poco) {
    this.routeOffered ||= new Set();
    if (this.routeOffered.has(poco.nome)) return; // uma vez por poço nesta tela
    this.routeOffered.add(poco.nome);
    showRoutePrompt({
      kind: 'poco',
      title: 'Navegação até a locação',
      message: `Deseja iniciar a navegação GPS para a locação ${poco.nome}?`,
      target: { lat: poco.lat, lng: poco.lng, nome: poco.nome }
    });
  }

  /**
   * Gatilho 2: deslocamento / mobilização na apropriação do BDO ("Deslocando para Catu",
   * "Iniciando deslocamento para o poço FBM-182"). Com destino reconhecido (poço da base, cidade ou
   * base cadastrada): atualiza o cabeçalho, soma o trecho ao KM rodado e oferece a rota.
   * Cada linha guarda o que já foi feito (row._desloc): editar o destino troca o KM somado, não duplica.
   */
  async checkTravel(row, text) {
    if (!isTravel(text)) return;
    const dest = resolverDestino(text, { pocos: this.pocos, findPoco });
    const key = !dest ? 'sem-destino' : dest.tipo ? `${dest.tipo}:${dest.nome}` : `?:${dest.texto}`;
    if (row._desloc?.key === key) return; // esta linha já foi tratada com este destino
    const anterior = row._desloc;
    row._desloc = { key, km: 0 };
    const d = this.draft.data;

    if (!dest?.tipo) {
      if (anterior?.km) this.ajustarKm(-anterior.km);
      const target = this.routeTarget();
      const naoAchou = dest ? `Deslocamento identificado para "${dest.texto}", mas esse destino não está na base de poços nem nas cidades / bases (cadastre em Configurações › Bases e locais personalizados). ` : '';
      return showRoutePrompt(target
        ? {
          kind: 'deslocamento', title: 'Deslocamento identificado', target,
          message: naoAchou
            ? `${naoAchou}Abrir a rota até ${target.nome ? `o poço ${target.nome}` : 'o ponto registrado'}?`
            : `Identificamos um deslocamento. Deseja abrir a rota no Google Maps/Waze para ${target.nome ? `o poço ${target.nome}` : 'o ponto registrado'}?`
        }
        : {
          kind: 'deslocamento', title: 'Deslocamento identificado',
          message: naoAchou || 'Informe o Poço / Locação no cabeçalho (ou capture o GPS) para abrir a rota até a locação.'
        });
    }

    // ponto de partida do trecho: última posição conhecida (destino anterior / GPS) ou a locação do cabeçalho
    const geo = [...this.fields.values()].find((f) => f.type === 'geo');
    const origem = d._km?.ultimo || (geo && parseCoords(d[geo.id])) || null;

    // 1) cabeçalho: poço → Poço / Locação (+ coordenadas); cidade / base → Cidade / Estado
    // 1a) poço novo no dia: entra no FIM da lista do Poço / Locação ("FBM-89, FBM-12"), sem apagar os anteriores
    const novoPoco = dest.tipo === 'poco' && this.fields.has('poco') ? incluirPoco(d.poco, dest.nome) : null;
    if (novoPoco !== null && novoPoco !== String(d.poco || '').trim()) {
      const antes = String(d.poco || '').trim();
      this.setFieldValue('poco', novoPoco);
      d._km = { ...d._km, poco: dest.nome }; // não reestimar o KM ao sair do campo Poço
      const poco = findPoco(this.pocos, dest.nome);
      if (poco) await this.applyWellCoords(poco);
      toast(antes ? `Poço ${dest.nome} incluído no Poço / Locação: ${novoPoco}.` : `Cabeçalho atualizado: Poço / Locação = ${dest.nome}.`, 'info', 5000);
    } else if (dest.tipo === 'cidade' && this.fields.has('cidade_uf')) {
      const valor = dest.uf ? `${dest.nome} - ${dest.uf}` : dest.nome;
      if (d.cidade_uf !== valor) {
        this.setFieldValue('cidade_uf', valor);
        toast(`Cabeçalho atualizado: Cidade / Estado = ${valor}.`, 'info', 4000);
      }
    }

    // 2) KM rodado: soma o trecho até o destino (troca o que esta linha já tinha somado)
    if (this.kmField()) {
      let de = origem;
      if (!de) { try { de = await posicaoAtual(); } catch { de = null; } }
      const trecho = de ? kmEstrada(de, dest) : 0;
      row._desloc.km = trecho >= 0.1 ? trecho : 0;
      const delta = row._desloc.km - (anterior?.km || 0);
      if (delta) this.ajustarKm(delta);
      d._km = { ...d._km, ultimo: { lat: dest.lat, lng: dest.lng } };
      if (row._desloc.km) toast(`+${row._desloc.km.toLocaleString('pt-BR')} km até ${dest.nome} somados ao KM rodado.`, 'info', 4000);
      this.onChange(this.draft);
    }

    // 3) rota até o destino
    showRoutePrompt({
      kind: 'deslocamento', title: 'Deslocamento identificado',
      message: `Deslocamento identificado para ${dest.nome}. Deseja abrir a rota no GPS?`,
      target: { lat: dest.lat, lng: dest.lng, nome: dest.nome }
    });
  }

  /** Soma (ou subtrai) km ao KM rodado total. */
  ajustarKm(delta) {
    const f = this.kmField();
    if (!f) return;
    const atual = parseFloat(String(this.draft.data[f.id] ?? '').replace(',', '.')) || 0;
    this.setKm(Math.max(0, atual + delta));
  }

  /** Altera um campo simples por código (valor + tela + salvamento). */
  setFieldValue(id, value) {
    this.draft.data[id] = value;
    const input = $(`[data-field="${CSS.escape(id)}"]`, this.el);
    if (input) input.value = value;
    this.changed(id);
  }

  async applyWellCoords(poco) {
    const geo = [...this.fields.values()].find((f) => f.type === 'geo');
    if (!geo) return;
    const cur = this.draft.data[geo.id];
    const curCoords = parseCoords(cur);
    const same = curCoords && Math.abs(curCoords.lat - poco.lat) < 1e-6 && Math.abs(curCoords.lng - poco.lng) < 1e-6;
    if (same) return;
    if (curCoords && cur.source !== 'base') {
      const ok = await confirmDialog({
        title: 'Substituir as coordenadas atuais?',
        message: `Este relatório já tem coordenadas ${cur.source === 'gps' ? 'obtidas pelo GPS' : 'registradas anteriormente'} (${curCoords.lat.toFixed(5)}, ${curCoords.lng.toFixed(5)}). Usar as do cadastro do poço ${poco.nome} (${poco.lat.toFixed(5)}, ${poco.lng.toFixed(5)})?`,
        confirmLabel: 'Usar coordenadas do cadastro', cancelLabel: 'Manter as atuais', iconName: 'mapPin'
      });
      if (!ok) return;
    }
    this.draft.data[geo.id] = {
      lat: poco.lat.toFixed(6), lng: poco.lng.toFixed(6),
      source: 'base', poco: poco.nome, accuracy: null, capturedAt: null
    };
    this.refreshField(geo.id);
    this.changed(geo.id);
    toast(`Coordenadas do poço ${poco.nome} preenchidas pelo cadastro oficial.`, 'success', 3500);
  }

  // ---------- Consolidação da quinzena (Relatório de Execução) ----------

  consolField() {
    return [...this.fields.values()].find((f) => f.type === 'consolidation');
  }

  consolMetaText(v) {
    if (!v) return 'Informe o Poço/Locação e o período: a consolidação é feita automaticamente.';
    const when = new Date(v.geradoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    return `Consolidado em ${when} a partir dos relatórios finalizados neste computador.`;
  }

  consolBodyHtml(v) {
    if (!v) return '';
    if (!hasConsolidation(v)) {
      return `<div class="notice notice--info">Nenhum BDO ou Visita Técnica finalizados para <strong>${esc(v.poco)}</strong> neste período. Os blocos ficam fora do PDF.</div>`;
    }
    return consolidationHtml(v);
  }

  scheduleConsolidation() {
    clearTimeout(this.consolTimer);
    this.consolTimer = setTimeout(() => this.runConsolidation({ manual: false }), 350);
  }

  async runConsolidation({ manual }) {
    const f = this.consolField();
    if (!f) return;
    const d = this.draft.data;
    const poco = String(d.poco || '').trim();
    const inicio = d.periodo_inicio;
    const fim = d.periodo_fim;
    if (!poco || !inicio || !fim) {
      if (manual) toast('Informe o Poço/Locação e o início e o fim da quinzena para consolidar.', 'warn');
      return;
    }
    if (inicio > fim) {
      if (manual) toast('O início da quinzena está depois do fim.', 'error');
      return;
    }
    const result = await consolidateFromHistory({ poco, inicio, fim });
    if (!this.el.isConnected) return; // usuário saiu da tela enquanto calculava
    d[f.id] = result;
    this.refreshField(f.id);
    // "Antes" escolhido pelo técnico (relatório importado em JSON) fica; senão, a última Visita do poço
    if (!this.draft.data._antes_fixo) await this.importBefore(result.visita);
    this.changed(f.id);
    if (manual) {
      toast(hasConsolidation(result)
        ? `Consolidação atualizada: ${result.bdos} BDO(s)${result.visita ? ' e a última Visita Técnica' : ''}.`
        : 'Nenhum relatório finalizado para este poço no período.', hasConsolidation(result) ? 'success' : 'info');
    }
  }

  /**
   * Execução: copia as fotos da Visita Técnica (consolidada) para a coluna "Antes" de cada componente.
   * Refaz só quando a Visita de referência muda (ou as fotos "Antes" foram todas apagadas).
   */
  /**
   * Linha "Na Visita" (campos visitaNota) de cada componente, da Visita de referência (module.notasDaVisita).
   * Refeita só quando a Visita muda (data._visita_notas); sem Visita, as linhas somem.
   */
  async aplicarNotasVisita(ref) {
    const campos = [...this.fields.values()].filter((f) => f.type === 'visitaNota');
    const d = this.draft.data;
    if (!campos.length || (d._visita_notas || null) === ref) return;
    const rec = ref ? await get(STORES.history, ref) : null;
    const notas = rec && this.module.notasDaVisita ? this.module.notasDaVisita(rec.data || {}) : {};
    if (!this.el.isConnected) return;
    for (const f of campos) {
      d[f.id] = notas[f.comp] || '';
      this.refreshField(f.id);
      const wrap = $(`[data-wrap="${CSS.escape(f.id)}"]`, this.el);
      if (wrap) wrap.hidden = !d[f.id];
    }
    d._visita_notas = ref;
    this.onChange(this.draft);
  }

  async importBefore(visita) {
    const fields = photoFields(this.module).filter((f) => f.compare);
    if (!fields.length) return;
    const d = this.draft.data;
    const ref = visita?.uniqueId || null;
    await this.aplicarNotasVisita(ref);
    const temAntes = this.draft.photos.some((p) => p.fase === 'antes');
    if (ref === (d._visita_ref || null) && (temAntes || !ref || d._visita_fotos === 0)) return;
    let novas = [];
    if (ref) {
      const rec = await get(STORES.history, ref);
      const fotos = assignPhotoFields(getModule('visita_tecnica'), (rec?.photos || []).map((p) => ({ ...p })));
      const ids = new Set(fields.map((f) => f.id));
      novas = fotos.map((p) => ({ id: crypto.randomUUID(), ...photoMeta({ ...p, field: ids.has(p.field) ? p.field : 'fotos', fase: 'antes', origem: ref }) }));
    }
    if (!this.el.isConnected) return;
    for (const p of this.draft.photos.filter((x) => x.fase === 'antes')) {
      const url = this.photoUrls.get(p.id);
      if (url) URL.revokeObjectURL(url);
      this.photoUrls.delete(p.id);
    }
    this.draft.photos = [...this.draft.photos.filter((p) => p.fase !== 'antes'), ...novas];
    d._visita_ref = ref;
    d._visita_data = visita?.data || '';
    d._visita_fotos = novas.length;
    fields.forEach((f) => this.refreshField(f.id));
  }

  /**
   * Linhas automáticas (module.autoRows: { table, col, label, defaults, rows(data) }), ex.: Quadro de Ações
   * da Visita a partir da inspeção. Enquanto o diagnóstico não muda, o que o técnico ajustou na linha
   * (detalhe, prioridade…) é mantido; mudou o diagnóstico, a linha é refeita (_sig).
   */
  syncAutoRows(skipTable) {
    const lista = [this.module.autoRows].flat().filter(Boolean); // um quadro ou vários
    for (const cfg of lista) if (cfg.table !== skipTable) this.syncAutoRowsDe(cfg);
  }

  syncAutoRowsDe(cfg) {
    const d = this.draft.data;
    const rows = Array.isArray(d[cfg.table]) ? d[cfg.table] : [];
    const atuais = new Map(rows.filter((r) => r._auto).map((r) => [r._auto, r]));
    const novas = cfg.rows(d).map((x) => {
      const sig = JSON.stringify(x);
      const atual = atuais.get(x._auto);
      return atual?._sig === sig ? atual : { ...cfg.defaults, ...atual, ...x, _sig: sig };
    });
    const assinatura = (lista) => JSON.stringify(lista.map((r) => [r._auto, r._sig]));
    if (assinatura([...atuais.values()]) === assinatura(novas)) return;
    // descartarVazias: com linhas automáticas, a linha em branco do quadro (nenhum campo preenchido) sai
    const tf = this.fields.get(cfg.table);
    const emBranco = (r) => (tf?.columns || []).filter((c) => !c.aux && !c.computed).every((c) => isBlank(r[c.id]));
    const manuais = rows.filter((r) => !r._auto && !(cfg.descartarVazias && novas.length && emBranco(r)));
    const juntas = [...manuais, ...novas];
    d[cfg.table] = cfg.ordenar ? juntas.sort(cfg.ordenar) : juntas;
    this.refreshField(cfg.table);
    const adicionadas = novas.filter((r) => !atuais.has(r._auto));
    if (adicionadas.length && cfg.aviso !== false) toast(`Adicionado ${cfg.label === 'Pendências' ? 'às Pendências' : `ao ${cfg.label}`}: ${adicionadas.map((r) => r[cfg.col]).join('; ')}`, 'info', 5000);
  }

  /** Tabela com chain: ao preencher o fim de uma linha, a próxima começa nesse horário (se estava vazia). */
  propagateChain(table, rowIdx, col, anterior) {
    const f = this.fields.get(table);
    const rows = this.draft.data[table];
    const next = rows[rowIdx + 1];
    if (!f.chain || !next) return;
    for (const [from, to] of f.chain) {
      if (from !== col || (next[to] && next[to] !== anterior)) continue;
      next[to] = rows[rowIdx][from];
      const input = $(`[data-table="${CSS.escape(table)}"][data-row="${rowIdx + 1}"][data-col="${CSS.escape(to)}"]`, this.el);
      if (input) input.value = next[to] || '';
      for (const c of f.columns.filter((x) => x.computed)) {
        next[c.id] = c.computed(next) || '';
        const cell = $(`[data-computed="${CSS.escape(`${table}:${rowIdx + 1}:${c.id}`)}"]`, this.el);
        if (cell) cell.textContent = next[c.id] || '—';
      }
    }
  }

  // ---------- KM rodado (campo kmAuto) ----------

  kmField() {
    return [...this.fields.values()].find((f) => f.kmAuto);
  }

  setKm(valor) {
    const f = this.kmField();
    this.draft.data[f.id] = String(Math.round(valor * 10) / 10);
    const input = $(`[data-field="${CSS.escape(f.id)}"]`, this.el);
    if (input) input.value = this.draft.data[f.id];
    this.changed(f.id);
  }

  /** Poço escolhido: estima o KM até a locação a partir da posição atual do aparelho (se o KM estiver vazio). */
  async estimateKm(poco) {
    const f = this.kmField();
    if (!f || !poco) return;
    const d = this.draft.data;
    if (d._km?.poco === poco.nome) return; // já estimado para este poço (ex.: escolheu na lista e saiu do campo)
    d._km = { ...d._km, poco: poco.nome };
    let pos;
    try { pos = await posicaoAtual(); } catch { return; } // sem GPS / permissão: o técnico informa à mão
    if (!this.el.isConnected) return;
    d._km = { poco: poco.nome, ultimo: { lat: pos.lat, lng: pos.lng } };
    if (String(d[f.id] ?? '').trim()) return;
    const km = kmEstrada(pos, poco);
    this.setKm(km);
    toast(`KM estimado até ${poco.nome}: ${km.toLocaleString('pt-BR')} km (distância em linha reta × 1,3). Confira e corrija se preciso.`, 'info', 6000);
  }

  /** Nova captura de GPS: soma o trecho desde a última posição registrada. */
  addKmFromGps(lat, lng) {
    const f = this.kmField();
    if (!f) return;
    const d = this.draft.data;
    const ultimo = d._km?.ultimo;
    d._km = { ...d._km, ultimo: { lat, lng } };
    if (!ultimo) return;
    const trecho = kmEstrada(ultimo, { lat, lng });
    if (trecho < 0.1) return; // mesma posição (ruído do GPS)
    const atual = parseFloat(String(d[f.id] ?? '').replace(',', '.')) || 0;
    this.setKm(atual + trecho);
    toast(`+${trecho.toLocaleString('pt-BR')} km somados ao KM rodado.`, 'info', 3500);
  }

  // ---------- Textos gerados (textarea.autoText, ex.: Resumo das Atividades do BDO-e) ----------

  /** Técnico alterou o texto gerado? (deixa de ser atualizado sozinho) */
  autoTextManual(f) {
    const d = this.draft.data;
    return !isBlank(d[f.id]) && d[f.id] !== d._autoTexto?.[f.id];
  }

  autoTextStatus(f) {
    if (this.autoTextManual(f)) return 'Editado manualmente: não é mais atualizado sozinho.';
    const fonte = f.autoTextFonte || 'a apropriação';
    return this.draft.data[f.id] ? `Atualizado automaticamente com ${fonte}.` : `Será montado automaticamente ao preencher ${fonte}.`;
  }

  /**
   * Refaz os textos gerados. Só substitui o que ainda é a versão gerada anterior (ou vazio);
   * texto editado pelo técnico fica como está. `skip`: campo que o técnico está editando agora.
   */
  updateAutoTexts(skip) {
    const d = this.draft.data;
    for (const f of this.fields.values()) {
      if (!f.autoText) continue;
      const gerado = f.autoText(d) || '';
      const sincronizado = isBlank(d[f.id]) || d[f.id] === d._autoTexto?.[f.id];
      d._autoTexto = { ...d._autoTexto, [f.id]: gerado };
      if (f.id !== skip && sincronizado && d[f.id] !== gerado) {
        d[f.id] = gerado;
        const input = this.el && $(`[data-field="${CSS.escape(f.id)}"]`, this.el);
        if (input) input.value = gerado;
      }
      if (!this.el) continue;
      const st = $(`[data-autotext-status="${CSS.escape(f.id)}"]`, this.el);
      if (st) st.textContent = this.autoTextStatus(f);
      const regen = $(`[data-action=regen-text][data-target="${CSS.escape(f.id)}"]`, this.el);
      if (regen) regen.hidden = !this.autoTextManual(f);
    }
  }

  changed(fieldId) {
    this.updateAutoTexts(fieldId);
    this.syncAutoRows(fieldId);
    if (['poco', 'periodo_inicio', 'periodo_fim'].includes(fieldId) && this.consolField()) this.scheduleConsolidation();
    if (this.module.execucaoDoBdo && (fieldId === 'poco' || fieldId === this.module.execucaoDoBdo.campoData)) this.scheduleExecucaoBdo();
    if (fieldId === 'poco') { clearTimeout(this.routeRefreshTimer); this.routeRefreshTimer = setTimeout(() => this.refreshGeo(), 300); }
    this.clearError(fieldId);
    this.updateComputed();
    this.updateSectionBadges();
    this.onChange(this.draft);
  }

  // ---------- Erros ----------

  showErrors(errors) {
    $$('.field.has-error', this.el).forEach((w) => this.clearError(w.dataset.wrap));
    for (const err of errors) {
      const wrap = $(`[data-wrap="${CSS.escape(err.field)}"]`, this.el);
      if (!wrap) continue;
      wrap.classList.add('has-error');
      $('.field__error', wrap).textContent = err.message;
    }
    const first = errors[0] && $(`[data-wrap="${CSS.escape(errors[0].field)}"]`, this.el);
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('input, select, textarea', first)?.focus({ preventScroll: true });
    }
  }

  clearError(fieldId) {
    const wrap = $(`[data-wrap="${CSS.escape(fieldId)}"]`, this.el);
    if (!wrap?.classList.contains('has-error')) return;
    wrap.classList.remove('has-error');
    $('.field__error', wrap).textContent = '';
  }
}
