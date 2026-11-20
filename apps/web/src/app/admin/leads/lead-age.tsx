import { getTranslations } from 'next-intl/server';
import type { LeadAttention } from '@rswim/domain-crm';
import { Badge } from '@rswim/ui';

/** How long ago the lead last wrote (or was opened), red when the office owes it something. */
export async function LeadAge({ at, attention }: { at: Date; attention: LeadAttention }) {
  const t = await getTranslations('leads');
  const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000));
  const label =
    minutes < 60
      ? t('ago.minutes', { n: minutes })
      : minutes < 48 * 60
        ? t('ago.hours', { n: Math.round(minutes / 60) })
        : t('ago.days', { n: Math.round(minutes / 1440) });
  return <Badge tone={attention ? 'warn' : 'neutral'}>{label}</Badge>;
}
