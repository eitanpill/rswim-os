import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SEAT_HOLDING_STATUSES, type EnrollmentStatus } from '@rswim/contracts';
import { searchStudents, studentsByIds } from '@rswim/domain-people';
import { getGroup, listShiftChanges } from '@rswim/domain-scheduling';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, todayIL } from '@/lib/options';
import { clockIL, hhmm, staffNames } from '@/lib/scheduling';
import {
  archiveGroupAction,
  placeInGroupAction,
  removeFromGroupAction,
  requestShiftChangeAction,
  updateGroupAction,
} from '../actions';
import { groupChoices } from '../choices';
import { GroupForm } from '../group-form';
import { ShiftChangeList } from '../../shifts/shift-change-list';

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
  const data = await withSession(async (tx) => {
    const detail = await getGroup(tx, id);
    if (!detail) return null;
    const [choices, changes, kids, found] = await Promise.all([
      groupChoices(tx, detail.group.poolId),
      listShiftChanges(tx),
      studentsByIds(
        tx,
        detail.enrollments.map((e) => e.studentId),
      ),
      q?.trim() ? searchStudents(tx, q, 10) : Promise.resolve([]),
    ]);
    return {
      detail,
      choices,
      changes: changes.filter((c) => c.classTemplateId === id),
      kids,
      found,
    };
  });
  if (!data?.choices) notFound();
  const { detail, choices, changes, kids, found } = data;
  const { group } = detail;
  const t = await getTranslations('scheduling.group');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const name = staffNames(choices.staff);
  const today = todayIL();
  const kid = new Map(kids.map((k) => [k.id, k]));
  const seats = detail.enrollments.filter(
    (e) =>
      SEAT_HOLDING_STATUSES.includes(e.status as EnrollmentStatus) &&
      (e.endsOn === null || e.endsOn > today),
  );
  const laneLabels = choices.place.lanes
    .filter((l) => detail.laneIds.includes(l.id))
    .map((l) => l.label)
    .join(', ');
  const staffOptions = choices.staff.map((s) => ({
    value: s.id,
    label: `${s.firstName} ${s.lastName}`,
  }));

  return (
    <>
      <PageHeader
        title={group.name}
        subtitle={`${tw(String(group.weekday))} ${hhmm(group.startsAt)} · ${choices.place.label}`}
        actions={
          <Link href={`/admin/board?venue=${group.venueId}`} className="text-brand-700 underline">
            {t('toBoard')}
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-muted">{t('lead')}</dt>
              <dd className="font-medium" data-testid="group-lead">
                {group.leadStaffId ? name(group.leadStaffId) : t('noLead')}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">{t('fill')}</dt>
              <dd className="font-medium">
                {t('fillValue', { n: seats.length, capacity: group.capacity })}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">{t('lanes')}</dt>
              <dd className="font-medium">{laneLabels}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{t('admits')}</dt>
              <dd className="font-medium">{label('admittedGender', group.admittedGender)}</dd>
            </div>
          </dl>
          <details className="mt-3">
            <summary className="min-h-tap cursor-pointer font-medium text-brand-700">
              {t('edit')}
            </summary>
            <div className="mt-2">
              <GroupForm
                action={updateGroupAction.bind(null, group.id)}
                choices={choices}
                group={group}
                laneIds={detail.laneIds}
              />
            </div>
          </details>
        </Card>

        <Card>
          <CardTitle>{t('instructor')}</CardTitle>
          <ActionForm
            action={requestShiftChangeAction.bind(null, group.id)}
            resetOnSuccess
            testId="reassign-group-form"
          >
            <input type="hidden" name="kind" value="reassign_group" />
            <input type="hidden" name="classTemplateId" value={group.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField name="toStaffId" label={t('newLead')} options={staffOptions} />
              <Field name="effectiveFrom" label={t('from')} type="date" defaultValue={today} />
            </div>
            <Field name="reason" label={t('reason')} />
            <p className="text-xs text-ink-muted">{t('acceptHint')}</p>
            <div>
              <SubmitButton>{t('requestChange')}</SubmitButton>
            </div>
          </ActionForm>
          {changes.length ? (
            <div className="mt-4">
              <ShiftChangeList
                changes={changes}
                staff={choices.staff}
                path={`/admin/groups/${group.id}`}
              />
            </div>
          ) : null}
        </Card>

        <Card>
          <CardTitle>{t('members')}</CardTitle>
          {seats.length === 0 ? (
            <EmptyState title={t('noMembers')} />
          ) : (
            <ul className="mb-3 flex flex-col gap-2" data-testid="group-members">
              {seats.map((e) => {
                const s = kid.get(e.studentId);
                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
                  >
                    <div>
                      <Link
                        href={`/admin/families/${s?.householdId ?? ''}`}
                        className="font-medium underline"
                      >
                        {s ? `${s.firstName} ${s.lastName}` : '?'}
                      </Link>
                      <p className="text-xs text-ink-muted">
                        {label('enrollmentStatus', e.status)} ·{' '}
                        {t('since', { date: dmy(e.startsOn) })}
                      </p>
                    </div>
                    <ActionButton
                      action={removeFromGroupAction.bind(null, group.id)}
                      fields={{ studentId: e.studentId, onDate: today }}
                      variant="ghost"
                      confirm={t('confirmRemove')}
                    >
                      {t('remove')}
                    </ActionButton>
                  </li>
                );
              })}
            </ul>
          )}
          <form className="flex flex-wrap items-end gap-2" role="search">
            <label className="flex grow flex-col gap-1 text-sm font-medium">
              {t('addStudent')}
              <input
                name="q"
                defaultValue={q ?? ''}
                placeholder={t('searchPlaceholder')}
                className="min-h-tap rounded-xl border border-line bg-surface px-3 text-base"
              />
            </label>
            <button type="submit" className="min-h-tap rounded-xl border border-line px-4">
              {t('search')}
            </button>
          </form>
          {found.length ? (
            <ul className="mt-3 flex flex-col gap-2">
              {found.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {s.firstName} {s.lastName}
                  </span>
                  <ActionButton
                    action={placeInGroupAction.bind(null, group.id)}
                    fields={{ studentId: s.id, onDate: today }}
                    variant="secondary"
                  >
                    {t('place')}
                  </ActionButton>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <CardTitle>{t('upcoming')}</CardTitle>
          {detail.upcoming.length === 0 ? (
            <EmptyState title={t('noSessions')}>
              <Link href="/admin/terms" className="text-brand-700 underline">
                {t('toTerms')}
              </Link>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.upcoming.map((s) => (
                <li key={s.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {dmy(s.date)} ·{' '}
                      <span dir="ltr">
                        {clockIL(s.startsAt)}–{clockIL(s.endsAt)}
                      </span>
                    </span>
                    <span className="text-sm text-ink-muted">
                      {s.leadStaffId ? name(s.leadStaffId) : t('noLead')}
                      {s.status !== 'scheduled' ? (
                        <Badge tone="warn" className="ms-2">
                          {label('sessionStatus', s.status)}
                        </Badge>
                      ) : null}
                    </span>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-brand-700">
                      {t('changeSession')}
                    </summary>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <ActionForm
                        action={requestShiftChangeAction.bind(null, group.id)}
                        resetOnSuccess
                      >
                        <input type="hidden" name="kind" value="reassign_session" />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <SelectField
                          name="toStaffId"
                          label={t('substitute')}
                          options={staffOptions}
                        />
                        <div>
                          <SubmitButton variant="secondary">{t('requestChange')}</SubmitButton>
                        </div>
                      </ActionForm>
                      <ActionForm
                        action={requestShiftChangeAction.bind(null, group.id)}
                        resetOnSuccess
                      >
                        <input type="hidden" name="kind" value="reschedule_session" />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <div className="grid grid-cols-2 gap-3">
                          <Field
                            name="startsAt"
                            label={t('newStart')}
                            type="time"
                            defaultValue={clockIL(s.startsAt)}
                          />
                          <Field
                            name="endsAt"
                            label={t('newEnd')}
                            type="time"
                            defaultValue={clockIL(s.endsAt)}
                          />
                        </div>
                        <div>
                          <SubmitButton variant="secondary">{t('requestChange')}</SubmitButton>
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          <ActionButton
            action={archiveGroupAction}
            fields={{ id: group.id }}
            variant="ghost"
            confirm={t('confirmArchive')}
          >
            {t('archive')}
          </ActionButton>
        </div>
      </div>
    </>
  );
}
