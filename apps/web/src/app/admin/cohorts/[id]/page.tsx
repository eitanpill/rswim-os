import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { COHORT_STATUSES } from '@rswim/contracts';
import { searchStudents } from '@rswim/domain-people';
import { getCohort, groupsForCohort } from '@rswim/domain-scheduling';
import { listPrograms } from '@rswim/domain-settings';
import { listStaff } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { explainer } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions } from '@/lib/options';
import {
  addCohortStaffAction,
  attachGroupAction,
  cancelRegistrationAction,
  cohortStatusAction,
  detachGroupAction,
  registerAction,
  removeCohortStaffAction,
  updateCohortAction,
} from '../actions';
import { CohortFields } from '../cohort-fields';

/** One course or camp week: its groups and staff, the ratio, the roster, and registration. */
export default async function CohortPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('cohorts');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const explain = await explainer();
  const data = await withSession(async (tx) => {
    const cohort = await getCohort(tx, id);
    if (!cohort) return null;
    return {
      cohort,
      free: await groupsForCohort(tx, cohort.programId),
      programs: await listPrograms(tx),
      staff: await listStaff(tx),
      students: await searchStudents(tx, '', 500),
    };
  });
  if (!data) notFound();
  const { cohort: c } = data;
  const registered = new Set(c.roster.map((r) => r.studentId));
  const statusOptions = await enumOptions('cohortStatus', COHORT_STATUSES);

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={t('line', {
          program: c.programName,
          from: dmy(c.startsOn),
          to: dmy(c.endsOn),
          registered: c.registered,
          capacity: c.capacity,
          groups: c.groupIds.length,
        })}
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle aside={<Badge tone="neutral">{label('cohortStatus', c.status)}</Badge>}>
            {t('detail.rules')}
          </CardTitle>
          <p className="text-sm">
            {c.ownPolicyFrom
              ? t('detail.ownPolicy', { from: dmy(c.ownPolicyFrom) })
              : t('detail.orgPolicy')}{' '}
            <Link href="/admin/policies" className="text-brand-700 underline">
              {t('detail.policyLink')}
            </Link>
          </p>
          <p
            className={c.ratio.short ? 'text-sm text-warn' : 'text-sm text-ink-muted'}
            data-testid="cohort-ratio"
          >
            {explain(c.ratio.explanation)}
          </p>
          <p className="text-sm text-ink-muted">
            {c.registrationClosesOn
              ? t('detail.closes', { date: dmy(c.registrationClosesOn) })
              : t('detail.closesAtEnd')}
          </p>
          <ActionForm action={cohortStatusAction} className="mt-2">
            <input type="hidden" name="id" value={c.id} />
            <SelectField
              name="status"
              label={t('detail.status')}
              options={statusOptions}
              defaultValue={c.status}
            />
            <div>
              <SubmitButton variant="secondary">{t('detail.saveStatus')}</SubmitButton>
            </div>
          </ActionForm>
          <Link
            href={`/admin/cohorts/${c.id}/roster`}
            className="mt-3 inline-block text-sm text-brand-700 underline"
            data-testid="roster-link"
          >
            {t('detail.print')}
          </Link>
        </Card>

        <Card>
          <CardTitle>{t('detail.groups')}</CardTitle>
          {c.groups.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('detail.noGroups')}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="cohort-groups">
              {c.groups.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t('detail.group', {
                      name: g.name,
                      day: tw(String(g.weekday)),
                      time: g.time,
                      venue: g.venueName,
                      lead: g.leadName ?? '—',
                      lessons: g.lessonDates.length,
                    })}
                  </span>
                  {c.registered === 0 ? (
                    <ActionButton
                      action={detachGroupAction}
                      fields={{ cohortId: c.id, classTemplateId: g.id }}
                      variant="ghost"
                    >
                      {t('detail.detach')}
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {c.registered === 0 && data.free.length > 0 ? (
            <ActionForm action={attachGroupAction} className="mt-3" testId="attach-group">
              <input type="hidden" name="cohortId" value={c.id} />
              <SelectField
                name="classTemplateId"
                label={t('detail.attach')}
                hint={t('detail.attachHint')}
                options={data.free.map((g) => ({
                  value: g.id,
                  label: `${g.name} · ${tw(String(g.weekday))}`,
                }))}
              />
              <div>
                <SubmitButton variant="secondary">{t('detail.attachButton')}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </Card>

        <Card>
          <CardTitle>{t('detail.staff')}</CardTitle>
          {c.staff.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('detail.noStaff')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {c.staff.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <span>{s.role ? `${s.name} · ${s.role}` : s.name}</span>
                  <ActionButton
                    action={removeCohortStaffAction}
                    fields={{ id: s.id, cohortId: c.id }}
                    variant="ghost"
                  >
                    {t('detail.remove')}
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addCohortStaffAction} className="mt-3" testId="add-staff">
            <input type="hidden" name="cohortId" value={c.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="staffMemberId"
                label={t('detail.staffMember')}
                options={data.staff
                  .filter((s) => s.status === 'active')
                  .map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              />
              <Field name="role" label={t('detail.role')} />
            </div>
            <div>
              <SubmitButton variant="secondary">{t('detail.addStaff')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardTitle>{t('detail.roster', { n: c.roster.length, capacity: c.capacity })}</CardTitle>
          {c.roster.length === 0 ? (
            <EmptyState title={t('detail.noMembers')} />
          ) : (
            <ul className="flex flex-col divide-y divide-line" data-testid="cohort-roster">
              {c.roster.map((r) => (
                <li
                  key={r.studentId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-testid="cohort-member"
                >
                  <span>
                    {r.name}
                    {r.waterFear ? (
                      <Badge tone="warn" className="ms-2">
                        {t('detail.waterFear')}
                      </Badge>
                    ) : null}
                  </span>
                  <ActionButton
                    action={cancelRegistrationAction}
                    fields={{ cohortId: c.id, studentId: r.studentId }}
                    variant="ghost"
                    confirm={t('detail.cancelConfirm')}
                  >
                    {t('detail.cancel')}
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={registerAction} className="mt-3" testId="register">
            <input type="hidden" name="cohortId" value={c.id} />
            <SelectField
              name="studentId"
              label={t('detail.student')}
              options={data.students
                .filter((s) => !registered.has(s.id))
                .map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            />
            <div>
              <SubmitButton>{t('detail.register')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <details>
            <summary className="min-h-tap cursor-pointer py-3 text-sm text-brand-700">
              {t('detail.edit')}
            </summary>
            <ActionForm action={updateCohortAction}>
              <input type="hidden" name="id" value={c.id} />
              <CohortFields
                cohort={c}
                programs={data.programs
                  .filter((p) => p.kind === 'intensive_course' || p.kind === 'camp')
                  .map((p) => ({ value: p.id, label: p.nameHe }))}
              />
              <div>
                <SubmitButton variant="secondary">{t('detail.save')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}
