// Rascunhos em andamento, um por módulo (BDO-e, Visita Técnica, Execução). Salvos a cada
// alteração no formulário, para que nada se perca se o computador desligar no meio do preenchimento.
// O uniqueId nasce aqui e acompanha o relatório até o banco.

import { STORES, get, put, remove } from './db.js';
import { newUniqueId } from './ids.js';
import { photoMeta } from './fotos.js';
import { meusContratos, normContrato } from './contratos.js';

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
  // contratos da conta quando o rascunho foi salvo: rascunho sem contrato escolhido também é de um contexto
  const lista = meusContratos();
  if (lista.length) record.contexto = lista;
  await put(STORES.drafts, record);
}

export const discardDraft = (moduleId) => remove(STORES.drafts, moduleId);

// ---------- Rascunhos por CONTRATO ----------
// Entrar com uma conta de OUTRO contrato (outra empresa, ou a mesma empresa com outro contrato) abre os relatórios
// em branco: o rascunho em andamento de um contrato que não é da conta atual é guardado à parte
// (chave "contrato:<CONTRATO>:<módulo>") e volta sozinho quando uma conta desse contrato entrar de novo.
// Sem lista de contratos (usuário local, ou lista ainda não baixada) nada muda.
const CHAVE_ARQUIVO = (contrato, moduleId) => `contrato:${normContrato(contrato)}:${moduleId}`;

/** Contrato a que o rascunho pertence ('' = sem como saber). */
function contratoDoRascunho(rec) {
  return String(rec?.data?.contrato || '').trim() || (Array.isArray(rec?.contexto) && rec.contexto.length === 1 ? rec.contexto[0] : '');
}

function foraDoContrato(rec, lista) {
  const meus = new Set(lista.map(normContrato));
  const c = String(rec?.data?.contrato || '').trim();
  if (c) return !meus.has(normContrato(c));
  return Array.isArray(rec?.contexto) && rec.contexto.length > 0 && !rec.contexto.some((x) => meus.has(normContrato(x)));
}

/**
 * Guarda à parte os rascunhos que não são dos contratos da conta e traz de volta os guardados de um contrato
 * dela (quando o lugar está vazio). Retorna os módulos cujo rascunho mudou.
 */
export async function separarRascunhosPorContrato(moduleIds, lista = meusContratos()) {
  if (!lista.length) return [];
  const mudou = [];
  for (const id of moduleIds) {
    let rec = await get(STORES.drafts, id);
    if (rec && foraDoContrato(rec, lista)) {
      const c = contratoDoRascunho(rec);
      if (c) await put(STORES.drafts, { ...rec, key: CHAVE_ARQUIVO(c, id) });
      await remove(STORES.drafts, id);
      rec = null;
      mudou.push(id);
    }
    if (!rec) {
      for (const c of lista) {
        const guardado = await get(STORES.drafts, CHAVE_ARQUIVO(c, id));
        if (!guardado) continue;
        await put(STORES.drafts, { ...guardado, key: id });
        await remove(STORES.drafts, CHAVE_ARQUIVO(c, id));
        if (!mudou.includes(id)) mudou.push(id);
        break;
      }
    }
  }
  return mudou;
}

/**
 * Outro técnico entrou neste aparelho: nos rascunhos em andamento, os campos que ainda têm os dados do técnico
 * anterior (vindos das Configurações: técnico responsável, matrícula, 1ª linha da Equipe…) passam a ter os de
 * quem entrou. O que foi digitado diferente fica. modules = MODULES (src/modules/index.js).
 */
export async function trocarTecnicoNosRascunhos(modules, antes, depois) {
  if (!antes || !depois) return 0;
  let trocados = 0;
  for (const m of modules) {
    const rec = await get(STORES.drafts, m.id);
    if (!rec?.data) continue;
    let mudou = false;
    for (const s of m.sections || []) {
      for (const f of s.fields || []) {
        const v = rec.data[f.id];
        if (f.settingsKey in antes && antes[f.settingsKey] && v === antes[f.settingsKey]) {
          rec.data[f.id] = depois[f.settingsKey] || '';
          mudou = true;
        }
        if (f.type === 'table' && Array.isArray(v) && antes.tecnico_nome) {
          for (const row of v) {
            if (row && row.nome === antes.tecnico_nome) { row.nome = depois.tecnico_nome || ''; mudou = true; }
          }
        }
      }
    }
    if (mudou) { await saveDraft(rec); trocados++; }
  }
  return trocados;
}

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
