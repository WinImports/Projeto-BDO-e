// Rascunhos em andamento, um por módulo (BDO-e, Visita Técnica, Execução). Salvos a cada
// alteração no formulário, para que nada se perca se o computador desligar no meio do preenchimento.
// O uniqueId nasce aqui e acompanha o relatório até o banco.

import { STORES, get, put, remove } from './db.js';
import { newUniqueId } from './ids.js';
import { photoMeta } from './fotos.js';

// Versões anteriores guardavam um rascunho por base ("BA:bdo", "SE:bdo")
const LEGACY_PREFIXES = ['BA', 'SE'];

/**
 * Traz para a chave nova o rascunho antigo mais recente (por base) do módulo.
 * O outro (se houver) continua guardado e é informado em `legacyLeft`.
 */
async function migrateLegacy(moduleId) {
  const found = (await Promise.all(LEGACY_PREFIXES.map((p) => get(STORES.drafts, `${p}:${moduleId}`)))).filter(Boolean);
  if (!found.length) return null;
  found.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const [latest, ...others] = found;
  const migrated = { ...latest, key: moduleId };
  delete migrated.base;
  await put(STORES.drafts, migrated);
  await remove(STORES.drafts, latest.key);
  return { draft: migrated, legacyLeft: others.length };
}

export async function loadDraft(moduleId) {
  const existing = await get(STORES.drafts, moduleId);
  if (existing) return { ...existing, isNew: false };
  const legacy = await migrateLegacy(moduleId);
  if (legacy) return { ...legacy.draft, isNew: false, legacyLeft: legacy.legacyLeft };
  return { key: moduleId, uniqueId: newUniqueId(), module: moduleId, data: {}, photos: [], isNew: true };
}

export async function saveDraft(draft) {
  const { isNew, legacyLeft, ...record } = draft;
  record.updatedAt = new Date().toISOString();
  await put(STORES.drafts, record);
}

export const discardDraft = (moduleId) => remove(STORES.drafts, moduleId);

export async function hasDraft(moduleId) {
  return Boolean(await get(STORES.drafts, moduleId));
}

/**
 * Transforma um item da caixa de saída de volta em rascunho (mesmo uniqueId).
 * `data` vem já reconstruído para o formulário (ver rehydrate em ui/form.js).
 */
export async function restoreDraft(rec, data) {
  await saveDraft({
    key: rec.module,
    uniqueId: rec.uniqueId,
    module: rec.module,
    data,
    photos: rec.photos.map((p) => ({ id: crypto.randomUUID(), ...photoMeta(p) }))
  });
}
