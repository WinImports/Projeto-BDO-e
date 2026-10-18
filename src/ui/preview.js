// Prévia / conferência do relatório. O mesmo HTML do corpo é usado no PDF (report-pdf.js).
// Modos: "confirm" (finalizar → caixa de saída), "draft" (conferência do rascunho) e "view" (relatório salvo no histórico).

import { icon } from './icons.js';
import { esc, $ } from './dom.js';
import { displayValue, displayCell, parseCoords, mapLinks, hasContent, emptyOptionalSections } from './form.js';
import { savePdf } from './report-pdf.js';
import { toast } from './toast.js';
import { companyInfo } from '../core/settings.js';
import { consolidationHtml } from './consolidacao-view.js';

function fieldHtml(f, data) {
  if (f.type === 'photos') return '';
  const cls = ['preview__item', 'preview__item--full', f.highlight && 'preview__item--highlight'].filter(Boolean).join(' ');

  if (f.type === 'table') {
    const rows = data[f.id] || [];
    // colunas sem nenhum valor em nenhuma linha também são omitidas (PDF compacto)
    const cols = f.columns.filter((c) => rows.some((r) => displayCell(c, r[c.id])));
    const body = `<table class="grid-table grid-table--read">
           <thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
           <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(displayCell(c, r[c.id])) || '—'}</td>`).join('')}</tr>`).join('')}</tbody>
         </table>`;
    return `<div class="${cls}">${f.label ? `<dt>${esc(f.label)}</dt>` : ''}<dd>${body}</dd></div>`;
  }
  if (f.type === 'signature') {
    const sig = data[f.id];
    return `<div class="${cls}"><dt>${esc(f.label)}</dt>
      <dd>${sig ? `<img class="preview__signature" src="${esc(sig)}" alt="Assinatura">` : '<span class="muted">—</span>'}</dd></div>`;
  }
  if (f.type === 'geo') {
    const c = parseCoords(data[f.id]);
    const links = c && mapLinks(c);
    return `<div class="${cls}"><dt>${esc(f.label)}</dt>
      <dd>${c ? `<a href="${links.google}" target="_blank" rel="noopener" title="Abrir no Google Maps">${esc(displayValue(f, data[f.id]))}</a>
        <span class="geo-links">Rota até a locação: <a href="${links.google}" target="_blank" rel="noopener">Google Maps</a> · <a href="${links.waze}" target="_blank" rel="noopener">Waze</a> · <a href="${links.osm}" target="_blank" rel="noopener">OpenStreetMap</a></span>` : '<span class="muted">—</span>'}</dd></div>`;
  }

  const v = displayValue(f, data[f.id]);
  const full = f.full || f.type === 'textarea' || f.type === 'checklist';
  const itemCls = ['preview__item', full && 'preview__item--full', f.highlight && 'preview__item--highlight'].filter(Boolean).join(' ');
  return `<div class="${itemCls}"><dt>${esc(f.label)}</dt><dd class="${v ? '' : 'muted'}">${v ? esc(v) : '—'}</dd></div>`;
}

/**
 * Coordenadas GPS para o cabeçalho (prévia e PDF): texto clicável + links de mapa.
 * Devolve '' se o relatório não tiver coordenadas válidas.
 */
export function geoHeaderHtml(module, data) {
  const f = module.sections.flatMap((s) => s.fields).find((x) => x.type === 'geo');
  const c = f && parseCoords(data[f.id]);
  if (!c) return '';
  const links = mapLinks(c); // navegação com a locação como DESTINO
  return `<span class="geo-head"><strong>Coordenadas GPS:</strong>
    <a href="${links.google}" target="_blank" rel="noopener" title="Rota até a locação no Google Maps">${esc(displayValue(f, data[f.id]))}</a>
    · Rota até a locação: <a href="${links.google}" target="_blank" rel="noopener">Google Maps</a>
    · <a href="${links.waze}" target="_blank" rel="noopener">Waze</a>
    · <a href="${links.osm}" target="_blank" rel="noopener">OpenStreetMap</a></span>`;
}

/**
 * Corpo do relatório (seções + fotos). photoSrcs: URLs das fotos na mesma ordem de `photos`.
 * Só entram campos e seções com conteúdo — nada de tabelas vazias ou "—" no PDF.
 * As coordenadas GPS ficam no cabeçalho (geoHeaderHtml), não se repetem no corpo.
 */
export function reportBodyHtml(module, data, photos, photoSrcs) {
  const sections = module.sections.map((s) => {
    const items = s.fields.filter((f) => f.type !== 'geo' && f.type !== 'consolidation' && hasContent(f, data)).map((f) => fieldHtml(f, data)).join('');
    // O resumo consolidado fica FORA da grade de campos: blocos de grade não quebram bem entre páginas no PDF
    const consol = s.fields.filter((f) => f.type === 'consolidation' && hasContent(f, data))
      .map((f) => `<div class="preview__consol">${consolidationHtml(data[f.id])}</div>`).join('');
    if (!items.trim() && !consol) return '';
    return `<section class="preview__section"><h4>${esc(s.title)}</h4>${items.trim() ? `<dl class="preview__grid">${items}</dl>` : ''}${consol}</section>`;
  }).join('');
  const gallery = photos.length ? `
    <section class="preview__section preview__section--photos">
      <h4>Registro fotográfico (${photos.length})</h4>
      <div class="photo-grid photo-grid--read">
        ${photos.map((p, i) => `<figure class="photo"><img src="${photoSrcs[i]}" alt="${esc(p.name)}">
          <figcaption title="${esc(p.name)}">${p.category ? `<strong>${esc(p.category)}</strong><br>` : ''}${esc(p.name)}</figcaption></figure>`).join('')}
      </div>
    </section>` : '';
  return sections + gallery;
}

const EYEBROW = {
  confirm: 'Conferência final antes de enviar',
  draft: 'Prévia do relatório (rascunho)',
  view: 'Relatório salvo neste aparelho'
};

/**
 * @param {object} o
 * @param {Array<{field,message}>} [o.pending] campos obrigatórios ainda pendentes (avisados no topo)
 * @param {() => void} [o.onNewReport] botão "Início / Novo relatório" (chamado depois de fechar a prévia)
 * @param {() => void} [o.onReuse] botão "Reutilizar / Editar como novo" (idem)
 * @param {string} [o.notice] aviso informativo no topo do corpo
 * @returns {Promise<boolean>} true se o usuário confirmou (modo "confirm")
 */
export function openPreview({ module, uniqueId, data, photos = [], mode = 'confirm', meta = '', pending = [], onNewReport, onReuse, notice = '' }) {
  // Relatório finalizado usa a empresa "congelada" no envio; rascunho usa as Configurações atuais
  const company = data._empresa || companyInfo();
  return new Promise((resolve) => {
    const urls = photos.map((p) => URL.createObjectURL(p.blob));
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    const backLabel = mode === 'view' ? 'Voltar ao histórico' : 'Voltar e editar';
    dialog.innerHTML = `
      <div class="modal__nav" role="toolbar" aria-label="Navegação da prévia">
        <button type="button" class="btn btn--ghost btn--sm" data-close data-back>${icon('arrowLeft', 16)} ${backLabel}</button>
        ${onNewReport ? `<button type="button" class="btn btn--ghost btn--sm" data-new>${icon('home', 16)} Início / Novo relatório</button>` : ''}
        ${onReuse ? `<button type="button" class="btn btn--ghost btn--sm" data-reuse>${icon('copy', 16)} Reutilizar / Editar como novo</button>` : ''}
      </div>
      <div class="modal__header">
        <div>
          <p class="eyebrow">${EYEBROW[mode]}</p>
          ${company ? `<div class="company-chip">${company.logo ? `<img src="${esc(company.logo)}" alt="">` : ''}<span>${esc(company.nome || '')}${company.cnpj ? ` · CNPJ ${esc(company.cnpj)}` : ''}</span></div>` : ''}
          <h2>${esc(module.title)}</h2>
          <p class="muted small">${data.poco ? `Poço / Locação: <strong>${esc(data.poco)}</strong> · ` : ''}ID <code>${esc(uniqueId)}</code>${meta ? ` · ${esc(meta)}` : ''}</p>
          ${geoHeaderHtml(module, data) ? `<p class="small">${geoHeaderHtml(module, data)}</p>` : ''}
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Fechar">${icon('x', 18)}</button>
      </div>
      <div class="modal__body">
        ${notice ? `<div class="notice notice--info notice--icon">${icon('info', 18)}<div>${esc(notice)}</div></div>` : ''}
        ${pending.length ? `<div class="notice notice--warn notice--icon">${icon('alert', 18)}<div><strong>Faltam ${pending.length} campo${pending.length > 1 ? 's' : ''} obrigatório${pending.length > 1 ? 's' : ''} para finalizar</strong><ul class="notice__list">${pending.map((p) => `<li>${esc(p.label || p.field)}</li>`).join('')}</ul></div></div>` : ''}
        ${(() => {
          // relatório já finalizado (histórico): não há mais o que "voltar e preencher"
          const empty = mode === 'view' ? [] : emptyOptionalSections(module, data, photos);
          return empty.length
            ? `<div class="notice notice--info notice--icon">${icon('info', 18)}<div><strong>Bloco${empty.length > 1 ? 's' : ''} sem dados — não aparece${empty.length > 1 ? 'm' : ''} no PDF</strong><ul class="notice__list">${empty.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><span class="small">Se houve registro no turno, volte e preencha.</span></div></div>`
            : '';
        })()}
        ${reportBodyHtml(module, data, photos, urls)}
      </div>
      <div class="modal__footer">
        <button type="button" class="btn btn--ghost" data-pdf>${icon('download', 17)} Gerar PDF / Imprimir</button>
        <span class="modal__spacer"></span>
        ${mode === 'confirm'
          ? `<button type="button" class="btn btn--primary" data-confirm>${icon('send', 17)} Confirmar e enviar para a Caixa de Saída</button>`
          : '<button type="button" class="btn btn--primary" data-close>Fechar</button>'}
      </div>`;

    let confirmed = false;
    let after = null; // ação executada depois de fechar (novo relatório / reutilizar)
    dialog.addEventListener('click', async (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) return dialog.close();
      if (e.target.closest('[data-confirm]')) { confirmed = true; return dialog.close(); }
      if (e.target.closest('[data-new]')) { after = onNewReport; return dialog.close(); }
      if (e.target.closest('[data-reuse]')) { after = onReuse; return dialog.close(); }
      const pdfBtn = e.target.closest('[data-pdf]');
      if (pdfBtn && !pdfBtn.disabled) {
        const label = pdfBtn.innerHTML;
        pdfBtn.disabled = true;
        pdfBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Gerando PDF…';
        try {
          const res = await savePdf({ module, uniqueId, data, photos, company, draft: mode === 'draft' });
          if (res?.printed) toast('Relatório aberto para impressão. Escolha "Salvar como PDF" para gerar o arquivo.', 'info', 7000);
          else if (res?.saved) toast(`PDF salvo e aberto: ${res.filePath}`, 'success', 6000);
          else toast('Geração do PDF cancelada.', 'info', 2500);
        } catch (err) {
          console.error('[pdf]', err);
          toast(`Não foi possível gerar o PDF: ${err.message}`, 'error', 7000);
        } finally {
          pdfBtn.disabled = false;
          pdfBtn.innerHTML = label;
        }
      }
    });
    dialog.addEventListener('close', () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      dialog.remove();
      resolve(confirmed);
      after?.();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    $(mode === 'confirm' ? '[data-confirm]' : '[data-close]', dialog)?.focus();
  });
}
