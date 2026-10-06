import { getTranslations } from 'next-intl/server';
import { chargedByVenueProgram, moneyByMonth } from '@rswim/domain-reports';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { RangeBar, rangeFrom, ReportTable, ReportTabs } from './shared';

/** Revenue (brief §6.14): charged and collected per month, and the charges per venue and program. */
export default async function RevenueReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const t = await getTranslations('reports');
  const fmt = await money();
  const range = rangeFrom(await searchParams);
  const { months, lines } = await withSession(async (tx) => ({
    months: await moneyByMonth(tx, range),
    lines: await chargedByVenueProgram(tx, range),
  }));
  const sum = (k: keyof (typeof months)[number]) =>
    months.reduce((n, m) => n + (m[k] as number), 0);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ReportTabs active="revenue" />
      <RangeBar range={range} csv="revenue" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('revenue.months')}</CardTitle>
          <ReportTable
            testId="revenue-months"
            head={[
              t('month'),
              t('revenue.charged'),
              t('revenue.collected'),
              t('revenue.institutions'),
              t('revenue.institutionsPaid'),
            ]}
            rows={months.map((m) => ({
              key: m.period,
              cells: [
                periodLabel(m.period),
                fmt(m.chargedAgorot),
                fmt(m.collectedAgorot),
                fmt(m.institutionInvoicedAgorot),
                fmt(m.institutionCollectedAgorot),
              ],
            }))}
            foot={[
              t('total'),
              fmt(sum('chargedAgorot')),
              fmt(sum('collectedAgorot')),
              fmt(sum('institutionInvoicedAgorot')),
              fmt(sum('institutionCollectedAgorot')),
            ]}
          />
        </Card>
        <Card>
          <CardTitle>{t('revenue.byVenue')}</CardTitle>
          {lines.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ReportTable
              testId="revenue-lines"
              head={[t('month'), t('venue'), t('program'), t('revenue.charged')]}
              rows={lines.map((l, i) => ({
                key: String(i),
                cells: [
                  periodLabel(l.period),
                  l.venue ?? t('noVenue'),
                  l.program ?? '—',
                  fmt(l.amountAgorot),
                ],
              }))}
            />
          )}
          <p className="mt-2 text-xs text-ink-muted">{t('revenue.note')}</p>
        </Card>
      </div>
    </>
  );
}
