import type { ReactNode } from 'react';
import { accountState } from '@rswim/domain-platform';
import { TrialBanner } from '@/components/trial-banner';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { diveRole } from './_ui/access';
import { DiveShell } from './_ui/shell';

export default async function Layout({ children }: { children: ReactNode }) {
  const session = await requireSurface('dive');
  const role = diveRole(session);
  // The club's owner and managers see the free trial and, before the first charge, its reminder.
  const account =
    role === 'owner' || role === 'manager' ? await withSession((tx) => accountState(tx)) : null;
  return (
    <DiveShell session={session} role={role}>
      {account?.status === 'trialing' && account.trialEndsOn && !account.cancelsOn ? (
        <TrialBanner
          trialEndsOn={account.trialEndsOn}
          trialDays={account.trialDays}
          reminderDays={account.trialReminderDays}
          priceAgorot={account.priceAgorot}
          hasCard={account.hasCard}
          isOwner={session.role === 'owner'}
          planHref="/dive/plan"
        />
      ) : null}
      {children}
    </DiveShell>
  );
}
