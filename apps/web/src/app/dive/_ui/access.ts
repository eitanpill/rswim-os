import 'server-only';
import { redirect } from 'next/navigation';
import { requireSurface } from '@/lib/auth/session';
import type { Session } from '@/lib/auth/types';

/** The club's screens, and who opens each. The database (RLS) is the real gate; this keeps people on their own page. */
export type DivePage = 'owner' | 'manager' | 'office' | 'instructor' | 'me' | 'divers';

export type DiveRole = 'owner' | 'manager' | 'office' | 'instructor' | 'customer';

export function diveRole(s: Session): DiveRole {
  if (s.role === 'owner') return 'owner';
  if (s.role === 'admin') return s.permissions.includes('settings.write') ? 'manager' : 'office';
  if (s.role === 'instructor') return 'instructor';
  return 'customer';
}

const PAGES: Record<DiveRole, DivePage[]> = {
  owner: ['owner', 'manager', 'office', 'instructor', 'divers'],
  manager: ['manager', 'office', 'instructor', 'divers'],
  office: ['office', 'divers'],
  instructor: ['instructor', 'divers'],
  customer: ['me'],
};

export const HOME: Record<DiveRole, DivePage> = {
  owner: 'owner',
  manager: 'manager',
  office: 'office',
  instructor: 'instructor',
  customer: 'me',
};

export function pagesFor(role: DiveRole): DivePage[] {
  return PAGES[role];
}

/** Guard for one club page: signed in to a freediving club, and this page is one of the role's. */
export async function requireDivePage(
  page: DivePage,
): Promise<{ session: Session; role: DiveRole }> {
  const session = await requireSurface('dive');
  const role = diveRole(session);
  if (!PAGES[role].includes(page)) redirect(`/dive/${HOME[role]}`);
  return { session, role };
}
