// Tela de ativação / bloqueio da licença: cobre o app (mesmo visual da tela de login) até a chave ser validada.
import { ativarLicenca, nomeDoAparelho, LICENCA } from '../core/licenca.js';
import { icon } from './icons.js';
import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { authShellHtml, authHeadHtml } from './auth-shell.js';

let aberta = null;

/**
 * Mostra a tela e resolve depois que uma chave for validada no servidor.
 * motivo: texto do bloqueio (vazio = primeira ativação); chave: a chave guardada, para tentar de novo.
 */
export function showLicenca({ motivo = '', chave = '' } = {}) {
  if (aberta) return aberta;
  aberta = new Promise((resolve) => {
    const tinhaLogin = document.body.classList.contains('is-login');
    document.body.classList.add('is-login');
    const root = document.createElement('div');
    root.className = 'login auth';
    root.id = 'licenca';
    const bloqueada = Boolean(motivo);
    const rotulo = bloqueada ? 'Validar licença' : 'Ativar licença';
    root.innerHTML = authShellHtml(`
      <form class="login__card" id="licenca-form" novalidate aria-labelledby="licenca-title">
        ${authHeadHtml('licenca-title', bloqueada ? 'Acesso bloqueado' : 'Ativar o BDO-e', 'Licença de uso deste aparelho')}
        <p class="login__error" id="licenca-erro" role="alert"${bloqueada ? '' : ' hidden'}>${esc(motivo)}</p>
        <div class="field">
          <label class="field__label-wrap" for="licenca-chave"><span class="field__label">Chave da licença</span></label>
          <input id="licenca-chave" name="chave" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
                 required placeholder="Digite a chave recebida" value="${esc(chave)}">
        </div>
        <button type="submit" class="btn btn--primary btn--lg btn--block" id="licenca-submit">${icon('shield', 18)} ${rotulo}</button>
        <p class="login__mode">${icon('info', 14)}<span>A ativação precisa de internet. Depois dela, o app abre sem conexão por até
          ${LICENCA.toleranciaOfflineDias} dias desde a última validação.</span></p>
        <p class="muted small" data-licenca-aparelho>Aparelho: ${esc(nomeDoAparelho())}</p>
      </form>`);
    document.body.append(root);
    const form = $('#licenca-form', root);
    const erro = $('#licenca-erro', root);
    const botao = $('#licenca-submit', root);
    const campo = $('#licenca-chave', root);
    campo.focus();
    campo.select();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      botao.disabled = true;
      botao.innerHTML = '<span class="spinner" aria-hidden="true"></span> Validando…';
      try {
        await ativarLicenca(campo.value);
        root.remove();
        // a tela de login pode estar aberta por baixo: ela continua controlando o bloqueio da rolagem
        if (!tinhaLogin && !document.getElementById('login')) document.body.classList.remove('is-login');
        toast('Licença validada.', 'success');
        aberta = null;
        resolve();
      } catch (err) {
        erro.textContent = err.message || 'Não foi possível validar a licença.';
        erro.hidden = false;
        botao.disabled = false;
        botao.innerHTML = `${icon('shield', 18)} ${rotulo}`;
        campo.focus();
      }
    });
  });
  return aberta;
}
