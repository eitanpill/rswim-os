import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { mySessions } from '@rswim/domain-scheduling';
import { certificationStatus, getStaff, myStaffId } from '@rswim/domain-staff';
import { listVenues } from '@rswim/domain-venues';
import { agorot } from '@rswim/money';
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL, weekdayOptions } from '@/lib/options';
import { clockIL } from '@/lib/scheduling';
import {
  addMyAvailabilityAction,
  addMyExceptionAction,
  deleteMyAvailabilityAction,
  deleteMyExceptionAction,
} from '../actions';

/**
 * The instructor's own profile (brief §6.8): their details as the office keeps them, their certifications with
 * expiry warnings, the groups they teach, the hours they are free to teach (which they keep current themselves,
 * so the office plans substitutes and new groups from real availability), and the rates they are paid.
 */
export default async function InstructorProfile() {
  const t = await getTranslations('instructor.profile');
  const ts = await getTranslations('staff');
  const tc = await getTranslations('common');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const today = todayIL();
  const data = await withSession(async (tx) => {
    const staffId = await myStaffId(tx);
    if (!staffId) return null;
    const [detail, venues, upcoming] = await Promise.all([
      getStaff(tx, staffId),
      listVenues(tx),
      mySessions(tx, today, addDays(today, 13)),
    ]);
    return detail ? { detail, venues, upcoming } : null;
  });

  if (!data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState title={t('noStaff')} />
        </Card>
      </>
    );
  }

  const { detail, venues, upcoming } = data;
  const { staff, certifications, availability, exceptions, payRules } = detail;
  const venueName = (vid: string | null) =>
    vid ? (venues.find((v) => v.id === vid)?.name ?? '') : ts('anyVenue');
  const venueOptions = venues.map((v) => ({ value: v.id, label: v.name }));
  const certAlerts = certifications.filter(
    (c) => certificationStatus(c.expiresOn, today) !== 'valid',
  );

  // The regular groups: one row per group, weekday and start time over the next two weeks.
  const groups = new Map<
    string,
    { name: string; weekday: number; time: string; venueId: string | null }
  >();
  for (const s of upcoming) {
    if (s.status === 'cancelled') continue;
    const weekday = new Date(`${s.date}T12:00:00Z`).getUTCDay();
    const time = clockIL(s.startsAt);
    const key = `${s.classTemplateId}|${weekday}|${time}`;
    if (!groups.has(key)) groups.set(key, { name: s.groupName, weekday, time, venueId: s.venueId });
  }
  const regular = [...groups.values()].sort(
    (a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time),
  );
  const futureExceptions = exceptions.filter((e) => e.endsOn >= today);
  const currentPay = payRules.filter((r) => !r.effectiveTo || r.effectiveTo > today);

  return (
    <>
      <PageHeader
        title={`${staff.firstName} ${staff.lastName}`}
        subtitle={label('employmentType', staff.employmentType)}
      />
      <div className="flex flex-col gap-4" data-testid="instructor-content">
        {certAlerts.length ? (
          <div
            role="status"
            className="rounded-xl border border-warn bg-warn/10 px-3 py-2 text-sm"
            data-testid="cert-alert"
          >
            {certAlerts.map((c) => (
              <p key={c.id}>
                {ts(
                  certificationStatus(c.expiresOn, today) === 'expired'
                    ? 'cert.expired'
                    : 'cert.expiring',
                  { type: label('certificationType', c.type) },
                )}
                {c.expiresOn ? ` (${dmy(c.expiresOn)})` : ''}
              </p>
            ))}
            <p className="mt-1 text-ink-muted">{t('certRenew')}</p>
          </div>
        ) : null}

        <Card data-testid="my-details">
          <CardTitle>{t('details')}</CardTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">{ts('form.phone')}</dt>
            <dd dir="ltr" className="text-end sm:text-start">
              {staff.phoneE164 ?? '—'}
            </dd>
            <dt className="text-ink-muted">{ts('form.email')}</dt>
            <dd dir="ltr" className="text-end sm:text-start">
              {staff.email ?? '—'}
            </dd>
            <dt className="text-ink-muted">{ts('form.startDate')}</dt>
            <dd>{staff.startDate ? dmy(staff.startDate) : '—'}</dd>
          </dl>
          {staff.skills.length ? (
            <>
              <p className="mb-1 mt-3 text-sm text-ink-muted">{ts('form.skills')}</p>
              <div className="flex flex-wrap gap-1.5">
                {staff.skills.map((s) => (
                  <Badge key={s}>{label('staffSkill', s)}</Badge>
                ))}
              </div>
            </>
          ) : null}
          <p className="mt-3 text-xs text-ink-muted">{t('detailsHint')}</p>
        </Card>

        <Card data-testid="my-groups">
          <CardTitle>{t('groups')}</CardTitle>
          {regular.length === 0 ? (
            <EmptyState title={t('noGroups')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {regular.map((g) => (
                <li
                  key={`${g.name}-${g.weekday}-${g.time}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-sm text-ink-muted">
                    {tw(String(g.weekday))} <span dir="ltr">{g.time}</span> · {venueName(g.venueId)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card data-testid="my-certs">
          <CardTitle>{ts('cert.title')}</CardTitle>
          {certifications.length === 0 ? <EmptyState title={t('noCerts')} /> : null}
          <ul className="flex flex-col gap-2">
            {certifications.map((c) => {
              const status = certificationStatus(c.expiresOn, today);
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
                >
                  <div>
                    <p className="font-medium">{label('certificationType', c.type)}</p>
                    <p className="text-sm text-ink-muted">
                      {[
                        c.issuer,
                        c.expiresOn
                          ? ts('cert.expires', { date: dmy(c.expiresOn) })
                          : ts('cert.noExpiry'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Badge
                    tone={status === 'valid' ? 'ok' : status === 'expiring' ? 'warn' : 'danger'}
                  >
                    {ts(`cert.status.${status}`)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card data-testid="my-availability">
          <CardTitle>{t('availability')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('availabilityHint')}</p>
          {availability.length === 0 ? <EmptyState title={ts('availability.empty')} /> : null}
          <ul className="mb-3 flex flex-col gap-2">
            {availability.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
                data-testid="my-availability-row"
              >
                <p>
                  <span className="font-medium">{tw(String(a.weekday))}</span>{' '}
                  <span dir="ltr">
                    {a.startsAt.slice(0, 5)}–{a.endsAt.slice(0, 5)}
                  </span>{' '}
                  · {venueName(a.venueId)}
                  {a.effectiveTo ? ` · ${t('until', { date: dmy(a.effectiveTo) })}` : ''}
                </p>
                <ActionButton
                  action={deleteMyAvailabilityAction}
                  fields={{ id: a.id }}
                  variant="ghost"
                >
                  {tc('delete')}
                </ActionButton>
              </li>
            ))}
          </ul>
          <details>
            <summary className="min-h-tap cursor-pointer text-brand-700">
              {ts('availability.add')}
            </summary>
            <ActionForm action={addMyAvailabilityAction} resetOnSuccess className="mt-2">
              <div className="grid grid-cols-3 gap-3">
                <SelectField
                  name="weekday"
                  label={ts('availability.weekday')}
                  options={await weekdayOptions()}
                />
                <Field
                  name="startsAt"
                  label={ts('availability.startsAt')}
                  type="time"
                  defaultValue="15:00"
                />
                <Field
                  name="endsAt"
                  label={ts('availability.endsAt')}
                  type="time"
                  defaultValue="20:00"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField
                  name="venueId"
                  label={ts('availability.venue')}
                  includeEmpty={ts('anyVenue')}
                  options={venueOptions}
                />
                <Field
                  name="effectiveFrom"
                  label={ts('availability.from')}
                  type="date"
                  defaultValue={today}
                />
                <Field name="effectiveTo" label={ts('availability.to')} type="date" />
              </div>
              <div>
                <SubmitButton>{ts('availability.add')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>

        <Card data-testid="my-time-off">
          <CardTitle>{t('timeOff')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('timeOffHint')}</p>
          {futureExceptions.length === 0 ? <EmptyState title={t('noTimeOff')} /> : null}
          <ul className="mb-3 flex flex-col gap-2">
            {futureExceptions.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
                data-testid="my-time-off-row"
              >
                <p>
                  <Badge tone={e.kind === 'unavailable' ? 'warn' : 'ok'}>
                    {label('availabilityKind', e.kind)}
                  </Badge>{' '}
                  {e.startsOn === e.endsOn
                    ? dmy(e.startsOn)
                    : `${dmy(e.startsOn)} – ${dmy(e.endsOn)}`}
                  {e.reason ? ` · ${e.reason}` : ''}
                </p>
                <ActionButton
                  action={deleteMyExceptionAction}
                  fields={{ id: e.id }}
                  variant="ghost"
                >
                  {tc('delete')}
                </ActionButton>
              </li>
            ))}
          </ul>
          <details>
            <summary className="min-h-tap cursor-pointer text-brand-700">{t('addTimeOff')}</summary>
            <ActionForm action={addMyExceptionAction} resetOnSuccess className="mt-2">
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField
                  name="kind"
                  label={ts('exception.kind')}
                  options={await enumOptions('availabilityKind', ['unavailable', 'available'])}
                />
                <Field
                  name="startsOn"
                  label={ts('exception.startsOn')}
                  type="date"
                  defaultValue={today}
                />
                <Field
                  name="endsOn"
                  label={ts('exception.endsOn')}
                  type="date"
                  defaultValue={today}
                />
              </div>
              <Field name="reason" label={ts('exception.reason')} />
              <div>
                <SubmitButton>{t('addTimeOff')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>

        {currentPay.length ? (
          <Card data-testid="my-rates">
            <CardTitle>{t('rates')}</CardTitle>
            <ul className="flex flex-col gap-2">
              {currentPay.map((r) => (
                <li key={r.id} className="rounded-xl border border-line p-3">
                  <p className="font-medium">
                    <Money agorot={agorot(r.amountAgorot)} /> {label('payBasis', r.basis)} ·{' '}
                    {label('payRouting', r.routing)}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {venueName(r.venueId)} · {ts('pay.from', { from: dmy(r.effectiveFrom) })}
                    {r.travelAllowanceAgorot ? (
                      <>
                        {' · '}
                        {ts('pay.travel')} <Money agorot={agorot(r.travelAllowanceAgorot)} />
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-muted">{t('ratesHint')}</p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
