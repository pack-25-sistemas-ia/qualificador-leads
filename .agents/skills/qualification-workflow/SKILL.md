---
name: qualification-workflow
description: Use ao mexer em captação pública, duplicidade, distribuição, pipeline, atividades ou LGPD do lead.
---

# Fluxo do lead

Envio público → `lead_public_submit` (valida, deduplica sob trava, pontua, atribui, tudo numa transação) → pipeline → atividades → convertido/desqualificado.

- Só `lead_change_status` muda status (transições válidas, motivo obrigatório ao desqualificar, idempotente; convertido é final). Atribuição só por `lead_assign`/estratégia; distribuição usa trava consultiva e é idempotente.
- Duplicidade por e-mail/telefone normalizados (nunca por nome); política `link` (padrão), `flag` ou `review`.
- Primeiro contato = primeira atividade CONCLUÍDA.
- Públicas: apenas `lead_public_form` e `lead_public_submit`, resposta uniforme, nunca devolvem dados de leads. Limite de taxa compartilhado no banco.
- LGPD: consentimento gravado; anonimização remove dados pessoais, respostas e análises de IA mantendo agregados; retenção nunca atinge convertidos.
- UI otimista (quadro): uma mudança por vez por lead e reversão se o servidor recusar.
