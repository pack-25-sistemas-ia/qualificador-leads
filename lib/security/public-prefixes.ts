// Rotas públicas deste sistema: o formulário de captação (/f/[slug]). Cada uma valida o formulário publicado,
// limita abuso e nunca usa sessão (ver app/f/[slug]). Arquivo do sistema (.core-overrides).
export const PUBLIC_PREFIXES: readonly string[] = ['/f/'];
