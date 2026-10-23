// Relatório em JSON — formato "bdo-e/relatorio", versão 1. Um arquivo leva o relatório inteiro (dados do
// formulário + fotos embutidas em data URL), para levar de um aparelho a outro, guardar fora do app ou
// IMPORTAR na aba de Execução (o relatório importado vira referência "Antes" do Antes x Depois).
//
//   { "formato": "bdo-e/relatorio", "versao": 1, "exportadoEm": "...",
//     "relatorio": { "uniqueId", "module": "visita_tecnica"|"handover"|"bdo", "createdAt", "data": { ...campos },
//                    "fotos": [ { "field", "fase", "legenda", "category", "name", "dataUrl": "data:image/jpeg;base64,..." } ] } }
//
// Também lê: lista de relatórios ([...] ou { "relatorios": [...] }) e a linha do banco
// ({ "module", "payload", "photos" } — fotos só com dataUrl; caminhos do Storage são ignorados).

import { getModule } from '../modules/index.js';
import { photoMeta } from './fotos.js';
import { newUniqueId } from './ids.js';

export const FORMATO = 'bdo-e/relatorio';
export const VERSAO = 1;
export const TAMANHO_MAX = 80 * 1024 * 1024; // arquivo com muitas fotos ainda passa; acima disso, recusa

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS_FOTO = /^image\/(png|jpe?g|webp)$/i;

const blobParaDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** data URL de imagem → Blob (null se não for imagem PNG/JPEG/WebP válida). */
function dataUrlParaBlob(url) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(url || ''));
  if (!m || !TIPOS_FOTO.test(m[1])) return null;
  try {
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    return new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: m[1].toLowerCase() });
  } catch {
    return null;
  }
}

/** Relatório (do Histórico, da fila ou da prévia) → texto JSON no formato bdo-e/relatorio v1. */
export async function relatorioParaJson({ uniqueId, module, data, photos = [], createdAt }) {
  const fotos = [];
  for (const p of photos) {
    if (!p?.blob) continue;
    fotos.push({
      field: p.field || null, fase: p.fase || null, legenda: p.legenda || '', category: p.category || null,
      name: p.name || null, dataUrl: await blobParaDataUrl(p.blob)
    });
  }
  return JSON.stringify({
    formato: FORMATO, versao: VERSAO, exportadoEm: new Date().toISOString(),
    relatorio: { uniqueId, module, createdAt: createdAt || null, data, fotos }
  });
}

/** Nome do arquivo: Tipo_Poco_AAAA-MM-DD.json */
export function nomeArquivoJson(module, data) {
  const dia = String(data?.data || data?.data_hora || '').slice(0, 10);
  const limpo = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${[module.shortTitle, data?.poco, dia].map(limpo).filter(Boolean).join('_') || 'relatorio'}.json`;
}

/**
 * Texto de um arquivo .json → { relatorios: [{ uniqueId, module, data, createdAt, photos }], fotosIgnoradas }.
 * Lança Error com mensagem para a tela se o arquivo não for um relatório do BDO-e.
 */
export function lerRelatoriosJson(texto) {
  if (String(texto || '').length > TAMANHO_MAX) throw new Error('Arquivo grande demais para importar (máximo de 80 MB).');
  let j;
  try { j = JSON.parse(texto); } catch { throw new Error('O arquivo não é um JSON válido.'); }
  if (!j || typeof j !== 'object') throw new Error('O arquivo não contém um relatório do BDO-e.');
  if (j.formato && j.formato !== FORMATO) throw new Error(`Formato não reconhecido ("${j.formato}"). Use um JSON exportado pelo BDO-e.`);
  if (Number(j.versao) > VERSAO) throw new Error('Este arquivo foi gerado por uma versão mais nova do app. Atualize o app para importar.');

  const brutos = Array.isArray(j) ? j : Array.isArray(j.relatorios) ? j.relatorios : j.relatorio ? [j.relatorio] : [j];
  if (!brutos.length) throw new Error('O arquivo não contém nenhum relatório.');
  let fotosIgnoradas = 0;
  const relatorios = brutos.map((r, i) => {
    const qual = brutos.length > 1 ? `Relatório ${i + 1}: ` : '';
    const moduleId = r?.module || r?.modulo;
    const module = getModule(moduleId);
    if (!module) throw new Error(`${qual}tipo de relatório desconhecido${moduleId ? ` ("${moduleId}")` : ''}. Esperado BDO-e, Visita Técnica ou Relatório de Execução.`);
    const data = r.data ?? r.payload;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${qual}sem os dados do formulário.`);
    const photos = [];
    for (const [k, p] of (Array.isArray(r.fotos) ? r.fotos : Array.isArray(r.photos) ? r.photos : []).entries()) {
      const blob = dataUrlParaBlob(p?.dataUrl);
      if (!blob) { fotosIgnoradas++; continue; }
      photos.push({ id: crypto.randomUUID(), ...photoMeta({ ...p, blob, type: blob.type, name: p.name || `foto-${k + 1}.${blob.type.split('/')[1]}`, origem: 'json' }) });
    }
    const id = r.uniqueId || r.unique_id;
    return {
      uniqueId: UUID.test(String(id || '')) ? String(id).toLowerCase() : newUniqueId(),
      module: module.id,
      data: { ...data },
      createdAt: r.createdAt || r.client_created_at || null,
      photos
    };
  });
  return { relatorios, fotosIgnoradas };
}
