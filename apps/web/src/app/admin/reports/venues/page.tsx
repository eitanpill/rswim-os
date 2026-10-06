import { getTranslations } from 'next-intl/server';
import { venueProfitability } from '@rswim/domain-reports';
import { Badge, Card, EmptyState, PageHeader } from '@rswim/ui';
import { money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { pct, RangeBar, rangeFrom, ReportTable, ReportTabs } from '../shared';

/** Venue profitability (brief §6.2): revenue against rent and instructor pay, per venue and month. */
export default async function VenuesReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const t = await getTranslations('reports');
  const fmt = await money();
  const range = rangeFrom(await searchParams);
  const rows = await withSession((tx) => venueProfitability(tx, range));
  const venues = [...new Set(rows.map((r) => r.venue))];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('venues.subtitle')} />
      <ReportTabs active="venues" />
      <RangeBar range={range} csv="venues" />
      <div className="flex flex-col gap-4">
        {venues.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : null}
        {venues.map((v) => {
          const mine = rows.filter((r) => r.venue === v);
          const margin = mine.reduce((n, r) => n + r.margin, 0);
          return (
            <Card key={v} data-testid="venue-margin" data-venue={v}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{v}</h2>
                <Badge tone={margin < 0 ? 'danger' : 'ok'}>
                  {t('venues.margin', { amount: fmt(margin) })}
                </Badge>
              </div>
              <ReportTable
                head={[
                  t('month'),
                  t('venues.revenue'),
                  t('venues.rent'),
                  t('venues.staff'),
                  t('venues.marginCol'),
                  t('venues.utilization'),
                ]}
                rows={mine.map((r) => ({
                  key: r.period,
                  cells: [
                    periodLabel(r.period),
                    fmt(r.revenue),
                    r.rent === null ? t('venues.rentUnknown') : fmt(r.rent),
                    fmt(r.staffCost),
                    <span key="m" className={r.margin < 0 ? 'text-danger' : undefined}>
                      {fmt(r.margin)} ({pct(r.marginPct)})
                    </span>,
                    t('venues.seats', {
                      held: r.seatsHeld,
                      capacity: r.capacity,
                      pct: pct(r.utilizationPct),
                    }),
                  ],
                }))}
              />
            </Card>
          );
        })}
        <p className="text-xs text-ink-muted">{t('venues.note')}</p>
      </div>
    </>
  );
}
