import { getTranslations } from 'next-intl/server';
import { debtsDashboard } from '@rswim/domain-billing';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { money } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';

/** The accountant's read-only view: open debts with their age. */
export default async function Page() {
  const t = await getTranslations('accountant.home');
  const tm = await getTranslations('money.overview');
  const fmt = await money();
  const { rows, totals } = await withSession((tx) => debtsDashboard(tx));
  return (
    <>
      <PageHeader title={t('title')} />
      <Card>
        <CardTitle aside={<span className="font-semibold">{fmt(totals.balance)}</span>}>
          {t('debts')}
        </CardTitle>
        {rows.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="flex flex-col text-sm">
            {rows.map((r) => (
              <li
                key={r.householdId}
                className="flex flex-wrap justify-between gap-2 border-t border-line py-2"
              >
                <span>
                  {r.name}
                  {r.oldest ? (
                    <span className="text-ink-muted">
                      {' '}
                      · {tm('since', { date: dmy(r.oldest) })}
                    </span>
                  ) : null}
                </span>
                <span>{fmt(r.balance)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
