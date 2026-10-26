// Editor ampliado para textos longos de uma célula de tabela (ex.: "Atividade executada" do BDO-e) no celular.
// A caixa da tabela é estreita: o texto corria para o lado e a página inteira se mexia ao conferir o que foi
// digitado. Aqui o texto aparece inteiro, quebrando linha, numa caixa alta no topo da tela (acima do teclado).
import { esc } from './dom.js';
import { icon } from './icons.js';

/** Celular ou tela estreita: usa o editor ampliado nas colunas de texto largas. */
export const usarEditorAmpliado = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse), (max-width: 760px)').matches;

/**
 * Abre o editor. onInput(valor) é chamado a cada tecla (o relatório é salvo enquanto digita).
 * Enter conclui (o texto é de uma linha só; quebras coladas viram espaço).
 * @returns {Promise<string>} o texto final, ao concluir ou fechar
 */
export function abrirEditorTexto({ titulo, subtitulo = '', valor = '', placeholder = '', onInput }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal--texto';
    dialog.setAttribute('aria-label', titulo);
    dialog.innerHTML = `
      <div class="modal__header texto-ed__header">
        <div>
          <h2 class="texto-ed__titulo">${esc(titulo)}</h2>
          ${subtitulo ? `<p class="muted small">${esc(subtitulo)}</p>` : ''}
        </div>
        <button type="button" class="btn btn--primary btn--sm" data-ok>${icon('check', 15)} Concluir</button>
      </div>
      <div class="modal__body texto-ed__body">
        <textarea class="texto-ed__area" rows="4" enterkeyhint="done" autocapitalize="sentences" spellcheck="true"
          placeholder="${esc(placeholder)}" aria-label="${esc(titulo)}"></textarea>
        <p class="texto-ed__dica muted small">O texto aparece inteiro aqui para conferir antes de concluir.</p>
      </div>`;
    const area = dialog.querySelector('textarea');
    area.value = String(valor || '');
    const crescer = () => {
      area.style.height = 'auto';
      area.style.height = `${Math.min(area.scrollHeight + 2, Math.round(window.innerHeight * 0.45))}px`;
    };
    area.addEventListener('input', () => {
      if (/[\r\n]/.test(area.value)) {
        const pos = area.selectionStart;
        area.value = area.value.replace(/\s*[\r\n]+\s*/g, ' ');
        area.setSelectionRange(Math.min(pos, area.value.length), Math.min(pos, area.value.length));
      }
      crescer();
      onInput?.(area.value);
    });
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); dialog.close(); }
    });
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]') || e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(area.value); });
    document.body.appendChild(dialog);
    dialog.showModal();
    crescer();
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
}
