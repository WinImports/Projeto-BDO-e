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
  if (!acesso.error && acesso.data && Array.isArray(acesso.data.contratos)) {
    const vinculos = acesso.data.contratos;
    return guardarContratos(vinculos.map((v) => v.nome), email, vinculos);
  }
  if (acesso.error && !/PGRST202|my_access/i.test(`${acesso.error.code} ${acesso.error.message}`)) throw acesso.error;
  const { data, error } = await client.rpc('my_contracts');
  if (error) throw error;
  return guardarContratos((data || []).map((c) => (typeof c === 'string' ? c : c?.my_contracts)));
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
