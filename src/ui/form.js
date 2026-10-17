// Renderiza um formulário a partir da definição declarativa do módulo e mantém
// draft.data / draft.photos como fonte única da verdade.

import { esc, $, $$ } from './dom.js';
import { openCamera } from './camera.js';
import { toast } from './toast.js';
import { getSettings } from '../core/settings.js';
import { icon } from './icons.js';
import { confirmDialog } from './confirm.js';
import { loadPocos, searchPocos, findPoco } from '../core/pocos.js';
import { consolidateFromHistory, hasConsolidation } from '../core/consolidar.js';
import { consolidationHtml } from './consolidacao-view.js';

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

export function mapLinks({ lat, lng }) {
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
  };
}

const geoBlank = (v) => isBlank(v?.lat) && isBlank(v?.lng);

/** O campo tem algo a exibir? (tabelas: ao menos uma linha preenchida) */
export function hasContent(f, data, photos = []) {
  switch (f.type) {
    case 'table': return filledRows(data[f.id], f.columns).length > 0;
    case 'geo': return Boolean(parseCoords(data[f.id]));
    case 'photos': return photos.length > 0;
    case 'consolidation': return hasConsolidation(data[f.id]);
    default: return !isBlank(data[f.id]);
  }
}

/** Seções sem nenhum campo obrigatório e sem nenhum dado (não entram no PDF). */
export function emptyOptionalSections(module, data, photos = []) {
  return module.sections
    .filter((s) => !s.fields.some((f) => f.required) && !s.fields.some((f) => hasContent(f, data, photos)))
    .map((s) => s.short || s.title);
}

/** Valor legível para prévia / listagens. */
export function displayValue(field, value) {
  if (field.type === 'geo') {
    const c = parseCoords(value);
    if (!c) return '';
    const origin = value.source === 'gps' ? `GPS${value.accuracy ? `, ±${value.accuracy} m` : ''}`
      : value.source === 'base' ? 'cadastro de poços' : 'manual';
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
    return { index, title: s.title, short: s.short || s.title, icon: s.icon, required: required.length, missing, state };
  });
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
      if (!geoBlank(v) && !parseCoords(v)) errors.push({ field: f.id, label: f.label, message: 'Coordenadas inválidas (latitude -90 a 90, longitude -180 a 180)' });
      else if (f.required && geoBlank(v)) errors.push({ field: f.id, label: f.label, message: 'Campo obrigatório' });
      continue;
    }
    if (!f.required) continue;
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
    this.fields = new Map(allFields(module).filter((f) => f.id).map((f) => [f.id, f]));
    this.sig = null;

    // Também em rascunhos antigos: preenche só campos que nunca existiram neles (undefined);
    // o que o técnico apagou fica '' e não é tocado (applyDefaults usa ??=).
    this.applyDefaults();

    this.el = document.createElement('form');
    this.el.className = 'report-form';
    this.el.noValidate = true;
    this.el.innerHTML = module.sections.map((s, i) => this.sectionHtml(s, i)).join('');
    this.el.addEventListener('input', (e) => this.handleInput(e));
    this.el.addEventListener('change', (e) => this.handleInput(e));
    this.el.addEventListener('click', (e) => this.handleClick(e));
    this.el.addEventListener('submit', (e) => e.preventDefault());
    this.el.addEventListener('keydown', (e) => this.handleComboKey(e));
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
      loadPocos().then((base) => { this.pocos = base; this.updatePocosHint(); });
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

  destroy() {
    this.photoUrls.forEach((url) => URL.revokeObjectURL(url));
    this.photoUrls.clear();
  }

  applyDefaults() {
    const now = localIso();
    const settings = getSettings();
    for (const f of this.fields.values()) {
      if (f.settingsKey && settings[f.settingsKey]) this.draft.data[f.id] ??= settings[f.settingsKey];
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
        <div class="form-grid">${section.fields.map((f) => this.fieldHtml(f)).join('')}</div>
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
    return `<div class="${cls}" data-wrap="${esc(f.id)}">${this.fieldInnerHtml(f)}</div>`;
  }

  fieldInnerHtml(f) {
    const label = f.label
      ? `<span class="field__label">${esc(f.label)}${f.required ? '<span class="req" aria-hidden="true">*</span>' : ''}</span>`
      : '';
    const hint = f.hint ? `<small class="field__hint">${esc(f.hint)}</small>` : '';
    const error = '<small class="field__error" aria-live="polite"></small>';
    const grouped = ['checklist', 'yesno', 'table', 'photos', 'signature', 'geo', 'consolidation'].includes(f.type);
    const control = this.controlHtml(f);
    return grouped
      ? `<fieldset class="field__group">${label ? `<legend${f.hideLabel ? ' class="sr-only"' : ''}>${label}</legend>` : `<legend class="sr-only">${esc(f.id)}</legend>`}${control}${hint}${error}</fieldset>`
      : `<label class="field__label-wrap" for="f-${esc(f.id)}">${label}</label>${control}${hint}${error}`;
  }

  controlHtml(f) {
    const v = this.draft.data[f.id];
    const id = esc(f.id);
    switch (f.type) {
      case 'select':
        return `<select id="f-${id}" data-field="${id}">
          <option value="">Selecione…</option>
          ${f.options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select>`;

      case 'textarea':
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
        return `<output id="f-${id}" class="computed-value" data-computed-field="${id}">${esc(v) || '—'}</output>`;

      case 'signature':
        return `
          <div class="signature">
            <canvas class="signature__pad" data-signature="${id}" width="720" height="200" aria-label="Área de assinatura"></canvas>
            <div class="signature__bar">
              <span class="muted small">Assine com o mouse, caneta ou dedo</span>
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

  geoHtml(f) {
    const v = this.draft.data[f.id] || {};
    const id = esc(f.id);
    return `
      <div class="geo">
        <div class="geo__row">
          <label class="geo__coord">
            <span>Latitude</span>
            <input type="text" inputmode="decimal" id="f-${id}-lat" data-geo="${id}" data-part="lat" value="${esc(v.lat)}" placeholder="-12.345678">
          </label>
          <label class="geo__coord">
            <span>Longitude</span>
            <input type="text" inputmode="decimal" id="f-${id}-lng" data-geo="${id}" data-part="lng" value="${esc(v.lng)}" placeholder="-38.345678">
          </label>
          <button type="button" class="btn btn--primary geo__btn" data-action="gps" data-target="${id}">${icon('crosshair', 17)} Obter Localização Atual</button>
        </div>
        <div class="geo__extra" data-geo-extra="${id}">${this.geoExtraHtml(f)}</div>
      </div>`;
  }

  // Aviso de origem/precisão, links e mapa. Atualizado sozinho ao digitar, sem recriar os
  // campos (recriar tiraria o foco de quem passa da Latitude para a Longitude com Tab).
  refreshGeoExtra(id) {
    const box = $(`[data-geo-extra="${CSS.escape(id)}"]`, this.el);
    if (box) box.innerHTML = this.geoExtraHtml(this.fields.get(id));
  }

  geoExtraHtml(f) {
    const v = this.draft.data[f.id] || {};
    const coords = parseCoords(v);
    let meta = 'Sem sinal de GPS? Digite as coordenadas manualmente (graus decimais).';
    if (coords && v.source === 'gps') {
      meta = `Capturado por GPS em ${new Date(v.capturedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
        + (v.accuracy ? ` · precisão ±${v.accuracy} m` : '')
        + (v.accuracy > 100 ? ' — precisão baixa, confira no mapa' : '');
    } else if (coords) {
      meta = v.source === 'base'
        ? `Coordenadas do cadastro oficial de poços${v.poco ? ` (${v.poco})` : ''}. Ajuste manualmente ou use "Obter Localização Atual" se precisar.`
        : 'Coordenadas digitadas manualmente.';
    }

    let map = '';
    if (coords) {
      const links = mapLinks(coords);
      const d = 0.004;
      const bbox = [coords.lng - d, coords.lat - d, coords.lng + d, coords.lat + d].map((n) => n.toFixed(6)).join(',');
      map = `
        <div class="geo__links">
          <a class="btn btn--ghost btn--sm" href="${links.google}" target="_blank" rel="noopener">${icon('mapPin', 15)} Google Maps</a>
          <a class="btn btn--ghost btn--sm" href="${links.waze}" target="_blank" rel="noopener">${icon('navigation', 15)} Waze</a>
          <a class="btn btn--ghost btn--sm" href="${links.osm}" target="_blank" rel="noopener">${icon('map', 15)} OpenStreetMap</a>
        </div>
        ${navigator.onLine
          ? `<iframe class="geo__map" title="Mapa da locação" loading="lazy" referrerpolicy="no-referrer"
               src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coords.lat},${coords.lng}"></iframe>`
          : '<div class="geo__map geo__map--offline">Mapa indisponível sem internet. As coordenadas ficam salvas e os links funcionam quando houver conexão.</div>'}`;
    }

    return `<p class="geo__meta muted small">${esc(meta)}</p>${map}`;
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
      },
      (err) => {
        this.refreshField(id);
        const msg = err.code === 1 ? 'Permissão de localização negada. Verifique Configurações do Windows › Privacidade › Localização.'
          : err.code === 3 ? 'O GPS não respondeu a tempo. Tente novamente ou digite as coordenadas.'
          : 'Não foi possível obter a posição. Digite as coordenadas manualmente.';
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
      default:
        return `<td><input type="${INPUT_TYPES[c.type] || 'text'}" ${common} value="${esc(v)}"
          ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''}${c.type === 'number' ? ' step="any" inputmode="decimal"' : ''}></td>`;
    }
  }

  photosHtml(f) {
    const cats = f.categories || [null];
    const catOf = (p) => (cats.includes(p.category ?? null) ? (p.category ?? null) : cats[cats.length - 1]);
    return `<div class="photo-cats">${cats.map((cat) => {
      const list = this.draft.photos.filter((p) => catOf(p) === cat);
      return `
        <div class="photo-cat">
          ${cat ? `<div class="photo-cat__title">${esc(cat)} <span class="muted">(${list.length})</span></div>` : ''}
          <div class="photo-grid">
            ${list.map((p) => `
              <figure class="photo">
                <img src="${this.photoUrl(p)}" alt="${esc(p.name)}">
                <figcaption title="${esc(p.name)}">${esc(p.name)}</figcaption>
                <button type="button" class="icon-btn photo__remove" data-action="remove-photo" data-photo="${esc(p.id)}" title="Remover foto" aria-label="Remover ${esc(p.name)}">${icon('x', 14)}</button>
              </figure>`).join('')}
            <div class="photo-add">
              <label class="photo-add__btn">
                <input type="file" accept="image/*" multiple class="sr-only" data-kind="photos" data-photos-field="${esc(f.id)}" data-category="${esc(cat ?? '')}">
                ${icon('image', 16)} Arquivo
              </label>
              <button type="button" class="photo-add__btn" data-action="camera" data-photos-field="${esc(f.id)}" data-category="${esc(cat ?? '')}">
                ${icon('camera', 16)} Câmera
              </button>
            </div>
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  photoUrl(p) {
    if (!this.photoUrls.has(p.id)) this.photoUrls.set(p.id, URL.createObjectURL(p.blob));
    return this.photoUrls.get(p.id);
  }

  refreshField(id) {
    const wrap = $(`[data-wrap="${CSS.escape(id)}"]`, this.el);
    if (wrap) wrap.innerHTML = this.fieldInnerHtml(this.fields.get(id));
    this.paintSignatures(wrap);
  }

  addPhoto(fieldId, category, { name, type, blob }) {
    this.draft.photos.push({ id: crypto.randomUUID(), name, type, blob, category: category || null });
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

    if (t.dataset.kind === 'photos') {
      if (e.type !== 'change') return;
      const files = [...t.files].filter((f) => f.type.startsWith('image/'));
      const { photosField, category } = t.dataset;
      for (const file of files) {
        this.draft.photos.push({ id: crypto.randomUUID(), name: file.name, type: file.type, blob: file, category: category || null });
      }
      this.refreshField(photosField);
      return this.changed(photosField);
    }

    if (t.dataset.table) {
      const table = t.dataset.table;
      const rowIdx = Number(t.dataset.row);
      const row = data[table][rowIdx];
      row[t.dataset.col] = t.type === 'checkbox' ? t.checked : t.value;
      for (const c of this.fields.get(table).columns.filter((col) => col.computed)) {
        row[c.id] = c.computed(row) || '';
        const cell = $(`[data-computed="${CSS.escape(`${table}:${rowIdx}:${c.id}`)}"]`, this.el);
        if (cell) cell.textContent = row[c.id] || '—';
      }
      return this.changed(table);
    }

    if (t.dataset.geo) {
      const id = t.dataset.geo;
      data[id] = { ...(data[id] || {}), [t.dataset.part]: t.value, source: 'manual', accuracy: null, capturedAt: null };
      if (e.type === 'change') this.refreshGeoExtra(id); // atualiza aviso, links e mapa ao sair do campo
      return this.changed(id);
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
    this.changed(id);
  }

  async handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, table } = btn.dataset;

    if (action === 'add-row') {
      this.draft.data[table].push(newRow(this.fields.get(table), this.draft.data));
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
      this.draft.photos = this.draft.photos.filter((p) => p.id !== pid);
      const field = [...this.fields.values()].find((f) => f.type === 'photos');
      this.refreshField(field.id);
      this.changed(field.id);
    } else if (action === 'camera') {
      const { photosField, category } = btn.dataset;
      try {
        const shot = await openCamera(category || 'Foto');
        if (shot) this.addPhoto(photosField, category, shot);
      } catch (err) {
        toast(err.message, 'error', 6000);
      }
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
    const query = input.value.trim();
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
    input.value = poco.nome;
    this.draft.data[input.dataset.field] = poco.nome;
    this.closeCombo(input);
    this.changed(input.dataset.field);
    await this.applyWellCoords(poco);
  }

  // Digitou o nome exato de um poço da base sem escolher na lista: usa as coordenadas se estiverem vazias
  acceptExactWell(input) {
    const poco = findPoco(this.pocos, input.value);
    const geo = [...this.fields.values()].find((f) => f.type === 'geo');
    if (!poco || !geo) return;
    // Espera o foco chegar no próximo campo: se o técnico foi para Latitude/Longitude,
    // ele vai digitar as coordenadas dele — não preencher por cima.
    setTimeout(() => {
      const geoData = this.draft.data[geo.id];
      const typingCoords = document.activeElement?.dataset?.geo === geo.id;
      const anyTyped = geoData && (String(geoData.lat || '').trim() || String(geoData.lng || '').trim());
      if (!typingCoords && !anyTyped) this.applyWellCoords(poco);
    }, 0);
  }

  // Atualiza Latitude/Longitude no lugar (sem recriar os campos e sem tirar o foco de ninguém)
  setGeoInputs(id) {
    const v = this.draft.data[id] || {};
    for (const part of ['lat', 'lng']) {
      const inp = $(`[data-geo="${CSS.escape(id)}"][data-part="${part}"]`, this.el);
      if (inp) inp.value = v[part] ?? '';
    }
    this.refreshGeoExtra(id);
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
        message: `Este relatório já tem coordenadas ${cur.source === 'gps' ? 'obtidas pelo GPS' : 'digitadas'} (${curCoords.lat.toFixed(5)}, ${curCoords.lng.toFixed(5)}). Usar as do cadastro do poço ${poco.nome} (${poco.lat.toFixed(5)}, ${poco.lng.toFixed(5)})?`,
        confirmLabel: 'Usar coordenadas do cadastro', cancelLabel: 'Manter as atuais', iconName: 'mapPin'
      });
      if (!ok) return;
    }
    this.draft.data[geo.id] = {
      lat: poco.lat.toFixed(6), lng: poco.lng.toFixed(6),
      source: 'base', poco: poco.nome, accuracy: null, capturedAt: null
    };
    this.setGeoInputs(geo.id);
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
    this.changed(f.id);
    if (manual) {
      toast(hasConsolidation(result)
        ? `Consolidação atualizada: ${result.bdos} BDO(s)${result.visita ? ' e a última Visita Técnica' : ''}.`
        : 'Nenhum relatório finalizado para este poço no período.', hasConsolidation(result) ? 'success' : 'info');
    }
  }

  changed(fieldId) {
    if (['poco', 'periodo_inicio', 'periodo_fim'].includes(fieldId) && this.consolField()) this.scheduleConsolidation();
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
