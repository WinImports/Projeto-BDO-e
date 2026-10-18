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
//                       computed: (row) => valor (coluna calculada, somente leitura),
//                       routeTrigger: true → "deslocamento"/"mobilização" digitado oferece a rota até o poço }],
//            presetRows (linhas pré-definidas), allowAdd (padrão true), addLabel
// photos:    categories (uma "vaga" por foto esperada, com botões Arquivo / Câmera e legenda por foto);
//            vários campos photos por relatório: cada foto guarda o campo (p.field). No PDF viram
//            "Figura N — legenda" logo abaixo do componente. compare: true → bloco "Antes (Visita) x Depois"
// computed:  compute(data) → texto gerado (ex.: parágrafo de abertura), também vai para o PDF
// Seção legacy: true → não aparece no formulário; só na prévia/PDF de relatórios antigos que tenham esses dados

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

export const PONTOS_PRESSAO = ['Coluna', 'Anular superior', 'Anular inferior'];

export const pressoes = ({ id = 'pressoes', label = '', pontos = PONTOS_PRESSAO } = {}) => ({
  id, label, type: 'table', allowAdd: false,
  presetRows: pontos.map((item) => ({ item, unidade: 'psi' })),
  columns: [
    { id: 'item', label: 'Ponto de leitura', locked: true },
    { id: 'valor', label: 'Pressão', type: 'number', placeholder: '0' },
    { id: 'unidade', label: 'Unidade', type: 'select', options: UNIDADES_PRESSAO, aux: true, width: 'narrow' }
  ]
});

export const PRIORIDADES = ['Alta', 'Média', 'Baixa'];

export const TURNOS = ['Diurno', 'Noturno', 'Integral'];

// Coordenadas SOMENTE pelo GPS ou pelo poço da base (sem digitação) + rota até a locação (valor: { lat, lng, accuracy, source, capturedAt })
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

/** Bloco de fotos de um componente (vagas = legendas sugeridas). */
export const fotosDe = (id, label, categories, extra = {}) => ({ id, label, type: 'photos', categories, ...extra });

// ---------- Componentes da cabeça de poço (Visita Técnica e Relatório de Execução) ----------
// Mesmos ids de fotos nos dois relatórios: as fotos "Antes" da Visita vão para o bloco do mesmo componente na Execução.

export const FOTOS_CHEGADA = ['Placa do poço', 'Conjunto / Árvore de Natal'];
export const FOTOS_MANOMETROS = ['Manômetro da coluna', 'Manômetro do anular superior', 'Manômetro do anular inferior'];
export const FOTOS_OUTRAS = ['Conjunto e locação', 'Outras'];

export const ANTEPOCO = { p: 'antepoco', nome: 'Antipoço', fotos: ['Antipoço', 'Antipoço após limpeza'] };

export const VALVULAS_CABECA = [
  { p: 'vc', nome: 'VC — Válvula da Coluna', short: 'VC', abertura: true, fotos: ['Válvula da coluna (VC)', 'Teste de estanqueidade / backup'] },
  { p: 'va1', nome: 'VA-1 — Válvula Anular 1 Superior', short: 'VA-1', fotos: ['VA-1', 'Teste de estanqueidade'] },
  { p: 'va2', nome: 'VA-2 — Válvula Anular 2 Superior', short: 'VA-2', fotos: ['VA-2', 'Teste de estanqueidade'] },
  { p: 'vb1', nome: 'VB-1 — Válvula Anular Inferior 1', short: 'VB-1', fotos: ['VB-1', 'Teste com Enerpac'] },
  { p: 'vb2', nome: 'VB-2 — Válvula Anular Inferior 2', short: 'VB-2', fotos: ['VB-2'] }
];

export const FLANGES = [
  { p: 'flange_sup', nome: 'Flange da cabeça superior', short: 'Flange superior', fotos: ['Medição com paquímetro / trena', 'Vista do flange'] },
  { p: 'flange_inf', nome: 'Flange inferior', short: 'Flange inferior', fotos: ['Medição com paquímetro / trena', 'Vista do flange'] }
];

export const ESTANQUEIDADE = ['Estanque', 'Sem estanqueidade (vazamento)', 'Não testada'];
export const ABERTURA = ['Abre e fecha normalmente', 'Abre / fecha com dificuldade', 'Não opera (travada)', 'Não testada'];
export const CORROSAO = ['Sem corrosão', 'Leve', 'Moderada', 'Severa'];

const brData = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const juntar = (lista) => (lista.length > 1 ? `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}` : lista[0] || '');

/**
 * Parágrafo de abertura gerado a partir do cabeçalho.
 * verbo: 'fizemos uma visita técnica ao' | 'executamos os serviços no'
 */
export function paragrafoAbertura(d, { verbo, equipe, acompanhantes, data }) {
  const dia = brData(d[data]);
  if (!d.poco || !dia) return '';
  const nomes = String(d[equipe] || '').split(/\s*[,;]\s*/).filter(Boolean);
  const partes = [`No dia ${dia} ${verbo} poço ${String(d.poco).trim()}`];
  if (d.campo) partes[0] += `, localizado em ${String(d.campo).trim()}`;
  if (nomes.length) partes.push(`com a equipe formada por ${juntar(nomes)}`);
  if (acompanhantes && d[acompanhantes]) partes.push(`acompanhados por ${String(d[acompanhantes]).trim()}`);
  let texto = partes.join(', ');
  if (d.objetivo) texto += `, com o objetivo de ${String(d.objetivo).trim().replace(/^[A-ZÀ-Ú]/, (c) => c.toLowerCase()).replace(/[.\s]+$/, '')}`;
  return `${texto}.`;
}
