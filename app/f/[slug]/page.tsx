import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Card } from '@/components/ui/primitives';
import { PublicForm } from '@/components/leads/public-form';
import { fetchPublicForm } from '@/lib/leads/public';
import { rateLimit } from '@/lib/security/rate-limit';
import { themeParam } from '@/lib/theme';

// Página pública do formulário: sem login, só com o link. Nunca usa a sessão; fala com o banco só pelas funções públicas.
// Não indexável e sem enviar o endereço como referência para outros sites.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Formulário', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

function Unavailable({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4 py-10">
      <Card><h1 className="text-lg font-semibold">{title}</h1><p className="mt-2 text-sm text-muted">{text}</p></Card>
    </main>
  );
}

export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'desconhecido';
  if (!rateLimit(`form-view:${ip}`, { limit: 120, windowMs: 60_000 }).allowed) {
    return <Unavailable title="Muitas tentativas" text="Aguarde um minuto e tente de novo." />;
  }
  const form = await fetchPublicForm(slug);
  if (!form) return <Unavailable title="Formulário indisponível" text="Este link não existe ou o formulário não está mais recebendo respostas." />;

  // pré-preenchimento SÓ de campos ocultos (rastreamento), nunca de dados pessoais
  const prefill: Record<string, string> = {};
  for (const f of form.schema.fields) {
    if (f.type !== 'hidden') continue;
    const v = sp[f.key];
    const val = Array.isArray(v) ? v[0] : v;
    if (val) prefill[f.key] = val.slice(0, 200);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <link rel="stylesheet" href={`/f/theme.css?c=${themeParam(form.primary)}`} precedence="theme" />
      <header className="mb-6">
        {form.company ? <p className="text-sm font-medium text-muted">{form.company}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight">{form.name}</h1>
        {form.description ? <p className="mt-2 text-sm text-muted">{form.description}</p> : null}
      </header>
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <PublicForm slug={slug} schema={form.schema} logic={form.logic} consent={form.consent} privacyUrl={form.privacyUrl} thankYou={form.thankYou} redirectUrl={form.redirect} prefill={prefill} />
      </div>
      <p className="mt-4 text-center text-xs text-muted">Seus dados são usados apenas para retornar este contato.</p>
    </main>
  );
}
