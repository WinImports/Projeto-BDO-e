import { icon } from './icons.js';
import { esc, formatDateTime, formatRelative } from './dom.js';
import { openPreview } from './preview.js';
import { getModule } from '../modules/index.js';
import * as outbox from '../core/outbox.js';

export class OutboxView {
  constructor(root, { onSyncNow, onEdit }) {
    this.root = root;
    this.onSyncNow = onSyncNow;
    this.onEdit = onEdit;
    this.items = [];
    this.sync = { running: false, online: navigator.onLine, configured: false };
    root.addEventListener('click', (e) => this.handleClick(e));
  }

  setSyncState(s) {
    this.sync = s;
    this.render();
  }

  async refresh() {
    this.items = await outbox.list();
    this.render();
  }

  statusLine() {
    const s = this.sync;
    if (!s.configured) return { kind: 'warn', text: 'Supabase não configurado — os relatórios ficam guardados com segurança neste computador até a configuração (src/config.js).' };
    if (!s.online) return { kind: 'warn', text: 'Sem conexão — os relatórios serão enviados automaticamente quando a internet voltar.' };
    if (s.running) return { kind: 'info', text: 'Sincronizando com o servidor…' };
    if (s.lastError) return { kind: 'error', text: `Última tentativa falhou: ${s.lastError}` };
    if (s.lastRunAt) return { kind: 'ok', text: `Última sincronização ${formatDateTime(s.lastRunAt)}.` };
    return { kind: 'info', text: 'Aguardando sincronização.' };
  }

  render() {
    const s = this.sync;
    const status = this.statusLine();
    const canSync = s.configured && s.online && !s.running && this.items.length > 0;

    this.root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>Caixa de Saída</h2>
          <p class="muted">${this.items.length
            ? `${this.items.length} relatório${this.items.length > 1 ? 's' : ''} aguardando confirmação do servidor`
            : 'Nenhum relatório pendente'}</p>
        </div>
        <button type="button" class="btn btn--primary" data-action="sync"${canSync ? '' : ' disabled'}>
          ${s.running ? '<span class="spinner" aria-hidden="true"></span> Sincronizando…' : `${icon('refresh', 17)} Sincronizar agora`}
        </button>
      </div>
      <div class="notice notice--${status.kind}" role="status">${esc(status.text)}</div>
      ${this.items.length ? `<ul class="outbox-list">${this.items.map((r) => this.itemHtml(r)).join('')}</ul>` : `
        <div class="empty">
          <div class="empty__icon" aria-hidden="true">${icon('checkCircle', 28)}</div>
          <p><strong>Nenhum relatório na fila.</strong><br>Relatórios finalizados aparecem aqui até o servidor confirmar o recebimento.</p>
        </div>`}`;
  }

  itemHtml(r) {
    const mod = getModule(r.module);
    const failed = r.status === 'error';
    const where = r.data.poco || '';
    return `
      <li class="outbox-item card${failed ? ' outbox-item--error' : ''}">
        <div class="outbox-item__main">
          <div class="outbox-item__title">
            <strong>${esc(mod?.shortTitle || r.module)}</strong>
            ${where ? `<span class="muted">— ${esc(where)}</span>` : ''}
          </div>
          <div class="outbox-item__meta muted small">
            Salvo em ${formatDateTime(r.createdAt)} · ${r.photos.length} foto${r.photos.length === 1 ? '' : 's'}
            · ID <code>${esc(r.uniqueId.slice(0, 8))}</code>
          </div>
          ${failed ? `<div class="outbox-item__error small">
            ${r.attempts} tentativa${r.attempts > 1 ? 's' : ''} sem confirmação · próxima ${formatRelative(r.nextAttemptAt)}
            <br><span class="muted">${esc(r.lastError)}</span>
          </div>` : ''}
        </div>
        <div class="outbox-item__side">
          <span class="status status--${failed ? 'error' : 'pending'}">${failed ? 'Reagendado' : 'Pendente'}</span>
          <div class="outbox-item__actions">
            ${outbox.canEdit(r) && !this.sync.running
              ? `<button type="button" class="btn btn--ghost btn--sm" data-action="edit" data-id="${esc(r.uniqueId)}" title="Voltar para rascunho e corrigir">${icon('pen', 15)} Editar</button>`
              : `<button type="button" class="btn btn--ghost btn--sm" disabled title="Já houve tentativa de envio ao servidor; não pode mais ser editado">${icon('pen', 15)} Editar</button>`}
            <button type="button" class="btn btn--ghost btn--sm" data-action="view" data-id="${esc(r.uniqueId)}">${icon('eye', 15)} Ver</button>
          </div>
        </div>
      </li>`;
  }

  handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'sync') this.onSyncNow();
    if (btn.dataset.action === 'edit') {
      const rec = this.items.find((r) => r.uniqueId === btn.dataset.id);
      if (rec) this.onEdit?.(rec);
    }
    if (btn.dataset.action === 'view') {
      const rec = this.items.find((r) => r.uniqueId === btn.dataset.id);
      const module = rec && getModule(rec.module);
      if (module) {
        openPreview({
          module, uniqueId: rec.uniqueId, data: rec.data, photos: rec.photos,
          mode: 'view', meta: `Salvo em ${formatDateTime(rec.createdAt)}`
        });
      }
    }
  }
}
