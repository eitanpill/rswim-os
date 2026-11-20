import type { CookieOptions } from '@supabase/ssr';

/**
 * How long someone stays signed in (web, the installed PWA and the store app alike): until they sign out themselves.
 *
 * - The session cookies live 400 days, the most a browser keeps a cookie, and are written again on every token
 *   refresh (about once an hour of use), so an active person's sign-in slides forward and never runs out.
 * - They are httpOnly: only the server reads them (the site has no browser Supabase client), so a script on the page
 *   can't steal the refresh token. Secure on https, SameSite=Lax so links from WhatsApp or email arrive signed in.
 * - A hard ceiling: a sign-in older than {@link SESSION_MAX_AGE_DAYS} days is ended once, and the person signs in again.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
export const SESSION_MAX_AGE_DAYS = 365;

export function sessionCookieOptions(
  env: Record<string, string | undefined> = process.env,
): CookieOptions {
  const local = env.NODE_ENV !== 'production' || env.RSWIM_INSECURE_COOKIES === '1';
  return {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: !local,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

/** Supabase's own session cookies (`sb-<project>-auth-token`, possibly split into `.0`, `.1`, ...). */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+|-code-verifier)?$/.test(name);
}

/**
 * When the person first signed in for this session: the earliest timestamp in the token's `amr` claim (each sign-in
 * method with the time it was used). Refreshing the token keeps it, so it marks the start of the whole session.
 */
export function signedInAt(claims: unknown): Date | null {
  if (!claims || typeof claims !== 'object') return null;
  const amr = (claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return null;
  const times = amr
    .map((m) => (m && typeof m === 'object' ? (m as { timestamp?: unknown }).timestamp : null))
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0);
  return times.length ? new Date(Math.min(...times) * 1000) : null;
}

/** True once a session has passed the hard ceiling (a token with no sign-in time never counts as too old). */
export function sessionTooOld(claims: unknown, now: Date = new Date()): boolean {
  const at = signedInAt(claims);
  if (!at) return false;
  return now.getTime() - at.getTime() > SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}
