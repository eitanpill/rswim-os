import { getTranslations } from 'next-intl/server';
import { instructorKpis } from '@rswim/domain-reports';
import { Card, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { pct, RangeBar, rangeFrom, ReportTable, ReportTabs } from '../shared';

/** Instructor KPIs (brief §6.14): lessons taught, lessons a substitute took, children kept after three months. */
export default async function InstructorsReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const t = await getTranslations('reports');
  const range = rangeFrom(await searchParams);
  const rows = await withSession((tx) => instructorKpis(tx, range));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('instructors.subtitle')} />
      <ReportTabs active="instructors" />
      <RangeBar range={range} csv="instructors" />
      <Card>
        <ReportTable
          testId="instructor-kpis"
          head={[
            t('instructors.name'),
            t('instructors.taught'),
            t('instructors.substituted'),
            t('instructors.covered'),
            t('instructors.retention'),
          ]}
          rows={rows.map((r) => ({
            key: r.staffId,
            cells: [
              r.name,
              r.taught,
              r.substituted,
              r.coveredForOthers,
              r.retention.pct === null
                ? '—'
                : t('instructors.kept', {
                    pct: pct(r.retention.pct),
                    kept: r.retention.kept,
                    of: r.retention.eligible,
                  }),
            ],
          }))}
        />
        <p className="mt-2 text-xs text-ink-muted">{t('instructors.note')}</p>
      </Card>
    </>
  );
}
