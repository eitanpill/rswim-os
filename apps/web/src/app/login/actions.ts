'use server';

import { PhoneE164 } from '@rswim/contracts';
import { redirect } from 'next/navigation';
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

export async function sendPhoneCode(formData: FormData) {
  const phone = PhoneE164.safeParse(String(formData.get('phone') ?? ''));
  if (!phone.success) redirect('/login/phone?error=phone');
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect('/login/phone?error=not_configured');
  // shouldCreateUser: false — parents get an account when the school adds them, not by typing a number.
  const { error } = await supabase.auth.signInWithOtp({
    phone: phone.data,
    options: { shouldCreateUser: false },
  });
  if (error) redirect('/login/phone?error=phone');
  redirect(`/login/phone?phone=${encodeURIComponent(phone.data)}`);
}

export async function verifyPhoneCode(formData: FormData) {
  const phone = PhoneE164.safeParse(String(formData.get('phone') ?? ''));
  const token = String(formData.get('code') ?? '').trim();
  if (!phone.success) redirect('/login/phone?error=phone');
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect('/login/phone?error=not_configured');
  const { error } = await supabase.auth.verifyOtp({ phone: phone.data, token, type: 'sms' });
  if (error) redirect(`/login/phone?phone=${encodeURIComponent(phone.data)}&error=code`);
  redirect('/');
}
