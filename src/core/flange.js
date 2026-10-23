// Assistente Técnico de Flanges (Visita Técnica): a partir de Flange + Pressão (e dos Furos, para desempatar)
// sugere Diâmetro e Comprimento do prisioneiro, Anel de vedação, Chave e Torque da tabela src/shared/flangeTable.js.
//
// - "3/5M" na tabela vale para 3M e para 5M. O sufixo "DL" é variação do mesmo flange (outro nº de furos):
//   "2 1/16"" em 3M/5M tem duas linhas (6 furos DL e 8 furos) e os Furos decidem.
// - Mais de uma linha mesmo com os furos: nada é preenchido; o card mostra as opções para o técnico escolher.
// - Os campos continuam editáveis. Ao trocar Flange/Pressão/Furos só muda o campo que ainda está com a última
//   sugestão (ou vazio); o que o técnico digitou à mão fica. A última sugestão de cada flange vai em data._flange_sug.

import { FLANGE_TABLE } from '../shared/flangeTable.js';

export const NOTA_TORQUE = 'Torque de referência. Siga o procedimento aprovado do cliente.';
export const PRESSOES = ['2M', '3M', '5M', '10M'];
export const CAMPOS_SUGERIDOS = ['diametro', 'comprimento', 'anel', 'chave', 'torque'];

/** Flange sem o sufixo de variação ("2 1/16" DL" → "2 1/16""). */
const base = (f) => String(f || '').replace(/\s*DL\s*$/i, '').trim();

/** "13 5/8"" → 13.625 (para ordenar). */
function polegadas(t) {
  const m = /^(\d+)(?:\s+(\d+)\/(\d+))?/.exec(String(t || ''));
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0) : Infinity;
}

/** Flanges da tabela (sem repetir as variações), do menor para o maior. */
export const MODELOS = [...new Set(FLANGE_TABLE.map((r) => base(r.flange)))].sort((a, b) => polegadas(a) - polegadas(b));

const casaPressao = (linha, pressao) => linha.pressao === pressao || (linha.pressao === '3/5M' && (pressao === '3M' || pressao === '5M'));

/**
 * Busca na tabela. Devolve { status, linhas, linha? }:
 *   'incompleto' (falta flange ou pressão) · 'nenhum' (combinação fora da tabela) ·
 *   'unico' (linha = a sugestão) · 'multiplo' (escolher: informe os furos ou toque numa opção).
 * furosDivergem: na linha única, os furos informados não batem com a tabela (aviso no card).
 */
export function buscarFlange(modelo, pressao, furos) {
  if (!modelo || !pressao) return { status: 'incompleto', linhas: [] };
  let linhas = FLANGE_TABLE.filter((r) => base(r.flange) === base(modelo) && casaPressao(r, pressao));
  if (!linhas.length) return { status: 'nenhum', linhas };
  const n = Number(furos);
  if (linhas.length > 1 && n > 0) {
    const comFuros = linhas.filter((r) => r.furos === n);
    if (comFuros.length) linhas = comFuros;
  }
  if (linhas.length > 1) return { status: 'multiplo', linhas };
  const [linha] = linhas;
  return { status: 'unico', linha, linhas, furosDivergem: n > 0 && n !== linha.furos };
}

const num = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Valores sugeridos (texto dos campos) para uma linha da tabela. */
export function sugestoes(linha) {
  return {
    diametro: `${linha.diam_pol} (${num(linha.diam_mm)} mm)`,
    comprimento: `${linha.compr_pol} (${num(linha.compr_mm)} mm)`,
    anel: linha.anel,
    chave: `${linha.chave_mm} mm / ${linha.chave_pol}`,
    torque: `${num(linha.torque_nm)} Nm / ${num(linha.torque_lbfft)} lbf·ft`
  };
}

/** Rótulo curto de uma linha (opções do card quando há mais de uma). */
export const rotuloLinha = (l) => `${l.flange} ${l.pressao} · ${l.furos} furos · anel ${l.anel} · prisioneiro ${l.diam_pol} x ${l.compr_pol}`;

/**
 * Aplica a sugestão do flange de prefixo p (ex.: 'flange_sup') em data. Só troca campos vazios ou que ainda
 * estão com a última sugestão. Devolve { resultado (buscarFlange), mudou: [ids alterados] }.
 */
export function aplicarSugestao(data, p) {
  const resultado = buscarFlange(data[`${p}_modelo`], data[`${p}_pressao`], data[`${p}_parafusos`]);
  const novas = resultado.status === 'unico' ? sugestoes(resultado.linha) : {};
  const anteriores = data._flange_sug?.[p] || {};
  const registro = {};
  const mudou = [];
  for (const c of CAMPOS_SUGERIDOS) {
    const id = `${p}_${c}`;
    const atual = String(data[id] ?? '');
    if (atual !== '' && atual !== (anteriores[c] ?? '')) continue; // editado à mão: fica
    const novo = novas[c] ?? '';
    if (atual !== novo) { data[id] = novo; mudou.push(id); }
    registro[c] = novo;
  }
  data._flange_sug = { ...(data._flange_sug || {}), [p]: registro };
  return { resultado, mudou };
}
