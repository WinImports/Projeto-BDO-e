// HTML do resumo consolidado da quinzena — o mesmo no formulário, na prévia e no PDF.
// Só desenha as partes que têm dados (regra do PDF compacto).
import { esc } from './dom.js';

const br = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso || '');

function table(title, cols, rows) {
  if (!rows.length) return '';
  // colunas vazias em todas as linhas também saem
  const used = cols.filter(([key]) => rows.some((r) => String(r[key] ?? '').trim()));
  return `
    <div class="consol__block">
      <h5 class="consol__title">${esc(title)}</h5>
      <table class="grid-table grid-table--read">
        <thead><tr>${used.map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${used.map(([key]) => `<td>${esc(r[key] ?? '') || '—'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
}

export function consolidationHtml(c) {
  if (!c) return '';
  const chips = [
    `Período ${br(c.inicio)} a ${br(c.fim)}`,
    c.bdos ? `${c.bdos} BDO${c.bdos > 1 ? 's' : ''}` : 'Nenhum BDO no período',
    c.bdos ? `Atividades: ${c.horasAtividades}` : '',
    c.paradas?.length ? `Paradas: ${c.horasParadas}` : '',
    c.rpt ? `RPT/APR realizada em ${c.rpt} boletins` : ''
  ].filter(Boolean);

  const v = c.visita;
  const valvulas = (v?.valvulas || []).filter((x) => x.status);
  const fixadores = (v?.fixadores || []).filter((x) => x.status);
  const pressoes = (v?.pressoes || []).filter((x) => String(x.valor).trim()).map((p) => ({ ...p, leitura: `${p.valor} ${p.unidade}`.trim() }));

  return `
    <div class="consol__summary">${chips.map((t) => `<span class="consol__chip">${esc(t)}</span>`).join('')}</div>
    ${table('Resumo de atividades e horas (BDOs)', [['data', 'Data'], ['inicio', 'Início'], ['fim', 'Fim'], ['atividade', 'Atividade'], ['duracao', 'Duração']], c.atividades || [])}
    ${table('Ocorrências e paradas imprevistas', [['data', 'Data'], ['inicio', 'Início'], ['fim', 'Fim'], ['duracao', 'Tempo parado'], ['codigo', 'Código'], ['motivo', 'Motivo / descrição']], c.paradas || [])}
    ${table('Registros de SMS (ocorrências e RPT/APR não realizada)', [['data', 'Data'], ['rpt', 'RPT / APR'], ['ocorrencia', 'Ocorrência SMS'], ['descricao', 'Descrição']], c.sms || [])}
    ${v && (valvulas.length || fixadores.length || pressoes.length) ? `
      <div class="consol__block">
        <h5 class="consol__title">Status de equipamentos — última Visita Técnica (${esc(v.data || 'sem data')})</h5>
      </div>
      ${table('Válvulas, antipoço e estanqueidade', [['item', 'Componente'], ['status', 'Status'], ['obs', 'Observação']], valvulas)}
      ${table('Flanges, prisioneiros e parafusos', [['item', 'Local'], ['status', 'Estado'], ['obs', 'Observação']], fixadores)}
      ${table('Pressões', [['item', 'Ponto de leitura'], ['leitura', 'Pressão']], pressoes)}` : ''}`;
}
