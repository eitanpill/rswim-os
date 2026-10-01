import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { requireSurface } from '@/lib/auth/session';
import { adminNav } from './nav';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSurface('admin');
  return (
    <AppShell session={session} surface="admin" nav={await adminNav()}>
      {children}
    </AppShell>
  );
}
