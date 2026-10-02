import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { makeupOffers } from '@rswim/domain-attendance';
import { DomainError } from '@rswim/domain-core';
import { studentsByIds } from '@rswim/domain-people';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';
import { clockIL, issueText } from '@/lib/scheduling';
import { bookMakeupAction } from '../actions';

/**
 * Where one credit can be spent. Clean fits book in one tap; a lesson that breaks a soft rule (age band, level) shows
 * why, and books only with the office's note.
 */
export default async function MakeupOffersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await withSession(async (tx) => {
    try {
      const { credit, offers } = await makeupOffers(tx, id);
      const [student] = await studentsByIds(tx, [credit.studentId]);
      return { credit, offers, student };
    } catch (e) {
      if (e instanceof DomainError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { credit, offers, student } = data;
  const t = await getTranslations('attendance.offers');
  const why = await issueText();

  return (
    <>
      <PageHeader
        title={t('title', { name: student ? `${student.firstName} ${student.lastName}` : '' })}
        subtitle={t('subtitle', { until: dmy(credit.expiresOn) })}
      />
      <div className="flex flex-col gap-4">
        <Link href="/admin/makeups" className="text-brand-700">
          {t('back')}
        </Link>
        <Card>
          <CardTitle>{t('lessons', { n: offers.length })}</CardTitle>
          {offers.length === 0 ? (
            <EmptyState title={t('empty')}>{t('emptyHint')}</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {offers.map((o) => (
                <li
                  key={o.sessionId}
                  className="rounded-xl border border-line p-3"
                  data-testid="offer-row"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {o.groupName}{' '}
                      <span className="text-sm text-ink-muted">
                        {o.venueName} · {dmy(o.date)} ·{' '}
                        <span dir="ltr">
                          {clockIL(o.startsAt)}–{clockIL(o.endsAt)}
                        </span>
                      </span>
                    </p>
                    <span className="text-sm text-ink-muted">{t('seats', { n: o.freeSeats })}</span>
                  </div>
                  {o.fit.soft.length ? (
                    <ul className="mt-1 text-sm text-warn">
                      {o.fit.soft.map((s) => (
                        <li key={s.code} data-testid="offer-soft">
                          {why(s)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <ActionForm action={bookMakeupAction} className="mt-2">
                    <input type="hidden" name="creditId" value={credit.id} />
                    <input type="hidden" name="sessionId" value={o.sessionId} />
                    {o.decision.ok ? null : (
                      <Field
                        name="overrideNote"
                        label={t('overrideNote')}
                        hint={t('overrideHint')}
                      />
                    )}
                    <div>
                      <SubmitButton variant={o.decision.ok ? 'primary' : 'secondary'}>
                        {o.decision.ok ? t('book') : t('bookAnyway')}
                      </SubmitButton>
                    </div>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
