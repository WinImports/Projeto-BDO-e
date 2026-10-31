// Tela de Login / Autenticação: primeira tela quando não há sessão salva neste aparelho.
import { login, trocarSenha, currentUser, displayName, SENHA_MIN } from '../core/auth.js';
import { isSupabaseConfigured } from '../config.js';
import { icon } from './icons.js';
import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { authShellHtml, authHeadHtml, botaoVerSenha, ligarMostrarSenha } from './auth-shell.js';

// Linha discreta abaixo do botão Entrar (sem caixa de alerta: é informação, não erro)
function modoTexto() {
  if (!isSupabaseConfigured()) return 'Modo offline: o acesso usa um usuário local deste aparelho.';
  if (!navigator.onLine) return 'Sem internet: o acesso usa a última senha confirmada neste aparelho.';
  return 'Depois do primeiro acesso, o app entra mesmo sem sinal.';
}

const AJUDA_SENHA = 'Para redefinir a senha, fale com o gestor do seu contrato ou com o administrador do sistema. Por segurança, a senha não é enviada por mensagem.';

/** Mostra a tela de login e resolve com o usuário depois de entrar. */
export function showLogin() {
  return new Promise((resolve) => {
    document.body.classList.add('is-login');
    const root = document.createElement('div');
    root.className = 'login auth';
    root.id = 'login';
    root.innerHTML = authShellHtml(`
      <form class="login__card" id="login-form" novalidate aria-labelledby="login-title">
        ${authHeadHtml('login-title', 'Entrar', 'Acesse com o e-mail ou a matrícula funcional.')}
        <div class="field">
          <label class="field__label-wrap" for="login-email"><span class="field__label">E-mail ou matrícula</span></label>
          <input id="login-email" name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="nome@empresa.com.br ou matrícula">
        </div>
        <div class="field">
          <div class="auth__label-row">
            <label class="field__label-wrap" for="login-senha"><span class="field__label">Senha</span></label>
            <button type="button" class="link-btn auth__forgot" data-esqueci>Esqueci minha senha</button>
          </div>
          <div class="password-field">
            <input id="login-senha" name="senha" type="password" autocomplete="current-password" required minlength="6" placeholder="Sua senha">
            ${botaoVerSenha()}
          </div>
        </div>
        <p class="notice notice--info auth__help" data-ajuda-senha hidden>${esc(AJUDA_SENHA)}</p>
        <p class="login__error" id="login-error" role="alert" hidden></p>
        <button type="submit" class="btn btn--primary btn--lg btn--block" id="login-submit">Entrar</button>
        <p class="login__mode" data-login-mode>${icon('info', 14)}<span>${esc(modoTexto())}</span></p>
      </form>`);
    document.body.append(root);
    ligarMostrarSenha(root);
    $('[data-esqueci]', root).addEventListener('click', () => {
      const ajuda = $('[data-ajuda-senha]', root);
      ajuda.hidden = !ajuda.hidden;
    });
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
        botao.textContent = 'Entrar';
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
    root.className = 'login auth';
    root.id = 'troca-senha';
    const user = currentUser();
    root.innerHTML = authShellHtml(`
      <form class="login__card" id="troca-senha-form" novalidate aria-labelledby="troca-senha-title">
        ${authHeadHtml('troca-senha-title', 'Crie a sua senha', `${displayName(user)} · primeiro acesso`)}
        <p class="notice notice--info auth__help">A senha que você recebeu é provisória. Por segurança, crie agora uma senha só sua (mínimo de ${SENHA_MIN} caracteres).</p>
        <div class="field">
          <label class="field__label-wrap" for="nova-senha"><span class="field__label">Nova senha</span></label>
          <div class="password-field">
            <input id="nova-senha" name="nova" type="password" autocomplete="new-password" required minlength="${SENHA_MIN}" placeholder="Mínimo de ${SENHA_MIN} caracteres">
            ${botaoVerSenha()}
          </div>
        </div>
        <div class="field">
          <label class="field__label-wrap" for="nova-senha-2"><span class="field__label">Repita a nova senha</span></label>
          <div class="password-field">
            <input id="nova-senha-2" name="confirmacao" type="password" autocomplete="new-password" required minlength="${SENHA_MIN}">
            ${botaoVerSenha()}
          </div>
        </div>
        <p class="login__error" id="troca-senha-erro" role="alert" hidden></p>
        <button type="submit" class="btn btn--primary btn--lg btn--block" id="troca-senha-submit">${icon('shield', 18)} Salvar nova senha</button>
      </form>`);
    document.body.append(root);
    ligarMostrarSenha(root);
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
