// Herança automática do BDO-e para a Visita Técnica e o Relatório de Execução.
// O BDO-e é o único lugar onde se escolhe o poço (busca na base, GPS e rotas); os outros relatórios
// recebem dele Poço, Locação/Campo, Data, Cliente, Contrato e as coordenadas (module.herdaDoBdo).
//
// BDO-e ativo = rascunho do BDO-e em andamento com poço informado; sem ele, o último BDO-e finalizado.
// Campo que o técnico alterou à mão não é sobrescrito: data._bdo guarda o último valor herdado e só
// campos vazios (ou ainda com esse valor) acompanham o BDO-e.

import { STORES, get, getAll } from './db.js';
import { ultimoPoco } from './pocos.js';

const vazio = (v) => v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
const igual = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

/** Dados do BDO-e ativo, ou null. */
export async function bdoAtivo() {
  const rascunho = await get(STORES.drafts, 'bdo');
  if (rascunho?.data?.poco) return { data: rascunho.data, origem: 'rascunho' };
  const finalizados = (await getAll(STORES.history, 'module')).filter((r) => r.module === 'bdo' && r.data?.poco);
  finalizados.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return finalizados[0] ? { data: finalizados[0].data, origem: 'finalizado' } : null;
}

/** Valor do BDO-e convertido para o tipo do campo de destino (data → data e hora mantém o horário). */
function converter(campo, valor, atual) {
  if (campo?.type === 'datetime' && /^\d{4}-\d{2}-\d{2}$/.test(valor || '')) {
    const hora = /T(\d{2}:\d{2})/.exec(atual || '')?.[1] || new Date().toTimeString().slice(0, 5);
    return `${valor}T${hora}`;
  }
  return valor;
}

/**
 * Copia os campos do BDO-e para `draft.data` (antes de montar o formulário).
 * Novo relatório: tudo o que o BDO-e tiver. Rascunho existente: só campos vazios ou ainda iguais ao
 * último valor herdado. Retorna a lista de rótulos preenchidos (para o aviso na tela).
 */
export function herdar(module, draft, bdo) {
  const mapa = module.herdaDoBdo;
  if (!mapa || !bdo?.data) return [];
  const campos = new Map(module.sections.flatMap((s) => s.fields).filter((f) => f.id).map((f) => [f.id, f]));
  const d = draft.data;
  const anterior = d._bdo || {};
  const herdado = {};
  const preenchidos = [];
  for (const [destino, origem] of Object.entries(mapa)) {
    // BDO-e com vários poços no dia ("FBM-89, FBM-12"): a Visita / Execução é do poço atual (o último)
    const valor = origem === 'poco' ? ultimoPoco(bdo.data[origem]) : bdo.data[origem];
    if (vazio(valor)) continue;
    const campo = campos.get(destino);
    const novo = converter(campo, valor, d[destino]);
    herdado[destino] = novo;
    const livre = draft.isNew || vazio(d[destino]) || igual(d[destino], anterior[destino]);
    if (!livre || igual(d[destino], novo)) continue;
    d[destino] = structuredClone(novo);
    if (campo?.label && campo.type !== 'geo') preenchidos.push(campo.label);
  }
  d._bdo = herdado;
  return preenchidos;
}
