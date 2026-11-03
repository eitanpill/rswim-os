import { getTranslations } from 'next-intl/server';
import { undoable, type AgentActionRow } from '@rswim/domain-copilot';
import { Badge } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { explainer } from '@/lib/billing';
import { dmy } from '@/lib/options';
import {
  approveAgentActionAction,
  dismissAgentActionAction,
  undoAgentActionAction,
} from './actions';

const TONE = {
  proposed: 'warn',
  confirmed: 'ok',
  failed: 'danger',
  dismissed: 'neutral',
  undone: 'neutral',
} as const;

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
  const summary = (a: AgentActionRow) => {
    const p = { ...a.summary.params };
    if (typeof p.date === 'string') p.date = dmy(p.date);
    return explain({ code: a.summary.code, params: p });
  };
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
                <Badge tone={TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
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
                    fields={{ id: a.id }}
                    variant="ghost"
                    data-testid="agent-dismiss"
                  >
                    {t('dismiss')}
                  </ActionButton>
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
