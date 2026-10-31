// Consolidação da quinzena (revezamento 14x14) para o Relatório de Execução / Handover.
// Fonte: histórico local de relatórios finalizados (IndexedDB "history"), funciona offline.

import { STORES, getAll, get } from './db.js';
import { normalizeWell, listaPocos } from './pocos.js';
import { isTravel } from './deslocamento.js';
import { ANTEPOCO, TODAS_VALVULAS, TODOS_FLANGES } from '../modules/common.js';

export const listHistory = () => getAll(STORES.history);

// "4h15" → 255 min
const toMin = (s) => {
  const m = /^(\d+)h(\d{2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
export const fmtMin = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
const br = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');

const juntar = (...partes) => partes.filter(Boolean).join(' · ');

/**
 * Status de equipamentos da Visita Técnica: campos por componente (formato atual)
 * e/ou as tabelas "valvulas" / "fixadores" do formato anterior.
 */
function resumoVisita(d) {
  const valvulas = (d.valvulas || []).map((v) => ({ item: v.item, status: v.status || '', obs: v.obs || '' }));
  if (d.estado_antepoco || d.obs_antepoco) {
    valvulas.push({ item: ANTEPOCO.nome, status: d.estado_antepoco || '', obs: d.obs_antepoco || '' });
  }
  for (const v of TODAS_VALVULAS) {
    const status = juntar(d[`${v.p}_estanqueidade`], d[`${v.p}_abertura`], d[`${v.p}_intervencao`] === 'Sim' && 'Necessita intervenção');
    if (status || d[`${v.p}_obs`]) valvulas.push({ item: v.short, status, obs: juntar(d[`${v.p}_config`], d[`${v.p}_obs`]) });
  }
  const fixadores = (d.fixadores || []).map((v) => ({ item: v.item, status: v.status || '', obs: v.obs || '' }));
  for (const fl of TODOS_FLANGES) {
    const status = juntar(d[`${fl.p}_corrosao`] && `Corrosão: ${d[`${fl.p}_corrosao`].toLowerCase()}`, d[`${fl.p}_intervencao`] === 'Sim' && 'Necessita intervenção');
    const medidas = juntar(d[`${fl.p}_parafusos`] && `${d[`${fl.p}_parafusos`]} parafusos`, d[`${fl.p}_tamanho`], d[`${fl.p}_prisioneiros`] === 'Sim' && 'com prisioneiros');
    if (status || medidas || d[`${fl.p}_obs`]) fixadores.push({ item: fl.short, status, obs: juntar(medidas, d[`${fl.p}_obs`]) });
  }
  return { valvulas, fixadores };
}

/**
 * Atividades feitas NO poço num BDO: deslocamentos ficam de fora e, num dia com vários poços, vale só o trecho
 * deste poço (depois do deslocamento até ele e antes do deslocamento para outro lugar). Sem poço: o dia todo.
 * @returns {Array<{ indice, atividade }>} indice = posição da atividade no BDO
 */
export function atividadesNoPoco(d, poco) {
  const alvo = normalizeWell(poco);
  const pocos = listaPocos(d.poco).map(normalizeWell).filter(Boolean);
  const ativ = (d.atividades || []).map((a, indice) => ({ indice, a }))
    .filter(({ a }) => a.hora_inicio || a.hora_fim || String(a.atividade || '').trim());
  // destino de um deslocamento: poço da lista citado (ou reconhecido ao digitar); outro lugar → null
  const destino = (a) => {
    const [tipo, nome] = String(a._desloc?.key || '').split(/:(.*)/s);
    if (tipo === 'poco') return normalizeWell(nome);
    const texto = normalizeWell(a.atividade);
    return pocos.filter((p) => texto.includes(p)).sort((x, y) => y.length - x.length)[0] || null;
  };
  const viagens = ativ.filter(({ a }) => isTravel(a.atividade));
  // antes do 1º deslocamento: se ele vai para um poço, a equipe estava na base; senão, no 1º poço do dia
  let atual = viagens.length && destino(viagens[0].a) ? null : pocos[0] || null;
  const out = [];
  for (const x of ativ) {
    if (isTravel(x.a.atividade)) { atual = destino(x.a); continue; }
    if (!alvo || atual === alvo) out.push({ indice: x.indice, atividade: x.a });
  }
  return out;
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Logística que não é execução: separação / carregamento / descarregamento de material. */
export const ehLogistica = (texto) => /\b(separ|carreg|descarreg)\w*\b.*\bmateria/.test(semAcento(texto));
/**
 * Apoio que não é serviço na cabeça de poço: DDS, refeição / intervalo, espera, reunião pré-tarefa, APR / PT
 * (permissão de trabalho) e abastecimento.
 */
export const ehApoio = (texto) => /\b(dds|dss|almoco|refeicao|jantar|janta|lanche|cafe|intervalo|descanso|aguard\w*|espera|reuniao|pre[\s-]?tarefa|apr|pt|abastec\w*)\b|\bpermissao de trabalho\b/.test(semAcento(texto));
/** Atividade de execução (o que entra no Relatório de Execução): nem deslocamento, nem logística de material, nem apoio. */
export const ehExecucao = (texto) => Boolean(String(texto || '').trim()) && !isTravel(texto) && !ehLogistica(texto) && !ehApoio(texto);

/**
 * Execução do dia para o Relatório de Execução: do(s) BDO(s) do MESMO dia (e do mesmo poço, se informado),
 * só as atividades de execução, em ordem de horário.
 */
export function execucaoDoDia(history, { poco, dia }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '')) return [];
  const key = normalizeWell(poco);
  return history
    .filter((r) => r.module === 'bdo' && r.data?.data === dia && (!key || listaPocos(r.data.poco).some((p) => normalizeWell(p) === key)))
    .flatMap((r) => atividadesNoPoco(r.data, key ? poco : '')
      .filter(({ atividade: a }) => ehExecucao(a.atividade))
      .map(({ indice, atividade: a }) => ({
        bdo: r.uniqueId, indice, data: a.data_inicio || dia, atividade: String(a.atividade).trim(),
        inicio: a.hora_inicio || '', fim: a.hora_fim || '', duracao: a.duracao || ''
      })))
    .sort((a, b) => `${a.data} ${a.inicio}`.localeCompare(`${b.data} ${b.inicio}`));
}

/** Histórico + o BDO-e em andamento (rascunho): a Execução costuma ser feita antes de finalizar o BDO do dia. */
export async function execucaoDoDiaFromHistory(params) {
  const historico = await listHistory();
  const rascunho = await get(STORES.drafts, 'bdo').catch(() => null);
  const ja = rascunho && historico.some((r) => r.uniqueId === rascunho.uniqueId);
  const lista = rascunho?.data && !ja ? [...historico, { uniqueId: rascunho.uniqueId || 'rascunho-bdo', module: 'bdo', data: rascunho.data }] : historico;
  return execucaoDoDia(lista, params);
}

/** Datas no formato AAAA-MM-DD; o fim é inclusivo. */
const inPeriod = (date, ini, fim) => Boolean(date) && date >= ini && date <= fim;

/**
 * @param {Array} history registros { uniqueId, module, data, createdAt }
 * @returns resumo pronto para o formulário, a prévia e o PDF
 */
export function consolidate(history, { poco, inicio, fim }) {
  const key = normalizeWell(poco);
  // BDO-e com vários poços no dia entra na quinzena de cada um deles
  const samePoco = (r) => listaPocos(r.data?.poco).some((p) => normalizeWell(p) === key);

  const bdos = history
    .filter((r) => r.module === 'bdo' && samePoco(r) && inPeriod(r.data.data, inicio, fim))
    .sort((a, b) => String(a.data.data).localeCompare(String(b.data.data)) || String(a.createdAt).localeCompare(String(b.createdAt)));

  const atividades = [];
  const paradas = [];
  const sms = [];
  let minAtiv = 0;
  let minParadas = 0;
  let rptSim = 0;
  for (const r of bdos) {
    const d = r.data;
    for (const a of d.atividades || []) {
      minAtiv += toMin(a.duracao);
      atividades.push({ data: br(a.data_inicio || d.data), inicio: a.hora_inicio || '', fim: a.hora_fim || '', atividade: a.atividade || '', duracao: a.duracao || '' });
    }
    for (const p of d.paradas || []) {
      minParadas += toMin(p.duracao);
      paradas.push({ data: br(d.data), inicio: p.inicio || '', fim: p.fim || '', duracao: p.duracao || '', codigo: p.codigo || '', motivo: p.motivo || '' });
    }
    if (d.rpt === 'Sim') rptSim++;
    if (d.ocorrencia_sms === 'Sim' || d.rpt === 'Não') {
      sms.push({ data: br(d.data), rpt: d.rpt || '', ocorrencia: d.ocorrencia_sms || '', descricao: d.descricao_sms || '' });
    }
  }

  // Última Visita Técnica do poço (pela data da inspeção; empate → a finalizada por último)
  const visita = history
    .filter((r) => r.module === 'visita_tecnica' && samePoco(r))
    .sort((a, b) => String(b.data.data).localeCompare(String(a.data.data)) || String(b.createdAt).localeCompare(String(a.createdAt)))[0];

  return {
    poco: String(poco || '').trim(),
    inicio, fim,
    geradoEm: new Date().toISOString(),
    bdos: bdos.length,
    horasAtividades: fmtMin(minAtiv),
    horasParadas: fmtMin(minParadas),
    rpt: bdos.length ? `${rptSim} de ${bdos.length}` : '',
    atividades,
    paradas,
    sms,
    visita: visita ? {
      uniqueId: visita.uniqueId,
      data: br(visita.data.data),
      ...resumoVisita(visita.data),
      pressoes: (visita.data.pressoes || []).map((p) => ({ item: p.item, valor: p.valor || '', unidade: p.unidade || '' }))
    } : null
  };
}

export async function consolidateFromHistory(params) {
  return consolidate(await listHistory(), params);
}

/** Tem algo para mostrar? (usado para omitir o bloco vazio no PDF) */
export const hasConsolidation = (c) => Boolean(c && (c.bdos || c.visita));
