# MEMORY — QUALIFICADOR DE LEADS INTELIGENTE
Atualizado em: 2026-10-12 | Versão: 0.2.0 | Estado: VALIDADO

## Missão do sistema
Captar leads por formulários públicos, qualificar por score explicável (0–100), distribuir ao vendedor e medir a qualidade por campanha. Público: times de marketing e vendas de pequenas e médias empresas.

## Stack e caminhos-chave
Next.js 16 (App Router, `proxy.ts`) + TypeScript strict + Tailwind 4 + Supabase (Auth, Postgres/RLS). Raiz do Core (sem `src/`). Banco: `supabase/migrations` (3 do sistema), testes SQL em `supabase/tests`. Libs: `lib/leads/*`; componentes: `components/leads/*`.
Comandos: `pnpm lint | typecheck | test | build | test:db | test:mutation | test:e2e`; `node scripts/gen-fixtures-sql.mjs` (regera SQL das fixtures); `node scripts/gen-seed.mjs` (regera o seed).

## Escopo entregue
Construtor de formulários + 5 modelos; página pública multietapa; captação validada e pontuada no banco; score versionado com simulador; duplicidade; distribuição (manual/rodízio/critérios); pipeline Kanban; atividades; campanhas; painel (10 KPIs, 9 gráficos); relatórios e CSV; importação; IA opcional separada do score; LGPD (consentimento, anonimização, retenção); seed de 150 leads fictícios.
Fora do escopo: CRM completo, disparo em massa, enriquecimento, pagamentos, RAG, webhooks de saída, custo/ROAS/CAC.

## Implementado e verificado (evidência em docs/FEATURES.md)
- Banco: 6 arquivos de teste SQL (inclui 50+10 fixtures calculadas à mão) e **31 mutações** reprovadas pela suíte.
- Unitários: 163 (motor de score e contrato do formulário espelham o banco com as mesmas fixtures; modelos; construtor; IA com `fetch` simulado).
- E2E (31 testes, também na cópia exportada; Supabase local + build de produção): fluxo completo, pipeline/atividades/importação, distribuição, demonstração com números do seed, segurança/RLS, mobile.
- Lint, tipos e build limpos.

## Pendências e riscos
- IA com provedor real: BLOQUEADO (sem credencial); só o adaptador foi testado.
- Retenção não é agendada sozinha (botão ou agendamento do implantador).
- Fusão de duplicados é manual.

## Decisões relevantes (docs/DECISIONS.md)
D-1 contrato próprio de formulário interpretado no banco · D-2 operadores fechados · D-3 captação 100% no banco · D-4 versões imutáveis · D-5 IA opcional separada · D-6 distribuição com trava · D-7 status fixos com guarda · D-8 duplicidade configurável · D-9 sem webhooks · D-11 fuso por organização.

## Armadilhas aprendidas
- Rode `pnpm build` antes do E2E ao mudar código (o E2E usa o build).
- `greatest(0, NULL)` do Postgres devolve 0: trate NULL antes (bug pego pela fixture à mão).
- `upsert` do PostgREST falha com colunas protegidas: use update e depois insert.
- Elementos `sr-only` dentro de contêiner com rolagem lateral precisam de `position: relative` no contêiner.
- Windows: caminho curto para a pasta (Vitest/Vite).

## Testes e deploy
- Instalação isolada validada (cópia exportada: install, lint, tipos, unit, build, test:db, E2E).
- Deploy: ver docs/DEPLOYMENT.md.

## Próxima tarefa recomendada
Personalizar para o cliente: modelos de formulário, modelo de score e política de privacidade.
