// PDF gerado no próprio aparelho (navegador / PWA, inclusive iPhone) com jsPDF + AutoTable
// (cópias locais em src/vendor, carregadas só quando necessário). Mesmo conteúdo da prévia:
// PDF compacto (sem campos/blocos vazios), fotos no bloco do componente como "Figura N",
// "Antes x Depois" na Execução e coordenadas com links de rota no cabeçalho.
import { displayValue, displayCell, hasContent, parseCoords, mapLinks } from './form.js';
import { assignPhotoFields, photosOf } from '../core/fotos.js';

const A4 = { w: 210, h: 297 };
const M = 12; // margem
const CW = A4.w - 2 * M;
const AZUL = [11, 92, 173];
const CINZA = [91, 102, 118];
const TEXTO = [15, 23, 42];
const LINHA = [195, 204, 215];

// ---------- bibliotecas (carregadas sob demanda; funcionam offline pelo Service Worker) ----------

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error(`Não foi possível carregar ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

async function libs() {
  if (!window.jspdf) await loadScript('./src/vendor/jspdf.umd.min.js');
  if (!window.autoTable) await loadScript('./src/vendor/jspdf.plugin.autotable.min.js');
  return { jsPDF: window.jspdf.jsPDF, autoTable: window.autoTable };
}

// ---------- utilitários ----------

// Fontes padrão do PDF usam WinAnsi: troca o que não existe nela
const txt = (v) => String(v ?? '').replace(/✓/g, 'Sim').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•…€]/g, '');

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const imageSize = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
  img.onerror = () => resolve({ w: 4, h: 3 });
  img.src = src;
});

const formatOf = (dataUrl) => (/^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG');

// ---------- montagem ----------

class Doc {
  constructor(jsPDF, autoTable) {
    this.pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    this.autoTable = autoTable;
    this.y = M;
    this.fig = 0;
  }

  get bottom() { return A4.h - M - 8; } // espaço do rodapé

  ensure(h) {
    if (this.y + h > this.bottom) { this.pdf.addPage(); this.y = M; }
  }

  text(str, x, y, { size = 9, color = TEXTO, bold = false, maxWidth, align } = {}) {
    const p = this.pdf;
    p.setFont('helvetica', bold ? 'bold' : 'normal');
    p.setFontSize(size);
    p.setTextColor(...color);
    p.text(txt(str), x, y, { maxWidth, align });
  }

  sectionTitle(title) {
    this.ensure(14);
    this.y += 3;
    this.text(title.toUpperCase(), M, this.y + 3, { size: 9, bold: true, color: AZUL });
    this.y += 6;
  }

  subTitle(title) {
    this.ensure(10);
    this.text(title.toUpperCase(), M, this.y + 3, { size: 7.5, bold: true, color: [51, 65, 85] });
    this.y += 5;
  }

  table(opts) {
    this.autoTable(this.pdf, {
      startY: this.y,
      margin: { left: M, right: M, top: M, bottom: M + 8 },
      theme: 'grid',
      rowPageBreak: 'avoid', // rótulo e valor nunca ficam em páginas diferentes
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: TEXTO, lineColor: LINHA, lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: [241, 244, 248], textColor: CINZA, fontStyle: 'bold', fontSize: 7 },
      ...opts
    });
    this.y = this.pdf.lastAutoTable.finalY + 3;
  }

  /** Campos simples em grade: rótulo pequeno em cima, valor embaixo (2 por linha; longos ocupam a linha). */
  fieldsGrid(items) {
    const body = [];
    let row = [];
    const cellOf = (it, span) => ({
      content: txt(it.value),
      label: txt(it.label).toUpperCase(),
      colSpan: span,
      styles: it.highlight ? { fillColor: [255, 244, 220] } : {}
    });
    for (const it of items) {
      if (it.full) {
        if (row.length) { body.push([{ ...row[0], colSpan: 2 }]); row = []; }
        body.push([cellOf(it, 2)]);
      } else {
        row.push(cellOf(it, 1));
        if (row.length === 2) { body.push(row); row = []; }
      }
    }
    if (row.length) body.push([{ ...row[0], colSpan: 2 }]);
    this.table({
      body,
      // espaço no topo da célula para o rótulo (desenhado em didDrawCell)
      styles: { fontSize: 9, cellPadding: { top: 5.4, bottom: 1.8, left: 2, right: 2 } },
      columnStyles: { 0: { cellWidth: CW / 2 }, 1: { cellWidth: CW / 2 } },
      didDrawCell: (h) => {
        if (h.section !== 'body' || !h.cell.raw?.label) return;
        this.text(h.cell.raw.label, h.cell.x + 2, h.cell.y + 3.4, { size: 6.5, bold: true, color: CINZA });
      }
    });
  }

  async photoGrid(list, srcOf, { x = M, width = CW, cols = 3 } = {}) {
    const gap = 3;
    const w = (width - gap * (cols - 1)) / cols;
    const h = w * 0.75;
    const capH = 7;
    for (let i = 0; i < list.length; i += cols) {
      this.ensure(h + capH + 2);
      const row = list.slice(i, i + cols);
      for (const [j, p] of row.entries()) {
        const src = srcOf.get(p);
        const px = x + j * (w + gap);
        const { w: iw, h: ih } = await imageSize(src);
        const s = Math.min(w / iw, h / ih);
        const dw = iw * s;
        const dh = ih * s;
        this.pdf.setDrawColor(...LINHA);
        this.pdf.setFillColor(248, 250, 252);
        this.pdf.rect(px, this.y, w, h, 'FD');
        try { this.pdf.addImage(src, formatOf(src), px + (w - dw) / 2, this.y + (h - dh) / 2, dw, dh, undefined, 'FAST'); } catch { /* imagem inválida */ }
        this.fig += 1;
        const cap = `Figura ${this.fig} — ${p.legenda || p.category || p.name}`;
        this.text(cap, px, this.y + h + 3.2, { size: 6.8, color: CINZA, maxWidth: w });
      }
      this.y += h + capH + 2;
    }
  }
}

function header(doc, { module, uniqueId, data, company, draft, logo }) {
  const p = doc.pdf;
  let x = M;
  if (logo) {
    const s = Math.min(34 / logo.w, 14 / logo.h);
    try { p.addImage(logo.src, formatOf(logo.src), M, M, logo.w * s, logo.h * s); x = M + logo.w * s + 4; } catch { /* logo inválido */ }
  }
  let y = M + 3;
  if (company?.nome) { doc.text(`${company.nome}${company.cnpj ? `  ·  CNPJ ${company.cnpj}` : ''}`, x, y, { size: 8.5, bold: true }); y += 5; }
  doc.text(module.title, x, y + 1, { size: 14, bold: true }); y += 6;
  doc.text(`Poço / Locação: ${data.poco || '—'}`, x, y, { size: 9, color: CINZA }); y += 4.5;

  const geo = module.sections.flatMap((s) => s.fields).find((f) => f.type === 'geo');
  const c = geo && parseCoords(data[geo.id]);
  if (c) {
    const links = mapLinks(c);
    p.setFont('helvetica', 'normal'); p.setFontSize(8); p.setTextColor(...AZUL);
    const coords = `Coordenadas GPS: ${displayValue(geo, data[geo.id])}`;
    p.textWithLink(txt(coords), x, y, { url: links.google });
    y += 4;
    let lx = x;
    p.setTextColor(...CINZA); p.text('Rota até a locação:', lx, y); lx += p.getTextWidth('Rota até a locação: ');
    for (const [nome, url] of [['Google Maps', links.google], ['Waze', links.waze], ['OpenStreetMap', links.osm]]) {
      p.setTextColor(...AZUL); p.textWithLink(nome, lx, y, { url }); lx += p.getTextWidth(`${nome}   `);
    }
    y += 2;
  }
  const generated = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  if (draft) doc.text('RASCUNHO — NÃO FINALIZADO', A4.w - M, M + 3, { size: 9, bold: true, color: [180, 35, 24], align: 'right' });
  doc.text(`Gerado em ${generated}`, A4.w - M, M + 8, { size: 7.5, color: CINZA, align: 'right' });
  doc.text(`ID ${uniqueId}`, A4.w - M, M + 12, { size: 6.5, color: CINZA, align: 'right' });
  doc.y = Math.max(y, M + 16) + 2;
  p.setDrawColor(...AZUL); p.setLineWidth(0.8); p.line(M, doc.y, A4.w - M, doc.y); p.setLineWidth(0.2);
  doc.y += 3;
}

function consolidation(doc, c) {
  const br = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso || '');
  const chips = [`Período ${br(c.inicio)} a ${br(c.fim)}`, c.bdos ? `${c.bdos} BDO(s)` : 'Nenhum BDO no período',
    c.bdos ? `Atividades: ${c.horasAtividades}` : '', c.paradas?.length ? `Paradas: ${c.horasParadas}` : '', c.rpt ? `RPT/APR em ${c.rpt} boletins` : '']
    .filter(Boolean).join('  ·  ');
  doc.ensure(8);
  doc.text(chips, M, doc.y + 3, { size: 8, bold: true, color: AZUL, maxWidth: CW });
  doc.y += 6;
  const tabela = (titulo, cols, rows) => {
    if (!rows?.length) return;
    const used = cols.filter(([k]) => rows.some((r) => String(r[k] ?? '').trim()));
    doc.subTitle(titulo);
    doc.table({ head: [used.map(([, l]) => txt(l))], body: rows.map((r) => used.map(([k]) => txt(r[k] ?? '') || '—')) });
  };
  tabela('Resumo de atividades e horas (BDOs)', [['data', 'Data'], ['inicio', 'Início'], ['fim', 'Fim'], ['atividade', 'Atividade'], ['duracao', 'Duração']], c.atividades);
  tabela('Ocorrências e paradas imprevistas', [['data', 'Data'], ['inicio', 'Início'], ['fim', 'Fim'], ['duracao', 'Tempo parado'], ['codigo', 'Código'], ['motivo', 'Motivo']], c.paradas);
  tabela('Registros de SMS', [['data', 'Data'], ['rpt', 'RPT / APR'], ['ocorrencia', 'Ocorrência'], ['descricao', 'Descrição']], c.sms);
  const v = c.visita;
  if (v) {
    tabela(`Última Visita Técnica (${v.data || 'sem data'}) — válvulas e componentes`, [['item', 'Componente'], ['status', 'Status'], ['obs', 'Observação']], (v.valvulas || []).filter((x) => x.status));
    tabela('Flanges, prisioneiros e parafusos', [['item', 'Local'], ['status', 'Estado'], ['obs', 'Observação']], (v.fixadores || []).filter((x) => x.status));
    tabela('Pressões', [['item', 'Ponto'], ['leitura', 'Pressão']], (v.pressoes || []).filter((x) => String(x.valor).trim()).map((x) => ({ ...x, leitura: `${x.valor} ${x.unidade}` })));
  }
}

/** Gera o PDF do relatório e devolve um Blob (application/pdf). */
export async function buildPdfBlob({ module, uniqueId, data, photos = [], company, draft = false }) {
  const { jsPDF, autoTable } = await libs();
  const doc = new Doc(jsPDF, autoTable);
  assignPhotoFields(module, photos);
  const srcOf = new Map();
  for (const p of photos) srcOf.set(p, await blobToDataUrl(p.blob));
  const logo = company?.logo ? { src: company.logo, ...(await imageSize(company.logo)) } : null;

  header(doc, { module, uniqueId, data, company, draft, logo });

  const SIMPLES = (f) => !['geo', 'consolidation', 'photos', 'table', 'signature', 'divider'].includes(f.type);
  const temConteudo = (f) => (f.type === 'photos' ? photos.some((p) => p.field === f.id)
    : f.type === 'signature' ? Boolean(data[f.id])
      : f.type === 'divider' || f.type === 'geo' ? false
        : hasContent(f, data));

  for (const s of module.sections) {
    const campos = s.fields.filter(temConteudo);
    if (!campos.length) continue;
    doc.sectionTitle(s.title);

    // na ordem do formulário; campos simples seguidos viram uma grade
    let grade = [];
    const fecharGrade = () => {
      if (!grade.length) return;
      doc.fieldsGrid(grade.map((f) => ({
        label: f.pdfLabel || f.label, value: displayValue(f, data[f.id]), highlight: f.highlight,
        full: f.full || ['textarea', 'checklist'].includes(f.type) || f.previewButton
      })));
      grade = [];
    };
    for (const f of campos) {
      if (SIMPLES(f)) { grade.push(f); continue; }
      fecharGrade();
      if (f.type === 'table') {
        const rows = (data[f.id] || []).filter((r) => f.columns.some((c) => displayCell(c, r[c.id])));
        const cols = f.columns.filter((c) => rows.some((r) => displayCell(c, r[c.id])));
        if (f.label) doc.subTitle(f.label);
        doc.table({ head: [cols.map((c) => txt(c.label))], body: rows.map((r) => cols.map((c) => txt(displayCell(c, r[c.id])) || '—')) });
      } else if (f.type === 'consolidation') {
        consolidation(doc, data[f.id]);
      } else if (f.type === 'signature') {
        doc.subTitle(f.label);
        const { w, h } = await imageSize(data[f.id]);
        const sc = Math.min(70 / w, 28 / h);
        doc.ensure(h * sc + 4);
        try { doc.pdf.addImage(data[f.id], formatOf(data[f.id]), M, doc.y, w * sc, h * sc); } catch { /* assinatura inválida */ }
        doc.y += h * sc + 4;
      } else if (f.type === 'photos') {
        doc.subTitle(f.label);
        if (f.compare) {
          const antes = photosOf(f, photos, 'antes');
          const depois = photosOf(f, photos, 'depois');
          doc.text(`Antes — Visita Técnica${data._visita_data ? ` de ${data._visita_data}` : ''}`, M, doc.y + 2.5, { size: 7.5, bold: true });
          doc.y += 4;
          if (antes.length) await doc.photoGrid(antes, srcOf, { cols: 3 }); else { doc.text('Sem fotos.', M, doc.y + 2.5, { size: 7.5, color: CINZA }); doc.y += 5; }
          doc.ensure(10);
          doc.text('Depois — Execução', M, doc.y + 2.5, { size: 7.5, bold: true, color: [21, 128, 61] });
          doc.y += 4;
          if (depois.length) await doc.photoGrid(depois, srcOf, { cols: 3 }); else { doc.text('Sem fotos.', M, doc.y + 2.5, { size: 7.5, color: CINZA }); doc.y += 5; }
        } else {
          await doc.photoGrid(photosOf(f, photos), srcOf, { cols: 3 });
        }
      }
    }
    fecharGrade();
  }

  // rodapé com paginação
  const total = doc.pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.pdf.setPage(i);
    doc.pdf.setDrawColor(221, 227, 234);
    doc.pdf.line(M, A4.h - M - 4, A4.w - M, A4.h - M - 4);
    doc.text('Documento gerado pelo BDO-e. O ID identifica este relatório de forma única no sistema.', M, A4.h - M, { size: 6.5, color: CINZA });
    doc.text(`Página ${i} de ${total}`, A4.w - M, A4.h - M, { size: 6.5, color: CINZA, align: 'right' });
  }
  return doc.pdf.output('blob');
}
