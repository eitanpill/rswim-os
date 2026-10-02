import { getTranslations } from 'next-intl/server';
import { listShiftChanges } from '@rswim/domain-scheduling';
import { listStaff } from '@rswim/domain-staff';
import { Card, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { ShiftChangeList } from './shift-change-list';

/** Every shift change: waiting answers first (escalated on top), then the recent history. */
export default async function ShiftsPage() {
  const t = await getTranslations('scheduling.shifts');
  const { changes, staff } = await withSession(async (tx) => {
    const [changes, staff] = await Promise.all([
      listShiftChanges(tx, { limit: 50 }),
      listStaff(tx),
    ]);
    return { changes, staff };
  });
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Card>
        {changes.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ShiftChangeList changes={changes} staff={staff} path="/admin/shifts" />
        )}
      </Card>
    </>
  );
}
