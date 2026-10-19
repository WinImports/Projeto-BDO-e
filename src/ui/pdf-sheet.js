// Painel "PDF pronto" (navegador / PWA). O iPhone só permite compartilhar arquivos a partir de um toque
// direto do usuário — por isso o PDF é gerado antes e o compartilhamento acontece no toque do botão.
import { icon } from './icons.js';
import { esc, $ } from './dom.js';
import { toast } from './toast.js';

/**
 * @param {{ blob: Blob, fileName: string, onPrint?: () => void }} o
 * @returns {Promise<void>} quando o painel fecha
 */
export function showPdfSheet({ blob, fileName, onPrint }) {
  return new Promise((resolve) => {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    let canShare = false;
    try { canShare = Boolean(navigator.canShare?.({ files: [file] })); } catch { canShare = false; }

    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal--confirm modal--sheet';
    dialog.dataset.pdfSheet = '';
    dialog.innerHTML = `
      <div class="confirm">
        <span class="confirm__icon confirm__icon--info">${icon('fileText', 22)}</span>
        <div class="confirm__text">
          <h2 class="confirm__title">PDF pronto</h2>
          <p class="confirm__message"><strong>${esc(fileName)}</strong> · ${Math.max(1, Math.round(blob.size / 1024))} KB</p>
          <p class="muted small">No iPhone: <strong>Compartilhar › Salvar em Arquivos</strong> (ou envie por e-mail / WhatsApp). No Android e no computador: <strong>Baixar PDF</strong>.</p>
        </div>
      </div>
      <div class="sheet__actions">
        ${canShare ? `<button type="button" class="btn btn--primary btn--block" data-share>${icon('send', 17)} Compartilhar / Salvar em Arquivos</button>` : ''}
        <a class="btn ${canShare ? 'btn--ghost' : 'btn--primary'} btn--block" data-download href="${url}" download="${esc(fileName)}">${icon('download', 17)} Baixar PDF</a>
        ${onPrint ? `<button type="button" class="btn btn--ghost btn--block" data-print>${icon('fileText', 17)} Imprimir</button>` : ''}
        <button type="button" class="btn btn--text btn--block" data-close>Fechar</button>
      </div>`;

    dialog.addEventListener('click', async (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) return dialog.close();
      if (e.target.closest('[data-print]')) { dialog.close(); onPrint?.(); return; }
      if (e.target.closest('[data-share]')) {
        try {
          await navigator.share({ title: fileName.replace(/\.pdf$/i, ''), files: [file] });
          dialog.close();
        } catch (err) {
          if (err?.name !== 'AbortError') toast(`Não foi possível compartilhar: ${err.message}. Use "Baixar PDF".`, 'warn', 6000);
        }
      }
    });
    dialog.addEventListener('close', () => {
      setTimeout(() => URL.revokeObjectURL(url), 60_000); // o download pode ainda estar em andamento
      dialog.remove();
      resolve();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    $(canShare ? '[data-share]' : '[data-download]', dialog)?.focus();
  });
}
