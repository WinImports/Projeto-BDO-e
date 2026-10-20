import { poco, coordenadas, duracao, duracaoEntreDatas, equipe, TURNOS } from './common.js';
import { resumoBdo } from './resumo-bdo.js';

// BDO = apropriação diária de horas, paradas, materiais e segurança. Sem fotos
// (anexos fotográficos ficam no Relatório de Visita & Inspeção Técnica).

export default {
  id: 'bdo',
  title: 'Boletim Diário Operacional Eletrônico',
  shortTitle: 'BDO-e',
  subtitle: 'Boletim Diário Operacional Eletrônico',
  icon: 'clipboard',
  sections: [
    {
      title: 'Cabeçalho — cliente, contrato e responsáveis',
      short: 'Cabeçalho',
      icon: 'building',
      fields: [
        { type: 'divider', label: 'Cliente, contrato e local', icon: 'building' },
        { id: 'cliente', label: 'Cliente', type: 'text', required: true, settingsKey: 'cliente_padrao', placeholder: 'Ex.: PETROBRAS' },
        { id: 'contrato', label: 'Contrato', type: 'text', required: true, settingsKey: 'contrato_padrao', placeholder: 'Ex.: OS-Mans' },
        { ...poco(), placeholder: 'Ex.: RCB-04, FBM-78' },
        { id: 'cidade_uf', label: 'Cidade / Estado', type: 'text', required: true, placeholder: 'Ex.: Catu - BA' },
        { id: 'data', label: 'Data do boletim', type: 'date', required: true },
        { id: 'turno', label: 'Turno', type: 'select', required: true, options: TURNOS },
        { id: 'atividade_principal', label: 'Atividade principal', type: 'text', required: true, span: 6, placeholder: 'Ex.: Manutenção de Válvulas e Hot Bolt' },
        { type: 'divider', label: 'Equipe', icon: 'users' },
        { id: 'tecnico', label: 'Técnico responsável pelo boletim', type: 'text', required: true, span: 6, settingsKey: 'tecnico_nome', placeholder: 'Ex.: ANDERSON SOUZA' },
        { id: 'matricula', label: 'Matrícula / Chave', type: 'text', required: true, span: 3, settingsKey: 'tecnico_matricula', placeholder: 'Ex.: 30882' },
        equipe({ required: false }),
        { type: 'divider', label: 'Deslocamento da jornada', icon: 'truck' },
        {
          id: 'km_total', label: 'KM rodado total', type: 'number', min: 0, step: 'any', unit: 'km', span: 4, kmAuto: true,
          hint: 'Estimado ao escolher o poço (distância até a locação) e somado a cada nova captura de GPS. Pode corrigir.'
        },
        { type: 'divider', label: 'Coordenadas GPS da locação', icon: 'crosshair' },
        coordenadas()
      ]
    },
    {
      title: 'Apropriação da operação',
      short: 'Apropriação',
      icon: 'clock',
      hint: 'Registre cada atividade do turno em ordem cronológica. A duração é calculada automaticamente.',
      fields: [{
        id: 'atividades', type: 'table', required: true, addLabel: 'Adicionar atividade',
        // linhas novas já vêm com a data do boletim (colunas aux: não contam como preenchimento)
        newRow: (data) => ({ data_inicio: data.data || '', data_fim: data.data || '' }),
        // a linha seguinte começa onde a anterior terminou (hora fim → hora início)
        chain: [['hora_fim', 'hora_inicio'], ['data_fim', 'data_inicio']],
        columns: [
          { id: 'data_inicio', label: 'Data início', type: 'date', aux: true, width: 'date' },
          { id: 'hora_inicio', label: 'Hora início', type: 'time', width: 'time' },
          { id: 'atividade', label: 'Atividade executada', width: 'wide', placeholder: 'Ex.: Troca da válvula VM', routeTrigger: true },
          { id: 'data_fim', label: 'Data fim', type: 'date', aux: true, width: 'date' },
          { id: 'hora_fim', label: 'Hora fim', type: 'time', width: 'time' },
          { id: 'duracao', label: 'Duração', width: 'narrow', computed: (r) => duracaoEntreDatas(r.data_inicio, r.hora_inicio, r.data_fim, r.hora_fim) }
        ]
      }]
    },
    {
      title: 'Ocorrências e paradas imprevistas',
      short: 'Paradas',
      icon: 'alert',
      fields: [{
        id: 'paradas', type: 'table', addLabel: 'Registrar parada',
        columns: [
          { id: 'inicio', label: 'Hora início', type: 'time', width: 'time' },
          { id: 'fim', label: 'Hora fim', type: 'time', width: 'time' },
          { id: 'duracao', label: 'Tempo parado', width: 'narrow', computed: (r) => duracao(r.inicio, r.fim) },
          { id: 'codigo', label: 'Código', width: 'narrow', placeholder: 'Ex.: 5' },
          { id: 'motivo', label: 'Motivo / descrição', width: 'wide', placeholder: 'Ex.: Aguardando carro sugador' }
        ]
      }]
    },
    {
      title: 'Consumo de materiais e insumos',
      short: 'Materiais',
      icon: 'package',
      fields: [{
        id: 'materiais', type: 'table', addLabel: 'Adicionar material',
        columns: [
          { id: 'quantidade', label: 'Qtd.', type: 'number', width: 'narrow' },
          { id: 'unidade', label: 'Unidade', type: 'select', options: ['un', 'pç', 'jogo', 'm', 'kg', 'L'], width: 'narrow', aux: true },
          { id: 'descricao', label: 'Descrição do material / peça utilizada', width: 'wide', placeholder: 'Ex.: Junta RX-24; prisioneiro 7/8" x 6"; válvula gaveta 2 1/16"' }
        ]
      }]
    },
    {
      title: 'SMS & Segurança',
      short: 'SMS & Segurança',
      icon: 'shield',
      fields: [
        { id: 'rpt', label: 'RPT / APR realizada?', type: 'yesno', required: true },
        { id: 'ocorrencia_sms', label: 'Ocorrência de SMS?', type: 'yesno', required: true },
        { id: 'descricao_sms', label: 'Descrição de SMS', type: 'textarea', placeholder: 'Obrigatório se houve ocorrência de SMS' }
      ]
    },
    {
      title: 'Resumo das Atividades Executadas',
      short: 'Resumo',
      icon: 'fileText',
      hint: 'Montado automaticamente a partir da Apropriação da operação e das paradas: jornada, poços / locações atendidos, atividades e paradas. Toque em "Editar Resumo" para ajustar ou acrescentar.',
      fields: [{
        id: 'resumo_atividades', label: 'Resumo das Atividades Executadas', type: 'textarea',
        autoText: resumoBdo, lockEdit: 'Editar Resumo', placeholder: 'Preencha a Apropriação da operação para gerar o resumo.'
      }]
    },
    {
      title: 'Observações gerais e programação do próximo turno',
      short: 'Observações',
      icon: 'notes',
      fields: [
        { id: 'observacoes', label: 'Observações do turno', type: 'textarea' },
        { id: 'programacao', label: 'Programação / passagem para a próxima equipe (revezamento 14x14)', type: 'textarea' }
      ]
    },
    {
      title: 'Cabeçalho (formato anterior)',
      legacy: true,
      fields: [
        { id: 'cargo', label: 'Cargo', type: 'text' },
        { id: 'operador', label: 'Operador de campo', type: 'text' },
        { id: 'gestor', label: 'Gestor técnico / Encarregado', type: 'text' },
        { id: 'km_inicial', label: 'KM inicial', type: 'text' },
        { id: 'km_final', label: 'KM final', type: 'text' },
        { id: 'km_percorrido', label: 'KM percorrido', type: 'text' }
      ]
    }
  ],
  validate(data, { filled }) {
    const errors = [];
    if (data.ocorrencia_sms === 'Sim' && !data.descricao_sms?.trim()) {
      errors.push({ field: 'descricao_sms', message: 'Descreva a ocorrência de SMS' });
    }
    const invertida = filled('atividades').findIndex((r) =>
      r.hora_inicio && r.hora_fim && r.data_inicio && r.data_fim
      && `${r.data_fim}T${r.hora_fim}` < `${r.data_inicio}T${r.hora_inicio}`);
    if (invertida >= 0) {
      errors.push({ field: 'atividades', message: `Linha ${invertida + 1}: fim antes do início — confira data/hora` });
    }
    return errors;
  }
};
