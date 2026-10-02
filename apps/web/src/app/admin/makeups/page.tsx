import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { bookingsOfCredits, endOfMonth, listCredits } from '@rswim/domain-attendance';
import { searchStudents, studentsByIds } from '@rswim/domain-people';
import { listPrograms } from '@rswim/domain-settings';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { sessionWhen } from '@/lib/attendance';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, todayIL } from '@/lib/options';
import { AttendanceTabs } from '../attendance/tabs';
import { cancelMakeupAction, goodwillCreditAction, voidCreditAction } from './actions';

/** Every live makeup credit: who holds it, until when, where it is booked; plus a goodwill credit. */
export default async function MakeupsPage({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string }>;
}) {
  const { booked } = await searchParams;
  const t = await getTranslations('attendance.makeups');
  const label = await enumLabel();
  const data = await withSession(async (tx) => {
    const credits = await listCredits(tx, { statuses: ['open', 'booked'] });
    const [people, bookings, students, programs] = await Promise.all([
      studentsByIds(tx, [...new Set(credits.map((c) => c.studentId))]),
      bookingsOfCredits(
        tx,
        credits.map((c) => c.id),
      ),
      searchStudents(tx, '', 500),
      listPrograms(tx),
    ]);
    return { credits, people, bookings, students, programs };
  });
  const person = new Map(data.people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  const program = new Map(data.programs.map((p) => [p.id, p.nameHe]));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AttendanceTabs active="makeups" />
      <div className="flex flex-col gap-4">
        {booked ? (
          <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">
            {t('booked')}
          </p>
        ) : null}
        <Card data-testid="credits">
          <CardTitle>{t('live', { n: data.credits.length })}</CardTitle>
          {data.credits.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.credits.map((c) => {
                const booking = data.bookings.find(
                  (b) => b.creditId === c.id && b.status === 'booked',
                );
                return (
                  <li
                    key={c.id}
                    className="rounded-xl border border-line p-3"
                    data-testid="credit-row"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {person.get(c.studentId) ?? ''}{' '}
                        <span className="text-sm text-ink-muted">
                          {program.get(c.programId) ?? ''} · {label('creditReason', c.reason)}
                          {c.sourceDate ? ` ${dmy(c.sourceDate)}` : ''}
                        </span>
                      </p>
                      <Badge tone={c.status === 'booked' ? 'ok' : 'warn'}>
                        {label('creditStatus', c.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-ink-muted">
                      {c.validFrom
                        ? t('window', { from: dmy(c.validFrom), until: dmy(c.expiresOn) })
                        : t('until', { until: dmy(c.expiresOn) })}
                    </p>
                    {booking?.date && booking.startsAt ? (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm">
                          {t('bookedInto', {
                            group: booking.groupName ?? '',
                            when: sessionWhen({ date: booking.date, startsAt: booking.startsAt }),
                          })}
                        </p>
                        <ActionButton
                          action={cancelMakeupAction}
                          fields={{ id: booking.id }}
                          variant="ghost"
                        >
                          {t('cancelBooking')}
                        </ActionButton>
                      </div>
                    ) : null}
                    {c.status === 'open' ? (
                      <div className="mt-2 flex flex-wrap items-start gap-3">
                        <Link
                          href={`/admin/makeups/${c.id}`}
                          className="min-h-tap py-3 font-medium text-brand-700 underline"
                        >
                          {t('findLesson')}
                        </Link>
                        <details>
                          <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
                            {t('void')}
                          </summary>
                          <ActionForm action={voidCreditAction} className="mt-2">
                            <input type="hidden" name="id" value={c.id} />
                            <Field name="note" label={t('voidNote')} />
                            <div>
                              <SubmitButton variant="secondary">{t('voidSubmit')}</SubmitButton>
                            </div>
                          </ActionForm>
                        </details>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('goodwill')}</CardTitle>
          <p className="mb-2 text-sm text-ink-muted">{t('goodwillHint')}</p>
          <ActionForm action={goodwillCreditAction} resetOnSuccess testId="goodwill-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="studentId"
                label={t('student')}
                options={data.students.map((s) => ({
                  value: s.id,
                  label: `${s.firstName} ${s.lastName}`,
                }))}
              />
              <SelectField
                name="programId"
                label={t('program')}
                options={data.programs.map((p) => ({ value: p.id, label: p.nameHe }))}
              />
              <Field
                name="expiresOn"
                type="date"
                label={t('expiresOn')}
                defaultValue={endOfMonth(todayIL())}
              />
              <Field name="note" label={t('reason')} />
            </div>
            <div>
              <SubmitButton>{t('issue')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
