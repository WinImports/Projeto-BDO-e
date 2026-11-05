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

/**
 * "Salvar e Finalizar" com pendências: janela que lista o que falta, agrupado por seção
 * (ex.: "Fotos dos manômetros — Tire ou anexe ao menos uma foto"). Fecha com "Ir para o primeiro".
 */
export function pendenciasDialog(errors) {
  return new Promise((resolve) => {
    const grupos = new Map();
    for (const e of errors) {
      const sec = e.section || 'Outros';
      if (!grupos.has(sec)) grupos.set(sec, []);
      const texto = e.label && e.label !== sec ? `${e.label} — ${e.message}` : e.message;
      if (!grupos.get(sec).includes(texto)) grupos.get(sec).push(texto);
    }
    const n = errors.length;
    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal--confirm modal--pendencias';
    dialog.setAttribute('role', 'alertdialog');
    dialog.dataset.pendencias = '';
    dialog.innerHTML = `
      <div class="confirm">
        <span class="confirm__icon confirm__icon--danger">${icon('alert', 22)}</span>
        <div class="confirm__text">
          <h2 class="confirm__title">Relatório incompleto</h2>
          <p class="confirm__message">${n === 1 ? 'Falta 1 item' : `Faltam ${n} itens`} para finalizar:</p>
          <div class="pendencias">
            ${[...grupos].map(([sec, itens]) => `
              <p class="pendencias__secao">${esc(sec)}</p>
              <ul class="pendencias__lista">${itens.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`).join('')}
          </div>
        </div>
      </div>
      <div class="modal__footer">
        <button type="button" class="btn btn--primary" data-ok>Ir para o primeiro</button>
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
