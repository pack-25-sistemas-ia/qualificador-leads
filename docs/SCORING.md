# SCORING — Motor de pontuação e classificação

Determinístico, explicável e **sem IA**. Fonte da verdade: função SQL `public.lead_score_compute`; espelho TypeScript `lib/leads/scoring.ts` para o simulador. As duas passam nas mesmas fixtures calculadas à mão (`tests/fixtures/scoring-cases.json`).

## Regra
`campo` (chave de uma pergunta do formulário) + `operador` + `valor` + `pontos` (inteiro de −100 a +100) + `rótulo` + ativa/inativa + prioridade (ordem de exibição).

| Operador | Verdadeiro quando | Valor |
|---|---|---|
| `eq`, `neq` | resposta igual / diferente do valor (texto, número ou escolha) | escalar |
| `in`, `not_in` | resposta (ou alguma das escolhas, em multisseleção) está / não está na lista | lista |
| `gt`, `gte`, `lt`, `lte` | comparação numérica | número |
| `between` | `min ≤ resposta ≤ max` | `{min, max}` |
| `contains` | texto contém o trecho (sem diferenciar maiúsculas) ou multisseleção contém a opção | texto |
| `is_true` | caixa marcada | — |
| `answered`, `not_answered` | há / não há resposta | — |

Só esses operadores existem. Nada do usuário é executado como código.

## Cálculo
1. Usam-se somente as respostas **válidas e visíveis** (campos ocultos pela lógica condicional são descartados antes).
2. Cada regra ativa é avaliada. Resposta ausente: a regra **não se aplica** (0 ponto), exceto `not_answered`.
3. `total_bruto = Σ pontos das regras aplicadas` (pontos negativos permitidos).
4. `score_final = limitar(total_bruto, 0, 100)`.
5. Classificação pelas faixas do modelo: `frio` (< `warm_min`), `morno` (≥ `warm_min` e < `hot_min`), `quente` (≥ `hot_min`). Padrão 0–39 / 40–69 / 70–100 (`warm_min = 40`, `hot_min = 70`).
6. `qualificado = score_final ≥ qualified_min` (padrão = `hot_min`, editável). É este o critério dos indicadores «leads qualificados» e «taxa de qualificação».
7. **Dados ausentes relevantes** = campos citados por regras ativas e sem resposta (e que não estão ocultos). Aparecem na justificativa.

Faixas válidas: `0 < warm_min < hot_min ≤ 100` e `0 ≤ qualified_min ≤ 100`.

## Explicação gravada (`lead_score_events.explanation_json`)
`{ raw_total, score, classification, qualified, applied: [{rule_id, label, field_key, points}], missing: [campo…] , model_version }` + `scoring_model_id`, `evaluated_at`. O usuário vê por que o lead tem aquela nota.

## Versões
- Modelo **publicado é imutável** (regras incluídas). Editar = criar rascunho a partir do publicado, alterar, **simular** com um lead de exemplo e publicar uma nova versão (a anterior fica arquivada).
- O score de um lead é um **evento**; a nota atual é o último evento. Publicar uma versão nova **não recalcula** o histórico; «Recalcular» é uma ação explícita que acrescenta um novo evento com a versão nova, preservando os antigos.
- Submissão nova usa o modelo publicado no momento.

## Equidade
Não crie regras com características protegidas (raça, religião, saúde, orientação, etc.) nem proxies delas. O sistema orienta isso na tela, mas a responsabilidade pelo modelo é de quem o configura. O score é apoio à priorização comercial, não decisão automatizada sobre pessoas.

## IA (opcional)
A análise textual de IA é gravada e exibida **à parte** e **nunca altera** o score (`docs/ARCHITECTURE.md`).

## Modelo de demonstração (valores configuráveis, não universais)
Orçamento superior a R$ 5.000 (+25) · contratar em até 30 dias (+25) · participa da decisão (+20) · mais de 10 funcionários (+15) · problema prioritário declarado (+15). Total máximo: 100.

## Um modelo para vários formulários
O modelo é da organização. Ao pontuar um lead, **regras sobre perguntas que o formulário não tem são ignoradas** (não pontuam e não aparecem como dado ausente). O simulador faz o mesmo quando você escolhe o formulário.
