// Relatório em Word (.docx / OpenXML) gerado no próprio aparelho, sem bibliotecas externas:
// o pacote é um ZIP (sem compressão) com document.xml, estilos, cabeçalho (logo + empresa + título),
// rodapé ("Página X de Y") e as imagens. Mesmo conteúdo do PDF: quadro de identificação no topo
// (sem coordenadas GPS), seções só com dados, fotos lado a lado em 2 colunas (~48% cada) com
// "Figura N — legenda", Antes x Depois na Execução e a imagem da assinatura no bloco final.
import { displayValue, displayCell, hasContent } from './form.js';
import { assignPhotoFields, photosOf } from '../core/fotos.js';
import { cabecalhoItens, CAMPOS_CABECALHO } from './cabecalho.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ---------- medidas (A4, margens de 2 cm) ----------
const TWIP_CM = 567;
const EMU_CM = 360000;
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGEM = 1134; // 2 cm
const LARGURA = PAGE_W - 2 * MARGEM; // 9638 twips ≈ 17 cm
const FOTO_W_CM = 7.7; // cada coluna tem ~48% da largura útil (8,2 cm) menos o recuo da célula
const FOTO_H_CM = FOTO_W_CM * 0.75;

const AZUL = '0B5CAD';
const CINZA = '5B6676';
const BORDA = 'C3CCD7';
const FUNDO_CAB = 'F1F4F8';

// ---------- ZIP (método "store") ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** files: [{ name, data: Uint8Array | string }] → Blob .docx */
export function zipStore(files, type = DOCX_MIME) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type });
}

// ---------- imagens ----------

const imageSize = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve({ w: img.naturalWidth || 4, h: img.naturalHeight || 3, img });
  img.onerror = () => resolve(null);
  img.src = src;
});

const dataUrlBytes = (url) => {
  const bin = atob(String(url).split(',')[1] || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Word só aceita com segurança PNG/JPEG: outros formatos são convertidos para JPEG. */
async function imagemDe(source) {
  const isBlob = source instanceof Blob;
  const url = isBlob ? URL.createObjectURL(source) : String(source || '');
  if (!url) return null;
  try {
    const dim = await imageSize(url);
    if (!dim) return null;
    const type = isBlob ? source.type : (url.match(/^data:([^;,]+)/) || [])[1] || '';
    if (/^image\/(png|jpe?g)$/i.test(type)) {
      const bytes = isBlob ? new Uint8Array(await source.arrayBuffer()) : dataUrlBytes(url);
      return { bytes, ext: /png/i.test(type) ? 'png' : 'jpeg', w: dim.w, h: dim.h };
    }
    const canvas = document.createElement('canvas');
    canvas.width = dim.w;
    canvas.height = dim.h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, dim.w, dim.h);
    ctx.drawImage(dim.img, 0, 0);
    return { bytes: dataUrlBytes(canvas.toDataURL('image/jpeg', 0.85)), ext: 'jpeg', w: dim.w, h: dim.h };
  } finally {
    if (isBlob) URL.revokeObjectURL(url);
  }
}

// ---------- XML ----------

// eslint-disable-next-line no-control-regex
const xml = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Trecho de texto (quebras de linha viram <w:br/>). */
function run(text, { b = false, sz = 20, color, caps = false, i = false } = {}) {
  const rpr = `<w:rPr>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}${caps ? '<w:caps/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  return String(text ?? '').split(/\r?\n/).map((line, k) =>
    `<w:r>${rpr}${k ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join('');
}

function para(runs, { style, align, before = 0, after = 60, keepNext = false, border, indRight = 0 } = {}) {
  const ppr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
    border ? `<w:pBdr><w:bottom w:val="single" w:sz="${border.sz || 8}" w:space="2" w:color="${border.color || AZUL}"/></w:pBdr>` : '',
    `<w:spacing w:before="${before}" w:after="${after}"/>`,
    indRight ? `<w:ind w:right="${indRight}"/>` : '',
    align ? `<w:jc w:val="${align}"/>` : ''
  ].join('');
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}

const bordas = (cor = BORDA) => ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="${cor}"/>`).join('');

/** Célula: conteúdo = parágrafos XML. */
function cell(content, { w, span = 1, fill, vAlign = 'top', noBorders = false } = {}) {
  const tcpr = [
    `<w:tcW w:w="${w}" w:type="dxa"/>`,
    span > 1 ? `<w:gridSpan w:val="${span}"/>` : '',
    noBorders ? '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>' : '',
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '',
    `<w:vAlign w:val="${vAlign}"/>`
  ].join('');
  return `<w:tc><w:tcPr>${tcpr}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
}

function table(rows, widths, { borders = true, header = false } = {}) {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const tblBorders = borders ? `<w:tblBorders>${bordas()}</w:tblBorders>` : '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
  const trs = rows.map((r, k) => `<w:tr><w:trPr><w:cantSplit/>${header && k === 0 ? '<w:tblHeader/>' : ''}</w:trPr>${r}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${tblBorders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>`;
}

const espaco = (after = 120) => para('', { after });

// ---------- montagem ----------

class DocxBuilder {
  constructor() {
    this.body = [];
    this.media = []; // { name, bytes }
    this.rels = []; // relações do document.xml (imagens)
    this.headerRels = [];
    this.docPrId = 0;
    this.fig = 0;
  }

  /** Registra a imagem e devolve o <w:drawing> inline (larguras em cm, mantém a proporção). */
  drawing(img, maxWcm, maxHcm, { header = false } = {}) {
    const n = this.media.length + 1;
    const name = `image${n}.${img.ext}`;
    this.media.push({ name, bytes: img.bytes });
    const list = header ? this.headerRels : this.rels;
    const rid = `rIdImg${n}`;
    list.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    const s = Math.min(maxWcm / img.w, maxHcm / img.h);
    const cx = Math.round(img.w * s * EMU_CM);
    const cy = Math.round(img.h * s * EMU_CM);
    const id = ++this.docPrId;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Imagem ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  add(x) { this.body.push(x); }

  sectionTitle(t) { this.add(para(run(t, { b: true, sz: 22, color: AZUL, caps: true }), { before: 240, after: 100, keepNext: true, border: { sz: 6 } })); }

  subTitle(t) { this.add(para(run(t, { b: true, sz: 17, color: '334155', caps: true }), { before: 120, after: 60, keepNext: true })); }

  /** Campos em grade: rótulo pequeno em cima e valor embaixo; 2 por linha, longos ocupam a linha. */
  fieldsGrid(items) {
    const half = LARGURA / 2;
    const c = (it, span) => cell(
      para(run(it.label, { b: true, sz: 14, color: CINZA, caps: true }), { after: 0 }) + para(run(it.value, { sz: 19 }), { after: 0 }),
      { w: half * span, span, fill: it.highlight ? 'FFF4DC' : undefined }
    );
    const rows = [];
    let row = [];
    for (const it of items) {
      if (it.full) {
        if (row.length) { rows.push(c(row[0], 2)); row = []; }
        rows.push(c(it, 2));
      } else {
        row.push(it);
        if (row.length === 2) { rows.push(c(row[0], 1) + c(row[1], 1)); row = []; }
      }
    }
    if (row.length) rows.push(c(row[0], 2));
    this.add(table(rows, [half, half]));
    this.add(espaco(80));
  }

  dataTable(head, body) {
    const w = Math.floor(LARGURA / head.length);
    const widths = head.map(() => w);
    const hdr = head.map((h) => cell(para(run(h, { b: true, sz: 14, color: CINZA, caps: true }), { after: 0 }), { w, fill: FUNDO_CAB })).join('');
    const rows = body.map((r) => r.map((v) => cell(para(run(v || '—', { sz: 17 }), { after: 0 }), { w })).join(''));
    this.add(table([hdr, ...rows], widths, { header: true }));
    this.add(espaco(80));
  }

  /** Célula de foto: imagem centralizada + "Figura N — legenda". */
  photoCell(foto, n, w) {
    if (!foto) return cell(para(''), { w, noBorders: true });
    const img = foto.img ? para(this.drawing(foto.img, FOTO_W_CM, FOTO_H_CM), { align: 'center', after: 40 }) : para(run('(imagem indisponível)', { sz: 16, color: CINZA, i: true }), { align: 'center' });
    const cap = para(run(`Figura ${n}`, { b: true, sz: 16 }) + run(` — ${foto.cap}`, { sz: 16, color: CINZA }), { align: 'center', after: 0 });
    return cell(img + cap, { w, vAlign: 'top', noBorders: true });
  }

  /** Fotos lado a lado: 2 colunas de ~48% (gap de ~4% no meio). */
  photoGrid(fotos) {
    const w = Math.floor(LARGURA * 0.48);
    const gap = LARGURA - 2 * w;
    const rows = [];
    for (let i = 0; i < fotos.length; i += 2) {
      const a = fotos[i];
      const b = fotos[i + 1];
      const na = ++this.fig;
      const nb = b ? ++this.fig : 0;
      rows.push(this.photoCell(a, na, w) + cell(para(''), { w: gap, noBorders: true }) + this.photoCell(b, nb, w));
    }
    if (rows.length) this.add(table(rows, [w, gap, w], { borders: false }));
    this.add(espaco(80));
  }

  /** Antes (esquerda) x Depois (direita); numeração igual à prévia (Antes primeiro). */
  photoCompare(antes, depois, tituloAntes) {
    const w = Math.floor(LARGURA * 0.48);
    const gap = LARGURA - 2 * w;
    const base = this.fig;
    this.fig += antes.length + depois.length;
    const titulo = (t, color) => cell(para(run(t, { b: true, sz: 16, color }), { after: 40 }), { w, noBorders: true });
    const rows = [titulo(tituloAntes, '334155') + cell(para(''), { w: gap, noBorders: true }) + titulo('Depois — Execução', '15803D')];
    const n = Math.max(antes.length, depois.length);
    for (let i = 0; i < n; i++) {
      const lado = (lista, n0) => (lista[i] ? this.photoCell(lista[i], n0 + i + 1, w)
        : cell(i === 0 ? para(run('Sem fotos.', { sz: 16, color: CINZA, i: true })) : para(''), { w, noBorders: true }));
      rows.push(lado(antes, base) + cell(para(''), { w: gap, noBorders: true }) + lado(depois, base + antes.length));
    }
    this.add(table(rows, [w, gap, w], { borders: false }));
    this.add(espaco(80));
  }
}

function consolidacao(doc, c) {
  const br = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso || '');
  const resumo = [`Período ${br(c.inicio)} a ${br(c.fim)}`, c.bdos ? `${c.bdos} BDO(s)` : 'Nenhum BDO no período',
    c.bdos ? `Atividades: ${c.horasAtividades}` : '', c.paradas?.length ? `Paradas: ${c.horasParadas}` : '', c.rpt ? `RPT/APR em ${c.rpt} boletins` : '']
    .filter(Boolean).join('  ·  ');
  doc.add(para(run(resumo, { b: true, sz: 17, color: AZUL }), { after: 80 }));
  const tabela = (titulo, cols, rows) => {
    if (!rows?.length) return;
    const used = cols.filter(([k]) => rows.some((r) => String(r[k] ?? '').trim()));
    doc.subTitle(titulo);
    doc.dataTable(used.map(([, l]) => l), rows.map((r) => used.map(([k]) => String(r[k] ?? ''))));
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

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const STYLES = `${XML_DECL}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="0F172A"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

/** Gera o .docx do relatório (Blob). Mesmos argumentos de buildPdfBlob. */
export async function buildDocxBlob({ module, uniqueId, data, photos = [], company, draft = false }) {
  assignPhotoFields(module, photos);
  const doc = new DocxBuilder();

  // fotos: bytes + dimensões (uma vez por foto)
  const fotoDe = new Map();
  for (const p of photos) {
    let img = null;
    try { img = await imagemDe(p.blob); } catch { img = null; }
    fotoDe.set(p, { img, cap: p.legenda || p.category || p.name || '' });
  }

  // ----- cabeçalho de página: logo + empresa + título (repete em todas as páginas) -----
  let logoXml = '';
  if (company?.logo) {
    try {
      const logo = await imagemDe(company.logo);
      if (logo) logoXml = para(doc.drawing(logo, 4, 1.6, { header: true }), { after: 0 });
    } catch { /* logo inválido */ }
  }
  const textoCab = [
    company?.nome ? para(run(company.nome, { b: true, sz: 18 }) + (company.cnpj ? run(`  ·  CNPJ ${company.cnpj}`, { sz: 15, color: CINZA }) : ''), { after: 0 }) : '',
    para(run(module.title, { b: true, sz: 26 }), { after: 0 })
  ].join('');
  const geradoEm = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const meta = [
    draft ? para(run('RASCUNHO — NÃO FINALIZADO', { b: true, sz: 16, color: 'B42318' }), { align: 'right', after: 0 }) : '',
    para(run(`Gerado em ${geradoEm}`, { sz: 14, color: CINZA }), { align: 'right', after: 0 }),
    para(run(`ID ${uniqueId}`, { sz: 12, color: CINZA }), { align: 'right', after: 0 })
  ].join('');
  const wLogo = logoXml ? 2500 : 0;
  const wMeta = 2700;
  const wTxt = LARGURA - wLogo - wMeta;
  const cabCells = [
    logoXml ? cell(logoXml, { w: wLogo, vAlign: 'center', noBorders: true }) : '',
    cell(textoCab, { w: wTxt, vAlign: 'center', noBorders: true }),
    cell(meta, { w: wMeta, vAlign: 'center', noBorders: true })
  ].join('');
  const header = `${XML_DECL}<w:hdr ${NS}>${table([cabCells], [wLogo, wTxt, wMeta].filter(Boolean), { borders: false })}${para('', { after: 0, border: { sz: 12 } })}</w:hdr>`;

  const footer = `${XML_DECL}<w:ftr ${NS}>${para(
    run('Documento gerado pelo BDO-e. O ID identifica este relatório de forma única no sistema.   ·   Página ', { sz: 13, color: CINZA })
    + `<w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`
    + run(' de ', { sz: 13, color: CINZA })
    + `<w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="${CINZA}"/><w:sz w:val="13"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`,
    { after: 0, align: 'center' }
  )}</w:ftr>`;

  // ----- identificação (sem coordenadas GPS) -----
  const ident = cabecalhoItens(module, data);
  if (ident.length) doc.fieldsGrid(ident);

  // ----- seções (só campos com dados; os do cabeçalho não se repetem) -----
  const SIMPLES = (f) => !['geo', 'consolidation', 'photos', 'table', 'signature', 'divider'].includes(f.type);
  const temConteudo = (f) => (CAMPOS_CABECALHO.has(f.id) ? false : f.type === 'photos' ? photos.some((p) => p.field === f.id)
    : f.type === 'signature' ? Boolean(data[f.id])
      : f.type === 'divider' || f.type === 'geo' ? false
        : hasContent(f, data));

  for (const s of module.sections) {
    const campos = s.fields.filter(temConteudo);
    if (!campos.length) continue;
    doc.sectionTitle(s.title);
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
        doc.dataTable(cols.map((c) => c.label), rows.map((r) => cols.map((c) => displayCell(c, r[c.id]).replace('✓', 'Sim'))));
      } else if (f.type === 'consolidation') {
        consolidacao(doc, data[f.id]);
      } else if (f.type === 'signature') {
        // assinatura do responsável no bloco final (imagem)
        doc.subTitle(f.label);
        let sig = null;
        try { sig = await imagemDe(data[f.id]); } catch { sig = null; }
        if (sig) doc.add(para(doc.drawing(sig, 7, 2.8), { after: 0 }));
        doc.add(para('', { after: 0, border: { sz: 4, color: '0F172A' }, indRight: LARGURA - Math.round(7.5 * TWIP_CM) }));
        const nome = data.gestor_nome || data.tecnico || (Array.isArray(data.equipe) ? data.equipe.find((r) => String(r.nome || '').trim())?.nome : '') || '';
        if (nome) doc.add(para(run(nome, { sz: 17 }), { after: 120 }));
      } else if (f.type === 'photos') {
        doc.subTitle(f.label);
        if (f.compare) {
          doc.photoCompare(photosOf(f, photos, 'antes').map((p) => fotoDe.get(p)), photosOf(f, photos, 'depois').map((p) => fotoDe.get(p)),
            `Antes — Visita Técnica${data._visita_data ? ` de ${data._visita_data}` : ''}`);
        } else {
          doc.photoGrid(photosOf(f, photos).map((p) => fotoDe.get(p)));
        }
      }
    }
    fecharGrade();
  }

  const sectPr = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${Math.round(3.2 * TWIP_CM)}" w:right="${MARGEM}" w:bottom="${MARGEM}" w:left="${MARGEM}" w:header="${Math.round(0.8 * TWIP_CM)}" w:footer="${Math.round(0.6 * TWIP_CM)}" w:gutter="0"/></w:sectPr>`;
  const document = `${XML_DECL}<w:document ${NS}><w:body>${doc.body.join('')}${para('')}${sectPr}</w:body></w:document>`;

  const exts = [...new Set(doc.media.map((m) => m.name.split('.').pop()))];
  const contentTypes = `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
  const rootRels = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
  const docRels = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
${doc.rels.join('\n')}
</Relationships>`;
  const headerRels = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${doc.headerRels.join('')}</Relationships>`;
  const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(`${module.title}${data.poco ? ` — ${data.poco}` : ''}`)}</dc:title><dc:creator>${xml(company?.nome || 'BDO-e')}</dc:creator><dc:identifier>${xml(uniqueId)}</dc:identifier>
<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified></cp:coreProperties>`;

  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/header1.xml', data: header },
    { name: 'word/footer1.xml', data: footer },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/_rels/header1.xml.rels', data: headerRels },
    ...doc.media.map((m) => ({ name: `word/media/${m.name}`, data: m.bytes }))
  ]);
}
