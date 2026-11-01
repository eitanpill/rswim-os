'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCOUNT_PERSONAS } from '@rswim/db/personas';
import { JoinClubInput, joinClub } from '@rswim/domain-dive';
import { DEV_COOKIE, devCookieValue } from '@/lib/auth/dev';
import { getSession } from '@/lib/auth/session';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const dropEmpty = (raw: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));

/**
 * The signed-in visitor joins the club as a diver, the session switches into the club, and they land on their first
 * steps.
 */
export async function joinClubAction(_: FormState, fd: FormData): Promise<FormState> {
  let orgId = '';
  const state = await runForm(
    fd,
    JoinClubInput,
    async (tx, _ctx, input) => (orgId = await joinClub(tx, input)),
    { scope: 'user' },
    dropEmpty,
  );
  if (!state.ok) return state;

  const session = await getSession();
  if (!session) redirect('/login');
  if (session.mode === 'dev') {
    // Only the demo diver-to-be can hold a club it joined; other demo personas keep their own place.
    if (session.userId !== ACCOUNT_PERSONAS.diveNewcomer.userId) redirect('/');
    (await cookies()).set(DEV_COOKIE, devCookieValue('diveNewcomer', orgId), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
  } else {
    // The database set the user's active club; a fresh token carries it.
    await (await createSupabaseServerClient())?.auth.refreshSession();
  }
  redirect('/dive/me/welcome');
}
