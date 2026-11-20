'use server';

import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import type { FormState } from '@/lib/form-state';
import { supabaseEnv } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const Email = z.string().trim().toLowerCase().email().max(200);
const Password = z.string().min(8).max(72);

/** This host, so the link in the email comes back to where the person asked for it (staging, production, a school's domain). */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * "Forgot my password": Supabase emails a link that signs the person in for one password change. The link uses the
 * implicit flow (the session arrives in the link itself), so it works in whichever browser opens it: someone who asked
 * in the store app usually opens the email in Safari, which never saw the app's cookies. It goes through
 * /auth/confirm, the redirect address Supabase already allows, which passes it on to /login/reset. The answer is the
 * same whether or not the email has an account, so the form can't be used to find out who has one.
 */
export async function sendResetLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  const t = await getTranslations('login.forgot');
  const email = Email.safeParse(fd.get('email') ?? '');
  if (!email.success) return { ok: false, errors: { email: t('errors.email') }, message: null };
  const env = supabaseEnv();
  if (!env) return { ok: false, errors: {}, message: t('errors.notConfigured') };
  const supabase = createClient(env.url, env.anonKey, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await origin()}/auth/confirm?next=/login/reset`,
  });
  if (error) {
    const tooSoon = error.status === 429 || /rate|seconds|security purposes/i.test(error.message);
    return { ok: false, errors: {}, message: t(tooSoon ? 'errors.tooSoon' : 'errors.failed') };
  }
  return { ok: true, errors: {}, message: t('sent'), savedAt: Date.now() };
}

/**
 * Sets the new password. The reset screen passes on the session that arrived in the link (`access_token` and
 * `refresh_token`, read from the address's fragment in the browser); a link that was already turned into a session
 * cookie (a template that uses a token hash) needs none. Then the person is signed in and goes home.
 */
export async function setNewPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const t = await getTranslations('login.reset');
  const password = Password.safeParse(fd.get('password') ?? '');
  if (!password.success)
    return { ok: false, errors: { password: t('errors.password') }, message: null };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, errors: {}, message: t('errors.expired') };
  const access = fd.get('access_token');
  const refresh = fd.get('refresh_token');
  if (typeof access === 'string' && access && typeof refresh === 'string' && refresh) {
    const { error } = await supabase.auth.setSession({
      access_token: access,
      refresh_token: refresh,
    });
    if (error) return { ok: false, errors: {}, message: t('errors.expired') };
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, errors: {}, message: t('errors.expired') };
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) {
    const same = error.code === 'same_password' || /different from the old/i.test(error.message);
    return same
      ? { ok: false, errors: { password: t('errors.same') }, message: null }
      : { ok: false, errors: {}, message: t('errors.failed') };
  }
  redirect('/');
}
