# METRICS — Qualificador de Leads Inteligente

Todos os números do painel, dos relatórios e dos CSV saem de **funções SQL** (`supabase/migrations/…_leads_metrics.sql`), *security invoker*: o RLS já limita o que cada papel enxerga (vendedor só os leads atribuídos a ele). Nada é fixo no código. Testadas com um conjunto pequeno de dados calculado à mão (`supabase/tests/63_lead_metrics.sql`) e conferidas de novo contra o seed na interface (`tests/e2e/lead-demo.spec.ts`).

## Regras gerais
- **Coorte:** o período filtra os leads **criados** no intervalo (`created_at`), no fuso da organização (`lead_settings.timezone`, padrão `America/Sao_Paulo`). Dia inclusivo: `[início 00:00, fim+1 00:00)`.
- Leads arquivados ficam fora. Leads anonimizados continuam nos agregados.
- Fuso inválido volta ao padrão. Período invertido ou maior que 730 dias é recusado.
- Filtros globais (combináveis, via URL): vendedor, campanha, origem (`direto` = sem origem), formulário de origem, classificação.
- Sem dados: taxas aparecem como «—», nunca «0%».

## Indicadores (10)
| Indicador | Definição |
|---|---|
| Leads capturados | leads criados no período |
| Leads qualificados | dos capturados, `qualified = true` (score ≥ mínimo de qualificação do modelo) |
| Taxa de qualificação | qualificados ÷ capturados × 100 (lead sem score entra no denominador) |
| Score médio | média de `current_score` dos que têm score (1 casa) |
| Leads quentes | `qualification = 'hot'` |
| Leads convertidos | dos capturados, `status = 'converted'` (coorte, não «conversões ocorridas no período») |
| Taxa de conversão | convertidos ÷ capturados × 100 |
| Tempo até o 1º contato | média, em minutos, de `first_contact_at − created_at` dos que têm contato. **Primeiro contato = primeira atividade CONCLUÍDA**; tarefa só agendada não conta. Nunca negativo. |
| Sem responsável | situação atual (sem recorte de data): abertos (não convertidos/desqualificados) sem `assigned_to` |
| Follow-ups atrasados | situação atual: leads com atividade não concluída e `due_at < agora` |

A variação «vs período anterior» compara com o período imediatamente anterior de mesma duração e só aparece se a base for diferente de zero.

## Gráficos (9)
1. Leads capturados × qualificados por período (dia ≤ 62 dias; semana ≤ 210; mês acima; períodos vazios aparecem com zero) · 2. Taxa de qualificação por período · 3. Distribuição do score em 10 faixas (90 = 90–100) · 4. Quentes/mornos/frios · 5. Leads por origem · 6. Qualidade por campanha · 7. Funil · 8. Conversão por vendedor · 9. Tempo até o primeiro contato (≤15 min, 15 min–1 h, 1–4 h, 4–24 h, >24 h, sem contato).
Cada gráfico traz «Ver dados em tabela» (acessível) e carrega só no navegador (CSP estrita).

## Funil (cada etapa contém a seguinte)
Capturados ⊇ **Em atendimento** (já esteve em qualificação, qualificado, contato ou convertido, ou tem primeiro contato) ⊇ **Contatados** (esteve em contato/convertido ou tem primeiro contato) ⊇ **Convertidos**.

## Alertas (agora)
Quente sem contato (acima de `alert_no_contact_hours`, padrão 24 h) · sem responsável · follow-up atrasado · possível duplicado para revisar.

## O que NÃO é calculado
Custo por lead, CAC e ROAS: o sistema não recebe dados de investimento dos anúncios.
