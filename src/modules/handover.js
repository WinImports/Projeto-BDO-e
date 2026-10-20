// Relatório de Execução — mesma sequência cronológica da Visita Técnica. Cada componente tem o
// serviço executado e o bloco de fotos "Antes (Visita Técnica) x Depois (Execução)": as fotos
// "Antes" vêm da última Visita Técnica do poço finalizada neste aparelho (ver consolidação).
import {
  pocoHerdado, herancaBdo, pressoes, coordenadas, fotosDe, paragrafoAbertura, equipe, PRIORIDADES,
  FOTOS_CHEGADA, FOTOS_MANOMETROS, FOTOS_OUTRAS, ANTEPOCO, VALVULAS_CABECA, FLANGES,
  ESTANQUEIDADE, CORROSAO
} from './common.js';

const comparar = (id, label, cats) => fotosDe(id, label, cats, { compare: true });

/**
 * Pendências automáticas: componente entregue sem estanqueidade ou com corrosão moderada/severa
 * vira linha _auto no Detalhamento das pendências, com a instrução clara do que fazer.
 */
export function pendenciasAutomaticas(d) {
  const out = [];
  for (const v of VALVULAS_CABECA) {
    const sit = d[`${v.p}_situacao`];
    if (sit === 'Sem estanqueidade (vazamento)') {
      out.push({ _auto: v.p, descricao: `${v.short}: Necessária a substituição da válvula devido à falta de estanqueidade`, recurso: `Válvula para a posição ${v.short}` });
    } else if (sit === 'Não testada') {
      out.push({ _auto: v.p, descricao: `${v.short}: Necessário realizar o teste de estanqueidade da válvula`, prioridade: 'Média' });
    }
  }
  for (const fl of FLANGES) {
    const sit = d[`${fl.p}_situacao`];
    if (sit === 'Corrosão: moderada' || sit === 'Corrosão: severa') {
      out.push({ _auto: fl.p, descricao: `${fl.short}: Necessária a substituição dos parafusos / prisioneiros devido à corrosão ${sit.split(': ')[1]}`, recurso: 'Parafusos / prisioneiros e porcas' });
    }
  }
  if (d[`${ANTEPOCO.p}_situacao`] === 'Necessita nova limpeza') {
    out.push({ _auto: ANTEPOCO.p, descricao: 'Antipoço: Necessária nova limpeza do antipoço', prioridade: 'Média' });
  }
  return out;
}

const componente = ({ p, nome, short, fotos }, n, situacao) => ({
  title: `${n}. ${nome}`,
  short: short || nome,
  icon: p.startsWith('flange') ? 'wrench' : p === 'antepoco' ? 'map' : 'gauge',
  fields: [
    { id: `${p}_servico`, label: 'Serviço executado', type: 'textarea', placeholder: 'O que foi feito neste componente (deixe em branco se não houve intervenção)' },
    { id: `${p}_situacao`, label: situacao.label, type: 'select', span: 6, options: situacao.options },
    { id: `${p}_obs`, label: 'Observações', type: 'text', span: 6 },
    comparar(`fotos_${p}`, `Fotos — ${short || nome}: antes x depois`, fotos)
  ]
});

export default {
  id: 'handover',
  title: 'Relatório de Execução',
  shortTitle: 'Relatório de Execução',
  subtitle: 'Pós-execução e passagem de bastão 14x14',
  icon: 'repeat',
  sections: [
    {
      title: 'Cabeçalho e dados gerais',
      short: 'Cabeçalho',
      icon: 'clipboard',
      fields: [
        pocoHerdado(),
        { id: 'campo', label: 'Locação / Campo', type: 'text', placeholder: 'Ex.: Campo de Buracica' },
        { id: 'data_hora', label: 'Data e hora da passagem', type: 'datetime', required: true },
        { id: 'tipo_passagem', label: 'Tipo', type: 'select', required: true, options: ['Troca de turma (revezamento 14x14)', 'Troca de turno', 'Encerramento do serviço'] },
        { id: 'cliente', label: 'Cliente / Contratante', type: 'text', settingsKey: 'cliente_padrao' },
        { id: 'contrato', label: 'Contrato', type: 'text', settingsKey: 'contrato_padrao' },
        { type: 'divider', label: 'Equipe', icon: 'users' },
        equipe(),
        {
          id: 'objetivo', label: 'Objetivo / escopo da execução', type: 'textarea', lockEdit: 'Editar Objetivo',
          defaultValue: 'Executar a manutenção da cabeça de poço conforme as recomendações da Visita Técnica, com o reparo ou a substituição das válvulas e dos parafusos / prisioneiros indicados, entregando a locação em condição segura',
          placeholder: 'Ex.: substituir a VA-1 e os parafusos do flange inferior'
        },
        {
          id: 'introducao', label: 'Texto de abertura', pdfLabel: 'Introdução', type: 'computed', previewButton: true,
          compute: (d) => paragrafoAbertura(d, { verbo: 'executamos os serviços no', data: 'data_hora', equipeLegado: ['turma_entrega', 'acompanhantes'] })
        }
      ]
    },
    {
      title: 'Consolidação da quinzena (14x14)',
      short: 'Consolidação 14x14',
      icon: 'listChecks',
      hint: 'Informe o Poço/Locação e o período: o app reúne automaticamente as atividades, horas, paradas e SMS dos BDOs e o último status de equipamentos da Visita Técnica — e traz as fotos da Visita como "Antes" em cada componente.',
      fields: [
        { id: 'periodo_inicio', label: 'Início da quinzena', type: 'date', required: true, defaultDaysAgo: 13 },
        { id: 'periodo_fim', label: 'Fim da quinzena', type: 'date', required: true },
        { id: 'consolidacao', label: 'Resumo consolidado do período', type: 'consolidation', hideLabel: true }
      ]
    },
    {
      title: 'Identificação visual (chegada ao poço)',
      short: 'Chegada ao poço',
      icon: 'camera',
      fields: [
        comparar('fotos_chegada', 'Placa do poço e conjunto / árvore de natal: antes x depois', FOTOS_CHEGADA),
        { id: 'obs_iniciais', label: 'Observações iniciais', type: 'textarea' }
      ]
    },
    {
      title: 'Registro de pressões e manômetros',
      short: 'Pressões',
      icon: 'activity',
      fields: [
        pressoes({ label: 'Pressões no momento da entrega' }),
        comparar('fotos_manometros', 'Fotos dos manômetros: antes x depois', FOTOS_MANOMETROS)
      ]
    },
    componente(ANTEPOCO, 1, { label: 'Situação final', options: ['Limpo', 'Limpeza parcial', 'Necessita nova limpeza'] }),
    ...VALVULAS_CABECA.map((v, i) => componente(v, i + 2, { label: 'Estanqueidade final', options: ESTANQUEIDADE })),
    ...FLANGES.map((fl, i) => componente(fl, i + 2 + VALVULAS_CABECA.length, { label: 'Situação final', options: ['Parafusos substituídos', 'Reapertado', ...CORROSAO.map((c) => `Corrosão: ${c.toLowerCase()}`)] })),
    {
      title: 'Outras fotos',
      short: 'Outras fotos',
      icon: 'camera',
      fields: [comparar('fotos', 'Fotos gerais do conjunto e da locação: antes x depois', FOTOS_OUTRAS)]
    },
    {
      title: 'Status final da locação',
      short: 'Status final',
      icon: 'activity',
      fields: [
        { id: 'status_poco', label: 'Status final', type: 'select', required: true, span: 4, options: ['Pressurizado', 'Despressurizado', 'Estanque', 'Aguardando Material'] },
        { id: 'servico_executado', label: 'Resumo do serviço executado', type: 'textarea', required: true },
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
            { id: 'descricao', label: 'Pendência / Ação recomendada', width: 'wide', placeholder: 'O que ficou por fazer' },
            { id: 'prioridade', label: 'Prioridade', type: 'select', options: PRIORIDADES, width: 'narrow' },
            { id: 'recurso', label: 'Material / recurso necessário' }
          ]
        },
        { id: 'orientacoes', label: 'Orientações para a turma que recebe', type: 'textarea' }
      ]
    },
    {
      title: 'Validação, recomendações e assinatura',
      short: 'Validação',
      icon: 'pen',
      fields: [
        { id: 'recomendacoes', label: 'Recomendações gerais', type: 'textarea' },
        { id: 'responsavel_entrega', label: 'Responsável pela entrega (gestor técnico)', type: 'text', required: true, span: 4, settingsKey: 'tecnico_nome' },
        { id: 'matricula_entrega', label: 'Matrícula / Chave', type: 'text', required: true, span: 2, settingsKey: 'tecnico_matricula' },
        { id: 'empresa_entrega', label: 'Empresa', type: 'text', settingsKey: 'empresa_nome' },
        { id: 'responsavel_recebe', label: 'Responsável que recebe', type: 'text', required: true },
        { id: 'fiscal', label: 'Fiscal / Fiscalização', type: 'text' },
        { id: 'liberado', label: 'Poço liberado para a fiscalização?', type: 'yesno', required: true, span: 12 },
        { id: 'assinatura', label: 'Assinatura do técnico responsável', type: 'signature', required: true }
      ]
    },
    {
      title: 'Identificação (formato anterior)',
      legacy: true,
      fields: [
        { id: 'turma_entrega', label: 'Turma / equipe que entrega', type: 'text' },
        { id: 'turma_recebe', label: 'Turma / equipe que recebe', type: 'text' },
        { id: 'acompanhantes', label: 'Acompanhantes / Operador', type: 'text' },
        // GPS e rotas ficam no BDO-e: as coordenadas vêm dele (herdaDoBdo) e saem só no cabeçalho do PDF
        coordenadas()
      ]
    }
  ],
  herdaDoBdo: herancaBdo('data_hora'),
  autoRows: { table: 'pendencias', col: 'descricao', label: 'Pendências', defaults: { prioridade: 'Alta' }, rows: pendenciasAutomaticas },
  validate(data) {
    if (data.periodo_inicio && data.periodo_fim && data.periodo_inicio > data.periodo_fim) {
      return [{ field: 'periodo_fim', message: 'O fim da quinzena não pode ser antes do início' }];
    }
    return [];
  }
};
