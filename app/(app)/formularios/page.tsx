import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/leads/access';
import { listForms, loadSettings, submissionCounts } from '@/lib/leads/data';
import { getPublicEnv } from '@/lib/env';
import { formatDay } from '@/lib/leads/format';

export const metadata: Metadata = { title: 'Formulários' };

export default async function FormsPage() {
  const ctx = await requireContext();
  const manager = (MANAGER_ROLES as readonly string[]).includes(ctx.membership.role);
  const [forms, counts, settings] = await Promise.all([listForms(ctx), submissionCounts(ctx), loadSettings(ctx)]);
  const origin = getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');

  return (
    <>
      <PageHeader title="Formulários" description="Páginas públicas que captam leads. Cada publicação cria uma versão que nunca muda.">
        {manager ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href="/formularios/novo">Novo formulário</Link> : null}
      </PageHeader>
      {forms.length === 0 ? (
        <EmptyState title="Nenhum formulário ainda" description="Comece por um dos 5 modelos prontos (B2B, imobiliária, orçamento, diagnóstico, agência) e ajuste as perguntas.">
          {manager ? <Link className="underline" href="/formularios/novo">Criar o primeiro formulário</Link> : null}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {forms.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0">
                <Link className="font-medium underline-offset-2 hover:underline" href={`/formularios/${f.id}`}>{f.name}</Link>
                <p className="truncate text-xs text-muted"><code>{origin}/f/{f.slug}</code></p>
                <p className="mt-1 text-xs text-muted">{counts.get(f.id) ?? 0} resposta(s) · atualizado em {formatDay(f.updated_at, settings.timezone)}</p>
              </div>
              <Badge tone={f.status === 'published' ? 'success' : f.status === 'archived' ? 'neutral' : 'warning'}>{f.status === 'published' ? 'Publicado' : f.status === 'archived' ? 'Arquivado' : 'Rascunho'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
