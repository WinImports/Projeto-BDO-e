// Contratos do técnico logado (campo "Contrato" dos relatórios e "Contrato padrão" das Configurações).
//
// Quem é de qual contrato é definido SÓ no servidor (contract_members → RPC my_contracts(), apenas para
// usuário logado com e-mail confirmado). A lista é baixada ao entrar e nas sincronizações e fica guardada
// no aparelho POR USUÁRIO (localStorage), para o campo funcionar sem internet. Usuário local (sem conta no
// servidor) ou outro e-mail → lista vazia: o campo fica desabilitado e o relatório segue sem contrato.
//
// Comparação igual à do servidor (_norm_contrato em supabase/schema.sql): maiúsculas e separadores (espaço,
// hífen, ponto, sublinhado…) não importam — "Os Mans" = "OS-MANS" = "os.mans" (todos viram "OS MANS"), e o
// valor gravado passa a ser o nome da lista. Sem separador nenhum ("OSMANS") é outro contrato, como no servidor.

import { currentUser } from './auth.js';

const KEY = 'bdoe.contratos';
const VALIDADE_MS = 5 * 60_000; // sincronizações periódicas não consultam o servidor mais do que isso

// = btrim(regexp_replace(upper(t), '[^[:alnum:]]+', ' ', 'g')): letras (com acento) e números ficam,
// qualquer sequência de outros caracteres vira um espaço
export const normContrato = (t) => String(t ?? '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const listeners = new Set();
export const onContratosChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function ler() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

const emailAtual = () => {
  const u = currentUser();
  return u?.email && u.modo !== 'local' ? u.email.toLowerCase() : '';
};

/** Contratos do usuário logado guardados neste aparelho (vazio sem conta no servidor). */
export function meusContratos() {
  const email = emailAtual();
  if (!email) return [];
  const s = ler();
  return s.email === email && Array.isArray(s.lista) ? s.lista : [];
}

/**
 * Vínculos do usuário logado guardados no aparelho: [{ id, nome, role: 'gestor'|'tecnico' }] (my_access, migração
 * 001 do banco). Vazio sem conta no servidor ou com o banco ainda sem a migração.
 */
export function meusVinculos() {
  const email = emailAtual();
  const s = ler();
  return email && s.email === email && Array.isArray(s.vinculos) ? s.vinculos : [];
}

/** Contratos em que o usuário logado é gestor (aba Gestão de Equipe). */
export const contratosGeridos = () => meusVinculos().filter((v) => v.role === 'gestor');
export const souGestor = () => contratosGeridos().length > 0;

/** Grava a lista do usuário (sem repetidos pela comparação do servidor), avisando quem desenha os campos. */
export function guardarContratos(lista, email = emailAtual(), vinculos = []) {
  if (!email) return [];
  const vistos = new Set();
  const limpa = [];
  for (const c of lista.map((x) => String(x ?? '').trim()).filter(Boolean)) {
    const n = normContrato(c);
    if (!vistos.has(n)) { vistos.add(n); limpa.push(c); }
  }
  limpa.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const vinc = (Array.isArray(vinculos) ? vinculos : [])
    .filter((v) => v?.id && v?.nome)
    .map((v) => ({ id: String(v.id), nome: String(v.nome), role: v.role === 'gestor' ? 'gestor' : 'tecnico' }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const antes = ler();
  const mudou = antes.email !== email || JSON.stringify(antes.lista || []) !== JSON.stringify(limpa)
    || JSON.stringify(antes.vinculos || []) !== JSON.stringify(vinc);
  try { localStorage.setItem(KEY, JSON.stringify({ email, lista: limpa, vinculos: vinc, atualizadoEm: new Date().toISOString() })); } catch { /* sem espaço: segue com a lista em memória */ }
  if (mudou) listeners.forEach((fn) => fn(limpa));
  return limpa;
}

/**
 * Baixa my_contracts() e guarda a lista. Sem sessão no servidor (usuário local, login offline ou token
 * vencido) não consulta e mantém a lista guardada. force: ao entrar / abrir / voltar a internet;
 * sem force, consulta no máximo a cada 5 min. Erro de rede propaga (a lista guardada continua valendo).
 */
export async function atualizarContratos(client, { force = false } = {}) {
  const email = emailAtual();
  if (!email || !client) return meusContratos();
  const s = ler();
  if (!force && s.email === email && Date.now() - Date.parse(s.atualizadoEm || 0) < VALIDADE_MS) return meusContratos();
  const { data: sessao } = await client.auth.getSession();
  if (!sessao?.session) return meusContratos();
  // my_access (migração 001): contratos + papel. Banco sem a migração → my_contracts (só os nomes)
  let acesso;
  try { acesso = await client.rpc('my_access'); } catch (err) { acesso = { data: null, error: null }; console.warn('[contratos] my_access', err); }
  let lista;
  if (!acesso.error && acesso.data && Array.isArray(acesso.data.contratos)) {
    const vinculos = acesso.data.contratos;
    lista = guardarContratos(vinculos.map((v) => v.nome), email, vinculos);
  } else {
    if (acesso.error && !/PGRST202|my_access/i.test(`${acesso.error.code} ${acesso.error.message}`)) throw acesso.error;
    const { data, error } = await client.rpc('my_contracts');
    if (error) throw error;
    lista = guardarContratos((data || []).map((c) => (typeof c === 'string' ? c : c?.my_contracts)));
  }
  // empresa/logo dos contratos (pesa mais por causa das logos): ao entrar / abrir / voltar a internet, ou a cada 30 min
  const emp = lerEmpresas();
  if (force || emp.email !== email || Date.now() - Date.parse(emp.atualizadoEm || 0) > EMPRESAS_VALIDADE_MS) {
    try { await atualizarEmpresas(client, email); } catch (err) { console.warn('[contratos] empresas', err); }
  }
  return lista;
}

// ---------- Empresa prestadora POR CONTRATO (migração 003) ----------
// O gestor define nome, CNPJ e logo do contrato (Gestão de Equipe › team_set_company); todos do contrato recebem
// por my_contract_companies(). Guardado POR USUÁRIO no aparelho (funciona offline). Com essa lista, o cabeçalho
// dos relatórios usa a empresa do contrato escolhido no relatório — trocar de contrato troca a logo — e a empresa
// das Configurações deixa de valer para quem tem conta no servidor. Banco sem a migração 003 → `suportado: false`
// e tudo continua como antes (empresa das Configurações).

const KEY_EMPRESAS = 'bdoe.empresas';
const EMPRESAS_VALIDADE_MS = 30 * 60_000;

function lerEmpresas() {
  try { return JSON.parse(localStorage.getItem(KEY_EMPRESAS)) || {}; } catch { return {}; }
}

const empresaLimpa = (e) => ({
  id: String(e.id || ''), nome: String(e.nome || ''),
  empresa_nome: String(e.empresa_nome || '').trim(), empresa_cnpj: String(e.empresa_cnpj || '').trim(),
  empresa_logo: /^data:image\/(png|jpe?g)/i.test(e.empresa_logo || '') ? e.empresa_logo : '',
  atualizada_em: e.atualizada_em || null,
  // migração 010: objetivo dos relatórios definido pelo gestor ('' = texto padrão do app)
  objetivo_visita: String(e.objetivo_visita || '').trim(), objetivo_execucao: String(e.objetivo_execucao || '').trim(),
  // migração 011: nomes das válvulas / flanges definidos pelo gestor ({ vc: { short, nome } }; {} = os do app)
  nomes_componentes: e.nomes_componentes && typeof e.nomes_componentes === 'object' && !Array.isArray(e.nomes_componentes) ? e.nomes_componentes : {}
});

/** Grava a lista de empresas dos contratos do usuário (suportado = o banco tem a migração 003). */
export function guardarEmpresas(lista, email = emailAtual(), { suportado = true } = {}) {
  if (!email) return;
  const limpa = (Array.isArray(lista) ? lista : []).filter((e) => e?.id && e?.nome).map(empresaLimpa);
  const antes = lerEmpresas();
  const mudou = antes.email !== email || antes.suportado !== suportado || JSON.stringify(antes.lista || []) !== JSON.stringify(limpa);
  try {
    localStorage.setItem(KEY_EMPRESAS, JSON.stringify({ email, suportado, lista: limpa, atualizadoEm: new Date().toISOString() }));
  } catch { /* sem espaço no aparelho: segue com o que já estava guardado */ }
  if (mudou) listeners.forEach((fn) => fn(meusContratos()));
}

/** Atualiza (ou acrescenta) a empresa de um contrato no aparelho — depois que o gestor grava. */
export function guardarEmpresaDoContrato(empresa) {
  const s = lerEmpresas();
  const email = emailAtual();
  if (!email || s.email !== email) return guardarEmpresas([empresa], email);
  const anterior = (s.lista || []).find((e) => e.id === empresa.id) || {};
  // só os campos que vieram (gravar a empresa não apaga os objetivos, e vice-versa)
  const junto = { ...anterior, ...Object.fromEntries(Object.entries(empresa).filter(([, v]) => v !== undefined)) };
  const lista = (s.lista || []).filter((e) => e.id !== empresa.id).concat(empresaLimpa(junto));
  guardarEmpresas(lista, email);
}

/**
 * Objetivo do relatório ('visita' | 'execucao') para o contrato escolhido (migração 010):
 *  - undefined → não vem do contrato (sem conta no servidor): use o das Configurações / o padrão;
 *  - '' → o gestor não definiu: use o texto padrão do app;
 *  - texto → o do contrato.
 */
export function objetivoDoContrato(contrato, tipo) {
  if (!empresaPorContrato()) return undefined;
  const n = normContrato(contrato);
  const e = n ? empresasDosContratos().find((x) => normContrato(x.nome) === n) : null;
  return e ? String(e[`objetivo_${tipo}`] || '') : '';
}

/**
 * Nomes das válvulas / flanges para o contrato escolhido (migração 011): undefined → não vem do contrato
 * (sem conta no servidor: use o das Configurações); {} → o gestor não renomeou; objeto → os do contrato.
 */
export function nomesDoContrato(contrato) {
  if (!empresaPorContrato()) return undefined;
  const n = normContrato(contrato);
  const e = n ? empresasDosContratos().find((x) => normContrato(x.nome) === n) : null;
  return e?.nomes_componentes || {};
}

/** Baixa my_contract_companies(). Banco sem a migração 003 → guarda `suportado: false` (vale a das Configurações). */
export async function atualizarEmpresas(client, email = emailAtual()) {
  if (!email || !client) return;
  const { data, error } = await client.rpc('my_contract_companies');
  if (error) {
    if (/PGRST202|my_contract_companies/i.test(`${error.code} ${error.message}`)) return guardarEmpresas([], email, { suportado: false });
    throw error;
  }
  // a função da migração 003 sempre devolve uma lista (mesmo vazia); outra resposta = servidor sem a migração
  if (!Array.isArray(data)) return guardarEmpresas([], email, { suportado: false });
  guardarEmpresas(data, email);
}

/** true quando a empresa vem do contrato (conta no servidor com a migração 003 e algum contrato vinculado). */
export function empresaPorContrato() {
  const email = emailAtual();
  const s = lerEmpresas();
  return Boolean(email && s.email === email && s.suportado && meusContratos().length);
}

/** Empresas guardadas dos contratos do usuário (para as telas de Configurações e Equipe). */
export function empresasDosContratos() {
  const email = emailAtual();
  const s = lerEmpresas();
  return email && s.email === email && Array.isArray(s.lista) ? s.lista : [];
}

/**
 * Empresa do cabeçalho para um relatório com este contrato:
 *  - undefined → a empresa NÃO vem do contrato (usuário local / banco sem a migração 003): use as Configurações;
 *  - null → contrato vazio, fora da conta ou sem empresa definida pelo gestor: "Empresa Prestadora", sem logo;
 *  - { nome, cnpj, logo } → a do contrato.
 */
export function empresaParaContrato(contrato) {
  if (!empresaPorContrato()) return undefined;
  const n = normContrato(contrato);
  const e = n ? empresasDosContratos().find((x) => normContrato(x.nome) === n) : null;
  if (!e || (!e.empresa_nome && !e.empresa_logo)) return null;
  return { nome: e.empresa_nome, cnpj: e.empresa_cnpj, logo: e.empresa_logo };
}

/** Nome da lista equivalente a `valor` (mesma regra do servidor) ou null. */
export function contratoDaLista(valor, lista = meusContratos()) {
  const n = normContrato(valor);
  return n ? lista.find((c) => normContrato(c) === n) || null : null;
}

/**
 * Valor do campo Contrato num relatório. Já preenchido → o nome da lista equivalente (ou o valor antigo,
 * mantido como está). Vazio (undefined) → o único contrato da lista ou o contrato padrão das Configurações,
 * se estiver na lista. '' (o técnico escolheu "Selecione…") continua vazio.
 */
export function valorContrato(atual, padrao, lista = meusContratos()) {
  if (atual != null && atual !== '') return contratoDaLista(atual, lista) || atual;
  if (atual === '') return '';
  if (lista.length === 1) return lista[0];
  return contratoDaLista(padrao, lista) || undefined;
}

/** Opções do select: a lista + o valor gravado que não está nela (relatório antigo, não se perde). */
export function opcoesContrato(valor, lista = meusContratos()) {
  const v = String(valor ?? '').trim();
  const daLista = contratoDaLista(v, lista);
  const opcoes = lista.map((c) => ({ valor: c, extra: false }));
  if (v && !daLista) opcoes.push({ valor: v, extra: true });
  return { opcoes, selecionado: daLista || v, vazio: lista.length === 0 };
}
