'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { asUser } from '@rswim/db';
import { toDomainError } from '@rswim/domain-core';
import { deleteMyAccount } from '@rswim/domain-platform';
import { DEV_COOKIE } from '@/lib/auth/dev';
import { getSession } from '@/lib/auth/session';
import { router } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Deletes the signed-in person's account (store launch, stage 8): in each school's own database first, then in the
 * platform's, where the sign-in itself lives. The person types the confirmation word; the database refuses the only
 * owner of a school.
 */
export async function deleteAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations();
  if (String(fd.get('confirm') ?? '').trim() !== t('account.delete.word'))
    return { ok: false, errors: { confirm: t('account.delete.wordWrong') }, message: null };

  const claims = { sub: session.userId, org_id: null };
  try {
    const [control, ...schools] = await router().all();
    for (const target of [...schools, ...(control ? [control] : [])])
      await asUser(target.db, claims, (tx) => deleteMyAccount(tx));
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return {
      ok: false,
      errors: {},
      message: t.has(de.code) ? t(de.code) : t('forms.errors.invalid'),
    };
  }

  if (session.mode === 'dev') (await cookies()).delete(DEV_COOKIE);
  else await (await createSupabaseServerClient())?.auth.signOut();
  redirect('/goodbye');
}
