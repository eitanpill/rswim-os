import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { icons } from '@/components/icons';
import { requireSurface } from '@/lib/auth/session';

export default async function InstructorLayout({ children }: { children: ReactNode }) {
  const session = await requireSurface('instructor');
  const t = await getTranslations('instructor.nav');
  const nav = [
    { href: '/instructor', label: t('day'), icon: icons.calendar, exact: true },
    { href: '/instructor/hours', label: t('hours'), icon: icons.clock },
    { href: '/instructor/swaps', label: t('swaps'), icon: icons.swap },
    { href: '/instructor/profile', label: t('profile'), icon: icons.user },
  ];
  return (
    <AppShell session={session} surface="instructor" nav={nav}>
      {children}
    </AppShell>
  );
}
