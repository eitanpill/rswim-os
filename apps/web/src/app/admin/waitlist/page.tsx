import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { searchStudents } from '@rswim/domain-people';
import { groupSuggestions, listGroups, listWaitlist } from '@rswim/domain-scheduling';
import { listPrograms } from '@rswim/domain-settings';
import { listVenues } from '@rswim/domain-venues';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  CheckboxGroup,
  Field,
  SelectField,
  SubmitButton,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { todayIL, weekdayOptions } from '@/lib/options';
import { ageText, hhmm } from '@/lib/scheduling';
import { addToWaitlistAction, placeFromWaitlistAction, withdrawAction } from './actions';
import { venuePools } from '../groups/choices';

/** Who is waiting, for what, and where enough families wait to open a new group. */
export default async function WaitlistPage() {
  const t = await getTranslations('scheduling.waitlist');
  const tw = await getTranslations('common.weekday');
  const age = await ageText();
  const today = todayIL();
  const data = await withSession(async (tx) => {
    const [entries, clusters, programs, venues, groups, students, pools] = await Promise.all([
      listWaitlist(tx),
      groupSuggestions(tx),
      listPrograms(tx),
      listVenues(tx),
      listGroups(tx),
      searchStudents(tx, '', 500),
      venuePools(tx),
    ]);
    return { entries, clusters, programs, venues, groups, students, pools };
  });
  const programName = new Map(data.programs.map((p) => [p.id, p.nameHe]));
  const venueName = new Map(data.venues.map((v) => [v.id, v.name]));
  const firstPool = (venueId: string | null) =>
    data.pools.find((p) => p.venueId === venueId)?.poolId ?? data.pools[0]?.poolId;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        {data.clusters.length ? (
          <Card data-testid="waitlist-suggestions">
            <CardTitle>{t('suggestions')}</CardTitle>
            <ul className="flex flex-col gap-2">
              {data.clusters.map((c) => (
                <li
                  key={c.entryIds.join()}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 p-3 dark:bg-surface"
                >
                  <p>
                    {t('suggestion', {
                      n: c.entryIds.length,
                      program: programName.get(c.programId) ?? '',
                      day: tw(String(c.weekday)),
                      venue: c.venueId ? (venueName.get(c.venueId) ?? '') : t('anyVenue'),
                    })}
                    {c.ageFromYears !== null
                      ? ` · ${t('ages', { from: c.ageFromYears, to: c.ageToYears ?? c.ageFromYears })}`
                      : ''}
                    {c.hour ? ` · ${c.hour}` : ''}
                  </p>
                  <Link
                    href={`/admin/groups/new?pool=${firstPool(c.venueId)}&program=${c.programId}&weekday=${c.weekday}${c.hour ? `&startsAt=${c.hour}` : ''}`}
                    className="text-brand-700 underline"
                  >
                    {t('openGroup')}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          {data.entries.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.entries.map((e) => {
                const options = data.groups
                  .filter(
                    (g) => g.programId === e.programId && (!e.venueId || g.venueId === e.venueId),
                  )
                  .map((g) => ({
                    value: g.id,
                    label: `${g.name} · ${tw(String(g.weekday))} ${hhmm(g.startsAt)}`,
                  }));
                return (
                  <li
                    key={e.id}
                    className="rounded-xl border border-line p-3"
                    data-testid="waitlist-row"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {e.student ? `${e.student.firstName} ${e.student.lastName}` : '?'}{' '}
                        <span className="text-sm text-ink-muted">{age(e.ageMonths)}</span>
                      </p>
                      <ActionButton action={withdrawAction} fields={{ id: e.id }} variant="ghost">
                        {t('withdraw')}
                      </ActionButton>
                    </div>
                    <p className="text-sm text-ink-muted">
                      {programName.get(e.programId)}
                      {e.venueId ? ` · ${venueName.get(e.venueId)}` : ''}
                      {e.preferredWeekdays.length
                        ? ` · ${e.preferredWeekdays.map((d) => tw(String(d))).join(', ')}`
                        : ''}
                      {e.earliestAt || e.latestAt ? (
                        <>
                          {' · '}
                          <span dir="ltr">
                            {hhmm(e.earliestAt)}–{hhmm(e.latestAt)}
                          </span>
                        </>
                      ) : null}
                    </p>
                    {options.length ? (
                      <ActionForm
                        action={placeFromWaitlistAction}
                        className="mt-2 flex-row flex-wrap items-end"
                      >
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="onDate" value={today} />
                        <SelectField name="toTemplateId" label={t('placeIn')} options={options} />
                        <div>
                          <SubmitButton variant="secondary">{t('place')}</SubmitButton>
                        </div>
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('add')}</CardTitle>
          <ActionForm action={addToWaitlistAction} resetOnSuccess testId="waitlist-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="studentId"
                label={t('student')}
                options={data.students.map((s) => ({
                  value: s.id,
                  label: `${s.firstName} ${s.lastName}`,
                }))}
              />
              <SelectField
                name="programId"
                label={t('program')}
                options={data.programs.map((p) => ({ value: p.id, label: p.nameHe }))}
              />
              <SelectField
                name="venueId"
                label={t('venue')}
                options={data.venues.map((v) => ({ value: v.id, label: v.name }))}
                includeEmpty={t('anyVenue')}
              />
              <Field
                name="priority"
                label={t('priority')}
                type="number"
                inputMode="numeric"
                defaultValue="0"
                hint={t('priorityHint')}
              />
            </div>
            <CheckboxGroup
              name="preferredWeekdays"
              legend={t('weekdays')}
              options={await weekdayOptions()}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field name="earliestAt" label={t('earliestAt')} type="time" />
              <Field name="latestAt" label={t('latestAt')} type="time" />
            </div>
            <Field name="notes" label={t('notes')} />
            <div>
              <SubmitButton>{t('add')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
