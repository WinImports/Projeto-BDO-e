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
  return {
    email, userId: data.user?.id || '', nome: meta.nome || meta.full_name || meta.name || '',
    matricula: meta.matricula || '',
    trocarSenha: meta.must_change_password === true // conta criada pelo gestor com senha inicial
  };
}

/** Matrícula funcional para comparar: só letras e números, em maiúsculas (igual ao servidor, _norm_matricula). */
export const normMatricula = (t) => String(t ?? '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');
const ehEmail = (t) => String(t || '').includes('@');

/** Erro do PostgREST (função do banco) — não é falta de rede. */
const erroDoBanco = (err) => Boolean(err?.code);

/**
 * Entra com e-mail OU matrícula funcional + senha. Retorna { user, aviso } ou lança Error com mensagem para a
 * tela. Matrícula: o banco confere a senha (login_matricula) e só então devolve o e-mail; o login no Supabase
 * Auth é feito com e-mail + senha daqui do aparelho. Sem internet, vale a matrícula de quem já entrou aqui.
 */
export async function login(identificador, senha) {
  const bruto = String(identificador || '').trim();
  if (!bruto) throw new Error('Informe o e-mail ou a matrícula.');
  if (!senha || senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
  return ehEmail(bruto) ? loginPorEmail(normalizarEmail(bruto), senha) : loginPorMatricula(bruto, senha);
}

async function loginPorMatricula(bruto, senha) {
  const mat = normMatricula(bruto);
  if (!mat) throw new Error('Matrícula inválida.');
  if (isSupabaseConfigured() && navigator.onLine) {
    let resp = null;
    try {
      const { data, error } = await getClient().rpc('login_matricula', { p_matricula: bruto, p_senha: senha });
      if (error) throw error;
      resp = data || {};
    } catch (err) {
      if (erroDoBanco(err)) throw new Error('Não foi possível entrar pela matrícula agora. Tente com o e-mail.');
      console.warn('[auth] servidor indisponível, login offline pela matrícula', err);
    }
    if (resp) {
      if (resp.bloqueado) throw new Error('Muitas tentativas com esta matrícula. Aguarde 15 minutos ou entre com o e-mail.');
      if (!resp.ok || !resp.email) throw new Error('Matrícula ou senha incorretos.');
      return loginPorEmail(normalizarEmail(resp.email), senha, { matricula: bruto, criarLocal: false });
    }
  }
  // sem internet: quem já entrou neste aparelho com esta matrícula
  const users = ler(USERS_KEY, {});
  const email = Object.keys(users).find((e) => users[e].matricula && normMatricula(users[e].matricula) === mat);
  if (!email) {
    throw new Error(isSupabaseConfigured()
      ? 'Sem conexão: para entrar pela matrícula sem internet, entre uma vez com internet neste aparelho (ou use o e-mail).'
      : 'Para entrar pela matrícula é preciso o servidor configurado. Entre com o e-mail.');
  }
  return loginPorEmail(email, senha, { matricula: bruto, criarLocal: false, semServidor: true });
}

async function loginPorEmail(email, senha, { matricula = '', criarLocal = true, semServidor = false } = {}) {
  if (!emailValido(email)) throw new Error('Informe um e-mail válido.');
  const errado = matricula ? 'Matrícula ou senha incorretos.' : 'E-mail ou senha incorretos.';

  if (!semServidor && isSupabaseConfigured() && navigator.onLine) {
    try {
      const remoto = await loginSupabase(email, senha);
      const mat = remoto.matricula || matricula || ler(USERS_KEY, {})[email]?.matricula || '';
      await guardarCredencial(email, senha, { nome: remoto.nome, userId: remoto.userId, origem: 'supabase', matricula: mat, trocarSenha: remoto.trocarSenha });
      return { user: abrirSessao({ ...remoto, matricula: mat, modo: 'supabase' }), aviso: '' };
    } catch (err) {
      if (!erroDeRede(err)) throw new Error(errado);
      console.warn('[auth] servidor indisponível, usando login offline', err);
    }
  }

  const users = ler(USERS_KEY, {});
  const local = users[email];
  if (local) {
    if (await hashSenha(senha, local.salt) !== local.hash) throw new Error(errado);
    const modo = local.origem === 'supabase' ? 'offline' : 'local';
    return {
      user: abrirSessao({ email, nome: local.nome || '', userId: local.userId || '', matricula: local.matricula || '', trocarSenha: local.trocarSenha === true, modo }),
      aviso: modo === 'offline' ? 'Sem conexão com o servidor: acesso liberado com a última senha confirmada neste aparelho.' : ''
    };
  }
  if (!criarLocal) throw new Error(errado);

  // primeiro acesso sem servidor: cria o usuário local deste aparelho
  await guardarCredencial(email, senha, { origem: 'local' });
  return {
    user: abrirSessao({ email, nome: '', userId: '', modo: 'local' }),
    // sem servidor configurado a própria tela de login já explica o usuário local
    aviso: isSupabaseConfigured() ? 'Sem internet: usuário local criado neste aparelho. Os relatórios continuam sendo enviados quando houver conexão.' : ''
  };
}

export const SENHA_MIN = 8;

/**
 * Troca de senha obrigatória no 1º acesso (conta criada pelo gestor com senha inicial): grava a nova senha no
 * Supabase Auth, apaga o aviso must_change_password e atualiza a senha do login offline. Precisa de internet.
 */
export async function trocarSenha(nova, confirmacao) {
  const user = currentUser();
  if (!user) throw new Error('Entre de novo para trocar a senha.');
  if (!nova || nova.length < SENHA_MIN) throw new Error(`A nova senha precisa ter pelo menos ${SENHA_MIN} caracteres.`);
  if (nova !== confirmacao) throw new Error('A confirmação não é igual à nova senha.');
  if (!navigator.onLine || !isSupabaseConfigured()) throw new Error('Conecte-se à internet para criar a sua senha.');
  const { error } = await getClient().auth.updateUser({ password: nova, data: { must_change_password: false } });
  if (error) {
    throw new Error(/different from the old|same as the old|should be different/i.test(error.message || '')
      ? 'A nova senha precisa ser diferente da senha inicial.'
      : `Não foi possível trocar a senha: ${error.message}`);
  }
  await guardarCredencial(user.email, nova, { trocarSenha: false });
  return abrirSessao({ ...user, trocarSenha: false });
}

/** Sair: apaga só a sessão (as credenciais locais continuam para o próximo login offline). */
export function logout() {
  localStorage.removeItem(SESSION_KEY);
  // encerra a sessão do Supabase só neste aparelho (funciona offline: apaga o token guardado)
  try { getClient()?.auth.signOut({ scope: 'local' }).catch(() => {}); } catch { /* sem Supabase */ }
  avisar();
}
