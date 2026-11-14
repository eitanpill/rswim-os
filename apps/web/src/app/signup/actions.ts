'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { sql } from '@rswim/db';
import { DEV_COOKIE, isDevAuthEnabled, signupCookieValue } from '@/lib/auth/dev';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SignupInput } from './schema';

const formToObject = (fd: FormData) =>
  Object.fromEntries(
    [...fd.entries()].filter((e): e is [string, string] => typeof e[1] === 'string'),
  );

/** Where the confirmation link brings the new owner back: this host, then on to opening the business. */
async function confirmUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}/auth/confirm?next=/onboarding`;
}

/**
 * Creates a business owner's account. With Supabase: an email + password sign-up, confirmed by the link Supabase
 * emails (the page then says to check the inbox). Without Supabase, where persona sign-in is allowed (local runs,
 * E2E, the live demo): a real row in auth.users and a stand-in session cookie, so the rest of the way (opening the
 * business) runs on the real code. Either way the next stop is /onboarding.
 */
export async function signUpAction(_: FormState, fd: FormData): Promise<FormState> {
  const t = await getTranslations();
  const parsed = SignupInput.safeParse(formToObject(fd));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0] ?? '_')] ??= t(issue.message);
    return { ok: false, errors, message: t('forms.fixErrors') };
  }
  const input = parsed.data;
  if (await getSession()) redirect('/');

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { full_name: input.name }, emailRedirectTo: await confirmUrl() },
    });
    if (error) {
      const taken = /already|registered|exists/i.test(error.message);
      return {
        ok: false,
        errors: taken ? { email: t('account.signup.errors.taken') } : {},
        message: taken ? t('forms.fixErrors') : t('account.signup.errors.failed'),
      };
    }
    // Email confirmation on (production): the account waits for the link. Off: signed in already.
    if (!data.session) redirect(`/signup?sent=${encodeURIComponent(input.email)}`);
    redirect('/onboarding');
  }

  if (!isDevAuthEnabled()) {
    return { ok: false, errors: {}, message: t('account.signup.errors.notConfigured') };
  }
  const { rows } = await db().execute<{ id: string }>(
    sql`insert into auth.users (email, raw_user_meta_data)
        values (${input.email}, ${JSON.stringify({ full_name: input.name })}::jsonb)
        on conflict (email) do nothing returning id`,
  );
  const id = rows[0]?.id;
  if (!id) {
    return {
      ok: false,
      errors: { email: t('account.signup.errors.taken') },
      message: t('forms.fixErrors'),
    };
  }
  (await cookies()).set(DEV_COOKIE, signupCookieValue(id), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });
  redirect('/onboarding');
}
