import type { Metadata } from 'next';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { ModelActions, RuleForm, RulesList, Simulator, SuggestedRules, ThresholdsForm } from '@/components/leads/rules-editor';
import { requireContext } from '@/lib/auth/session';
import { isManager } from '@/lib/leads/access';
import { loadModels, loadQuestions, loadSettings } from '@/lib/leads/data';
import { formatDay } from '@/lib/leads/format';

export const metadata: Metadata = { title: 'Qualificação' };

export default async function QualificationPage() {
  const ctx = await requireContext();
  const manager = isManager(ctx.membership.role);
  const [{ published, draft, rulesByModel }, { questions, forms }, settings] = await Promise.all([loadModels(ctx), loadQuestions(ctx), loadSettings(ctx)]);
  const publishedRules = published ? rulesByModel.get(published.id) ?? [] : [];
  const draftRules = draft ? rulesByModel.get(draft.id) ?? [] : [];

  return (
    <>
      <PageHeader title="Qualificação (score)" description="Pontuação de 0 a 100 por regras que você define, sem IA e sem caixa-preta: cada ponto aparece na justificativa do lead. O modelo publicado nunca muda; para alterar, crie um rascunho, simule e publique uma nova versão." />

      <div className="mb-4"><Alert tone="info">Equidade: não crie regras com raça, religião, saúde, orientação sexual, idade, gênero ou origem (nem substitutos delas, como CEP usado para inferir isso). O score apoia a priorização comercial; não é decisão automática sobre pessoas.</Alert></div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Modelo em uso">
          {published ? (
            <div className="space-y-2 text-sm">
              <p><strong>{published.name}</strong> · versão {published.version} <Badge tone="success">Publicado</Badge></p>
              <p className="text-muted">Publicado em {formatDay(published.published_at, settings.timezone)}.</p>
              <p>Morno a partir de <strong>{published.thresholds_json.warm_min}</strong> · Quente a partir de <strong>{published.thresholds_json.hot_min}</strong> · Qualificado a partir de <strong>{published.thresholds_json.qualified_min}</strong></p>
            </div>
          ) : <p className="text-sm text-muted">Nenhum modelo publicado. Enquanto isso, os leads entram sem score. {manager ? 'Crie o primeiro modelo ao lado.' : ''}</p>}
        </Card>
        {manager ? (
          <Card title="Ações">
            <ModelActions hasDraft={Boolean(draft)} canPublish draftId={draft?.id ?? null} hasPublished={Boolean(published)} />
            <p className="mt-3 text-xs text-muted">«Recalcular» acrescenta um novo evento de score a cada lead com o modelo vigente; o histórico anterior é preservado.</p>
          </Card>
        ) : null}
      </div>

      {published ? (
        <div className="mt-4"><Card title={`Regras do modelo publicado (v${published.version})`} description="Somente leitura.">
          <RulesList modelId={published.id} rules={publishedRules} questions={questions} editable={false} />
        </Card></div>
      ) : null}

      {manager && draft ? (
        <>
          <div className="mt-4"><Card title={`Rascunho (v${draft.version})`} description="Edite à vontade: nada muda para os leads até você publicar.">
            <div className="space-y-6">
              <div><h3 className="mb-2 text-sm font-semibold">Faixas</h3><ThresholdsForm modelId={draft.id} initial={draft.thresholds_json} /></div>
              <div><h3 className="mb-2 text-sm font-semibold">Regras</h3><RulesList modelId={draft.id} rules={draftRules} questions={questions} editable /></div>
              <div><h3 className="mb-2 text-sm font-semibold">Nova regra</h3>{questions.length ? <RuleForm modelId={draft.id} questions={questions} /> : <p className="text-sm text-muted">Crie um formulário primeiro: as regras usam as perguntas dele.</p>}</div>
              <div><SuggestedRules /></div>
            </div>
          </Card></div>
          <div className="mt-4"><Card title="Simulador" description="Teste o rascunho com um lead de exemplo antes de publicar. Nada é gravado.">
            <Simulator modelId={draft.id} forms={forms} />
          </Card></div>
        </>
      ) : null}
    </>
  );
}
