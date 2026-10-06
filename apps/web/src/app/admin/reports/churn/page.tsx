import { getTranslations } from 'next-intl/server';
import { CHURN_BUCKETS, churn } from '@rswim/domain-reports';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';
import { RangeBar, rangeFrom, ReportTable, ReportTabs } from '../shared';

/** Churn (brief §6.14): places that ended per month, by the reason the family gave. */
export default async function ChurnReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const t = await getTranslations('reports');
  const te = await getTranslations('enums.churnReason');
  const range = rangeFrom(await searchParams);
  const data = await withSession((tx) => churn(tx, range));
  const reason = (r: string | null) => (r ? te(r) : t('churn.unknown'));
  const used = CHURN_BUCKETS.filter((b) => data.totals.byReason[b] > 0);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('churn.subtitle')} />
      <ReportTabs active="churn" />
      <RangeBar range={range} csv="churn" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('churn.byReason', { n: data.totals.total })}</CardTitle>
          {data.totals.total === 0 ? (
            <EmptyState title={t('churn.none')} />
          ) : (
            <ReportTable
              testId="churn-table"
              head={[
                t('month'),
                ...used.map((b) => (b === 'unknown' ? t('churn.unknown') : te(b))),
                t('total'),
              ]}
              rows={data.rows.map((r) => ({
                key: r.period,
                cells: [periodLabel(r.period), ...used.map((b) => r.byReason[b] || ''), r.total],
              }))}
              foot={[t('total'), ...used.map((b) => data.totals.byReason[b]), data.totals.total]}
            />
          )}
        </Card>
        {data.places.length ? (
          <Card>
            <CardTitle>{t('churn.places')}</CardTitle>
            <ReportTable
              testId="churn-places"
              head={[t('churn.child'), t('group'), t('churn.lastDay'), t('churn.reason')]}
              rows={data.places.map((p, i) => ({
                key: String(i),
                cells: [p.student, `${p.group} · ${p.venue}`, dmy(p.endedOn), reason(p.reason)],
              }))}
            />
          </Card>
        ) : null}
        <p className="text-xs text-ink-muted">{t('churn.note')}</p>
      </div>
    </>
  );
}
