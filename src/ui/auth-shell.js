// Moldura comum das telas de acesso (licença, login e troca de senha): painel da marca à esquerda
// (no celular, só o logo no topo) e o formulário à direita, com a versão do app no rodapé.
import { APP_VERSAO } from '../config.js';
import { icon } from './icons.js';
import { esc } from './dom.js';

const DESTAQUES = [
  ['clipboard', 'BDO-e, Visita Técnica e Relatório de Execução'],
  ['save', 'Funciona sem internet: tudo fica salvo no aparelho'],
  ['fileText', 'PDF e Word prontos para o cliente']
];

/** Painel da marca (computador) — ilustração técnica discreta da cabeça de poço ao fundo. */
function heroHtml() {
  return `
    <aside class="auth__hero" aria-hidden="true">
      <div class="auth__hero-top">
        <img class="auth__hero-logo" src="./icons/logo.svg" alt="">
        <div>
          <p class="auth__hero-name">BDO-e</p>
          <p class="auth__hero-tag">Boletim Diário Operacional e Inspeção Técnica</p>
        </div>
      </div>
      <ul class="auth__hero-list">
        ${DESTAQUES.map(([ic, t]) => `<li>${icon(ic, 18)}<span>${esc(t)}</span></li>`).join('')}
      </ul>
      <p class="auth__hero-foot">Inspeção de cabeça de poço · Petróleo e gás</p>
    </aside>`;
}

/**
 * Monta a tela: root recebe class "login auth" (o id e o bloqueio de rolagem continuam com quem chama).
 * formHtml é o <form> completo (com o id que os testes usam).
 */
export function authShellHtml(formHtml) {
  return `
    <div class="auth__frame">
      ${heroHtml()}
      <div class="auth__panel">
        <div class="auth__mobile-brand" aria-hidden="true">
          <img src="./icons/logo.svg" alt="">
          <span><strong>BDO-e</strong><small>Inspeção Técnica</small></span>
        </div>
        ${formHtml}
        <p class="auth__version">BDO-e · versão ${esc(APP_VERSAO)}</p>
      </div>
    </div>`;
}

/** Cabeçalho do cartão do formulário (título + subtítulo). */
export function authHeadHtml(id, titulo, sub) {
  return `
    <div class="auth__head">
      <h1 class="login__title" id="${esc(id)}">${esc(titulo)}</h1>
      ${sub ? `<p class="muted">${esc(sub)}</p>` : ''}
    </div>`;
}

/** Botão de mostrar / ocultar a senha (liga no input logo antes dele, dentro de .password-field). */
export function ligarMostrarSenha(root) {
  root.querySelectorAll('[data-ver-senha]').forEach((btn) => {
    const input = btn.parentElement.querySelector('input');
    btn.addEventListener('click', () => {
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(mostrar));
      btn.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
      btn.innerHTML = icon(mostrar ? 'eyeOff' : 'eye', 18);
      input.focus();
    });
  });
}

/** HTML do botão (colocar logo após o input, dentro de <div class="password-field">). */
export const botaoVerSenha = () =>
  `<button type="button" class="password-field__btn" data-ver-senha aria-label="Mostrar senha" aria-pressed="false">${icon('eye', 18)}</button>`;
