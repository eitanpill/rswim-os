import { getTranslations } from 'next-intl/server';
import { PAY_ROUTINGS } from '@rswim/contracts';
import { listTimesheets } from '@rswim/domain-payroll';
import { Badge, Card, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel, enumOptions } from '@/lib/options';
import { hoursOf, periodParam } from '@/lib/staffops';
import { resolveTimesheetAction } from '../ops-actions';
import { PeriodPicker, StaffOpsTabs } from '../ops-tabs';

const TONE = { open: 'neutral', confirmed: 'ok', disputed: 'danger', resolved: 'ok' } as const;

/** Each instructor's month as the lessons show it, their confirmation, and the disputes waiting to be closed. */
export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const period = periodParam((await searchParams).period);
  const t = await getTranslations('staffops.timesheets');
  const tp = await getTranslations('staffops.payroll');
  const label = await enumLabel();
  const rows = await withSession((tx) => listTimesheets(tx, period));
  const routing = await enumOptions('payRouting', PAY_ROUTINGS);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <StaffOpsTabs active="timesheets" period={period} />
      <PeriodPicker period={period} />
      <Card data-testid="timesheets">
        {rows.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const status = r.timesheet?.status ?? 'open';
              return (
                <li
                  key={r.staffId}
                  className="rounded-xl border border-line p-3"
                  data-testid="timesheet-row"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge tone={TONE[status as keyof typeof TONE] ?? 'neutral'}>
                      {label('timesheetStatus', status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {t('line', { n: r.lessons, hours: hoursOf(r.minutes) })}
                  </p>
                  {r.timesheet?.disputeNote ? (
                    <p className="mt-1 text-sm">
                      {t('dispute', { note: r.timesheet.disputeNote })}
                    </p>
                  ) : null}
                  {r.timesheet?.resolution ? (
                    <p className="mt-1 text-sm text-ink-muted">
                      {t('resolution')}: {r.timesheet.resolution}
                    </p>
                  ) : null}
                  {status === 'disputed' && r.timesheet ? (
                    <ActionForm action={resolveTimesheetAction} className="mt-2">
                      <input type="hidden" name="id" value={r.timesheet.id} />
                      <Field name="resolution" label={t('resolution')} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          name="amount"
                          label={t('correction')}
                          inputMode="decimal"
                          dir="ltr"
                        />
                        <SelectField name="routing" label={tp('routing')} options={routing} />
                      </div>
                      <div>
                        <SubmitButton variant="secondary">{t('resolve')}</SubmitButton>
                      </div>
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
