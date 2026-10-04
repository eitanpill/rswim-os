import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FREEZE_REASONS } from '@rswim/contracts';
import { addDays } from '@rswim/calendar';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { sessionWhen } from '@/lib/attendance';
import { periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import {
  parentAskFreezeAction,
  parentAskLeaveAction,
  parentWithdrawRequestAction,
} from '../../actions';
import { childOverview } from '../../family';

const TONE = { pending: 'warn', done: 'ok', refused: 'danger', withdrawn: 'neutral' } as const;

/**
 * A child's card (brief §6.13): the coming lessons, progress on their level, and the family's own requests to freeze
 * a seat or to leave, each decided by the regulations with the answer shown here.
 */
export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('parent.child');
  const tAll = await getTranslations();
  const label = await enumLabel();
  const data = await withSession((tx) => childOverview(tx, id));
  if (!data) notFound();
  const { student, sessions, places, changes, requests, progress } = data;
  const today = todayIL();
  const reasons = await enumOptions('freezeReason', FREEZE_REASONS);
  const groupOf = (enrollmentId: string) =>
    places.find((p) => p.enrollmentId === enrollmentId)?.groupName ?? '';
  const reasonText = (e: unknown) => {
    const x = e as { code?: string; params?: Record<string, string | number> } | null;
    return x?.code && tAll.has(x.code) ? tAll(x.code, x.params ?? {}) : '';
  };

  return (
    <>
      <PageHeader title={`${student.firstName} ${student.lastName}`} />
      <div className="flex flex-col gap-4">
        <Card data-testid="child-progress">
          <CardTitle>{t('progress')}</CardTitle>
          {progress?.levelName ? (
            <>
              <p className="font-medium">
                {t('level', { program: progress.programName ?? '', level: progress.levelName })}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {progress.skills.map((s) => (
                  <li key={s.code} className="flex items-center justify-between gap-2">
                    <span>
                      {s.achievedOn ? '✓ ' : '○ '}
                      {s.name}
                    </span>
                    <span className="text-sm text-ink-muted">
                      {s.achievedOn ? t('achieved', { date: dmy(s.achievedOn) }) : t('working')}
                    </span>
                  </li>
                ))}
              </ul>
              {progress.nextLevelName ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {t('nextLevel', { level: progress.nextLevelName })}
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState title={t('noLevel')} />
          )}
        </Card>

        <Card>
          <CardTitle>{t('lessons')}</CardTitle>
          {sessions.length === 0 ? (
            <EmptyState title={t('noLessons')} />
          ) : (
            <ul className="flex flex-col text-sm">
              {sessions.map((s) => (
                <li key={s.id} className="border-t border-line py-2">
                  {s.groupName} · {sessionWhen(s)}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/parent/schedule"
            className="mt-2 inline-block min-h-tap py-3 text-brand-700 underline"
          >
            {tAll('parent.home.reportAbsence')}
          </Link>
        </Card>

        {requests.length ? (
          <Card data-testid="child-requests">
            <CardTitle>{t('requests')}</CardTitle>
            <ul className="flex flex-col gap-2">
              {requests.map((r) => {
                const freeze = changes.freezes.find((f) => f.id === r.freezeId);
                const leave = changes.cancellations.find((c) => c.id === r.cancellationId);
                return (
                  <li
                    key={r.id}
                    className="rounded-xl border border-line p-3"
                    data-testid="child-request"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {r.kind === 'freeze'
                          ? t('requestFreeze', { from: dmy(r.fromDate), to: dmy(r.toDate) })
                          : t('requestLeave')}{' '}
                        · {groupOf(r.enrollmentId)}
                      </span>
                      <Badge tone={TONE[r.status as keyof typeof TONE] ?? 'neutral'}>
                        {label('portalRequestStatus', r.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-ink-muted">
                      {t('requestedOn', {
                        date: dmy(
                          new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(
                            r.requestedAt,
                          ),
                        ),
                      })}
                    </p>
                    {freeze ? (
                      <p className="text-sm">
                        {t('freezeOutcome', { status: label('freezeStatus', freeze.status) })}
                      </p>
                    ) : null}
                    {leave ? (
                      <p className="text-sm">
                        {t('leaveOutcome', {
                          period: periodLabel(leave.lastChargedPeriod),
                          date: dmy(leave.endsOn),
                        })}
                      </p>
                    ) : null}
                    {r.status === 'refused' ? (
                      <p className="text-sm text-danger">
                        {t('refused', { reason: reasonText(r.error) })}
                      </p>
                    ) : null}
                    {r.status === 'pending' ? (
                      <div className="mt-2">
                        <ActionButton
                          action={parentWithdrawRequestAction}
                          fields={{ id: r.id, studentId: student.id }}
                          variant="secondary"
                        >
                          {t('withdraw')}
                        </ActionButton>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        {places.map((p) => {
          const leaving = p.status === 'cancel_requested' || p.endsOn !== null;
          return (
            <Card key={p.enrollmentId} data-testid="child-seat">
              <CardTitle aside={leaving ? <Badge tone="warn">{t('leaving')}</Badge> : null}>
                {p.groupName}
              </CardTitle>
              <details>
                <summary className="min-h-tap cursor-pointer py-3 text-brand-700">
                  {t('freeze')}
                </summary>
                <ActionForm action={parentAskFreezeAction} className="mt-2" testId="ask-freeze">
                  <input type="hidden" name="enrollmentId" value={p.enrollmentId} />
                  <input type="hidden" name="studentId" value={student.id} />
                  <p className="text-sm text-ink-muted">{t('freezeHint')}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      name="fromDate"
                      type="date"
                      label={t('from')}
                      defaultValue={addDays(today, 7)}
                    />
                    <Field
                      name="toDate"
                      type="date"
                      label={t('to')}
                      defaultValue={addDays(today, 21)}
                    />
                  </div>
                  <SelectField name="reason" label={t('reason')} options={reasons} />
                  <TextareaField name="note" label={t('note')} />
                  <div>
                    <SubmitButton>{t('sendFreeze')}</SubmitButton>
                  </div>
                </ActionForm>
              </details>
              {!leaving ? (
                <details>
                  <summary className="min-h-tap cursor-pointer py-3 text-brand-700">
                    {t('leave')}
                  </summary>
                  <ActionForm action={parentAskLeaveAction} className="mt-2" testId="ask-leave">
                    <input type="hidden" name="enrollmentId" value={p.enrollmentId} />
                    <input type="hidden" name="studentId" value={student.id} />
                    <p className="text-sm text-ink-muted">{t('leaveHint')}</p>
                    <TextareaField name="note" label={t('note')} />
                    <div>
                      <SubmitButton variant="danger">{t('sendLeave')}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
