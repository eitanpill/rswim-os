import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { sessionFromClaims } from './lib/auth/claims';
import { DEV_COOKIE, readDevCookie } from './lib/auth/dev';
import { decideRoute } from './lib/auth/routing';
import type { Session } from './lib/auth/types';
import { isNativeApp } from './lib/native-app';
import { supabaseEnv } from './lib/supabase/env';
import { sessionCookieOptions, sessionTooOld } from './lib/supabase/session-policy';

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
      // Long-lived, httpOnly cookies written again on every refresh: people stay signed in until they sign out.
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    // Verifies the access token, and when it has expired silently trades the refresh token for a new pair (the new
    // cookies go out on this response). A dead refresh token (signed out elsewhere, password changed) clears them.
    const { data } = await supabase.auth.getClaims();
    if (data?.claims && sessionTooOld(data.claims)) {
      // The hard ceiling (lib/supabase/session-policy.ts): end this device's session once and ask for a sign-in.
      await supabase.auth.signOut({ scope: 'local' });
      session = null;
    } else {
      session = data?.claims ? sessionFromClaims(data.claims) : null;
    }
  }

  const decision = decideRoute(request.nextUrl.pathname, session, {
    nativeApp: isNativeApp(request.headers.get('user-agent')),
  });
  if (decision.action === 'redirect') {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|fonts/|\\.well-known/).*)',
  ],
};
