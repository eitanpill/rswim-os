import { getTranslations } from 'next-intl/server';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { sessionWhen } from '@/lib/attendance';
import { withSession } from '@/lib/db';
import { parentAbsenceAction, parentCancelMakeupAction, parentWithdrawAction } from '../actions';
import { familyOverview } from '../family';

/** Each child's lessons in the next two weeks: report an absence in one tap, see the decision, see booked makeups. */
export default async function ParentSchedule({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string }>;
}) {
  const { booked } = await searchParams;
  const t = await getTranslations('parent.schedule');
  const data = await withSession((tx) => familyOverview(tx));
  const live = data?.bookings.filter((b) => b.status === 'booked') ?? [];
  const credits = new Map(data?.credits.map((c) => [c.id, c]) ?? []);
  const name = new Map(data?.family.students.map((s) => [s.id, s.firstName]) ?? []);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        {booked ? (
          <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">
            {t('booked')}
          </p>
        ) : null}
        {live.length ? (
          <Card data-testid="parent-makeups">
            <CardTitle>{t('makeups')}</CardTitle>
            <ul className="flex flex-col gap-2">
              {live.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ok/60 p-3"
                >
                  <span>
                    {name.get(credits.get(b.creditId)?.studentId ?? '') ?? ''} · {b.groupName}{' '}
                    {b.date && b.startsAt
                      ? sessionWhen({ date: b.date, startsAt: b.startsAt })
                      : ''}
                  </span>
                  <ActionButton
                    action={parentCancelMakeupAction}
                    fields={{ id: b.id }}
                    variant="ghost"
                    confirm={t('cancelConfirm')}
                  >
                    {t('cancelMakeup')}
                  </ActionButton>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {(data?.lessons ?? []).map(({ student, sessions }) => (
          <Card key={student.id} data-testid="child-lessons">
            <CardTitle>{student.firstName}</CardTitle>
            {sessions.length === 0 ? (
              <EmptyState title={t('none')} />
            ) : (
              <ul className="flex flex-col gap-2">
                {sessions.map((s) => {
                  const notice = data?.notices.find(
                    (n) =>
                      n.sessionId === s.id &&
                      n.studentId === student.id &&
                      n.status !== 'withdrawn',
                  );
                  return (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
                      data-testid="parent-lesson"
                      data-lesson={`${student.id}:${s.id}`}
                      data-date={s.date}
                    >
                      <span>
                        <span className="font-medium">{s.groupName}</span>{' '}
                        <span className="text-sm text-ink-muted">{sessionWhen(s)}</span>
                      </span>
                      {notice ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              notice.status === 'pending'
                                ? 'warn'
                                : notice.creditId
                                  ? 'ok'
                                  : 'neutral'
                            }
                          >
                            {notice.status === 'pending'
                              ? t('pending')
                              : notice.creditId
                                ? t('withCredit')
                                : t('noCredit')}
                          </Badge>
                          <ActionButton
                            action={parentWithdrawAction}
                            fields={{ id: notice.id }}
                            variant="ghost"
                          >
                            {t('comingAfterAll')}
                          </ActionButton>
                        </span>
                      ) : (
                        <ActionButton
                          action={parentAbsenceAction}
                          fields={{ sessionId: s.id, studentId: student.id }}
                          variant="secondary"
                          confirm={t('confirm', { name: student.firstName })}
                        >
                          {t('report')}
                        </ActionButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
