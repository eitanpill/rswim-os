import { cookies } from 'next/headers';
import { redirectTo } from '@/lib/redirect';
import { DEV_COOKIE } from '@/lib/auth/dev';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseAuthCookie } from '@/lib/supabase/session-policy';

/**
 * "Sign out": ends the session on this device only (scope `local`), so signing out on the computer doesn't sign the
 * same person out of the app on their phone. Everything the sign-in left on this device goes: Supabase revokes the
 * refresh token, and every session cookie is deleted here too, even if Supabase couldn't be reached.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined);
  const leftovers = (await cookies())
    .getAll()
    .map((c) => c.name)
    .filter(isSupabaseAuthCookie);
  const response = redirectTo('/login', 303);
  response.cookies.delete(DEV_COOKIE);
  for (const name of leftovers) response.cookies.delete(name);
  return response;
}
