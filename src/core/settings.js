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
  'locais_personalizados'
];

const listeners = new Set();
export const onSettingsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function getSettings() {
  const raw = read();
  return Object.fromEntries([...SETTINGS_FIELDS, 'updatedAt', 'syncPending', 'syncedAt'].map((k) => [k, raw[k] ?? '']));
}

/** Grava localmente (imediato) e marca para envio ao Supabase. */
export function saveSettings(values) {
  const next = { ...read() };
  for (const k of SETTINGS_FIELDS) next[k] = (values[k] ?? '').toString().trim();
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
  for (const k of SETTINGS_FIELDS) next[k] = (remoto.settings[k] ?? '').toString();
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
