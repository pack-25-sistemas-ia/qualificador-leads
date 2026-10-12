# FEATURES — Qualificador de Leads Inteligente

Estados: VERIFIED (com evidência), BLOQUEADO (exige algo externo) ou NÃO EXECUTADO. Evidências: `tests/e2e/`, `tests/unit/`, `supabase/tests/`.
Siglas: **FLOW** `lead-flow.spec.ts` · **PIPE** `lead-pipeline.spec.ts` · **DIST** `lead-distribution.spec.ts` · **DEMO** `lead-demo.spec.ts` · **SEC** `lead-security.spec.ts` · **MOB** `lead-mobile.spec.ts` · **ENG** `lead-engines.test.ts` · **TPL** `lead-templates.test.ts` · **BLD** `lead-builder.test.ts` · **DB60–64** testes de banco · **MUT** `mutation-check.mjs`.

## Funcionalidades
| Fluxo | Status | Evidência |
|---|---|---|
| Autenticação, organização, papéis, MFA, recuperação de senha | VERIFIED | Core: `core-flow`, `email-flows`, `security` + DB 10–40 |
| Construtor de formulários (perguntas, tipos, reordenar por arrastar/teclado, etapas, condicionais, prévia, versões, duplicar, arquivar) | VERIFIED | FLOW; BLD; DB61 |
| 5 modelos (B2B, imobiliária, orçamento, diagnóstico, agência), todos publicáveis e com 100 pts no exemplo | VERIFIED | TPL |
| Publicação com versão imutável; link (slug) fixo; redirecionamento só https | VERIFIED | DB61; FLOW |
| Página pública `/f/[slug]` multietapa, UTM, consentimento, honeypot, noindex, CSP | VERIFIED | FLOW; DEMO; MOB; SEC |
| Validação do envio no banco, campos ocultos descartados, idempotência | VERIFIED | DB62; DB60 form fixtures |
| Duplicidade (link / marcar / revisar) por e-mail e telefone normalizados | VERIFIED | DB62; FLOW |
| Limite de taxa compartilhado no banco | VERIFIED | DB62; SEC |
| Motor de score (13 operadores, 0–100, faixas, qualificação, justificativa, dados ausentes) | VERIFIED | DB60 e ENG (mesmas 50 fixtures à mão); MUT |
| Modelos versionados, simulador, recálculo que acrescenta evento | VERIFIED | DB61, DB62; FLOW |
| Distribuição manual, rodízio, critérios com reserva; idempotente | VERIFIED | DB62; DIST |
| Leads: lista, filtros, busca, detalhe, edição, arquivar, atribuir | VERIFIED | PIPE; DEMO |
| Pipeline Kanban (arrastar, teclado, seletor), transições válidas, motivo, status final | VERIFIED | PIPE; DB62 |
| Atividades e follow-ups; primeiro contato = atividade concluída | VERIFIED | PIPE; DB62, DB63 |
| Campanhas (nascem do UTM) e qualidade por campanha | VERIFIED | FLOW; DEMO |
| Painel: 10 indicadores, 9 gráficos com tabela alternativa, filtros, fuso por organização, alertas | VERIFIED | DEMO; DB63 |
| Relatórios e exportação CSV (fórmulas neutralizadas) | VERIFIED | PIPE; DEMO |
| Importação CSV (validar → importar; limites; duplicados) | VERIFIED | PIPE; SEC |
| IA opcional separada do score (habilitação, limite diário, dados minimizados, saída validada) | VERIFIED (adaptador, limites e permissões); provedor real: BLOQUEADO — exige credencial | DB64; ENG/`ai` com `fetch` simulado |
| LGPD: consentimento, anonimização, retenção, sem PII em logs | VERIFIED | DB62; FLOW |
| Segurança: RLS por papel e organização, privilégios por coluna, anônimo só nas 2 funções, sem segredo no navegador, XSS | VERIFIED | DB62; SEC; DEMO |
| Mobile (390 px) e público multietapa | VERIFIED | MOB |
| Dados de demonstração (150 leads fictícios) | VERIFIED | `supabase/seed.sql`; DEMO |
| Instalação isolada | VERIFIED | `export-system.mjs` → install, lint, tipos, unit, build, `test:db`, E2E na cópia |

## Testes obrigatórios (seção 26 do prompt)
| Grupo | Status | Evidência |
|---|---|---|
| Formulário: criar, perguntas, condicionais, etapas, prévia, publicar, versão, duplicar, arquivar | VERIFIED | FLOW; BLD; DB61 |
| Captação: envio, obrigatórios, inválidos, consentimento, UTM, honeypot, duplicidade, rate limit | VERIFIED | DB62; FLOW; SEC |
| Scoring: operadores, faixas, bordas (0/39/40/69/70), teto/piso, negativos, ausentes, desativada, versões, recálculo, explicação | VERIFIED | DB60, ENG; DB61/62 |
| Distribuição: manual, rodízio, critérios, concorrência, idempotência, vendedor inativo | VERIFIED | DB62; DIST |
| Pipeline: transições, motivo, histórico, status final | VERIFIED | PIPE; DB62 |
| Atividades e follow-ups | VERIFIED | PIPE |
| Dashboard: indicadores, período, fuso, filtros, funil, tempo até contato, alertas | VERIFIED | DB63; DEMO |
| Segurança: RLS A/B, papéis, anônimo, colunas protegidas, XSS, CSV, limites, segredos | VERIFIED | SEC; DB61–62 |
| LGPD: anonimização, retenção, consentimento | VERIFIED | DB62; FLOW |
| IA: desabilitada, limite, permissões, não altera o score | VERIFIED | DB64 |
| Responsivo e acessibilidade básica (rótulos, foco, teclado, tabelas alternativas) | VERIFIED | MOB; PIPE (teclado); DEMO |

## Limites conhecidos
- Nenhum envio de mensagens, enriquecimento, pagamentos, RAG, webhooks de saída nem integração com plataformas de anúncio (fora do escopo; ver `docs/DECISIONS.md` D-9).
- Chamadas reais ao provedor de IA não foram executadas (sem credencial).
- A fila de revisão de duplicados é só uma marcação: a fusão de leads é manual (arquive o que sobrar).
