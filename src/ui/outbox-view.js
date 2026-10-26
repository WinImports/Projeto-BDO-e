// Histórico e Caixa de Saída: todos os relatórios finalizados neste aparelho (IndexedDB),
// com status de envio. Tocar no relatório abre a prévia (PDF / impressão, reutilizar como novo).
import { icon } from './icons.js';
import { esc, formatDateTime, formatRelative } from './dom.js';
import { openPreview } from './preview.js';
import { getModule, MODULES } from '../modules/index.js';
import * as outbox from '../core/outbox.js';
import { getPref, setPref } from '../core/prefs.js';
import { pullInfo, PULL_DIAS } from '../core/pull.js';
import { podeBuscarNoServidor, buscarNoServidor, baixarFotosDoServidor } from '../core/busca.js';
import { toast } from './toast.js';

const STATUS = {
  local: { cls: 'local', label: 'Salvo no aparelho (não enviado)' },
  pending: { cls: 'pending', label: 'Pendente de Envio' },
  error: { cls: 'error', label: 'Pendente de Envio (reagendado)' },
  sent: { cls: 'sent', label: 'Sincronizado' },
  team: { cls: 'team', label: 'Da equipe' },
  server: { cls: 'team', label: 'No servidor' }
};

/** Relatório deste aparelho (pode ser atualizado no lugar) x recebido de outro técnico (vira um novo). */
const proprio = (r) => !r.remote && r.status !== 'team' && r.status !== 'server';

/** Data do relatório (primeiro campo de data preenchido), em pt-BR. */
function reportDate(module, data) {
  const f = module?.sections.flatMap((s) => s.fields).find((x) => x.type === 'date' && data[x.id]);
  const v = f && data[f.id];
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split('-').reverse().join('/') : '';
}

/** Dia do relatório (AAAA-MM-DD): o campo de data / data e hora do relatório; sem ele, o dia em que foi finalizado. */
export function diaDoRelatorio(r) {
  const mod = getModule(r.module);
  const f = mod?.sections.flatMap((s) => s.fields).find((x) => (x.type === 'date' || x.type === 'datetime') && r.data?.[x.id]);
  const v = f && r.data[f.id];
  if (v && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(r.createdAt || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const TIPO_CURTO = { bdo: 'BDO-e', visita_tecnica: 'Visita', handover: 'Execução' };

const SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

/** "Sexta-feira, 24/10/2026" + "Hoje" / "Ontem" quando for o caso. */
function rotuloDoDia(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  const data = new Date(a, m - 1, d);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dif = Math.round((hoje - data) / 86400000);
  return {
    titulo: `${SEMANA[data.getDay()]}, ${dia.split('-').reverse().join('/')}`,
    relativo: dif === 0 ? 'Hoje' : dif === 1 ? 'Ontem' : ''
  };
}

/** Texto sem acentos e em minúsculas (busca "pocos" acha "Poços"). */
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Tudo o que a busca rápida enxerga num relatório: tipo, poço, datas, status, cliente, ID. */
function textoBusca(r) {
  const mod = getModule(r.module);
  const date = reportDate(mod, r.data);
  return normalizar([
    mod?.shortTitle, mod?.title, r.module, r.data.poco, r.data.campo, r.data.cidade_uf, r.data.cliente,
    date, date.replace(/\//g, '-'), date.split('/').reverse().join('-'), formatDateTime(r.createdAt),
    (STATUS[r.status] || STATUS.sent).label, r.autor, r.contrato, r.data.contrato, r.uniqueId
  ].filter(Boolean).join(' '));
}

/** Todos os termos digitados precisam aparecer (em qualquer ordem). */
export function matchesQuery(r, query) {
  const termos = normalizar(query).split(/\s+/).filter(Boolean);
  if (!termos.length) return true;
  const alvo = textoBusca(r);
  return termos.every((t) => alvo.includes(t));
}

export class OutboxView {
  constructor(root, { onSyncNow, onEdit, onReuse, onSend, onEditLocal }) {
    this.root = root;
    this.onSend = onSend;
    this.onEditLocal = onEditLocal;
    this.onSyncNow = onSyncNow;
    this.onEdit = onEdit;
    this.onReuse = onReuse;
    this.items = [];
    this.filter = getPref('historyFilter', 'all');
    this.sync = { running: false, online: navigator.onLine, configured: false };
    this.query = '';
    this.dia = ''; // filtro por data (AAAA-MM-DD), vazio = todas
    this.diasAbertos = new Map(); // gaveta aberta / fechada pelo técnico (sobrevive aos redesenhos da sincronização)
    // só guarda o que o TÉCNICO abriu / fechou (toque ou teclado no resumo da gaveta). O "toggle" também dispara
    // quando a lista é redesenhada com gavetas abertas (ex.: durante a busca, todas abrem) — isso não pode virar
    // preferência, senão ao limpar a busca tudo ficava aberto e a lista desorganizada.
    root.addEventListener('click', (e) => {
      const sum = e.target.closest?.('.history-day__summary');
      this.toqueDia = sum?.parentElement?.dataset?.historyDay || null;
    }, true);
    // "toggle" não sobe na árvore: escuta na captura
    root.addEventListener('toggle', (e) => {
      const dia = e.target?.dataset?.historyDay;
      if (!dia || dia !== this.toqueDia) return;
      this.toqueDia = null;
      if (this.query.trim() || this.dia) return; // durante a busca tudo fica aberto; não muda o normal
      this.diasAbertos.set(dia, e.target.open);
    }, true);
    this.limparServidor();
    root.addEventListener('click', (e) => this.handleClick(e));
    // busca rápida: atualiza só a lista a cada tecla (o campo não é redesenhado e não perde o foco)
    root.addEventListener('input', (e) => {
      if (e.target.matches('[data-history-date]')) {
        this.dia = e.target.value;
        this.root.querySelector('[data-history-date-clear]')?.toggleAttribute('hidden', !this.dia);
        return this.renderResults();
      }
      if (!e.target.matches('[data-history-search]')) return;
      this.query = e.target.value;
      this.limparServidor();
      this.renderResults();
      this.renderServidor();
    });
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
    if (!s.configured) return { kind: 'info', text: 'Os relatórios ficam guardados com segurança neste aparelho até a conexão com o servidor da empresa.' };
    if (!s.online) return { kind: 'warn', text: 'Sem conexão — os relatórios serão enviados automaticamente quando a internet voltar.' };
    if (s.running) return { kind: 'info', text: 'Sincronizando com o servidor…' };
    if (s.lastError) return { kind: 'error', text: `Última tentativa falhou: ${s.lastError}` };
    if (s.lastRunAt) return { kind: 'ok', text: `Última sincronização ${formatDateTime(s.lastRunAt)}.` };
    return { kind: 'info', text: 'Aguardando sincronização.' };
  }

  /** Linha do histórico da equipe (download dos últimos 30 dias por contrato). */
  equipeLine() {
    const s = this.sync;
    if (!s.configured) return null;
    const info = pullInfo();
    if (s.pullError || info.erro) return { kind: 'error', text: `Histórico da equipe: falha ao baixar (${s.pullError || info.erro}).` };
    if (!info.lastAt) return { kind: 'info', text: `Histórico da equipe: entre com a conta do servidor e conecte-se à internet para baixar os relatórios dos últimos ${PULL_DIAS} dias do seu contrato.` };
    if (!info.contratos?.length) return { kind: 'warn', text: 'Histórico da equipe: sua conta não está cadastrada em nenhum contrato no servidor. Peça ao administrador para incluí-la.' };
    const recebidos = this.items.filter((r) => r.status === 'team').length;
    return { kind: 'ok', text: `Histórico da equipe (${info.contratos.join(', ')}): ${recebidos} relatório${recebidos === 1 ? '' : 's'} de outros técnicos neste aparelho · últimos ${PULL_DIAS} dias · atualizado ${formatDateTime(info.lastAt)}.` };
  }

  render() {
    const s = this.sync;
    const status = this.statusLine();
    const pending = this.items.filter((r) => r.outbox).length;
    const locais = this.items.filter((r) => r.status === 'local').length;
    const canSync = s.configured && s.online && !s.running; // envia a fila e baixa a equipe
    const equipe = this.equipeLine();
    const counts = Object.fromEntries(MODULES.map((m) => [m.id, this.items.filter((r) => r.module === m.id).length]));

    const busca = this.root.querySelector('[data-history-search]');
    const focado = busca && document.activeElement === busca ? [busca.selectionStart, busca.selectionEnd] : null;
    this.root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>Histórico e Caixa de Saída</h2>
          <p class="muted">${this.items.length
            ? `${this.items.length} relatório${this.items.length > 1 ? 's' : ''} salvo${this.items.length > 1 ? 's' : ''} neste aparelho · ${pending ? `${pending} pendente${pending > 1 ? 's' : ''} de envio` : 'nenhum pendente de envio'}${locais ? ` · ${locais} não enviado${locais > 1 ? 's' : ''}` : ''}`
            : 'Nenhum relatório finalizado neste aparelho'}</p>
        </div>
        <button type="button" class="btn btn--primary" data-action="sync"${canSync ? '' : ` disabled title="${esc(status.text)}"`}>
          ${s.running ? '<span class="spinner" aria-hidden="true"></span> Sincronizando…' : `${icon('refresh', 17)} Sincronizar agora`}
        </button>
      </div>
      <div class="notice notice--${status.kind}" role="status">${esc(status.text)}</div>
      ${equipe ? `<div class="notice notice--${equipe.kind}" data-equipe-status>${esc(equipe.text)}</div>` : ''}
      ${this.items.length || podeBuscarNoServidor() ? `
        <div class="history-tools">
          <div class="history-search">
            <span class="history-search__icon" aria-hidden="true">${icon('search', 18)}</span>
            <input type="search" class="history-search__input" data-history-search value="${esc(this.query)}"
              placeholder="Buscar por poço, cliente ou tipo..." aria-label="Buscar por poço, cliente ou tipo" autocomplete="off" enterkeyhint="search">
          </div>
          <div class="history-date">
            <label class="history-date__label" for="history-date">${icon('calendar', 16)}<span>Data</span></label>
            <input type="date" id="history-date" class="history-date__input" data-history-date value="${esc(this.dia)}" aria-label="Filtrar pela data do relatório">
            <button type="button" class="btn btn--text btn--sm" data-action="clear-date" data-history-date-clear${this.dia ? '' : ' hidden'} aria-label="Limpar a data">${icon('x', 15)}</button>
          </div>
        </div>
        <div class="history-filter" role="group" aria-label="Filtrar por tipo de relatório">
          <button type="button" class="chip${this.filter === 'all' ? ' is-active' : ''}" data-action="filter" data-filter="all" aria-pressed="${this.filter === 'all'}">Todos <span class="chip__n">${this.items.length}</span></button>
          ${MODULES.map((m) => `<button type="button" class="chip${this.filter === m.id ? ' is-active' : ''}" data-action="filter" data-filter="${m.id}" aria-pressed="${this.filter === m.id}">${esc(m.shortTitle)} <span class="chip__n">${counts[m.id]}</span></button>`).join('')}
        </div>
        <div data-history-results aria-live="polite"></div>
        <div data-history-server-box></div>` : `
        <div class="empty">
          <div class="empty__icon" aria-hidden="true">${icon('inbox', 28)}</div>
          <p><strong>Nenhum relatório finalizado ainda.</strong><br>Ao finalizar um BDO-e, Visita Técnica ou Relatório de Execução, ele fica guardado aqui — mesmo depois de enviado — para reabrir, gerar o PDF ou reutilizar.</p>
        </div>`}`;
    this.renderResults();
    this.renderServidor();
    if (focado) {
      const novo = this.root.querySelector('[data-history-search]');
      novo?.focus();
      novo?.setSelectionRange(...focado);
    }
  }

  /** Lista filtrada pelo tipo (chips) e pela busca rápida. */
  renderResults() {
    const box = this.root.querySelector('[data-history-results]');
    if (!box) return;
    const doTipo = this.filter === 'all' ? this.items : this.items.filter((r) => r.module === this.filter);
    const shown = doTipo.filter((r) => matchesQuery(r, this.query) && (!this.dia || diaDoRelatorio(r) === this.dia));
    const q = this.query.trim();
    const filtrando = Boolean(q || this.dia);
    const criterio = [q ? `"${esc(q)}"` : '', this.dia ? `o dia ${esc(this.dia.split('-').reverse().join('/'))}` : ''].filter(Boolean).join(' em ');
    if (!shown.length) {
      box.innerHTML = `<p class="muted" data-history-empty>${filtrando ? `Nenhum relatório encontrado para ${criterio}${podeBuscarNoServidor() ? ' neste aparelho' : ''}.` : this.items.length ? 'Nenhum relatório deste tipo.' : 'Nenhum relatório neste aparelho.'}</p>`;
      return;
    }
    // gavetas por dia (mais recente primeiro): abertas a do dia mais recente, as que pedem atenção
    // (pendente / não enviado) e todas quando há busca ou data escolhida
    const dias = new Map();
    for (const r of shown) {
      const dia = diaDoRelatorio(r);
      if (!dias.has(dia)) dias.set(dia, []);
      dias.get(dia).push(r);
    }
    const ordem = [...dias.keys()].sort().reverse();
    box.innerHTML = `
      ${filtrando ? `<p class="muted small" data-history-count>${shown.length} relatório${shown.length > 1 ? 's' : ''} encontrado${shown.length > 1 ? 's' : ''} para ${criterio}</p>` : ''}
      <div class="history-days" data-history>
        ${ordem.map((dia, i) => this.diaHtml(dia, dias.get(dia), i === 0, filtrando)).join('')}
      </div>`;
  }

  /** Gaveta de um dia: resumo (data, quantos de cada tipo, pendências) e a lista recolhível. */
  diaHtml(dia, itens, maisRecente, filtrando) {
    const { titulo, relativo } = rotuloDoDia(dia);
    const atencao = itens.filter((r) => r.status === 'pending' || r.status === 'error' || r.status === 'local').length;
    const tipos = MODULES.map((m) => [m, itens.filter((r) => r.module === m.id).length]).filter(([, n]) => n);
    return `
      <details class="history-day card" data-history-day="${esc(dia)}"${filtrando || (this.diasAbertos.get(dia) ?? (maisRecente || atencao > 0)) ? ' open' : ''}>
        <summary class="history-day__summary">
          <span class="history-day__when">
            <strong>${esc(titulo)}</strong>
            ${relativo ? `<span class="history-day__rel">${relativo}</span>` : ''}
          </span>
          <span class="history-day__tipos">${tipos.map(([m, n]) => `<span class="history-day__tipo">${n} ${esc(TIPO_CURTO[m.id] || m.shortTitle)}</span>`).join('')}</span>
          ${atencao ? `<span class="history-day__pend">${atencao} a enviar</span>` : ''}
          <span class="history-day__chevron" aria-hidden="true">${icon('chevronDown', 18)}</span>
        </summary>
        <ul class="outbox-list history-day__list">${itens.map((r) => this.itemHtml(r)).join('')}</ul>
      </details>`;
  }

  // ---------- Busca no servidor: todo o histórico dos contratos (core/busca.js) ----------

  limparServidor() {
    this.servidor = { itens: [], fim: false, carregando: false, erro: '', feito: false };
  }

  servidorHtml() {
    if (!podeBuscarNoServidor()) return '';
    const s = this.servidor;
    const q = this.query.trim();
    const locais = new Set(this.items.map((r) => r.uniqueId));
    const itens = s.itens.filter((r) => !locais.has(r.uniqueId));
    return `
      <section class="history-server" data-history-server>
        <div class="history-server__head">
          <h3>Todo o histórico do contrato (servidor)</h3>
          ${s.feito || s.carregando ? '' : `<button type="button" class="btn btn--ghost btn--sm" data-action="server-search">${icon('search', 15)} ${q ? `Buscar "${esc(q)}" no servidor` : 'Buscar no servidor'}</button>`}
        </div>
        <p class="muted small">Sem limite de data: todos os relatórios dos seus contratos, inclusive os que não estão neste aparelho. Precisa de internet.</p>
        ${s.erro ? `<div class="notice notice--error" role="alert" data-server-erro>${esc(s.erro)}</div>` : ''}
        ${s.feito ? (itens.length
          ? `<p class="muted small" data-server-count>${itens.length} relatório${itens.length > 1 ? 's' : ''} no servidor que não estão neste aparelho${q ? ` para "${esc(q)}"` : ''}</p>
             <ul class="outbox-list" data-history-server-list>${itens.map((r) => this.itemHtml(r)).join('')}</ul>`
          : `<p class="muted" data-server-empty>Nenhum outro relatório no servidor${q ? ` para "${esc(q)}"` : ''}.</p>`) : ''}
        ${s.carregando ? '<p class="muted" data-server-loading><span class="spinner" aria-hidden="true"></span> Buscando no servidor…</p>' : ''}
        ${s.feito && !s.fim && !s.carregando ? `<div class="history-server__mais"><button type="button" class="btn btn--ghost" data-action="server-more">Carregar mais</button></div>` : ''}
      </section>`;
  }

  renderServidor() {
    const box = this.root.querySelector('[data-history-server-box]');
    if (box) box.innerHTML = this.servidorHtml();
  }

  async buscarServidor(mais = false) {
    const s = this.servidor;
    if (s.carregando) return;
    s.carregando = true;
    s.erro = '';
    this.renderServidor();
    try {
      const r = await buscarNoServidor({
        query: this.query.trim(),
        module: this.filter === 'all' ? null : this.filter,
        antes: mais ? s.itens.at(-1)?.createdAt : null
      });
      s.itens = mais ? [...s.itens, ...r.itens] : r.itens;
      s.fim = r.fim;
      s.feito = true;
    } catch (err) {
      s.erro = /PGRST202|search_team_reports/.test(`${err?.code} ${err?.message}`)
        ? 'A busca no servidor ainda não está disponível (o banco precisa da migração 001).'
        : `Não foi possível buscar no servidor: ${err?.message || err}`;
    } finally {
      s.carregando = false;
      this.renderServidor();
    }
  }

  /** Resultado do servidor: baixa as fotos (só agora) e abre a prévia / PDF. */
  async abrirDoServidor(rec) {
    if (rec.fotosServidor?.length && !rec.photos.length) {
      toast('Baixando as fotos do relatório…', 'info', 3000);
      const { fotos, falhas } = await baixarFotosDoServidor(rec);
      rec.photos = fotos;
      rec.fotosPendentes = falhas;
    }
    this.open(rec);
  }

  itemHtml(r) {
    const mod = getModule(r.module);
    const st = STATUS[r.status] || STATUS.sent;
    const q = r.outbox;
    const date = reportDate(mod, r.data);
    const nPhotos = r.photos.length || r.photosCount || 0;
    const id = esc(r.uniqueId);
    return `
      <li class="outbox-item card outbox-item--${st.cls}" data-report="${id}" data-module="${esc(r.module)}">
        <button type="button" class="outbox-item__main" data-action="view" data-id="${id}" aria-label="Abrir ${esc(mod?.shortTitle || r.module)} ${esc(r.data.poco || '')}">
          <span class="outbox-item__title">
            <strong>${esc(mod?.shortTitle || r.module)}</strong>
            ${r.data.poco ? `<span class="outbox-item__poco">${icon('mapPin', 14)} ${esc(r.data.poco)}</span>` : ''}
          </span>
          <span class="outbox-item__meta muted small">
            ${date ? `Relatório de ${date} · ` : ''}Finalizado em ${formatDateTime(r.createdAt)}
            ${nPhotos ? `· ${nPhotos} foto${nPhotos === 1 ? '' : 's'}` : ''} · ID <code>${esc(r.uniqueId.slice(0, 8))}</code>
            ${Number(r.data?._revisao) > 1 ? ` · <span data-versao>versão ${Number(r.data._revisao)}</span>` : ''}
            ${r.status === 'sent' && r.sentAt ? ` · sincronizado em ${formatDateTime(r.sentAt)}` : ''}
            ${r.status === 'team' ? ` · <span data-autor>por ${esc(r.autor || 'técnico da equipe')}</span>` : ''}
          </span>
          ${r.status === 'error' ? `<span class="outbox-item__error small">
            ${q.attempts} tentativa${q.attempts > 1 ? 's' : ''} sem confirmação · próxima ${formatRelative(q.nextAttemptAt)}
            <br><span class="muted">${esc(q.lastError)}</span>
          </span>` : ''}
        </button>
        <div class="outbox-item__side">
          <span class="status status--${st.cls}">${st.label}</span>
          <div class="outbox-item__actions">
            ${proprio(r)
              ? `<button type="button" class="btn btn--ghost btn--sm" data-action="edit" data-id="${id}" title="Abrir este relatório para corrigir ou completar (mesmo relatório: a versão nova substitui a anterior, sem duplicar)">${icon('pen', 15)} Editar</button>`
              : `<button type="button" class="btn btn--ghost btn--sm" data-action="reuse" data-id="${id}" title="Relatório de outro técnico: abre um relatório NOVO preenchido com estes dados">${icon('copy', 15)} Reutilizar como novo</button>`}
            ${r.status === 'local' ? `<button type="button" class="btn btn--primary btn--sm" data-action="send" data-id="${id}" title="Enviar ao servidor e abrir o WhatsApp">${icon('send', 15)} Enviar</button>` : ''}
          </div>
        </div>
      </li>`;
  }

  /** Prévia do relatório salvo, com PDF/impressão e "Reutilizar / Editar como novo". */
  open(rec) {
    const module = getModule(rec.module);
    if (!module) return;
    const st = STATUS[rec.status] || STATUS.sent;
    const lostPhotos = !rec.remote && !rec.photos.length && rec.photosCount > 0;
    const fotosABaixar = rec.remote && rec.fotosPendentes > 0;
    openPreview({
      module, uniqueId: rec.uniqueId, data: rec.data, photos: rec.photos, mode: 'view',
      meta: `Finalizado em ${formatDateTime(rec.createdAt)} · ${st.label}`,
      notice: lostPhotos ? `Este relatório tinha ${rec.photosCount} foto(s), mas foi finalizado numa versão anterior do app, que não guardava as fotos depois do envio. O PDF sai sem elas.`
        : fotosABaixar && rec.status === 'server' ? `${rec.fotosPendentes} foto(s) não puderam ser baixadas agora; abra de novo com internet para tentar outra vez.`
        : fotosABaixar ? `${rec.fotosPendentes} foto(s) deste relatório da equipe ainda não foram baixadas; elas vêm na próxima sincronização com internet.` : '',
      onReuse: () => this.onReuse?.(rec),
      reuseLabel: proprio(rec) ? 'Editar este relatório' : 'Reutilizar como novo'
    });
  }

  handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const rec = btn.dataset.id && (this.items.find((r) => r.uniqueId === btn.dataset.id) || this.servidor.itens.find((r) => r.uniqueId === btn.dataset.id));
    switch (btn.dataset.action) {
      case 'sync': return this.onSyncNow();
      case 'filter':
        this.filter = btn.dataset.filter;
        setPref('historyFilter', this.filter);
        this.limparServidor();
        return this.render();
      case 'clear-date': {
        this.dia = '';
        const campo = this.root.querySelector('[data-history-date]');
        if (campo) campo.value = '';
        btn.hidden = true;
        return this.renderResults();
      }
      case 'server-search': return this.buscarServidor(false);
      case 'server-more': return this.buscarServidor(true);
      case 'edit':
      case 'reuse': return rec && this.onReuse?.(rec); // app.js decide: próprio → atualiza o mesmo; equipe → novo
      case 'send': return rec && this.onSend?.(rec);
      case 'view': return rec && (rec.status === 'server' ? this.abrirDoServidor(rec) : this.open(rec));
      default:
    }
  }
}
