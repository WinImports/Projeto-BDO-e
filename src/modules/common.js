// Blocos de campos e listas reutilizados pelos módulos.
//
// Tipos de campo suportados pelo renderizador (ui/form.js):
//   text | number | date | time | datetime | select | textarea | checklist | yesno
//   table | photos | signature | geo
// Seção: { title, short (rótulo no índice lateral), icon (nome em ui/icons.js), hint, fields }
// span: largura do campo na grade de 12 colunas (padrão 3; textos longos, tabelas, fotos etc. = 12)
// { type: 'divider', label, icon }: subtítulo que agrupa campos dentro da seção (não entra no PDF)
// highlight: true → campo com destaque visual (formulário, prévia e PDF)
// settingsKey: preenche o campo em relatórios novos com o valor das Configurações (ex.: 'cliente_padrao')
// Propriedades comuns: id, label, type, required, options, unit, placeholder, full, min, max, step, hint
// table:     columns [{ id, label, type: text|number|time|select|checkbox, options, width, placeholder,
//                       locked (fixa nas linhas pré-definidas), aux (não conta como preenchimento),
//                       computed: (row) => valor (coluna calculada, somente leitura) }],
//            presetRows (linhas pré-definidas), allowAdd (padrão true), addLabel
// photos:    categories (lista de categorias; cada uma com botões Arquivo / Câmera)

// autocomplete 'pocos': sugere poços da base oficial (src/data/pocos-ba.json) e, ao escolher,
// preenche as Coordenadas GPS do mesmo relatório
export const poco = () => ({
  id: 'poco', label: 'Poço / Locação', type: 'text', required: true, autocomplete: 'pocos',
  placeholder: 'Digite para buscar (ex.: FBM-89)'
});

export const fotos = (categories) => ({
  title: 'Registro fotográfico',
  short: 'Fotos',
  icon: 'camera',
  fields: [{
    id: 'fotos', type: 'photos', categories,
    hint: 'Fotos ficam salvas neste computador até a sincronização com o servidor.'
  }]
});

export const UNIDADES_PRESSAO = ['psi', 'kgf/cm²'];

export const pressoes = ({ id = 'pressoes', label = '' } = {}) => ({
  id, label, type: 'table', allowAdd: false,
  presetRows: ['Coluna', 'Anular A', 'Anular B'].map((item) => ({ item, unidade: 'psi' })),
  columns: [
    { id: 'item', label: 'Ponto de leitura', locked: true },
    { id: 'valor', label: 'Pressão', type: 'number', placeholder: '0' },
    { id: 'unidade', label: 'Unidade', type: 'select', options: UNIDADES_PRESSAO, aux: true, width: 'narrow' }
  ]
});

export const PRIORIDADES = ['Alta', 'Média', 'Baixa'];

export const TURNOS = ['Diurno', 'Noturno', 'Integral'];

// Captura GPS + edição manual + mapa (valor: { lat, lng, accuracy, source, capturedAt })
// hideLabel: o subtítulo "Coordenadas GPS da locação" já identifica o bloco na tela
export const coordenadas = () => ({ id: 'coordenadas', label: 'Coordenadas GPS', type: 'geo', hideLabel: true });

/** "07:30" → "09:15" = "1h45". Atravessa a meia-noite (turno noturno). */
export function duracao(inicio, fim) {
  const min = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
  const a = min(inicio);
  const b = min(fim);
  if (a == null || b == null) return '';
  const d = (b - a + 1440) % 1440;
  return `${Math.floor(d / 60)}h${String(d % 60).padStart(2, '0')}`;
}

/** Duração com datas explícitas (pode passar de 24h). Sem datas, cai na regra de duracao(). */
export function duracaoEntreDatas(dataIni, horaIni, dataFim, horaFim) {
  if (!dataIni || !dataFim) return duracao(horaIni, horaFim);
  if (!/^\d{2}:\d{2}$/.test(horaIni || '') || !/^\d{2}:\d{2}$/.test(horaFim || '')) return '';
  const min = (new Date(`${dataFim}T${horaFim}`) - new Date(`${dataIni}T${horaIni}`)) / 60000;
  if (!Number.isFinite(min) || min < 0) return '';
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
