// Configurações do sistema (empresa, contrato/cliente e técnico padrão).
// Fonte local: localStorage (disponível offline). Cópia no Supabase via rpc save_device_settings,
// enviada pela mesma rotina de sincronização dos relatórios (sync.js).

const KEY = 'bdoe.settings';
const DEVICE_KEY = 'bdoe.deviceId';

export const SETTINGS_FIELDS = [
  'empresa_nome', 'empresa_cnpj', 'empresa_logo',
  'cliente_padrao', 'contrato_padrao',
  'tecnico_nome', 'tecnico_matricula', 'tecnico_cargo'
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

/** Dados da empresa para cabeçalhos de relatório/PDF (null se não configurada). */
export function companyInfo() {
  const s = getSettings();
  if (!s.empresa_nome && !s.empresa_logo) return null;
  return { nome: s.empresa_nome, cnpj: s.empresa_cnpj, logo: s.empresa_logo };
}

/**
 * Envia as configurações pendentes. Só marca como sincronizado com HTTP 200/201
 * e o device_id devolvido pela função.
 */
export async function syncSettings(client) {
  const s = getSettings();
  if (!s.syncPending) return;
  const settings = Object.fromEntries(SETTINGS_FIELDS.map((k) => [k, s[k]]));
  const { data, error, status } = await client.rpc('save_device_settings', {
    p_device_id: getDeviceId(), p_settings: settings, p_updated_at: s.updatedAt
  });
  if (error) throw error;
  if ((status === 200 || status === 201) && data === getDeviceId()) markSynced(s.updatedAt);
  else throw new Error(`Servidor não confirmou as configurações (HTTP ${status})`);
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
