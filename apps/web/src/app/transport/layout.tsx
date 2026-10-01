import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { requireSurface } from '@/lib/auth/session';

export default async function Layout({ children }: { children: ReactNode }) {
  const session = await requireSurface('transport');
  return (
    <AppShell session={session} surface="transport" nav={[]}>
      {children}
    </AppShell>
  );
}
