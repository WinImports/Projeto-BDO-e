// PDF do BDO-e em página única (A4), padrão operacional: faixa Azul Petróleo com a empresa prestadora
// (Configurações / company_settings; sem cadastro → "Empresa Prestadora"), identificação, indicadores
// (KM, horas, paradas, jornada), Apropriação [Início | Fim | Duração | Atividade], paradas e materiais
// (só se houver), SMS & Segurança, Resumo executivo e observações.
// Cabe em 1 página: o conteúdo é desenhado em escalas cada vez menores (fonte e espaçamentos) até caber;
// se ainda assim não couber, continua na página 2 — nenhum dado é cortado.
import { duracao, duracaoEntreDatas, equipeTexto } from '../modules/common.js';
import { resumoBdo, resumoExecutivo } from '../modules/resumo-bdo.js';

const A4 = { w: 297, h: 210 }; // todos os relatórios em paisagem (A4 deitado)
const PETROLEO = [0, 43, 73]; // #002B49
const ZEBRA = [242, 244, 247];
const FUNDO_KPI = [232, 238, 244];
const BORDA = [208, 214, 222];
const TEXTO = [17, 24, 39];
const CINZA = [91, 102, 118];
const AMBAR = [242, 169, 0];
const ESCALAS = [1, 0.93, 0.86, 0.8, 0.74, 0.68];

const brData = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const hora = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? t : '');
const minutos = (dur) => { const m = /^(\d+)h(\d{2})$/.exec(dur || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const fmtMin = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
const vazio = (v) => v == null || String(v).trim() === '';

/** Linhas preenchidas (com atividade ou horário) das tabelas do BDO. */
const atividadesDe = (d) => (Array.isArray(d.atividades) ? d.atividades : []).filter((r) => !vazio(r.atividade) || hora(r.hora_inicio) || hora(r.hora_fim));
const paradasDe = (d) => (Array.isArray(d.paradas) ? d.paradas : []).filter((p) => !vazio(p.motivo) || hora(p.inicio) || hora(p.fim));
const materiaisDe = (d) => (Array.isArray(d.materiais) ? d.materiais : []).filter((m) => !vazio(m.descricao) || !vazio(m.quantidade));

/** Indicadores do cabeçalho. */
export function indicadoresBdo(d) {
  const ativ = atividadesDe(d);
  const horas = ativ.reduce((acc, r) => acc + minutos(duracaoEntreDatas(r.data_inicio, r.hora_inicio, r.data_fim, r.hora_fim)), 0);
  const paradas = paradasDe(d);
  const parado = paradas.reduce((acc, p) => acc + minutos(p.duracao || duracao(p.inicio, p.fim)), 0);
  const inicios = ativ.map((r) => hora(r.hora_inicio)).filter(Boolean);
  const fins = ativ.map((r) => hora(r.hora_fim)).filter(Boolean);
  const km = vazio(d.km_total) ? '' : `${String(d.km_total).replace('.', ',')} km`;
  return [
    ['KM rodado', km || '—'],
    ['Horas apropriadas', horas ? fmtMin(horas) : '—'],
    ['Horas paradas', paradas.length ? fmtMin(parado) : '0h00'],
    ['Jornada', inicios.length && fins.length ? `${inicios[0]} – ${fins[fins.length - 1]}` : '—'],
    ['Atividades', String(ativ.filter((r) => !vazio(r.atividade)).length)]
  ];
}

/** Resumo para o PDF: o texto automático vira a versão executiva; o editado pelo técnico sai como está. */
export function resumoParaPdf(d) {
  const atual = String(d.resumo_atividades || '').trim();
  const automatico = resumoBdo(d);
  if (!atual || atual === automatico.trim() || atual === String(d._autoTexto?.resumo_atividades || '').trim()) return resumoExecutivo(d);
  return atual;
}

/** Fim da atividade; se terminou em outro dia, mostra a data: "02:00 (21/10)". */
const fimDe = (r) => {
  const h = hora(r.hora_fim);
  if (!h) return '';
  return r.data_fim && r.data_inicio && r.data_fim !== r.data_inicio ? `${h} (${brData(r.data_fim).slice(0, 5)})` : h;
};

function render({ jsPDF, autoTable, txt, formatOf }, { uniqueId, data: d, company, draft, logo }, s) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
  const M = s >= 0.86 ? 10 : 8;
  const W = A4.w - 2 * M;
  const rodape = 7;
  const fs = (n) => n * s;
  let y = M;

  const text = (str, x, yy, { size = 8, color = TEXTO, bold = false, align, maxWidth } = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    pdf.text(txt(str), x, yy, { align, maxWidth });
  };
  const tabela = (opts) => {
    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M, top: M, bottom: M + rodape },
      theme: 'grid',
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: fs(8), cellPadding: fs(1.1), textColor: TEXTO, lineColor: BORDA, lineWidth: 0.15, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: PETROLEO, textColor: 255, fontStyle: 'bold', fontSize: fs(7.2) },
      alternateRowStyles: { fillColor: ZEBRA },
      ...opts
    });
    y = pdf.lastAutoTable.finalY + fs(2.6);
  };
  const titulo = (t) => {
    if (y + fs(10) > A4.h - M - rodape) { pdf.addPage(); y = M; }
    text(t.toUpperCase(), M, y + fs(3), { size: fs(8.2), bold: true, color: PETROLEO });
    pdf.setDrawColor(...PETROLEO); pdf.setLineWidth(0.35);
    pdf.line(M, y + fs(4.2), M + W, y + fs(4.2));
    y += fs(5.6);
  };

  // ----- faixa do cabeçalho: empresa prestadora (dinâmica) + título -----
  const hBand = fs(19);
  pdf.setFillColor(...PETROLEO);
  pdf.rect(M, y, W, hBand, 'F');
  pdf.setFillColor(...AMBAR);
  pdf.rect(M, y + hBand, W, 0.9, 'F');
  let x = M + 3;
  if (logo) {
    const bw = fs(30);
    const bh = hBand - 4;
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(x, y + 2, bw, bh, 1.2, 1.2, 'F');
    const k = Math.min((bw - 2) / logo.w, (bh - 2) / logo.h);
    try { pdf.addImage(logo.src, formatOf(logo.src), x + (bw - logo.w * k) / 2, y + 2 + (bh - logo.h * k) / 2, logo.w * k, logo.h * k); } catch { /* logo inválido */ }
    x += bw + 4;
  }
  text(company.nome, x, y + fs(8), { size: fs(12), bold: true, color: [255, 255, 255], maxWidth: W * 0.5 });
  if (company.cnpj) text(`CNPJ ${company.cnpj}`, x, y + fs(13), { size: fs(7.5), color: [205, 218, 230] });
  const dir = M + W - 3;
  text('BOLETIM DIÁRIO OPERACIONAL', dir, y + fs(6.5), { size: fs(10.5), bold: true, color: [255, 255, 255], align: 'right' });
  text(`BDO-e  ·  ${brData(d.data) || 'sem data'}${d.turno ? `  ·  Turno ${d.turno}` : ''}`, dir, y + fs(11.5), { size: fs(8), color: [205, 218, 230], align: 'right' });
  text(draft ? 'RASCUNHO — NÃO FINALIZADO' : `ID ${String(uniqueId).slice(0, 8).toUpperCase()}`, dir, y + fs(16), { size: fs(7), bold: draft, color: draft ? AMBAR : [205, 218, 230], align: 'right' });
  y += hBand + 0.9 + fs(2.6);

  // ----- identificação (dados do formulário) -----
  const cel = (label, value, colSpan = 1) => ({ content: txt(vazio(value) ? '—' : value), label: txt(label).toUpperCase(), colSpan });
  const tecnico = [d.tecnico, d.matricula ? `Mat. ${d.matricula}` : ''].filter((v) => !vazio(v)).join(' · ');
  tabela({
    theme: 'grid',
    body: [
      [cel('Cliente', d.cliente), cel('Contrato', d.contrato), cel('Poço / Locação', d.poco), cel('Cidade / Estado', d.cidade_uf)],
      [cel('Atividade principal', d.atividade_principal, 2), cel('Técnico responsável', tecnico, 2)],
      [cel('Equipe', equipeTexto(d), 4)]
    ],
    alternateRowStyles: {},
    styles: { fontSize: fs(8.4), cellPadding: { top: fs(4.4), bottom: fs(1.2), left: fs(1.6), right: fs(1.6) }, lineColor: BORDA, lineWidth: 0.15, textColor: TEXTO, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: W / 4 }, 1: { cellWidth: W / 4 }, 2: { cellWidth: W / 4 }, 3: { cellWidth: W / 4 } },
    didDrawCell: (h) => {
      if (h.section !== 'body' || !h.cell.raw?.label) return;
      text(h.cell.raw.label, h.cell.x + fs(1.6), h.cell.y + fs(2.9), { size: fs(5.8), bold: true, color: CINZA });
    }
  });

  // ----- indicadores (KPIs) -----
  const kpis = indicadoresBdo(d);
  const gap = 2;
  const kw = (W - gap * (kpis.length - 1)) / kpis.length;
  const kh = fs(12);
  kpis.forEach(([label, valor], i) => {
    const kx = M + i * (kw + gap);
    pdf.setFillColor(...FUNDO_KPI);
    pdf.rect(kx, y, kw, kh, 'F');
    pdf.setFillColor(...PETROLEO);
    pdf.rect(kx, y, 1, kh, 'F');
    text(label.toUpperCase(), kx + 3, y + fs(4.2), { size: fs(6), bold: true, color: CINZA });
    text(valor, kx + 3, y + fs(9.6), { size: fs(11), bold: true, color: PETROLEO });
  });
  y += kh + fs(3.2);

  // ----- apropriação: Início | Fim | Duração | Atividade -----
  titulo('Apropriação da operação');
  const ativ = atividadesDe(d);
  tabela({
    head: [['Início', 'Fim', 'Duração', 'Atividade executada']],
    body: ativ.length
      ? ativ.map((r) => [hora(r.hora_inicio) || '—', fimDe(r) || '—', duracaoEntreDatas(r.data_inicio, r.hora_inicio, r.data_fim, r.hora_fim) || '—', txt(r.atividade || '—')])
      : [[{ content: 'Nenhuma atividade apropriada.', colSpan: 4, styles: { textColor: CINZA, fontStyle: 'italic' } }]],
    columnStyles: { 0: { cellWidth: fs(15), halign: 'center' }, 1: { cellWidth: fs(19), halign: 'center' }, 2: { cellWidth: fs(16), halign: 'center' }, 3: { cellWidth: 'auto' } }
  });

  // ----- paradas e materiais (só se houver) -----
  const paradas = paradasDe(d);
  if (paradas.length) {
    titulo('Ocorrências e paradas imprevistas');
    tabela({
      head: [['Início', 'Fim', 'Tempo', 'Cód.', 'Motivo / descrição']],
      body: paradas.map((p) => [hora(p.inicio) || '—', hora(p.fim) || '—', p.duracao || duracao(p.inicio, p.fim) || '—', txt(p.codigo || '—'), txt(p.motivo || '—')]),
      columnStyles: { 0: { cellWidth: fs(15), halign: 'center' }, 1: { cellWidth: fs(15), halign: 'center' }, 2: { cellWidth: fs(16), halign: 'center' }, 3: { cellWidth: fs(12), halign: 'center' } }
    });
  }
  const materiais = materiaisDe(d);
  if (materiais.length) {
    titulo('Materiais e insumos');
    tabela({
      head: [['Qtd.', 'Un.', 'Descrição']],
      body: materiais.map((m) => [txt(m.quantidade ?? '—'), txt(m.unidade || '—'), txt(m.descricao || '—')]),
      columnStyles: { 0: { cellWidth: fs(14), halign: 'center' }, 1: { cellWidth: fs(14), halign: 'center' } }
    });
  }

  // ----- SMS & Segurança -----
  titulo('SMS & Segurança');
  const ocorreu = d.ocorrencia_sms === 'Sim';
  const sim = (v) => (vazio(v) ? '—' : v);
  tabela({
    body: [[
      { content: txt(`RPT / APR realizada: ${sim(d.rpt)}`), styles: { fontStyle: 'bold' } },
      { content: txt(`Ocorrência de SMS: ${sim(d.ocorrencia_sms)}`), styles: { fontStyle: 'bold', fillColor: ocorreu ? [255, 244, 220] : [255, 255, 255] } },
      { content: txt(vazio(d.descricao_sms) ? (ocorreu ? 'Descrição não informada.' : 'Sem ocorrências de SMS no turno.') : d.descricao_sms) }
    ]],
    alternateRowStyles: {},
    columnStyles: { 0: { cellWidth: fs(44) }, 1: { cellWidth: fs(42) } }
  });

  // ----- Resumo executivo -----
  const resumo = resumoParaPdf(d);
  if (resumo) {
    titulo('Resumo das atividades executadas');
    tabela({ body: [[txt(resumo)]], alternateRowStyles: {}, styles: { fontSize: fs(8.2), cellPadding: fs(2), fillColor: [250, 251, 252], lineColor: BORDA, lineWidth: 0.15, textColor: TEXTO, overflow: 'linebreak' } });
  }

  // ----- Observações / programação (só se houver) -----
  const obs = [['Observações do turno', d.observacoes], ['Programação / próxima equipe', d.programacao]].filter(([, v]) => !vazio(v));
  if (obs.length) {
    titulo('Observações e programação');
    tabela({
      body: [obs.map(([l, v]) => ({ content: txt(v), label: txt(l).toUpperCase() }))],
      alternateRowStyles: {},
      styles: { fontSize: fs(8), cellPadding: { top: fs(4.4), bottom: fs(1.4), left: fs(1.6), right: fs(1.6) }, lineColor: BORDA, lineWidth: 0.15, textColor: TEXTO, overflow: 'linebreak' },
      didDrawCell: (h) => {
        if (h.section !== 'body' || !h.cell.raw?.label) return;
        text(h.cell.raw.label, h.cell.x + fs(1.6), h.cell.y + fs(2.9), { size: fs(5.8), bold: true, color: CINZA });
      }
    });
  }

  // ----- rodapé -----
  const total = pdf.getNumberOfPages();
  const gerado = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(...BORDA); pdf.setLineWidth(0.2);
    pdf.line(M, A4.h - M - 4, A4.w - M, A4.h - M - 4);
    text(`${company.nome}  ·  BDO-e gerado em ${gerado}  ·  ID ${uniqueId}`, M, A4.h - M, { size: 6.2, color: CINZA });
    text(`Página ${i} de ${total}`, A4.w - M, A4.h - M, { size: 6.2, color: CINZA, align: 'right' });
  }
  return pdf;
}

/**
 * BDO-e em página única. libs: { jsPDF, autoTable, txt, formatOf, imageSize } (de pdf-doc.js).
 * Devolve o Blob do PDF.
 */
export async function buildBdoPdf(libs, { uniqueId, data, company, draft = false }) {
  const logo = company.logo ? { src: company.logo, ...(await libs.imageSize(company.logo)) } : null;
  let pdf = null;
  for (const s of ESCALAS) {
    pdf = render(libs, { uniqueId, data, company, draft, logo }, s);
    if (pdf.getNumberOfPages() === 1) break;
  }
  return pdf.output('blob');
}
