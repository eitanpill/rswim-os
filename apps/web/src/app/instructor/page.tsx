import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { listShiftChanges, mySessions } from '@rswim/domain-scheduling';
import { listStaff } from '@rswim/domain-staff';
import { buttonVariants, Card, CardTitle, EmptyState, Hero } from '@rswim/ui';
import Link from 'next/link';
import { TodayLine } from '@/components/today-card';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { greeting, whenFriendly } from '@/lib/greeting';
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
  const session = await requireSurface('instructor');
  const hello = await greeting(session.displayName);
  const todays = sessions.filter((s) => s.date === today);
  const next = sessions.find((s) => new Date(s.endsAt).getTime() > Date.now());

  return (
    <>
      <h1 className="sr-only">{t('title')}</h1>
      <div className="mb-4">
        <TodayLine />
      </div>
      <div className="flex flex-col gap-4" data-testid="instructor-content">
        <Hero
          eyebrow={`${hello} 👋`}
          emoji={todays.length ? '🏊‍♀️' : '☀️'}
          title={todays.length ? t('heroToday', { n: todays.length }) : t('heroFree')}
          actions={
            next ? (
              <Link
                href={`/instructor/session/${next.id}`}
                className={buttonVariants({ variant: 'onWater', size: 'sm' })}
              >
                {t('openNext')}
              </Link>
            ) : null
          }
        >
          {next ? (
            <p>
              {t('heroNext', { group: next.groupName })}{' '}
              <span className="font-semibold">{await whenFriendly(next)}</span>
            </p>
          ) : (
            <p>{t('heroNoNext')}</p>
          )}
        </Hero>
        {answered ? (
          <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">
            {t('answered')}
          </p>
        ) : null}
        {changes.length ? (
          <Card data-testid="my-shift-changes">
            <CardTitle icon="⏳">{t('waiting')}</CardTitle>
            <ul className="flex flex-col gap-3">
              {changes.map((c) => (
                <li
                  key={c.id}
                  className="rounded-2xl border border-warn/60 bg-warn/8 p-3"
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
          <CardTitle icon="📅">{t('week')}</CardTitle>
          {sessions.length === 0 ? (
            <EmptyState icon="🏖️" title={t('empty')}>
              {t('emptyHint')}
            </EmptyState>
          ) : (
            <ul className="stagger flex flex-col gap-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/instructor/session/${s.id}`}
                    className={`lift flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 hover:border-brand-500 ${s.date === today ? 'border-brand-500/60 bg-brand-50/60 dark:bg-surface' : 'border-line'}`}
                    data-testid="my-session"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {s.date === today ? (
                        <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">
                          {t('todayTag')}
                        </span>
                      ) : null}
                      {s.groupName}
                    </span>
                    <span className="text-sm text-ink-muted">
                      {dmy(s.date)} ·{' '}
                      <span dir="ltr">
                        {clockIL(s.startsAt)}–{clockIL(s.endsAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
