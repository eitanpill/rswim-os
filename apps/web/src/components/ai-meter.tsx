import { getTranslations } from 'next-intl/server';
import { AI_FEATURES } from '@rswim/contracts';
import { aiAllowance, aiUsageByFeature } from '@rswim/domain-platform';
import { Badge, Card, CardTitle } from '@rswim/ui';
import { withSession } from '@/lib/db';

const TONE = { unlimited: 'neutral', ok: 'ok', warn: 'warn', over: 'danger' } as const;

/**
 * This month's AI actions against the plan's allowance (SaaS stage 6), with what each feature used. Shown to the owner
 * on the plan page, the brain page and the connections screen.
 */
export async function AiMeter() {
  const t = await getTranslations('platform.ai');
  const { budget, byFeature } = await withSession(async (tx) => ({
    budget: await aiAllowance(tx),
    byFeature: await aiUsageByFeature(tx),
  }));
  const used = AI_FEATURES.filter((f) => byFeature[f].actions > 0);
  return (
    <Card data-testid="ai-meter" data-state={budget.state}>
      <CardTitle aside={<Badge tone={TONE[budget.state]}>{t(`state.${budget.state}`)}</Badge>}>
        {t('title')}
      </CardTitle>
      <p className="text-sm tabular-nums" data-testid="ai-meter-used">
        {budget.cap === null
          ? t('usedNoCap', { used: budget.used })
          : t('usedOf', { used: budget.used, cap: budget.cap, percent: budget.percent ?? 0 })}
      </p>
      {budget.percent !== null ? (
        <div className="mt-1 h-2 rounded-full bg-line" aria-hidden>
          <div
            className={
              budget.state === 'over'
                ? 'h-2 rounded-full bg-danger'
                : budget.state === 'warn'
                  ? 'h-2 rounded-full bg-warn'
                  : 'h-2 rounded-full bg-brand-500'
            }
            style={{ width: `${budget.percent}%` }}
          />
        </div>
      ) : null}
      {budget.state === 'warn' || budget.state === 'over' ? (
        <p
          role={budget.state === 'over' ? 'alert' : 'status'}
          className={budget.state === 'over' ? 'mt-2 text-sm text-danger-ink' : 'mt-2 text-sm'}
          data-testid="ai-meter-note"
        >
          {t(`note.${budget.state}`)}
        </p>
      ) : null}
      {used.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-muted">
          {used.map((f) => (
            <li key={f} className="flex justify-between">
              <span>{t(`feature.${f}`)}</span>
              <span className="tabular-nums">{byFeature[f].actions}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">{t('nothingYet')}</p>
      )}
      <p className="mt-3 text-xs text-ink-muted">{t('hint')}</p>
    </Card>
  );
}
