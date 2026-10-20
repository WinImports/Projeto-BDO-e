// Login do técnico: Supabase Auth (e-mail + senha) com fallback offline para usuário local.
//
// - Online e com Supabase configurado: confere no servidor (signInWithPassword). Deu certo, a sessão
//   do Supabase fica salva (core/supabase.js, renovada sozinha) e os envios levam o token do técnico;
//   também guarda neste aparelho um hash da senha (PBKDF2) para entrar depois sem sinal.
// - Sem internet (ou sem Supabase configurado): confere com o hash local; e-mail ainda sem conta
//   neste aparelho vira um usuário local.
// - A sessão fica no localStorage: o técnico não precisa entrar de novo a cada abertura do app.
//   "Sair" (Configurações) apaga só a sessão; as credenciais locais continuam para o login offline.

import { isSupabaseConfigured } from '../config.js';
import { getClient } from './supabase.js';

const SESSION_KEY = 'bdoe.auth.session';
const USERS_KEY = 'bdoe.auth.users';
const ITERACOES = 120_000;

const listeners = new Set();
export const onAuthChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const avisar = () => listeners.forEach((fn) => fn(currentUser()));

const ler = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const gravar = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export const normalizarEmail = (email) => String(email || '').trim().toLowerCase();
export const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarEmail(email));

/** Sessão atual ({ email, nome, userId, modo: 'supabase'|'offline'|'local', loggedAt }) ou null. */
export function currentUser() {
  const s = ler(SESSION_KEY, null);
  return s?.email ? s : null;
}

/** Nome para exibir: o do cadastro (Supabase) ou a parte do e-mail antes do @. */
export function displayName(user = currentUser()) {
  if (!user) return '';
  return user.nome || user.email.split('@')[0];
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashSenha(senha, salt) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERACOES }, chave, 256);
  return hex(bits);
}

async function guardarCredencial(email, senha, extra) {
  const users = ler(USERS_KEY, {});
  const salt = crypto.randomUUID();
  users[email] = { ...users[email], ...extra, salt, hash: await hashSenha(senha, salt), atualizadoEm: new Date().toISOString() };
  gravar(USERS_KEY, users);
}

function abrirSessao(user) {
  const sessao = { ...user, loggedAt: new Date().toISOString() };
  gravar(SESSION_KEY, sessao);
  avisar();
  return sessao;
}

/** Erro de rede (sem sinal, servidor fora): libera o login offline. Credencial errada não libera. */
const erroDeRede = (err) => !err?.status || err.status >= 500 || err.name === 'AuthRetryableFetchError';

async function loginSupabase(email, senha) {
  let client;
  try { client = getClient(); } catch (err) { throw Object.assign(err, { status: 0 }); }
  const { data, error } = await client.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  const meta = data.user?.user_metadata || {};
  return { email, userId: data.user?.id || '', nome: meta.nome || meta.full_name || meta.name || '' };
}

/**
 * Entra com e-mail e senha. Retorna { user, aviso } ou lança Error com mensagem para a tela.
 */
export async function login(emailBruto, senha) {
  const email = normalizarEmail(emailBruto);
  if (!emailValido(email)) throw new Error('Informe um e-mail válido.');
  if (!senha || senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');

  if (isSupabaseConfigured() && navigator.onLine) {
    try {
      const remoto = await loginSupabase(email, senha);
      await guardarCredencial(email, senha, { nome: remoto.nome, userId: remoto.userId, origem: 'supabase' });
      return { user: abrirSessao({ ...remoto, modo: 'supabase' }), aviso: '' };
    } catch (err) {
      if (!erroDeRede(err)) throw new Error('E-mail ou senha incorretos.');
      console.warn('[auth] servidor indisponível, usando login offline', err);
    }
  }

  const users = ler(USERS_KEY, {});
  const local = users[email];
  if (local) {
    if (await hashSenha(senha, local.salt) !== local.hash) throw new Error('E-mail ou senha incorretos.');
    const modo = local.origem === 'supabase' ? 'offline' : 'local';
    return {
      user: abrirSessao({ email, nome: local.nome || '', userId: local.userId || '', modo }),
      aviso: modo === 'offline' ? 'Sem conexão com o servidor: acesso liberado com a última senha confirmada neste aparelho.' : ''
    };
  }

  // primeiro acesso sem servidor: cria o usuário local deste aparelho
  await guardarCredencial(email, senha, { origem: 'local' });
  return {
    user: abrirSessao({ email, nome: '', userId: '', modo: 'local' }),
    // sem servidor configurado a própria tela de login já explica o usuário local
    aviso: isSupabaseConfigured() ? 'Sem internet: usuário local criado neste aparelho. Os relatórios continuam sendo enviados quando houver conexão.' : ''
  };
}

/** Sair: apaga só a sessão (as credenciais locais continuam para o próximo login offline). */
export function logout() {
  localStorage.removeItem(SESSION_KEY);
  // encerra a sessão do Supabase só neste aparelho (funciona offline: apaga o token guardado)
  try { getClient()?.auth.signOut({ scope: 'local' }).catch(() => {}); } catch { /* sem Supabase */ }
  avisar();
}
