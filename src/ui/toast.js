import { esc } from './dom.js';
import { icon } from './icons.js';

const ICONS = { success: 'checkCircle', error: 'alert', info: 'info', warn: 'alert' };

export function toast(message, kind = 'info', ms = 4000) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="toast__icon">${icon(ICONS[kind] || 'info', 18)}</span>
    <span class="toast__msg">${esc(message)}</span>
    <button type="button" class="toast__close" aria-label="Fechar aviso">${icon('x', 14)}</button>`;
  host.appendChild(el);

  const dismiss = () => {
    if (el.classList.contains('toast--out')) return;
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector('.toast__close').addEventListener('click', dismiss);
  // erros ficam mais tempo; o mouse em cima pausa o fechamento
  let timer = setTimeout(dismiss, kind === 'error' ? Math.max(ms, 7000) : ms);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2000); });
}
