// Relatório de Execução — mesma sequência cronológica da Visita Técnica. Cada componente tem o
// serviço executado e o bloco de fotos "Antes (Visita Técnica) x Depois (Execução)": as fotos
// "Antes" vêm da última Visita Técnica do poço finalizada neste aparelho (ver consolidação).
import {
  pocoHerdado, herancaBdo, pressoes, coordenadas, fotosDe, paragrafoAbertura, equipe, duracao, PRIORIDADES,
  FOTOS_CHEGADA, FOTOS_MANOMETROS, FOTOS_OUTRAS, ANTEPOCO, VALVULAS_CABECA, FLANGES,
  ESTANQUEIDADE, CORROSAO
} from './common.js';

const comparar = (id, label, cats) => fotosDe(id, label, cats, { compare: true });

const diaMes = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const maiuscula = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
/** "situação; situação — observação" (partes vazias saem). */
const juntar = (situacoes, obs) => [maiuscula(situacoes.filter(Boolean).join('; ')), String(obs || '').trim()].filter(Boolean).join(' — ');

/**
 * Linha "Na Visita" de cada componente, a partir dos dados da Visita Técnica de referência (a mesma do
 * Antes x Depois): { antepoco, vc, …, flange_inf: "Na Visita (18/10): Corrosão moderada — prisioneiros oxidados" }.
 * Componente sem nada registrado na Visita não aparece.
 */
export function notasDaVisita(dv = {}) {
  const quando = diaMes(dv.data);
  const prefixo = `Na Visita${quando ? ` (${quando})` : ''}: `;
  const notas = {};
  const constatado = (dv.antepoco_checklist || []).filter((r) => r.situacao === 'Sim').map((r) => r.item);
  const ant = juntar([dv.estado_antepoco, constatado.length ? `necessário: ${constatado.join(', ')}` : ''], dv.obs_antepoco);
  if (ant) notas[ANTEPOCO.p] = prefixo + ant;
  for (const v of VALVULAS_CABECA) {
    const t = juntar([dv[`${v.p}_estanqueidade`], dv[`${v.p}_abertura`], dv[`${v.p}_intervencao`] === 'Sim' ? 'necessita intervenção' : ''], dv[`${v.p}_obs`]);
    if (t) notas[v.p] = prefixo + t;
  }
  for (const fl of FLANGES) {
    const cor = dv[`${fl.p}_corrosao`];
    const corrosao = !cor ? '' : cor === 'Sem corrosão' ? cor : `corrosão ${cor.toLowerCase()}`;
    const t = juntar([corrosao, dv[`${fl.p}_intervencao`] === 'Sim' ? 'necessita intervenção' : ''], dv[`${fl.p}_obs`]);
    if (t) notas[fl.p] = prefixo + t;
  }
  return notas;
}

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

/**
 * Resumo das intervenções realizadas (como no relatório pós-serviço): uma linha por componente com o
 * "Serviço executado" preenchido — "VA-2: Instalação de uma kerotest". Componente sem serviço não entra.
 */
export function resumoIntervencoes(d = {}) {
  return [ANTEPOCO, ...VALVULAS_CABECA, ...FLANGES]
    .map((c) => [c.short || c.nome, String(d[`${c.p}_servico`] || '').trim()])
    .filter(([, s]) => s)
    .map(([nome, s]) => `${nome}: ${s}`)
    .join('\n');
}

/** Execução do dia vinda do BDO (data._execucao_bdo, preenchido pelo formulário): uma linha por atividade. */
export function execucaoDosBdos(d) {
  return (d._execucao_bdo || []).map((t) => ({
    _auto: `bdo:${t.bdo}:${t.indice}`, data: t.data, atividade: t.atividade,
    inicio: t.inicio, fim: t.fim, duracao: t.duracao || duracao(t.inicio, t.fim)
  }));
}

const componente = ({ p, nome, short, fotos }, n, situacao) => ({
  title: `${n}. ${nome}`,
  short: short || nome,
  icon: p.startsWith('flange') ? 'wrench' : p === 'antepoco' ? 'map' : 'gauge',
  fields: [
    { id: `${p}_servico`, label: 'Serviço executado', type: 'textarea', placeholder: 'O que foi feito neste componente (deixe em branco se não houve intervenção)' },
    // só leitura: situação do componente na Visita de referência (notasDaVisita); sem Visita, não aparece
    { id: `${p}_na_visita`, label: 'Na Visita', pdfLabel: 'Situação na Visita Técnica', type: 'visitaNota', comp: p, full: true },
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
        { id: 'contrato', label: 'Contrato', type: 'contrato', settingsKey: 'contrato_padrao' },
        { type: 'divider', label: 'Equipe', icon: 'users' },
        equipe(),
        {
          // definido pelo gestor em Ajustes › Objetivos dos relatórios (por contrato); não aparece no formulário
          id: 'objetivo', label: 'Objetivo / escopo da execução', type: 'textarea', formHidden: true, objetivoTipo: 'execucao',
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
      title: 'Tempos de operação',
      short: 'Tempos de operação',
      icon: 'clock',
      hint: 'Vem do BDO do mesmo dia (data da passagem) e do mesmo poço: só as atividades de execução, com início, fim e duração. Deslocamento e separação de material ficam de fora. Dá para corrigir ou acrescentar à mão.',
      fields: [{
        id: 'tempos_operacao', type: 'table', addLabel: 'Adicionar atividade',
        newRow: (data) => ({ data: String(data.data_hora || '').slice(0, 10) }),
        chain: [['fim', 'inicio']],
        columns: [
          { id: 'data', label: 'Data', type: 'date', width: 'date', aux: true },
          { id: 'atividade', label: 'Atividade executada', width: 'wide', placeholder: 'Ex.: Retirada dos parafusos de 1 3/8"' },
          { id: 'inicio', label: 'Início', type: 'time', width: 'time' },
          { id: 'fim', label: 'Fim', type: 'time', width: 'time' },
          { id: 'duracao', label: 'Duração', width: 'narrow', computed: (r) => duracao(r.inicio, r.fim) }
        ]
      }]
    },
    {
      title: 'Consolidação da quinzena (14x14)',
      short: 'Consolidação 14x14',
      icon: 'listChecks',
      hint: 'Informe o Poço/Locação e o período: o app reúne automaticamente as atividades, horas, paradas e SMS dos BDOs e o último status de equipamentos da Visita Técnica — e traz as fotos da Visita como "Antes" em cada componente (Antes x Depois). Sem Visita Técnica do poço, o relatório mostra só as fotos da execução, em uma coluna.',
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
        { id: 'condicao_geral', label: 'Condição geral encontrada', type: 'select', span: 6, options: ['Boa', 'Regular', 'Ruim (requer atenção)'] },
        { id: 'obs_iniciais', label: 'Observações iniciais (condições encontradas)', type: 'textarea' }
      ]
    },
    {
      title: 'Registro de pressões e manômetros',
      short: 'Pressões',
      icon: 'activity',
      fields: [
        pressoes({ id: 'pressoes_chegada', label: 'Pressões encontradas na chegada' }),
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
        {
          id: 'servico_executado', label: 'Resumo das intervenções realizadas', type: 'textarea', required: true,
          autoText: resumoIntervencoes, autoTextFonte: 'os serviços executados nos componentes', lockEdit: 'Editar Resumo',
          placeholder: 'Preencha o "Serviço executado" de cada componente para montar o resumo.'
        },
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
      title: 'Registro final do poço',
      short: 'Registro final',
      icon: 'camera',
      fields: [
        fotosDe('fotos_final', 'Visão geral do poço após o serviço', ['Visão geral do poço após serviço']),
        { id: 'obs_finais', label: 'Observações finais', type: 'textarea' }
      ]
    },
    {
      title: 'Pendências críticas para a próxima turma (14x14)',
      short: 'Pendências críticas',
      icon: 'flag',
      fields: [
        {
          id: 'pendencias_criticas', label: 'Pendências críticas — o que a próxima turma precisa fazer', type: 'textarea',
          highlight: true, // opcional: sem pendências, o bloco não sai no relatório
          placeholder: 'Itens previstos e não executados, com o motivo. Se não houver pendência, deixe em branco.'
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
        { id: 'assinatura', label: 'Assinatura do técnico responsável', type: 'signature' } // opcional
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
  notasDaVisita,
  // Tempos de operação: atividades de execução do BDO do mesmo dia (core/consolidar.js → data._execucao_bdo)
  execucaoDoBdo: { campoData: 'data_hora' },
  herdaDoBdo: herancaBdo('data_hora'),
  autoRows: [
    { table: 'pendencias', col: 'descricao', label: 'Pendências', defaults: { prioridade: 'Alta' }, rows: pendenciasAutomaticas },
    { table: 'tempos_operacao', col: 'atividade', label: 'Tempos de operação', aviso: false, descartarVazias: true, rows: execucaoDosBdos,
      ordenar: (a, b) => `${a.data || '9999'} ${a.inicio || '99'}`.localeCompare(`${b.data || '9999'} ${b.inicio || '99'}`) }
  ],
  validate(data) {
    if (data.periodo_inicio && data.periodo_fim && data.periodo_inicio > data.periodo_fim) {
      return [{ field: 'periodo_fim', message: 'O fim da quinzena não pode ser antes do início' }];
    }
    return [];
  }
};
