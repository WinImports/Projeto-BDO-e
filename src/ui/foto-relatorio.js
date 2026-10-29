// Fotos prontas para entrar no PDF (jsPDF e HTML do desktop) e no Word: sempre JPEG ou PNG de verdade.
// O celular pode entregar HEIC/HEIF (iPhone), WebP ou arquivo sem tipo; a prévia na tela mostra, mas o
// jsPDF, o printToPDF e o Word não — e a foto sumia do relatório sem aviso. Aqui o formato é conferido
// pelos bytes (não pelo tipo declarado) e o que não for JPEG/PNG é redesenhado num canvas como JPEG.

import { toast } from './toast.js';

const QUALIDADE = 0.85;

/** Formato real pelos primeiros bytes: 'jpeg' | 'png' | null. */
export async function formatoReal(blob) {
  const b = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

const lerDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error || new Error('Foto ilegível'));
  r.readAsDataURL(blob);
});

const carregarImagem = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Formato de foto não suportado'));
  img.src = src;
});

/**
 * Data URL JPEG/PNG da foto (o tipo no cabeçalho do data URL corresponde aos bytes).
 * @returns {Promise<string|null>} null quando a foto não pode ser lida nem convertida
 */
export async function fotoParaRelatorio(blob) {
  if (!(blob instanceof Blob) || !blob.size) return null;
  try {
    const fmt = await formatoReal(blob);
    if (fmt) {
      const url = await lerDataUrl(blob);
      return url.replace(/^data:[^;,]*/, `data:image/${fmt}`);
    }
    // HEIC, WebP… : o navegador decodifica (Safari abre HEIC) e o canvas regrava como JPEG
    const obj = URL.createObjectURL(blob);
    try {
      const img = await carregarImagem(obj);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1;
      canvas.height = img.naturalHeight || 1;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const url = canvas.toDataURL('image/jpeg', QUALIDADE);
      return /^data:image\/jpeg/.test(url) ? url : null;
    } finally {
      URL.revokeObjectURL(obj);
    }
  } catch (err) {
    console.warn('[foto] não entra no relatório', err);
    return null;
  }
}

/** Converte todas as fotos: { srcs: data URLs na ordem de `photos` (null = ilegível), falhas }. */
export async function fotosParaRelatorio(photos = []) {
  const srcs = [];
  for (const p of photos) srcs.push(await fotoParaRelatorio(p?.blob));
  return { srcs, falhas: srcs.filter((s) => !s).length };
}

export const avisoFotos = (falhas) => (falhas
  ? `${falhas} foto${falhas > 1 ? 's' : ''} não ${falhas > 1 ? 'puderam' : 'pôde'} ser incluída${falhas > 1 ? 's' : ''} no relatório (arquivo ilegível neste aparelho). Remova e tire de novo pela Câmera do app.`
  : '');

// PDF e Word são gerados juntos (envio / WhatsApp): o aviso aparece uma vez só
let ultimoAviso = 0;
export function avisarFotos(falhas) {
  if (!falhas || Date.now() - ultimoAviso < 8000) return;
  ultimoAviso = Date.now();
  toast(avisoFotos(falhas), 'warn', 10000);
}
