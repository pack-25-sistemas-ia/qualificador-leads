# OPEN_SOURCE_AUDIT — Qualificador de Leads Inteligente

Consulta de 2026-10-12 (API do GitHub e `npm view`). «Incorporado» = código copiado para este repositório. Dependências instaladas aparecem em `THIRD_PARTY_NOTICES.md` do Pack.

## Matriz de referências

| Projeto | Licença | Versão npm | Atividade | Tecnologia | Decisão |
|---|---|---|---|---|---|
| react-hook-form | MIT | 7.89.0 (já no Core dos sistemas) | 2026-10-12 | React | **Usar** nos formulários internos (administração) |
| react-jsonschema-form (RJSF) | Apache-2.0 | @rjsf/core 6.11.0 | 2026-10-12 | React, JSON Schema | **Referência**; não adotado (ver D-1) |
| SurveyJS Form Library | MIT (biblioteca; o *Survey Creator* é comercial) | survey-core 3.2.0 | 2026-10-12 | TS, KO/React | **Referência** (condicionais e multipasso); não adotado |
| JSON Forms | MIT | @jsonforms/core 3.8.0 | 2026-10-09 | React, JSON Schema | **Referência**; não adotado |
| Form.io (formio.js) | MIT (só o componente JS; o ecossistema tem outras licenças) | — | 2026-09-30 | JS | **Não adotado**: editor pesado, estilos em linha |
| json-rules-engine | ISC | 7.3.1 | 2026-02-16 | JS | **Referência** de modelo de regras; não adotado (ver D-2) |
| Atomic CRM | MIT | — | 2026-10-12 | React + Supabase | **Referência** de UX (lista, detalhe, atividades); nada copiado |
| shadcn/ui | MIT | — | 2026-10 | Radix + Tailwind | **Não incorporado** (o Core tem primitivos próprios com a mesma acessibilidade) |
| Vercel AI SDK | Apache-2.0 (o GitHub exibe «NOASSERTION» por arquivos mistos) | ai 7.0.138 | 2026-10-12 | TS | **Não adotado**: um adaptador `fetch` de ~100 linhas cobre o necessário e evita dependência e atualização frequente (ver D-5) |
| HeyForm | **AGPL-3.0** | — | 2026-10-10 | TS | **Só inspiração visual. Nenhum código incorporado** |
| Typebot | licença própria (FSL) | — | 2026-10-07 | TS | **Só inspiração de lógica. Nenhum código incorporado** |
| n8n | licença restritiva (Sustainable Use) | — | — | — | **Não utilizado** |

## Riscos observados
- **Motores de formulário/regras em JavaScript** não rodam dentro do PostgreSQL. A captação pública precisa ser validada, pontuada e gravada **no banco** (sem `service_role` no app), então o contrato do formulário e das regras tem que ser interpretável em SQL. É o motivo central de não adotar RJSF/SurveyJS/JSON Forms/json-rules-engine como fonte de verdade.
- **Estilos em linha**: vários construtores injetam `style`/`<style>`, bloqueados pela CSP estrita do Core.
- **Licenças de terceiros**: AGPL (HeyForm) e licenças de uso restrito (Typebot, n8n) incompatíveis com a distribuição pretendida: nada incorporado.

## Dependências adicionadas por este sistema (sobre o Core)
| Pacote | Versão | Licença | Uso |
|---|---|---|---|
| recharts | 3.10.1 | MIT | gráficos do painel |
| react-hook-form + @hookform/resolvers | 7.89.0 / 5.9.1 | MIT | formulários de administração |
| @tanstack/react-table | 8.21.3 | MIT | tabelas |
| papaparse | 5.7.0 | MIT | importação de leads em CSV |
| @dnd-kit/core, sortable, utilities | 6.3.1 / 10.0.0 / 3.2.2 | MIT | pipeline Kanban (arrastar) |

Arquivos de terceiros incorporados a este repositório: **nenhum**.
