import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { listSubstituteRequests, upcomingLessons } from '@rswim/domain-scheduling';
import { listStaff } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, todayIL } from '@/lib/options';
import { staffNames } from '@/lib/scheduling';
import { when } from '../../messages/tabs';
import { cancelSubstituteAction, requestSubstituteAction } from '../ops-actions';
import { StaffOpsTabs } from '../ops-tabs';

const TONE = { open: 'warn', filled: 'ok', unfilled: 'danger', cancelled: 'neutral' } as const;
const SHOWN_REASONS = new Set(['knowsGroup', 'atVenueThatDay']);

/**
 * Substitutes (brief §6.8): pick a lesson someone can't teach, and the system offers it in waves to qualified, free
 * instructors (closest fit first). The first to accept takes it and the parents are told who is teaching.
 */
export default async function SubstitutesPage() {
  const t = await getTranslations('staffops.substitutes');
  const label = await enumLabel();
  const today = todayIL();
  const { lessons, requests, staff } = await withSession(async (tx) => {
    const [lessons, requests, staff] = await Promise.all([
      upcomingLessons(tx, { from: today, to: addDays(today, 14) }),
      listSubstituteRequests(tx),
      listStaff(tx),
    ]);
    return { lessons, requests, staff };
  });
  const name = staffNames(staff);
  const options = lessons
    .filter((l) => !l.openRequest)
    .map((l) => ({
      value: l.id,
      label: [`${dmy(l.date)} ${l.starts}`, l.groupName, l.venueName, name(l.leadStaffId)]
        .filter(Boolean)
        .join(' · '),
    }));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <StaffOpsTabs active="substitutes" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('request')}</CardTitle>
          {options.length === 0 ? (
            <EmptyState title={t('noLessons')} />
          ) : (
            <ActionForm action={requestSubstituteAction} testId="request-substitute">
              <SelectField name="sessionId" label={t('lesson')} options={options} />
              <Field name="reason" label={t('reason')} />
              <div>
                <SubmitButton>{t('request')}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>
        <Card data-testid="substitute-requests">
          <CardTitle>{t('list')}</CardTitle>
          {requests.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-line p-3"
                  data-testid="substitute-request"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {dmy(r.lesson.date)} {r.lesson.startsAt}–{r.lesson.endsAt} ·{' '}
                      {r.lesson.groupName} · {r.lesson.venueName}
                    </span>
                    <Badge tone={TONE[r.status as keyof typeof TONE] ?? 'neutral'}>
                      {label('substituteRequestStatus', r.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {r.fromName ? t('from', { name: r.fromName }) : null}
                    {r.reason ? ` · ${r.reason}` : null}
                  </p>
                  {r.filledName ? (
                    <p className="text-sm font-medium" data-testid="substitute-filled">
                      {t('filledBy', { name: r.filledName })}
                    </p>
                  ) : null}
                  {r.status === 'open' ? (
                    <p className="text-sm text-ink-muted">
                      {t('wave', { n: r.wave })}
                      {r.nextWaveAt ? ` · ${t('nextWave', { time: when(r.nextWaveAt) })}` : null}
                    </p>
                  ) : null}
                  {r.offers.length ? (
                    <ul className="mt-2 flex flex-col text-sm">
                      {r.offers.map((o) => (
                        <li
                          key={o.id}
                          className="flex flex-wrap justify-between gap-2 border-t border-line py-1.5"
                        >
                          <span>
                            {o.name}
                            <span className="text-ink-muted">
                              {' '}
                              · {t('wave', { n: o.wave })}
                              {(o.reasons as string[])
                                .filter((x) => SHOWN_REASONS.has(x))
                                .map((x) => ` · ${t(`reason_${x}` as 'reason_knowsGroup')}`)
                                .join('')}
                            </span>
                          </span>
                          <span>{label('substituteOfferStatus', o.status)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {r.status === 'open' || r.status === 'unfilled' ? (
                    <div className="mt-2">
                      <ActionButton
                        action={cancelSubstituteAction}
                        fields={{ id: r.id }}
                        variant="secondary"
                      >
                        {t('cancel')}
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
