import { getTranslations } from 'next-intl/server';
import { agorot } from '@rswim/money';
import type { TrialTimeline } from '@rswim/domain-platform';
import { Money } from '@rswim/ui';
import { dmy } from '@/lib/options';

/**
 * The free trial, said plainly before the owner commits: free days, the day of the reminder, the day of the first
 * charge, and that cancelling before then costs nothing.
 */
export async function TrialPromise({
  days,
  timeline,
  priceAgorot,
  locale,
}: {
  days: number;
  timeline: TrialTimeline;
  /** null before a plan is chosen. */
  priceAgorot: number | null;
  locale: 'he' | 'en';
}) {
  const t = await getTranslations('platform.trial');
  const reminderDays =
    (Date.parse(`${timeline.firstChargeOn}T12:00:00Z`) -
      Date.parse(`${timeline.remindFrom}T12:00:00Z`)) /
    86_400_000;
  const steps = [
    { icon: '🎉', when: t('today'), what: t('stepStart') },
    { icon: '🔔', when: dmy(timeline.remindFrom), what: t('stepRemind', { days: reminderDays }) },
    {
      icon: '💳',
      when: dmy(timeline.firstChargeOn),
      what:
        priceAgorot === null ? (
          t('stepChargePlan')
        ) : (
          <>
            {t('stepCharge')} <Money agorot={agorot(priceAgorot)} locale={locale} /> {t('perMonth')}
          </>
        ),
    },
  ];
  return (
    <section
      className="aqua-in rounded-card border border-brand-100 bg-brand-50 p-4"
      data-testid="trial-promise"
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className="aqua-shine rounded-full px-3 py-1 text-base font-bold text-on-bright">
          {t('free', { days })}
        </span>
        <span className="font-semibold">
          {t('noChargeUntil', { date: dmy(timeline.firstChargeOn) })}
        </span>
      </p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.icon}
            className="aqua-in flex items-start gap-3 rounded-xl bg-surface-raised p-3 shadow-sm"
            style={{ animationDelay: `${0.1 + i * 0.12}s` }}
          >
            <span className="text-2xl leading-none" aria-hidden="true">
              {s.icon}
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-brand-ink">{s.when}</span>
              <span className="text-sm">{s.what}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-ink-muted">{t('cancel')}</p>
    </section>
  );
}
