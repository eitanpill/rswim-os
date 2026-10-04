import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { icons } from '@/components/icons';
import { requireSurface } from '@/lib/auth/session';

export default async function ParentLayout({ children }: { children: ReactNode }) {
  const session = await requireSurface('parent');
  const t = await getTranslations('parent.nav');
  const nav = [
    { href: '/parent', label: t('family'), icon: icons.families, exact: true },
    { href: '/parent/schedule', label: t('schedule'), icon: icons.calendar },
    { href: '/parent/payments', label: t('payments'), icon: icons.money },
    { href: '/parent/documents', label: t('documents'), icon: icons.file },
    { href: '/parent/pass', label: t('pass'), icon: icons.user },
  ];
  return (
    <AppShell session={session} surface="parent" nav={nav}>
      {children}
    </AppShell>
  );
}
