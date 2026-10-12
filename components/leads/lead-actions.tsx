'use client';

import { useRouter } from 'next/navigation';
import { ActionButton } from '@/components/app/form-kit';
import { anonymizeLead, archiveLead, rescoreLead } from '@/lib/leads/actions';

export function LeadHeaderActions({ id, archived, anonymized, canManage, canAdmin }: { id: string; archived: boolean; anonymized: boolean; canManage: boolean; canAdmin: boolean }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      {canManage && !anonymized ? <ActionButton label="Recalcular score" pendingLabel="Calculando…" variant="secondary" action={() => rescoreLead(id)} confirm="Recalcular o score com o modelo vigente? O histórico anterior é preservado e um novo evento é acrescentado." /> : null}
      {canManage ? <ActionButton label={archived ? 'Restaurar' : 'Arquivar'} variant="secondary" action={() => archiveLead(id, !archived)} /> : null}
      {canAdmin && !anonymized ? (
        <ActionButton
          label="Anonimizar (LGPD)" pendingLabel="Anonimizando…" variant="danger"
          confirm="Anonimizar remove nome, e-mail, telefone, empresa, observações e todas as respostas deste lead. Não pode ser desfeito. Os números agregados são mantidos. Continuar?"
          action={() => anonymizeLead(id)}
          onDone={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
