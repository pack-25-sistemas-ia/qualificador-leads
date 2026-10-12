---
name: lead-scoring
description: Use ao mexer no motor de score, nas faixas, nas regras, no simulador ou no recálculo.
---

# Score de leads

- Fonte da verdade: `public.lead_score_compute` (puro, determinístico). Espelho: `lib/leads/scoring.ts`. As duas passam nas mesmas fixtures calculadas à mão (`tests/fixtures/scoring-cases.json`).
- Score = soma dos pontos das regras aplicáveis, limitada a 0–100. Resposta ausente: a regra não se aplica (exceto `not_answered`) e o campo vira «dado ausente». Operadores: lista fechada de 13; nada do usuário é executado.
- Classe pelas faixas do modelo (padrão 40/70); qualificado = score ≥ `qualified_min`.
- Modelo publicado e suas regras são imutáveis (gatilhos). Mudança = rascunho → simular → publicar. Recalcular ACRESCENTA `lead_score_events`; nunca reescreve.
- Regras sobre perguntas que o formulário não tem são ignoradas (`private.lead_rules_json`).
- Equidade: sem regras com características protegidas (nem substitutos). O score apoia a priorização; não decide sobre pessoas.
- Ao mudar qualquer regra: atualize as fixtures, `node scripts/gen-fixtures-sql.mjs`, `pnpm test`, `pnpm test:db`, `pnpm test:mutation`.
