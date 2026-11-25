import { getTranslations } from 'next-intl/server';
import { AI_LEVELS, AI_LEVEL_TENTHS } from '@rswim/contracts';
import { aiLevel, isAgentOwner } from '@rswim/domain-copilot';
import { Badge, Card, CardTitle } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { setAiLevelAction } from '@/lib/ai-level-actions';
import { withSession } from '@/lib/db';

/**
 * How strong a model answers for the business: the bot (families, leads, divers) and the owner's assistant. Three
 * levels; a stronger one answers better and uses the month's allowance faster. Only the owner sees and changes it.
 */
export async function AiLevelCard() {
  const t = await getTranslations('aiLevel');
  const current = await withSession(async (tx) =>
    (await isAgentOwner(tx)) ? await aiLevel(tx) : null,
  );
  if (!current) return null;
  return (
    <Card data-testid="ai-level" data-level={current}>
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-ink-muted">{t('hint')}</p>
      <ul className="grid gap-2 sm:grid-cols-3">
        {AI_LEVELS.map((l) => (
          <li
            key={l}
            className="flex flex-col gap-2 rounded-2xl border border-line/70 bg-surface/50 p-3"
            data-testid={`ai-level-${l}`}
          >
            <span className="flex items-center gap-2 font-semibold">
              {t(`${l}.label`)}
              {current === l ? <Badge tone="ok">{t('current')}</Badge> : null}
            </span>
            <span className="text-sm text-ink-muted">{t(`${l}.hint`)}</span>
            <span className="text-xs text-ink-muted">
              {t('stretch', { times: 10 / AI_LEVEL_TENTHS[l] })}
            </span>
            {current === l ? null : (
              <ActionButton
                action={setAiLevelAction}
                fields={{ level: l }}
                variant="secondary"
                data-testid={`ai-level-pick-${l}`}
              >
                {t('pick')}
              </ActionButton>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-muted">{t('scope')}</p>
    </Card>
  );
}
