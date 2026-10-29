// PDF gerado no próprio aparelho (navegador / PWA, inclusive iPhone) com jsPDF + AutoTable
// (cópias locais em src/vendor, carregadas só quando necessário). Mesmo conteúdo da prévia:
// PDF compacto (sem campos/blocos vazios), fotos no bloco do componente como "Figura N",
// "Antes x Depois" na Execução, fotos em 2 colunas e cabeçalho só com a identificação (sem GPS).
import { displayValue, displayCell, hasContent, dadosParaRelatorio } from './form.js';
import { fotosParaRelatorio, avisarFotos } from './foto-relatorio.js';
import { assignPhotoFields, photosOf, temAntes, rotuloFotos, TITULO_EXECUCAO } from '../core/fotos.js';
import { cabecalhoItens, CAMPOS_CABECALHO } from './cabecalho.js';
import { empresaDoRelatorio } from '../core/settings.js';
import { buildBdoPdf } from './bdo-pdf.js';

/** Relatórios com layout próprio de página única (desktop e navegador usam este mesmo gerador). */
export const temLayoutProprio = (module) => module.id === 'bdo';

const A4 = { w: 210, h: 297 };
const M = 12; // margem
const AZUL = [0, 43, 73]; // Azul Petróleo #002B49 (identidade do app e do PDF do BDO-e)
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
  /** paisagem: A4 deitado (297 × 210 mm) — padrão de todos os relatórios. */
  constructor(jsPDF, autoTable, paisagem = false) {
    this.pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: paisagem ? 'landscape' : 'portrait', compress: true });
    this.W = paisagem ? A4.h : A4.w; // largura e altura da página deste documento
    this.H = paisagem ? A4.w : A4.h;
    this.CW = this.W - 2 * M;       // largura útil
    this.autoTable = autoTable;
    this.y = M;
    this.fig = 0;
  }

  get bottom() { return this.H - M - 8; } // espaço do rodapé

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
      columnStyles: { 0: { cellWidth: this.CW / 2 }, 1: { cellWidth: this.CW / 2 } },
      didDrawCell: (h) => {
        if (h.section !== 'body' || !h.cell.raw?.label) return;
        this.text(h.cell.raw.label, h.cell.x + 2, h.cell.y + 3.4, { size: 6.5, bold: true, color: CINZA });
      }
    });
  }

  /** Foto centralizada na caixa (px, y, w, h) com "Figura N — legenda" embaixo. */
  async photoCell(p, srcOf, px, w, h, n) {
    const src = srcOf.get(p);
    if (!src) { // foto ilegível: a vaga fica marcada (nunca some sem aviso)
      this.pdf.setDrawColor(...LINHA);
      this.pdf.setFillColor(248, 250, 252);
      this.pdf.rect(px, this.y, w, h, 'FD');
      this.text('(imagem indisponível)', px + w / 2 - 14, this.y + h / 2, { size: 7.5, color: CINZA });
      this.text(`Figura ${n} — ${p.legenda || p.category || p.name}`, px, this.y + h + 3.2, { size: 6.8, color: CINZA, maxWidth: w });
      return;
    }
    const { w: iw, h: ih } = await imageSize(src);
    const s = Math.min(w / iw, h / ih);
    const dw = iw * s;
    const dh = ih * s;
    this.pdf.setDrawColor(...LINHA);
    this.pdf.setFillColor(248, 250, 252);
    this.pdf.rect(px, this.y, w, h, 'FD');
    try { this.pdf.addImage(src, formatOf(src), px + (w - dw) / 2, this.y + (h - dh) / 2, dw, dh, undefined, 'FAST'); } catch { /* imagem inválida */ }
    this.text(`Figura ${n} — ${p.legenda || p.category || p.name}`, px, this.y + h + 3.2, { size: 6.8, color: CINZA, maxWidth: w });
  }

  /** Fotos lado a lado em 2 colunas (~48% da largura cada). */
  async photoGrid(list, srcOf) {
    const gap = this.CW * 0.04;
    const w = (this.CW - gap) / 2;
    const h = w * 0.75;
    const capH = 7;
    for (let i = 0; i < list.length; i += 2) {
      this.ensure(h + capH + 2);
      for (const [j, p] of list.slice(i, i + 2).entries()) {
        this.fig += 1;
        await this.photoCell(p, srcOf, M + j * (w + gap), w, h, this.fig);
      }
      this.y += h + capH + 2;
    }
  }

  /** Antes (esquerda) x Depois (direita). Numeração igual à prévia: primeiro as de "Antes", depois as de "Depois". */
  async photoCompare(antes, depois, srcOf, tituloAntes) {
    const gap = this.CW * 0.04;
    const w = (this.CW - gap) / 2;
    const h = w * 0.75;
    const capH = 7;
    const base = this.fig;
    this.fig += antes.length + depois.length;
    this.ensure(5 + h + capH);
    this.text(tituloAntes, M, this.y + 2.5, { size: 7.5, bold: true, maxWidth: w });
    this.text('Depois — Execução', M + w + gap, this.y + 2.5, { size: 7.5, bold: true, color: [21, 128, 61], maxWidth: w });
    this.y += 4;
    const linhas = Math.max(antes.length, depois.length);
    for (let i = 0; i < linhas; i++) {
      this.ensure(h + capH + 2);
      for (const [j, lista, n0] of [[0, antes, base], [1, depois, base + antes.length]]) {
        const px = M + j * (w + gap);
        if (lista[i]) await this.photoCell(lista[i], srcOf, px, w, h, n0 + i + 1);
        else if (i === 0) this.text('Sem fotos.', px, this.y + 2.5, { size: 7.5, color: CINZA });
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
  const generated = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  if (draft) doc.text('RASCUNHO — NÃO FINALIZADO', doc.W - M, M + 3, { size: 9, bold: true, color: [180, 35, 24], align: 'right' });
  doc.text(`Gerado em ${generated}`, doc.W - M, M + 8, { size: 7.5, color: CINZA, align: 'right' });
  doc.text(`ID ${uniqueId}`, doc.W - M, M + 12, { size: 6.5, color: CINZA, align: 'right' });
  doc.y = Math.max(y, M + 16) + 2;
  p.setDrawColor(...AZUL); p.setLineWidth(0.8); p.line(M, doc.y, doc.W - M, doc.y); p.setLineWidth(0.2);
  doc.y += 3;
  // identificação: poço, cidade/campo, data, turno, cliente, contrato e equipe (sem coordenadas GPS)
  const ident = cabecalhoItens(module, data);
  if (ident.length) doc.fieldsGrid(ident);
}

function consolidation(doc, c) {
  const br = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso || '');
  const chips = [`Período ${br(c.inicio)} a ${br(c.fim)}`, c.bdos ? `${c.bdos} BDO(s)` : 'Nenhum BDO no período',
    c.bdos ? `Atividades: ${c.horasAtividades}` : '', c.paradas?.length ? `Paradas: ${c.horasParadas}` : '', c.rpt ? `RPT/APR em ${c.rpt} boletins` : '']
    .filter(Boolean).join('  ·  ');
  doc.ensure(8);
  doc.text(chips, M, doc.y + 3, { size: 8, bold: true, color: AZUL, maxWidth: doc.CW });
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

export { imageSize, blobToDataUrl, formatOf };

/** Gera o PDF do relatório e devolve um Blob (application/pdf). */
export async function buildPdfBlob({ module, uniqueId, data, photos = [], company: empresa, draft = false }) {
  const { jsPDF, autoTable } = await libs();
  const company = empresaDoRelatorio(empresa); // sem empresa configurada: "Empresa Prestadora"
  // todos os relatórios em paisagem (A4 deitado); o BDO-e mantém o layout próprio, também deitado
  if (temLayoutProprio(module)) return buildBdoPdf({ jsPDF, autoTable, txt, formatOf, imageSize }, { uniqueId, data, company, draft });
  const doc = new Doc(jsPDF, autoTable, true);
  assignPhotoFields(module, photos);
  data = dadosParaRelatorio(module, data, photos); // campos fixos da seção ("—") e nota do torque
  const srcOf = new Map();
  const { srcs, falhas } = await fotosParaRelatorio(photos); // sempre JPEG/PNG (HEIC/WebP do celular convertidos)
  photos.forEach((p, i) => srcOf.set(p, srcs[i]));
  avisarFotos(falhas);
  const logo = company?.logo ? { src: company.logo, ...(await imageSize(company.logo)) } : null;

  header(doc, { module, uniqueId, data, company, draft, logo });

  const SIMPLES = (f) => !['geo', 'consolidation', 'photos', 'table', 'signature', 'divider'].includes(f.type);
  const temConteudo = (f) => (CAMPOS_CABECALHO.has(f.id) ? false : f.type === 'photos' ? photos.some((p) => p.field === f.id)
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
        doc.subTitle(rotuloFotos(f, data));
        if (f.compare && !temAntes(f, photos)) {
          // sem fotos "Antes" neste componente: uma coluna (fotos da execução, em largura total)
          doc.subTitle(TITULO_EXECUCAO);
          await doc.photoGrid(photosOf(f, photos, 'depois'), srcOf);
        } else if (f.compare) {
          await doc.photoCompare(photosOf(f, photos, 'antes'), photosOf(f, photos, 'depois'), srcOf,
            `Antes — Visita Técnica${data._visita_data ? ` de ${data._visita_data}` : ''}`);
        } else {
          await doc.photoGrid(photosOf(f, photos), srcOf);
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
    doc.pdf.line(M, doc.H - M - 4, doc.W - M, doc.H - M - 4);
    doc.text('Documento gerado pelo BDO-e. O ID identifica este relatório de forma única no sistema.', M, doc.H - M, { size: 6.5, color: CINZA });
    doc.text(`Página ${i} de ${total}`, doc.W - M, doc.H - M, { size: 6.5, color: CINZA, align: 'right' });
  }
  return doc.pdf.output('blob');
}
