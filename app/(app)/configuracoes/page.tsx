import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { AiConfigForm, RetentionButton, SettingsForm } from '@/components/leads/admin-forms';
import { requireContext } from '@/lib/auth/session';
import { ADMIN_ROLES } from '@/lib/leads/access';
import { readAiEnv } from '@/lib/leads/ai';
import { aiUsageToday, loadAiConfig, loadSettings } from '@/lib/leads/data';

export const metadata: Metadata = { title: 'Configurações comerciais' };

export default async function LeadSettingsPage() {
  const ctx = await requireContext(ADMIN_ROLES);
  const [settings, ai, used] = await Promise.all([loadSettings(ctx), loadAiConfig(ctx), aiUsageToday(ctx)]);
  return (
    <>
      <PageHeader title="Configurações comerciais" description="Fuso horário, distribuição, duplicidade, privacidade, retenção e IA opcional. Apenas administração." />
      <div className="space-y-4">
        <Card title="Operação e privacidade"><SettingsForm initial={settings} /></Card>
        <Card title="Retenção (LGPD)" description="Anonimiza leads antigos que não foram convertidos: remove nome, contatos, empresa, observações, respostas e análises de IA, mantendo apenas números agregados.">
          <RetentionButton days={settings.retention_days} />
        </Card>
        <Card title="Análise por IA (opcional)" description={`Usadas nas últimas 24 h: ${used} de ${ai.daily_limit}.`}>
          <AiConfigForm enabled={ai.enabled} dailyLimit={ai.daily_limit} ready={readAiEnv() !== null} />
        </Card>
      </div>
    </>
  );
}
