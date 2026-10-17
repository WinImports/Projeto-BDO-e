import { poco, fotos, pressoes, coordenadas, PRIORIDADES } from './common.js';

export default {
  id: 'handover',
  title: 'Relatório de Execução',
  shortTitle: 'Relatório de Execução',
  subtitle: 'Pós-execução e passagem de bastão 14x14',
  icon: 'repeat',
  sections: [
    {
      title: 'Identificação',
      icon: 'clipboard',
      fields: [
        poco(),
        { id: 'data_hora', label: 'Data e hora da passagem', type: 'datetime', required: true },
        { id: 'tipo_passagem', label: 'Tipo', type: 'select', required: true, span: 6, options: ['Troca de turma (revezamento 14x14)', 'Troca de turno', 'Encerramento do serviço'] },
        { id: 'turma_entrega', label: 'Turma / equipe que entrega', type: 'text', required: true, span: 6 },
        { id: 'turma_recebe', label: 'Turma / equipe que recebe', type: 'text', required: true, span: 6 },
        { type: 'divider', label: 'Coordenadas GPS da locação', icon: 'crosshair' },
        coordenadas()
      ]
    },
    {
      title: 'Consolidação da quinzena (14x14)',
      short: 'Consolidação 14x14',
      icon: 'listChecks',
      hint: 'Informe o Poço/Locação e o período: o app reúne automaticamente as atividades, horas, paradas e SMS dos BDOs e o último status de equipamentos da Visita Técnica, finalizados neste computador.',
      fields: [
        { id: 'periodo_inicio', label: 'Início da quinzena', type: 'date', required: true, defaultDaysAgo: 13 },
        { id: 'periodo_fim', label: 'Fim da quinzena', type: 'date', required: true },
        { id: 'consolidacao', label: 'Resumo consolidado do período', type: 'consolidation', hideLabel: true }
      ]
    },
    {
      title: 'Status final da locação',
      short: 'Status final',
      icon: 'activity',
      fields: [
        { id: 'status_poco', label: 'Status final', type: 'select', required: true, span: 4, options: ['Pressurizado', 'Despressurizado', 'Estanque', 'Aguardando Material'] },
        { id: 'servico_executado', label: 'Resumo do serviço executado', type: 'textarea', required: true },
        pressoes({ label: 'Pressões no momento da entrega' }),
        {
          id: 'condicoes_seguranca', label: 'Condição de segurança na entrega', type: 'checklist',
          options: [
            'Válvulas na posição correta e identificadas',
            'Sem vazamentos visíveis',
            'Locação isolada / barricada',
            'Aterramento instalado',
            'Antepoço limpo',
            'Ferramentas e resíduos recolhidos'
          ]
        }
      ]
    },
    {
      title: 'Pendências críticas para a próxima turma (14x14)',
      short: 'Pendências críticas',
      icon: 'flag',
      fields: [
        {
          id: 'pendencias_criticas', label: 'Pendências críticas — o que a próxima turma precisa fazer', type: 'textarea',
          required: true, highlight: true,
          placeholder: 'Descreva com clareza o que ficou pendente. Se não houver, escreva "Nenhuma pendência".'
        },
        {
          id: 'pendencias', label: 'Detalhamento (opcional)', type: 'table', addLabel: 'Adicionar pendência',
          columns: [
            { id: 'descricao', label: 'Pendência', width: 'wide', placeholder: 'O que ficou por fazer' },
            { id: 'prioridade', label: 'Prioridade', type: 'select', options: PRIORIDADES, width: 'narrow' },
            { id: 'recurso', label: 'Material / recurso necessário' }
          ]
        },
        { id: 'orientacoes', label: 'Orientações para a turma que recebe', type: 'textarea' }
      ]
    },
    fotos(['Situação final do poço', 'Manômetros', 'Outras']),
    {
      title: 'Validação e liberação',
      short: 'Validação',
      icon: 'pen',
      fields: [
        { id: 'responsavel_entrega', label: 'Responsável pela entrega', type: 'text', required: true, span: 4, settingsKey: 'tecnico_nome' },
        { id: 'matricula_entrega', label: 'Matrícula / Chave', type: 'text', required: true, span: 2, settingsKey: 'tecnico_matricula' },
        { id: 'responsavel_recebe', label: 'Responsável que recebe', type: 'text', required: true },
        { id: 'fiscal', label: 'Fiscal / Fiscalização', type: 'text' },
        { id: 'liberado', label: 'Poço liberado para a fiscalização?', type: 'yesno', required: true, span: 12 },
        { id: 'assinatura', label: 'Assinatura do técnico responsável', type: 'signature', required: true }
      ]
    }
  ],
  validate(data) {
    if (data.periodo_inicio && data.periodo_fim && data.periodo_inicio > data.periodo_fim) {
      return [{ field: 'periodo_fim', message: 'O fim da quinzena não pode ser antes do início' }];
    }
    return [];
  }
};
