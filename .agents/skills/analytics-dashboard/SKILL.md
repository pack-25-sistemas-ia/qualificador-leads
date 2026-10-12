---
name: analytics-dashboard
description: Use ao criar ou alterar indicadores, gráficos, filtros, relatórios ou CSV.
---

# Painel e relatórios

- Todo número vem de função SQL `security invoker` em `…_leads_metrics.sql`; definições em `docs/METRICS.md`. Coorte = leads criados no período, no fuso da organização.
- Novo indicador: função SQL + teste com dados calculados à mão em `supabase/tests/63_lead_metrics.sql` (inclua bordas de fuso/período) + linha em METRICS.md + E2E com o valor do seed.
- Cuidado clássico: `greatest(0, NULL)` = 0 no Postgres. Taxa sem base é «—», nunca 0%.
- Gráficos: Recharts só no navegador (`charts-loader`), cada um com «Ver dados em tabela» e esqueleto de carregamento. Cor + texto, nunca só cor.
- CSV: `lib/leads/csv.ts` neutraliza fórmulas (`= + - @`), UTF-8 com BOM, `;`. Limites de importação: 1 MB e 2.000 linhas.
- Filtros vêm da URL e são SEMPRE validados (`lib/leads/filters.ts`); período inválido cai em 30 dias.
