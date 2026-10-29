// Fotos prontas para entrar no PDF (jsPDF e HTML do desktop) e no Word: sempre JPEG ou PNG de verdade.
// O celular pode entregar HEIC/HEIF (iPhone), WebP ou arquivo sem tipo; a prévia na tela mostra, mas o
// jsPDF, o printToPDF e o Word não — e a foto sumia do relatório sem aviso. Aqui o formato é conferido
// por um canvas (JPEG, no máx. 1600 px); se o canvas não der, usa os bytes quando já são JPEG/PNG de verdade.

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

const MAX_LADO = 1600; // suficiente para o PDF (a foto ocupa ~6 cm) e leve na memória do iPhone

/** Redesenha a imagem num canvas (no máx. MAX_LADO px) e devolve JPEG. */
function paraJpeg(img, w, h) {
  const escala = Math.min(1, MAX_LADO / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * escala));
  canvas.height = Math.max(1, Math.round(h * escala));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', QUALIDADE);
  canvas.width = 0; // libera a memória do canvas já (o Safari do iPhone tem limite baixo)
  canvas.height = 0;
  return /^data:image\/jpeg/.test(url) && url.length > 32 ? url : null;
}

/** 1º caminho: o mesmo da tela (URL do blob no <img>) — no iPhone é o que funciona com foto guardada no aparelho. */
async function pelaImagem(blob) {
  const obj = URL.createObjectURL(blob);
  try {
    const img = await carregarImagem(obj);
    return paraJpeg(img, img.naturalWidth || 1, img.naturalHeight || 1);
  } finally {
    URL.revokeObjectURL(obj);
  }
}

/** 2º caminho: decodificação direta do blob. */
async function peloBitmap(blob) {
  if (typeof createImageBitmap !== 'function') return null;
  const bmp = await createImageBitmap(blob);
  try { return paraJpeg(bmp, bmp.width, bmp.height); } finally { bmp.close?.(); }
}

/** 3º caminho: os bytes como estão (só JPEG/PNG de verdade). */
async function pelosBytes(blob) {
  const fmt = await formatoReal(blob);
  if (!fmt) return null;
  const url = await lerDataUrl(blob);
  return url.replace(/^data:[^;,]*/, `data:image/${fmt}`);
}

/**
 * Data URL JPEG/PNG da foto para o PDF/Word. Tenta, em ordem, pelo <img> (como a tela mostra), pelo
 * createImageBitmap e pelos bytes — no iPhone a leitura direta dos bytes de uma foto guardada no aparelho
 * pode falhar mesmo com a foto aparecendo na tela.
 * @returns {Promise<string|null>} null quando nenhum caminho consegue ler a foto
 */
export async function fotoParaRelatorio(blob) {
  if (!blob || typeof blob.size !== 'number' || !blob.size) return null;
  for (const caminho of [pelaImagem, peloBitmap, pelosBytes]) {
    try {
      const url = await caminho(blob);
      if (url) return url;
    } catch (err) {
      console.warn(`[foto] ${caminho.name} falhou`, err);
    }
  }
  return null;
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
