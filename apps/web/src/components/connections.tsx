import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { paymentConnection } from '@rswim/domain-billing';
import { commsRules } from '@rswim/domain-comms';
import { ghlSettings } from '@rswim/domain-crm';
import { hasFeature } from '@rswim/domain-platform';
import { Badge, Card, CardTitle } from '@rswim/ui';
import { AiMeter } from '@/components/ai-meter';
import { withSession } from '@/lib/db';

type State = 'connected' | 'missing' | 'failing' | 'soon' | 'on' | 'off' | 'notInPlan';
const TONE: Record<State, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  connected: 'ok',
  on: 'ok',
  missing: 'warn',
  off: 'neutral',
  failing: 'danger',
  soon: 'neutral',
  notInPlan: 'neutral',
};

interface Row {
  key: 'whatsapp' | 'payments' | 'receipts' | 'bot' | 'triage';
  state: State;
  href: string | null;
}

/**
 * Everything the business connects to, on one screen (SaaS stage 6): its WhatsApp line, its payment processor, its
 * receipts, whether the AI answers families and sorts messages, and this month's AI use. Each row says what is
 * connected or missing and links to the screen that fixes it.
 */
export async function ConnectionsView({ vertical }: { vertical: 'swim' | 'dive' }) {
  const t = await getTranslations('connections');
  const { ghl, payments, rules, botInPlan } = await withSession(async (tx, ctx) => ({
    ghl: await ghlSettings(tx, ctx.orgId),
    payments: await paymentConnection(tx),
    rules: await commsRules(tx),
    botInPlan: await hasFeature(tx, 'parent_bot'),
  }));
  const plan = vertical === 'swim' ? '/admin/plan' : '/dive/plan';
  const swim = vertical === 'swim';
  const rows: Row[] = [
    {
      key: 'whatsapp',
      state: ghl ? 'connected' : 'missing',
      href: swim ? '/admin/integrations/ghl' : null,
    },
    {
      key: 'payments',
      state: !payments
        ? 'missing'
        : payments.status === 'connected'
          ? 'connected'
          : payments.status === 'failed'
            ? 'failing'
            : 'missing',
      href: swim ? '/admin/integrations/payments' : '/dive/payments',
    },
    { key: 'receipts', state: 'soon', href: null },
    {
      key: 'bot',
      state: !botInPlan ? 'notInPlan' : rules.botEnabled ? 'on' : 'off',
      href: !botInPlan ? plan : swim ? '/admin/messages/bot' : null,
    },
    { key: 'triage', state: rules.aiTriage ? 'on' : 'off', href: swim ? '/admin/policies' : null },
  ];
  const needed = rows.filter((r) => r.key === 'whatsapp' || r.key === 'payments');
  const done = needed.filter((r) => r.state === 'connected').length;
  return (
    <div className="flex flex-col gap-4" data-testid="connections">
      <p className="text-sm" data-testid="connections-summary">
        {t('summary', { done, total: needed.length })}
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key}>
            <Card data-testid={`connection-${r.key}`} data-state={r.state}>
              <CardTitle aside={<Badge tone={TONE[r.state]}>{t(`state.${r.state}`)}</Badge>}>
                {t(`${r.key}.title`)}
              </CardTitle>
              <p className="text-sm text-ink-muted">{t(`${r.key}.${r.state}`)}</p>
              {r.href ? (
                <Link
                  href={r.href}
                  className="mt-2 inline-block text-sm text-brand-700 underline"
                  data-testid={`connection-${r.key}-link`}
                >
                  {r.state === 'notInPlan' ? t(`${r.key}.linkPlan`) : t(`${r.key}.link`)}
                </Link>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      <AiMeter />
    </div>
  );
}
