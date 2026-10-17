export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatRelative(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff > 0 ? 'em instantes' : 'agora';
  const min = Math.round(abs / 60_000);
  const txt = min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
  return diff > 0 ? `em ${txt}` : `há ${txt}`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
