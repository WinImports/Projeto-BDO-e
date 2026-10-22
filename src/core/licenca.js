// Licenciamento do app pelo projeto Supabase central de licenças (winappos-licensing) — separado do
// banco dos relatórios (config.js). Só a função pública validate_license é usada, pela chave publishable.
//
// - Ativação: o cliente digita a chave; validate_license registra este aparelho (device_id fixo =
//   getDeviceId(), o mesmo id do aparelho usado no resto do app) e devolve { valid, reason, expires_at, max_devices }.
// - A cada abertura: valida de novo. valid=false bloqueia o app e mostra o motivo (reason, em português).
// - Sem internet / servidor fora: libera por até 7 dias desde a última validação ok (e só até expires_at).
//   Uma resposta valid=false apaga a última validação ok: não dá para escapar do bloqueio ficando offline.
// - Relógio do aparelho voltado para trás (antes da última validação/uso) não ganha prazo extra.
//
// Observação: em um app JavaScript a trava roda no aparelho; ela impede o uso normal sem licença, mas a
// proteção definitiva dos dados continua no servidor (RLS/RPCs).

import { getDeviceId } from './settings.js';

export const LICENCA = {
  url: 'https://gdqkontotzaexknuprac.supabase.co',
  chavePublica: 'sb_publishable_a6VfOUiGfOm492OZFgN7yg_P4rdAVnY',
  appCode: 'bdo-e',
  toleranciaOfflineDias: 7,
  timeoutMs: 10_000
};

const KEY = 'bdoe.licenca';
const DIA = 864e5;
const FOLGA_RELOGIO = 5 * 60_000; // diferença aceitável de relógio entre aberturas

/** Licença guardada: { chave, ativadaEm, ultimaValidacao, ultimoUso, expiraEm, maxDispositivos, motivo } ou null. */
export function licencaLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

function gravar(dados) {
  localStorage.setItem(KEY, JSON.stringify(dados));
}

/**
 * A trava vale sempre no app instalado e no site publicado. Fica desligada só no Electron NÃO empacotado
 * com BDOE_LICENCA=off (testes; ver main.js) e no navegador em localhost (desenvolvimento/testes do PWA).
 */
export function licenciamentoAtivo() {
  if (window.desktop?.licencaDesligada) return false;
  if (!window.desktop && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return false;
  return true;
}

/** Nome legível do aparelho para o painel de licenças (ex.: "Windows · BDO-e Desktop", "iPhone · Navegador"). */
export function nomeDoAparelho() {
  const ua = navigator.userAgent || '';
  const so = /iPhone/.test(ua) ? 'iPhone'
    : /iPad|Macintosh.*Mobile/.test(ua) ? 'iPad'
      : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android (celular)' : 'Android (tablet)')
        : /Windows/.test(ua) ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
            : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  const tipo = window.desktop?.isElectron ? 'BDO-e Desktop'
    : window.matchMedia?.('(display-mode: standalone)').matches ? 'App (PWA)' : 'Navegador';
  return `${so} · ${tipo}`;
}

const erroDeRede = (msg) => Object.assign(new Error(msg), { rede: true });

/**
 * Chama validate_license. Devolve { valid, reason, expires_at, max_devices }.
 * Sem conexão, tempo esgotado ou erro do servidor → lança Error com rede: true (vale a tolerância offline).
 */
export async function validarNoServidor(chave) {
  if (!navigator.onLine) throw erroDeRede('Sem internet.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LICENCA.timeoutMs);
  let res;
  try {
    res = await fetch(`${LICENCA.url}/rest/v1/rpc/validate_license`, {
      method: 'POST',
      headers: { apikey: LICENCA.chavePublica, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_app_code: LICENCA.appCode, p_license_key: chave, p_device_id: getDeviceId(), p_device_name: nomeDoAparelho() }),
      cache: 'no-store',
      signal: ctrl.signal
    });
  } catch {
    throw erroDeRede('Sem conexão com o servidor de licenças.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw erroDeRede(`Servidor de licenças indisponível (HTTP ${res.status}).`);
  let corpo;
  try { corpo = await res.json(); } catch { throw erroDeRede('Resposta inválida do servidor de licenças.'); }
  const r = (Array.isArray(corpo) ? corpo[0] : corpo) || {};
  return { valid: r.valid === true, reason: String(r.reason || ''), expires_at: r.expires_at || null, max_devices: r.max_devices ?? null };
}

const brData = (iso) => new Date(iso).toLocaleDateString('pt-BR');

/**
 * Situação SEM consultar o servidor (sem internet): { status: 'offline', diasRestantes } quando ainda está
 * dentro dos 7 dias da última validação ok; senão { status: 'bloqueado' | 'sem-licenca', motivo }.
 */
export function avaliarSemRede(local = licencaLocal(), agora = Date.now()) {
  if (!local?.chave) return { status: 'sem-licenca', motivo: '' };
  const ok = Date.parse(local.ultimaValidacao || '');
  if (!ok) return { status: 'bloqueado', motivo: local.motivo || 'A licença precisa ser validada com internet.' };
  const ultimoUso = Math.max(ok, Date.parse(local.ultimoUso || '') || 0);
  if (agora < ultimoUso - FOLGA_RELOGIO) {
    return { status: 'bloqueado', motivo: 'A data e a hora do aparelho estão anteriores ao último uso do app. Acerte o relógio ou conecte-se à internet para validar a licença.' };
  }
  if (local.expiraEm && Date.parse(local.expiraEm) <= agora) {
    return { status: 'bloqueado', motivo: `A licença venceu em ${brData(local.expiraEm)}. Conecte-se à internet para validar a renovação.` };
  }
  const restante = ok + LICENCA.toleranciaOfflineDias * DIA - agora;
  if (restante <= 0) {
    return { status: 'bloqueado', motivo: `O app está há mais de ${LICENCA.toleranciaOfflineDias} dias sem validar a licença. Conecte-se à internet para continuar.` };
  }
  return { status: 'offline', diasRestantes: Math.ceil(restante / DIA) };
}

/** Marca o uso do app agora (protege a tolerância offline contra relógio voltado para trás). */
function registrarUso(local, agora) {
  const anterior = Date.parse(local.ultimoUso || '') || 0;
  if (agora > anterior) gravar({ ...local, ultimoUso: new Date(agora).toISOString() });
}

/**
 * Verificação na abertura (e ao voltar a internet). Resultado:
 *   { status: 'ok' }                         validada no servidor agora
 *   { status: 'offline', diasRestantes }     servidor inacessível, dentro da tolerância
 *   { status: 'bloqueado', motivo }          valid=false, tolerância esgotada, vencida ou relógio adulterado
 *   { status: 'sem-licenca' }                nenhuma chave neste aparelho (primeira abertura)
 */
export async function verificarLicenca(agora = Date.now()) {
  const local = licencaLocal();
  if (!local?.chave) return { status: 'sem-licenca', motivo: '' };
  try {
    const r = await validarNoServidor(local.chave);
    const quando = new Date().toISOString();
    if (r.valid) {
      gravar({ ...local, ultimaValidacao: quando, ultimoUso: quando, expiraEm: r.expires_at, maxDispositivos: r.max_devices, motivo: '' });
      return { status: 'ok' };
    }
    const motivo = r.reason || 'Licença inválida.';
    gravar({ ...local, ultimaValidacao: null, motivo, bloqueadaEm: quando });
    return { status: 'bloqueado', motivo };
  } catch (err) {
    if (!err.rede) throw err;
    const situacao = avaliarSemRede(local, agora);
    if (situacao.status === 'offline') registrarUso(local, agora);
    return situacao;
  }
}

/** Ativa (ou troca) a chave deste aparelho. Precisa de internet. Lança Error com a mensagem para a tela. */
export async function ativarLicenca(chaveDigitada) {
  const chave = String(chaveDigitada || '').trim().replace(/\s+/g, '');
  if (!chave) throw new Error('Digite a chave da licença.');
  let r;
  try {
    r = await validarNoServidor(chave);
  } catch (err) {
    if (err.rede) throw new Error('Sem conexão com o servidor de licenças. A ativação precisa de internet.');
    throw err;
  }
  if (!r.valid) throw new Error(r.reason || 'Chave de licença inválida.');
  const quando = new Date().toISOString();
  const anterior = licencaLocal();
  gravar({
    chave,
    ativadaEm: anterior?.chave === chave ? anterior.ativadaEm || quando : quando,
    ultimaValidacao: quando,
    ultimoUso: quando,
    expiraEm: r.expires_at,
    maxDispositivos: r.max_devices,
    motivo: ''
  });
  return r;
}
