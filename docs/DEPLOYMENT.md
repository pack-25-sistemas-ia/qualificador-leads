# DEPLOYMENT — Qualificador de Leads Inteligente

Tudo é seu: seu projeto Supabase, seu repositório, sua hospedagem. Nada é enviado ao autor do Pack.

## Pré-requisitos
Node 22+, pnpm, Docker (só para o Supabase local), conta Supabase (região **São Paulo** para dados pessoais) e hospedagem Node (ex.: Vercel).

## Variáveis (`.env.local`, nunca no git)
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app (usada nos links dos formulários) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable/anon (segura no navegador, limitada pelo RLS) |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (opcionais) | análise por IA: API compatível com *chat completions*; `AI_BASE_URL` em https. A chave fica só no servidor. |
| `AI_PROVIDER` (opcional) | nome exibido no histórico da análise |

O app **não usa** `service_role`. Não a coloque em variável alguma. Sem as variáveis de IA o sistema funciona normalmente e a tela de configuração avisa que a IA está desabilitada.

## Banco
1. Local: `supabase start` e `supabase db reset` (migrações + `seed.sql` com dados fictícios).
2. Produção: `supabase link --project-ref <ref>` e `supabase db push`. **Não** aplique `seed.sql` em produção (cria usuários de demonstração).
3. No Supabase: confirmação de e-mail, senha mínima de 12, TOTP, **SMTP próprio** e a URL do app em Redirect URLs. Modelos em `supabase/templates`.
4. Teste de banco: `pnpm test:db` (Docker). Mutação: `node scripts/mutation-check.mjs`.

## Aplicação
`pnpm install --frozen-lockfile` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm start`. E2E: `pnpm test:e2e` (Supabase local com Mailpit e app rodando; ver `playwright.config.ts`). Sempre refaça o `build` antes de rodar o E2E depois de mudar o código.
**Windows:** use um caminho curto para a pasta (caminho longo quebra o Vitest/Vite).

## Dados de demonstração
Senha local única `DemoLocal#2026`: `dono@`, `gerente@`, `vendedor1@`, `vendedor2@`, `leitor@` `demo.exemplo`. O proprietário cadastra a verificação em duas etapas no primeiro acesso. Formulários públicos de exemplo: `/f/qualificacao-b2b`, `/f/busca-de-imovel`, `/f/agencia-de-marketing`. Para uma implantação real, remova a organização «Empresa Demonstração». Para regerar o seed: `node scripts/gen-seed.mjs`.

## Primeiro uso real
Crie sua conta e a organização → Configurações comerciais (fuso, distribuição, política de privacidade, retenção) → Formulários (comece por um dos 5 modelos) → Qualificação (modelo de score: crie, simule, publique) → Distribuição (vendedores no rodízio) → divulgue o link com UTM.

## LGPD e operação
- Quem implanta é o controlador. Informe a finalidade no texto do consentimento e publique sua política de privacidade (campo em Configurações).
- Anonimização por lead (administração) e **retenção** configurável (botão aplica; para automatizar, agende `select public.lead_apply_retention(<org>)` com um administrador).
- Pedidos de titulares: página «Privacidade (LGPD)» do Core.
- O limite de taxa por visitante usa o hash do IP; atrás de proxy/CDN confirme que `x-forwarded-for` traz o IP do visitante.

## Backup, restauração e rollback
Ative backups automáticos no Supabase e **teste a restauração** antes de usar dados reais. Rollback de código: reimplante a tag anterior. Migrações são só para frente: para desfazer uma, escreva uma migração nova. Versões publicadas (formulário e modelo) são imutáveis por desenho.
