import { getTranslations } from 'next-intl/server';
import { DISMISS_REASONS } from '@rswim/contracts';
import { undoable, type AgentActionRow } from '@rswim/domain-copilot';
import { Badge } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { explainer } from '@/lib/billing';
import {
  approveAgentActionAction,
  dismissAgentActionAction,
  undoAgentActionAction,
} from './actions';
import { ACTION_TONE, agentSummaryText } from './summary';

const time = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The brain's actions as cards: what it did or wants to do (built from looked-up names, never the model's words), who
 * asked, how it was decided, and the buttons that step allows (approve and dismiss while waiting, undo once done).
 */
export async function AgentActionList({ actions }: { actions: AgentActionRow[] }) {
  const t = await getTranslations('agent');
  const explain = await explainer();
  const text = await agentSummaryText();
  const summary = (a: AgentActionRow) => text(a.summary);
  return (
    <ul className="flex flex-col gap-2">
      {actions.map((a) => {
        const wait = (a.result as { waitReason?: string } | null)?.waitReason;
        return (
          <li
            key={a.id}
            className="rounded-xl border border-line p-3"
            data-testid="agent-action"
            data-status={a.status}
            data-kind={a.kind}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="text-sm">{summary(a)}</span>
              <span className="flex flex-wrap gap-1">
                {a.ranAlone ? <Badge tone="neutral">{t('ranAlone')}</Badge> : null}
                <Badge tone={ACTION_TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
                {a.dismissReason ? (
                  <Badge tone="neutral">{t(`dismissReasons.${a.dismissReason}`)}</Badge>
                ) : null}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {a.ref !== null ? <span data-testid="agent-ref">#{a.ref} · </span> : null}
              {t(`source.${a.source}`)} · {time.format(a.createdAt)}
              {a.prompt ? ` · "${a.prompt}"` : ''}
            </p>
            {a.status === 'proposed' && wait ? (
              <p className="mt-1 text-xs text-ink-muted" data-testid="agent-wait-reason">
                {t(`wait.${wait}`)}
              </p>
            ) : null}
            {a.errorCode ? (
              <p className="mt-1 text-sm text-danger">
                {explain({
                  code: a.errorCode,
                  params: (a.result as { params?: object } | null)?.params ?? {},
                })}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {a.status === 'proposed' ? (
                <>
                  <ActionButton
                    action={approveAgentActionAction}
                    fields={{ id: a.id }}
                    data-testid="agent-approve"
                  >
                    {t('approve')}
                  </ActionButton>
                  <ActionButton
                    action={dismissAgentActionAction}
                    fields={{ id: a.id, reason: 'not_now' }}
                    variant="ghost"
                    data-testid="agent-dismiss"
                  >
                    {t('dismiss')}
                  </ActionButton>
                  {/* Why she drops it, in one tap: the brain learns from it (stage 6). */}
                  {DISMISS_REASONS.filter(
                    (r) => r !== 'not_now' && (r !== 'too_small' || a.kind === 'payment_link'),
                  ).map((r) => (
                    <ActionButton
                      key={r}
                      action={dismissAgentActionAction}
                      fields={{ id: a.id, reason: r }}
                      variant="ghost"
                      data-testid={`agent-dismiss-${r}`}
                    >
                      {t(`dismissReasons.${r}`)}
                    </ActionButton>
                  ))}
                </>
              ) : null}
              {a.status === 'confirmed' && undoable(a.kind) ? (
                <ActionButton
                  action={undoAgentActionAction}
                  fields={{ id: a.id }}
                  variant="secondary"
                  confirm={t('undoConfirm')}
                  data-testid="agent-undo"
                >
                  {t('undo')}
                </ActionButton>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
