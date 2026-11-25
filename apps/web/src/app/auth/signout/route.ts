import { cookies } from 'next/headers';
import { redirectTo } from '@/lib/redirect';
import { DEV_COOKIE } from '@/lib/auth/dev';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseAuthCookie } from '@/lib/supabase/session-policy';
import { sql } from '@rswim/db';
import { getSession } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { PUSH_COOKIE } from '@/lib/native-app';

/**
 * "Sign out": ends the session on this device only (scope `local`), so signing out on the computer doesn't sign the
 * same person out of the app on their phone. Everything the sign-in left on this device goes: Supabase revokes the
 * refresh token, and every session cookie is deleted here too, even if Supabase couldn't be reached. In the store app
 * the phone's push token is forgotten in the current school.
 */
export async function POST() {
  // This phone stops getting the person's notifications (store stage 6).
  const pushToken = (await cookies()).get(PUSH_COOKIE)?.value;
  if (pushToken && (await getSession())?.orgId)
    await withSession((tx) =>
      tx.execute(sql`delete from push_devices where token = ${pushToken}`),
    ).catch(() => undefined);
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined);
  const leftovers = (await cookies())
    .getAll()
    .map((c) => c.name)
    .filter(isSupabaseAuthCookie);
  const response = redirectTo('/login', 303);
  response.cookies.delete(DEV_COOKIE);
  response.cookies.delete(PUSH_COOKIE);
  for (const name of leftovers) response.cookies.delete(name);
  return response;
}
