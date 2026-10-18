// Relatório de Visita Técnica — sequência cronológica de campo (modelo Word oficial):
// cabeçalho → chegada ao poço (placa e conjunto) → pressões e manômetros → inspeção de cada
// componente com o SEU bloco de fotos → outras fotos → recomendações e assinatura.
import {
  poco, pressoes, coordenadas, fotosDe, paragrafoAbertura, PRIORIDADES, TURNOS,
  FOTOS_CHEGADA, FOTOS_MANOMETROS, FOTOS_OUTRAS, ANTEPOCO, VALVULAS_CABECA, FLANGES,
  ESTANQUEIDADE, ABERTURA, CORROSAO
} from './common.js';

const CORRECOES = [
  'Substituição de Válvula',
  'Substituição de Parafusos / Porcas',
  'Reunião de Pré-Tarefa (RPT / APR)',
  'Limpeza com carro sugador',
  'Aterramento e Barricamento'
];

const valvula = (v, n) => ({
  title: `${n}. ${v.nome}`,
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
  title: `${n}. ${fl.nome}`,
  short: fl.short,
  icon: 'wrench',
  fields: [
    { id: `${fl.p}_parafusos`, label: 'Nº de parafusos', type: 'number', min: 0, step: 1 },
    { id: `${fl.p}_tamanho`, label: 'Tamanho dos parafusos', type: 'text', placeholder: 'Ex.: 7/8" x 6"' },
    { id: `${fl.p}_corrosao`, label: 'Corrosão', type: 'select', options: CORROSAO },
    { id: `${fl.p}_prisioneiros`, label: 'Prisioneiros?', type: 'yesno' },
    { id: `${fl.p}_intervencao`, label: 'Necessita intervenção?', type: 'yesno', span: 6 },
    { id: `${fl.p}_obs`, label: 'Observações', type: 'textarea' },
    fotosDe(`fotos_${fl.p}`, `Fotos — ${fl.short} (medições e vistas)`, fl.fotos)
  ]
});

export default {
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
        poco(),
        { id: 'campo', label: 'Locação / Campo', type: 'text', placeholder: 'Ex.: Campo de Buracica' },
        { id: 'data', label: 'Data da visita', type: 'date', required: true },
        { id: 'turno', label: 'Turno', type: 'select', options: TURNOS },
        { type: 'divider', label: 'Equipe', icon: 'users' },
        { id: 'tecnicos', label: 'Técnico(s)', type: 'text', required: true, span: 6, settingsKey: 'tecnico_nome', placeholder: 'Nomes separados por vírgula' },
        { id: 'acompanhantes', label: 'Acompanhantes / Operador', type: 'text', span: 6, placeholder: 'Ex.: operador Carlos (PETROBRAS)' },
        { id: 'frente', label: 'Frente / Equipe', type: 'text', placeholder: 'Ex.: Equipe de válvulas 02' },
        { id: 'cliente', label: 'Cliente / Contratante', type: 'text', required: true, settingsKey: 'cliente_padrao' },
        { id: 'contrato', label: 'Contrato', type: 'text', settingsKey: 'contrato_padrao' },
        { type: 'divider', label: 'Objetivo da visita', icon: 'flag' },
        { id: 'objetivo', label: 'Objetivo', type: 'textarea', required: true, placeholder: 'Ex.: avaliar as condições das válvulas e flanges da cabeça de poço' },
        {
          id: 'introducao', label: 'Parágrafo de abertura (gerado automaticamente)', pdfLabel: 'Introdução', type: 'computed', full: true,
          compute: (d) => paragrafoAbertura(d, { verbo: 'fizemos uma visita técnica ao', equipe: 'tecnicos', acompanhantes: 'acompanhantes', data: 'data' })
        },
        { type: 'divider', label: 'Coordenadas GPS da locação', icon: 'crosshair' },
        coordenadas()
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
    ...FLANGES.map((fl, i) => flange(fl, i + 2 + VALVULAS_CABECA.length)),
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
            { id: 'acao', label: 'Ação', locked: true, placeholder: 'Descreva a ação' },
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
        { id: 'obs_locacao', label: 'Observações da locação', type: 'textarea' }
      ]
    }
  ]
};
