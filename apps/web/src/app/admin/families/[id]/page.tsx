import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { STUDENT_RELATION_TYPES } from '@rswim/contracts';
import { getHousehold } from '@rswim/domain-people';
import { listPrograms } from '@rswim/domain-settings';
import { listStaff } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel, enumOptions } from '@/lib/options';
import {
  addGuardianAction,
  addStudentAction,
  relateStudentsAction,
  unrelateStudentsAction,
  updateGuardianAction,
  updateHouseholdAction,
  updateStudentAction,
} from '../actions';
import { GuardianFields, HouseholdFields, StudentFields } from '../fields';

/** Age in years and months on the server's today, for the student card. */
function age(dob: string | null): { years: number; months: number } | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const now = new Date();
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (now.getDate() < d) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export default async function FamilyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await withSession(async (tx) => {
    const family = await getHousehold(tx, id);
    if (!family) return null;
    const [programs, staff] = await Promise.all([listPrograms(tx), listStaff(tx)]);
    return { family, programs, staff };
  });
  if (!data) notFound();
  const { family, programs, staff } = data;
  const { household, guardians, students, relations } = family;
  const t = await getTranslations('families');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  const levels = programs.flatMap((p) =>
    p.levels.map((l) => ({ value: l.id, label: `${p.nameHe}: ${l.nameHe}`, name: l.nameHe })),
  );
  const staffOptions = staff
    .filter((s) => s.status === 'active')
    .map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }));
  const studentName = (sid: string) =>
    students.find((s) => s.id === sid)?.firstName ?? t('otherFamily');
  const studentOptions = students.map((s) => ({ value: s.id, label: s.firstName }));

  return (
    <>
      <PageHeader title={household.displayName} />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('guardians')}</CardTitle>
          <ul className="flex flex-col gap-2">
            {guardians.map((g) => (
              <li
                key={g.id}
                className="rounded-xl border border-line p-3"
                data-testid="guardian-row"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {g.firstName} {g.lastName}
                      {g.relation ? <span className="text-ink-muted"> · {g.relation}</span> : null}
                    </p>
                    <p className="text-sm text-ink-muted" dir="ltr">
                      {[g.phoneE164, g.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {g.isBillingContact ? <Badge>{t('guardian.billingBadge')}</Badge> : null}
                    <Badge tone={g.ghlContactId ? 'ok' : 'neutral'}>
                      {g.ghlContactId ? t('guardian.inCrm') : t('guardian.notInCrm')}
                    </Badge>
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-brand-700">{tc('edit')}</summary>
                  <ActionForm
                    action={updateGuardianAction.bind(null, household.id, g.id)}
                    className="mt-2"
                  >
                    <GuardianFields g={g} />
                    <div>
                      <SubmitButton>{tc('save')}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
          <details className="mt-3">
            <summary className="min-h-tap cursor-pointer text-brand-700">
              {t('guardian.add')}
            </summary>
            <ActionForm
              action={addGuardianAction.bind(null, household.id)}
              resetOnSuccess
              className="mt-2"
            >
              <GuardianFields />
              <div>
                <SubmitButton>{t('guardian.add')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>

        <Card>
          <CardTitle>{t('students')}</CardTitle>
          {students.length === 0 ? <EmptyState title={t('noStudents')} /> : null}
          <ul className="flex flex-col gap-2">
            {students.map((s) => {
              const a = age(s.dob);
              const flags = [
                s.waterFear && t('student.waterFear'),
                s.requiresFemaleInstructor && t('student.femaleInstructor'),
                !s.photoConsent && t('student.noPhotos'),
              ].filter(Boolean) as string[];
              return (
                <li
                  key={s.id}
                  className="rounded-xl border border-line p-3"
                  data-testid="student-row"
                >
                  <p className="font-medium">
                    {s.firstName} {s.lastName}
                    {a ? <span className="text-ink-muted"> · {t('student.age', a)}</span> : null}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {[levels.find((l) => l.value === s.levelId)?.name, s.school, s.grade]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {flags.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {flags.map((f) => (
                        <Badge key={f} tone="warn">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-brand-700">
                      {tc('edit')}
                    </summary>
                    <ActionForm
                      action={updateStudentAction.bind(null, household.id, s.id)}
                      className="mt-2"
                    >
                      <StudentFields s={s} levels={levels} staff={staffOptions} />
                      <div>
                        <SubmitButton>{tc('save')}</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                </li>
              );
            })}
          </ul>
          <details className="mt-3">
            <summary className="min-h-tap cursor-pointer text-brand-700">
              {t('student.add')}
            </summary>
            <ActionForm
              action={addStudentAction.bind(null, household.id)}
              resetOnSuccess
              className="mt-2"
            >
              <StudentFields levels={levels} staff={staffOptions} s={undefined} />
              <div>
                <SubmitButton>{t('student.add')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>

        {students.length > 1 || relations.length ? (
          <Card>
            <CardTitle>{t('relations.title')}</CardTitle>
            <p className="mb-2 text-sm text-ink-muted">{t('relations.hint')}</p>
            <ul className="mb-3 flex flex-col gap-2">
              {relations.map((r) => (
                <li
                  key={`${r.studentId}-${r.relatedStudentId}-${r.type}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
                >
                  <p>
                    {studentName(r.studentId)} · {studentName(r.relatedStudentId)} ·{' '}
                    {label('relationType', r.type)}
                  </p>
                  <ActionButton
                    action={unrelateStudentsAction.bind(null, household.id)}
                    fields={{ a: r.studentId, b: r.relatedStudentId, type: r.type }}
                    variant="ghost"
                  >
                    {tc('delete')}
                  </ActionButton>
                </li>
              ))}
            </ul>
            {students.length > 1 ? (
              <ActionForm action={relateStudentsAction.bind(null, household.id)} resetOnSuccess>
                <div className="grid grid-cols-3 gap-3">
                  <SelectField name="a" label={t('relations.a')} options={studentOptions} />
                  <SelectField
                    name="b"
                    label={t('relations.b')}
                    options={studentOptions}
                    defaultValue={studentOptions[1]?.value}
                  />
                  <SelectField
                    name="type"
                    label={t('relations.type')}
                    options={await enumOptions('relationType', STUDENT_RELATION_TYPES)}
                  />
                </div>
                <div>
                  <SubmitButton>{t('relations.add')}</SubmitButton>
                </div>
              </ActionForm>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <details>
            <summary className="min-h-tap cursor-pointer text-lg font-semibold">
              {t('household.title')}
            </summary>
            <ActionForm action={updateHouseholdAction.bind(null, household.id)} className="mt-3">
              <HouseholdFields h={household} />
              <div>
                <SubmitButton>{tc('save')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}
