import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ABSENCE_CHANNELS } from '@rswim/contracts';
import { listNotices, sessionLineup } from '@rswim/domain-attendance';
import { DomainError } from '@rswim/domain-core';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { LineupList } from '@/components/lineup-list';
import { dateTimeIL, noticeText, sessionWhen } from '@/lib/attendance';
import { withSession } from '@/lib/db';
import { enumLabel, enumOptions } from '@/lib/options';
import { reportAbsenceAction, withdrawNoticeAction } from '../actions';

/** One lesson for the office: who is expected, notices and their decisions, and the form to record a new notice. */
export default async function SessionAttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await withSession(async (tx) => {
    try {
      const lineup = await sessionLineup(tx, id);
      return { lineup, notices: await listNotices(tx, { sessionIds: [id] }) };
    } catch (e) {
      if (e instanceof DomainError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { lineup, notices } = data;
  const t = await getTranslations('attendance');
  const label = await enumLabel();
  const decision = await noticeText();
  const name = new Map(lineup.rows.map((r) => [r.studentId, `${r.firstName} ${r.lastName}`]));
  const members = lineup.rows.filter((r) => r.kind === 'member');
  const channels = (await enumOptions('absenceChannel', ABSENCE_CHANNELS)).filter(
    (o) => o.value !== 'parent_portal',
  );

  return (
    <>
      <PageHeader
        title={lineup.session.groupName}
        subtitle={
          <>
            {sessionWhen(lineup.session)}
            {lineup.session.status !== 'scheduled'
              ? ` · ${label('sessionStatus', lineup.session.status)}`
              : ''}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <Link href={`/admin/attendance?date=${lineup.session.date}`} className="text-brand-700">
          {t('day.back')}
        </Link>
        <Card>
          <CardTitle>{t('lineup.title', { n: lineup.rows.length })}</CardTitle>
          <LineupList rows={lineup.rows} />
        </Card>

        <Card data-testid="notices">
          <CardTitle>{t('absence.notices')}</CardTitle>
          {notices.length === 0 ? (
            <EmptyState title={t('absence.none')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {notices.map((n) => (
                <li
                  key={n.id}
                  className="rounded-xl border border-line p-3"
                  data-testid="notice-row"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {name.get(n.studentId) ?? ''}{' '}
                      <span className="text-sm text-ink-muted">
                        {label('absenceChannel', n.channel)} · {dateTimeIL(n.receivedAt)}
                      </span>
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          n.status === 'withdrawn'
                            ? 'neutral'
                            : n.creditId
                              ? 'ok'
                              : n.status === 'pending'
                                ? 'warn'
                                : 'danger'
                        }
                      >
                        {n.status === 'processed'
                          ? n.creditId
                            ? t('absence.withCredit')
                            : t('absence.noCredit')
                          : label('absenceNoticeStatus', n.status)}
                      </Badge>
                      {n.status !== 'withdrawn' ? (
                        <ActionButton
                          action={withdrawNoticeAction}
                          fields={{ id: n.id, sessionId: id }}
                          variant="ghost"
                          confirm={t('absence.withdrawConfirm')}
                        >
                          {t('absence.withdraw')}
                        </ActionButton>
                      ) : null}
                    </div>
                  </div>
                  {n.decision ? (
                    <p className="text-sm text-ink-muted" data-testid="notice-decision">
                      {decision(n.decision)}
                    </p>
                  ) : null}
                  {n.note ? <p className="text-sm text-ink-muted">{n.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {lineup.session.status === 'scheduled' && members.length > 0 ? (
          <Card>
            <CardTitle>{t('absence.record')}</CardTitle>
            <ActionForm action={reportAbsenceAction} testId="absence-form">
              <input type="hidden" name="sessionId" value={id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  name="studentId"
                  label={t('absence.student')}
                  options={members.map((r) => ({
                    value: r.studentId,
                    label: `${r.firstName} ${r.lastName}`,
                  }))}
                />
                <SelectField name="channel" label={t('absence.channel')} options={channels} />
                <Field
                  name="receivedAt"
                  type="datetime-local"
                  label={t('absence.receivedAt')}
                  hint={t('absence.receivedAtHint')}
                />
                <Field name="note" label={t('absence.note')} />
              </div>
              <div>
                <SubmitButton>{t('absence.submit')}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
