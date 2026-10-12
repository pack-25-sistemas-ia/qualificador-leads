---
name: supabase-security
description: Use ao criar tabela, função, política, privilégio ou rota pública deste sistema.
---

# Segurança do banco

- Toda tabela: `organization_id`, RLS, chave composta `(id, organization_id)` nas referências, `revoke all` e `grant` mínimo por coluna.
- Escrita sensível só por função `security definer` com `set search_path = ''`, papel e MFA checados dentro. Função pública (`anon`) exige comentário `PUBLIC_ENDPOINT:` (o teste do Core barra o resto).
- Vendedor (`member`) só enxerga/edita leads atribuídos a ele (`private.lead_can_read/write`). Leitor só lê.
- Não use `upsert` onde há colunas protegidas (PostgREST tenta atualizar a chave): update, depois insert.
- Nenhum segredo no git nem no navegador; IA só por variável de ambiente no servidor. E2E varre os pacotes de JS procurando `service_role`.
- Teste cada regra nova com RLS A/B e mutação (`pnpm test:mutation`).
