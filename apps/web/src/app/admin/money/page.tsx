import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { debtsDashboard } from '@rswim/domain-billing';
import { Badge, Card, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { money } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { writeOffAction } from './actions';
import { MoneyTabs } from './tabs';

const BUCKETS = ['current', 'days31to60', 'days61to90', 'over90'] as const;

/** The debts dashboard (brief §6.7): who owes, how old the debt is, the mandate and the collection case. */
export default async function MoneyPage() {
  const t = await getTranslations('money.overview');
  const label = await enumLabel();
  const fmt = await money();
  const { rows, totals } = await withSession((tx) => debtsDashboard(tx));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <MoneyTabs active="overview" />
      <div className="flex flex-col gap-4">
        <Card data-testid="debt-totals">
          <p className="text-sm text-ink-muted">{t('total')}</p>
          <p className="text-3xl font-semibold">{fmt(totals.balance)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BUCKETS.map((b) => (
              <div key={b} className="rounded-xl border border-line p-2">
                <dt className="text-xs text-ink-muted">{t(b)}</dt>
                <dd className="font-medium">{fmt(totals[b])}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card data-testid="debts">
          {rows.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li
                  key={r.householdId}
                  className="rounded-xl border border-line p-3"
                  data-testid="debt-row"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/admin/families/${r.householdId}`}
                      className="font-medium text-brand-700 underline"
                    >
                      {r.name}
                    </Link>
                    <span className="font-semibold">{fmt(r.balance)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                    {r.oldest ? <span>{t('since', { date: dmy(r.oldest) })}</span> : null}
                    <Badge
                      tone={
                        r.mandate === 'active' ? 'ok' : r.mandate === 'failing' ? 'danger' : 'warn'
                      }
                    >
                      {t(`mandate.${r.mandate}`)}
                    </Badge>
                    {r.dunning ? (
                      <Badge tone={r.dunning.status === 'escalated' ? 'danger' : 'warn'}>
                        {t('case', {
                          status: label('dunningStatus', r.dunning.status),
                          retries: r.dunning.retriesDone,
                        })}
                      </Badge>
                    ) : null}
                  </div>
                  {r.dunning ? (
                    <details className="mt-2">
                      <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
                        {t('writeOff')}
                      </summary>
                      <ActionForm action={writeOffAction} className="mt-2">
                        <input type="hidden" name="id" value={r.dunning.caseId} />
                        <Field name="note" label={t('writeOffNote')} />
                        <div>
                          <SubmitButton variant="secondary">{t('writeOffSubmit')}</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
