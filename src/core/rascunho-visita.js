// "Rascunho de Visita" exportado pelo app de visita anterior (arquivo Rascunho_Visita_<poço>.json): campos soltos
// (poco, locacao, data, resp1/resp2, pColuna/pSup/pInf, comp.VC / VA1A / VA2A / VA1B / VA2B / FLSUP / FLREV, ante,
// anteObs, r_recom) e as fotos em `photos` (chave → data URL), com a legenda em `caps`. Aqui vira um relatório de
// Visita Técnica do BDO-e (mesmo formato de lerRelatoriosJson), para importar na aba Execução como o "Antes".
import { VALVULAS_CABECA, FLANGES, ANTEPOCO } from '../modules/common.js';

/** É um rascunho de visita do app anterior? (sem "module"; tem poço e componentes / pressões / fotos soltas) */
export const ehRascunhoVisita = (j) => Boolean(j && typeof j === 'object' && !Array.isArray(j) && !j.module && !j.modulo && !j.relatorio
  && j.poco && (j.comp || 'pColuna' in j || (j.photos && !Array.isArray(j.photos))));

// componentes do rascunho → prefixo do BDO-e
const COMPONENTES = { VC: 'vc', VA1A: 'va1', VA2A: 'va2', VA1B: 'vb1', VA2B: 'vb2', FLSUP: 'flange_sup', FLREV: 'flange_inf' };
const ehFlange = (p) => p.startsWith('flange');
const texto = (v) => String(v ?? '').trim();
const juntar = (...partes) => partes.map(texto).filter(Boolean).join(' — ');
const naoVerificado = (v) => /n[ãa]o\s+foi\s+poss[ií]vel|n[ãa]o\s+verific|n[ãa]o\s+testad/i.test(texto(v));

function estanqueidade(v) {
  const t = texto(v);
  if (!t) return '';
  if (/^sim\b|^estanque/i.test(t)) return 'Estanque';
  if (naoVerificado(t)) return 'Não testada';
  if (/^n[ãa]o\b|vaz/i.test(t)) return 'Sem estanqueidade (vazamento)';
  return '';
}

function abertura(v) {
  const t = texto(v);
  if (!t) return '';
  if (/^ok\b|normal/i.test(t)) return 'Abre e fecha normalmente';
  if (naoVerificado(t)) return 'Não testada';
  if (/dificuldade/i.test(t)) return 'Abre / fecha com dificuldade';
  if (/trav|n[ãa]o\s+opera/i.test(t)) return 'Não opera (travada)';
  return '';
}

const simNao = (v) => (/^sim/i.test(texto(v)) ? 'Sim' : /^n[ãa]o/i.test(texto(v)) ? 'Não' : '');

/** id estável a partir do conteúdo: importar o mesmo rascunho de novo não duplica a Visita. */
function idEstavel(j) {
  const base = [j.poco, j.data, j.resp1, j.resp2, j.pColuna, j.pSup, JSON.stringify(j.comp || {})].map(texto).join('|');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < base.length; i++) {
    h1 = Math.imul(h1 ^ base.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ base.charCodeAt(base.length - 1 - i), 2246822519) >>> 0;
  }
  const hex = (n) => n.toString(16).padStart(8, '0');
  const s = hex(h1) + hex(h2) + hex((Math.imul(h1, 31) ^ h2) >>> 0) + hex((h2 ^ 0x5bd1e995) >>> 0);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/** Categoria da foto dentro do componente (as do BDO-e), pela legenda. */
function categoria(p, legenda) {
  const comp = [...VALVULAS_CABECA, ...FLANGES].find((c) => c.p === p);
  if (!comp) return null;
  if (ehFlange(p)) return /di[âa]metro|comprimento|medi|paqu|trena/i.test(legenda) ? comp.fotos[0] : comp.fotos[1];
  if (/teste/i.test(legenda)) return comp.fotos.find((c) => /teste/i.test(c)) || comp.fotos[0];
  return comp.fotos[0];
}

/** Rascunho do app anterior → { uniqueId, module: 'visita_tecnica', data, fotos: [{ field, category, legenda, name, dataUrl }] } */
export function rascunhoVisitaParaRelatorio(j) {
  const data = {
    poco: texto(j.poco),
    campo: texto(j.locacao),
    data: /^\d{4}-\d{2}-\d{2}/.test(texto(j.data)) ? texto(j.data).slice(0, 10) : '',
    equipe: [j.resp1, j.resp2].map(texto).filter(Boolean).map((nome, i) => ({ nome, funcao: i === 0 ? 'Técnico' : '' })),
    pressoes: [
      { item: 'Coluna', valor: texto(j.pColuna), unidade: 'psi' },
      { item: 'Anular superior', valor: texto(j.pSup), unidade: 'psi' },
      { item: 'Anular inferior', valor: texto(j.pInf), unidade: 'psi' },
      ...(simNao(j.anularInterm) === 'Sim' ? [{ item: 'Anular intermediário', valor: texto(j.pInterm), unidade: 'psi' }] : [])
    ],
    obs_iniciais: [texto(j.obsIniciais), texto(j.justPress) && `Pressões: ${texto(j.justPress)}`].filter(Boolean).join('\n'),
    antepoco_checklist: [
      ['Sugador (carro sugador)', j.ante?.sugador], ['Limpeza química', j.ante?.quimica],
      ['Limpeza mecânica', j.ante?.limpMec], ['Quebra (estrutura danificada)', j.ante?.quebra]
    ].map(([item, v]) => ({ item, situacao: simNao(v) })),
    obs_antepoco: texto(j.anteObs),
    outras_recomendacoes: texto(j.r_recom),
    _importado_de: 'rascunho-visita'
  };

  for (const [chave, p] of Object.entries(COMPONENTES)) {
    const c = j.comp?.[chave];
    if (!c) continue;
    if (ehFlange(p)) {
      Object.assign(data, {
        [`${p}_parafusos`]: texto(c.parafusos), [`${p}_tamanho`]: texto(c.tamanho), [`${p}_corrosao`]: texto(c.corrosao),
        [`${p}_prisioneiros`]: simNao(c.prisioneiro), [`${p}_intervencao`]: simNao(c.intervencao), [`${p}_obs`]: texto(c.obs)
      });
      continue;
    }
    const v = VALVULAS_CABECA.find((x) => x.p === p);
    const ab = abertura(c.abertura);
    // só a VC tem o campo de abertura; nas outras, abertura fora do normal vai para as observações
    const obsAbertura = !v.abertura && texto(c.abertura) && ab !== 'Abre e fecha normalmente'
      ? `Abertura / fechamento: ${juntar(c.abertura, c.justAbertura)}` : (v.abertura && texto(c.justAbertura) ? `Abertura: ${texto(c.justAbertura)}` : '');
    Object.assign(data, {
      [`${p}_config`]: texto(c.condicao),
      ...(v.abertura ? { [`${p}_abertura`]: ab } : {}),
      [`${p}_estanqueidade`]: estanqueidade(c.estanque),
      [`${p}_intervencao`]: simNao(c.intervencao),
      [`${p}_obs`]: [texto(c.obs), obsAbertura, texto(c.justEstanque) && `Estanqueidade: ${texto(c.justEstanque)}`].filter(Boolean).join('\n')
    });
  }

  // fotos: chave → componente (comp_<C>_<n> ou listas compExtra / outraExtra) + legenda de caps
  const extraDe = new Map();
  for (const [chave, ids] of Object.entries(j.compExtra || {})) for (const id of ids || []) extraDe.set(id, chave);
  const outras = new Set(j.outraExtra || []);
  const fotos = [];
  for (const [chave, dataUrl] of Object.entries(j.photos || {})) {
    const legenda = texto(j.caps?.[chave]);
    let field = 'fotos';
    let category = 'Outras';
    const m = /^comp_([A-Z0-9]+)_\d+$/.exec(chave);
    const comp = COMPONENTES[m?.[1] || extraDe.get(chave)];
    if (chave === 'fotoGeral') { field = 'fotos_chegada'; category = 'Placa do poço'; }
    else if (chave === 'ante_placa') { field = 'fotos_chegada'; category = 'Conjunto / Árvore de Natal'; }
    else if (/^ante_/.test(chave)) { field = `fotos_${ANTEPOCO.p}`; category = ANTEPOCO.fotos[0]; }
    else if (chave === 'man_coluna') { field = 'fotos_manometros'; category = 'Manômetro da coluna'; }
    else if (chave === 'man_sup') { field = 'fotos_manometros'; category = 'Manômetro do anular superior'; }
    else if (/^man_/.test(chave)) { field = 'fotos_manometros'; category = 'Manômetro do anular inferior'; }
    else if (comp) { field = `fotos_${comp}`; category = categoria(comp, legenda); }
    else if (outras.has(chave)) { field = 'fotos'; category = 'Outras'; }
    fotos.push({ field, category, legenda, name: `${chave}.jpg`, dataUrl });
  }

  return { uniqueId: idEstavel(j), module: 'visita_tecnica', createdAt: null, data, fotos };
}
