'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { asUser } from '@rswim/db';
import { ACCOUNT_PERSONAS } from '@rswim/db/personas';
import { createSchool, CreateSchoolInput, provisionSchool } from '@rswim/domain-platform';
import { DEV_COOKIE, devCookieValue, signupCookieValue, signupUserId } from '@/lib/auth/dev';
import { getSession } from '@/lib/auth/session';
import { db, router } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Opens a new school with the signed-in user as its owner, adds its defaults as that owner, switches the session
 * into it, and lands on the onboarding checklist.
 */
export async function createSchoolAction(_: FormState, fd: FormData): Promise<FormState> {
  let orgId = '';
  const vertical = fd.get('vertical') === 'freediving' ? 'freediving' : 'swim';
  const state = await runForm(
    fd,
    CreateSchoolInput,
    async (tx, _ctx, input) => (orgId = await createSchool(tx, input)),
    { scope: 'user' },
  );
  if (!state.ok) return state;

  const session = await getSession();
  if (!session) redirect('/login');
  // A school that gets its own database has its defaults added there, once the worker has made it.
  if (!(await router().isDedicated(orgId))) {
    await asUser(db(), { sub: session.userId, org_id: orgId }, (tx) =>
      provisionSchool(tx, { orgId, userId: session.userId }),
    );
  }
  if (session.mode === 'dev') {
    // Only the newcomer persona and a fake sign-up can hold a business they opened; other demo personas stay in the
    // demo school.
    const jar = await cookies();
    const signedUp = signupUserId(jar.get(DEV_COOKIE)?.value) === session.userId;
    if (!signedUp && session.userId !== ACCOUNT_PERSONAS.newcomer.userId) redirect('/');
    const value = signedUp
      ? signupCookieValue(session.userId, orgId, vertical)
      : devCookieValue('newcomer', orgId, vertical);
    jar.set(DEV_COOKIE, value, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
  } else {
    // The database set the user's active school; a fresh token carries it.
    await (await createSupabaseServerClient())?.auth.refreshSession();
  }
  // A freediving club works in /dive from its first minute; a swim school starts on its setup checklist.
  redirect(vertical === 'freediving' ? '/dive' : '/admin/onboarding');
}
