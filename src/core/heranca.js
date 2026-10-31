// Herança automática do BDO-e para a Visita Técnica e o Relatório de Execução.
// O BDO-e é o único lugar onde se escolhe o poço (busca na base, GPS e rotas); os outros relatórios
// recebem dele Poço, Locação/Campo, Data, Cliente, Contrato e as coordenadas (module.herdaDoBdo).
//
// BDO-e ativo = rascunho do BDO-e em andamento com poço informado; sem ele, o último BDO-e finalizado.
// Campo que o técnico alterou à mão não é sobrescrito: data._bdo guarda o último valor herdado e só
// campos vazios (ou ainda com esse valor) acompanham o BDO-e.

import { STORES, get, getAll } from './db.js';
import { ultimoPoco } from './pocos.js';
import { meusContratos, normContrato } from './contratos.js';

const vazio = (v) => v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
const igual = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

// Depois de finalizar uma Visita / Execução, o formulário novo vem LIMPO: o BDO-e que ela usou não é herdado
// de novo (um BDO-e mais novo ou com outro poço, sim). Guardado por relatório: { visita_tecnica: '<uniqueId>|<poço>' }.
const KEY_USADO = 'bdoe.heranca.usado';
const lerUsados = () => { try { return JSON.parse(localStorage.getItem(KEY_USADO)) || {}; } catch { return {}; } };

/** BDO-e + poço atual: o mesmo BDO-e com outro poço no dia (vários poços) volta a ser herdado. */
const chaveHeranca = (bdo) => `${bdo.uniqueId}|${ultimoPoco(bdo.data?.poco || '')}`;

/** Marca o BDO-e herdado pelo relatório finalizado (o próximo formulário deste relatório não o herda). */
export function marcarHerancaUsada(moduleId, bdoId) {
  if (!moduleId || !bdoId) return;
  try { localStorage.setItem(KEY_USADO, JSON.stringify({ ...lerUsados(), [moduleId]: bdoId })); } catch { /* sem espaço */ }
}

/**
 * Dados do BDO-e ativo, ou null. Com `moduleId` (relatório novo), o BDO-e já usado por um relatório
 * finalizado deste tipo não conta: o formulário novo fica limpo até haver outro BDO-e.
 */
export async function bdoAtivo(moduleId = null) {
  const rascunho = await get(STORES.drafts, 'bdo');
  let atual = null;
  if (rascunho?.data?.poco) atual = { data: rascunho.data, origem: 'rascunho', uniqueId: rascunho.uniqueId };
  else {
    // BDO-e de outro contrato (conta anterior neste aparelho) não é herdado
    const meus = new Set(meusContratos().map(normContrato));
    const doContrato = (r) => !meus.size || !r.data?.contrato || meus.has(normContrato(r.data.contrato));
    const finalizados = (await getAll(STORES.history, 'module')).filter((r) => r.module === 'bdo' && r.data?.poco && doContrato(r));
    finalizados.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (finalizados[0]) atual = { data: finalizados[0].data, origem: 'finalizado', uniqueId: finalizados[0].uniqueId };
  }
  if (atual && moduleId && atual.uniqueId && lerUsados()[moduleId] === chaveHeranca(atual)) return null;
  return atual;
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
  if (bdo.uniqueId && Object.keys(herdado).length) d._bdo_id = chaveHeranca(bdo);
  return preenchidos;
}
