import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { certificationStatus, listInvites, listStaff } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  Field,
  ResultValue,
  SelectField,
  SubmitButton,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel, todayIL } from '@/lib/options';
import { createInviteAction, createStaffAction, revokeInviteAction } from './actions';
import { StaffForm } from './staff-form';

export default async function StaffPage() {
  const t = await getTranslations('staff');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  const today = todayIL();
  const { staff, invites, canInvite } = await withSession(async (tx, _ctx, session) => {
    const [staff, invites] = await Promise.all([
      listStaff(tx),
      session.role === 'owner' ? listInvites(tx) : [],
    ]);
    return { staff, invites, canInvite: session.role === 'owner' };
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <Card>
          {staff.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {staff.map((s) => {
                const alerts = s.certifications
                  .map((c) => ({ ...c, status: certificationStatus(c.expiresOn, today) }))
                  .filter((c) => c.status !== 'valid');
                return (
                  <li key={s.id}>
                    <Link
                      href={`/admin/staff/${s.id}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-line p-3 hover:border-brand-500"
                    >
                      <div>
                        <p className="font-medium">
                          {s.firstName} {s.lastName}
                        </p>
                        <p className="text-sm text-ink-muted">
                          {label('employmentType', s.employmentType)}
                          {s.skills.length
                            ? ` · ${s.skills.map((k) => label('staffSkill', k)).join(', ')}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {s.status !== 'active' ? (
                          <Badge tone="neutral">{label('staffStatus', s.status)}</Badge>
                        ) : null}
                        {alerts.map((c) => (
                          <Badge key={c.type} tone={c.status === 'expired' ? 'danger' : 'warn'}>
                            {t(`cert.${c.status}`, { type: label('certificationType', c.type) })}
                          </Badge>
                        ))}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <details>
            <summary className="min-h-tap cursor-pointer text-lg font-semibold">{t('new')}</summary>
            <div className="mt-3">
              <StaffForm action={createStaffAction} />
            </div>
          </details>
        </Card>

        {canInvite ? (
          <Card>
            <CardTitle>{t('invite.title')}</CardTitle>
            <p className="mb-3 text-sm text-ink-muted">{t('invite.hint')}</p>
            <ActionForm action={createInviteAction} testId="invite-form">
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  name="role"
                  label={t('invite.role')}
                  options={(['instructor', 'admin', 'escort', 'accountant'] as const).map((r) => ({
                    value: r,
                    label: tc(`role.${r}`),
                  }))}
                />
                <SelectField
                  name="staffMemberId"
                  label={t('invite.staff')}
                  includeEmpty={t('invite.noStaff')}
                  options={staff.map((s) => ({
                    value: s.id,
                    label: `${s.firstName} ${s.lastName}`,
                  }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field name="email" label={t('form.email')} type="email" dir="ltr" />
                <Field name="phoneE164" label={t('form.phone')} type="tel" dir="ltr" />
              </div>
              <ResultValue field="link" label={t('invite.link')} copy={t('invite.copy')} />
              <div>
                <SubmitButton>{t('invite.create')}</SubmitButton>
              </div>
            </ActionForm>
            {invites.length ? (
              <ul className="mt-4 flex flex-col gap-2">
                {invites.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
                  >
                    <div>
                      <p className="font-medium" dir="ltr">
                        {i.email ?? i.phoneE164}
                      </p>
                      <p className="text-sm text-ink-muted">
                        {tc(`role.${i.role}`)} ·{' '}
                        {i.acceptedAt
                          ? t('invite.accepted')
                          : i.expiresAt < new Date()
                            ? t('invite.expired')
                            : t('invite.pending')}
                      </p>
                    </div>
                    {!i.acceptedAt ? (
                      <ActionButton
                        action={revokeInviteAction}
                        fields={{ id: i.id }}
                        variant="ghost"
                      >
                        {t('invite.revoke')}
                      </ActionButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
