import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { accountState } from '@rswim/domain-platform';
import { AppShell } from '@/components/app-shell';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';
import { adminNav } from './nav';
import { PlanView } from './plan/plan-view';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSurface('admin');
  const account = await withSession((tx) => accountState(tx));
  const t = await getTranslations('platform.account');
  return (
    <AppShell session={session} surface="admin" nav={await adminNav()}>
      {account.status === 'past_due' ? (
        <p
          role="alert"
          data-testid="past-due-banner"
          className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {t('pastDue')}{' '}
          <Link href="/admin/plan" className="font-medium underline">
            {t('toPlan')}
          </Link>
        </p>
      ) : null}
      {account.status === 'trialing' && account.trialEndsOn ? (
        <p
          data-testid="trial-banner"
          className="mb-4 rounded-xl bg-brand-50 px-3 py-2 text-sm dark:bg-surface"
        >
          {t('trial', { date: dmy(account.trialEndsOn) })}
        </p>
      ) : null}
      {/* A suspended school's office sees only its plan page; parents and staff keep working. */}
      {account.locked ? <PlanView locked /> : children}
    </AppShell>
  );
}
