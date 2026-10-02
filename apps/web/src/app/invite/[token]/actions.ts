'use server';

import { getTranslations } from 'next-intl/server';
import { asUser, sql } from '@rswim/db';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import type { FormState } from '@/lib/form-state';

/**
 * Accepts a staff invite as the signed-in user. The user has no membership yet, so this runs with the user id only;
 * the SECURITY DEFINER function checks the token, expiry and that the invite was sent to this email or phone.
 */
export async function acceptInviteAction(token: string, _: FormState): Promise<FormState> {
  const t = await getTranslations('invite');
  const session = await getSession();
  if (!session) return { ok: false, errors: {}, message: t('signInFirst') };
  try {
    await asUser(db(), { sub: session.userId, org_id: null }, (tx) =>
      tx.execute(sql`select public.accept_staff_invite(${token})`),
    );
  } catch (e) {
    const code =
      (e as { cause?: { code?: string }; code?: string }).cause?.code ??
      (e as { code?: string }).code;
    if (code === '22023') return { ok: false, errors: {}, message: t('invalid') };
    if (code === '42501') return { ok: false, errors: {}, message: t('wrongPerson') };
    throw e;
  }
  return { ok: true, errors: {}, message: t('accepted'), savedAt: Date.now() };
}
