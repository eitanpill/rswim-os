import type { ReactNode } from 'react';
import { requireSurface } from '@/lib/auth/session';
import { diveRole } from './_ui/access';
import { DiveShell } from './_ui/shell';

export default async function Layout({ children }: { children: ReactNode }) {
  const session = await requireSurface('dive');
  return (
    <DiveShell session={session} role={diveRole(session)}>
      {children}
    </DiveShell>
  );
}
