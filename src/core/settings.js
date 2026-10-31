// Configurações do sistema (empresa, contrato/cliente e técnico padrão).
// Fonte local: localStorage (disponível offline). Cópia no Supabase (tabela company_settings) via rpc save_company_settings,
// enviada pela mesma rotina de sincronização dos relatórios (sync.js). Com o técnico logado no Supabase, a versão
// mais recente dele no servidor (rpc my_company_settings) volta para o aparelho — ex.: celular novo já sai com a
// empresa/logo no cabeçalho dos relatórios.

import { sanitizarWhatsApp } from './telefone.js';
import { SYNC } from '../config.js';
import { empresaParaContrato } from './contratos.js';

const KEY = 'bdoe.settings';
const DEVICE_KEY = 'bdoe.deviceId';

export const SETTINGS_FIELDS = [
  'empresa_nome', 'empresa_cnpj', 'empresa_logo',
  'cliente_padrao', 'contrato_padrao',
  'tecnico_nome', 'tecnico_matricula', 'tecnico_cargo',
  'whatsapp_padrao',
  'locais_personalizados',
  'objetivo_visita', 'objetivo_execucao' // sem servidor; com servidor o objetivo vem do contrato (migração 010)
];

const listeners = new Set();
export const onSettingsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---------- Dados do técnico POR USUÁRIO LOGADO ----------
// Nome, matrícula e cargo ("Dados do usuário / técnico") ficam guardados por e-mail de quem entrou neste aparelho:
// quando outro técnico entra, os relatórios novos saem com os dados DELE (nunca com os do anterior). Na 1ª vez
// vêm do cadastro da conta (nome / matrícula); a pessoa pode alterar, e o que ela alterar prevalece.
export const CAMPOS_TECNICO = ['tecnico_nome', 'tecnico_matricula', 'tecnico_cargo'];
const TECNICOS_KEY = 'bdoe.settings.tecnicos';
const ULTIMO_KEY = 'bdoe.settings.ultimoTecnico';

const emailLogado = () => {
  try { return String(JSON.parse(localStorage.getItem('bdoe.auth.session'))?.email || '').toLowerCase(); } catch { return ''; }
};
function lerTecnicos() {
  try { return JSON.parse(localStorage.getItem(TECNICOS_KEY)) || {}; } catch { return {}; }
}
const gravarTecnicos = (t) => localStorage.setItem(TECNICOS_KEY, JSON.stringify(t));
const normTexto = (t) => String(t ?? '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Dados do técnico de um e-mail (ou null se ainda não há neste aparelho). */
export function dadosDoTecnico(email = emailLogado()) {
  const slot = email ? lerTecnicos()[email] : null;
  return slot ? Object.fromEntries(CAMPOS_TECNICO.map((k) => [k, slot[k] ?? ''])) : null;
}

/**
 * Ao entrar: garante os dados do técnico deste usuário. Sem registro ainda → do cadastro da conta (ou dos dados
 * antigos do aparelho, se eram dele: mesma matrícula ou nome). Nome / matrícula que vieram da conta acompanham
 * mudanças da conta (ex.: matrícula real no 1º acesso) enquanto a pessoa não os alterar.
 * Devolve { antes, depois } quando o técnico do aparelho mudou (para trocar nos rascunhos), senão null.
 */
export function prepararTecnicoDoUsuario(user) {
  const email = String(user?.email || '').toLowerCase();
  if (!email) return null;
  const tecnicos = lerTecnicos();
  const contaNome = String(user.nome || '').trim();
  const contaMat = String(user.matriculaProvisoria ? '' : (user.matricula || '')).trim();
  let slot = tecnicos[email];
  if (!slot) {
    const aparelho = read();
    // conta sem nome nem matrícula (usuário local deste aparelho): não há como ser de outra pessoa
    const eraDele = (!contaNome && !contaMat)
      || (contaMat && normTexto(aparelho.tecnico_matricula) === normTexto(contaMat))
      || (contaNome && normTexto(aparelho.tecnico_nome) === normTexto(contaNome));
    slot = eraDele
      ? { tecnico_nome: aparelho.tecnico_nome || contaNome, tecnico_matricula: aparelho.tecnico_matricula || contaMat, tecnico_cargo: aparelho.tecnico_cargo || '' }
      : { tecnico_nome: contaNome, tecnico_matricula: contaMat, tecnico_cargo: '' };
    slot._nomeConta = contaNome;
    slot._matConta = contaMat;
  } else {
    if (contaNome && (!slot.tecnico_nome || slot.tecnico_nome === slot._nomeConta)) slot.tecnico_nome = contaNome;
    if (contaMat && (!slot.tecnico_matricula || slot.tecnico_matricula === slot._matConta)) slot.tecnico_matricula = contaMat;
    if (contaNome) slot._nomeConta = contaNome;
    if (contaMat) slot._matConta = contaMat;
  }
  tecnicos[email] = slot;
  gravarTecnicos(tecnicos);
  const anterior = localStorage.getItem(ULTIMO_KEY) || '';
  localStorage.setItem(ULTIMO_KEY, email);
  listeners.forEach((fn) => fn(getSettings()));
  if (!anterior || anterior === email) return null;
  const antes = dadosDoTecnico(anterior);
  return antes ? { antes, depois: dadosDoTecnico(email) } : null;
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function getSettings() {
  const raw = read();
  const proprios = dadosDoTecnico(); // técnico logado: os dados dele, não os do aparelho
  return Object.fromEntries([...SETTINGS_FIELDS, 'updatedAt', 'syncPending', 'syncedAt'].map((k) => [k, (proprios && k in proprios ? proprios[k] : raw[k]) ?? '']));
}

/** Grava localmente (imediato) e marca para envio ao Supabase. */
export function saveSettings(values) {
  const next = { ...read() };
  const email = emailLogado();
  if (email) {
    const tecnicos = lerTecnicos();
    const slot = { ...(tecnicos[email] || {}) };
    for (const k of CAMPOS_TECNICO) slot[k] = (values[k] ?? '').toString().trim();
    tecnicos[email] = slot;
    gravarTecnicos(tecnicos);
  }
  for (const k of SETTINGS_FIELDS) {
    if (email && CAMPOS_TECNICO.includes(k)) continue; // ficam no registro do técnico logado
    next[k] = (values[k] ?? '').toString().trim();
  }
  next.whatsapp_padrao = sanitizarWhatsApp(next.whatsapp_padrao); // ex.: (71) 99961-2118 → 5571999612118
  next.updatedAt = new Date().toISOString();
  next.syncPending = true;
  localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn(getSettings()));
}

function markSynced(updatedAt) {
  const cur = read();
  if (cur.updatedAt !== updatedAt) return; // alterado de novo durante o envio → continua pendente
  cur.syncPending = false;
  cur.syncedAt = new Date().toISOString();
  localStorage.setItem(KEY, JSON.stringify(cur));
  listeners.forEach((fn) => fn(getSettings()));
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/**
 * Dados da empresa para cabeçalhos de relatório/PDF (null se não configurada). Com conta no servidor e a
 * migração 003, a empresa é a do CONTRATO do relatório (core/contratos.js › empresaParaContrato): trocar o
 * contrato troca a logo, e contrato sem empresa definida fica sem logo. Sem isso, vale a das Configurações.
 */
export function companyInfo(contrato) {
  const doContrato = empresaParaContrato(contrato);
  if (doContrato !== undefined) return doContrato;
  const s = getSettings();
  if (!s.empresa_nome && !s.empresa_logo) return null;
  return { nome: s.empresa_nome, cnpj: s.empresa_cnpj, logo: s.empresa_logo };
}

/** Nome usado no cabeçalho quando a empresa prestadora não foi configurada. */
export const EMPRESA_PADRAO = 'Empresa Prestadora';

/**
 * Empresa prestadora para o cabeçalho de PDF/Word: a congelada no relatório (data._empresa) ou a das
 * Configurações; sem nome configurado, "Empresa Prestadora". Nunca há nome de empresa fixo no código.
 */
export function empresaDoRelatorio(company) {
  const c = company || {};
  return {
    nome: String(c.nome || '').trim() || EMPRESA_PADRAO,
    cnpj: String(c.cnpj || '').trim(),
    logo: /^data:image\/(png|jpe?g)/i.test(c.logo || '') ? c.logo : ''
  };
}

/**
 * Envia as configurações pendentes. Só marca como sincronizado com HTTP 200/201
 * e o device_id devolvido pela função.
 */
export async function syncSettings(client) {
  const s = getSettings();
  if (!s.syncPending) return;
  const settings = Object.fromEntries(SETTINGS_FIELDS.map((k) => [k, s[k]]));
  const { data, error, status } = await client.rpc(SYNC.settingsRpc, {
    p_device_id: getDeviceId(), p_settings: settings, p_updated_at: s.updatedAt
  });
  if (error) throw error;
  if ((status === 200 || status === 201) && data === getDeviceId()) markSynced(s.updatedAt);
  else throw new Error(`Servidor não confirmou as configurações (HTTP ${status})`);
}

/**
 * Traz do servidor as configurações mais recentes do técnico logado (rpc my_company_settings, lida de
 * public.company_settings). Só substitui as locais se forem mais novas e não houver alteração local pendente.
 * Devolve true se atualizou.
 */
export async function pullSettings(client) {
  const { data, error } = await client.rpc(SYNC.settingsPullRpc);
  if (error) throw error;
  const remoto = data && typeof data === 'object' ? data : null;
  if (!remoto?.settings || !remoto.updated_at) return false;
  const cur = read();
  if (cur.syncPending) return false; // a alteração deste aparelho vai primeiro
  if (cur.updatedAt && new Date(cur.updatedAt) >= new Date(remoto.updated_at)) return false;
  const next = { ...cur };
  const email = emailLogado();
  for (const k of SETTINGS_FIELDS) {
    if (email && CAMPOS_TECNICO.includes(k)) continue;
    next[k] = (remoto.settings[k] ?? '').toString();
  }
  if (email) { // a cópia do servidor é deste mesmo técnico (my_company_settings): vai para o registro dele
    const tecnicos = lerTecnicos();
    const slot = { ...(tecnicos[email] || {}) };
    for (const k of CAMPOS_TECNICO) if (remoto.settings[k]) slot[k] = String(remoto.settings[k]);
    tecnicos[email] = slot;
    gravarTecnicos(tecnicos);
  }
  next.whatsapp_padrao = sanitizarWhatsApp(next.whatsapp_padrao);
  next.updatedAt = new Date(remoto.updated_at).toISOString();
  next.syncPending = false;
  next.syncedAt = new Date().toISOString();
  localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn(getSettings()));
  return true;
}

// ---------- CNPJ ----------

export function formatCnpj(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function isValidCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((acc, wi, i) => acc + Number(d[i]) * wi, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
