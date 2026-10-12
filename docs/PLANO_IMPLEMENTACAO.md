# PLANO DE IMPLEMENTAÇÃO — Qualificador de Leads Inteligente

Prompt de origem: «Prompt Mestre — Sistema 03 v3.0». Decisões do sistema em `docs/DECISIONS.md`; as do Pack (Core sincronizado, repositório por sistema, sem convite por e-mail) valem aqui.

## 1. Objetivo e público
Capturar leads por formulários públicos, qualificar com score transparente (0–100), classificar, distribuir a vendedores e acompanhar a evolução e os resultados por campanha. Público: agências, consultorias, imobiliárias, escolas, empresas B2B e de serviços com equipe de vendas.

## 2. Problemas resolvidos
Leads sem priorização; vendedor errado; leads esquecidos; campanhas sem medição de qualidade; sem tempo de primeiro atendimento; critérios de qualificação sem registro.

## 3. Referências
`docs/OPEN_SOURCE_AUDIT.md`. Nenhuma biblioteca de formulário/regras foi adotada como fonte de verdade (D-1, D-2).

## 4. Funcionalidades obrigatórias
Construtor de formulários (campos, condicionais, etapas, versões, 5 modelos) · página pública `/f/[slug]` · captura com UTM, honeypot, limite de taxa, duplicidade · scoring configurável com simulador e justificativas · leads (lista, detalhe, notas, atividades, atribuição, arquivar, CSV) · pipeline Kanban · distribuição (manual, round-robin, critérios) · atividades e follow-ups · campanhas · dashboard (10 indicadores, 9 gráficos, filtros) · relatórios com CSV · configurações · IA opcional separada do score · dados de demonstração.

## 5. Páginas
`/dashboard` · `/leads` · `/leads/[id]` · `/formularios` · `/formularios/[id]` (editor) · `/qualificacao` (modelo, regras, simulador) · `/distribuicao` · `/atividades` · `/campanhas` · `/relatorios` · `/configuracoes` · `/f/[slug]` (pública) · do Core: `/members`, `/privacy`, `/audit`, `/settings`.

## 6. Componentes
Editor de formulário (lista de perguntas, propriedades, condições, etapas, prévia) · renderizador de formulário multipasso (mesmo no editor e na página pública) · tabela de leads (TanStack) · Kanban (dnd-kit, também por teclado/seletor) · editor de regras e simulador · gráficos Recharts com tabela alternativa · barra de filtros · linha do tempo.

## 7. Entidades
organização 1—N formulários 1—N versões 1—N submissões N—1 lead · lead 1—N eventos de score, atribuições, atividades, histórico de status, análises de IA · modelos de score 1—N regras · campanhas · configurações · vendedores elegíveis · regras de distribuição · limites de taxa. Detalhes em `docs/DATABASE.md`.

## 8–9. Banco e segurança
Migrações `20270301…` (esquema/regras/RLS, funções do fluxo e público, indicadores). Mesmo padrão do Core (RLS, privilégios por coluna, MFA no banco). Anônimo só executa `lead_public_form` e `lead_public_submit` (`PUBLIC_ENDPOINT`). Papéis: administrador = owner/admin, gestor comercial = manager, vendedor = member (só leads atribuídos a ele), leitor = viewer.

## 10. Regras de negócio
Validação do envio contra a versão publicada no banco; campos ocultos descartados; duplicidade por e-mail/telefone normalizados; transições de status válidas; motivo de desqualificação; distribuição idempotente sob trava; versões imutáveis.

## 11–13. Indicadores, gráficos, filtros
`docs/METRICS.md`.

## 14. Importações e exportações
Importar leads por CSV (≤ 1 MB, 2.000 linhas, «apenas validar», duplicidade); exportar leads e relatórios em CSV com neutralização de fórmulas.

## 15. Testes de aceitação
Seção 26 do prompt mapeada em `docs/FEATURES.md` (um teste por item).

## 16. Critérios de conclusão
Seção 30 do prompt + gates do Pack (CI verde, instalação isolada, licenças, sem segredos).

## 17. Exclusões
CRM completo · disparo em massa · enriquecimento por terceiros · webhooks de saída · plataformas de anúncio · custo/ROAS/CAC · decisões automatizadas sobre pessoas · RAG · entrevista de personalização.

## 18. Etapas
1 Diagnóstico e documentos. 2 Banco: formulário, captação, score (+ testes e mutações). 3 Banco: pipeline, distribuição, atividades, indicadores. 4 Bibliotecas TS + fixtures. 5 Administração: formulários e qualificação. 6 Página pública. 7 Leads, pipeline, distribuição, atividades. 8 Painel, campanhas, relatórios. 9 IA opcional. 10 Seed, E2E, mobile. 11 Instalação isolada, documentação, CI.
