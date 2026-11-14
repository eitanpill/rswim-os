import 'server-only';
import { redirect } from 'next/navigation';
import { requireSurface } from '@/lib/auth/session';
import type { Session } from '@/lib/auth/types';

/** The club's screens, and who opens each. The database (RLS) is the real gate; this keeps people on their own page. */
export type DivePage =
  'owner' | 'manager' | 'office' | 'instructor' | 'me' | 'divers' | 'forms' | 'payments' | 'plan';

export type DiveRole = 'owner' | 'manager' | 'office' | 'instructor' | 'customer';

export function diveRole(s: Session): DiveRole {
  if (s.role === 'owner') return 'owner';
  if (s.role === 'admin') return s.permissions.includes('settings.write') ? 'manager' : 'office';
  if (s.role === 'instructor') return 'instructor';
  return 'customer';
}

const PAGES: Record<DiveRole, DivePage[]> = {
  owner: ['owner', 'manager', 'office', 'instructor', 'divers', 'forms', 'payments', 'plan'],
  manager: ['manager', 'office', 'instructor', 'divers', 'forms'],
  office: ['office', 'divers', 'forms'],
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

/**
 * The role's tabs. Settings screens (the processor connection, the club's own subscription) open from their own
 * links, not a tab.
 */
export function pagesFor(role: DiveRole): DivePage[] {
  return PAGES[role].filter((p) => p !== 'payments' && p !== 'plan');
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

/** Who may change the texts of the club's forms (the database checks `settings.write` too). */
export const canEditForms = (role: DiveRole) => role === 'owner' || role === 'manager';
/** Who records signatures at the desk and clears health declarations. */
export const isOffice = (role: DiveRole) =>
  role === 'owner' || role === 'manager' || role === 'office';
