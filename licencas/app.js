// Painel de Licenças Multi-App (WinAppOS) — fala SOMENTE com o projeto Supabase central de licenciamento
// (winappos-licensing), nunca com o banco do BDO-e.
//
// Segurança: a chave abaixo é a publishable (pública por natureza). Quem protege os dados é o servidor:
// o painel exige login (Supabase Auth) e todas as leituras/gravações vão com o token do administrador;
// as tabelas precisam de RLS liberando só administradores e as RPCs devem conferir o papel de quem chama.
// Sem permissão, as listas simplesmente vêm vazias (aviso no topo).

const SUPABASE_URL = 'https://gdqkontotzaexknuprac.supabase.co';
const SUPABASE_KEY = 'sb_publishable_a6VfOUiGfOm492OZFgN7yg_P4rdAVnY';
const AUTH_STORAGE_KEY = 'winappos.licencas.auth'; // separado da sessão do BDO-e (mesma origem)

// Aplicativos conhecidos: aparecem no filtro mesmo antes de existirem em public.apps
const APPS_PADRAO = [
  { id: null, code: 'winapp-os', name: 'WinAppOS Desktop' },
  { id: null, code: 'bdo-e', name: 'BDO-e SaaS' }
];

const STATUS_ATIVO = 'active';
const STATUS_BLOQUEADO = 'blocked';
const RENOVACAO_DIAS = 365;
const LOGS_LIMITE = 300;

// Assinaturas das RPCs do projeto de licenciamento (um só lugar para ajustar se o banco mudar)
const RPC = {
  criar: (f) => ['create_license', { p_app_id: f.app, p_client_id: f.cliente, p_max_devices: f.maxDevices, p_duration_days: f.dias }],
  renovar: (id, dias) => ['renew_license', { p_license_id: id, p_additional_days: dias }],
  status: (id, status) => ['set_license_status', { p_license_id: id, p_status: status }]
};

// ---------------------------------------------------------------- utilitários

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Texto sem acento e minúsculo, para a busca. */
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const casaBusca = (termo, ...campos) => {
  const t = norm(termo).trim();
  if (!t) return true;
  const alvo = norm(campos.join(' '));
  return t.split(/\s+/).every((p) => alvo.includes(p));
};

const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const fmtDataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const diasAte = (iso) => (iso ? Math.ceil((Date.parse(iso) - Date.now()) / 864e5) : null);

const digitos = (v) => String(v ?? '').replace(/\D/g, '');

function fmtDocumento(v) {
  const d = digitos(v).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

function cpfValido(d) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => {
    const soma = [...d.slice(0, n)].reduce((acc, c, i) => acc + Number(c) * (n + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function cnpjValido(d) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

function fmtTelefone(v) {
  const d = digitos(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

/** Mensagem legível para erros do Supabase/PostgREST. */
function mensagemErro(err) {
  if (!err) return 'Erro desconhecido.';
  if (err.code === 'PGRST202') return `Função não encontrada no servidor com esses parâmetros (${err.message}). Ajuste RPC em licencas/app.js.`;
  if (err.code === '42501' || /permission denied|row-level security/i.test(err.message || '')) return 'Sem permissão para esta operação (RLS). Entre com uma conta de administrador.';
  if (err.code === '23505') return 'Já existe um registro com esses dados.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(err.message || '')) return 'Sem conexão com o servidor de licenças.';
  return err.message || String(err);
}

// ---------------------------------------------------------------- toasts e confirmação

const TOAST_ESTILO = {
  success: ['fa-circle-check', 'bg-emerald-600'],
  error: ['fa-circle-exclamation', 'bg-rose-600'],
  info: ['fa-circle-info', 'bg-slate-800'],
  warn: ['fa-triangle-exclamation', 'bg-amber-600']
};

function toast(msg, tipo = 'info', ms = 4000) {
  const [ico, cor] = TOAST_ESTILO[tipo] || TOAST_ESTILO.info;
  const el = document.createElement('div');
  el.className = `pointer-events-auto flex max-w-md items-start gap-3 rounded-xl ${cor} px-4 py-3 text-sm text-white shadow-lg transition-opacity duration-300`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i class="fa-solid ${ico} mt-0.5"></i><span class="flex-1">${esc(msg)}</span>
    <button type="button" class="opacity-80 hover:opacity-100" aria-label="Fechar aviso"><i class="fa-solid fa-xmark"></i></button>`;
  const fechar = () => { el.classList.add('opacity-0'); setTimeout(() => el.remove(), 300); };
  el.querySelector('button').addEventListener('click', fechar);
  $('#toasts').appendChild(el);
  setTimeout(fechar, ms);
}

/** Diálogo de confirmação (sem confirm() nativo). Resolve true/false. */
function confirmar({ titulo, texto, botao = 'Confirmar', perigo = false }) {
  const dlg = $('#modal-confirmar');
  $('[data-titulo]', dlg).textContent = titulo;
  $('[data-texto]', dlg).textContent = texto;
  const ok = $('[data-confirmar]', dlg);
  ok.textContent = botao;
  ok.classList.toggle('bg-rose-600', perigo);
  ok.classList.toggle('hover:bg-rose-700', perigo);
  ok.classList.toggle('bg-indigo-600', !perigo);
  ok.classList.toggle('hover:bg-indigo-700', !perigo);
  return new Promise((resolve) => {
    let resposta = false;
    const clique = (e) => {
      const b = e.target.closest('[data-resposta]');
      if (!b) return;
      resposta = b.dataset.resposta === 'sim';
      dlg.close();
    };
    dlg.addEventListener('click', clique);
    dlg.addEventListener('close', () => { dlg.removeEventListener('click', clique); resolve(resposta); }, { once: true });
    dlg.showModal();
    ok.focus();
  });
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.className = 'fixed -left-[9999px]';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Chave copiada para a área de transferência.', 'success', 2500);
}

// ---------------------------------------------------------------- Supabase

if (!window.supabase?.createClient) {
  document.body.innerHTML = '<p class="p-6">Biblioteca do Supabase não carregada (../src/vendor/supabase.js).</p>';
  throw new Error('Supabase JS ausente');
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY, detectSessionInUrl: false }
});

async function rpc([nome, args]) {
  const { data, error } = await sb.rpc(nome, args);
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- estado

const state = {
  usuario: null,
  apps: [...APPS_PADRAO],
  clientes: [],
  licencas: [],
  logs: [],
  filtroApp: lerPreferencia('app', 'all'),
  aba: lerPreferencia('aba', 'licencas'),
  busca: { licencas: '', clientes: '', logs: '' },
  filtroEvento: '',
  carregando: false,
  carregado: false
};

function lerPreferencia(k, padrao) {
  try { return localStorage.getItem(`winappos.licencas.${k}`) || padrao; } catch { return padrao; }
}
function gravarPreferencia(k, v) {
  try { localStorage.setItem(`winappos.licencas.${k}`, v); } catch { /* sem armazenamento: ignora */ }
}

const appPorId = (id) => state.apps.find((a) => a.id && a.id === id);
const nomeApp = (code) => state.apps.find((a) => a.code === code)?.name || code || '—';
const codigoDaLicenca = (l) => l.apps?.code || appPorId(l.app_id)?.code || '';
const dispositivosDaLicenca = (l) => Number(l.license_devices?.[0]?.count ?? 0);
const expirada = (l) => Boolean(l.expires_at) && Date.parse(l.expires_at) <= Date.now();
const vigente = (l) => l.status === STATUS_ATIVO && !expirada(l);

const licencasDoFiltro = () =>
  state.licencas.filter((l) => state.filtroApp === 'all' || codigoDaLicenca(l) === state.filtroApp);

/** Situação exibida: bloqueio vence a data; ativa com data vencida = expirada. */
function situacao(l) {
  if (l.status === STATUS_BLOQUEADO) return { rotulo: 'Bloqueada', ico: 'fa-ban', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' };
  if (l.status !== STATUS_ATIVO) return { rotulo: l.status || '—', ico: 'fa-circle-question', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
  if (expirada(l)) return { rotulo: 'Expirada', ico: 'fa-hourglass-end', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' };
  return { rotulo: 'Ativa', ico: 'fa-circle-check', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' };
}

// ---------------------------------------------------------------- carga de dados

async function carregarTudo() {
  state.carregando = true;
  renderTudo();
  const [apps, clientes, licencas, logs] = await Promise.all([
    sb.from('apps').select('id, code, name').order('name'),
    sb.from('clients').select('id, name, email, phone, document, created_at').order('name'),
    sb.from('licenses')
      .select('id, license_key, app_id, client_id, status, max_devices, starts_at, expires_at, created_at, apps(code, name), clients(name, email), license_devices(count)')
      .order('created_at', { ascending: false }),
    sb.from('license_logs')
      .select('id, license_id, event_type, details, created_at, licenses(license_key, app_id)')
      .order('created_at', { ascending: false })
      .limit(LOGS_LIMITE)
  ]);
  state.carregando = false;
  const erro = [apps, clientes, licencas, logs].find((r) => r.error)?.error;
  if (erro) toast(`Falha ao carregar: ${mensagemErro(erro)}`, 'error', 7000);

  // apps do banco + os conhecidos que ainda não estão cadastrados
  const doBanco = apps.data || [];
  state.apps = [...doBanco, ...APPS_PADRAO.filter((p) => !doBanco.some((a) => a.code === p.code))];
  state.clientes = clientes.data || [];
  state.licencas = licencas.data || [];
  state.logs = logs.data || [];
  state.carregado = true;
  $('#aviso-permissao').hidden = Boolean(erro) || doBanco.length + state.clientes.length + state.licencas.length + state.logs.length > 0;
  renderTudo();
}

async function recarregarLicencas() {
  const { data, error } = await sb.from('licenses')
    .select('id, license_key, app_id, client_id, status, max_devices, starts_at, expires_at, created_at, apps(code, name), clients(name, email), license_devices(count)')
    .order('created_at', { ascending: false });
  if (error) return toast(`Falha ao atualizar licenças: ${mensagemErro(error)}`, 'error');
  state.licencas = data || [];
  renderTudo();
  carregarLogs(); // as RPCs registram eventos
}

async function carregarLogs() {
  const { data, error } = await sb.from('license_logs')
    .select('id, license_id, event_type, details, created_at, licenses(license_key, app_id)')
    .order('created_at', { ascending: false })
    .limit(LOGS_LIMITE);
  if (error) return;
  state.logs = data || [];
  renderLogs();
}

// ---------------------------------------------------------------- renderização

function renderTudo() {
  renderFiltroApp();
  renderAbas();
  renderMetricas();
  renderLicencas();
  renderClientes();
  renderLogs();
}

function renderFiltroApp() {
  const sel = $('#filtro-app');
  if (!state.apps.some((a) => a.code === state.filtroApp)) state.filtroApp = 'all';
  sel.innerHTML = `<option value="all">Todos os Aplicativos</option>${state.apps
    .map((a) => `<option value="${esc(a.code)}">${esc(a.name || a.code)}</option>`).join('')}`;
  sel.value = state.filtroApp;
}

function renderAbas() {
  for (const b of $$('[data-aba]')) {
    const ativa = b.dataset.aba === state.aba;
    b.setAttribute('aria-selected', String(ativa));
    b.className = `aba flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-medium ${ativa
      ? 'bg-indigo-600 text-white shadow-sm'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`;
  }
  for (const id of ['licencas', 'clientes', 'logs']) $(`#aba-${id}`).hidden = id !== state.aba;
}

function cartao({ titulo, valor, detalhe, ico, cor }) {
  return `<article class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
    <div class="flex items-start justify-between gap-2">
      <p class="text-sm font-medium text-slate-500 dark:text-slate-400">${esc(titulo)}</p>
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl ${cor}"><i class="fa-solid ${ico}"></i></span>
    </div>
    <p class="mt-2 text-3xl font-semibold tabular-nums" data-metrica="${esc(titulo)}">${state.carregando && !state.carregado ? '<span class="text-slate-300 dark:text-slate-700">—</span>' : esc(valor)}</p>
    <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">${esc(detalhe)}</p>
  </article>`;
}

function renderMetricas() {
  const lic = licencasDoFiltro();
  const ativas = lic.filter(vigente).length;
  const bloqueadas = lic.filter((l) => l.status === STATUS_BLOQUEADO).length;
  const expiradas = lic.filter((l) => l.status !== STATUS_BLOQUEADO && !vigente(l)).length;
  const dispositivos = lic.reduce((s, l) => s + dispositivosDaLicenca(l), 0);
  const capacidade = lic.filter(vigente).reduce((s, l) => s + Number(l.max_devices || 0), 0);
  const vencendo = lic.filter((l) => vigente(l) && diasAte(l.expires_at) !== null && diasAte(l.expires_at) <= 30).length;
  const escopo = state.filtroApp === 'all' ? 'Todos os aplicativos' : nomeApp(state.filtroApp);

  $('#metricas').innerHTML = [
    cartao({ titulo: 'Total de Licenças', valor: lic.length, detalhe: escopo, ico: 'fa-id-card', cor: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' }),
    cartao({ titulo: 'Licenças Ativas', valor: ativas, detalhe: vencendo ? `${vencendo} vencem em até 30 dias` : 'Nenhuma vencendo em 30 dias', ico: 'fa-circle-check', cor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' }),
    cartao({ titulo: 'Expiradas / Bloqueadas', valor: expiradas + bloqueadas, detalhe: `${expiradas} expirada${expiradas === 1 ? '' : 's'} · ${bloqueadas} bloqueada${bloqueadas === 1 ? '' : 's'}`, ico: 'fa-ban', cor: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' }),
    cartao({ titulo: 'Dispositivos Conectados', valor: dispositivos, detalhe: capacidade ? `de ${capacidade} vagas nas licenças ativas` : 'Sem vagas em licenças ativas', ico: 'fa-desktop', cor: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300' })
  ].join('');
}

const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
const TD = 'px-4 py-3 align-middle';

function vazio(ico, texto, acao = '') {
  return `<div class="flex flex-col items-center gap-3 px-6 py-14 text-center text-slate-500 dark:text-slate-400">
    <span class="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-xl dark:bg-slate-800"><i class="fa-solid ${ico}"></i></span>
    <p class="text-sm">${esc(texto)}</p>${acao}</div>`;
}

function carregandoHtml() {
  return `<div class="flex items-center justify-center gap-3 px-6 py-14 text-sm text-slate-500"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando…</div>`;
}

function renderLicencas() {
  const box = $('#lista-licencas');
  if (state.carregando && !state.carregado) { box.innerHTML = carregandoHtml(); return; }
  const lista = licencasDoFiltro().filter((l) => {
    const s = situacao(l);
    return casaBusca(state.busca.licencas, l.license_key, l.clients?.name, l.clients?.email, s.rotulo, nomeApp(codigoDaLicenca(l)));
  });
  if (!lista.length) {
    box.innerHTML = state.licencas.length
      ? vazio('fa-filter', 'Nenhuma licença com este filtro.')
      : vazio('fa-id-card', 'Nenhuma licença cadastrada.', '<button type="button" data-acao="nova-licenca" class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"><i class="fa-solid fa-plus"></i> Nova Licença</button>');
    return;
  }

  box.innerHTML = `<table class="w-full min-w-[960px] text-sm">
    <thead class="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
      <tr><th class="${TH}">Chave</th><th class="${TH}">Aplicativo</th><th class="${TH}">Cliente</th><th class="${TH}">Status</th>
      <th class="${TH}">Dispositivos</th><th class="${TH}">Validade</th><th class="${TH} text-right">Ações</th></tr>
    </thead>
    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${lista.map(linhaLicenca).join('')}</tbody>
  </table>`;
}

function linhaLicenca(l) {
  const s = situacao(l);
  const usados = dispositivosDaLicenca(l);
  const cheio = usados >= Number(l.max_devices || 0);
  const dias = diasAte(l.expires_at);
  const prazo = dias === null ? '' : dias < 0 ? `vencida há ${-dias} d` : dias === 0 ? 'vence hoje' : `${dias} d restantes`;
  const prazoCls = dias !== null && dias <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400';
  const bloqueada = l.status === STATUS_BLOQUEADO;
  const btn = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium';

  return `<tr data-licenca="${esc(l.id)}" class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
    <td class="${TD}">
      <div class="flex items-center gap-2">
        <code class="whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800" data-chave>${esc(l.license_key)}</code>
        <button type="button" data-acao="copiar" data-id="${esc(l.id)}" title="Copiar chave" aria-label="Copiar chave"
                class="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"><i class="fa-regular fa-copy"></i></button>
      </div>
    </td>
    <td class="${TD}"><span class="whitespace-nowrap">${esc(nomeApp(codigoDaLicenca(l)))}</span></td>
    <td class="${TD}"><p class="font-medium">${esc(l.clients?.name || '—')}</p><p class="text-xs text-slate-500 dark:text-slate-400">${esc(l.clients?.email || '')}</p></td>
    <td class="${TD}"><span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}" data-status><i class="fa-solid ${s.ico}"></i>${esc(s.rotulo)}</span></td>
    <td class="${TD}">
      <button type="button" data-acao="dispositivos" data-id="${esc(l.id)}" class="${btn} border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" title="Ver dispositivos">
        <i class="fa-solid fa-desktop"></i><span class="tabular-nums ${cheio ? 'text-amber-600 dark:text-amber-400' : ''}" data-uso>${usados} / ${esc(l.max_devices ?? '—')}</span>
      </button>
    </td>
    <td class="${TD}"><p class="whitespace-nowrap">${fmtData(l.expires_at)}</p><p class="whitespace-nowrap text-xs ${prazoCls}">${esc(prazo)}</p></td>
    <td class="${TD}">
      <div class="flex justify-end gap-1.5">
        <button type="button" data-acao="renovar" data-id="${esc(l.id)}" class="${btn} border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
          <i class="fa-solid fa-calendar-plus"></i> Renovar (+${RENOVACAO_DIAS} dias)
        </button>
        <button type="button" data-acao="status" data-id="${esc(l.id)}" class="${btn} ${bloqueada
          ? 'border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40'
          : 'border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40'}">
          <i class="fa-solid ${bloqueada ? 'fa-lock-open' : 'fa-lock'}"></i> ${bloqueada ? 'Ativar' : 'Bloquear'}
        </button>
      </div>
    </td>
  </tr>`;
}

function renderClientes() {
  const box = $('#lista-clientes');
  if (state.carregando && !state.carregado) { box.innerHTML = carregandoHtml(); return; }
  const porCliente = new Map();
  for (const l of licencasDoFiltro()) porCliente.set(l.client_id, (porCliente.get(l.client_id) || 0) + 1);
  const lista = state.clientes.filter((c) => casaBusca(state.busca.clientes, c.name, c.email, c.phone, c.document, digitos(c.document)));
  if (!lista.length) {
    box.innerHTML = state.clientes.length
      ? vazio('fa-filter', 'Nenhum cliente encontrado.')
      : vazio('fa-users', 'Nenhum cliente cadastrado.', '<button type="button" data-acao="novo-cliente" class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"><i class="fa-solid fa-user-plus"></i> Novo Cliente</button>');
    return;
  }
  const escopo = state.filtroApp === 'all' ? 'Licenças' : `Licenças (${nomeApp(state.filtroApp)})`;
  box.innerHTML = `<table class="w-full min-w-[760px] text-sm">
    <thead class="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
      <tr><th class="${TH}">Nome</th><th class="${TH}">E-mail</th><th class="${TH}">Telefone</th><th class="${TH}">CPF / CNPJ</th><th class="${TH}">${esc(escopo)}</th><th class="${TH}">Cadastro</th></tr>
    </thead>
    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${lista.map((c) => `
      <tr data-cliente="${esc(c.id)}" class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <td class="${TD} font-medium">${esc(c.name)}</td>
        <td class="${TD}">${c.email ? `<a class="text-indigo-600 hover:underline dark:text-indigo-400" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</td>
        <td class="${TD} whitespace-nowrap">${esc(c.phone ? fmtTelefone(c.phone) : '—')}</td>
        <td class="${TD} whitespace-nowrap font-mono text-xs">${esc(c.document ? fmtDocumento(c.document) : '—')}</td>
        <td class="${TD} tabular-nums">${porCliente.get(c.id) || 0}</td>
        <td class="${TD} whitespace-nowrap text-slate-500 dark:text-slate-400">${fmtData(c.created_at)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

const EVENTO_COR = [
  [/creat|cri|nov/i, 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'],
  [/renew|renov/i, 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'],
  [/block|bloq|revok|remov|delet|fail|deni|invalid/i, 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'],
  [/activ|ativ|valid|register|registr/i, 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300']
];
const corEvento = (t) => EVENTO_COR.find(([re]) => re.test(t || ''))?.[1] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

/** details (jsonb) em texto curto: "chave: valor · chave: valor". */
function resumoDetalhes(d) {
  if (d == null || d === '') return '';
  if (typeof d !== 'object') return String(d);
  return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join(' · ');
}

function renderLogs() {
  const box = $('#lista-logs');
  const tipos = [...new Set(state.logs.map((l) => l.event_type).filter(Boolean))].sort();
  const sel = $('#filtro-evento');
  if (!tipos.includes(state.filtroEvento)) state.filtroEvento = '';
  sel.innerHTML = `<option value="">Todos os eventos</option>${tipos.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}`;
  sel.value = state.filtroEvento;

  if (state.carregando && !state.carregado) { box.innerHTML = carregandoHtml(); return; }
  const lista = state.logs.filter((g) => {
    const code = appPorId(g.licenses?.app_id)?.code || '';
    if (state.filtroApp !== 'all' && code !== state.filtroApp) return false;
    if (state.filtroEvento && g.event_type !== state.filtroEvento) return false;
    return casaBusca(state.busca.logs, g.event_type, g.licenses?.license_key, resumoDetalhes(g.details));
  });
  if (!lista.length) { box.innerHTML = vazio('fa-clock-rotate-left', state.logs.length ? 'Nenhum evento com este filtro.' : 'Nenhum evento registrado.'); return; }

  box.innerHTML = `<table class="w-full min-w-[760px] text-sm">
    <thead class="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
      <tr><th class="${TH}">Data</th><th class="${TH}">Evento</th><th class="${TH}">Licença</th><th class="${TH}">Aplicativo</th><th class="${TH}">Detalhes</th></tr>
    </thead>
    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${lista.map((g) => {
      const det = resumoDetalhes(g.details);
      const completo = g.details && typeof g.details === 'object' ? JSON.stringify(g.details, null, 2) : det;
      return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <td class="${TD} whitespace-nowrap text-slate-500 dark:text-slate-400">${fmtDataHora(g.created_at)}</td>
        <td class="${TD}"><span class="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${corEvento(g.event_type)}">${esc(g.event_type || '—')}</span></td>
        <td class="${TD}"><code class="font-mono text-xs">${esc(g.licenses?.license_key || '—')}</code></td>
        <td class="${TD} whitespace-nowrap">${esc(g.licenses ? nomeApp(appPorId(g.licenses.app_id)?.code) : '—')}</td>
        <td class="${TD} max-w-md"><p class="truncate text-xs text-slate-600 dark:text-slate-300" title="${esc(completo)}">${esc(det || '—')}</p></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ---------------------------------------------------------------- modais

function abrirModal(id) {
  const dlg = $(id);
  const erro = $('[data-erro]', dlg);
  if (erro) erro.hidden = true;
  dlg.showModal();
  return dlg;
}

function erroNoModal(dlg, msg) {
  const el = $('[data-erro]', dlg);
  el.textContent = msg;
  el.hidden = false;
}

async function enviando(form, fn) {
  const botao = $('[type=submit]', form);
  botao.disabled = true;
  try { await fn(); } finally { botao.disabled = false; }
}

function abrirNovaLicenca() {
  const dlg = $('#modal-licenca');
  const form = $('#form-licenca');
  form.reset();
  const appSel = form.elements.app;
  // create_license recebe o UUID (p_app_id): só os apps cadastrados em public.apps podem receber licença
  const cadastrados = state.apps.filter((a) => a.id);
  appSel.innerHTML = cadastrados.length
    ? cadastrados.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.code)} (${esc(a.code)})</option>`).join('')
    : '<option value="">Nenhum aplicativo cadastrado em public.apps</option>';
  appSel.value = (cadastrados.find((a) => a.code === state.filtroApp) || cadastrados[0])?.id || '';
  const cliSel = form.elements.cliente;
  cliSel.innerHTML = `<option value="">Selecione o cliente…</option>${state.clientes
    .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.document ? ` — ${esc(fmtDocumento(c.document))}` : ''}</option>`).join('')}`;
  $('[data-sem-clientes]', dlg).hidden = state.clientes.length > 0;
  abrirModal('#modal-licenca');
  (state.clientes.length ? cliSel : appSel).focus();
}

async function salvarLicenca(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const dlg = $('#modal-licenca');
  const f = {
    app: form.elements.app.value,
    cliente: form.elements.cliente.value,
    maxDevices: Number(form.elements.max_devices.value),
    dias: Number(form.elements.dias.value)
  };
  if (!f.app) return erroNoModal(dlg, 'Escolha o aplicativo (cadastrado em public.apps).');
  if (!f.cliente) return erroNoModal(dlg, 'Escolha o cliente.');
  if (!Number.isInteger(f.maxDevices) || f.maxDevices < 1 || f.maxDevices > 1000) return erroNoModal(dlg, 'Limite de dispositivos: número inteiro entre 1 e 1000.');
  if (!Number.isInteger(f.dias) || f.dias < 1 || f.dias > 3650) return erroNoModal(dlg, 'Validade: número inteiro de dias entre 1 e 3650.');

  await enviando(form, async () => {
    try {
      const res = await rpc(RPC.criar(f));
      dlg.close();
      const chave = (typeof res === 'string' && res) || res?.license_key || (Array.isArray(res) && res[0]?.license_key) || '';
      toast(chave ? `Licença criada: ${chave}` : 'Licença criada.', 'success', 6000);
      await recarregarLicencas();
    } catch (err) {
      erroNoModal(dlg, mensagemErro(err));
    }
  });
}

function abrirNovoCliente() {
  $('#form-cliente').reset();
  abrirModal('#modal-cliente');
  $('#form-cliente').elements.name.focus();
}

async function salvarCliente(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const dlg = $('#modal-cliente');
  const name = form.elements.name.value.trim().replace(/\s+/g, ' ');
  const email = form.elements.email.value.trim().toLowerCase();
  const phone = digitos(form.elements.phone.value);
  const doc = digitos(form.elements.document.value);
  if (name.length < 2) return erroNoModal(dlg, 'Informe o nome do cliente.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erroNoModal(dlg, 'E-mail inválido.');
  if (phone && (phone.length < 10 || phone.length > 11)) return erroNoModal(dlg, 'Telefone com DDD: 10 ou 11 dígitos.');
  if (doc && !(doc.length === 11 ? cpfValido(doc) : cnpjValido(doc))) return erroNoModal(dlg, 'CPF ou CNPJ inválido.');

  await enviando(form, async () => {
    const { data, error } = await sb.from('clients')
      .insert({ name, email: email || null, phone: phone || null, document: doc || null })
      .select('id, name, email, phone, document, created_at')
      .single();
    if (error) return erroNoModal(dlg, mensagemErro(error));
    state.clientes = [...state.clientes, data].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    dlg.close();
    toast(`Cliente "${data.name}" cadastrado.`, 'success');
    renderClientes();
    // veio do modal de Nova Licença: volta para ele já com o cliente escolhido
    if (state.voltarParaLicenca) {
      state.voltarParaLicenca = false;
      abrirNovaLicenca();
      $('#form-licenca').elements.cliente.value = data.id;
    }
  });
}

async function renovar(l) {
  const ok = await confirmar({
    titulo: 'Renovar licença',
    texto: `Adicionar ${RENOVACAO_DIAS} dias à licença ${l.license_key} (${l.clients?.name || 'sem cliente'})? Validade atual: ${fmtData(l.expires_at)}.`,
    botao: `Renovar +${RENOVACAO_DIAS} dias`
  });
  if (!ok) return;
  try {
    await rpc(RPC.renovar(l.id, RENOVACAO_DIAS));
    toast('Licença renovada.', 'success');
    await recarregarLicencas();
  } catch (err) {
    toast(mensagemErro(err), 'error', 7000);
  }
}

async function alternarStatus(l) {
  const bloquear = l.status !== STATUS_BLOQUEADO;
  const ok = await confirmar({
    titulo: bloquear ? 'Bloquear licença' : 'Ativar licença',
    texto: bloquear
      ? `Os dispositivos da licença ${l.license_key} deixam de ser validados até ela ser ativada de novo.`
      : `A licença ${l.license_key} volta a ser aceita${expirada(l) ? ', mas continua expirada até ser renovada' : ''}.`,
    botao: bloquear ? 'Bloquear' : 'Ativar',
    perigo: bloquear
  });
  if (!ok) return;
  try {
    await rpc(RPC.status(l.id, bloquear ? STATUS_BLOQUEADO : STATUS_ATIVO));
    toast(bloquear ? 'Licença bloqueada.' : 'Licença ativada.', bloquear ? 'warn' : 'success');
    await recarregarLicencas();
  } catch (err) {
    toast(mensagemErro(err), 'error', 7000);
  }
}

// ---------------------------------------------------------------- dispositivos

let licencaDispositivos = null;

async function abrirDispositivos(l) {
  licencaDispositivos = l;
  const dlg = $('#modal-dispositivos');
  $('[data-subtitulo]', dlg).textContent = `${l.license_key} · ${l.clients?.name || 'sem cliente'} · limite ${l.max_devices ?? '—'}`;
  $('[data-lista]', dlg).innerHTML = carregandoHtml();
  if (!dlg.open) dlg.showModal();
  await carregarDispositivos();
}

async function carregarDispositivos() {
  const l = licencaDispositivos;
  const box = $('#modal-dispositivos [data-lista]');
  const { data, error } = await sb.from('license_devices')
    .select('id, device_id, device_name, activated_at, last_seen_at')
    .eq('license_id', l.id)
    .order('activated_at', { ascending: false });
  if (error) { box.innerHTML = `<p class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">${esc(mensagemErro(error))}</p>`; return; }
  if (!data.length) { box.innerHTML = vazio('fa-plug-circle-xmark', 'Nenhum dispositivo registrado nesta licença.'); return; }

  box.innerHTML = `<ul class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">${data.map((d) => {
    const visto = d.last_seen_at ? diasAte(d.last_seen_at) : null;
    const recente = visto !== null && visto >= -1;
    return `<li class="flex flex-wrap items-center gap-3 p-3" data-dispositivo="${esc(d.id)}">
      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><i class="fa-solid ${/phone|iphone|android|mobile|celular/i.test(d.device_name || '') ? 'fa-mobile-screen' : 'fa-computer'}"></i></span>
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium">${esc(d.device_name || 'Dispositivo sem nome')}</p>
        <p class="truncate font-mono text-xs text-slate-500 dark:text-slate-400" title="${esc(d.device_id)}">${esc(d.device_id || '—')}</p>
        <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Ativado ${fmtDataHora(d.activated_at)} · <span class="${recente ? 'text-emerald-600 dark:text-emerald-400' : ''}">visto ${fmtDataHora(d.last_seen_at)}</span>
        </p>
      </div>
      <button type="button" data-acao="remover-dispositivo" data-id="${esc(d.id)}" data-nome="${esc(d.device_name || d.device_id || '')}"
              class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-300 px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
        <i class="fa-solid fa-link-slash"></i> Desconectar
      </button>
    </li>`;
  }).join('')}</ul>`;
}

async function removerDispositivo(id, nome) {
  const ok = await confirmar({
    titulo: 'Desconectar dispositivo',
    texto: `Remover "${nome}" da licença? A vaga é liberada e o aparelho precisará ser ativado de novo.`,
    botao: 'Desconectar',
    perigo: true
  });
  if (!ok) return;
  const { data, error } = await sb.from('license_devices').delete().eq('id', id).select('id');
  if (error) return toast(mensagemErro(error), 'error', 7000);
  // RLS sem permissão de DELETE não dá erro: só não apaga nada
  if (!data?.length) return toast('Nada foi removido: sem permissão (RLS) ou o dispositivo já tinha sido removido.', 'warn', 7000);
  toast('Dispositivo desconectado.', 'success');
  await Promise.all([carregarDispositivos(), recarregarLicencas()]);
}

// ---------------------------------------------------------------- eventos

const licencaPorId = (id) => state.licencas.find((l) => String(l.id) === String(id));

document.addEventListener('click', (e) => {
  const fechar = e.target.closest('[data-fechar]');
  if (fechar) { fechar.closest('dialog')?.close(); return; }

  const aba = e.target.closest('[data-aba]');
  if (aba) { state.aba = aba.dataset.aba; gravarPreferencia('aba', state.aba); renderAbas(); return; }

  const dias = e.target.closest('[data-dias]');
  if (dias) { $('#form-licenca').elements.dias.value = dias.dataset.dias; return; }

  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const l = b.dataset.id ? licencaPorId(b.dataset.id) : null;
  switch (b.dataset.acao) {
    case 'recarregar': carregarTudo(); break;
    case 'sair': sair(); break;
    case 'nova-licenca': abrirNovaLicenca(); break;
    case 'novo-cliente':
      state.voltarParaLicenca = Boolean(b.closest('#modal-licenca'));
      b.closest('dialog')?.close();
      abrirNovoCliente();
      break;
    case 'copiar': if (l) copiar(l.license_key); break;
    case 'renovar': if (l) renovar(l); break;
    case 'status': if (l) alternarStatus(l); break;
    case 'dispositivos': if (l) abrirDispositivos(l); break;
    case 'remover-dispositivo': removerDispositivo(b.dataset.id, b.dataset.nome); break;
  }
});

// clique no fundo escuro fecha o modal
for (const dlg of $$('dialog')) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg && dlg.id !== 'modal-confirmar') dlg.close(); });
}

$('#filtro-app').addEventListener('change', (e) => {
  state.filtroApp = e.target.value;
  gravarPreferencia('app', state.filtroApp);
  renderMetricas();
  renderLicencas();
  renderClientes();
  renderLogs();
});

$('#filtro-evento').addEventListener('change', (e) => { state.filtroEvento = e.target.value; renderLogs(); });

const RENDER_BUSCA = { licencas: renderLicencas, clientes: renderClientes, logs: renderLogs };
for (const input of $$('[data-busca]')) {
  input.addEventListener('input', () => { state.busca[input.dataset.busca] = input.value; RENDER_BUSCA[input.dataset.busca](); });
}

$('#form-licenca').addEventListener('submit', salvarLicenca);
$('#form-cliente').addEventListener('submit', salvarCliente);
$('#form-cliente').elements.document.addEventListener('input', (e) => { e.target.value = fmtDocumento(e.target.value); });
$('#form-cliente').elements.phone.addEventListener('input', (e) => { e.target.value = fmtTelefone(e.target.value); });

// ---------------------------------------------------------------- login

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const erro = $('#login-erro');
  erro.hidden = true;
  const email = form.elements.email.value.trim().toLowerCase();
  const senha = form.elements.senha.value;
  if (!email || !senha) { erro.textContent = 'Informe e-mail e senha.'; erro.hidden = false; return; }
  await enviando(form, async () => {
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) {
      erro.textContent = error.status === 400 || /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : mensagemErro(error);
      erro.hidden = false;
      return;
    }
    form.reset();
  });
});

async function sair() {
  await sb.auth.signOut().catch(() => {});
}

function mostrar(sessao) {
  const logado = Boolean(sessao?.user);
  $('#tela-login').hidden = logado;
  $('#tela-painel').hidden = !logado;
  for (const dlg of $$('dialog[open]')) if (!logado) dlg.close();
  if (!logado) {
    state.usuario = null;
    state.carregado = false;
    Object.assign(state, { clientes: [], licencas: [], logs: [], apps: [...APPS_PADRAO] });
    $('#login-email').focus();
    return;
  }
  const trocou = state.usuario?.id !== sessao.user.id;
  state.usuario = sessao.user;
  $('#usuario').textContent = sessao.user.email || '';
  if (trocou) carregarTudo();
}

sb.auth.onAuthStateChange((_evento, sessao) => {
  // o callback não pode aguardar chamadas ao Supabase (trava o cliente): adia para o próximo ciclo
  setTimeout(() => mostrar(sessao), 0);
});
const { data: { session } } = await sb.auth.getSession();
mostrar(session);
