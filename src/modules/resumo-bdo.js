// "Resumo das Atividades Executadas" do BDO-e: parágrafo gerado a partir da Apropriação da operação
// (jornada, poços/locações atendidos, atividades) e das paradas operacionais. Função pura: o formulário
// (campo autoText) refaz o texto a cada alteração enquanto o técnico não o editar à mão.
import { duracao, duracaoEntreDatas } from './common.js';

const brData = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const juntar = (lista) => (lista.length > 1 ? `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}` : lista[0] || '');
const hora = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? t : '');
const minutos = (dur) => { const m = /^(\d+)h(\d{2})$/.exec(dur || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const fmtMin = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
const minuscula = (s) => s.replace(/^([A-ZÀ-Ú])(?![A-ZÀ-Ú0-9-])/, (c) => c.toLowerCase()); // "Troca" → "troca"; "VM"/"FBM-89" ficam
const limpar = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[.;\s]+$/, '');

// Código de poço escrito na atividade: FBM-89, RCB-0034, TQ-12A
const CODIGO_POCO = /\b[A-Z]{2,5}-\d{1,4}[A-Z]?\b/g;
// ...mas não códigos de válvula da cabeça de poço (VA-1, VB-2, VC-1, VM-1…)
const CODIGO_VALVULA = /^V[A-Z]?-\d$/;

/** Intervalo da linha: "das 07:00 às 08:30" (só o que estiver preenchido). */
function intervalo(ini, fim) {
  if (ini && fim) return `das ${ini} às ${fim}`;
  if (ini) return `a partir das ${ini}`;
  if (fim) return `até as ${fim}`;
  return '';
}

/** Linhas preenchidas da apropriação, em ordem cronológica. */
function atividades(d) {
  return (Array.isArray(d.atividades) ? d.atividades : [])
    .filter((r) => limpar(r.atividade))
    .map((r, i) => ({ ...r, i, chave: `${r.data_inicio || d.data || ''}T${hora(r.hora_inicio) || '99:99'}` }))
    .sort((a, b) => a.chave.localeCompare(b.chave) || a.i - b.i);
}

/** Poços e locações do dia: cabeçalho, destinos de deslocamento reconhecidos e códigos citados nas atividades. */
function locais(d, linhas) {
  const pocos = [];
  const cidades = [];
  const add = (lista, nome) => { const n = limpar(nome); if (n && !lista.some((x) => x.toUpperCase() === n.toUpperCase())) lista.push(n); };
  for (const p of String(d.poco || '').split(/\s*[,;]\s*/)) add(pocos, p); // vários poços no dia ("FBM-89, FBM-12")
  for (const r of linhas) {
    const [tipo, nome] = String(r._desloc?.key || '').split(/:(.*)/s);
    if (tipo === 'poco') add(pocos, nome);
    if (tipo === 'cidade') add(cidades, nome);
    for (const m of String(r.atividade).toUpperCase().matchAll(CODIGO_POCO)) if (!CODIGO_VALVULA.test(m[0])) add(pocos, m[0]);
  }
  add(cidades, d.cidade_uf);
  return { pocos, cidades };
}

/**
 * Parágrafo do resumo. Vazio enquanto não houver atividade apropriada.
 * Ex.: "No dia 19/10/2026 (turno Diurno), a jornada teve início às 07:00 e término às 17:00, totalizando
 * 10h00 de atividades apropriadas. Poço / locação atendido: FBM-89, em Catu - BA. Principais atividades
 * executadas: das 07:00 às 08:00, deslocamento para o poço FBM-89; das 08:00 às 11:30, troca da válvula VM.
 * Paradas operacionais: das 10:00 às 10:30 (0h30, código 5), aguardando carro sugador — total de 0h30 parado."
 */
export function resumoBdo(d) {
  const linhas = atividades(d);
  if (!linhas.length) return '';
  const partes = [];

  // 1) jornada
  const primeira = linhas.find((r) => hora(r.hora_inicio)) || linhas[0];
  const fins = linhas.filter((r) => hora(r.hora_fim));
  const ultima = fins.sort((a, b) => `${a.data_fim || a.data_inicio || ''}T${a.hora_fim}`.localeCompare(`${b.data_fim || b.data_inicio || ''}T${b.hora_fim}`)).pop();
  const inicio = hora(primeira.hora_inicio);
  const termino = hora(ultima?.hora_fim);
  const total = linhas.reduce((acc, r) => acc + minutos(duracaoEntreDatas(r.data_inicio, r.hora_inicio, r.data_fim, r.hora_fim)), 0);
  const dia = brData(d.data || primeira.data_inicio);
  let jornada = dia ? `No dia ${dia}` : 'Na jornada';
  if (d.turno) jornada += ` (turno ${d.turno})`;
  if (inicio && termino) {
    const outroDia = ultima.data_fim && primeira.data_inicio && ultima.data_fim !== primeira.data_inicio ? ` de ${brData(ultima.data_fim)}` : '';
    jornada += `, a jornada teve início às ${inicio} e término às ${termino}${outroDia}`;
  } else if (inicio) {
    jornada += `, a jornada teve início às ${inicio}`;
  } else {
    jornada += ', foram registradas as atividades abaixo';
  }
  if (total) jornada += `, totalizando ${fmtMin(total)} de atividades apropriadas`;
  partes.push(`${jornada}.`);

  // 2) poços e locações
  const { pocos, cidades } = locais(d, linhas);
  if (pocos.length || cidades.length) {
    let txt = pocos.length
      ? `${pocos.length > 1 ? 'Poços / locações atendidos' : 'Poço / locação atendido'}: ${juntar(pocos)}`
      : 'Locais';
    if (cidades.length) txt += pocos.length ? `, em ${juntar(cidades)}` : `: ${juntar(cidades)}`;
    partes.push(`${txt}.`);
  }

  // 3) atividades
  const itens = linhas.map((r) => {
    const quando = intervalo(hora(r.hora_inicio), hora(r.hora_fim));
    const texto = minuscula(limpar(r.atividade));
    return quando ? `${quando}, ${texto}` : texto;
  });
  partes.push(`${itens.length > 1 ? 'Principais atividades executadas' : 'Atividade executada'}: ${itens.join('; ')}.`);

  // 4) paradas (só se houver)
  const paradas = (Array.isArray(d.paradas) ? d.paradas : []).filter((p) => limpar(p.motivo) || hora(p.inicio) || hora(p.fim));
  if (paradas.length) {
    let parado = 0;
    const desc = paradas.map((p) => {
      const dur = p.duracao || duracao(p.inicio, p.fim);
      parado += minutos(dur);
      const extra = [dur, p.codigo ? `código ${limpar(p.codigo)}` : ''].filter(Boolean).join(', ');
      const quando = [intervalo(hora(p.inicio), hora(p.fim)), extra && `(${extra})`].filter(Boolean).join(' ');
      const motivo = minuscula(limpar(p.motivo)) || 'motivo não informado';
      return quando ? `${quando}, ${motivo}` : motivo;
    });
    partes.push(`${paradas.length > 1 ? 'Paradas operacionais' : 'Parada operacional'}: ${desc.join('; ')}${parado ? ` — total de ${fmtMin(parado)} parado` : ''}.`);
  }

  return partes.join(' ');
}

/**
 * Versão executiva para o PDF de página única: jornada, locais, atividades SEM os horários (já estão no
 * quadro da apropriação), sem repetições e no máximo `max` itens, e paradas só pelo total.
 */
export function resumoExecutivo(d, { max = 6 } = {}) {
  const linhas = atividades(d);
  if (!linhas.length) return '';
  const partes = [];
  const primeira = linhas.find((r) => hora(r.hora_inicio)) || linhas[0];
  const ultima = linhas.filter((r) => hora(r.hora_fim))
    .sort((a, b) => `${a.data_fim || a.data_inicio || ''}T${a.hora_fim}`.localeCompare(`${b.data_fim || b.data_inicio || ''}T${b.hora_fim}`)).pop();
  const total = linhas.reduce((acc, r) => acc + minutos(duracaoEntreDatas(r.data_inicio, r.hora_inicio, r.data_fim, r.hora_fim)), 0);
  const ini = hora(primeira.hora_inicio);
  const fim = hora(ultima?.hora_fim);
  let jornada = ini && fim ? `Jornada das ${ini} às ${fim}` : ini ? `Jornada iniciada às ${ini}` : 'Jornada registrada';
  if (total) jornada += ` (${fmtMin(total)} apropriadas)`;
  const { pocos, cidades } = locais(d, linhas);
  if (pocos.length) jornada += `, ${pocos.length > 1 ? 'nos poços / locações' : 'no poço / locação'} ${juntar(pocos)}`;
  if (cidades.length) jornada += `, em ${juntar(cidades)}`;
  partes.push(`${jornada}.`);

  const vistos = new Set();
  const itens = [];
  for (const r of linhas) {
    const t = minuscula(limpar(r.atividade));
    const k = t.toLowerCase();
    if (!vistos.has(k)) { vistos.add(k); itens.push(t); }
  }
  const mostrados = itens.slice(0, max);
  const resto = itens.length - mostrados.length;
  partes.push(`Principais atividades: ${mostrados.join('; ')}${resto > 0 ? `; e mais ${resto} atividade${resto > 1 ? 's' : ''} (ver quadro)` : ''}.`);

  const paradas = (Array.isArray(d.paradas) ? d.paradas : []).filter((p) => limpar(p.motivo) || hora(p.inicio) || hora(p.fim));
  if (paradas.length) {
    const parado = paradas.reduce((acc, p) => acc + minutos(p.duracao || duracao(p.inicio, p.fim)), 0);
    partes.push(`${paradas.length} parada${paradas.length > 1 ? 's' : ''} operaciona${paradas.length > 1 ? 'is' : 'l'}${parado ? `, total de ${fmtMin(parado)}` : ''}.`);
  } else {
    partes.push('Sem paradas operacionais.');
  }
  return partes.join(' ');
}
