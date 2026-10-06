'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { asUser } from '@rswim/db';
import { ACCOUNT_PERSONAS } from '@rswim/db/personas';
import { createSchool, CreateSchoolInput, provisionSchool } from '@rswim/domain-platform';
import { DEV_COOKIE, devCookieValue } from '@/lib/auth/dev';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Opens a new school with the signed-in user as its owner, adds its defaults as that owner, switches the session
 * into it, and lands on the onboarding checklist.
 */
export async function createSchoolAction(_: FormState, fd: FormData): Promise<FormState> {
  let orgId = '';
  const state = await runForm(
    fd,
    CreateSchoolInput,
    async (tx, _ctx, input) => (orgId = await createSchool(tx, input)),
    { scope: 'user' },
  );
  if (!state.ok) return state;

  const session = await getSession();
  if (!session) redirect('/login');
  await asUser(db(), { sub: session.userId, org_id: orgId }, (tx) =>
    provisionSchool(tx, { orgId, userId: session.userId }),
  );
  if (session.mode === 'dev') {
    // Only the newcomer persona can hold a school it opened; other demo personas stay in the demo school.
    if (session.userId !== ACCOUNT_PERSONAS.newcomer.userId) redirect('/');
    (await cookies()).set(DEV_COOKIE, devCookieValue('newcomer', orgId), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
  } else {
    // The database set the user's active school; a fresh token carries it.
    await (await createSupabaseServerClient())?.auth.refreshSession();
  }
  redirect('/admin/onboarding');
}
