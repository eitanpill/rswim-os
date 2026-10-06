import { getTranslations } from 'next-intl/server';
import { funnelReport, type FunnelRow } from '@rswim/domain-reports';
import { Card, CardTitle, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { pct, RangeBar, rangeFrom, ReportTable, ReportTabs } from '../shared';

/** Funnel (brief §6.14): new families → trial booked → trial held → enrolled, by source and branch. */
export default async function FunnelReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const t = await getTranslations('reports');
  const range = rangeFrom(await searchParams);
  const data = await withSession((tx) => funnelReport(tx, range));
  const head = [
    '',
    t('funnel.families'),
    t('funnel.trialBooked'),
    t('funnel.trialHeld'),
    t('funnel.enrolled'),
    t('funnel.conversion'),
    t('funnel.trialConversion'),
    t('funnel.medianDays'),
  ];
  const cells = (r: FunnelRow, label: string) => [
    label,
    r.families,
    r.trialBooked,
    r.trialHeld,
    r.enrolled,
    pct(r.conversionPct),
    pct(r.trialConversionPct),
    r.medianDaysToEnroll ?? '—',
  ];
  const source = (k: string) => (k === 'ghl' || k === 'office' ? t(`funnel.source.${k}`) : k);
  const branch = (k: string) => (k === 'none' ? t('funnel.noBranch') : k);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('funnel.subtitle')} />
      <ReportTabs active="funnel" />
      <RangeBar range={range} csv="funnel" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('funnel.bySource')}</CardTitle>
          <ReportTable
            testId="funnel-source"
            head={head}
            rows={data.bySource.rows.map((r) => ({ key: r.key, cells: cells(r, source(r.key)) }))}
            foot={cells(data.bySource.total, t('total'))}
          />
        </Card>
        <Card>
          <CardTitle>{t('funnel.byBranch')}</CardTitle>
          <ReportTable
            testId="funnel-branch"
            head={head}
            rows={data.byBranch.rows.map((r) => ({ key: r.key, cells: cells(r, branch(r.key)) }))}
          />
        </Card>
        <p className="text-xs text-ink-muted">{t('funnel.note')}</p>
      </div>
    </>
  );
}
