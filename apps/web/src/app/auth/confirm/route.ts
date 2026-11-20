import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const safeNext = (v: string | null) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/');

/**
 * Where Supabase's confirmation email lands: it signs the new owner in and goes on to `next` (opening the business).
 * Handles both link styles: `token_hash` + `type` (the email template) and `code` (the default PKCE link).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get('next'));
  // A password reset link (implicit flow) carries its session in the fragment, which the browser keeps across this
  // redirect: the reset screen reads it, or says the link expired.
  if (
    next === '/login/reset' &&
    !url.searchParams.get('token_hash') &&
    !url.searchParams.get('code')
  )
    return NextResponse.redirect(new URL(next, url));
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(new URL('/login?error=not_configured', url));

  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  const { error } =
    tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : code
        ? await supabase.auth.exchangeCodeForSession(code)
        : { error: new Error('missing token') };
  if (error && next === '/login/reset')
    return NextResponse.redirect(new URL('/login/reset#error=expired', url));
  return NextResponse.redirect(new URL(error ? '/login?error=confirm' : next, url));
}
