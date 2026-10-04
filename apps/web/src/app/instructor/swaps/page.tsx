import { getTranslations } from 'next-intl/server';
import { myOffers } from '@rswim/domain-scheduling';
import { myStaffId } from '@rswim/domain-staff';
import { Badge, Card, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { answerOfferAction } from '../actions';

/** Lessons offered to me as a substitute (brief §6.8): the first instructor to take one gets it. */
export default async function SwapsPage({
  searchParams,
}: {
  searchParams: Promise<{ answered?: string }>;
}) {
  const { answered } = await searchParams;
  const t = await getTranslations('instructor.swaps');
  const label = await enumLabel();
  const offers = await withSession(async (tx) => {
    const staffId = await myStaffId(tx);
    return staffId ? myOffers(tx, staffId) : [];
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <div className="flex flex-col gap-4" data-testid="instructor-content">
        {answered === 'accepted' || answered === 'declined' ? (
          <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">
            {t(answered)}
          </p>
        ) : null}
        <Card data-testid="my-offers">
          {offers.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-3">
              {offers.map((o) => {
                const open = o.status === 'offered' && o.requestStatus === 'open';
                return (
                  <li
                    key={o.id}
                    className={`rounded-xl border p-3 ${open ? 'border-warn' : 'border-line'}`}
                    data-testid="my-offer"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {t('lesson', { group: o.lesson.groupName, venue: o.lesson.venueName })}
                      </span>
                      {!open ? (
                        <Badge tone={o.status === 'accepted' ? 'ok' : 'neutral'}>
                          {o.status === 'withdrawn' && o.requestStatus === 'filled'
                            ? t('taken')
                            : label('substituteOfferStatus', o.status)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-ink-muted">
                      {t('when', {
                        date: dmy(o.lesson.date),
                        from: o.lesson.startsAt,
                        to: o.lesson.endsAt,
                      })}
                    </p>
                    {open ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <ActionButton
                          action={answerOfferAction}
                          fields={{ offerId: o.id, accept: 'true' }}
                          data-testid="accept-offer"
                        >
                          {t('accept')}
                        </ActionButton>
                        <ActionButton
                          action={answerOfferAction}
                          fields={{ offerId: o.id, accept: 'false' }}
                          variant="secondary"
                        >
                          {t('decline')}
                        </ActionButton>
                      </div>
                    ) : null}
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
