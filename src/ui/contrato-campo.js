// Campo "Contrato" como lista dos contratos do usuário logado (core/contratos.js): usado no formulário
// dos relatórios e no "Contrato padrão" das Configurações.
import { opcoesContrato } from '../core/contratos.js';
import { esc } from './dom.js';

export const AVISO_SEM_CONTRATO = 'Nenhum contrato vinculado à sua conta. Peça ao administrador para cadastrar.';

/**
 * <select> com os contratos. attrs: atributos extras já escapados (ex.: data-field="contrato").
 * Sem contratos: desabilitado + aviso (o valor gravado, se houver, continua aparecendo e é mantido).
 */
export function contratoSelectHtml({ id, attrs = '', valor }) {
  const { opcoes, selecionado, vazio } = opcoesContrato(valor);
  return `<select id="${esc(id)}" ${attrs} data-contratos${vazio ? ' disabled aria-describedby="' + esc(id) + '-aviso"' : ''}>
      <option value="">${vazio ? '—' : 'Selecione o contrato…'}</option>
      ${opcoes.map((o) => `<option value="${esc(o.valor)}"${o.valor === selecionado ? ' selected' : ''}${o.extra ? ' data-contrato-extra' : ''}>${esc(o.valor)}${o.extra ? ' (não vinculado à sua conta)' : ''}</option>`).join('')}
    </select>${vazio ? `<small class="field__hint field__hint--warn" id="${esc(id)}-aviso" data-contratos-aviso>${esc(AVISO_SEM_CONTRATO)}</small>` : ''}`;
}
