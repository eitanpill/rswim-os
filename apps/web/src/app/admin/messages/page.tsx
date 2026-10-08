import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listInbox } from '@rswim/domain-comms';
import { Badge, Card, EmptyState, PageHeader, cn } from '@rswim/ui';
import { ActionButton, ActionForm, SubmitButton, TextareaField } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { approveActionAction, replyAction, resolveInboundAction } from './actions';
import { MessagesTabs, when } from './tabs';

type Lesson = {
  sessionId: string;
  studentId: string;
  date: string;
  time: string;
  groupName: string;
};

/**
 * The inbox (brief §6.12): every WhatsApp message with what it is about, the draft action ready for one tap, and a
 * reply box. Complaints and cancellations are marked for a person; nothing here answers by itself.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const status = show === 'closed' ? 'closed' : 'open';
  const t = await getTranslations('comms');
  const label = await enumLabel();
  const items = await withSession((tx) => listInbox(tx, { status }));
  return (
    <>
      <PageHeader title={t('inbox.title')} />
      <MessagesTabs active="inbox" />
      <div className="mb-3 flex gap-2 text-sm">
        {(['open', 'closed'] as const).map((s) => (
          <Link
            key={s}
            href={s === 'open' ? '/admin/messages' : '/admin/messages?show=closed'}
            aria-current={s === status ? 'page' : undefined}
            className={cn(
              'min-h-tap rounded-xl px-3 py-2',
              s === status && 'bg-brand-50 font-semibold',
            )}
          >
            {t(`inbox.${s}`)}
          </Link>
        ))}
      </div>
      {items.length === 0 ? (
        <Card>
          <EmptyState title={t('inbox.empty')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((m) => {
            const who = m.guardian
              ? `${m.guardian.firstName} ${m.guardian.lastName}`
              : m.staffMemberId
                ? t('inbox.staffSender')
                : (m.fromPhoneE164 ?? t('inbox.unknownSender'));
            const action = m.action;
            const lessons = ((action?.payload as { lessons?: Lesson[] } | null)?.lessons ?? []).map(
              (l) => ({
                ...l,
                name: m.students.find((s) => s.id === l.studentId)?.firstName ?? '',
              }),
            );
            const open = m.status === 'new' || m.status === 'needs_human';
            return (
              <li key={m.id} data-testid="inbox-item" data-intent={m.intent}>
                <Card className={cn(m.status === 'needs_human' && 'border-warn')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{who}</p>
                    <span className="text-sm text-ink-muted">{when(m.receivedAt)}</span>
                    <Badge tone={m.status === 'needs_human' ? 'warn' : 'neutral'}>
                      {label('inboundIntent', m.intent)}
                    </Badge>
                    <span className="text-xs text-ink-muted">
                      {t('inbox.confidence', { n: m.confidence })}
                    </span>
                    {m.status !== 'new' ? <Badge>{label('inboundStatus', m.status)}</Badge> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface p-3" dir="auto">
                    {m.body}
                  </p>
                  {m.bot &&
                  (m.bot.answer ?? m.bot.handoffSummary) &&
                  (m.bot.answer ?? m.bot.handoffSummary) !== m.body ? (
                    <p
                      className="mt-2 whitespace-pre-wrap text-sm text-ink-muted"
                      dir="auto"
                      data-testid="inbox-bot"
                    >
                      {t('inbox.bot', { summary: m.bot.answer ?? m.bot.handoffSummary ?? '' })}
                    </p>
                  ) : null}
                  {m.students.length > 0 ? (
                    <p className="mt-1 text-sm text-ink-muted">
                      {m.students.map((s) => s.firstName).join(', ')}
                    </p>
                  ) : null}
                  {action ? (
                    <div
                      className="mt-3 rounded-xl border border-line p-3"
                      data-testid="triage-action"
                    >
                      <p className="font-medium">{label('triageActionKind', action.kind)}</p>
                      {lessons.length > 0 ? (
                        <ul className="mt-1 text-sm">
                          {lessons.map((l) => (
                            <li key={l.sessionId + l.studentId}>
                              {l.name} · {l.groupName} · {dmy(l.date)} {l.time}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {action.status === 'pending' ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <ActionButton
                            action={approveActionAction}
                            fields={{ id: action.id }}
                            data-testid="approve-action"
                          >
                            {action.kind === 'absence_notice'
                              ? t('inbox.approveAbsence')
                              : t('inbox.approve')}
                          </ActionButton>
                        </div>
                      ) : (
                        <p className="mt-1 text-sm text-ok">{label('inboundStatus', 'actioned')}</p>
                      )}
                    </div>
                  ) : null}
                  {open ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionButton
                        action={resolveInboundAction}
                        fields={{ id: m.id, status: 'actioned' }}
                        variant="ghost"
                      >
                        {t('inbox.markDone')}
                      </ActionButton>
                      <ActionButton
                        action={resolveInboundAction}
                        fields={{ id: m.id, status: 'dismissed' }}
                        variant="ghost"
                      >
                        {t('inbox.dismiss')}
                      </ActionButton>
                      {m.householdId ? (
                        <Link
                          href={`/admin/families/${m.householdId}`}
                          className="min-h-tap px-3 py-2.5 text-sm text-brand-700 underline"
                        >
                          {t('inbox.familyCard')}
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                  {m.guardian ? (
                    <details className="mt-3">
                      <summary className="min-h-tap cursor-pointer py-2 text-sm">
                        {t('inbox.reply')}
                      </summary>
                      <ActionForm action={replyAction} resetOnSuccess>
                        <input type="hidden" name="inboundMessageId" value={m.id} />
                        <TextareaField
                          name="text"
                          label={t('inbox.reply')}
                          hint={t('inbox.replyHint')}
                        />
                        <SubmitButton>{t('inbox.send')}</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
