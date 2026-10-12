import { themeCss } from '@/lib/theme';

// Tema (cor primária) do formulário público como CSS do próprio domínio (vale sob a CSP estrita). Pública (/f/ é prefixo público)
// e sem dados sensíveis: só uma cor, validada (#RRGGBB); qualquer outro valor cai no padrão.
export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('c') ?? '';
  const css = themeCss(/^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}` : null);
  return new Response(css, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
