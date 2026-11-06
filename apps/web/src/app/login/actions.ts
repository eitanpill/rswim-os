'use server';

import { PhoneE164 } from '@rswim/contracts';
import { clubForJoin } from '@rswim/domain-dive';
import { redirect } from 'next/navigation';
import { dbForSlug, withAnon } from '@/lib/db';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const safeNext = (v: FormDataEntryValue | null) =>
  typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : '/';

export async function signInWithPassword(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect('/login?error=not_configured');
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });
  if (error) redirect('/login?error=invalid');
  redirect(safeNext(formData.get('next')));
}

/**
 * The club a visitor came to join (the `join` field carries its slug from the join page), only while that club takes
 * sign-ups; otherwise null.
 */
async function joiningClub(v: FormDataEntryValue | null): Promise<string | null> {
  if (typeof v !== 'string' || !/^[a-z0-9-]{2,60}$/.test(v)) return null;
  const club = await withAnon((tx) => clubForJoin(tx, v), await dbForSlug(v));
  return club?.open ? v : null;
}

const phonePage = (params: Record<string, string | null>) =>
  `/login/phone?${new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== null),
  ).toString()}`;

export async function sendPhoneCode(formData: FormData) {
  const join = await joiningClub(formData.get('join'));
  const phone = PhoneE164.safeParse(String(formData.get('phone') ?? ''));
  if (!phone.success) redirect(phonePage({ error: 'phone', join }));
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(phonePage({ error: 'not_configured', join }));
  // Parents get an account when the school adds them, not by typing a number. The one exception is a freediving
  // club's join link, while that club takes sign-ups: there the number becomes a new account.
  const { error } = await supabase.auth.signInWithOtp({
    phone: phone.data,
    options: { shouldCreateUser: join !== null },
  });
  if (error) redirect(phonePage({ error: 'phone', join }));
  redirect(phonePage({ phone: phone.data, join }));
}

export async function verifyPhoneCode(formData: FormData) {
  const join = await joiningClub(formData.get('join'));
  const phone = PhoneE164.safeParse(String(formData.get('phone') ?? ''));
  const token = String(formData.get('code') ?? '').trim();
  if (!phone.success) redirect(phonePage({ error: 'phone', join }));
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(phonePage({ error: 'not_configured', join }));
  const { error } = await supabase.auth.verifyOtp({ phone: phone.data, token, type: 'sms' });
  if (error) redirect(phonePage({ phone: phone.data, error: 'code', join }));
  redirect(join ? `/join/${join}` : '/');
}
