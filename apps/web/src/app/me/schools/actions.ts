'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCOUNT_PERSONAS, TWO_HATS_ROLES } from '@rswim/db/personas';
import { mySchools, switchSchool } from '@rswim/domain-platform';
import {
  DEV_COOKIE,
  devCookieValue,
  devSessionFor,
  FAMILY_FINDERS,
  isPersonaKey,
  type DevKey,
} from '@/lib/auth/dev';
import { homePath } from '@/lib/auth/routing';
import { getSession } from '@/lib/auth/session';
import { withSignedIn } from '@/lib/db';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The person picks which of their schools to work in. The database checks the membership and remembers the pick;
 * a fresh token carries it, and they land on that school's home screen for their role there.
 */
export async function switchSchoolAction(fd: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect('/login');
  const orgId = String(fd.get('orgId') ?? '');
  if (session.mode === 'dev') {
    // In the demo: the two-hats persona between its two schools, and a parent who found a school in the app into
    // the school that took them (the database says which).
    const key = (await devKeyFor(session.userId, orgId)) ?? redirect('/');
    (await cookies()).set(DEV_COOKIE, devCookieValue(key, orgId), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    redirect(homePath(devSessionFor(key, orgId)));
  }
  await withSignedIn((tx) => switchSchool(tx, orgId));
  await (await createSupabaseServerClient())?.auth.refreshSession();
  const next = await getSession();
  redirect(next ? homePath(next) : '/login');
}

async function devKeyFor(userId: string, orgId: string): Promise<DevKey | null> {
  if (userId === ACCOUNT_PERSONAS.twoHats.userId) return orgId in TWO_HATS_ROLES ? 'twoHats' : null;
  const key = Object.entries(ACCOUNT_PERSONAS).find(([, p]) => p.userId === userId)?.[0];
  if (!isPersonaKey(key) || !FAMILY_FINDERS.has(key)) return null;
  const schools = await withSignedIn((tx) => mySchools(tx));
  return schools.some((s) => s.orgId === orgId && s.role === 'parent') ? key : null;
}
