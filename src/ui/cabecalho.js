// Quadro de identificação do cabeçalho dos relatórios (prévia, PDF e Word).
// Só estes dados vão para o cabeçalho — sem coordenadas GPS nem links de rota — e eles não se
// repetem no corpo do relatório.
import { displayValue } from './form.js';
import { equipeTexto } from '../modules/common.js';

/** [rótulo, ids possíveis do campo (o primeiro que existir no módulo)] */
const ITENS = [
  ['Poço / Locação', ['poco']],
  ['Cidade / Campo', ['campo', 'cidade_uf']],
  ['Data', ['data', 'data_hora']],
  ['Turno', ['turno']],
  ['Cliente', ['cliente']],
  ['Contrato', ['contrato']],
  ['Equipe', ['equipe']]
];

/** Ids dos campos mostrados no cabeçalho (omitidos no corpo). */
export const CAMPOS_CABECALHO = new Set(ITENS.flatMap(([, ids]) => ids));

const camposDo = (module) => {
  const m = new Map();
  for (const f of module.sections.flatMap((s) => s.fields)) if (f.id && !m.has(f.id)) m.set(f.id, f);
  return m;
};

/**
 * Itens preenchidos do cabeçalho: [{ label, value, full }]. Equipe ocupa a linha inteira.
 */
export function cabecalhoItens(module, data) {
  const campos = camposDo(module);
  const out = [];
  for (const [label, ids] of ITENS) {
    const id = ids.find((x) => campos.has(x) && String(data[x] ?? '').trim()) || ids.find((x) => campos.has(x));
    if (!id) continue;
    const value = id === 'equipe' ? equipeTexto(data) : displayValue(campos.get(id), data[id]);
    if (value) out.push({ label, value, full: id === 'equipe' });
  }
  return out;
}
