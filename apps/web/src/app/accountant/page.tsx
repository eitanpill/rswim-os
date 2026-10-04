import { getTranslations } from 'next-intl/server';
import { debtsDashboard } from '@rswim/domain-billing';
import { listPayrollRuns, type RunTotals } from '@rswim/domain-payroll';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';

/** The accountant's read-only view: open debts with their age, and approved payroll months to export. */
export default async function Page() {
  const t = await getTranslations('accountant.home');
  const tm = await getTranslations('money.overview');
  const fmt = await money();
  const { debts, runs } = await withSession(async (tx) => {
    const [debts, runs] = await Promise.all([debtsDashboard(tx), listPayrollRuns(tx)]);
    return { debts, runs: runs.filter((r) => r.status === 'approved') };
  });
  const { rows, totals } = debts;
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
      <Card className="mt-4" data-testid="accountant-payroll">
        <CardTitle>{t('payroll')}</CardTitle>
        {runs.length === 0 ? (
          <EmptyState title={t('payrollEmpty')} />
        ) : (
          <ul className="flex flex-col text-sm">
            {runs.map((r) => {
              const sums = r.totals as RunTotals;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"
                >
                  <span>
                    {t('payrollLine', {
                      period: periodLabel(r.period),
                      payslip: fmt(sums.payslip),
                      transfer: fmt(sums.transfer),
                    })}
                  </span>
                  <a
                    href={`/api/payroll/${r.id}`}
                    className="min-h-tap inline-flex items-center text-brand-700 underline"
                  >
                    {t('export')}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
