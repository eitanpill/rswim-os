import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { sessionFromClaims } from './lib/auth/claims';
import { DEV_COOKIE, readDevCookie } from './lib/auth/dev';
import { decideRoute } from './lib/auth/routing';
import type { Session } from './lib/auth/types';
import { supabaseEnv } from './lib/supabase/env';

/**
 * Refreshes the Supabase session cookie and enforces which roles may open which surface.
 * Pages re-check with requireSurface(); the database enforces RLS regardless.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  let session: Session | null = readDevCookie(request.cookies.get(DEV_COOKIE)?.value);

  const env = supabaseEnv();
  if (!session && env) {
    const supabase = createServerClient(env.url, env.anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    session = data?.claims ? sessionFromClaims(data.claims) : null;
  }

  const decision = decideRoute(request.nextUrl.pathname, session);
  if (decision.action === 'redirect') {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|fonts/).*)',
  ],
};
