import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { TRIAL_OUTCOMES } from '@rswim/contracts';
import { listTrials } from '@rswim/domain-enrollment';
import { searchStudents } from '@rswim/domain-people';
import { listGroups, scheduledSessionsInRange } from '@rswim/domain-scheduling';
import { agorot } from '@rswim/money';
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { sessionWhen } from '@/lib/attendance';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import { hhmm } from '@/lib/scheduling';
import { AttendanceTabs } from '../attendance/tabs';
import {
  bookTrialAction,
  cancelTrialAction,
  convertTrialAction,
  trialVerdictAction,
} from './actions';

/** Lead → trial → seat (brief §6.2): book a trial lesson, record the verdict, convert within the offer window. */
export default async function TrialsPage() {
  const t = await getTranslations('enrollment.trials');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const today = todayIL();
  const data = await withSession(async (tx) => {
    const [trials, students, sessions, groups] = await Promise.all([
      listTrials(tx, { from: addDays(today, -30) }),
      searchStudents(tx, '', 500),
      scheduledSessionsInRange(tx, { venueId: null, from: today, to: addDays(today, 21) }),
      listGroups(tx),
    ]);
    return { trials, students, sessions, groups };
  });
  const groupOptions = data.groups.map((g) => ({
    value: g.id,
    label: `${g.name} · ${tw(String(g.weekday))} ${hhmm(g.startsAt)}`,
  }));
  const outcomes = await enumOptions('trialOutcome', TRIAL_OUTCOMES);
  const now = Date.now();

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AttendanceTabs active="trials" />
      <div className="flex flex-col gap-4">
        <Card data-testid="trials">
          <CardTitle>{t('list')}</CardTitle>
          {data.trials.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.trials.map((tr) => (
                <li
                  key={tr.id}
                  className="rounded-xl border border-line p-3"
                  data-testid="trial-row"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {tr.householdId ? (
                        <Link href={`/admin/families/${tr.householdId}`} className="underline">
                          {tr.studentName}
                        </Link>
                      ) : (
                        tr.studentName
                      )}{' '}
                      <span className="text-sm text-ink-muted">
                        {tr.groupName}
                        {tr.startsAt
                          ? ` · ${sessionWhen({ date: tr.date, startsAt: tr.startsAt })}`
                          : ''}
                      </span>
                    </p>
                    <span className="flex items-center gap-2">
                      {tr.feeAgorot !== null ? (
                        <span className="text-sm">
                          <Money agorot={agorot(tr.feeAgorot)} />
                        </span>
                      ) : null}
                      <Badge
                        tone={
                          tr.status === 'attended'
                            ? 'ok'
                            : tr.status === 'booked'
                              ? 'neutral'
                              : 'warn'
                        }
                      >
                        {label('trialStatus', tr.status)}
                        {tr.outcome ? ` · ${label('trialOutcome', tr.outcome)}` : ''}
                      </Badge>
                    </span>
                  </div>
                  {tr.verdictNote ? (
                    <p className="text-sm text-ink-muted">{tr.verdictNote}</p>
                  ) : null}
                  {tr.convertedEnrollmentId ? (
                    <p className="text-sm text-ok">{t('isConverted')}</p>
                  ) : null}

                  {tr.status === 'booked' ? (
                    <div className="mt-2 flex flex-col gap-2">
                      {tr.startsAt && tr.startsAt.getTime() <= now ? (
                        <ActionForm action={trialVerdictAction} testId="verdict-form">
                          <input type="hidden" name="id" value={tr.id} />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <SelectField
                              name="attended"
                              label={t('attended')}
                              options={[
                                { value: 'true', label: t('yes') },
                                { value: 'false', label: t('no') },
                              ]}
                            />
                            <SelectField
                              name="outcome"
                              label={t('outcome')}
                              options={outcomes}
                              includeEmpty=""
                            />
                            <SelectField
                              name="recommendedTemplateId"
                              label={t('recommendedGroup')}
                              options={groupOptions}
                              includeEmpty=""
                            />
                            <Field name="note" label={t('note')} />
                          </div>
                          <div>
                            <SubmitButton variant="secondary">{t('saveVerdict')}</SubmitButton>
                          </div>
                        </ActionForm>
                      ) : null}
                      <div>
                        <ActionButton
                          action={cancelTrialAction}
                          fields={{ id: tr.id }}
                          variant="ghost"
                          confirm={t('cancelConfirm')}
                        >
                          {t('cancel')}
                        </ActionButton>
                      </div>
                    </div>
                  ) : null}

                  {tr.status === 'attended' && !tr.convertedEnrollmentId ? (
                    <ActionForm action={convertTrialAction} className="mt-2" testId="convert-form">
                      <input type="hidden" name="id" value={tr.id} />
                      {tr.offerValidUntil ? (
                        <p className="text-sm text-ink-muted">
                          {t('offerUntil', { until: dmy(tr.offerValidUntil) })}
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <SelectField
                          name="templateId"
                          label={t('group')}
                          options={groupOptions}
                          defaultValue={tr.recommendedTemplateId ?? undefined}
                        />
                        <Field
                          name="startsOn"
                          type="date"
                          label={t('startsOn')}
                          defaultValue={today}
                        />
                      </div>
                      <div>
                        <SubmitButton>{t('convert')}</SubmitButton>
                      </div>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('book')}</CardTitle>
          <ActionForm action={bookTrialAction} resetOnSuccess testId="trial-form">
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
                name="sessionId"
                label={t('session')}
                options={data.sessions.map((s) => ({
                  value: s.id,
                  label: `${s.groupName} · ${sessionWhen(s)}`,
                }))}
              />
              <Field name="notes" label={t('note')} />
            </div>
            <div>
              <SubmitButton>{t('bookSubmit')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
