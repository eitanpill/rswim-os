import { getTranslations } from 'next-intl/server';
import { ADJUSTMENT_KINDS, PAY_ROUTINGS } from '@rswim/contracts';
import {
  getPayrollRunByPeriod,
  listAdjustments,
  sickBalances,
  type RunLine,
} from '@rswim/domain-payroll';
import { listStaff } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { explainer, money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import { daysOf, hoursOf, periodParam } from '@/lib/staffops';
import {
  addAdjustmentAction,
  approvePayrollAction,
  deleteAdjustmentAction,
  draftPayrollAction,
  recordSickDayAction,
} from '../ops-actions';
import { PeriodPicker, StaffOpsTabs } from '../ops-tabs';

/**
 * Monthly payroll (brief §6.8): draft the month from the lessons taught, review each instructor's payslip part and
 * transfer part, add bonuses and corrections, approve (which locks the month), and export for the accountant.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const period = periodParam((await searchParams).period);
  const t = await getTranslations('staffops.payroll');
  const label = await enumLabel();
  const fmt = await money();
  const explain = await explainer();
  const { run, adjustments, staff, sick } = await withSession(async (tx) => {
    const [run, adjustments, staff, sick] = await Promise.all([
      getPayrollRunByPeriod(tx, period),
      listAdjustments(tx, period),
      listStaff(tx),
      sickBalances(tx),
    ]);
    return { run, adjustments, staff, sick };
  });
  const active = staff.filter((s) => s.status === 'active');
  const staffOptions = active.map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }));
  const nameOf = (id: string) => staffOptions.find((o) => o.value === id)?.label ?? '';
  const approved = run?.run.status === 'approved';
  const lineText = (l: RunLine) =>
    l.kind === 'travel' ? t('travel') : l.description || label('payrollLineKind', l.kind);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <StaffOpsTabs active="payroll" period={period} />
      <PeriodPicker period={period} />
      <div className="flex flex-col gap-4">
        <Card data-testid="payroll-run">
          <CardTitle
            aside={
              run ? (
                <Badge tone={approved ? 'ok' : 'warn'}>
                  {label('payrollRunStatus', run.run.status)}
                </Badge>
              ) : null
            }
          >
            {periodLabel(period)}
          </CardTitle>
          {run ? (
            <>
              <p className="text-lg font-semibold" data-testid="payroll-totals">
                {t('totals', {
                  payslip: fmt(run.totals.payslip),
                  transfer: fmt(run.totals.transfer),
                })}
              </p>
              {approved && run.run.approvedAt ? (
                <p className="text-sm text-ink-muted">
                  {t('approvedAt', {
                    date: dmy(
                      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(
                        run.run.approvedAt,
                      ),
                    ),
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState title={t('noRun')} />
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!approved ? (
              <ActionForm action={draftPayrollAction} testId="draft-payroll">
                <input type="hidden" name="period" value={period} />
                <div>
                  <SubmitButton variant={run ? 'secondary' : 'primary'}>
                    {run ? t('redraft') : t('draft')}
                  </SubmitButton>
                </div>
              </ActionForm>
            ) : null}
            {run && !approved ? (
              <ActionButton
                action={approvePayrollAction}
                fields={{ id: run.run.id }}
                confirm={t('approveConfirm')}
                data-testid="approve-payroll"
              >
                {t('approve')}
              </ActionButton>
            ) : null}
            {run ? (
              <a
                href={`/api/payroll/${run.run.id}`}
                className="min-h-tap inline-flex items-center rounded-xl border border-line px-4 text-sm hover:border-brand-500"
                data-testid="payroll-export"
              >
                {t('export')}
              </a>
            ) : null}
          </div>
        </Card>

        {run?.staff.map((s) => (
          <Card key={s.id} data-testid="payroll-staff">
            <CardTitle aside={<Badge>{label('employmentType', s.employmentType)}</Badge>}>
              {s.name}
            </CardTitle>
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-line p-2">
                <dt className="text-xs text-ink-muted">{t('payslip')}</dt>
                <dd className="font-semibold" data-testid="staff-payslip">
                  {fmt(s.payslip)}
                </dd>
              </div>
              <div className="rounded-xl border border-line p-2">
                <dt className="text-xs text-ink-muted">{t('transfer')}</dt>
                <dd className="font-semibold" data-testid="staff-transfer">
                  {fmt(s.transfer)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-sm text-ink-muted">
              {t('lessons', { n: s.lessons, hours: hoursOf(s.minutes) })} ·{' '}
              {t('timesheet', { status: label('timesheetStatus', s.timesheet) })}
            </p>
            <p className="text-sm text-ink-muted">{explain(s.pension.explanation)}</p>
            {s.unpriced > 0 ? (
              <p className="mt-1 text-sm text-warn" role="note">
                {t('unpriced', { n: s.unpriced })}
              </p>
            ) : null}
            <details className="mt-2">
              <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
                {t('lines')}
              </summary>
              {s.lines.length === 0 ? (
                <EmptyState title={t('empty')} />
              ) : (
                <ul className="flex flex-col text-sm">
                  {s.lines.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-wrap justify-between gap-2 border-t border-line py-2"
                    >
                      <span>
                        {l.date ? <span className="text-ink-muted">{dmy(l.date)} · </span> : null}
                        {lineText(l)}
                        <span className="block text-xs text-ink-muted">
                          {explain(l.explanation)} · {label('payRouting', l.routing)}
                        </span>
                      </span>
                      <span>{fmt(l.amountAgorot)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </Card>
        ))}

        <Card data-testid="payroll-adjustments">
          <CardTitle>{t('adjustments')}</CardTitle>
          {adjustments.length ? (
            <ul className="mb-3 flex flex-col text-sm">
              {adjustments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"
                >
                  <span>
                    {nameOf(a.staffMemberId)} · {label('adjustmentKind', a.kind)} · {a.note}
                    <span className="block text-xs text-ink-muted">
                      {label('payRouting', a.routing)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {fmt(a.amountAgorot)}
                    {!approved ? (
                      <ActionButton
                        action={deleteAdjustmentAction}
                        fields={{ id: a.id }}
                        variant="ghost"
                      >
                        {t('remove')}
                      </ActionButton>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {!approved ? (
            <ActionForm action={addAdjustmentAction} resetOnSuccess testId="add-adjustment">
              <input type="hidden" name="period" value={period} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField name="staffMemberId" label={t('staff')} options={staffOptions} />
                <SelectField
                  name="kind"
                  label={t('kind')}
                  options={await enumOptions('adjustmentKind', ADJUSTMENT_KINDS)}
                />
                <SelectField
                  name="routing"
                  label={t('routing')}
                  options={await enumOptions('payRouting', PAY_ROUTINGS)}
                />
                <Field name="amount" label={t('amount')} inputMode="decimal" dir="ltr" />
              </div>
              <Field name="note" label={t('note')} />
              <div>
                <SubmitButton variant="secondary">{t('addAdjustment')}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </Card>

        <Card data-testid="sick-leave">
          <CardTitle>{t('sickTitle')}</CardTitle>
          <p className="mb-2 text-sm text-ink-muted">{t('sickHint')}</p>
          <ul className="mb-3 flex flex-col text-sm">
            {active
              .filter((s) => sick.has(s.id))
              .map((s) => (
                <li key={s.id} className="flex justify-between gap-2 border-t border-line py-2">
                  <span>{nameOf(s.id)}</span>
                  <span>{t('sickBalance', { days: daysOf(sick.get(s.id) ?? 0) })}</span>
                </li>
              ))}
          </ul>
          <details>
            <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
              {t('sickRecord')}
            </summary>
            <ActionForm action={recordSickDayAction} resetOnSuccess className="mt-2">
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField name="staffMemberId" label={t('staff')} options={staffOptions} />
                <Field name="date" type="date" label={t('date')} defaultValue={todayIL()} />
                <Field name="halfDays" type="number" label={t('halfDays')} defaultValue="2" />
              </div>
              <div>
                <SubmitButton variant="secondary">{t('sickRecord')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}
