// Prévia / conferência do relatório. O mesmo HTML do corpo é usado no PDF (report-pdf.js).
// Modos: "confirm" (finalizar → caixa de saída), "draft" (conferência do rascunho) e "view" (relatório salvo no histórico).

import { icon } from './icons.js';
import { esc, $ } from './dom.js';
import { displayValue, displayCell, hasContent, emptyOptionalSections, dadosParaRelatorio } from './form.js';
import { savePdf, saveDocx } from './report-pdf.js';
import { cabecalhoItens, CAMPOS_CABECALHO } from './cabecalho.js';
import { toast } from './toast.js';
import { companyInfo, empresaDoRelatorio } from '../core/settings.js';
import { consolidationHtml } from './consolidacao-view.js';
import { assignPhotoFields, photosOf, rotuloFotos, TITULO_EXECUCAO } from '../core/fotos.js';
import { relatorioParaJson, nomeArquivoJson } from '../core/relatorio-json.js';
import { showPdfSheet } from './pdf-sheet.js';

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
  const v = displayValue(f, data[f.id]);
  const full = f.full || f.type === 'textarea' || f.type === 'checklist';
  const itemCls = ['preview__item', full && 'preview__item--full', f.highlight && 'preview__item--highlight'].filter(Boolean).join(' ');
  return `<div class="${itemCls}"><dt>${esc(f.pdfLabel || f.label)}</dt><dd class="${v ? '' : 'muted'}">${v ? esc(v) : '—'}</dd></div>`;
}

/**
 * Corpo do relatório. photoSrcs: URLs das fotos na mesma ordem de `photos`.
 * Só entram campos e seções com conteúdo — nada de tabelas vazias ou "—" no PDF.
 * As fotos ficam no bloco do próprio componente (logo abaixo dos dados dele), numeradas como
 * "Figura N" na ordem do relatório. Blocos compare: colunas "Antes (Visita)" x "Depois (Execução)".
 * Abre com o quadro de identificação (cabecalho.js); esses campos não se repetem nas seções.
 * Coordenadas GPS não entram no relatório.
 */
export function reportBodyHtml(module, data, photos, photoSrcs) {
  assignPhotoFields(module, photos);
  data = dadosParaRelatorio(module, data, photos); // campos fixos da seção ("—") e nota do torque
  const srcOf = new Map(photos.map((p, i) => [p, photoSrcs[i]]));
  let fig = 0;
  const figure = (p) => {
    fig += 1;
    const cap = p.legenda || p.category || p.name;
    return `<figure class="photo"><img src="${srcOf.get(p)}" alt="${esc(cap)}">
      <figcaption><strong>Figura ${fig}</strong> — ${esc(cap)}</figcaption></figure>`;
  };
  const grid = (list) => `<div class="photo-grid photo-grid--read">${list.map(figure).join('')}</div>`;
  const photoBlock = (f) => {
    if (f.compare) {
      const antes = photosOf(f, photos, 'antes');
      const depois = photosOf(f, photos, 'depois');
      if (!antes.length && !depois.length) return '';
      if (!antes.length) {
        // sem fotos "Antes" neste componente: uma coluna, em largura total
        return `<div class="preview__photos" data-photos="${esc(f.id)}" data-layout="uma-coluna"><h5 class="preview__photos-title">${esc(rotuloFotos(f, data))}</h5><div class="photo-compare__title">${TITULO_EXECUCAO}</div>${grid(depois)}</div>`;
      }
      const col = (cls, title, list) => `<div class="photo-compare__col photo-compare__col--${cls}"><div class="photo-compare__title">${esc(title)}</div>${list.length ? grid(list) : '<p class="muted small">Sem fotos.</p>'}</div>`;
      const antesHtml = col('antes', `Antes — Visita Técnica${data._visita_data ? ` de ${data._visita_data}` : ''}`, antes);
      const depoisHtml = col('depois', 'Depois — Execução', depois);
      return `<div class="preview__photos" data-photos="${esc(f.id)}" data-layout="antes-depois"><h5 class="preview__photos-title">${esc(rotuloFotos(f, data))}</h5><div class="photo-compare">${antesHtml}${depoisHtml}</div></div>`;
    }
    const list = photosOf(f, photos);
    return list.length ? `<div class="preview__photos" data-photos="${esc(f.id)}"><h5 class="preview__photos-title">${esc(f.label)}</h5>${grid(list)}</div>` : '';
  };

  const ident = cabecalhoItens(module, data)
    .map((it) => `<div class="preview__item${it.full ? ' preview__item--full' : ''}"><dt>${esc(it.label)}</dt><dd>${esc(it.value)}</dd></div>`).join('');
  const identHtml = ident ? `<section class="preview__section preview__ident" data-ident><dl class="preview__grid">${ident}</dl></section>` : '';

  return identHtml + module.sections.map((s) => {
    const items = s.fields.filter((f) => !['geo', 'consolidation', 'photos'].includes(f.type) && !CAMPOS_CABECALHO.has(f.id) && hasContent(f, data))
      .map((f) => fieldHtml(f, data)).join('');
    // O resumo consolidado fica FORA da grade de campos: blocos de grade não quebram bem entre páginas no PDF
    const consol = s.fields.filter((f) => f.type === 'consolidation' && hasContent(f, data))
      .map((f) => `<div class="preview__consol">${consolidationHtml(data[f.id])}</div>`).join('');
    const fotos = s.fields.filter((f) => f.type === 'photos').map(photoBlock).join('');
    if (!items.trim() && !consol && !fotos) return '';
    return `<section class="preview__section"><h4>${esc(s.title)}</h4>${items.trim() ? `<dl class="preview__grid">${items}</dl>` : ''}${consol}${fotos}</section>`;
  }).join('');
}

const EYEBROW = {
  confirm: 'Salvar e Finalizar — confira o relatório',
  draft: 'Prévia do relatório (rascunho)',
  view: 'Relatório salvo neste aparelho'
};

/**
 * @param {object} o
 * @param {Array<{field,message}>} [o.pending] campos obrigatórios ainda pendentes (avisados no topo)
 * @param {() => void} [o.onNewReport] botão "Início / Novo relatório" (chamado depois de fechar a prévia)
 * @param {() => void} [o.onReuse] botão de reutilizar (idem); o rótulo vem de o.reuseLabel
 * @param {string} [o.notice] aviso informativo no topo do corpo
 * @returns {Promise<false|'send'|'local'>} modo "confirm": 'send' (salvar e enviar) | 'local' (só salvar no aparelho)
 */
/** Exporta o relatório em JSON (core/relatorio-json.js): "Salvar como" no desktop; painel no navegador. */
async function exportarJson({ module, uniqueId, data, photos, createdAt }) {
  const texto = await relatorioParaJson({ uniqueId, module: module.id, data, photos, createdAt });
  const fileName = nomeArquivoJson(module, data);
  const blob = new Blob([texto], { type: 'application/json' });
  if (window.desktop?.saveFile) return window.desktop.saveFile(new Uint8Array(await blob.arrayBuffer()), fileName);
  await showPdfSheet({ blob, fileName, kind: 'JSON' });
  return { saved: true, sheet: true };
}

export function openPreview({ module, uniqueId, data, photos = [], mode = 'confirm', meta = '', pending = [], onNewReport, onReuse, reuseLabel = 'Reutilizar / Atualizar', notice = '', createdAt = null }) {
  // Relatório finalizado usa a empresa "congelada" no envio; rascunho usa a atual (a do contrato do relatório)
  const company = data._empresa || companyInfo(data.contrato);
  assignPhotoFields(module, photos); // cada foto no bloco do seu componente (antigas → "Outras fotos")
  return new Promise((resolve) => {
    const urls = photos.map((p) => URL.createObjectURL(p.blob));
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    const backLabel = mode === 'view' ? 'Voltar ao histórico' : 'Voltar e editar';
    dialog.innerHTML = `
      <div class="modal__nav" role="toolbar" aria-label="Navegação da prévia">
        <button type="button" class="btn btn--ghost btn--sm" data-close data-back>${icon('arrowLeft', 16)} ${backLabel}</button>
        ${onNewReport ? `<button type="button" class="btn btn--ghost btn--sm" data-new>${icon('home', 16)} Início / Novo relatório</button>` : ''}
        ${onReuse ? `<button type="button" class="btn btn--ghost btn--sm" data-reuse>${icon('copy', 16)} ${esc(reuseLabel)}</button>` : ''}
      </div>
      <div class="modal__header">
        <div>
          <p class="eyebrow">${EYEBROW[mode]}</p>
          ${(() => { const e = empresaDoRelatorio(company); return `<div class="company-chip" data-empresa>${e.logo ? `<img src="${esc(e.logo)}" alt="">` : ''}<span>${esc(e.nome)}${e.cnpj ? ` · CNPJ ${esc(e.cnpj)}` : ''}</span></div>`; })()}
          <h2>${esc(module.title)}</h2>
          <p class="muted small">${data.poco ? `Poço / Locação: <strong>${esc(data.poco)}</strong> · ` : ''}ID <code>${esc(uniqueId)}</code>${meta ? ` · ${esc(meta)}` : ''}</p>
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
      ${mode === 'confirm' ? `
      <div class="modal__footer modal__footer--finalize">
        <div class="finalize-files">
          <button type="button" class="btn btn--ghost" data-pdf>${icon('download', 17)} Baixar / Compartilhar PDF</button>
          <button type="button" class="btn btn--ghost" data-docx>${icon('fileText', 17)} Baixar Word (.docx)</button>
          <button type="button" class="btn btn--ghost" data-json>${icon('upload', 17)} Exportar JSON</button>
        </div>
        <div class="finalize-ask">
          <strong>Deseja enviar este relatório?</strong>
          <span class="muted small">Ao salvar, o relatório fica guardado neste aparelho. Para guardar o arquivo no celular, use "Baixar / Compartilhar PDF". Ao enviar, ele vai para o servidor da empresa e o WhatsApp abre com o link.</span>
        </div>
        <div class="finalize-ask__buttons">
          <button type="button" class="btn btn--ghost" data-local>${icon('save', 17)} Não, só salvar no aparelho</button>
          <button type="button" class="btn btn--primary" data-confirm>${icon('send', 17)} Sim, enviar</button>
        </div>
      </div>` : `
      <div class="modal__footer">
        <button type="button" class="btn btn--ghost" data-pdf>${icon('download', 17)} Baixar / Compartilhar PDF</button>
        <button type="button" class="btn btn--ghost" data-docx>${icon('fileText', 17)} Baixar Word (.docx)</button>
        <button type="button" class="btn btn--ghost" data-json>${icon('upload', 17)} Exportar JSON</button>
        <span class="modal__spacer"></span>
        <button type="button" class="btn btn--primary" data-close>Fechar</button>
      </div>`}`;

    let confirmed = false; // false | 'send' | 'local'
    let after = null; // ação executada depois de fechar (novo relatório / reutilizar)
    dialog.addEventListener('click', async (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) return dialog.close();
      if (e.target.closest('[data-confirm]')) { confirmed = 'send'; return dialog.close(); }
      if (e.target.closest('[data-local]')) { confirmed = 'local'; return dialog.close(); }
      if (e.target.closest('[data-new]')) { after = onNewReport; return dialog.close(); }
      if (e.target.closest('[data-reuse]')) { after = onReuse; return dialog.close(); }
      const jsonBtn = e.target.closest('[data-json]');
      if (jsonBtn && !jsonBtn.disabled) {
        jsonBtn.disabled = true;
        try {
          const res = await exportarJson({ module, uniqueId, data, photos, createdAt });
          if (res?.saved && !res.sheet) toast(`JSON salvo: ${res.filePath}`, 'success', 6000);
        } catch (err) {
          toast(`Não foi possível exportar o JSON: ${err.message}`, 'error', 7000);
        } finally {
          jsonBtn.disabled = false;
        }
        return;
      }
      const docxBtn = e.target.closest('[data-docx]');
      if (docxBtn && !docxBtn.disabled) {
        const label = docxBtn.innerHTML;
        docxBtn.disabled = true;
        docxBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Gerando Word…';
        try {
          const res = await saveDocx({ module, uniqueId, data, photos, company, draft: mode === 'draft' });
          if (res?.sheet) { /* painel "Word pronto" já mostrou as opções */ } else if (res?.saved) toast(`Word salvo e aberto: ${res.filePath}`, 'success', 6000);
          else toast('Geração do Word cancelada.', 'info', 2500);
        } catch (err) {
          console.error('[docx]', err);
          toast(`Não foi possível gerar o Word: ${err.message}`, 'error', 7000);
        } finally {
          docxBtn.disabled = false;
          docxBtn.innerHTML = label;
        }
        return;
      }
      const pdfBtn = e.target.closest('[data-pdf]');
      if (pdfBtn && !pdfBtn.disabled) {
        const label = pdfBtn.innerHTML;
        pdfBtn.disabled = true;
        pdfBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Gerando PDF…';
        try {
          const res = await savePdf({ module, uniqueId, data, photos, company, draft: mode === 'draft' });
          if (res?.sheet) { /* painel "PDF pronto" já mostrou as opções */ } else if (res?.printed) toast('Na janela de impressão, escolha "Salvar como PDF" (no iPhone: Compartilhar › Salvar em Arquivos).', 'info', 7000);
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
