import { explainer } from '@/lib/billing';
import { dmy } from '@/lib/options';

/** Badge tone of each action status, shared by the brain's screens and the bot screen. */
export const ACTION_TONE = {
  proposed: 'warn',
  confirmed: 'ok',
  failed: 'danger',
  dismissed: 'neutral',
  undone: 'neutral',
} as const;

/** An action's summary in words: built from looked-up names, its dates shown as day.month.year. */
export async function agentSummaryText() {
  const explain = await explainer();
  return (s: { code: string; params: Record<string, string | number> }) => {
    const p = { ...s.params };
    for (const k of ['date', 'until'] as const)
      if (typeof p[k] === 'string') p[k] = dmy(p[k] as string);
    return explain({ code: s.code, params: p });
  };
}
