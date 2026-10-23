// Importação de relatório em JSON (formato core/relatorio-json.js): botão "Upload de Relatório (JSON)" na aba
// do Relatório de Execução. Mostra o resumo, o contrato (lista da conta, core/contratos.js) e oferece:
// Visualizar · PDF (paisagem) · Só salvar no aparelho · Importar e enviar. Salvo, o relatório entra no
// Histórico (e na fila, se enviado) com as fotos — e serve de referência "Antes" para a Execução.
import { lerRelatoriosJson } from '../core/relatorio-json.js';
import { getModule } from '../modules/index.js';
import { contratoDaLista, valorContrato, meusContratos } from '../core/contratos.js';
import { getSettings } from '../core/settings.js';
import { enqueue, saveLocalOnly } from '../core/outbox.js';
import { contratoSelectHtml } from './contrato-campo.js';
import { openPreview } from './preview.js';
import { savePdf } from './report-pdf.js';
import { icon } from './icons.js';
import { $, esc } from './dom.js';
import { toast } from './toast.js';

const dataBr = (d) => {
  const v = String(d?.data || d?.data_hora || '');
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split('-').reverse().join('/') : '';
};

/**
 * Lê o arquivo e abre o diálogo. Resolve com { relatorios, modo: 'send'|'local' } depois de salvar, ou null
 * (cancelado / arquivo inválido — o motivo aparece num aviso).
 */
export async function importarArquivoJson(file) {
  let lido;
  try {
    lido = lerRelatoriosJson(await file.text());
  } catch (err) {
    toast(`Não foi possível importar "${file.name}": ${err.message}`, 'error', 9000);
    return null;
  }
  return dialogo(lido, file.name);
}

function dialogo({ relatorios, fotosIgnoradas }, nomeArquivo) {
  const primeiro = relatorios[0];
  const contratoInicial = contratoDaLista(primeiro.data.contrato)
    || valorContrato(undefined, getSettings().contrato_padrao)
    || primeiro.data.contrato || '';
  const um = relatorios.length === 1;

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal--import';
    dialog.setAttribute('data-importar-json', '');
    dialog.innerHTML = `
      <div class="modal__header">
        <div>
          <p class="eyebrow">Upload de Relatório (JSON)</p>
          <h2>Importar relatório</h2>
          <p class="muted small">Arquivo <strong>${esc(nomeArquivo)}</strong></p>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Fechar">${icon('x', 18)}</button>
      </div>
      <div class="modal__body">
        <ul class="outbox-list" data-importados>${relatorios.map((r, i) => {
          const mod = getModule(r.module);
          return `<li class="outbox-item" data-importado="${i}"><div class="outbox-item__main">
            <span class="outbox-item__title"><strong>${esc(mod.shortTitle)}</strong>${r.data.poco ? ` · ${esc(r.data.poco)}` : ''}</span>
            <span class="muted small">${dataBr(r.data) ? `Relatório de ${dataBr(r.data)} · ` : ''}${r.photos.length} foto${r.photos.length === 1 ? '' : 's'}</span>
          </div></li>`;
        }).join('')}</ul>
        ${fotosIgnoradas ? `<div class="notice notice--warn">${fotosIgnoradas} foto(s) do arquivo não vieram embutidas (só o caminho no servidor) e ficaram de fora.</div>` : ''}
        <div class="field">
          <label class="field__label-wrap" for="imp-contrato"><span class="field__label">Contrato</span></label>
          ${contratoSelectHtml({ id: 'imp-contrato', attrs: 'data-imp-contrato', valor: contratoInicial })}
          <small class="field__hint">O relatório importado fica no Histórico e serve de referência "Antes" no Relatório de Execução do mesmo poço.</small>
        </div>
      </div>
      <div class="modal__footer">
        ${um ? `<button type="button" class="btn btn--ghost" data-imp-ver>${icon('eye', 17)} Visualizar</button>
        <button type="button" class="btn btn--ghost" data-imp-pdf>${icon('download', 17)} PDF (paisagem)</button>` : ''}
        <span class="modal__spacer"></span>
        <button type="button" class="btn btn--ghost" data-imp-local>${icon('save', 17)} Só salvar no aparelho</button>
        <button type="button" class="btn btn--primary" data-imp-enviar>${icon('send', 17)} Importar e enviar</button>
      </div>`;

    let resultado = null;
    const comContrato = () => {
      const c = $('[data-imp-contrato]', dialog).value;
      return relatorios.map((r) => ({ ...r, data: { ...r.data, ...(c ? { contrato: c } : {}) } }));
    };
    dialog.addEventListener('click', async (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) return dialog.close();
      const r = comContrato()[0];
      const module = getModule(r.module);
      if (e.target.closest('[data-imp-ver]')) {
        openPreview({ module, uniqueId: r.uniqueId, data: r.data, photos: r.photos, mode: 'view', meta: 'Importado de arquivo JSON (ainda não salvo)', createdAt: r.createdAt });
        return;
      }
      const pdf = e.target.closest('[data-imp-pdf]');
      if (pdf && !pdf.disabled) {
        pdf.disabled = true;
        try {
          const res = await savePdf({ module, uniqueId: r.uniqueId, data: r.data, photos: r.photos, company: r.data._empresa, paisagem: true });
          if (res?.saved && !res.sheet) toast(`PDF (paisagem) salvo: ${res.filePath}`, 'success', 6000);
        } catch (err) {
          toast(`Não foi possível gerar o PDF: ${err.message}`, 'error', 7000);
        } finally {
          pdf.disabled = false;
        }
        return;
      }
      const modo = e.target.closest('[data-imp-enviar]') ? 'send' : e.target.closest('[data-imp-local]') ? 'local' : null;
      if (!modo) return;
      try {
        const salvos = comContrato();
        for (const rel of salvos) {
          const report = { uniqueId: rel.uniqueId, module: rel.module, data: rel.data, photos: rel.photos };
          if (modo === 'send') await enqueue(report); else await saveLocalOnly(report);
        }
        resultado = { relatorios: salvos, modo };
        dialog.close();
      } catch (err) {
        toast(`Não foi possível salvar o relatório importado: ${err.message}`, 'error', 8000);
      }
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(resultado); });
    document.body.appendChild(dialog);
    dialog.showModal();
    if (!meusContratos().length && primeiro.data.contrato) {
      // sem contratos na conta: o contrato do arquivo continua no relatório (o servidor decide ao enviar)
      $('[data-imp-contrato]', dialog).value = primeiro.data.contrato;
    }
  });
}
