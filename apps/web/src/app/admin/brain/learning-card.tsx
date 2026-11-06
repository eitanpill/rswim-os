import { getTranslations } from 'next-intl/server';
import { AGENT_ACTION_KINDS } from '@rswim/contracts';
import { MIN_LINK_AGOROT, type LearningState } from '@rswim/domain-copilot';
import { Card, CardTitle } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { acceptLearningAction, declineLearningAction } from './actions';

/**
 * What the brain learned about how the owner works (docs/AI-BRAIN.md, stage 6): its suggestions, each with the
 * evidence and two buttons (it never changes a level behind her back), the payment links it stopped proposing, and her
 * decisions per kind that it learned from.
 */
export async function LearningCard({ learning }: { learning: LearningState }) {
  const t = await getTranslations('agent');
  const counted = AGENT_ACTION_KINDS.filter((k) => {
    const s = learning.stats[k];
    return s.approved + s.against + s.neutral + s.alone > 0;
  });
  return (
    <Card data-testid="brain-learning">
      <CardTitle>{t('learning.title')}</CardTitle>
      <p className="mb-3 text-sm text-ink-muted">
        {t('learning.hint', { days: learning.windowDays })}
      </p>
      {learning.suggestions.length ? (
        <ul className="flex flex-col gap-2">
          {learning.suggestions.map((s) => (
            <li
              key={s.kind}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
              data-testid="learning-suggestion"
              data-kind={s.kind}
              data-to={s.to}
            >
              <span className="min-w-0 flex-1 text-sm">
                {t(`learning.${s.why}`, {
                  kind: t(`kinds.${s.kind}.label`),
                  count: s.count,
                  of: s.of,
                  to: t(`levels.${s.to}.label`),
                })}
              </span>
              <span className="flex flex-wrap gap-2">
                <ActionButton
                  action={acceptLearningAction}
                  fields={{ kind: s.kind }}
                  data-testid="learning-accept"
                >
                  {t('learning.accept')}
                </ActionButton>
                <ActionButton
                  action={declineLearningAction}
                  fields={{ kind: s.kind }}
                  variant="ghost"
                  data-testid="learning-decline"
                >
                  {t('learning.decline')}
                </ActionButton>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="learning-empty">
          {t('learning.empty')}
        </p>
      )}
      {learning.minLinkAgorot > MIN_LINK_AGOROT ? (
        <p className="mt-3 text-sm" data-testid="learning-min-link">
          {t('learning.minLink', { amount: Math.ceil(learning.minLinkAgorot / 100) })}
        </p>
      ) : null}
      {counted.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-muted">{t('learning.statsTitle')}</summary>
          <ul className="mt-2 flex flex-col gap-1" data-testid="learning-stats">
            {counted.map((k) => {
              const s = learning.stats[k];
              return (
                <li key={k}>
                  <strong>{t(`kinds.${k}.label`)}</strong>:{' '}
                  {t('learning.stats', {
                    approved: s.approved,
                    against: s.against,
                    neutral: s.neutral,
                    alone: s.alone,
                    undone: s.undone,
                  })}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
