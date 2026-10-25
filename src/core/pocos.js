// Base de poços/locações (offline). Importada em Configurações; carregada do processo principal e pesquisada em memória.

import * as platform from './platform.js';

let cache = null;

/** Descarta a cópia em memória (após importar ou limpar a base). */
export const invalidatePocos = () => { cache = null; };

export async function pocosStatus() {
  return (await platform.pocosStatus()) || { origem: null, total: 0 };
}

/** Lê o arquivo escolhido e envia ao processo principal para validar e gravar. */
export async function importPocosFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await platform.importPocos(file.name, bytes);
  if (res.ok) invalidatePocos();
  return res;
}

export async function clearPocosBase() {
  const res = await platform.clearPocos();
  invalidatePocos();
  return res;
}

// "FBM-89", "fbm 89", "FBM89" → "FBM89" (ignora acentos, espaços, hífens e caixa)
export const normalizeWell = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();

// Zeros à esquerda nos números: "FBM0089" → "FBM89" (quem digita "fbm89" acha "FBM-0089")
const stripZeros = (key) => key.replace(/(^|\D)0+(?=\d)/g, '$1');

/** @returns {Promise<{origem:string|null,fonte:string|null,total:number,list:Array<{nome:string,lat:number,lng:number,key:string}>}>} */
export async function loadPocos() {
  if (cache) return cache;
  let raw = { fonte: null, pocos: [] };
  try {
    raw = (await platform.getPocos()) || raw;
  } catch (err) {
    console.error('[pocos]', err);
  }
  const list = (raw.pocos || []).map(([nome, lat, lng]) => {
    const key = normalizeWell(nome);
    return { nome, lat, lng, key, alt: stripZeros(key) };
  });
  cache = { origem: raw.origem || null, fonte: raw.fonte, total: list.length, list };
  return cache;
}

/** Sugestões: primeiro os que começam com o texto digitado, depois os que contêm. */
export function searchPocos(base, query, limit = 8) {
  const q = normalizeWell(query);
  if (!q || !base?.list.length) return [];
  const qAlt = stripZeros(q);
  // Ordem: começa exatamente igual → começa igual ignorando zeros → contém
  const exact = [];
  const loose = [];
  const contains = [];
  for (const p of base.list) {
    if (p.key.startsWith(q)) exact.push(p);
    else if (p.alt.startsWith(qAlt)) loose.push(p);
    else if (p.key.includes(q) || p.alt.includes(qAlt)) contains.push(p);
    if (exact.length >= limit) break;
  }
  return [...exact, ...loose, ...contains].slice(0, limit);
}

/**
 * Poço / Locação com vários poços no mesmo dia ("FBM-89, FBM-12"): lista na ordem em que foram atendidos.
 * Separador: vírgula ou ponto e vírgula (nomes de poço podem ter hífen e espaço).
 */
export const listaPocos = (texto) => String(texto || '').split(/\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
/** Último poço da lista (o atual / mais recente). */
export const ultimoPoco = (texto) => listaPocos(texto).at(-1) || '';
/** Inclui o poço no fim da lista, se ainda não estiver nela (mesma comparação da base). */
export function incluirPoco(texto, nome) {
  const lista = listaPocos(texto);
  if (lista.some((p) => normalizeWell(p) === normalizeWell(nome))) return lista.join(', ');
  return [...lista, nome].join(', ');
}

export function findPoco(base, name) {
  const key = normalizeWell(name);
  if (!key) return null;
  const alt = stripZeros(key);
  return base?.list.find((p) => p.key === key) || base?.list.find((p) => p.alt === alt) || null;
}
