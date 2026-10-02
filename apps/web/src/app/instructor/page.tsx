import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { listShiftChanges, mySessions } from '@rswim/domain-scheduling';
import { listStaff } from '@rswim/domain-staff';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { TodayLine } from '@/components/today-card';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import { clockIL, staffNames } from '@/lib/scheduling';
import { answerShiftChangeAction } from './actions';

/** Instructor PWA "My day" (brief §6.8): changes waiting for my answer, and my lessons this week. */
export default async function InstructorDay({
  searchParams,
}: {
  searchParams: Promise<{ answered?: string }>;
}) {
  const { answered } = await searchParams;
  const t = await getTranslations('instructor.home');
  const ts = await getTranslations('scheduling.shifts');
  const tw = await getTranslations('common.weekday');
  const today = todayIL();
  const { changes, sessions, staff } = await withSession(async (tx) => {
    const [changes, sessions, staff] = await Promise.all([
      listShiftChanges(tx, { statuses: ['pending', 'escalated'], awaitingMe: true }),
      mySessions(tx, today, addDays(today, 6)),
      listStaff(tx),
    ]);
    return { changes, sessions, staff };
  });
  const name = staffNames(staff);

  return (
    <>
      <PageHeader title={t('title')} subtitle={<TodayLine />} />
      <div className="flex flex-col gap-4" data-testid="instructor-content">
        {answered ? (
          <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">
            {t('answered')}
          </p>
        ) : null}
        {changes.length ? (
          <Card data-testid="my-shift-changes">
            <CardTitle>{t('waiting')}</CardTitle>
            <ul className="flex flex-col gap-3">
              {changes.map((c) => (
                <li
                  key={c.id}
                  className="rounded-xl border border-warn p-3"
                  data-testid="my-shift-change"
                >
                  <p className="font-medium">
                    {c.kind === 'reassign_group'
                      ? t('askGroup', {
                          group: c.groupName ?? '',
                          day: tw(String(c.weekday ?? 0)),
                          time: c.groupStartsAt?.slice(0, 5) ?? '',
                          date: dmy(c.effectiveFrom),
                        })
                      : c.kind === 'reassign_session'
                        ? t('askSession', { group: c.groupName ?? '', date: dmy(c.sessionDate) })
                        : t('askReschedule', {
                            group: c.groupName ?? '',
                            date: dmy(c.sessionDate),
                            start: c.newStartsAt ? clockIL(c.newStartsAt) : '',
                            end: c.newEndsAt ? clockIL(c.newEndsAt) : '',
                          })}
                  </p>
                  {c.fromStaffId && c.kind !== 'reschedule_session' ? (
                    <p className="text-sm text-ink-muted">
                      {t('replacing', { name: name(c.fromStaffId) })}
                    </p>
                  ) : null}
                  {c.reason ? <p className="text-sm text-ink-muted">{c.reason}</p> : null}
                  <div className="mt-2 flex flex-col gap-2">
                    <ActionForm action={answerShiftChangeAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="accept" value="true" />
                      <div>
                        <SubmitButton>{t('accept')}</SubmitButton>
                      </div>
                    </ActionForm>
                    <details>
                      <summary className="min-h-tap cursor-pointer text-sm text-brand-700">
                        {t('decline')}
                      </summary>
                      <ActionForm action={answerShiftChangeAction} className="mt-2">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="accept" value="false" />
                        <Field name="note" label={ts('noteLabel')} />
                        <div>
                          <SubmitButton variant="secondary">{t('sendDecline')}</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card>
          <CardTitle>{t('week')}</CardTitle>
          {sessions.length === 0 ? (
            <EmptyState title={t('empty')}>{t('emptyHint')}</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
                >
                  <span className="font-medium">{s.groupName}</span>
                  <span className="text-sm text-ink-muted">
                    {dmy(s.date)} ·{' '}
                    <span dir="ltr">
                      {clockIL(s.startsAt)}–{clockIL(s.endsAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
