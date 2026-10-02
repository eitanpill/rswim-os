import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cashNotHandedOver } from '@rswim/domain-billing';
import { listStaff } from '@rswim/domain-staff';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { money } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';
import { handOverAction } from '../actions';
import { MoneyTabs } from '../tabs';

/** Cash an instructor took at the pool and has not yet handed to the office. */
export default async function CashPage() {
  const t = await getTranslations('money.cash');
  const fmt = await money();
  const { cash, staff } = await withSession(async (tx) => ({
    cash: await cashNotHandedOver(tx),
    staff: await listStaff(tx),
  }));
  const staffName = new Map(staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
  return (
    <>
      <PageHeader title={t('title')} />
      <MoneyTabs active="cash" />
      <Card>
        <CardTitle>{t('title')}</CardTitle>
        {cash.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {cash.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
              >
                <span>
                  <Link
                    href={`/admin/families/${p.householdId}`}
                    className="font-medium text-brand-700 underline"
                  >
                    {fmt(p.amountAgorot)}
                  </Link>{' '}
                  <span className="text-sm text-ink-muted">
                    {dmy(p.paidOn)} ·{' '}
                    {t('receivedBy', { name: staffName.get(p.receivedByStaffId ?? '') ?? '' })}
                  </span>
                </span>
                <ActionButton action={handOverAction} fields={{ id: p.id }} variant="secondary">
                  {t('handOver')}
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
