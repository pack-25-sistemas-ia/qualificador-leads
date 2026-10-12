# DECISIONS — Qualificador de Leads Inteligente

Registro de decisões do sistema (as do Pack estão em `docs/DECISIONS.md` do hub).

**D-1 Formulário: contrato próprio, interpretado igual no banco, na prévia e no navegador.**
Alternativas: RJSF, JSON Forms, SurveyJS, Form.io. Motivo: a submissão pública é validada e pontuada em PostgreSQL (função `SECURITY DEFINER`, sem `service_role`); um motor JS não roda lá. O contrato (`schema_json`, `conditional_logic_json`, `consent_config_json`) é pequeno, versionado e testado com as mesmas fixtures em SQL e TypeScript. Os construtores externos continuam sendo referência de UX.

**D-2 Regras: operadores fechados e avaliação determinística, em SQL (+ espelho TS).**
json-rules-engine foi avaliado e descartado como fonte de verdade pelo mesmo motivo. As regras são linhas (`campo`, `operador`, `valor`, `pontos`) com operadores de uma lista fixa; **nenhum código do usuário é executado**. Resultado = soma dos pontos aplicáveis limitada a 0–100, com justificativa por regra (`docs/SCORING.md`).

**D-3 Captação 100% no banco, com limite de taxa compartilhado.**
`lead_public_submit` valida contra a versão publicada, descarta campos ocultos, normaliza, deduplica, grava submissão + lead + score + (opcionalmente) atribuição em **uma transação**. O limite de taxa fica numa tabela do banco (compartilhado entre instâncias do app), chaveado por hash do visitante; o app ainda tem honeypot e limitador em memória como primeira barreira.

**D-4 Versões imutáveis de formulário e de modelo de score.**
Publicar cria uma versão que não muda; respostas e scores guardam a versão usada. Alterar depois não reinterpreta o passado. Recalcular é uma ação explícita que **acrescenta** um novo evento de score.

**D-5 IA opcional, no servidor, separada do score.**
Adaptador `fetch` para API compatível com chat (provedor configurável por variável de ambiente), com saída JSON validada por Zod, timeout, limite diário por organização e dados minimizados (sem nome, e-mail e telefone). A análise é gravada à parte (`ai_analyses`) e **nunca** altera o score. Sem credenciais: desabilitada e a tela diz isso. Vercel AI SDK não adotado (ver auditoria).

**D-6 Distribuição transacional.**
`lead_assign` usa trava consultiva por organização e só atribui se o lead ainda não tem responsável (idempotente). Round-robin guarda o ponteiro na configuração da organização.

**D-7 Pipeline com transições validadas por gatilho.**
Status fixos (novo, em qualificação, qualificado, em contato, convertido, desqualificado) com tabela de transições válidas e motivo obrigatório para desqualificar. Renomear/ocultar etapas não está no MVP (a posição visual nunca é a fonte da verdade).

**D-8 Duplicidade configurável.**
Política por organização: `link` (relaciona a submissão ao lead existente, padrão), `flag` (novo lead marcado como duplicado) ou `review` (novo lead em fila de revisão manual). Chave: e-mail normalizado ou telefone normalizado. Nunca por nome.

**D-9 Sem webhooks nesta versão.**
`integration_configs` guarda só a configuração da IA. Webhooks de saída exigem proteção contra SSRF, assinatura e fila de reentrega; ficam fora do MVP e documentados como extensão.

**D-10 Estrutura raiz do Core, não `src/`.** Igual ao Sistema 02: preserva o `sync-core`.

**D-11 Timezone por organização** (`lead_settings.timezone`, padrão America/Sao_Paulo) usado em todos os indicadores.
