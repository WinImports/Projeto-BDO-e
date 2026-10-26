// Consolidação da quinzena (revezamento 14x14) para o Relatório de Execução / Handover.
// Fonte: histórico local de relatórios finalizados (IndexedDB "history"), funciona offline.

import { STORES, getAll } from './db.js';
import { normalizeWell, listaPocos } from './pocos.js';
import { isTravel } from './deslocamento.js';
import { ANTEPOCO, VALVULAS_CABECA, FLANGES } from '../modules/common.js';

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
  for (const v of VALVULAS_CABECA) {
    const status = juntar(d[`${v.p}_estanqueidade`], d[`${v.p}_abertura`], d[`${v.p}_intervencao`] === 'Sim' && 'Necessita intervenção');
    if (status || d[`${v.p}_obs`]) valvulas.push({ item: v.short, status, obs: juntar(d[`${v.p}_config`], d[`${v.p}_obs`]) });
  }
  const fixadores = (d.fixadores || []).map((v) => ({ item: v.item, status: v.status || '', obs: v.obs || '' }));
  for (const fl of FLANGES) {
    const status = juntar(d[`${fl.p}_corrosao`] && `Corrosão: ${d[`${fl.p}_corrosao`].toLowerCase()}`, d[`${fl.p}_intervencao`] === 'Sim' && 'Necessita intervenção');
    const medidas = juntar(d[`${fl.p}_parafusos`] && `${d[`${fl.p}_parafusos`]} parafusos`, d[`${fl.p}_tamanho`], d[`${fl.p}_prisioneiros`] === 'Sim' && 'com prisioneiros');
    if (status || medidas || d[`${fl.p}_obs`]) fixadores.push({ item: fl.short, status, obs: juntar(medidas, d[`${fl.p}_obs`]) });
  }
  return { valvulas, fixadores };
}

/**
 * Chegada e saída no poço num BDO (Tempos de operação da Execução): o início da primeira e o fim da última
 * atividade NO poço. Deslocamentos ficam de fora; num dia com vários poços, vale só o trecho deste poço
 * (depois do deslocamento até ele e antes do deslocamento para outro lugar).
 * @returns {{ chegada, saida, visita }|null} visita: alguma atividade no poço fala em "visita"
 */
export function tempoNoPoco(d, poco) {
  const alvo = normalizeWell(poco);
  const pocos = listaPocos(d.poco).map(normalizeWell).filter(Boolean);
  const ativ = (d.atividades || []).filter((a) => a.hora_inicio || a.hora_fim || String(a.atividade || '').trim());
  // destino de um deslocamento: poço da lista citado (ou reconhecido ao digitar); outro lugar → null
  const destino = (a) => {
    const [tipo, nome] = String(a._desloc?.key || '').split(/:(.*)/s);
    if (tipo === 'poco') return normalizeWell(nome);
    const texto = normalizeWell(a.atividade);
    return pocos.filter((p) => texto.includes(p)).sort((x, y) => y.length - x.length)[0] || null;
  };
  const viagens = ativ.filter((a) => isTravel(a.atividade));
  // antes do 1º deslocamento: se ele vai para um poço, a equipe estava na base; senão, no 1º poço do dia
  let atual = viagens.length && destino(viagens[0]) ? null : pocos[0] || null;
  const noPoco = [];
  for (const a of ativ) {
    if (isTravel(a.atividade)) { atual = destino(a); continue; }
    if (atual === alvo) noPoco.push(a);
  }
  if (!noPoco.length) return null;
  const chegada = noPoco.find((a) => a.hora_inicio)?.hora_inicio || '';
  const saida = [...noPoco].reverse().find((a) => a.hora_fim)?.hora_fim || '';
  if (!chegada && !saida) return null;
  return { chegada, saida, visita: noPoco.some((a) => /\bvisita\b/i.test(a.atividade || '')) };
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
  const tempos = [];
  const paradas = [];
  const sms = [];
  let minAtiv = 0;
  let minParadas = 0;
  let rptSim = 0;
  for (const r of bdos) {
    const d = r.data;
    const t = tempoNoPoco(d, poco);
    if (t) tempos.push({ bdo: r.uniqueId, data: d.data, ...t });
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
    tempos,
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
