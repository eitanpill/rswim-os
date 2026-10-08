import { redirectTo } from '@/lib/redirect';
import { DEV_COOKIE } from '@/lib/auth/dev';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  const response = redirectTo('/login', 303);
  response.cookies.delete(DEV_COOKIE);
  return response;
}
