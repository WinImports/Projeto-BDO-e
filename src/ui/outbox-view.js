// Histórico e Caixa de Saída: todos os relatórios finalizados neste aparelho (IndexedDB),
// com status de envio. Tocar no relatório abre a prévia (PDF / impressão, reutilizar como novo).
import { icon } from './icons.js';
import { esc, formatDateTime, formatRelative } from './dom.js';
import { openPreview } from './preview.js';
import { getModule, MODULES } from '../modules/index.js';
import * as outbox from '../core/outbox.js';
import { getPref, setPref } from '../core/prefs.js';

const STATUS = {
  pending: { cls: 'pending', label: 'Aguardando envio' },
  error: { cls: 'error', label: 'Reagendado' },
  sent: { cls: 'sent', label: 'Enviado' }
};

/** Data do relatório (primeiro campo de data preenchido), em pt-BR. */
function reportDate(module, data) {
  const f = module?.sections.flatMap((s) => s.fields).find((x) => x.type === 'date' && data[x.id]);
  const v = f && data[f.id];
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split('-').reverse().join('/') : '';
}

export class OutboxView {
  constructor(root, { onSyncNow, onEdit, onReuse }) {
    this.root = root;
    this.onSyncNow = onSyncNow;
    this.onEdit = onEdit;
    this.onReuse = onReuse;
    this.items = [];
    this.filter = getPref('historyFilter', 'all');
    this.sync = { running: false, online: navigator.onLine, configured: false };
    root.addEventListener('click', (e) => this.handleClick(e));
  }

  setSyncState(s) {
    this.sync = s;
    this.render();
  }

  async refresh() {
    this.items = await outbox.reports();
    this.render();
  }

  statusLine() {
    const s = this.sync;
    if (!s.configured) return { kind: 'warn', text: 'Supabase não configurado — os relatórios ficam guardados com segurança neste aparelho até a configuração (src/config.js).' };
    if (!s.online) return { kind: 'warn', text: 'Sem conexão — os relatórios serão enviados automaticamente quando a internet voltar.' };
    if (s.running) return { kind: 'info', text: 'Sincronizando com o servidor…' };
    if (s.lastError) return { kind: 'error', text: `Última tentativa falhou: ${s.lastError}` };
    if (s.lastRunAt) return { kind: 'ok', text: `Última sincronização ${formatDateTime(s.lastRunAt)}.` };
    return { kind: 'info', text: 'Aguardando sincronização.' };
  }

  render() {
    const s = this.sync;
    const status = this.statusLine();
    const pending = this.items.filter((r) => r.outbox).length;
    const canSync = s.configured && s.online && !s.running && pending > 0;
    const shown = this.filter === 'all' ? this.items : this.items.filter((r) => r.module === this.filter);
    const counts = Object.fromEntries(MODULES.map((m) => [m.id, this.items.filter((r) => r.module === m.id).length]));

    this.root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>Histórico e Caixa de Saída</h2>
          <p class="muted">${this.items.length
            ? `${this.items.length} relatório${this.items.length > 1 ? 's' : ''} salvo${this.items.length > 1 ? 's' : ''} neste aparelho · ${pending ? `${pending} aguardando envio` : 'nenhum pendente de envio'}`
            : 'Nenhum relatório finalizado neste aparelho'}</p>
        </div>
        <button type="button" class="btn btn--primary" data-action="sync"${canSync ? '' : ' disabled'}>
          ${s.running ? '<span class="spinner" aria-hidden="true"></span> Sincronizando…' : `${icon('refresh', 17)} Sincronizar agora`}
        </button>
      </div>
      <div class="notice notice--${status.kind}" role="status">${esc(status.text)}</div>
      ${this.items.length ? `
        <div class="history-filter" role="group" aria-label="Filtrar por tipo de relatório">
          <button type="button" class="chip${this.filter === 'all' ? ' is-active' : ''}" data-action="filter" data-filter="all" aria-pressed="${this.filter === 'all'}">Todos <span class="chip__n">${this.items.length}</span></button>
          ${MODULES.map((m) => `<button type="button" class="chip${this.filter === m.id ? ' is-active' : ''}" data-action="filter" data-filter="${m.id}" aria-pressed="${this.filter === m.id}">${esc(m.shortTitle)} <span class="chip__n">${counts[m.id]}</span></button>`).join('')}
        </div>
        ${shown.length
          ? `<ul class="outbox-list" data-history>${shown.map((r) => this.itemHtml(r)).join('')}</ul>`
          : '<p class="muted">Nenhum relatório deste tipo.</p>'}` : `
        <div class="empty">
          <div class="empty__icon" aria-hidden="true">${icon('inbox', 28)}</div>
          <p><strong>Nenhum relatório finalizado ainda.</strong><br>Ao finalizar um BDO-e, Visita Técnica ou Relatório de Execução, ele fica guardado aqui — mesmo depois de enviado — para reabrir, gerar o PDF ou reutilizar.</p>
        </div>`}`;
  }

  itemHtml(r) {
    const mod = getModule(r.module);
    const st = STATUS[r.status] || STATUS.sent;
    const q = r.outbox;
    const date = reportDate(mod, r.data);
    const nPhotos = r.photos.length || r.photosCount || 0;
    const id = esc(r.uniqueId);
    const editable = q && outbox.canEdit(q) && !this.sync.running;
    return `
      <li class="outbox-item card outbox-item--${st.cls}" data-report="${id}" data-module="${esc(r.module)}">
        <button type="button" class="outbox-item__main" data-action="view" data-id="${id}" aria-label="Abrir ${esc(mod?.shortTitle || r.module)} ${esc(r.data.poco || '')}">
          <span class="outbox-item__title">
            <strong>${esc(mod?.shortTitle || r.module)}</strong>
            ${r.data.poco ? `<span class="outbox-item__poco">${icon('mapPin', 14)} ${esc(r.data.poco)}</span>` : ''}
          </span>
          <span class="outbox-item__meta muted small">
            ${date ? `Relatório de ${date} · ` : ''}Finalizado em ${formatDateTime(r.createdAt)}
            · ${nPhotos} foto${nPhotos === 1 ? '' : 's'} · ID <code>${esc(r.uniqueId.slice(0, 8))}</code>
            ${r.status === 'sent' && r.sentAt ? ` · enviado em ${formatDateTime(r.sentAt)}` : ''}
          </span>
          ${r.status === 'error' ? `<span class="outbox-item__error small">
            ${q.attempts} tentativa${q.attempts > 1 ? 's' : ''} sem confirmação · próxima ${formatRelative(q.nextAttemptAt)}
            <br><span class="muted">${esc(q.lastError)}</span>
          </span>` : ''}
        </button>
        <div class="outbox-item__side">
          <span class="status status--${st.cls}">${st.label}</span>
          <div class="outbox-item__actions">
            ${q ? (editable
              ? `<button type="button" class="btn btn--ghost btn--sm" data-action="edit" data-id="${id}" title="Voltar para rascunho e corrigir">${icon('pen', 15)} Editar</button>`
              : `<button type="button" class="btn btn--ghost btn--sm" disabled title="Já houve tentativa de envio ao servidor; não pode mais ser editado">${icon('pen', 15)} Editar</button>`) : ''}
            <button type="button" class="btn btn--ghost btn--sm" data-action="view" data-id="${id}">${icon('fileText', 15)} Ver / PDF</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="reuse" data-id="${id}" title="Novo relatório preenchido com estes dados">${icon('copy', 15)} Reutilizar</button>
          </div>
        </div>
      </li>`;
  }

  /** Prévia do relatório salvo, com PDF/impressão e "Reutilizar / Editar como novo". */
  open(rec) {
    const module = getModule(rec.module);
    if (!module) return;
    const st = STATUS[rec.status] || STATUS.sent;
    const lostPhotos = !rec.photos.length && rec.photosCount > 0;
    openPreview({
      module, uniqueId: rec.uniqueId, data: rec.data, photos: rec.photos, mode: 'view',
      meta: `Finalizado em ${formatDateTime(rec.createdAt)} · ${st.label}`,
      notice: lostPhotos ? `Este relatório tinha ${rec.photosCount} foto(s), mas foi finalizado numa versão anterior do app, que não guardava as fotos depois do envio. O PDF sai sem elas.` : '',
      onReuse: () => this.onReuse?.(rec)
    });
  }

  handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const rec = btn.dataset.id && this.items.find((r) => r.uniqueId === btn.dataset.id);
    switch (btn.dataset.action) {
      case 'sync': return this.onSyncNow();
      case 'filter':
        this.filter = btn.dataset.filter;
        setPref('historyFilter', this.filter);
        return this.render();
      case 'edit': return rec?.outbox && this.onEdit?.(rec.outbox);
      case 'reuse': return rec && this.onReuse?.(rec);
      case 'view': return rec && this.open(rec);
      default:
    }
  }
}
