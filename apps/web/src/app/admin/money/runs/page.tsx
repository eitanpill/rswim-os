import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listRuns, periodOf, shiftPeriod, type RunTotals } from '@rswim/domain-billing';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { enumLabel, todayIL } from '@/lib/options';
import { draftRunAction } from '../actions';
import { MoneyTabs } from '../tabs';

/** Monthly runs: draft a month, open a draft to review it, see what was approved. */
export default async function RunsPage() {
  const t = await getTranslations('money.runs');
  const label = await enumLabel();
  const fmt = await money();
  const runs = await withSession((tx) => listRuns(tx));
  const next = shiftPeriod(periodOf(todayIL()), 1);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <MoneyTabs active="runs" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('draft')}</CardTitle>
          <ActionForm action={draftRunAction} testId="draft-run">
            <Field name="period" label={t('period')} defaultValue={next} dir="ltr" />
            <div>
              <SubmitButton>{t('draftSubmit')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card data-testid="runs">
          {runs.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {runs.map((r) => {
                const totals = r.totals as RunTotals;
                const flags = Object.values(totals.anomalies ?? {}).reduce((s, n) => s + n, 0);
                return (
                  <li key={r.id}>
                    <Link
                      href={`/admin/money/runs/${r.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 hover:border-brand-500"
                    >
                      <span className="font-medium">{periodLabel(r.period)}</span>
                      <span className="text-sm text-ink-muted">
                        {t('families', { n: totals.households })} · {fmt(totals.totalAgorot)}
                      </span>
                      <span className="flex gap-1">
                        {r.status === 'draft' && flags > 0 ? (
                          <Badge tone="warn">{t('flags', { n: flags })}</Badge>
                        ) : null}
                        <Badge
                          tone={
                            r.status === 'posted' ? 'ok' : r.status === 'draft' ? 'warn' : 'neutral'
                          }
                        >
                          {label('billingRunStatus', r.status)}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
