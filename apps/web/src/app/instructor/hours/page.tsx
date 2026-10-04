import { getTranslations } from 'next-intl/server';
import { myStatements, previousPeriod, sickBalances, staffMonth } from '@rswim/domain-payroll';
import { myStaffId } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { explainer, money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, todayIL } from '@/lib/options';
import { daysOf, hoursOf } from '@/lib/staffops';
import { answerTimesheetAction } from '../actions';

/**
 * Hours and pay (brief §6.8): the instructor sees the lessons the system counted for last month and this month,
 * confirms them or says what is wrong, and reads the breakdown of every approved month and their sick-leave balance.
 */
export default async function HoursPage() {
  const t = await getTranslations('instructor.hours');
  const tp = await getTranslations('staffops.payroll');
  const label = await enumLabel();
  const fmt = await money();
  const explain = await explainer();
  const current = todayIL().slice(0, 7);
  const data = await withSession(async (tx) => {
    const staffId = await myStaffId(tx);
    if (!staffId) return null;
    const [months, statements, sick] = await Promise.all([
      Promise.all([previousPeriod(current), current].map((p) => staffMonth(tx, p, staffId))),
      myStatements(tx, staffId),
      sickBalances(tx, [staffId]),
    ]);
    return { months, statements, sick: sick.get(staffId) ?? null };
  });

  if (!data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      </>
    );
  }
  const paid = new Set(data.statements.map((s) => s.period));

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex flex-col gap-4" data-testid="instructor-content">
        {data.months.map((m) => {
          const status = m.timesheet?.status ?? 'open';
          return (
            <Card key={m.period} data-testid="my-month">
              <CardTitle
                aside={
                  status !== 'open' ? (
                    <Badge tone={status === 'disputed' ? 'warn' : 'ok'}>
                      {label('timesheetStatus', status)}
                    </Badge>
                  ) : null
                }
              >
                {m.period === current ? t('month') : t('previous')} · {periodLabel(m.period)}
              </CardTitle>
              {m.lessons.length === 0 ? (
                <EmptyState title={t('empty')} />
              ) : (
                <>
                  <p className="font-medium">
                    {t('lessons', { n: m.lessons.length, hours: hoursOf(m.minutes) })}
                  </p>
                  <details>
                    <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
                      {tp('lines')}
                    </summary>
                    <ul className="flex flex-col text-sm">
                      {m.lessons.map((l) => (
                        <li
                          key={l.sessionId ?? l.slotId}
                          className="flex justify-between gap-2 border-t border-line py-1.5"
                        >
                          <span>
                            {dmy(l.date)} · {l.name} · {l.time}
                          </span>
                          <span className="text-ink-muted">{hoursOf(l.minutes)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
              {status === 'confirmed' ? <p className="text-sm text-ok">{t('confirmed')}</p> : null}
              {status === 'disputed' && m.timesheet?.disputeNote ? (
                <p className="text-sm">{t('disputed', { note: m.timesheet.disputeNote })}</p>
              ) : null}
              {status === 'resolved' && m.timesheet?.resolution ? (
                <p className="text-sm">{t('resolved', { resolution: m.timesheet.resolution })}</p>
              ) : null}
              {!paid.has(m.period) && status !== 'resolved' && m.lessons.length > 0 ? (
                <div className="mt-2 flex flex-col gap-2">
                  {status !== 'confirmed' ? (
                    <ActionForm action={answerTimesheetAction} testId="confirm-month">
                      <input type="hidden" name="period" value={m.period} />
                      <input type="hidden" name="confirm" value="true" />
                      <div>
                        <SubmitButton>{t('confirm')}</SubmitButton>
                      </div>
                    </ActionForm>
                  ) : null}
                  <details>
                    <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
                      {t('dispute')}
                    </summary>
                    <ActionForm action={answerTimesheetAction} testId="dispute-month">
                      <input type="hidden" name="period" value={m.period} />
                      <input type="hidden" name="confirm" value="false" />
                      <Field name="note" label={t('note')} />
                      <div>
                        <SubmitButton variant="secondary">{t('sendDispute')}</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                </div>
              ) : null}
            </Card>
          );
        })}

        <Card data-testid="my-statements">
          <CardTitle>{t('statements')}</CardTitle>
          {data.statements.length === 0 ? (
            <EmptyState title={t('noStatements')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.statements.map((s) => (
                <li key={s.period} className="rounded-xl border border-line p-3">
                  <p className="font-medium">{periodLabel(s.period)}</p>
                  <p className="text-sm">
                    {t('payslip')}: {fmt(s.payslip)} · {t('transfer')}: {fmt(s.transfer)}
                  </p>
                  <details>
                    <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
                      {tp('lines')}
                    </summary>
                    <ul className="flex flex-col text-sm">
                      {s.lines.map((l) => (
                        <li
                          key={l.id}
                          className="flex flex-wrap justify-between gap-2 border-t border-line py-1.5"
                        >
                          <span>
                            {l.date ? `${dmy(l.date)} · ` : ''}
                            {l.kind === 'travel'
                              ? t('travel')
                              : l.description || label('payrollLineKind', l.kind)}
                            <span className="block text-xs text-ink-muted">
                              {explain(l.explanation)} · {label('payRouting', l.routing)}
                            </span>
                          </span>
                          <span>{fmt(l.amountAgorot)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data.sick !== null ? (
          <Card>
            <CardTitle>{t('sick')}</CardTitle>
            <p>{t('sickBalance', { days: daysOf(data.sick) })}</p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
