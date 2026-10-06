import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { icons } from '@/components/icons';
import { getSession } from '@/lib/auth/session';

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session?.isPlatformAdmin) redirect('/');
  const t = await getTranslations('platform.nav');
  return (
    <AppShell
      session={{ ...session, orgId: null, orgName: t('console') }}
      surface="platform"
      nav={[
        { href: '/platform', label: t('schools'), icon: icons.families, exact: true },
        { href: '/platform/templates', label: t('templates'), icon: icons.file },
      ]}
    >
      {children}
    </AppShell>
  );
}
