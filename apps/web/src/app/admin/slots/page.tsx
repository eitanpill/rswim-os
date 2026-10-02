import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { SLOT_KINDS } from '@rswim/contracts';
import { searchStudents } from '@rswim/domain-people';
import { listSlots } from '@rswim/domain-scheduling';
import { listPrograms } from '@rswim/domain-settings';
import { listStaff } from '@rswim/domain-staff';
import { listVenues } from '@rswim/domain-venues';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import { clockIL, staffNames } from '@/lib/scheduling';
import { bookSlotAction, cancelBookingAction, cancelSlotAction, openSlotsAction } from './actions';

/** Private, pair, therapy and trial slots for the next four weeks: open, book, cancel. */
export default async function SlotsPage() {
  const t = await getTranslations('scheduling.slots');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  const today = todayIL();
  const data = await withSession(async (tx) => {
    const [slots, staff, venues, programs, students] = await Promise.all([
      listSlots(tx, { from: today, to: addDays(today, 28) }),
      listStaff(tx),
      listVenues(tx),
      listPrograms(tx),
      searchStudents(tx, '', 500),
    ]);
    return { slots, staff, venues, programs, students };
  });
  const name = staffNames(data.staff);
  const venueName = new Map(data.venues.map((v) => [v.id, v.name]));
  const studentOptions = data.students.map((s) => ({
    value: s.id,
    label: `${s.firstName} ${s.lastName}`,
  }));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <Card>
          {data.slots.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.slots.map((s) => (
                <li key={s.id} className="rounded-xl border border-line p-3" data-testid="slot-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {dmy(s.date)} ·{' '}
                      <span dir="ltr">
                        {clockIL(s.startsAt)}–{clockIL(s.endsAt)}
                      </span>{' '}
                      · {name(s.staffMemberId)}
                    </p>
                    <div className="flex gap-1">
                      <Badge>{label('slotKind', s.kind)}</Badge>
                      <Badge tone={s.status === 'open' ? 'ok' : 'warn'}>
                        {label('slotStatus', s.status)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {venueName.get(s.venueId)} ·{' '}
                    {t('seats', { n: s.bookings.length, capacity: s.capacity })}
                  </p>
                  {s.bookings.length ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {s.bookings.map((b) => (
                        <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                          <span>
                            {b.student ? `${b.student.firstName} ${b.student.lastName}` : '?'}
                          </span>
                          <ActionButton
                            action={cancelBookingAction}
                            fields={{ id: b.id }}
                            variant="ghost"
                          >
                            {t('cancelBooking')}
                          </ActionButton>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {s.status === 'open' ? (
                      <ActionForm action={bookSlotAction} className="flex-row flex-wrap items-end">
                        <input type="hidden" name="slotId" value={s.id} />
                        <SelectField
                          name="studentId"
                          label={t('student')}
                          options={studentOptions}
                        />
                        <div>
                          <SubmitButton variant="secondary">{t('book')}</SubmitButton>
                        </div>
                      </ActionForm>
                    ) : null}
                    <ActionButton
                      action={cancelSlotAction}
                      fields={{ id: s.id }}
                      variant="ghost"
                      confirm={t('confirmCancel')}
                    >
                      {t('cancelSlot')}
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('open')}</CardTitle>
          <ActionForm action={openSlotsAction} resetOnSuccess testId="slot-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="staffMemberId"
                label={t('instructor')}
                options={data.staff
                  .filter((s) => s.status === 'active')
                  .map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              />
              <SelectField
                name="venueId"
                label={t('venue')}
                options={data.venues.map((v) => ({ value: v.id, label: v.name }))}
              />
              <SelectField
                name="kind"
                label={t('kind')}
                options={await enumOptions('slotKind', SLOT_KINDS)}
              />
              <SelectField
                name="programId"
                label={t('program')}
                options={data.programs.map((p) => ({ value: p.id, label: p.nameHe }))}
                includeEmpty={t('noProgram')}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field name="date" label={t('date')} type="date" defaultValue={today} />
              <Field name="startsAt" label={t('startsAt')} type="time" defaultValue="17:00" />
              <Field name="endsAt" label={t('endsAt')} type="time" defaultValue="17:30" />
              <Field
                name="repeatWeeks"
                label={t('repeatWeeks')}
                type="number"
                inputMode="numeric"
                defaultValue="1"
              />
            </div>
            <Field
              name="capacity"
              label={t('capacity')}
              type="number"
              inputMode="numeric"
              hint={t('capacityHint')}
            />
            <Field name="notes" label={t('notes')} />
            <div>
              <SubmitButton>{t('open')}</SubmitButton>
            </div>
          </ActionForm>
          <p className="mt-2 text-xs text-ink-muted">
            {tc('comingSoon')}: {t('parentBookingLater')}
          </p>
        </Card>
      </div>
    </>
  );
}
