import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { CLOSURE_END_RULES, CLOSURE_SOURCES } from '@rswim/contracts';
import { endOfMonth, listClosureEvents } from '@rswim/domain-attendance';
import { listVenues } from '@rswim/domain-venues';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import { AttendanceTabs } from '../attendance/tabs';
import { createClosureAction } from './actions';

/**
 * Mass cancellations (brief §6.5): a pool closes for a few days, every lesson in the range is cancelled, each child
 * with a seat gets a credit, a makeup window opens, and the uptake report shows who has used theirs.
 */
export default async function ClosuresPage() {
  const t = await getTranslations('attendance.closures');
  const label = await enumLabel();
  const today = todayIL();
  const { events, venues } = await withSession(async (tx) => {
    const [events, venues] = await Promise.all([listClosureEvents(tx), listVenues(tx)]);
    return { events, venues };
  });
  const venueName = new Map(venues.map((v) => [v.id, v.name]));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AttendanceTabs active="closures" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('list')}</CardTitle>
          {events.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {events.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/admin/closures/${e.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 hover:border-brand-500"
                    data-testid="closure-row"
                  >
                    <span className="font-medium">
                      {e.venueId ? venueName.get(e.venueId) : t('allVenues')} · {e.reason}
                    </span>
                    <span className="flex items-center gap-2 text-sm text-ink-muted">
                      {dmy(e.startsOn)}–{dmy(e.endsOn)}
                      <Badge
                        tone={
                          e.status === 'open' ? 'warn' : e.status === 'closed' ? 'ok' : 'neutral'
                        }
                      >
                        {label('closureEventStatus', e.status)}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('new')}</CardTitle>
          <ActionForm action={createClosureAction} testId="closure-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="venueId"
                label={t('venue')}
                options={venues.map((v) => ({ value: v.id, label: v.name }))}
                includeEmpty={t('allVenues')}
              />
              <SelectField
                name="source"
                label={t('source')}
                options={await enumOptions('closureSource', CLOSURE_SOURCES)}
              />
              <Field name="startsOn" type="date" label={t('startsOn')} defaultValue={today} />
              <Field
                name="endsOn"
                type="date"
                label={t('endsOn')}
                defaultValue={addDays(today, 2)}
              />
              <Field name="reason" label={t('reason')} />
              <Field
                name="makeupFrom"
                type="date"
                label={t('makeupFrom')}
                hint={t('makeupFromHint')}
              />
              <Field
                name="makeupDeadline"
                type="date"
                label={t('makeupDeadline')}
                defaultValue={endOfMonth(today, 1)}
              />
              <SelectField
                name="endRule"
                label={t('endRule')}
                options={await enumOptions('closureEndRule', CLOSURE_END_RULES)}
                includeEmpty={t('endRuleDefault')}
              />
            </div>
            <div>
              <SubmitButton>{t('preview')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
