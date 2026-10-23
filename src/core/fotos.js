// Fotos dos relatórios. Cada foto pertence a um campo "photos" do formulário (p.field) — um bloco por
// componente na Visita Técnica e na Execução. fase: 'antes' (importada da Visita) | 'depois' | null.

/** Metadados que acompanham a foto na fila, no histórico, no rascunho e no envio. */
export const photoMeta = ({ name, type, blob, category, field, fase, legenda, origem }) => ({
  name, type, blob,
  category: category || null,
  field: field || null,
  fase: fase || null,
  legenda: legenda || '',
  origem: origem || null
});

export const photoFields = (module) => module.sections.flatMap((s) => s.fields).filter((f) => f.type === 'photos');

/**
 * Garante p.field em todas as fotos (fotos antigas não tinham): pela categoria, senão no
 * bloco "Outras fotos" (id 'fotos'). Altera os objetos e devolve a mesma lista.
 */
export function assignPhotoFields(module, photos = []) {
  const fields = photoFields(module);
  if (!fields.length) return photos;
  const ids = new Set(fields.map((f) => f.id));
  const fallback = fields.find((f) => f.id === 'fotos') || fields[fields.length - 1];
  for (const p of photos) {
    if (p.field && ids.has(p.field)) continue;
    p.field = (fields.find((f) => (f.categories || []).includes(p.category)) || fallback).id;
  }
  return photos;
}

/** Fotos de um campo, na ordem das vagas (categorias) e depois na ordem em que foram tiradas. */
export function photosOf(field, photos, fase) {
  const cats = field.categories || [];
  const rank = (p) => { const i = cats.indexOf(p.category); return i < 0 ? cats.length : i; };
  return photos
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.field === field.id && (fase === undefined || (p.fase || 'depois') === fase))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

// ---------- Relatório de Execução: Antes x Depois só quando há "Antes" ----------

/** Título do bloco em uma coluna (sem fotos "Antes" da Visita neste componente). */
export const TITULO_EXECUCAO = 'Fotos da execução';

/** O bloco compare tem fotos "Antes" (da Visita Técnica)? Sem elas, vira uma coluna só, em largura total. */
export const temAntes = (field, photos) => Boolean(field.compare) && photosOf(field, photos, 'antes').length > 0;

/** Rótulo do bloco: sem Visita de referência (data._visita_ref), sem o sufixo ": antes x depois". */
export const rotuloFotos = (field, data) => (field.compare && !data?._visita_ref
  ? String(field.label || '').replace(/:\s*antes x depois\s*$/i, '')
  : field.label);
