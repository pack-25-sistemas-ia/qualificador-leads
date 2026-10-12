'use client';

import dynamic from 'next/dynamic';

// Gráficos só no navegador: a biblioteca gera estilos em linha, que a CSP estrita bloquearia no HTML do servidor.
// Cada gráfico traz uma tabela alternativa acessível, e este esqueleto aparece enquanto carrega.
// (O Next exige que as opções do `dynamic` sejam um objeto literal, por isso se repetem.)
function Skeleton() {
  return (
    <div role="status" className="h-[330px] animate-pulse rounded-lg bg-black/10 dark:bg-white/10">
      <span className="sr-only">Carregando gráfico…</span>
    </div>
  );
}

export const CapturedChartClient = dynamic(() => import('./charts').then((m) => m.CapturedChart), { ssr: false, loading: Skeleton });
export const QualificationRateChartClient = dynamic(() => import('./charts').then((m) => m.QualificationRateChart), { ssr: false, loading: Skeleton });
export const ScoreChartClient = dynamic(() => import('./charts').then((m) => m.ScoreChart), { ssr: false, loading: Skeleton });
export const ClassChartClient = dynamic(() => import('./charts').then((m) => m.ClassChart), { ssr: false, loading: Skeleton });
export const SourceChartClient = dynamic(() => import('./charts').then((m) => m.SourceChart), { ssr: false, loading: Skeleton });
export const CampaignChartClient = dynamic(() => import('./charts').then((m) => m.CampaignChart), { ssr: false, loading: Skeleton });
export const FunnelChartClient = dynamic(() => import('./charts').then((m) => m.FunnelChart), { ssr: false, loading: Skeleton });
export const SellerChartClient = dynamic(() => import('./charts').then((m) => m.SellerChart), { ssr: false, loading: Skeleton });
export const ContactChartClient = dynamic(() => import('./charts').then((m) => m.ContactChart), { ssr: false, loading: Skeleton });
