import { getTranslations } from 'next-intl/server';
import { pendingFreezes, describePlaces } from '@rswim/domain-billing';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { decideFreezeAction } from '../actions';
import { MoneyTabs } from '../tabs';

/** Freezes waiting for the owner (when `billing.freeze_requires_approval` is on). */
export default async function FreezesPage() {
  const t = await getTranslations('money.freezes');
  const label = await enumLabel();
  const { freezes, places } = await withSession(async (tx) => {
    const freezes = await pendingFreezes(tx);
    return {
      freezes,
      places: await describePlaces(
        tx,
        freezes.map((f) => f.enrollmentId),
      ),
    };
  });
  const placeOf = new Map(places.map((p) => [p.enrollmentId, p]));
  return (
    <>
      <PageHeader title={t('title')} />
      <MoneyTabs active="freezes" />
      <Card>
        <CardTitle>{t('title')}</CardTitle>
        {freezes.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {freezes.map((f) => {
              const p = placeOf.get(f.enrollmentId);
              return (
                <li key={f.id} className="rounded-xl border border-line p-3">
                  <p className="font-medium">{p ? `${p.studentName} · ${p.groupName}` : ''}</p>
                  <p className="text-sm text-ink-muted">
                    {dmy(f.fromDate)}–{dmy(f.toDate)} · {label('freezeReason', f.reason)}
                    {f.note ? ` · ${f.note}` : ''}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <ActionButton
                      action={decideFreezeAction}
                      fields={{ id: f.id, decision: 'approved' }}
                    >
                      {t('approve')}
                    </ActionButton>
                    <ActionButton
                      action={decideFreezeAction}
                      fields={{ id: f.id, decision: 'rejected' }}
                      variant="ghost"
                    >
                      {t('reject')}
                    </ActionButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
