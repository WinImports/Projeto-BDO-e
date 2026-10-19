// Diálogo de confirmação no padrão visual do app (substitui o confirm() nativo).
import { esc, $ } from './dom.js';
import { icon } from './icons.js';

/**
 * @returns {Promise<boolean>} true se o usuário confirmar
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, iconName }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal--confirm';
    dialog.setAttribute('role', 'alertdialog');
    dialog.innerHTML = `
      <div class="confirm">
        <span class="confirm__icon confirm__icon--${danger ? 'danger' : 'info'}">${icon(iconName || (danger ? 'alert' : 'info'), 22)}</span>
        <div class="confirm__text">
          <h2 class="confirm__title">${esc(title)}</h2>
          <p class="confirm__message">${esc(message)}</p>
        </div>
      </div>
      <div class="modal__footer">
        <button type="button" class="btn btn--ghost" data-cancel>${esc(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-ok>${esc(confirmLabel)}</button>
      </div>`;
    let result = false;
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]')) { result = true; dialog.close(); }
      if (e.target.closest('[data-cancel]') || e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); });
    document.body.appendChild(dialog);
    dialog.showModal();
    $('[data-cancel]', dialog).focus(); // foco no botão seguro
  });
}

/** Diálogo só informativo (ex.: prévia do texto de abertura). */
export function infoDialog({ title, message, note = '', iconName = 'fileText' }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal--confirm modal--info';
    dialog.innerHTML = `
      <div class="confirm">
        <span class="confirm__icon confirm__icon--info">${icon(iconName, 22)}</span>
        <div class="confirm__text">
          <h2 class="confirm__title">${esc(title)}</h2>
          <p class="confirm__message" data-info-text>${esc(message)}</p>
          ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
        </div>
      </div>
      <div class="modal__footer">
        <button type="button" class="btn btn--primary" data-ok>Fechar</button>
      </div>`;
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]') || e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(); });
    document.body.appendChild(dialog);
    dialog.showModal();
    $('[data-ok]', dialog).focus();
  });
}
