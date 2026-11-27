import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { accountState } from '@rswim/domain-platform';
import { AppShell } from '@/components/app-shell';
import { TrialBanner } from '@/components/trial-banner';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { inNativeApp } from '@/lib/native-app-server';
import { dmy } from '@/lib/options';
import { adminNav } from './nav';
import { PlanView } from './plan/plan-view';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSurface('admin');
  const account = await withSession((tx) => accountState(tx));
  const t = await getTranslations('platform.account');
  // In the store app the subscription is neither shown nor managed (store stage 8): no billing banners, and a
  // suspended office sees a plain notice instead of the plan page.
  const app = await inNativeApp();
  return (
    <AppShell session={session} surface="admin" nav={await adminNav()}>
      {app ? null : account.status === 'past_due' ? (
        <p
          role="alert"
          data-testid="past-due-banner"
          className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger-ink"
        >
          {t('pastDue')}{' '}
          <Link href="/admin/plan" className="font-medium underline">
            {t('toPlan')}
          </Link>
        </p>
      ) : null}
      {app ? null : account.cancelsOn && account.status !== 'cancelled' ? (
        <p data-testid="cancelling-banner" className="mb-4 rounded-xl bg-warn/20 px-3 py-2 text-sm">
          {t('cancelling', { date: dmy(account.cancelsOn) })}{' '}
          <Link href="/admin/plan" className="font-medium underline">
            {t('toPlan')}
          </Link>
        </p>
      ) : account.status === 'trialing' && account.trialEndsOn ? (
        <TrialBanner
          trialEndsOn={account.trialEndsOn}
          trialDays={account.trialDays}
          reminderDays={account.trialReminderDays}
          priceAgorot={account.priceAgorot}
          hasCard={account.hasCard}
          isOwner={session.role === 'owner'}
          planHref="/admin/plan"
        />
      ) : null}
      {/* A suspended school's office sees only its plan page; parents and staff keep working. */}
      {account.locked ? (
        app ? (
          <p
            role="alert"
            data-testid="locked-in-app"
            className="rounded-xl bg-warn/20 px-3 py-2 text-sm"
          >
            {t('lockedInApp')}
          </p>
        ) : (
          <PlanView locked />
        )
      ) : (
        children
      )}
    </AppShell>
  );
}
