import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CERTIFICATION_TYPES, PAY_BASES, PAY_ROUTINGS } from '@rswim/contracts';
import { listPrograms } from '@rswim/domain-settings';
import { certificationStatus, getStaff } from '@rswim/domain-staff';
import { listVenues } from '@rswim/domain-venues';
import { agorot } from '@rswim/money';
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL, weekdayOptions } from '@/lib/options';
import {
  addAvailabilityAction,
  addCertificationAction,
  addExceptionAction,
  addPayRuleAction,
  deleteAvailabilityAction,
  deleteCertificationAction,
  deleteExceptionAction,
  updateStaffAction,
} from '../actions';
import { StaffForm } from '../staff-form';

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await withSession(async (tx, _ctx, session) => {
    const detail = await getStaff(tx, id);
    if (!detail) return null;
    const [venues, programs] = await Promise.all([listVenues(tx), listPrograms(tx)]);
    return {
      detail,
      venues,
      programs,
      canPay: session.role === 'owner' || session.permissions.includes('payroll.write'),
    };
  });
  if (!data) notFound();
  const { detail, venues, programs, canPay } = data;
  const { staff, certifications, availability, exceptions, payRules } = detail;
  const t = await getTranslations('staff');
  const tc = await getTranslations('common');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const today = todayIL();
  const venueName = (vid: string | null) =>
    vid ? (venues.find((v) => v.id === vid)?.name ?? '') : t('anyVenue');
  const programName = (pid: string | null) =>
    pid ? (programs.find((p) => p.id === pid)?.nameHe ?? '') : t('anyProgram');
  const venueOptions = venues.map((v) => ({ value: v.id, label: v.name }));

  return (
    <>
      <PageHeader
        title={`${staff.firstName} ${staff.lastName}`}
        subtitle={label('employmentType', staff.employmentType)}
      />
      <div className="flex flex-col gap-4">
        <Card>
          <details>
            <summary className="min-h-tap cursor-pointer text-lg font-semibold">
              {t('details')}
            </summary>
            <div className="mt-3">
              <StaffForm action={updateStaffAction.bind(null, staff.id)} staff={staff} />
            </div>
          </details>
        </Card>

        <Card>
          <CardTitle>{t('cert.title')}</CardTitle>
          {certifications.length === 0 ? <EmptyState title={t('cert.empty')} /> : null}
          <ul className="mb-3 flex flex-col gap-2">
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
                          ? t('cert.expires', { date: dmy(c.expiresOn) })
                          : t('cert.noExpiry'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={status === 'valid' ? 'ok' : status === 'expiring' ? 'warn' : 'danger'}
                    >
                      {t(`cert.status.${status}`)}
                    </Badge>
                    <ActionButton
                      action={deleteCertificationAction.bind(null, staff.id)}
                      fields={{ id: c.id }}
                      variant="ghost"
                    >
                      {tc('delete')}
                    </ActionButton>
                  </div>
                </li>
              );
            })}
          </ul>
          <details>
            <summary className="min-h-tap cursor-pointer text-brand-700">{t('cert.add')}</summary>
            <ActionForm
              action={addCertificationAction.bind(null, staff.id)}
              resetOnSuccess
              className="mt-2"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  name="type"
                  label={t('cert.type')}
                  options={await enumOptions('certificationType', CERTIFICATION_TYPES)}
                />
                <Field name="issuer" label={t('cert.issuer')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field name="issuedOn" label={t('cert.issuedOn')} type="date" />
                <Field name="expiresOn" label={t('cert.expiresOn')} type="date" />
              </div>
              <div>
                <SubmitButton>{t('cert.add')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>

        <Card>
          <CardTitle>{t('availability.title')}</CardTitle>
          {availability.length === 0 ? <EmptyState title={t('availability.empty')} /> : null}
          <ul className="mb-3 flex flex-col gap-2">
            {availability.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
              >
                <p>
                  <span className="font-medium">{tw(String(a.weekday))}</span>{' '}
                  <span dir="ltr">
                    {a.startsAt.slice(0, 5)}–{a.endsAt.slice(0, 5)}
                  </span>{' '}
                  · {venueName(a.venueId)}
                </p>
                <ActionButton
                  action={deleteAvailabilityAction.bind(null, staff.id)}
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
              {t('availability.add')}
            </summary>
            <ActionForm
              action={addAvailabilityAction.bind(null, staff.id)}
              resetOnSuccess
              className="mt-2"
            >
              <div className="grid grid-cols-3 gap-3">
                <SelectField
                  name="weekday"
                  label={t('availability.weekday')}
                  options={await weekdayOptions()}
                />
                <Field
                  name="startsAt"
                  label={t('availability.startsAt')}
                  type="time"
                  defaultValue="15:00"
                />
                <Field
                  name="endsAt"
                  label={t('availability.endsAt')}
                  type="time"
                  defaultValue="20:00"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField
                  name="venueId"
                  label={t('availability.venue')}
                  includeEmpty={t('anyVenue')}
                  options={venueOptions}
                />
                <Field
                  name="effectiveFrom"
                  label={t('availability.from')}
                  type="date"
                  defaultValue={today}
                />
                <Field name="effectiveTo" label={t('availability.to')} type="date" />
              </div>
              <div>
                <SubmitButton>{t('availability.add')}</SubmitButton>
              </div>
            </ActionForm>
          </details>

          <h3 className="mb-2 mt-4 font-semibold">{t('exception.title')}</h3>
          <ul className="mb-3 flex flex-col gap-2">
            {exceptions.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
              >
                <p>
                  {label('availabilityKind', e.kind)} ·{' '}
                  {e.startsOn === e.endsOn
                    ? dmy(e.startsOn)
                    : `${dmy(e.startsOn)} – ${dmy(e.endsOn)}`}
                  {e.reason ? ` · ${e.reason}` : ''}
                </p>
                <ActionButton
                  action={deleteExceptionAction.bind(null, staff.id)}
                  fields={{ id: e.id }}
                  variant="ghost"
                >
                  {tc('delete')}
                </ActionButton>
              </li>
            ))}
          </ul>
          <details>
            <summary className="min-h-tap cursor-pointer text-brand-700">
              {t('exception.add')}
            </summary>
            <ActionForm
              action={addExceptionAction.bind(null, staff.id)}
              resetOnSuccess
              className="mt-2"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField
                  name="kind"
                  label={t('exception.kind')}
                  options={await enumOptions('availabilityKind', ['unavailable', 'available'])}
                />
                <Field name="startsOn" label={t('exception.startsOn')} type="date" />
                <Field name="endsOn" label={t('exception.endsOn')} type="date" />
              </div>
              <Field name="reason" label={t('exception.reason')} />
              <div>
                <SubmitButton>{t('exception.add')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>

        {canPay || payRules.length ? (
          <Card>
            <CardTitle>{t('pay.title')}</CardTitle>
            {payRules.length === 0 ? <EmptyState title={t('pay.empty')} /> : null}
            <ul className="mb-3 flex flex-col gap-2">
              {payRules.map((r) => (
                <li key={r.id} className="rounded-xl border border-line p-3">
                  <p className="font-medium">
                    <Money agorot={agorot(r.amountAgorot)} /> {label('payBasis', r.basis)} ·{' '}
                    {label('payRouting', r.routing)}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {programName(r.programId)} · {venueName(r.venueId)} ·{' '}
                    {r.effectiveTo
                      ? t('pay.between', { from: dmy(r.effectiveFrom), to: dmy(r.effectiveTo) })
                      : t('pay.from', { from: dmy(r.effectiveFrom) })}
                    {r.travelAllowanceAgorot ? (
                      <>
                        {' · '}
                        {t('pay.travel')} <Money agorot={agorot(r.travelAllowanceAgorot)} />
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
            {canPay ? (
              <details>
                <summary className="min-h-tap cursor-pointer text-brand-700">
                  {t('pay.add')}
                </summary>
                <p className="my-2 text-sm text-ink-muted">{t('pay.hint')}</p>
                <ActionForm
                  action={addPayRuleAction.bind(null, staff.id)}
                  resetOnSuccess
                  className="mt-2"
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field name="amountAgorot" label={t('pay.amount')} inputMode="decimal" />
                    <SelectField
                      name="basis"
                      label={t('pay.basis')}
                      options={await enumOptions('payBasis', PAY_BASES)}
                    />
                    <SelectField
                      name="routing"
                      label={t('pay.routing')}
                      options={await enumOptions('payRouting', PAY_ROUTINGS)}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      name="programId"
                      label={t('pay.program')}
                      includeEmpty={t('anyProgram')}
                      options={programs.map((p) => ({ value: p.id, label: p.nameHe }))}
                    />
                    <SelectField
                      name="venueId"
                      label={t('pay.venue')}
                      includeEmpty={t('anyVenue')}
                      options={venueOptions}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      name="travelAllowanceAgorot"
                      label={t('pay.travelAmount')}
                      inputMode="decimal"
                    />
                    <Field
                      name="effectiveFrom"
                      label={t('pay.effectiveFrom')}
                      type="date"
                      defaultValue={today}
                    />
                  </div>
                  <Field name="notes" label={t('pay.notes')} />
                  <div>
                    <SubmitButton>{t('pay.add')}</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
