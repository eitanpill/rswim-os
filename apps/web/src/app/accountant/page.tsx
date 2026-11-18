import { getTranslations } from 'next-intl/server';
import { debtsDashboard } from '@rswim/domain-billing';
import { listPayrollRuns, type RunTotals } from '@rswim/domain-payroll';
import {
  Avatar,
  buttonVariants,
  Card,
  CardTitle,
  EmptyState,
  PageHeader,
  StatTile,
} from '@rswim/ui';
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
      <PageHeader icon="📊" title={t('title')} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="accountant-stats">
        <StatTile
          icon="🧾"
          tone={totals.balance > 0 ? 'warn' : 'ok'}
          label={t('debts')}
          value={fmt(totals.balance)}
        />
        <StatTile icon="👪" label={t('owing')} value={rows.length} />
        <StatTile
          icon="💼"
          label={t('payroll')}
          value={runs.length}
          className="col-span-2 md:col-span-1"
        />
      </div>
      <Card>
        <CardTitle icon="🧾" aside={<span className="font-semibold">{fmt(totals.balance)}</span>}>
          {t('debts')}
        </CardTitle>
        {rows.length === 0 ? (
          <EmptyState icon="🎉" title={t('empty')} />
        ) : (
          <ul className="flex flex-col text-sm">
            {rows.map((r) => (
              <li
                key={r.householdId}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"
              >
                <span className="flex items-center gap-3">
                  <Avatar name={r.name} size="sm" />
                  <span>
                    {r.name}
                    {r.oldest ? (
                      <span className="text-ink-muted">
                        {' '}
                        · {tm('since', { date: dmy(r.oldest) })}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="rounded-full bg-warn/15 px-2 py-0.5 font-semibold tabular-nums">
                  {fmt(r.balance)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="mt-4" data-testid="accountant-payroll">
        <CardTitle icon="💼">{t('payroll')}</CardTitle>
        {runs.length === 0 ? (
          <EmptyState icon="📭" title={t('payrollEmpty')} />
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
                    className={buttonVariants({ variant: 'soft', size: 'sm' })}
                  >
                    ⬇️ {t('export')}
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
