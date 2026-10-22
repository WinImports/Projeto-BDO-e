// Aba "Gestão de Equipe" — só para o GESTOR do contrato (core/contratos.js › souGestor): cota de técnicos,
// cadastro de técnico (Edge Function create-technician: conta com senha inicial e troca obrigatória no
// 1º acesso) e ativar / desativar acessos (team_set_active). Tudo é conferido de novo no servidor (papel e
// cota, migração 001): esconder a aba é só interface. Precisa de internet.
import { icon } from './icons.js';
import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { confirmDialog } from './confirm.js';
import { getClient } from '../core/supabase.js';
import { isSupabaseConfigured } from '../config.js';
import { contratosGeridos } from '../core/contratos.js';
import { SENHA_MIN } from '../core/auth.js';

export const AVISO_COTA = 'Limite de técnicos liberados atingido. Entre em contato com o Master para ampliar a licença.';

/** Mensagem de erro do servidor (as funções do banco e a Edge Function já respondem em português). */
async function mensagemDe(err) {
  try {
    const corpo = await err?.context?.json?.(); // FunctionsHttpError: corpo da resposta da Edge Function
    if (corpo?.erro) return corpo.erro;
  } catch { /* corpo não é JSON */ }
  if (err?.name === 'FunctionsFetchError' || /Failed to fetch|NetworkError|Load failed/i.test(err?.message || '')) {
    return 'Sem conexão com o servidor. Tente de novo com internet.';
  }
  if (err?.name === 'FunctionsRelayError' || /not found|404/i.test(err?.message || '')) {
    return 'Cadastro indisponível: a função create-technician ainda não foi publicada no Supabase.';
  }
  return err?.message || 'Não foi possível concluir.';
}

/** Senha inicial legível (sem 0/O, 1/l) para o gestor passar ao técnico. */
export function gerarSenha(tamanho = 10) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const n = crypto.getRandomValues(new Uint32Array(tamanho));
  return Array.from(n, (x) => letras[x % letras.length]).join('');
}

const FUNCAO = { gestor: 'Gestor', tecnico: 'Técnico' };

export class EquipeView {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'equipe';
    this.contratoId = '';
    this.equipe = null;
    this.erro = '';
    this.carregando = false;
    this.enviando = false;
    this.root.addEventListener('click', (e) => this.handleClick(e));
    this.root.addEventListener('change', (e) => {
      if (e.target.matches('[data-equipe-contrato]')) { this.contratoId = e.target.value; this.refresh(); }
    });
    this.root.addEventListener('submit', (e) => { e.preventDefault(); this.cadastrar(e.target); });
  }

  podeUsar() {
    return isSupabaseConfigured() && navigator.onLine && Boolean(this.contratoId);
  }

  async rpc(nome, args) {
    const { data, error } = await getClient().rpc(nome, args);
    if (error) throw error;
    return data;
  }

  async refresh() {
    const contratos = contratosGeridos();
    if (!contratos.some((c) => c.id === this.contratoId)) this.contratoId = contratos[0]?.id || '';
    this.equipe = null;
    this.erro = '';
    if (!this.podeUsar()) { this.render(); return; }
    this.carregando = true;
    this.render();
    try {
      this.equipe = await this.rpc('team_list', { p_contrato_id: this.contratoId });
    } catch (err) {
      this.erro = await mensagemDe(err);
    }
    this.carregando = false;
    this.render();
  }

  cota() {
    const e = this.equipe;
    if (!e) return null;
    const max = Number(e.max_technicians) || 0;
    const ativos = Number(e.tecnicos_ativos) || 0;
    return { max, ativos, cheia: ativos >= max };
  }

  render() {
    const contratos = contratosGeridos();
    const cota = this.cota();
    const bloqueado = !this.podeUsar() || this.carregando || this.enviando || !cota || cota.cheia;
    const aviso = !isSupabaseConfigured() ? 'Configure o servidor (Configurações › Servidor) para gerenciar a equipe.'
      : !navigator.onLine ? 'Sem internet: a gestão de equipe precisa de conexão com o servidor.'
        : !contratos.length ? 'Você não é gestor de nenhum contrato.' : '';
    const membros = this.equipe?.membros || [];

    this.root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>Gestão de Equipe</h2>
          <p class="muted">Cadastre os técnicos do contrato e controle quem tem acesso ao app.</p>
        </div>
      </div>
      ${aviso ? `<div class="notice notice--warn" data-equipe-aviso>${esc(aviso)}</div>` : ''}
      ${this.erro ? `<div class="notice notice--error" role="alert" data-equipe-erro>${esc(this.erro)}</div>` : ''}

      <section class="card form-section">
        <header class="form-section__head">
          <span class="form-section__icon">${icon('users', 20)}</span>
          <div class="form-section__titles">
            <h3 class="form-section__title">Licenças de técnico</h3>
            <p class="form-section__hint">Contas de técnico ATIVAS no contrato (gestores não contam).</p>
          </div>
        </header>
        <div class="cota${cota?.cheia ? ' cota--cheia' : ''}" data-cota>
          <p class="cota__texto" data-cota-texto>${this.carregando ? 'Carregando…' : cota ? `Técnicos cadastrados: ${cota.ativos} de ${cota.max} liberados` : '—'}</p>
          <div class="cota__barra" aria-hidden="true"><span data-cota-barra></span></div>
          ${cota?.cheia ? `<p class="notice notice--warn" data-cota-aviso>${esc(AVISO_COTA)}</p>` : ''}
        </div>
      </section>

      <form class="card form-section" data-equipe-form novalidate>
        <header class="form-section__head">
          <span class="form-section__icon">${icon('user', 20)}</span>
          <div class="form-section__titles">
            <h3 class="form-section__title">Cadastrar técnico</h3>
            <p class="form-section__hint">O técnico entra com a matrícula ou o e-mail e a senha inicial; no primeiro acesso ele cria a própria senha.</p>
          </div>
        </header>
        <div class="form-grid">
          <div class="field span-6"><label class="field__label-wrap" for="eq-nome"><span class="field__label">Nome Completo<span class="req">*</span></span></label>
            <input id="eq-nome" name="nome" type="text" autocomplete="off" required></div>
          <div class="field span-3"><label class="field__label-wrap" for="eq-matricula"><span class="field__label">Matrícula Funcional<span class="req">*</span></span></label>
            <input id="eq-matricula" name="matricula" type="text" autocomplete="off" autocapitalize="characters" required></div>
          <div class="field span-3"><label class="field__label-wrap" for="eq-contrato"><span class="field__label">Contrato<span class="req">*</span></span></label>
            <select id="eq-contrato" name="contrato" data-equipe-contrato${contratos.length ? '' : ' disabled'}>
              ${contratos.map((c) => `<option value="${esc(c.id)}"${c.id === this.contratoId ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}
            </select></div>
          <div class="field span-6"><label class="field__label-wrap" for="eq-email"><span class="field__label">E-mail<span class="req">*</span></span></label>
            <input id="eq-email" name="email" type="email" inputmode="email" autocomplete="off" required></div>
          <div class="field span-6"><label class="field__label-wrap" for="eq-senha"><span class="field__label">Senha Inicial<span class="req">*</span></span></label>
            <div class="input-acao">
              <input id="eq-senha" name="senha" type="text" autocomplete="off" spellcheck="false" minlength="${SENHA_MIN}" required>
              <button type="button" class="btn btn--ghost btn--sm" data-action="gerar-senha">${icon('refresh', 15)} Gerar</button>
            </div>
            <small class="field__hint">Mínimo de ${SENHA_MIN} caracteres. Passe ao técnico junto com a matrícula.</small></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn--primary" id="eq-cadastrar"${bloqueado ? ' disabled' : ''}>
            ${this.enviando ? '<span class="spinner" aria-hidden="true"></span> Cadastrando…' : `${icon('plus', 17)} Cadastrar técnico`}
          </button>
        </div>
      </form>

      <section class="card form-section">
        <header class="form-section__head">
          <span class="form-section__icon">${icon('listChecks', 20)}</span>
          <div class="form-section__titles"><h3 class="form-section__title">Equipe do contrato</h3></div>
        </header>
        ${membros.length ? `
          <div class="table-wrap"><table class="grid-table equipe-tabela" data-equipe-lista>
            <thead><tr><th>Nome</th><th>Matrícula</th><th>E-mail</th><th>Função</th><th>Acesso</th><th></th></tr></thead>
            <tbody>${membros.map((m) => `
              <tr data-membro="${esc(m.id)}">
                <td>${esc(m.nome || '—')}</td>
                <td>${esc(m.matricula || '—')}</td>
                <td>${esc(m.email)}</td>
                <td>${esc(FUNCAO[m.role] || m.role)}</td>
                <td><span class="status status--${m.ativo ? 'sent' : 'error'}" data-membro-status>${m.ativo ? 'Ativo' : 'Desativado'}</span></td>
                <td>${m.role === 'tecnico' ? `<button type="button" class="btn btn--ghost btn--sm" data-action="${m.ativo ? 'desativar' : 'ativar'}" data-id="${esc(m.id)}"${this.podeUsar() ? '' : ' disabled'}>${m.ativo ? 'Desativar' : 'Ativar'}</button>` : ''}</td>
              </tr>`).join('')}</tbody>
          </table></div>` : `<p class="muted">${this.carregando ? 'Carregando…' : 'Nenhum membro cadastrado.'}</p>`}
      </section>`;

    const barra = $('[data-cota-barra]', this.root);
    if (barra) barra.style.width = cota && cota.max ? `${Math.min(100, Math.round((cota.ativos / cota.max) * 100))}%` : '0%';
  }

  async cadastrar(form) {
    const corpo = {
      name: form.nome.value.trim(),
      matricula: form.matricula.value.trim(),
      email: form.email.value.trim(),
      contrato_id: this.contratoId,
      password: form.senha.value
    };
    const faltando = !corpo.name ? 'Informe o nome completo.' : !corpo.matricula ? 'Informe a matrícula funcional.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corpo.email) ? 'Informe um e-mail válido.'
        : corpo.password.length < SENHA_MIN ? `A senha inicial precisa ter pelo menos ${SENHA_MIN} caracteres.` : '';
    if (faltando) return toast(faltando, 'error');
    const valores = { ...corpo };
    this.enviando = true;
    this.render();
    let resultado = null;
    try {
      const { data, error } = await getClient().functions.invoke('create-technician', { body: corpo });
      if (error) throw error;
      resultado = data;
    } catch (err) {
      this.enviando = false;
      this.render();
      this.preencher(valores);
      return toast(await mensagemDe(err), 'error', 8000);
    }
    this.enviando = false;
    if (resultado?.equipe) this.equipe = resultado.equipe;
    this.render();
    toast(resultado?.conta_criada === false
      ? `${valores.name} foi vinculado ao contrato. Ele já tinha conta: entra com a senha que já usa.`
      : `${valores.name} foi cadastrado. Passe a ele a matrícula ${valores.matricula} e a senha inicial; no primeiro acesso ele cria a própria senha.`, 'success', 9000);
  }

  /** Devolve ao formulário o que foi digitado (o render refaz o HTML). */
  preencher(v) {
    const f = $('[data-equipe-form]', this.root);
    if (!f) return;
    f.nome.value = v.name; f.matricula.value = v.matricula; f.email.value = v.email; f.senha.value = v.password;
  }

  async alterarAcesso(id, ativo) {
    const m = (this.equipe?.membros || []).find((x) => x.id === id);
    if (!m) return;
    const ok = await confirmDialog({
      title: ativo ? 'Reativar o acesso?' : 'Desativar o acesso?',
      message: ativo
        ? `${m.nome || m.email} volta a ter acesso aos dados do contrato e ocupa uma das licenças de técnico.`
        : `${m.nome || m.email} deixa de ver os relatórios do contrato e libera uma licença de técnico. Os relatórios já enviados por ele continuam no histórico.`,
      confirmLabel: ativo ? 'Reativar' : 'Desativar', danger: !ativo, iconName: 'user'
    });
    if (!ok) return;
    try {
      this.equipe = await this.rpc('team_set_active', { p_member_id: id, p_ativo: ativo });
      this.render();
      toast(ativo ? 'Acesso reativado.' : 'Acesso desativado.', 'success');
    } catch (err) {
      toast(await mensagemDe(err), 'error', 8000);
    }
  }

  handleClick(e) {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'gerar-senha') {
      const campo = $('#eq-senha', this.root);
      campo.value = gerarSenha();
      campo.select();
    }
    if (b.dataset.action === 'desativar') this.alterarAcesso(b.dataset.id, false);
    if (b.dataset.action === 'ativar') this.alterarAcesso(b.dataset.id, true);
  }
}
