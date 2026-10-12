# ARCHITECTURE — Qualificador de Leads Inteligente

Next.js (App Router, `proxy.ts` com CSP por requisição) + Supabase (Auth, Postgres com RLS). Estrutura raiz do Core (sem `src/`). Decisões em `docs/DECISIONS.md`.

## Camadas
1. **Banco = fonte da verdade.** Validação do formulário público, normalização, deduplicação, pontuação, atribuição e transições vivem em funções SQL (`security definer`, `search_path` vazio, papel e MFA checados dentro). O app não usa `service_role`.
2. **Espelhos TypeScript** (`lib/leads/scoring.ts`, `formlogic.ts`) para simulador, prévia e validação por etapa no navegador. Provados idênticos ao banco pelas **mesmas fixtures** (`tests/fixtures/*.json` → testes unitários e SQL gerado por `scripts/gen-fixtures-sql.mjs`).
3. **Server Actions** (`lib/leads/actions.ts`): sessão + papel + Zod no servidor; mensagens de erro do banco só quando escritas por nós.
4. **Páginas** (`app/(app)/…`), componentes (`components/leads`, `components/app`). Gráficos e editor só no navegador.

## Captação pública (`/f/[slug]`)
Página sem sessão; fala com o banco só pelas duas funções `PUBLIC_ENDPOINT`. Camadas: honeypot e tempo mínimo (respondem «ok» sem gravar) → limitador em memória por IP → limitador compartilhado no banco (hash do IP; apagado em até 1 dia) → validação/pontuação/deduplicação na função. UTM e consentimento gravados; só o hash do IP é usado; `noindex`, `no-referrer`, CSP estrita, `X-Frame-Options: DENY`. Redirecionamento pós-envio só `https://`.

## Fluxo de um lead
formulário publicado (versão N) → envio → resposta (guarda N) + lead (`new`) + evento de score (modelo vigente, com justificativa) + atribuição conforme estratégia → pipeline (transições válidas, histórico) → atividades (primeiro contato) → convertido/desqualificado (motivo). Publicar versão nova de formulário ou modelo **nunca reescreve o passado**; «Recalcular» acrescenta evento.

## IA opcional (`lib/leads/ai.ts`)
Só servidor; provedor compatível com *chat completions* por `AI_BASE_URL/AI_API_KEY/AI_MODEL` (https obrigatório, http só em localhost). Dados minimizados (sem nome, e-mail, telefone, empresa; e-mails/telefones em texto livre mascarados), saída JSON validada por Zod, tempo limite, sem redirecionamentos, limite diário no banco (`lead_ai_save`). Resultado em `ai_analyses`, exibido à parte; **não altera o score**. Sem credenciais: desabilitada e a tela diz isso. Validação com provedor real: BLOQUEADA (exige credencial); o adaptador é testado com `fetch` simulado.

## Segurança (resumo)
RLS em tudo; privilégios por coluna; MFA no banco; CSP com nonce; rotas públicas só sob `/f/`; CSV com neutralização de fórmulas e limites (1 MB, 2.000 linhas); saída sempre escapada (React); sem PII em logs; sem segredo no cliente (E2E varre os pacotes de JS).

## Estrutura
`lib/leads/` (filters, format, csv, scoring, formlogic, templates, validation, rule-value, data, dashboard, chart-rows, actions, ai, public) · `components/leads/` (renderizador, construtor, quadro, regras, gráficos…) · `supabase/` (migrações, testes, seed) · `scripts/` (test-db, gen-fixtures-sql, gen-seed, mutation-check).
