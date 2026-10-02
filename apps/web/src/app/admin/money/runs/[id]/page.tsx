import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getRun } from '@rswim/domain-billing';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { dateTimeIL } from '@/lib/attendance';
import { explainer, money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { discardRunAction, draftRunAction, postRunAction } from '../../actions';
import { MoneyTabs } from '../../tabs';

/**
 * The pre-run review (brief §6.7): every flag in Hebrew with its reason, each family's lines against last month,
 * and approve. Fixing the data and drafting again replaces the draft.
 */
export default async function RunReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await withSession((tx) => getRun(tx, id));
  if (!data) notFound();
  const { run, families, totals, anomalies } = data;
  const t = await getTranslations('money.review');
  const label = await enumLabel();
  const fmt = await money();
  const explain = await explainer();
  const draft = run.status === 'draft';
  const nameOf = new Map(families.map((f) => [f.householdId, f.name]));

  return (
    <>
      <PageHeader
        title={t('title', { period: periodLabel(run.period) })}
        subtitle={draft ? t('subtitle') : undefined}
      />
      <MoneyTabs active="runs" />
      <div className="flex flex-col gap-4">
        <Card>
          <p className="font-medium" data-testid="run-totals">
            {t('totals', {
              families: totals.households,
              total: fmt(totals.totalAgorot),
              previous: fmt(totals.previousTotalAgorot),
            })}
          </p>
          {run.status === 'posted' && run.postedAt ? (
            <p role="status" className="mt-2 text-sm text-ok">
              {t('posted', { at: dateTimeIL(run.postedAt) })}
            </p>
          ) : null}
          {run.status === 'discarded' ? (
            <p className="mt-2 text-sm text-ink-muted">{t('discarded')}</p>
          ) : null}
          {draft ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton action={postRunAction} fields={{ id: run.id }}>
                {t('approve')}
              </ActionButton>
              <ActionButton
                action={draftRunAction}
                fields={{ period: run.period }}
                variant="secondary"
              >
                {t('redraft')}
              </ActionButton>
              <ActionButton action={discardRunAction} fields={{ id: run.id }} variant="ghost">
                {t('discard')}
              </ActionButton>
            </div>
          ) : null}
        </Card>

        <Card data-testid="run-flags">
          <CardTitle>{t('flags', { n: anomalies.length })}</CardTitle>
          {anomalies.length === 0 ? (
            <p className="text-sm text-ok">{t('noFlags')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {anomalies.map((a, i) => (
                <li
                  key={`${a.householdId}-${a.kind}-${i}`}
                  className="rounded-xl border border-line p-3"
                  data-testid="flag-row"
                  data-kind={a.kind}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        a.kind === 'amount_changed' || a.kind === 'missing_mandate'
                          ? 'warn'
                          : 'danger'
                      }
                    >
                      {label('anomalyKind', a.kind)}
                    </Badge>
                    <Link
                      href={`/admin/families/${a.householdId}`}
                      className="font-medium text-brand-700 underline"
                    >
                      {nameOf.get(a.householdId) ?? ''}
                    </Link>
                  </div>
                  <p className="mt-1 text-sm">{explain(a.explanation)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {families.length === 0 ? (
          <Card>
            <EmptyState title={t('noFlags')} />
          </Card>
        ) : null}
        {families
          .filter((f) => f.lines.length > 0)
          .map((f) => (
            <Card key={f.householdId} data-testid="run-family">
              <CardTitle aside={<span className="font-semibold">{fmt(f.total)}</span>}>
                {f.name}
              </CardTitle>
              <p className="mb-2 text-xs text-ink-muted">
                {f.previousTotal === null
                  ? t('noPrevious')
                  : t('previous', { amount: fmt(f.previousTotal) })}
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {f.lines.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-1"
                  >
                    <span>
                      <span className="font-medium">
                        {[l.studentName, l.description].filter(Boolean).join(' · ')}
                      </span>{' '}
                      <span className="text-ink-muted">
                        {label('billingLineKind', l.kind)} · {periodLabel(l.period)} ·{' '}
                        {explain(l.explanation)}
                      </span>
                      {(l.sessionDates as string[]).length ? (
                        <span className="block text-xs text-ink-muted">
                          {t('dates', {
                            dates: (l.sessionDates as string[]).map(dmy).join(', '),
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className={l.amountAgorot < 0 ? 'text-ok' : undefined}>
                      {fmt(l.amountAgorot)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
      </div>
    </>
  );
}
