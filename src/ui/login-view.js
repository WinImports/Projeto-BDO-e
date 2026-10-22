// Tela de Login / Autenticação: primeira tela quando não há sessão salva neste aparelho.
import { login, trocarSenha, currentUser, displayName, SENHA_MIN } from '../core/auth.js';
import { isSupabaseConfigured } from '../config.js';
import { icon } from './icons.js';
import { $, esc } from './dom.js';
import { toast } from './toast.js';

function modoTexto() {
  if (!isSupabaseConfigured()) return { kind: 'warn', text: 'Servidor não configurado: o acesso é feito com um usuário local deste aparelho.' };
  if (!navigator.onLine) return { kind: 'warn', text: 'Sem internet: o acesso usa a última senha confirmada neste aparelho (ou cria um usuário local).' };
  return { kind: 'info', text: 'Entre com o e-mail ou a matrícula funcional e a senha. Depois do primeiro acesso, o app entra mesmo sem sinal.' };
}

/** Mostra a tela de login e resolve com o usuário depois de entrar. */
export function showLogin() {
  return new Promise((resolve) => {
    document.body.classList.add('is-login');
    const root = document.createElement('div');
    root.className = 'login';
    root.id = 'login';
    const modo = modoTexto();
    root.innerHTML = `
      <form class="login__card card" id="login-form" novalidate aria-labelledby="login-title">
        <div class="login__brand">
          <div class="brand__mark" aria-hidden="true">BDO</div>
          <div>
            <h1 class="login__title" id="login-title">Entrar no BDO-e</h1>
            <p class="muted small">&amp; Inspeção Técnica</p>
          </div>
        </div>
        <div class="field">
          <label class="field__label-wrap" for="login-email"><span class="field__label">E-mail ou matrícula</span></label>
          <input id="login-email" name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="nome@empresa.com.br ou matrícula funcional">
        </div>
        <div class="field">
          <label class="field__label-wrap" for="login-senha"><span class="field__label">Senha</span></label>
          <input id="login-senha" name="senha" type="password" autocomplete="current-password" required minlength="6" placeholder="Mínimo de 6 caracteres">
        </div>
        <p class="login__error" id="login-error" role="alert" hidden></p>
        <button type="submit" class="btn btn--primary btn--lg btn--block" id="login-submit">${icon('user', 18)} Entrar</button>
        <p class="notice notice--${modo.kind} login__mode" data-login-mode>${esc(modo.text)}</p>
      </form>`;
    document.body.append(root);
    const form = $('#login-form', root);
    const erro = $('#login-error', root);
    const botao = $('#login-submit', root);
    $('#login-email', root).focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erro.hidden = true;
      botao.disabled = true;
      botao.innerHTML = '<span class="spinner" aria-hidden="true"></span> Entrando…';
      try {
        const { user, aviso } = await login(form.email.value, form.senha.value);
        root.remove();
        document.body.classList.remove('is-login');
        if (aviso) toast(aviso, 'info', 6000);
        resolve(user);
      } catch (err) {
        erro.textContent = err.message || 'Não foi possível entrar.';
        erro.hidden = false;
        botao.disabled = false;
        botao.innerHTML = `${icon('user', 18)} Entrar`;
      }
    });
  });
}

/**
 * Troca de senha obrigatória no 1º acesso (conta criada pelo gestor com senha inicial). Cobre o app até a
 * nova senha ser gravada no servidor; não há como pular. Sem internet, explica e espera a conexão.
 */
export function showTrocaSenha() {
  return new Promise((resolve) => {
    document.body.classList.add('is-login');
    const root = document.createElement('div');
    root.className = 'login';
    root.id = 'troca-senha';
    const user = currentUser();
    root.innerHTML = `
      <form class="login__card card" id="troca-senha-form" novalidate aria-labelledby="troca-senha-title">
        <div class="login__brand">
          <div class="brand__mark" aria-hidden="true">BDO</div>
          <div>
            <h1 class="login__title" id="troca-senha-title">Crie a sua senha</h1>
            <p class="muted small">${esc(displayName(user))} · primeiro acesso</p>
          </div>
        </div>
        <p class="notice notice--info login__mode">A senha inicial foi definida pelo gestor. Por segurança, crie agora uma senha só sua (mínimo de ${SENHA_MIN} caracteres).</p>
        <div class="field">
          <label class="field__label-wrap" for="nova-senha"><span class="field__label">Nova senha</span></label>
          <input id="nova-senha" name="nova" type="password" autocomplete="new-password" required minlength="${SENHA_MIN}">
        </div>
        <div class="field">
          <label class="field__label-wrap" for="nova-senha-2"><span class="field__label">Repita a nova senha</span></label>
          <input id="nova-senha-2" name="confirmacao" type="password" autocomplete="new-password" required minlength="${SENHA_MIN}">
        </div>
        <p class="login__error" id="troca-senha-erro" role="alert" hidden></p>
        <button type="submit" class="btn btn--primary btn--lg btn--block" id="troca-senha-submit">${icon('shield', 18)} Salvar nova senha</button>
      </form>`;
    document.body.append(root);
    const form = $('#troca-senha-form', root);
    const erro = $('#troca-senha-erro', root);
    const botao = $('#troca-senha-submit', root);
    $('#nova-senha', root).focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erro.hidden = true;
      botao.disabled = true;
      botao.innerHTML = '<span class="spinner" aria-hidden="true"></span> Salvando…';
      try {
        await trocarSenha(form.nova.value, form.confirmacao.value);
        root.remove();
        if (!document.getElementById('login') && !document.getElementById('licenca')) document.body.classList.remove('is-login');
        toast('Senha criada. Use a nova senha nos próximos acessos.', 'success', 6000);
        resolve();
      } catch (err) {
        erro.textContent = err.message || 'Não foi possível trocar a senha.';
        erro.hidden = false;
        botao.disabled = false;
        botao.innerHTML = `${icon('shield', 18)} Salvar nova senha`;
      }
    });
  });
}
