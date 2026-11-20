import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { mySubscription, trialTimeline } from '@rswim/domain-platform';
import { Card } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { AquaHero, SignupSteps } from '@/components/aqua-hero';
import { ActionForm, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { TrialPromise } from '@/components/trial-promise';
import { dmy, todayIL } from '@/lib/options';
import { startCardAction } from '../actions';

/**
 * Sign-up's last step: the owner saves the card the subscription is paid with after the trial (not charged now).
 * Saving it can wait: the trial banner and the plan screen keep offering it.
 */
export default async function CardStepPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const session = await getSession();
  if (!session?.orgId) redirect('/');
  const next = session.vertical === 'freediving' ? '/dive/setup' : '/admin/onboarding';
  if (session.role !== 'owner') redirect(next);
  const { card } = await searchParams;
  const t = await getTranslations('platform.billing');
  const tSignup = await getTranslations('platform.signup');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const s = await withSession((tx) => mySubscription(tx));
  if (!s) redirect(next);
  // The first charge is the day after the trial's last day.
  const firstCharge = s.sub.trialEndsOn
    ? new Date(Date.parse(`${s.sub.trialEndsOn}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : null;
  const saved = card === 'saved' || !!s.sub.cardLast4;
  const timeline =
    s.sub.status === 'trialing' && s.sub.trialEndsOn
      ? trialTimeline(s.sub.trialEndsOn, todayIL(), s.plan.trialReminderDays)
      : null;
  return (
    <AppShell session={session} surface="onboarding" nav={[]}>
      <AquaHero
        icon={saved ? '🎉' : '💳'}
        title={saved ? t('setup.savedTitle') : t('setup.title')}
        subtitle={saved ? undefined : t('setup.heroSubtitle')}
      >
        <SignupSteps current={3} labels={tSignup.raw('steps') as [string, string, string]} />
      </AquaHero>
      <Card className="aqua-in" data-testid="card-step">
        {saved ? (
          <div className="flex flex-col gap-3">
            <p data-testid="card-step-saved">
              {s.sub.cardLast4 ? t('card.saved', { last4: s.sub.cardLast4 }) : t('card.savedToast')}
            </p>
            <div>
              <Link
                href={next}
                className="inline-flex min-h-tap items-center rounded-xl bg-brand-600 px-4 font-semibold text-white"
                data-testid="card-step-continue"
              >
                {t('setup.continue')}
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {card === 'failed' ? (
              <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-danger-ink">
                {t('card.failedToast')}
              </p>
            ) : null}
            <p>{t('setup.body')}</p>
            {timeline ? (
              <TrialPromise
                days={s.plan.trialDays}
                timeline={timeline}
                priceAgorot={s.plan.priceAgorot}
                locale={locale}
              />
            ) : null}
            {firstCharge ? <p>{t('setup.when', { date: dmy(firstCharge) })}</p> : null}
            <p className="text-sm text-ink-muted">{t('card.safe')}</p>
            <ActionForm action={startCardAction}>
              <input type="hidden" name="back" value="/billing/card" />
              <div className="flex flex-wrap items-center gap-4">
                <SubmitButton data-testid="card-step-start">{t('setup.submit')}</SubmitButton>
                <Link
                  href={next}
                  className="text-ink-muted underline"
                  data-testid="card-step-later"
                >
                  {t('setup.later')}
                </Link>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
