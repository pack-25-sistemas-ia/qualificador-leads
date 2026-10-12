# AGENTS — Qualificador de Leads Inteligente

Sistema 03 do Pack 25 Sistemas IA (qualificador-leads). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS; toda mutação valida sessão, papel e entrada (Zod) no servidor.
- Nunca commitar segredos; service-role key só no servidor (este sistema nem a usa), jamais com prefixo NEXT_PUBLIC_.
- Dados pessoais mínimos; sem PII em logs; sem dados reais de cliente em seed.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db (Docker) · pnpm test:mutation · pnpm test:e2e (Supabase local + app **recompilado**) · node scripts/gen-fixtures-sql.mjs · node scripts/gen-seed.mjs

## Regras do sistema
- Validação do envio, deduplicação, pontuação, atribuição e transições vivem no BANCO. `lib/leads/scoring.ts` e `formlogic.ts` são espelhos: mexeu numa regra, atualize `tests/fixtures/*.json` (valores à mão), rode `gen-fixtures-sql.mjs` e os dois conjuntos de testes.
- Nunca escreva em status, atribuição, score, versão publicada ou análises de IA fora das funções `lead_*`. Versões publicadas (formulário e modelo) são imutáveis; recalcular ACRESCENTA evento.
- O score é determinístico e sem IA. A IA (`lib/leads/ai.ts`) nunca o altera, recebe dados minimizados e roda só no servidor.
- Rotas públicas só sob `/f/` (`lib/security/public-prefixes.ts`); só as duas funções `PUBLIC_ENDPOINT` são executáveis por `anon`. Resposta uniforme para formulário inexistente/rascunho.
- Operadores de regra são uma lista fechada; nada digitado pelo usuário é executado.
- CSP estrita: sem estilo em linha; tema público por `/f/theme.css`; gráficos e editor só no navegador.
- Mudou uma regra crítica de banco: rode `pnpm test:mutation` (todas as mutações devem morrer; adicione uma nova se criar regra crítica).
- Documentação: `docs/PLANO_IMPLEMENTACAO.md`, `DECISIONS.md`, `SCORING.md`, `DATABASE.md`, `ARCHITECTURE.md`, `METRICS.md`, `FEATURES.md`.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, fluxos críticos em Playwright, mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
