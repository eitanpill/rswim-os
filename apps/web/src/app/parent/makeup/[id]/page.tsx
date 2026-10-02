import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { makeupOffers } from '@rswim/domain-attendance';
import { DomainError } from '@rswim/domain-core';
import { Card, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';
import { clockIL } from '@/lib/scheduling';
import { parentBookMakeupAction } from '../../actions';

/** Lessons the child fits and that have a free seat; the family books one in a tap. */
export default async function ParentMakeup({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await withSession(async (tx) => {
    try {
      return await makeupOffers(tx, id);
    } catch (e) {
      if (e instanceof DomainError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const t = await getTranslations('parent.makeup');
  const offers = data.offers.filter((o) => o.decision.ok);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { until: dmy(data.credit.expiresOn) })}
      />
      <div className="flex flex-col gap-4">
        <Link href="/parent" className="text-brand-700">
          {t('back')}
        </Link>
        <Card>
          {offers.length === 0 ? (
            <EmptyState title={t('empty')}>{t('emptyHint')}</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {offers.map((o) => (
                <li
                  key={o.sessionId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
                  data-testid="parent-offer"
                >
                  <span>
                    <span className="font-medium">{o.groupName}</span>{' '}
                    <span className="text-sm text-ink-muted">
                      {o.venueName} · {dmy(o.date)} ·{' '}
                      <span dir="ltr">
                        {clockIL(o.startsAt)}–{clockIL(o.endsAt)}
                      </span>
                    </span>
                  </span>
                  <ActionButton
                    action={parentBookMakeupAction}
                    fields={{ creditId: data.credit.id, sessionId: o.sessionId }}
                  >
                    {t('book')}
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
