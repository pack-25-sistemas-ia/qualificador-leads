'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Field } from '@/components/ui/primitives';
import { importLeads, type ImportReport } from '@/lib/leads/actions';
import { MAX_IMPORT_BYTES } from '@/lib/leads/csv';

export function ImportLeadsForm() {
  const [state, action, pending] = useActionState(importLeads, {} as ImportReport);
  // o servidor (Next) recusa corpos acima de ~1 MB antes da nossa validação: avisa já no navegador
  const [tooBig, setTooBig] = useState(false);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <Field label="Arquivo CSV" name="file" hint="Até 1 MB e 2.000 linhas. Separador ; ou , e codificação UTF-8. Colunas: nome, e-mail, telefone, empresa, segmento, origem (e-mail ou telefone é obrigatório).">
          <input id="file" name="file" type="file" accept=".csv,text/csv" required onChange={(e) => setTooBig((e.target.files?.[0]?.size ?? 0) > MAX_IMPORT_BYTES)} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm" />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="dryRun" defaultChecked className="mt-1 size-4" />
          <span><strong>Apenas validar</strong> (não grava nada). Desmarque para importar de verdade depois de conferir o relatório.</span>
        </label>
        <Button type="submit" disabled={pending || tooBig} aria-busy={pending}>{pending ? 'Processando…' : 'Enviar'}</Button>
      </form>
      {tooBig ? <Alert tone="error">Arquivo muito grande (máximo de 1 MB).</Alert> : null}
      {state.message ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
      {state.created !== undefined ? (
        <section aria-label="Relatório da importação" className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          <dl className="grid grid-cols-3 gap-3">
            <div><dt className="text-muted">{state.preview ? 'Prontos' : 'Importados'}</dt><dd className="text-lg font-semibold tabular-nums">{state.created}</dd></div>
            <div><dt className="text-muted">Duplicados</dt><dd className="text-lg font-semibold tabular-nums">{state.duplicates ?? 0}</dd></div>
            <div><dt className="text-muted">Com erro</dt><dd className="text-lg font-semibold tabular-nums">{state.invalid ?? 0}</dd></div>
          </dl>
          {state.unknownHeaders?.length ? <p className="text-muted">Colunas ignoradas: {state.unknownHeaders.join(', ')}.</p> : null}
          {state.lines?.length ? <ul className="max-h-56 space-y-1 overflow-auto">{state.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
        </section>
      ) : null}
    </div>
  );
}
