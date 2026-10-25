// Logo da empresa (Configurações e Gestão de Equipe › empresa do contrato): só PNG/JPEG, redimensionada para
// não pesar no aparelho nem no banco (o servidor recusa data URL acima de ~700 KB).

export const LOGO_MAX = { w: 480, h: 240 };

/** Redimensiona a imagem (mantém a transparência do PNG) e devolve um data URL. */
export async function resizeLogo(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, LOGO_MAX.w / bmp.width, LOGO_MAX.h / bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
}
