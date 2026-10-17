import { poco, fotos, pressoes, coordenadas, PRIORIDADES, TURNOS } from './common.js';

const VALVULAS = ['VA1-A', 'VA2-A', 'VA1-B', 'VA2-B', 'VM (Válvula Mestra)', 'Kerotest', 'Válvula de Esfera'];

const STATUS_VALVULA = [
  'OK / Funcional',
  'Vazamento / Sem Estanqueidade',
  'Bloqueada / Emplacada',
  'Danificada / Substituir'
];

const STATUS_FIXADORES = ['OK', 'Oxidado', 'Desgastado', 'Deformado', 'Sem contraporca', 'Substituir'];

const CORRECOES = [
  'Substituição de Válvula',
  'Substituição de Parafusos / Porcas',
  'Reunião de Pré-Tarefa (RPT / APR)',
  'Limpeza com carro sugador',
  'Aterramento e Barricamento'
];


export default {
  id: 'visita_tecnica',
  title: 'Relatório de Visita Técnica',
  shortTitle: 'Relatório de Visita Técnica',
  subtitle: 'Inspeção de cabeça de poço',
  icon: 'search',
  sections: [
    {
      title: 'Dados gerais',
      icon: 'clipboard',
      fields: [
        { type: 'divider', label: 'Locação e jornada', icon: 'mapPin' },
        poco(),
        { id: 'data', label: 'Data da inspeção', type: 'date', required: true },
        { id: 'turno', label: 'Turno', type: 'select', required: true, options: TURNOS },
        { id: 'frente', label: 'Frente / Equipe', type: 'text', required: true, placeholder: 'Ex.: Equipe de válvulas 02' },
        { type: 'divider', label: 'Responsáveis e cliente', icon: 'users' },
        { id: 'tecnicos', label: 'Técnico(s) responsável(is)', type: 'text', required: true, span: 6, settingsKey: 'tecnico_nome', placeholder: 'Nomes separados por vírgula' },
        { id: 'cliente', label: 'Cliente / Contratante', type: 'text', required: true, settingsKey: 'cliente_padrao' },
        { id: 'contrato', label: 'Contrato', type: 'text', settingsKey: 'contrato_padrao' },
        { type: 'divider', label: 'Coordenadas GPS da locação', icon: 'crosshair' },
        coordenadas()
      ]
    },
    {
      title: 'Condição da locação e antepoço',
      short: 'Locação e antepoço',
      icon: 'map',
      fields: [
        { id: 'status_locacao', label: 'Status da locação', type: 'select', required: true, span: 6, options: ['OK', 'Necessita Limpeza', 'Acesso Obstruído'] },
        { id: 'estado_antepoco', label: 'Estado do antepoço', type: 'select', required: true, span: 6, options: ['Limpo', 'Cheio de Fluido', 'Necessita Carro Sugador'] },
        { id: 'obs_locacao', label: 'Observações da locação', type: 'textarea' }
      ]
    },
    {
      title: 'Inspeção de válvulas e componentes da cabeça de poço',
      short: 'Válvulas e componentes',
      icon: 'gauge',
      hint: 'Deixe o status em branco para componentes inexistentes ou não inspecionados.',
      fields: [{
        id: 'valvulas', type: 'table', required: true,
        presetRows: VALVULAS.map((item) => ({ item })),
        addLabel: 'Outro componente',
        columns: [
          { id: 'item', label: 'Componente', locked: true, placeholder: 'Nome do componente' },
          { id: 'status', label: 'Status', type: 'select', options: STATUS_VALVULA, width: 'medium' },
          { id: 'obs', label: 'Observação' }
        ]
      }]
    },
    {
      title: 'Estado de prisioneiros, parafusos e porcas',
      short: 'Prisioneiros e porcas',
      icon: 'wrench',
      hint: 'Verifique oxidação, desgaste e necessidade de substituição na cabeça de revestimento e de produção.',
      fields: [{
        id: 'fixadores', type: 'table', required: true,
        presetRows: [{ item: 'Cabeça de revestimento' }, { item: 'Cabeça de produção' }],
        addLabel: 'Outro ponto',
        columns: [
          { id: 'item', label: 'Local', locked: true, placeholder: 'Local' },
          { id: 'status', label: 'Estado', type: 'select', options: STATUS_FIXADORES, width: 'medium' },
          { id: 'obs', label: 'Observação (quantidade, bitola…)' }
        ]
      }]
    },
    {
      title: 'Medição de pressões',
      short: 'Pressões',
      icon: 'activity',
      fields: [
        { id: 'hora_leitura', label: 'Hora da leitura', type: 'time' },
        pressoes()
      ]
    },
    {
      title: 'Correções e recomendações a serem realizadas',
      short: 'Correções e recomendações',
      icon: 'listChecks',
      fields: [
        {
          id: 'correcoes', type: 'table',
          presetRows: CORRECOES.map((acao) => ({ acao })),
          addLabel: 'Outra ação',
          columns: [
            { id: 'acao', label: 'Ação', locked: true, placeholder: 'Descreva a ação' },
            { id: 'necessario', label: 'Necessário', type: 'checkbox' },
            { id: 'detalhe', label: 'Detalhes / especificação', width: 'wide' },
            { id: 'prioridade', label: 'Prioridade', type: 'select', options: PRIORIDADES, width: 'narrow' }
          ]
        },
        { id: 'outras_recomendacoes', label: 'Outras recomendações', type: 'textarea' }
      ]
    },
    fotos(['Foto da Locação', 'Manômetro Coluna', 'Manômetro Anular', 'Cabeça de Poço', 'Válvula VM', 'Outras'])
  ]
};
