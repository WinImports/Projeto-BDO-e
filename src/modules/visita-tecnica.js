// Relatório de Visita Técnica — sequência cronológica de campo (modelo Word oficial):
// cabeçalho → chegada ao poço (placa e conjunto) → pressões e manômetros → inspeção de cada
// componente com o SEU bloco de fotos → outras fotos → recomendações e assinatura.
import {
  pocoHerdado, herancaBdo, pressoes, coordenadas, fotosDe, paragrafoAbertura, equipe, PRIORIDADES, TURNOS,
  FOTOS_CHEGADA, FOTOS_MANOMETROS, FOTOS_OUTRAS, ANTEPOCO, VALVULAS_CABECA, VALVULAS_EXTRAS, TODAS_VALVULAS, blocoValvulasExtras, FLANGES, TODOS_FLANGES, nomeDe, tituloAdicional,
  ESTANQUEIDADE, ABERTURA, CORROSAO
} from './common.js';
import { MODELOS, PRESSOES, NOTA_TORQUE } from '../core/flange.js';

const CORRECOES = [
  'Substituição de Válvula',
  'Substituição de Parafusos / Porcas',
  'Reunião de Pré-Tarefa (RPT / APR)',
  'Limpeza com carro sugador',
  'Aterramento e Barricamento'
];

/**
 * Quadro de Ações / Recomendações preenchido a partir da inspeção: componente com
 * "Necessita intervenção? = Sim" (e o diagnóstico) e verificações do antipoço marcadas "Sim".
 * Linhas automáticas levam _auto (chave do componente): somem se a condição deixar de valer.
 */
const ANTEPOCO_ACOES = {
  'Sugador (carro sugador)': 'Necessária a limpeza do antipoço com carro sugador',
  'Limpeza química': 'Necessária a limpeza química do antipoço',
  'Limpeza mecânica': 'Necessária a limpeza mecânica do antipoço',
  'Quebra (estrutura danificada)': 'Necessário o reparo da estrutura do antipoço (quebra)'
};

/** Diagnóstico que gerou a ação (coluna Detalhes): "Diagnóstico — Estanqueidade: …; Necessita intervenção: Sim". */
const diagnostico = (partes) => `Diagnóstico — ${partes.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ')}`;

/** Instrução clara para a coluna Ação / Recomendação a partir do diagnóstico da válvula. */
export function acaoValvula(est, ab) {
  if (est === 'Sem estanqueidade (vazamento)') return 'Necessária a substituição da válvula devido à falta de estanqueidade';
  if (ab === 'Não opera (travada)') return 'Necessário o reparo ou a substituição da válvula, que não opera (travada)';
  if (ab === 'Abre / fecha com dificuldade') return 'Necessária a manutenção da válvula devido à dificuldade de abertura / fechamento';
  if (est === 'Não testada') return 'Necessário realizar o teste de estanqueidade e a intervenção na válvula';
  return 'Necessária intervenção na válvula conforme a inspeção';
}

/** Instrução para o flange a partir da corrosão constatada. */
export function acaoFlange(cor) {
  if (cor === 'Moderada' || cor === 'Severa') return `Necessária a substituição dos parafusos / prisioneiros devido à corrosão ${cor.toLowerCase()}`;
  if (cor === 'Leve') return 'Necessária a limpeza, a proteção anticorrosiva e o reaperto dos parafusos / prisioneiros (corrosão leve)';
  return 'Necessária intervenção no flange (parafusos / prisioneiros) conforme a inspeção';
}

export function acoesAutomaticas(d) {
  const out = [];
  for (const r of d.antepoco_checklist || []) {
    if (r.situacao !== 'Sim' || !ANTEPOCO_ACOES[r.item]) continue;
    out.push({
      _auto: `antepoco:${r.item}`, acao: `Antipoço: ${ANTEPOCO_ACOES[r.item]}`,
      detalhe: diagnostico([[r.item, 'Sim']])
    });
  }
  for (const v of TODAS_VALVULAS) {
    if (d[`${v.p}_intervencao`] !== 'Sim') continue;
    const est = d[`${v.p}_estanqueidade`];
    const ab = d[`${v.p}_abertura`];
    out.push({
      _auto: v.p, acao: `${nomeDe(v, d).short}: ${acaoValvula(est, ab)}`,
      detalhe: diagnostico([['Estanqueidade', est], ['Abertura / fechamento', ab], ['Necessita intervenção', 'Sim']])
    });
  }
  for (const fl of TODOS_FLANGES) {
    if (d[`${fl.p}_intervencao`] !== 'Sim') continue;
    const cor = d[`${fl.p}_corrosao`];
    out.push({
      _auto: fl.p, acao: `${nomeDe(fl, d).short}: ${acaoFlange(cor)}`,
      detalhe: diagnostico([['Corrosão', cor], ['Necessita intervenção', 'Sim']])
    });
  }
  return out;
}

const valvula = (v, n) => ({
  title: v.opcional ? tituloAdicional(v) : `${n}. ${v.nome}`,
  opcional: v.opcional ? v.p : undefined,
  comp: v.p, // nome renomeável pelo gestor (comNomes)
  short: v.short,
  icon: 'gauge',
  hint: 'Deixe em branco se a válvula não existir neste poço.',
  fields: [
    { id: `${v.p}_config`, label: 'Configuração', type: 'text', span: 6, placeholder: 'Ex.: gaveta 2 1/16" 5.000 psi, flangeada' },
    ...(v.abertura ? [{ id: `${v.p}_abertura`, label: 'Abertura / fechamento', type: 'select', span: 6, options: ABERTURA }] : []),
    { id: `${v.p}_estanqueidade`, label: 'Estanqueidade', type: 'select', span: 6, options: ESTANQUEIDADE },
    { id: `${v.p}_intervencao`, label: 'Necessita intervenção?', type: 'yesno', span: 6 },
    { id: `${v.p}_obs`, label: 'Observações', type: 'textarea' },
    fotosDe(`fotos_${v.p}`, `Fotos — ${v.short}`, v.fotos)
  ]
});

const flange = (fl, n) => ({
  title: fl.opcional ? tituloAdicional(fl) : `${n}. ${fl.nome}`,
  opcional: fl.opcional ? fl.p : undefined,
  comp: fl.p,
  short: fl.short,
  icon: 'wrench',
  fields: [
    // Assistente Técnico de Flanges (core/flange.js): busca cruzada — preencha qualquer campo, em qualquer ordem;
    // as caixas oferecem só o que ainda combina e, sobrando um flange, o resto é completado
    { type: 'divider', label: 'Flange, prisioneiros e torque — preencha qualquer campo, em qualquer ordem', icon: 'wrench' },
    { id: `${fl.p}_modelo`, label: 'Flange', pdfLabel: 'Modelo do flange', type: 'select', options: MODELOS, reportAlways: true, flange: fl.p, flangeCampo: 'modelo' },
    { id: `${fl.p}_pressao`, label: 'Pressão', pdfLabel: 'Pressão do flange', type: 'select', options: PRESSOES, reportAlways: true, flange: fl.p, flangeCampo: 'pressao' },
    { id: `${fl.p}_parafusos`, label: 'Nº de parafusos (furos)', type: 'number', min: 0, step: 1, flange: fl.p, flangeCampo: 'parafusos' },
    { id: `${fl.p}_anel`, label: 'Anel de vedação', pdfLabel: 'Tipo de anel de vedação', type: 'text', reportAlways: true, placeholder: 'Ex.: R-45, BX-160', flange: fl.p, flangeCampo: 'anel' },
    { id: `${fl.p}_diametro`, label: 'Diâmetro do prisioneiro', type: 'text', span: 6, placeholder: 'Pol ou mm. Ex.: 7/8" ou 22,23', flange: fl.p, flangeCampo: 'diametro' },
    { id: `${fl.p}_comprimento`, label: 'Comprimento do prisioneiro', type: 'text', span: 6, placeholder: 'Pol ou mm. Ex.: 6" ou 152,4', flange: fl.p, flangeCampo: 'comprimento' },
    { id: `${fl.p}_chave`, label: 'Chave', pdfLabel: 'Tamanho da chave', type: 'text', span: 6, reportAlways: true, placeholder: 'mm ou pol. Ex.: 36 ou 1-7/16"', flange: fl.p, flangeCampo: 'chave' },
    { id: `${fl.p}_torque`, label: 'Torque recomendado', pdfLabel: 'Torque recomendado (Nm / lbf·ft)', type: 'text', span: 6, reportAlways: true, reportNote: NOTA_TORQUE, placeholder: 'Nm ou lbf·ft', flange: fl.p, flangeCampo: 'torque' },
    { id: `${fl.p}_apoio`, type: 'flangeCard', flange: fl.p, full: true },
    // relatórios antigos: o tamanho digitado à mão continua no PDF/Word (fora do formulário)
    { id: `${fl.p}_tamanho`, label: 'Tamanho dos parafusos', type: 'text', formHidden: true },
    { id: `${fl.p}_corrosao`, label: 'Corrosão', type: 'select', options: CORROSAO },
    { id: `${fl.p}_prisioneiros`, label: 'Prisioneiros?', type: 'yesno' },
    { id: `${fl.p}_intervencao`, label: 'Necessita intervenção?', type: 'yesno', span: 6 },
    { id: `${fl.p}_obs`, label: 'Observações', type: 'textarea' },
    fotosDe(`fotos_${fl.p}`, `Fotos — ${fl.short} (medições e vistas)`, fl.fotos)
  ]
});

export default {
  etapas: true, // seções recolhidas: tocar abre, "Concluir etapa" fecha e abre a próxima (form.js)
  id: 'visita_tecnica',
  title: 'Relatório de Visita Técnica',
  shortTitle: 'Relatório de Visita Técnica',
  subtitle: 'Inspeção de cabeça de poço',
  icon: 'search',
  sections: [
    {
      title: 'Cabeçalho e dados gerais',
      short: 'Cabeçalho',
      icon: 'clipboard',
      fields: [
        { type: 'divider', label: 'Poço e data', icon: 'mapPin' },
        pocoHerdado(),
        { id: 'campo', label: 'Locação / Campo', type: 'text', placeholder: 'Ex.: Campo de Buracica' },
        { id: 'data', label: 'Data da visita', type: 'date', required: true },
        { id: 'turno', label: 'Turno', type: 'select', options: TURNOS },
        { id: 'cliente', label: 'Cliente / Contratante', type: 'text', required: true, settingsKey: 'cliente_padrao' },
        { id: 'contrato', label: 'Contrato', type: 'contrato', settingsKey: 'contrato_padrao' },
        { type: 'divider', label: 'Equipe', icon: 'users' },
        equipe(),
        { type: 'divider', label: 'Objetivo da visita', icon: 'flag' },
        {
          // definido pelo gestor em Ajustes › Objetivos dos relatórios (por contrato); não aparece no formulário
          id: 'objetivo', label: 'Objetivo', type: 'textarea', formHidden: true, objetivoTipo: 'visita',
          defaultValue: 'Avaliar as condições da cabeça de poço (antipoço, válvulas e flanges), verificando estanqueidade, operação e corrosão, e indicar as intervenções necessárias',
          placeholder: 'Ex.: avaliar as condições das válvulas e flanges da cabeça de poço'
        },
        {
          // gerado em segundo plano: no formulário só um botão de prévia; o texto sai na prévia/PDF
          id: 'introducao', label: 'Texto de abertura', pdfLabel: 'Introdução', type: 'computed', previewButton: true,
          compute: (d) => paragrafoAbertura(d, { verbo: 'fizemos uma visita técnica ao', data: 'data', equipeLegado: ['tecnicos', 'acompanhantes'] })
        }
      ]
    },
    {
      title: 'Identificação visual inicial (chegada ao poço)',
      short: 'Chegada ao poço',
      icon: 'camera',
      fields: [
        fotosDe('fotos_chegada', 'Placa do poço e conjunto / árvore de natal', FOTOS_CHEGADA),
        { id: 'status_locacao', label: 'Status da locação', type: 'select', span: 6, options: ['OK', 'Necessita Limpeza', 'Acesso Obstruído'] },
        { id: 'obs_iniciais', label: 'Observações iniciais', type: 'textarea' }
      ]
    },
    {
      title: 'Registro de pressões e manômetros',
      short: 'Pressões',
      icon: 'activity',
      fields: [
        { id: 'hora_leitura', label: 'Hora da leitura', type: 'time' },
        pressoes(),
        fotosDe('fotos_manometros', 'Fotos dos manômetros (uma por medição)', FOTOS_MANOMETROS)
      ]
    },
    {
      title: `1. ${ANTEPOCO.nome}`,
      short: ANTEPOCO.nome,
      icon: 'map',
      fields: [
        {
          id: 'antepoco_checklist', type: 'table', allowAdd: false,
          presetRows: ['Sugador (carro sugador)', 'Limpeza química', 'Limpeza mecânica', 'Quebra (estrutura danificada)'].map((item) => ({ item })),
          columns: [
            { id: 'item', label: 'Verificação', locked: true },
            { id: 'situacao', label: 'Necessário / constatado', type: 'select', options: ['Sim', 'Não', 'N/A'], width: 'medium' },
            { id: 'obs', label: 'Observação' }
          ]
        },
        { id: 'estado_antepoco', label: 'Estado do antipoço', type: 'select', span: 6, options: ['Limpo', 'Cheio de Fluido', 'Necessita Carro Sugador'] },
        { id: 'obs_antepoco', label: 'Observações', type: 'textarea' },
        fotosDe(`fotos_${ANTEPOCO.p}`, 'Fotos — Antipoço', ANTEPOCO.fotos)
      ]
    },
    ...VALVULAS_CABECA.map((v, i) => valvula(v, i + 2)),
    ...VALVULAS_EXTRAS.map((v) => valvula(v)),
    blocoValvulasExtras(),
    ...TODOS_FLANGES.map((fl) => flange(fl, FLANGES.indexOf(fl) + 2 + VALVULAS_CABECA.length)),
    {
      title: 'Outras fotos',
      short: 'Outras fotos',
      icon: 'camera',
      fields: [fotosDe('fotos', 'Fotos gerais do conjunto e da locação', FOTOS_OUTRAS)]
    },
    {
      title: 'Recomendações gerais e assinatura',
      short: 'Recomendações',
      icon: 'listChecks',
      fields: [
        {
          id: 'correcoes', type: 'table',
          presetRows: CORRECOES.map((acao) => ({ acao })),
          addLabel: 'Outra ação',
          columns: [
            { id: 'acao', label: 'Ação / Recomendação', locked: true, width: 'wide', placeholder: 'Descreva a ação' },
            { id: 'necessario', label: 'Necessário', type: 'checkbox' },
            { id: 'detalhe', label: 'Detalhes / especificação', width: 'wide' },
            { id: 'prioridade', label: 'Prioridade', type: 'select', options: PRIORIDADES, width: 'narrow' }
          ]
        },
        { id: 'outras_recomendacoes', label: 'Recomendações gerais', type: 'textarea' },
        { type: 'divider', label: 'Gestor técnico / responsável', icon: 'pen' },
        { id: 'gestor_nome', label: 'Nome', type: 'text', required: true, span: 6, settingsKey: 'tecnico_nome' },
        { id: 'gestor_matricula', label: 'Matrícula / Chave', type: 'text', settingsKey: 'tecnico_matricula' },
        { id: 'gestor_empresa', label: 'Empresa', type: 'text', settingsKey: 'empresa_nome' },
        { id: 'assinatura', label: 'Assinatura do gestor técnico / responsável', type: 'signature' }
      ]
    },
    {
      // Relatórios finalizados antes da reorganização por componente (só prévia/PDF)
      title: 'Inspeção (formato anterior)',
      legacy: true,
      fields: [
        {
          id: 'valvulas', label: 'Válvulas e componentes', type: 'table',
          columns: [{ id: 'item', label: 'Componente' }, { id: 'status', label: 'Status' }, { id: 'obs', label: 'Observação' }]
        },
        {
          id: 'fixadores', label: 'Prisioneiros, parafusos e porcas', type: 'table',
          columns: [{ id: 'item', label: 'Local' }, { id: 'status', label: 'Estado' }, { id: 'obs', label: 'Observação' }]
        },
        { id: 'obs_locacao', label: 'Observações da locação', type: 'textarea' },
        { id: 'tecnicos', label: 'Técnico(s)', type: 'text' },
        { id: 'acompanhantes', label: 'Acompanhantes / Operador', type: 'text' },
        { id: 'frente', label: 'Frente / Equipe', type: 'text' },
        // GPS e rotas ficam no BDO-e: as coordenadas vêm dele (herdaDoBdo) e saem só no cabeçalho do PDF
        coordenadas()
      ]
    }
  ],
  herdaDoBdo: herancaBdo('data'),
  autoRows: { table: 'correcoes', col: 'acao', label: 'Quadro de Ações', defaults: { necessario: true, prioridade: 'Alta' }, rows: acoesAutomaticas }
};
