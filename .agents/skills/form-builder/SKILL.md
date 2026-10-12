---
name: form-builder
description: Use ao criar ou alterar o contrato do formulário (tipos de pergunta, lógica condicional, etapas, versões, modelos) ou o construtor/renderizador.
---

# Construtor de formulários

1. **Contrato** (`schema_json`, `conditional_logic_json`, `consent_config_json`) é interpretado no BANCO (`lead_validate_form_def`, `lead_validate_answers`) e espelhado em `lib/leads/formlogic.ts`. Tipo novo = migração + espelho TS + fixtures em `tests/fixtures/form-cases.json` + `node scripts/gen-fixtures-sql.mjs`.
2. Condições só dependem de perguntas ANTERIORES; contato obrigatório (e-mail/telefone ligado ao lead) nunca é condicional; campo oculto é descartado no envio.
3. Versão publicada é imutável. Editar = rascunho novo. O slug não muda depois de publicado. Redirecionamento só `https://`.
4. Renderizador único (`components/leads/form-renderer.tsx`) na página pública e na prévia. Honeypot, consentimento e foco por etapa fazem parte do contrato de acessibilidade.
5. Modelos prontos em `lib/leads/templates.ts` precisam publicar e atingir 100 pontos no exemplo (`tests/unit/lead-templates.test.ts`). Sem perguntas sobre características protegidas.
6. Funções puras do editor em `components/leads/builder-state.ts` (testadas sem navegador).
