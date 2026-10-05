import { getTranslations } from 'next-intl/server';
import { BillingPeriod } from '@rswim/contracts';
import { runsBetween } from '@rswim/domain-transport';
import { Badge, Card, EmptyState, PageHeader } from '@rswim/ui';
import { explainer, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import { PeriodPicker } from '../../staff/ops-tabs';
import { TransportTabs } from '../tabs';

/**
 * How long the children were really in the water, run by run for a month (brief §6.10): answers "the driver was late,
 * how much time do they actually get in the water?" with the taps, not impressions.
 */
export default async function WaterReport({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const raw = BillingPeriod.safeParse((await searchParams).period);
  // This month by default: the report is read while the term runs.
  const period = raw.success ? raw.data : todayIL().slice(0, 7);
  const t = await getTranslations('transport.report');
  const explain = await explainer();
  const [y, m] = period.split('-').map(Number) as [number, number];
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const runs = (await withSession((tx) => runsBetween(tx, `${period}-01`, to))).filter(
    (v) => v.run.status !== 'cancelled',
  );
  const measured = runs.filter((v) => v.summary.inWaterMin !== null);
  const avg = measured.length
    ? Math.round(measured.reduce((s, v) => s + (v.summary.inWaterMin ?? 0), 0) / measured.length)
    : null;
  const short = measured.filter((v) => v.summary.short).length;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <TransportTabs active="report" />
      <PeriodPicker period={period} />
      <Card data-testid="water-report">
        <p className="mb-3 font-semibold">
          {periodLabel(period)} ·{' '}
          {avg === null ? t('noData') : t('totals', { runs: measured.length, avg, short })}
        </p>
        {runs.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="flex flex-col text-sm">
            {runs.map((v) => (
              <li
                key={v.run.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"
                data-testid="water-row"
              >
                <span>
                  {dmy(v.run.date)} · {v.route.name}
                  <span className="block text-xs text-ink-muted">
                    {explain(v.summary.explanation)}
                  </span>
                </span>
                {v.summary.short ? <Badge tone="warn">{t('short')}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
