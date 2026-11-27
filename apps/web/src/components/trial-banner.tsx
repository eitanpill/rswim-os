import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';
import { agorot } from '@rswim/money';
import { trialTimeline } from '@rswim/domain-platform';
import { Money } from '@rswim/ui';
import { inNativeApp } from '@/lib/native-app-server';
import { dmy, todayIL } from '@/lib/options';

/**
 * The trial on every office screen: the free days left and, in the reminder days before the first charge, a bright
 * reminder with the date and the amount.
 */
export async function TrialBanner({
  trialEndsOn,
  trialDays,
  reminderDays,
  priceAgorot,
  hasCard,
  isOwner,
  planHref,
}: {
  trialEndsOn: string;
  trialDays: number;
  reminderDays: number;
  priceAgorot: number | null;
  hasCard: boolean;
  isOwner: boolean;
  planHref: string;
}) {
  // The store app never shows the subscription (its price, the card, the plan): store stage 8.
  if (await inNativeApp()) return null;
  const t = await getTranslations('platform.trial');
  const tAccount = await getTranslations('platform.account');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const tl = trialTimeline(trialEndsOn, todayIL(), reminderDays);
  const used = Math.min(
    100,
    Math.max(0, ((trialDays - tl.daysLeft) / Math.max(1, trialDays)) * 100),
  );
  return (
    <div
      data-testid="trial-banner"
      data-reminding={tl.reminding}
      role={tl.reminding ? 'status' : undefined}
      className={
        tl.reminding
          ? 'aqua-pulse mb-4 rounded-xl border border-warn bg-warn/20 px-3 py-2 text-sm'
          : 'mb-4 rounded-xl bg-brand-50 px-3 py-2 text-sm'
      }
    >
      <p>
        {tl.reminding ? (
          <>
            <span aria-hidden="true">🔔 </span>
            <strong>{t('reminderTitle', { days: tl.daysLeft })}</strong>{' '}
            {hasCard && priceAgorot !== null ? (
              <>
                {t('reminderCharge', { date: dmy(tl.firstChargeOn) })}{' '}
                <Money agorot={agorot(priceAgorot)} locale={locale} />.
              </>
            ) : (
              t('reminderNoCard', { date: dmy(tl.firstChargeOn) })
            )}
          </>
        ) : (
          <>
            {tAccount('trial', { date: dmy(trialEndsOn) })} {t('daysLeft', { days: tl.daysLeft })}{' '}
            {hasCard ? null : tAccount('trialNoCardShort')}
          </>
        )}{' '}
        {isOwner && !hasCard ? (
          <Link href="/billing/card" className="font-medium underline" data-testid="trial-add-card">
            {tAccount('addCard')}
          </Link>
        ) : null}{' '}
        {tl.reminding && isOwner ? (
          <Link href={planHref} className="font-medium underline" data-testid="trial-to-plan">
            {t('changeOrCancel')}
          </Link>
        ) : null}
      </p>
      {tl.reminding ? null : (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100" aria-hidden="true">
          <div className="h-full rounded-full bg-brand-500" style={{ inlineSize: `${used}%` }} />
        </div>
      )}
    </div>
  );
}
