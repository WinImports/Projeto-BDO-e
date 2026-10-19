// Painel discreto após "Sim, enviar": abre o WhatsApp com a mensagem (e o link, se houver).
// O botão é um link de verdade (toque do usuário): funciona no iPhone, que bloqueia janelas abertas por script.
import { esc } from './dom.js';
import { icon } from './icons.js';

let current = null;

export function closeSharePrompt() {
  current?.remove();
  current = null;
}

/** @param {{ url: string, link?: string|null, titulo: string, aviso?: string }} o */
export function showSharePrompt({ url, link, titulo, aviso = '' }) {
  closeSharePrompt();
  const el = document.createElement('div');
  el.className = 'route-prompt share-prompt';
  el.dataset.sharePrompt = '';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', 'Enviar relatório pelo WhatsApp');
  el.innerHTML = `
    <div class="route-prompt__head">
      <span class="route-prompt__icon">${icon('send', 18)}</span>
      <div class="route-prompt__text">
        <strong>${esc(titulo)}</strong>
        <span>${link ? 'Link do relatório gerado.' : 'Mensagem pronta (sem link: o relatório segue para o banco quando houver conexão).'}${aviso ? ` ${esc(aviso)}` : ''}</span>
        ${link ? `<a class="share-prompt__link small" href="${esc(link)}" target="_blank" rel="noopener" data-share-link>${esc(link)}</a>` : ''}
      </div>
      <button type="button" class="icon-btn" data-share-close aria-label="Fechar">${icon('x', 16)}</button>
    </div>
    <div class="route-prompt__actions">
      <a class="btn btn--primary btn--sm" data-share-whatsapp href="${esc(url)}" target="_blank" rel="noopener">${icon('send', 15)} Abrir WhatsApp</a>
      <button type="button" class="btn btn--text btn--sm" data-share-close>Fechar</button>
    </div>`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-share-close]')) closeSharePrompt();
  });
  document.body.appendChild(el);
  current = el;
  return el;
}
