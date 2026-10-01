import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { getSession } from '@/lib/auth/session';

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session?.isPlatformAdmin) redirect('/');
  return (
    <AppShell session={session} surface="platform" nav={[]}>
      {children}
    </AppShell>
  );
}
