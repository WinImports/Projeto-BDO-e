// Foto ampliada: tocar numa foto (formulário, prévia, Histórico) abre em tela cheia;
// tocar de novo, no "x", fora da foto ou Esc fecha e ela volta ao tamanho normal.
import { esc, $ } from './dom.js';
import { icon } from './icons.js';

/** Abre a imagem `src` em tela cheia com a legenda. Devolve uma Promise resolvida ao fechar. */
export function ampliarFoto(src, legenda = '') {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'foto-ampliada';
    dialog.dataset.fotoAmpliada = '';
    dialog.setAttribute('aria-label', legenda ? `Foto: ${legenda}` : 'Foto ampliada');
    dialog.innerHTML = `
      <button type="button" class="foto-ampliada__fechar" data-fechar aria-label="Fechar foto">${icon('x', 22)}</button>
      <img class="foto-ampliada__img" src="${esc(src)}" alt="${esc(legenda)}">
      ${legenda ? `<p class="foto-ampliada__legenda">${esc(legenda)}</p>` : ''}`;
    // qualquer toque fecha (na foto, no fundo ou no "x")
    dialog.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); resolve(); });
    document.body.appendChild(dialog);
    dialog.showModal();
    $('[data-fechar]', dialog).focus();
  });
}

/** Liga o toque nas fotos de todo o app (uma vez). Foto perdida / indisponível não abre. */
export function ligarFotoAmpliada(root = document) {
  root.addEventListener('click', (e) => {
    const img = e.target.closest?.('figure.photo img');
    if (!img || img.closest('#print-root, [data-foto-ampliada]')) return;
    if (img.closest('.photo--perdida') || !img.currentSrc && !img.src) return;
    e.preventDefault();
    const fig = img.closest('figure.photo');
    const legenda = fig.querySelector('.photo__caption')?.value || fig.querySelector('figcaption')?.textContent?.trim() || img.alt || '';
    ampliarFoto(img.currentSrc || img.src, legenda);
  });
}
