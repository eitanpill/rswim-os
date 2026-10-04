import { getTranslations } from 'next-intl/server';
import { APPLICANT_SOURCES, APPLICANT_STAGES } from '@rswim/contracts';
import { listApplicants } from '@rswim/domain-staff';
import { listVenues } from '@rswim/domain-venues';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, shekelValue, weekdayOptions } from '@/lib/options';
import { createApplicantAction, updateApplicantAction } from '../ops-actions';
import { StaffOpsTabs } from '../ops-tabs';

const SCORES = ['water', 'kids', 'reliability'] as const;
const scoreOptions = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));

/**
 * Recruiting (brief §6.8): applicants by stage with a trial day and a short scorecard, the talent pool of people to
 * call when no substitute is found, and a ready job post for the venue and day that is short of instructors.
 */
export default async function RecruitingPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; day?: string }>;
}) {
  const q = await searchParams;
  const t = await getTranslations('staffops.recruiting');
  const tw = await getTranslations('common.weekday');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  const { applicants, venues, school } = await withSession(async (tx, _ctx, session) => {
    const [applicants, venues] = await Promise.all([listApplicants(tx), listVenues(tx)]);
    return { applicants, venues, school: session.orgName ?? '' };
  });
  const stages = await enumOptions('applicantStage', APPLICANT_STAGES);
  const venue = venues.find((v) => v.id === q.venue) ?? venues[0];
  const day = /^[0-6]$/.test(q.day ?? '') ? (q.day as string) : '0';

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <StaffOpsTabs active="recruiting" />
      <div className="flex flex-col gap-4">
        {APPLICANT_STAGES.map((stage) => {
          const list = applicants.filter((a) => a.stage === stage);
          if (list.length === 0) return null;
          return (
            <Card key={stage} data-testid={`applicants-${stage}`}>
              <CardTitle aside={<Badge>{list.length}</Badge>}>
                {label('applicantStage', stage)}
              </CardTitle>
              <ul className="flex flex-col gap-2">
                {list.map((a) => {
                  const card = a.scorecard as Partial<Record<(typeof SCORES)[number], number>>;
                  const scored = SCORES.filter((k) => card[k]);
                  return (
                    <li
                      key={a.id}
                      className="rounded-xl border border-line p-3"
                      data-testid="applicant"
                    >
                      <p className="font-medium">
                        {a.firstName} {a.lastName ?? ''}
                        <span className="text-sm font-normal text-ink-muted">
                          {' '}
                          · {label('applicantSource', a.source)}
                        </span>
                      </p>
                      <p className="text-sm text-ink-muted">
                        {[
                          a.phoneE164 ? <bdi key="p">{a.phoneE164}</bdi> : null,
                          a.certifications,
                          a.availability,
                          a.rateExpectationAgorot !== null
                            ? `${t('rate')}: ${shekelValue(a.rateExpectationAgorot)}`
                            : null,
                          a.trialDayOn ? `${t('trialDay')}: ${dmy(a.trialDayOn)}` : null,
                        ]
                          .filter(Boolean)
                          .map((x, i) => (
                            <span key={i}>
                              {i > 0 ? ' · ' : ''}
                              {x}
                            </span>
                          ))}
                      </p>
                      {scored.length ? (
                        <p className="text-sm">
                          {t('score')}: {scored.map((k) => `${t(k)} ${card[k]}`).join(' · ')}
                        </p>
                      ) : null}
                      {a.notes ? <p className="text-sm">{a.notes}</p> : null}
                      <details className="mt-1">
                        <summary className="min-h-tap cursor-pointer py-3 text-sm text-ink-muted">
                          {t('update')}
                        </summary>
                        <ActionForm action={updateApplicantAction} className="mt-2">
                          <input type="hidden" name="id" value={a.id} />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <SelectField
                              name="stage"
                              label={t('stage')}
                              options={stages}
                              defaultValue={a.stage}
                            />
                            <Field
                              name="trialDayOn"
                              type="date"
                              label={t('trialDay')}
                              defaultValue={a.trialDayOn ?? ''}
                            />
                            {SCORES.map((k) => (
                              <SelectField
                                key={k}
                                name={k}
                                label={t(k)}
                                options={scoreOptions}
                                includeEmpty="—"
                                defaultValue={card[k] ? String(card[k]) : ''}
                              />
                            ))}
                          </div>
                          <TextareaField
                            name="notes"
                            label={t('notes')}
                            defaultValue={a.notes ?? ''}
                          />
                          <div>
                            <SubmitButton variant="secondary">{tc('save')}</SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
        {applicants.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : null}

        <Card>
          <CardTitle>{t('add')}</CardTitle>
          <ActionForm action={createApplicantAction} resetOnSuccess testId="add-applicant">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="firstName" label={t('firstName')} />
              <Field name="lastName" label={t('lastName')} />
              <Field name="phone" label={t('phone')} type="tel" dir="ltr" />
              <Field name="email" label={t('email')} type="email" dir="ltr" />
              <SelectField
                name="gender"
                label={t('gender')}
                options={await enumOptions('instructorGender', ['female', 'male'])}
                includeEmpty="—"
              />
              <SelectField
                name="source"
                label={t('source')}
                options={await enumOptions('applicantSource', APPLICANT_SOURCES)}
              />
              <Field name="certifications" label={t('certifications')} />
              <Field name="rateExpectation" label={t('rate')} inputMode="decimal" dir="ltr" />
            </div>
            <Field name="availability" label={t('availability')} />
            <TextareaField name="notes" label={t('notes')} />
            <div>
              <SubmitButton>{t('add')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        {venue ? (
          <Card data-testid="job-post">
            <CardTitle>{t('jobPost')}</CardTitle>
            <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('jobPostVenue')}
                <select
                  name="venue"
                  defaultValue={venue.id}
                  className="min-h-tap rounded-xl border border-line bg-surface px-3 text-base"
                >
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('jobPostDay')}
                <select
                  name="day"
                  defaultValue={day}
                  className="min-h-tap rounded-xl border border-line bg-surface px-3 text-base"
                >
                  {(await weekdayOptions()).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="min-h-tap rounded-xl border border-line px-4 text-sm hover:border-brand-500"
              >
                {t('update')}
              </button>
            </form>
            <p className="mb-2 text-sm text-ink-muted">{t('jobPostHint')}</p>
            <textarea
              readOnly
              rows={6}
              aria-label={t('jobPost')}
              className="w-full rounded-xl border border-line bg-surface p-3 text-base"
              value={t('jobPostText', { school, venue: venue.name, weekday: tw(day) })}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
