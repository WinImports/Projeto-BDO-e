// Monta um HTML autocontido (fotos embutidas, CSS próprio para A4) e pede ao processo
// principal do Electron para gerar o PDF.

import { esc } from './dom.js';
import { reportBodyHtml } from './preview.js';
import { buildPdfBlob, temLayoutProprio } from './pdf-doc.js';
import { buildDocxBlob } from './docx-doc.js';
import { showPdfSheet } from './pdf-sheet.js';
import { empresaDoRelatorio } from '../core/settings.js';

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const fileSafe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '');

const PDF_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5pt; color: #0f172a; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0b5cad; padding-bottom: 8px; margin-bottom: 6px; }
  .brand { display: flex; gap: 10px; align-items: center; }
  .mark { width: 38px; height: 38px; border-radius: 8px; background: #0b5cad; color: #fff; font-weight: 800; font-size: 9pt; display: flex; align-items: center; justify-content: center; border-bottom: 3px solid #f2a900; }
  h1 { font-size: 15pt; margin: 0; }
  .logo { max-height: 52px; max-width: 150px; object-fit: contain; }
  .company { margin: 0 0 1px; font-size: 10pt; font-weight: 700; }
  .company span { font-weight: 400; color: #5b6676; font-size: 8.5pt; }
  .preview__consol { margin-top: 6px; padding: 6px 8px 8px; border: 1px solid #c3ccd7; border-radius: 4px; }
  .consol__summary { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
  .consol__chip { font-size: 8pt; padding: 1px 7px; border-radius: 10px; background: #e8f1fb; color: #0b5cad; font-weight: 600; }
  .consol__block { margin-top: 6px; }
  .consol__title { break-after: avoid; margin: 0 0 3px; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; color: #334155; }
  .sub { color: #5b6676; font-size: 9pt; margin: 2px 0 0; }
  .meta { text-align: right; font-size: 8.5pt; color: #5b6676; line-height: 1.5; }
  .draft { color: #b42318; font-weight: 700; font-size: 10pt; }
  code { font-family: Consolas, monospace; font-size: 8pt; }
  a { color: #0b5cad; }
  .muted { color: #5b6676; } .small { font-size: 8.5pt; }
  .preview__section { padding-top: 10px; break-inside: auto; }
  .preview__section h4 { font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; color: #0b5cad; margin: 0 0 5px; break-after: avoid; }
  .preview__grid { display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; border: 1px solid #c3ccd7; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .preview__item { padding: 5px 8px; border-bottom: 1px solid #dde3ea; border-right: 1px solid #dde3ea; margin: -1px -1px 0 0; break-inside: avoid; }
  .preview__item--full { grid-column: 1 / -1; }
  .preview__item--highlight { background: #fff4dc; border-left: 4px solid #f2a900; }
  .preview__item dt { font-size: 7.5pt; color: #5b6676; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
  .preview__item dd { margin: 1px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { text-align: left; background: #f1f4f8; font-size: 7.5pt; text-transform: uppercase; color: #5b6676; padding: 4px 6px; border-bottom: 1px solid #c3ccd7; }
  td { padding: 4px 6px; border-bottom: 1px solid #e6eaf0; vertical-align: top; }
  tr { break-inside: avoid; }
  .preview__signature { max-width: 240px; border: 1px solid #c3ccd7; border-radius: 4px; }
  .preview__ident { padding-top: 4px; }
  .preview__ident .preview__grid { grid-template-columns: repeat(3, 1fr); }
  /* fotos lado a lado: 2 colunas de ~48% */
  .photo-grid { display: grid; grid-template-columns: 48% 48%; justify-content: space-between; row-gap: 8px; }
  .photo { margin: 0; border: 1px solid #c3ccd7; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .photo img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
  .photo figcaption { padding: 3px 6px; font-size: 7.5pt; color: #5b6676; }
  .photo figcaption strong { color: #0f172a; }
  .preview__photos { margin-top: 6px; }
  .preview__photos-title { margin: 0 0 4px; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; color: #334155; break-after: avoid; }
  .photo-compare { display: grid; grid-template-columns: 48% 48%; justify-content: space-between; }
  .photo-compare__col { border: 1px solid #c3ccd7; border-radius: 4px; padding: 5px; break-inside: avoid; }
  .photo-compare__col--antes { border-top: 3px solid #94a3b8; }
  .photo-compare__col--depois { border-top: 3px solid #15803d; }
  .photo-compare__title { font-size: 8pt; font-weight: 700; margin-bottom: 4px; }
  .photo-compare .photo-grid { grid-template-columns: 100%; }
  footer { margin-top: 14px; padding-top: 6px; border-top: 1px solid #dde3ea; font-size: 7.5pt; color: #5b6676; }
`;

/** Documento completo (PDF do desktop e cópia compartilhada por link). */
export function buildReportHtml(opts) {
  const { module, data } = opts;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(module.title)} — ${esc(data.poco || '')}</title>
<style>${PDF_CSS}</style></head>
<body>${reportDocHtml(opts)}</body></html>`;
}

/** Miolo do relatório: cabeçalho, seções e rodapé. */
function reportDocHtml({ module, uniqueId, data, photos, photoSrcs, company, draft }) {
  const generated = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const brandMark = company?.logo ? `<img class="logo" src="${esc(company.logo)}" alt="">` : '<div class="mark">BDO</div>';
  return `
  <header>
    <div class="brand">
      ${brandMark}
      <div>
        ${company?.nome ? `<p class="company">${esc(company.nome)}${company.cnpj ? ` <span>· CNPJ ${esc(company.cnpj)}</span>` : ''}</p>` : ''}
        <h1>${esc(module.title)}</h1>
      </div>
    </div>
    <div class="meta">
      ${draft ? '<div class="draft">RASCUNHO — NÃO FINALIZADO</div>' : ''}
      Gerado em ${esc(generated)}<br>ID <code>${esc(uniqueId)}</code>
    </div>
  </header>
  ${reportBodyHtml(module, data, photos, photoSrcs)}
  <footer>Documento gerado pelo BDO-e. O ID acima identifica este relatório de forma única no sistema.</footer>`;
}

// ---------- Navegador / PWA (inclusive iPhone) ----------
// O Safari do iOS bloqueia janelas abertas por script e não imprime janelas criadas assim.
// Por isso o relatório é montado DENTRO da página (#print-root) e impresso com window.print():
// o CSS @media print esconde o app e mostra só o relatório ("Salvar como PDF" / "Compartilhar").

/** Prefixa cada regra do CSS do PDF com #print-root (CSS simples, sem blocos aninhados). */
function scopeCss(css, root) {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, body) => {
    const selectors = sel.trim();
    if (selectors.startsWith('@')) return `${selectors} {${body}}`;
    const scoped = selectors.split(',').map((x) => {
      const t = x.trim();
      if (t === 'body' || t === 'html') return root;
      if (t === '*') return `${root}, ${root} *`;
      return `${root} ${t}`;
    }).join(', ');
    return `${scoped} {${body}}`;
  });
}

const SCREEN_RULE = '@media screen { #print-root { display: none !important; } }';
const PRINT_RULE = `@media print {
  html, body { background: #fff !important; }
  body > *:not(#print-root) { display: none !important; }
  #print-root { display: block !important; }
  ${scopeCss(PDF_CSS, '#print-root')}
}`;

let printSheetReady = false;
// CSP do app proíbe <style>: o CSS entra por CSSOM (folha construída; Safari antigo: regra na styles.css)
function ensurePrintSheet() {
  if (printSheetReady) return;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${SCREEN_RULE}\n${PRINT_RULE}`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const host = [...document.styleSheets].find((x) => /styles\.css/.test(x.href || ''));
    for (const rule of [SCREEN_RULE, PRINT_RULE]) {
      try { host?.insertRule(rule, host.cssRules.length); } catch (err) { console.warn('[pdf] regra de impressão', err); }
    }
  }
  printSheetReady = true;
}

const waitImages = (root) => Promise.race([
  Promise.all([...root.querySelectorAll('img')].map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()))),
  new Promise((r) => setTimeout(r, 2500))
]);

async function printInPage(opts, title) {
  document.getElementById('print-root')?.remove();
  ensurePrintSheet();
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = reportDocHtml(opts);
  document.body.appendChild(root);
  await waitImages(root);
  const prevTitle = document.title;
  document.title = title; // nome sugerido para o arquivo PDF
  const cleanup = () => {
    root.remove();
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  return { saved: true, printed: true };
}

const fileNameOf = (module, data, ext = 'pdf') => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const day = String(data.data || data.data_hora || today).slice(0, 10); // data do relatório; senão, data local (não UTC)
  return `${[module.shortTitle, data.poco, day].map(fileSafe).filter(Boolean).join('_')}.${ext}`;
};

async function docOpts({ module, uniqueId, data, photos, company, draft }) {
  const photoSrcs = await Promise.all(photos.map((p) => blobToDataUrl(p.blob)));
  return { module, uniqueId, data, photos, photoSrcs, company: empresaDoRelatorio(company), draft };
}

/**
 * Desktop: PDF do Electron (printToPDF) com diálogo "Salvar como".
 * Navegador / PWA (inclusive iPhone): PDF gerado no aparelho (jsPDF) e painel "PDF pronto" com
 * Compartilhar / Salvar em Arquivos (Web Share), Baixar e Imprimir.
 */
export async function savePdf(args) {
  const fileName = fileNameOf(args.module, args.data).replace(/.pdf$/, args.paisagem ? '_paisagem.pdf' : '.pdf');
  if (args.paisagem) {
    // A4 deitado: sempre o PDF gerado no aparelho (jsPDF), no desktop e no navegador
    const blob = await buildPdfBlob(args);
    if (window.desktop?.saveFile) return window.desktop.saveFile(new Uint8Array(await blob.arrayBuffer()), fileName);
    await showPdfSheet({ blob, fileName });
    return { saved: true, sheet: true };
  }
  if (window.desktop?.saveFile && temLayoutProprio(args.module)) {
    // BDO-e: PDF de página única (jsPDF), o mesmo do celular e do link do WhatsApp
    return window.desktop.saveFile(new Uint8Array(await (await buildPdfBlob(args)).arrayBuffer()), fileName);
  }
  if (window.desktop?.savePdf) return window.desktop.savePdf(buildReportHtml(await docOpts(args)), fileName);
  const blob = await buildPdfBlob(args);
  await showPdfSheet({
    blob, fileName,
    onPrint: async () => printInPage(await docOpts(args), fileName.replace(/\.pdf$/, ''))
  });
  return { saved: true, sheet: true };
}

/**
 * Word (.docx) do relatório. Desktop: "Salvar como" (IPC file:save). Navegador / iPhone: painel
 * "Word pronto" (Compartilhar / Salvar em Arquivos, Baixar).
 */
export async function saveDocx(args) {
  const fileName = fileNameOf(args.module, args.data, 'docx');
  const blob = await buildDocxBlob(args);
  if (window.desktop?.saveFile) return window.desktop.saveFile(new Uint8Array(await blob.arrayBuffer()), fileName);
  await showPdfSheet({ blob, fileName, kind: 'Word' });
  return { saved: true, sheet: true };
}

/**
 * Arquivos do relatório finalizado para o Storage (link do WhatsApp e cópia do envio):
 * PDF (Electron no desktop; jsPDF no navegador) e Word (.docx).
 */
export async function reportFiles(args) {
  const opts = await docOpts({ ...args, draft: false });
  const base = fileNameOf(args.module, args.data).replace(/.pdf$/, '');
  const pdf = window.desktop?.renderPdf && !temLayoutProprio(args.module)
    ? new Blob([await window.desktop.renderPdf(buildReportHtml(opts))], { type: 'application/pdf' })
    : await buildPdfBlob({ ...args, draft: false });
  const docx = await buildDocxBlob({ ...args, draft: false });
  return [
    { blob: pdf, ext: 'pdf', name: `${base}.pdf` },
    { blob: docx, ext: 'docx', name: `${base}.docx` }
  ];
}
