'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCOUNT_PERSONAS, TWO_HATS_ROLES } from '@rswim/db/personas';
import { switchSchool } from '@rswim/domain-platform';
import { DEV_COOKIE, devCookieValue, devSessionFor } from '@/lib/auth/dev';
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
    // Only the two-hats persona has more than one school in the demo.
    if (session.userId !== ACCOUNT_PERSONAS.twoHats.userId || !(orgId in TWO_HATS_ROLES))
      redirect('/');
    (await cookies()).set(DEV_COOKIE, devCookieValue('twoHats', orgId), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    redirect(homePath(devSessionFor('twoHats', orgId)));
  }
  await withSignedIn((tx) => switchSchool(tx, orgId));
  await (await createSupabaseServerClient())?.auth.refreshSession();
  const next = await getSession();
  redirect(next ? homePath(next) : '/login');
}
