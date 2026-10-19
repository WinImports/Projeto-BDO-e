// Compressão das fotos antes de guardar: no máximo 1280 px no maior lado, JPEG 80%.
// Fotos de celular (4000 px, 3-6 MB) caem para ~200-400 KB: cabem no aparelho, no PDF e no envio.

const MAX = 1280;
const QUALIDADE = 0.8;

function carregar(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(blob));
  }
  return new Promise((resolve, reject) => { // Safari antigo
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')); };
    img.src = url;
  });
}

/**
 * @param {{ name: string, type: string, blob: Blob }} foto
 * @returns {Promise<{ name: string, type: string, blob: Blob }>} a foto comprimida (ou a original, se não der)
 */
export async function comprimirFoto(foto) {
  try {
    const img = await carregar(foto.blob);
    const w = img.width;
    const h = img.height;
    const escala = Math.min(1, MAX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * escala));
    canvas.height = Math.max(1, Math.round(h * escala));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // PNG com transparência não fica preto no JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALIDADE));
    if (!blob) return foto;
    // já era um JPEG pequeno: mantém o original (recomprimir só perderia qualidade)
    if (escala === 1 && foto.type === 'image/jpeg' && blob.size >= foto.blob.size) return foto;
    return { name: `${String(foto.name || 'foto').replace(/\.[^.]+$/, '')}.jpg`, type: 'image/jpeg', blob };
  } catch (err) {
    console.warn('[foto] não foi possível comprimir', err);
    return foto;
  }
}
