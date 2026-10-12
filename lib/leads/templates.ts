// Modelos de formulário prontos (ponto de partida). Cada um traz as perguntas, a lógica condicional, o aviso de consentimento
// e SUGESTÕES de regras de score — valores de exemplo, que cada empresa deve ajustar à sua realidade (docs/SCORING.md).
import type { ConsentConfig, FormField, FormSchema, LogicRule } from './formlogic';

export type SuggestedRule = { label: string; field_key: string; operator: string; condition: unknown; points: number };
export type FormTemplate = {
  id: string;
  name: string;
  description: string;
  slug: string;
  schema: FormSchema;
  logic: LogicRule[];
  consent: ConsentConfig;
  rules: SuggestedRule[];
  /** Respostas de exemplo que atingem 100 pontos (usadas na prévia, nos testes e na demonstração). */
  sample: Record<string, unknown>;
};

const CONSENT: ConsentConfig = {
  required: true,
  text: 'Concordo em compartilhar meus dados para que a empresa entre em contato comigo sobre esta solicitação, conforme a política de privacidade.',
};
const opts = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));

const CONTACT_STEP = { id: 'contato', title: 'Seus dados' };
const contactFields = (extra: FormField[] = []): FormField[] => [
  { key: 'nome', type: 'text', label: 'Nome completo', required: true, lead_field: 'name', step: 'contato' },
  { key: 'email', type: 'email', label: 'E-mail profissional', required: true, lead_field: 'email', step: 'contato' },
  { key: 'telefone', type: 'phone', label: 'Telefone / WhatsApp', required: false, lead_field: 'phone', step: 'contato' },
  ...extra,
];

export const TEMPLATES: FormTemplate[] = [
  {
    id: 'b2b',
    name: 'Qualificação B2B',
    description: 'Empresa, porte, orçamento, prazo e poder de decisão — para vendas consultivas.',
    slug: 'qualificacao-b2b',
    schema: {
      steps: [CONTACT_STEP, { id: 'empresa', title: 'Sua empresa' }, { id: 'projeto', title: 'Seu projeto' }],
      fields: [
        ...contactFields([{ key: 'empresa', type: 'text', label: 'Empresa', required: true, lead_field: 'company_name', step: 'contato' }]),
        { key: 'cargo', type: 'select', label: 'Qual é o seu papel na decisão?', required: true, step: 'empresa', options: opts([['decisor', 'Decido a contratação'], ['influenciador', 'Influencio a decisão'], ['pesquisa', 'Estou pesquisando para outra pessoa']]) },
        { key: 'funcionarios', type: 'select', label: 'Quantos funcionários a empresa tem?', required: true, step: 'empresa', options: opts([['ate_10', 'Até 10'], ['11_50', '11 a 50'], ['51_200', '51 a 200'], ['mais_200', 'Mais de 200']]) },
        { key: 'segmento', type: 'text', label: 'Segmento de atuação', required: false, lead_field: 'segment', step: 'empresa', max_length: 120 },
        { key: 'orcamento', type: 'select', label: 'Qual o orçamento previsto?', required: true, step: 'projeto', options: opts([['ate_5k', 'Até R$ 5 mil'], ['5k_20k', 'R$ 5 mil a R$ 20 mil'], ['20k_50k', 'R$ 20 mil a R$ 50 mil'], ['mais_50k', 'Acima de R$ 50 mil'], ['indefinido', 'Ainda não definido']]) },
        { key: 'prazo', type: 'select', label: 'Quando pretende contratar?', required: true, step: 'projeto', options: opts([['ate_30', 'Em até 30 dias'], ['30_90', 'Entre 30 e 90 dias'], ['mais_90', 'Em mais de 90 dias'], ['pesquisando', 'Só pesquisando']]) },
        { key: 'problema', type: 'textarea', label: 'Qual problema você quer resolver?', required: false, step: 'projeto', max_length: 1000, help: 'Quanto mais detalhes, melhor o atendimento.' },
      ],
    },
    logic: [],
    consent: CONSENT,
    rules: [
      { label: 'Decide a contratação', field_key: 'cargo', operator: 'eq', condition: 'decisor', points: 20 },
      { label: 'Influencia a decisão', field_key: 'cargo', operator: 'eq', condition: 'influenciador', points: 8 },
      { label: 'Empresa com mais de 50 funcionários', field_key: 'funcionarios', operator: 'in', condition: ['51_200', 'mais_200'], points: 15 },
      { label: 'Orçamento a partir de R$ 20 mil', field_key: 'orcamento', operator: 'in', condition: ['20k_50k', 'mais_50k'], points: 25 },
      { label: 'Orçamento de R$ 5 mil a R$ 20 mil', field_key: 'orcamento', operator: 'eq', condition: '5k_20k', points: 12 },
      { label: 'Quer contratar em até 30 dias', field_key: 'prazo', operator: 'eq', condition: 'ate_30', points: 25 },
      { label: 'Descreveu o problema', field_key: 'problema', operator: 'answered', condition: null, points: 15 },
    ],
    sample: { nome: 'Marina Costa', email: 'marina@empresa-exemplo.com.br', telefone: '(11) 91234-5678', empresa: 'Empresa Exemplo', cargo: 'decisor', funcionarios: 'mais_200', segmento: 'Indústria', orcamento: 'mais_50k', prazo: 'ate_30', problema: 'Precisamos organizar a prospecção.' },
  },
  {
    id: 'imobiliaria',
    name: 'Imobiliária',
    description: 'Interesse, tipo de imóvel, faixa de valor, prazo e financiamento (com pergunta condicional).',
    slug: 'busca-de-imovel',
    schema: {
      steps: [CONTACT_STEP, { id: 'imovel', title: 'O imóvel' }],
      fields: [
        ...contactFields(),
        { key: 'interesse', type: 'radio', label: 'O que você procura?', required: true, step: 'imovel', options: opts([['comprar', 'Comprar'], ['alugar', 'Alugar'], ['investir', 'Investir']]) },
        { key: 'tipo', type: 'multiselect', label: 'Tipo de imóvel', required: true, step: 'imovel', options: opts([['apartamento', 'Apartamento'], ['casa', 'Casa'], ['terreno', 'Terreno'], ['comercial', 'Sala / loja']]) },
        { key: 'valor', type: 'select', label: 'Faixa de valor', required: true, step: 'imovel', options: opts([['ate_300k', 'Até R$ 300 mil'], ['300k_700k', 'R$ 300 mil a R$ 700 mil'], ['700k_1500k', 'R$ 700 mil a R$ 1,5 milhão'], ['mais_1500k', 'Acima de R$ 1,5 milhão']]) },
        { key: 'prazo', type: 'select', label: 'Em quanto tempo quer fechar?', required: true, step: 'imovel', options: opts([['ate_30', 'Em até 30 dias'], ['30_90', 'Entre 30 e 90 dias'], ['mais_90', 'Mais de 90 dias']]) },
        { key: 'financia', type: 'checkbox', label: 'Vou precisar de financiamento', required: false, step: 'imovel' },
        { key: 'entrada', type: 'currency', label: 'Quanto tem para a entrada (R$)?', required: false, step: 'imovel', min: 0 },
        { key: 'visita', type: 'checkbox', label: 'Quero agendar uma visita', required: false, step: 'imovel' },
      ],
    },
    logic: [{ target: 'entrada', show_if: { all: [{ field: 'financia', op: 'is_true' }] } }],
    consent: CONSENT,
    rules: [
      { label: 'Quer fechar em até 30 dias', field_key: 'prazo', operator: 'eq', condition: 'ate_30', points: 30 },
      { label: 'Faixa de valor acima de R$ 700 mil', field_key: 'valor', operator: 'in', condition: ['700k_1500k', 'mais_1500k'], points: 20 },
      { label: 'Entrada acima de R$ 100 mil', field_key: 'entrada', operator: 'gte', condition: 100000, points: 20 },
      { label: 'Quer agendar visita', field_key: 'visita', operator: 'is_true', condition: null, points: 20 },
      { label: 'Informou telefone', field_key: 'telefone', operator: 'answered', condition: null, points: 10 },
    ],
    sample: { nome: 'Carlos Lima', email: 'carlos@exemplo.com.br', telefone: '(21) 99876-5432', interesse: 'comprar', tipo: ['apartamento'], valor: 'mais_1500k', prazo: 'ate_30', financia: true, entrada: 250000, visita: true },
  },
  {
    id: 'orcamento',
    name: 'Pedido de orçamento',
    description: 'Serviço desejado, urgência, verba estimada e data — para prestadores de serviço.',
    slug: 'pedido-de-orcamento',
    schema: {
      steps: [],
      fields: [
        ...contactFields([{ key: 'empresa', type: 'text', label: 'Empresa (se houver)', required: false, lead_field: 'company_name' }]).map((f) => ({ ...f, step: undefined })),
        { key: 'servico', type: 'select', label: 'Qual serviço você precisa?', required: true, options: opts([['implantacao', 'Implantação'], ['manutencao', 'Manutenção / suporte'], ['consultoria', 'Consultoria'], ['outro', 'Outro']]) },
        { key: 'descricao', type: 'textarea', label: 'Descreva o que precisa', required: true, max_length: 1500 },
        { key: 'urgencia', type: 'select', label: 'Qual a urgência?', required: true, options: opts([['alta', 'Preciso para já'], ['media', 'Nas próximas semanas'], ['baixa', 'Sem pressa']]) },
        { key: 'verba', type: 'currency', label: 'Verba estimada (R$)', required: false, min: 0 },
        { key: 'data_limite', type: 'date', label: 'Data desejada para a entrega', required: false },
      ],
    },
    logic: [],
    consent: CONSENT,
    rules: [
      { label: 'Urgência alta', field_key: 'urgencia', operator: 'eq', condition: 'alta', points: 30 },
      { label: 'Verba acima de R$ 3.000', field_key: 'verba', operator: 'gt', condition: 3000, points: 30 },
      { label: 'Descreveu o pedido com detalhes', field_key: 'descricao', operator: 'answered', condition: null, points: 15 },
      { label: 'Informou data desejada', field_key: 'data_limite', operator: 'answered', condition: null, points: 10 },
      { label: 'É empresa', field_key: 'empresa', operator: 'answered', condition: null, points: 15 },
    ],
    sample: { nome: 'Paula Reis', email: 'paula@exemplo.com.br', telefone: '(31) 98888-1111', empresa: 'Reis & Cia', servico: 'implantacao', descricao: 'Preciso implantar o sistema em três unidades.', urgencia: 'alta', verba: 8000, data_limite: '2030-01-15' },
  },
  {
    id: 'diagnostico',
    name: 'Diagnóstico empresarial',
    description: 'Segmento, faturamento, equipe, desafios e maturidade — para consultorias.',
    slug: 'diagnostico-empresarial',
    schema: {
      steps: [CONTACT_STEP, { id: 'negocio', title: 'O negócio' }, { id: 'desafios', title: 'Desafios' }],
      fields: [
        ...contactFields([{ key: 'empresa', type: 'text', label: 'Empresa', required: true, lead_field: 'company_name', step: 'contato' }]),
        { key: 'segmento', type: 'select', label: 'Segmento', required: true, lead_field: 'segment', step: 'negocio', options: opts([['varejo', 'Varejo'], ['servicos', 'Serviços'], ['industria', 'Indústria'], ['saude', 'Saúde'], ['educacao', 'Educação'], ['outro', 'Outro']]) },
        { key: 'faturamento', type: 'select', label: 'Faturamento anual', required: true, step: 'negocio', options: opts([['ate_500k', 'Até R$ 500 mil'], ['500k_3m', 'R$ 500 mil a R$ 3 milhões'], ['3m_20m', 'R$ 3 a R$ 20 milhões'], ['mais_20m', 'Acima de R$ 20 milhões']]) },
        { key: 'equipe', type: 'number', label: 'Quantas pessoas na equipe?', required: true, step: 'negocio', min: 1, max: 100000 },
        { key: 'desafios', type: 'multiselect', label: 'Principais desafios', required: true, step: 'desafios', options: opts([['vendas', 'Aumentar vendas'], ['processos', 'Organizar processos'], ['custos', 'Reduzir custos'], ['pessoas', 'Gestão de pessoas'], ['tecnologia', 'Tecnologia']]) },
        { key: 'maturidade', type: 'radio', label: 'Como os processos funcionam hoje?', required: true, step: 'desafios', options: opts([['informal', 'De forma informal'], ['parcial', 'Parcialmente documentados'], ['estruturado', 'Estruturados e medidos']]) },
        { key: 'urgente', type: 'checkbox', label: 'Precisamos começar este mês', required: false, step: 'desafios' },
      ],
    },
    logic: [],
    consent: CONSENT,
    rules: [
      { label: 'Faturamento acima de R$ 3 milhões', field_key: 'faturamento', operator: 'in', condition: ['3m_20m', 'mais_20m'], points: 25 },
      { label: 'Equipe de 10 a 500 pessoas', field_key: 'equipe', operator: 'between', condition: { min: 10, max: 500 }, points: 20 },
      { label: 'Citou vendas como desafio', field_key: 'desafios', operator: 'contains', condition: 'vendas', points: 20 },
      { label: 'Processos informais (maior ganho)', field_key: 'maturidade', operator: 'eq', condition: 'informal', points: 15 },
      { label: 'Quer começar este mês', field_key: 'urgente', operator: 'is_true', condition: null, points: 20 },
    ],
    sample: { nome: 'Rafael Dias', email: 'rafael@exemplo.com.br', telefone: '(41) 97777-2222', empresa: 'Dias Indústria', segmento: 'industria', faturamento: 'mais_20m', equipe: 120, desafios: ['vendas', 'processos'], maturidade: 'informal', urgente: true },
  },
  {
    id: 'agencia',
    name: 'Agência de marketing',
    description: 'Investimento mensal, objetivos, canais atuais e site — para captar clientes de marketing.',
    slug: 'agencia-de-marketing',
    schema: {
      steps: [CONTACT_STEP, { id: 'marketing', title: 'Marketing atual' }],
      fields: [
        ...contactFields([{ key: 'empresa', type: 'text', label: 'Empresa', required: true, lead_field: 'company_name', step: 'contato' }]),
        { key: 'site', type: 'text', label: 'Endereço do site ou Instagram', required: false, step: 'marketing', max_length: 200 },
        { key: 'investimento', type: 'select', label: 'Quanto investe por mês em marketing?', required: true, step: 'marketing', options: opts([['nenhum', 'Nada ainda'], ['ate_2k', 'Até R$ 2 mil'], ['2k_10k', 'R$ 2 mil a R$ 10 mil'], ['mais_10k', 'Acima de R$ 10 mil']]) },
        { key: 'objetivos', type: 'multiselect', label: 'O que quer alcançar?', required: true, step: 'marketing', options: opts([['leads', 'Gerar leads'], ['marca', 'Fortalecer a marca'], ['vendas', 'Vender online'], ['retencao', 'Reter clientes']]) },
        { key: 'canais', type: 'multiselect', label: 'Canais que já usa', required: false, step: 'marketing', options: opts([['google', 'Google Ads'], ['meta', 'Instagram / Facebook'], ['email', 'E-mail marketing'], ['seo', 'SEO / blog']]) },
        { key: 'prazo', type: 'select', label: 'Quando quer começar?', required: true, step: 'marketing', options: opts([['imediato', 'Imediatamente'], ['mes', 'Neste mês'], ['depois', 'Mais para frente']]) },
      ],
    },
    logic: [],
    consent: CONSENT,
    rules: [
      { label: 'Investe acima de R$ 2 mil por mês', field_key: 'investimento', operator: 'in', condition: ['2k_10k', 'mais_10k'], points: 30 },
      { label: 'Quer gerar leads ou vender online', field_key: 'objetivos', operator: 'contains', condition: 'leads', points: 20 },
      { label: 'Já usa mídia paga', field_key: 'canais', operator: 'contains', condition: 'google', points: 15 },
      { label: 'Tem site ou Instagram', field_key: 'site', operator: 'answered', condition: null, points: 10 },
      { label: 'Quer começar imediatamente', field_key: 'prazo', operator: 'eq', condition: 'imediato', points: 25 },
    ],
    sample: { nome: 'Bianca Souza', email: 'bianca@exemplo.com.br', telefone: '(11) 96666-3333', empresa: 'Loja da Bia', site: 'https://lojadabia.exemplo.com.br', investimento: 'mais_10k', objetivos: ['leads', 'vendas'], canais: ['google', 'meta'], prazo: 'imediato' },
  },
];

export function templateById(id: string): FormTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
