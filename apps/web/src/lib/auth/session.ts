import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { canEnterSurface, type Surface } from '@rswim/contracts';
import { createSupabaseServerClient } from '../supabase/server';
import { homePath } from './routing';
import { sessionFromClaims } from './claims';
import { DEV_COOKIE, readDevCookie } from './dev';
import type { Session } from './types';

export async function getSession(): Promise<Session | null> {
  const dev = readDevCookie((await cookies()).get(DEV_COOKIE)?.value);
  if (dev) return dev;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const session = data?.claims ? sessionFromClaims(data.claims) : null;
  if (session?.orgId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name, vertical')
      .eq('id', session.orgId)
      .maybeSingle();
    session.orgName = org?.name;
    session.vertical = org?.vertical === 'freediving' ? 'freediving' : 'swim';
  }
  return session;
}

/** Server-side guard for a surface's layout. Middleware already redirects; this is defense in depth. */
export async function requireSurface(surface: Surface): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.role || !canEnterSurface(session.role, surface)) redirect('/');
  // A freediving club works in its own surface; a swim school never sees it.
  if ((session.vertical === 'freediving') !== (surface === 'dive')) redirect(homePath(session));
  return session;
}
