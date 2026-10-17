// Monta um HTML autocontido (fotos embutidas, CSS próprio para A4) e pede ao processo
// principal do Electron para gerar o PDF.

import { esc } from './dom.js';
import { reportBodyHtml, geoHeaderHtml } from './preview.js';

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
  .geo-links { display: block; font-size: 8.5pt; margin-top: 2px; }
  .geo-line { margin-top: 2px; }
  .preview__consol { margin-top: 6px; padding: 6px 8px 8px; border: 1px solid #c3ccd7; border-radius: 4px; }
  .consol__summary { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
  .consol__chip { font-size: 8pt; padding: 1px 7px; border-radius: 10px; background: #e8f1fb; color: #0b5cad; font-weight: 600; }
  .consol__block { margin-top: 6px; }
  .consol__title { break-after: avoid; margin: 0 0 3px; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; color: #334155; }
  .geo-line a { color: #0b5cad; }
  .sub { color: #5b6676; font-size: 9pt; margin: 2px 0 0; }
  .meta { text-align: right; font-size: 8.5pt; color: #5b6676; line-height: 1.5; }
  .draft { color: #b42318; font-weight: 700; font-size: 10pt; }
  code { font-family: Consolas, monospace; font-size: 8pt; }
  a { color: #0b5cad; }
  .muted { color: #5b6676; } .small { font-size: 8.5pt; }
  .preview__section { padding-top: 10px; break-inside: auto; }
  .preview__section h4 { font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; color: #0b5cad; margin: 0 0 5px; break-after: avoid; }
  .preview__grid { display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; border: 1px solid #c3ccd7; border-radius: 4px; overflow: hidden; }
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
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photo { margin: 0; border: 1px solid #c3ccd7; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .photo img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
  .photo figcaption { padding: 3px 6px; font-size: 7.5pt; color: #5b6676; }
  footer { margin-top: 14px; padding-top: 6px; border-top: 1px solid #dde3ea; font-size: 7.5pt; color: #5b6676; }
`;

/** inlineCss=false: sem <style> (no navegador o CSS entra via CSSOM, por causa da CSP do app). */
export function buildReportHtml({ module, uniqueId, data, photos, photoSrcs, company, draft, inlineCss = true }) {
  const generated = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const brandMark = company?.logo ? `<img class="logo" src="${esc(company.logo)}" alt="">` : '<div class="mark">BDO</div>';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(module.title)} — ${esc(data.poco || '')}</title>
${inlineCss ? `<style>${PDF_CSS}</style>` : ''}</head>
<body>
  <header>
    <div class="brand">
      ${brandMark}
      <div>
        ${company?.nome ? `<p class="company">${esc(company.nome)}${company.cnpj ? ` <span>· CNPJ ${esc(company.cnpj)}</span>` : ''}</p>` : ''}
        <h1>${esc(module.title)}</h1>
        <p class="sub">Poço / Locação: <strong>${esc(data.poco || '—')}</strong></p>
        ${geoHeaderHtml(module, data) ? `<p class="sub geo-line">${geoHeaderHtml(module, data)}</p>` : ''}
      </div>
    </div>
    <div class="meta">
      ${draft ? '<div class="draft">RASCUNHO — NÃO FINALIZADO</div>' : ''}
      Gerado em ${esc(generated)}<br>ID <code>${esc(uniqueId)}</code>
    </div>
  </header>
  ${reportBodyHtml(module, data, photos, photoSrcs)}
  <footer>Documento gerado pelo BDO-e. O ID acima identifica este relatório de forma única no sistema.</footer>
</body></html>`;
}

/**
 * Navegador/PWA: abre o relatório numa janela e chama a impressão do sistema
 * ("Salvar como PDF" no celular e no computador).
 */
function printInBrowser(html, title) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('O navegador bloqueou a janela do relatório. Permita pop-ups para este site e tente de novo.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  const sheet = new win.CSSStyleSheet();
  sheet.replaceSync(PDF_CSS);
  win.document.adoptedStyleSheets = [sheet];
  setTimeout(() => { win.focus(); win.print(); }, 400); // tempo para as imagens (logo/fotos) carregarem
  return { saved: true, printed: true };
}

export async function savePdf({ module, uniqueId, data, photos, company, draft }) {
  const photoSrcs = await Promise.all(photos.map((p) => blobToDataUrl(p.blob)));
  const desktop = Boolean(window.desktop?.savePdf);
  const html = buildReportHtml({ module, uniqueId, data, photos, photoSrcs, company, draft, inlineCss: desktop });
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const day = data.data || today; // data do relatório; senão, data local (não UTC)
  const fileName = `${[module.shortTitle, data.poco, day].map(fileSafe).filter(Boolean).join('_')}.pdf`;
  if (!desktop) return printInBrowser(html, fileName.replace(/.pdf$/, ''));
  return window.desktop.savePdf(html, fileName);
}
