import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { mySubscription } from '@rswim/domain-platform';
import { Card, PageHeader } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { ActionForm, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';
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
  const next = session.vertical === 'freediving' ? '/dive' : '/admin/onboarding';
  if (session.role !== 'owner') redirect(next);
  const { card } = await searchParams;
  const t = await getTranslations('platform.billing');
  const s = await withSession((tx) => mySubscription(tx));
  if (!s) redirect(next);
  // The first charge is the day after the trial's last day.
  const firstCharge = s.sub.trialEndsOn
    ? new Date(Date.parse(`${s.sub.trialEndsOn}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : null;
  const saved = card === 'saved' || !!s.sub.cardLast4;
  return (
    <AppShell session={session} surface="onboarding" nav={[]}>
      <PageHeader title={saved ? t('setup.savedTitle') : t('setup.title')} />
      <Card data-testid="card-step">
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
              <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-danger">
                {t('card.failedToast')}
              </p>
            ) : null}
            <p>{t('setup.body')}</p>
            {firstCharge ? <p>{t('setup.when', { date: dmy(firstCharge) })}</p> : null}
            <p className="text-sm text-ink-muted">{t('setup.cancelAnytime')}</p>
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
