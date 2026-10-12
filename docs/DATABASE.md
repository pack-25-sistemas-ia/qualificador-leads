# DATABASE — Qualificador de Leads Inteligente

Migrações (nesta ordem, depois das do Core): `…_leads_schema.sql` (tabelas, motor de score, validação do formulário, RLS), `…_leads_flow.sql` (formulários, captação pública, atribuição, pipeline, LGPD, IA), `…_leads_metrics.sql` (indicadores). Toda tabela tem `organization_id` + RLS; chaves compostas `(id, organization_id)` impedem referência entre organizações.

## Tabelas
`lead_settings` (fuso, política de duplicidade, estratégia de distribuição, ponteiro do rodízio, retenção, política de privacidade) · `lead_forms` (slug global único, https-only no redirecionamento) · `lead_form_versions` (esquema, lógica condicional, consentimento; **imutável depois de publicada**; um rascunho por formulário) · `campaigns` (por `utm_campaign`) · `leads` · `form_submissions` (respostas + UTM + versão usada; `submission_key` único por formulário = idempotência) · `scoring_models` / `scoring_rules` (versões imutáveis; um publicado e um rascunho) · `lead_score_events` (**só acrescenta**) · `lead_sellers`, `distribution_rules`, `lead_assignments` · `lead_activities` · `lead_status_history` · `disqualification_reasons` · `integration_configs` (só IA; nunca segredo) · `ai_analyses` · `public_rate_limits` (sem acesso para ninguém; só as funções públicas).

## Quem escreve o quê
- **Sem escrita direta** (só por função): status, atribuição, score, versões, publicação, análises de IA, limites de taxa.
- **Colunas liberadas** (privilégio por coluna): dados de contato e observações do lead, arquivar, configurações, campanhas, regras de score do **rascunho**, regras de distribuição, vendedores, atividades. Nunca `organization_id`, `status`, `current_score`, `assigned_to`, `created_by`.
- Papéis: owner/admin (tudo, MFA), manager (formulários, modelo, distribuição, importação), member = vendedor (só leads atribuídos a ele), viewer (leitura). MFA (AAL2) exigido no banco para owner/admin e nas funções de gestão.
- O app usa **update e depois insert** em vez de *upsert* onde há colunas protegidas (o upsert tentaria atualizar a chave).

## Funções
- **Públicas (`anon`)**, ambas `PUBLIC_ENDPOINT`: `lead_public_form(slug)` (definição publicada; resposta idêntica para inexistente/rascunho/arquivado) e `lead_public_submit(...)` (valida contra a versão publicada, descarta campos ocultos, limita taxa — 15 por visitante/10 min e 600 por formulário/hora —, deduplica por e-mail/telefone normalizados sob trava, cria campanha pelo UTM, grava resposta + lead + score + atribuição numa transação, não devolve dados do lead).
- **Motor:** `lead_score_compute` (puro, determinístico), `lead_validate_form_def`, `lead_validate_answers`; `lead_simulate`, `lead_rescore(_all)`, `lead_model_draft/publish`.
- **Formulários:** `lead_form_create/save_draft/publish/archive/duplicate`.
- **Leads:** `lead_create`, `lead_import(rows, apply)`, `lead_change_status` (transições válidas, motivo obrigatório ao desqualificar, idempotente), `lead_assign`, `lead_distribute_pending` (idempotente), `lead_find_duplicate`, `lead_anonymize`, `lead_apply_retention`.
- **IA:** `lead_ai_usage`, `lead_ai_save` (limite diário no banco).
- **Indicadores:** `lead_kpis`, `lead_series`, `lead_score_distribution`, `lead_class_distribution`, `lead_by_source/campaign/seller`, `lead_funnel`, `lead_status_counts`, `lead_first_contact_distribution`, `lead_alerts`, `lead_user_labels`.

## Regras de negócio no banco
Transições: novo → {qualificação, qualificado, contato, desqualificado}; qualificação → {novo, qualificado, contato, desqualificado}; qualificado → {qualificação, contato, convertido, desqualificado}; contato → {qualificado, convertido, desqualificado}; desqualificado → {novo, qualificação}; **convertido é final**. Regras de score sobre perguntas que o formulário não tem são ignoradas (um modelo serve a vários formulários).

## Testes de banco (`pnpm test:db`, Postgres 17 descartável)
`60_lead_scoring_fixtures` (50 + 5 inválidas, calculadas à mão) · `60_lead_form_fixtures` (10 + 12) — geradas por `scripts/gen-fixtures-sql.mjs` das mesmas fixtures do TypeScript · `61_lead_forms_model` · `62_lead_public_pipeline` (captação, validação, duplicidade, limite de taxa, distribuição, RLS por papel, pipeline, atividades, importação, recálculo, LGPD) · `63_lead_metrics` · `64_lead_ai`.
**Mutação:** `node scripts/mutation-check.mjs` quebra de propósito as regras críticas e exige que a suíte reprove cada uma.

## Extensão
Campo extra do lead: coluna `custom jsonb` (objeto, até 8 KB); para filtro ou relatório, crie coluna própria numa migração nova.
