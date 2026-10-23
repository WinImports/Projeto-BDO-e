// Assistente Técnico de Flanges (Visita Técnica) — busca CRUZADA, em qualquer ordem.
//
// O técnico preenche o que souber, na ordem que quiser: Flange, Pressão, Nº de parafusos (furos), Anel, Diâmetro
// ou Comprimento do prisioneiro (pol ou mm), Chave (mm ou pol) ou Torque (Nm ou lbf·ft). O app cruza tudo com a
// tabela (src/shared/flangeTable.js): cada caixa passa a oferecer só as opções que ainda combinam com o resto e,
// quando sobra um flange só, completa os demais campos. Enquanto sobram vários, preenche o que for comum a todos.
//
// - Só conta como filtro o que o técnico digitou/escolheu. O que o app preencheu (data._flange_sug) não filtra —
//   senão, ao trocar a pressão, os valores antigos travariam a busca — e é trocado na próxima sugestão.
// - Valor digitado que não existe em nenhuma linha (ex.: anel "R-45 inox") é anotação: fica no campo e não filtra.
// - Filtros que se contradizem: nenhum flange; o card mostra quantos voltariam se cada campo fosse limpo.
// - "3/5M" na tabela vale para 3M e 5M; "2 1/16" DL" é o flange 2 1/16" (variação com 6 furos).

import { FLANGE_TABLE } from '../shared/flangeTable.js';

export const NOTA_TORQUE = 'Torque de referência. Siga o procedimento aprovado do cliente.';
export const PRESSOES = ['2M', '3M', '5M', '10M'];
export const CAMPOS = ['modelo', 'pressao', 'parafusos', 'anel', 'diametro', 'comprimento', 'chave', 'torque'];
export const ROTULOS = {
  modelo: 'Flange', pressao: 'Pressão', parafusos: 'Nº de parafusos', anel: 'Anel', diametro: 'Diâmetro',
  comprimento: 'Comprimento', chave: 'Chave', torque: 'Torque'
};

/** Flange sem o sufixo de variação ("2 1/16" DL" → "2 1/16""). */
export const base = (f) => String(f || '').replace(/\s*DL\s*$/i, '').trim();

/** Polegadas em número: "13 5/8"" → 13.625; "1-7/16"" → 1.4375; "7/8" → 0.875; "2"" → 2. NaN se não for medida. */
export function polegadas(t) {
  const s = String(t ?? '').replace(/["”″]|pol\.?|polegadas?/gi, '').trim().replace(/^(\d+)-(\d+\/\d+)$/, '$1 $2');
  const m = /^(\d+)?(?:\s*(\d+)\/(\d+))?$/.exec(s);
  if (!s || !m || (!m[1] && !m[2])) return NaN;
  return Number(m[1] || 0) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

/** Números de um texto em pt-BR ou não: "1.727 Nm" → [1727]; "22,23 mm" → [22.23]; "22.23" → [22.23]. */
export function numeros(t) {
  return (String(t ?? '').match(/\d+(?:[.,]\d+)*/g) || []).map((tok) => (
    /^\d{1,3}(\.\d{3})+$/.test(tok) ? Number(tok.replace(/\./g, '')) : Number(tok.replace(',', '.'))
  )).filter((n) => Number.isFinite(n));
}

const iguais = (a, b, tol) => Math.abs(a - b) <= tol;

/** Medida em polegadas ou mm ("7/8"", "22,23", "22.23 mm", "7/8" (22,23 mm)", "36 mm / 1-7/16"", "1-7/16""). */
function casaMedida(valor, pol, mm) {
  const t = String(valor).toLowerCase();
  const antes = t.split(/[(/]\s*\d+\s*mm|\(/)[0].trim(); // parte em polegadas, antes do "(… mm)"
  const temPol = /["”″]|\d\/\d|pol/.test(antes);
  if (temPol && iguais(polegadas(antes), polegadas(pol), 0.002)) return true;
  const mmTexto = (t.match(/[\d.,]+\s*mm/g) || []).join(' ');
  if (mmTexto) return numeros(mmTexto).some((n) => iguais(n, mm, 0.15));
  if (temPol) return false;
  // número sem unidade: vale como mm ou como polegadas ("22,23" ou "1")
  const n = numeros(antes);
  return n.length === 1 && (iguais(n[0], mm, 0.15) || iguais(n[0], polegadas(pol), 0.002));
}

const normPressao = (t) => {
  const s = String(t ?? '').toUpperCase().replace(/PSI|\s/g, '');
  if (/^\d+(\.\d+)?M$/.test(s)) return s;
  const n = numeros(t)[0];
  return n >= 1000 ? `${n / 1000}M` : s;
};
const casaPressao = (linha, p) => linha.pressao === p || (linha.pressao === '3/5M' && (p === '3M' || p === '5M'));
const normAnel = (t) => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A linha da tabela combina com o valor deste campo? */
export function casa(campo, valor, l) {
  switch (campo) {
    case 'modelo': return iguais(polegadas(base(valor)), polegadas(base(l.flange)), 0.002);
    case 'pressao': return casaPressao(l, normPressao(valor));
    case 'parafusos': return Number(valor) === l.furos;
    case 'anel': return normAnel(valor) === normAnel(l.anel);
    case 'diametro': return casaMedida(valor, l.diam_pol, l.diam_mm);
    case 'comprimento': return casaMedida(valor, l.compr_pol, l.compr_mm);
    case 'chave': return casaMedida(valor, l.chave_pol, l.chave_mm);
    case 'torque': {
      const t = String(valor).toLowerCase();
      const n = numeros(t);
      if (/lb/.test(t) && !/nm/.test(t)) return n.some((x) => iguais(x, l.torque_lbfft, 1));
      return n.some((x) => iguais(x, l.torque_nm, 1) || iguais(x, l.torque_lbfft, 1));
    }
    default: return true;
  }
}

const num = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Texto sugerido de cada campo para uma linha. */
export function sugestoes(l) {
  return {
    modelo: base(l.flange),
    parafusos: String(l.furos),
    anel: l.anel,
    diametro: `${l.diam_pol} (${num(l.diam_mm)} mm)`,
    comprimento: `${l.compr_pol} (${num(l.compr_mm)} mm)`,
    chave: `${l.chave_mm} mm / ${l.chave_pol}`,
    torque: `${num(l.torque_nm)} Nm / ${num(l.torque_lbfft)} lbf·ft`
  };
}

/** Valores que a linha oferece para o campo ("3/5M" → ["3M", "5M"]). */
export function valoresDe(l, campo) {
  if (campo === 'pressao') return l.pressao === '3/5M' ? ['3M', '5M'] : [l.pressao];
  return [sugestoes(l)[campo]];
}

/** Flanges da tabela (sem repetir as variações), do menor para o maior. */
export const MODELOS = [...new Set(FLANGE_TABLE.map((r) => base(r.flange)))].sort((a, b) => polegadas(a) - polegadas(b));

/** Rótulo curto de uma linha (opções do card). */
export const rotuloLinha = (l) => `${l.flange} ${l.pressao} · ${l.furos} furos · anel ${l.anel} · prisioneiro ${l.diam_pol} x ${l.compr_pol}`;

const vazio = (v) => v == null || String(v).trim() === '';

/**
 * Situação do flange p (ex.: 'flange_sup'):
 * { filtros: {campo: valor} (o que o técnico preencheu e existe na tabela), ignorados: {campo: valor}
 *   (digitado, mas não existe na tabela), linhas (combinam com todos os filtros),
 *   status: 'incompleto' | 'nenhum' | 'unico' | 'multiplo', semCampo: {campo: nº de linhas se ele fosse limpo} }
 */
export function analisar(data, p) {
  const sug = data._flange_sug?.[p] || {};
  const filtros = {};
  const ignorados = {};
  for (const c of CAMPOS) {
    const v = data[`${p}_${c}`];
    if (vazio(v) || (sug[c] != null && String(v) === String(sug[c]))) continue; // vazio ou preenchido pelo app
    if (FLANGE_TABLE.some((l) => casa(c, v, l))) filtros[c] = v; else ignorados[c] = v;
  }
  const passa = (l, exceto) => Object.entries(filtros).every(([c, v]) => c === exceto || casa(c, v, l));
  const linhas = FLANGE_TABLE.filter((l) => passa(l));
  const status = !Object.keys(filtros).length ? 'incompleto' : !linhas.length ? 'nenhum' : linhas.length === 1 ? 'unico' : 'multiplo';
  const semCampo = {};
  if (status === 'nenhum') for (const c of Object.keys(filtros)) semCampo[c] = FLANGE_TABLE.filter((l) => passa(l, c)).length;
  return { filtros, ignorados, linhas, status, semCampo, passa };
}

/**
 * Opções que ainda combinam para um campo (cruzando todos os OUTROS filtros), na ordem da tabela de flanges.
 * Para Flange e Pressão também devolve as que não combinam (para o select mostrar separado).
 */
export function opcoesDe(data, p, campo) {
  const a = analisar(data, p);
  const todas = campo === 'modelo' ? MODELOS : campo === 'pressao' ? PRESSOES
    : [...new Set(FLANGE_TABLE.flatMap((l) => valoresDe(l, campo)))];
  const compat = new Set(FLANGE_TABLE.filter((l) => a.passa(l, campo)).flatMap((l) => valoresDe(l, campo)));
  const ordenar = (lista) => (campo === 'parafusos' ? [...lista].sort((x, y) => Number(x) - Number(y)) : lista);
  return { combinam: ordenar(todas.filter((v) => compat.has(v))), outras: ordenar(todas.filter((v) => !compat.has(v))) };
}

/**
 * Aplica as sugestões no flange p: campo vazio ou ainda com a última sugestão recebe o valor comum a todos os
 * flanges que combinam (todos, quando sobra um só); o que o técnico preencheu fica. Devolve { resultado, mudou }.
 */
export function aplicarSugestao(data, p) {
  const resultado = analisar(data, p);
  const novas = {};
  if (resultado.linhas.length) {
    for (const c of CAMPOS) {
      if (c in resultado.filtros) continue;
      const vals = [...new Set(resultado.linhas.flatMap((l) => valoresDe(l, c)))];
      if (vals.length === 1) novas[c] = vals[0];
    }
  }
  const anteriores = data._flange_sug?.[p] || {};
  const registro = {};
  const mudou = [];
  for (const c of CAMPOS) {
    const id = `${p}_${c}`;
    const atual = String(data[id] ?? '');
    if (atual !== '' && atual !== String(anteriores[c] ?? '')) continue; // preenchido pelo técnico: fica
    const novo = novas[c] ?? '';
    if (atual !== novo) { data[id] = novo; mudou.push(id); }
    registro[c] = novo;
  }
  data._flange_sug = { ...(data._flange_sug || {}), [p]: registro };
  return { resultado: analisar(data, p), mudou };
}

/** O técnico escolheu uma linha no card: Flange, furos, anel (e a pressão, se a linha tiver uma só) viram dele. */
export function escolherLinha(data, p, indice) {
  const l = FLANGE_TABLE[indice];
  if (!l) return [];
  const valores = { modelo: base(l.flange), parafusos: String(l.furos), anel: l.anel };
  if (l.pressao !== '3/5M') valores.pressao = l.pressao;
  else if (!casaPressao(l, normPressao(data[`${p}_pressao`]))) valores.pressao = '';
  const sug = { ...(data._flange_sug?.[p] || {}) };
  for (const [c, v] of Object.entries(valores)) { data[`${p}_${c}`] = v; delete sug[c]; }
  data._flange_sug = { ...(data._flange_sug || {}), [p]: sug };
  return Object.keys(valores).map((c) => `${p}_${c}`);
}

/** Limpa um campo do flange (botão do card quando os filtros se contradizem). */
export function limparCampo(data, p, campo) {
  data[`${p}_${campo}`] = '';
  const sug = { ...(data._flange_sug?.[p] || {}) };
  delete sug[campo];
  data._flange_sug = { ...(data._flange_sug || {}), [p]: sug };
}

export { FLANGE_TABLE };
