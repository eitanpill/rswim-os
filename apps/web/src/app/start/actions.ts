'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ACCOUNT_PERSONAS } from '@rswim/db/personas';
import { toDomainError } from '@rswim/domain-core';
import { claimByPhone, ClaimByPhoneInput } from '@rswim/domain-platform';
import {
  DEV_COOKIE,
  devCookieValue,
  devSessionFor,
  FAMILY_FINDERS,
  isPersonaKey,
} from '@/lib/auth/dev';
import { homePath } from '@/lib/auth/routing';
import { getSession } from '@/lib/auth/session';
import { afterJoin, dbFor, prepareJoin, withSignedIn } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import { joinPathFromLink } from '@/lib/join-link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** The link a school sent, pasted in: open the place it leads to inside the app. */
export async function openSchoolLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  const path = joinPathFromLink(String(fd.get('link') ?? ''));
  if (!path) {
    const t = await getTranslations('start.link');
    return { ok: false, errors: { link: t('invalid') }, message: null };
  }
  redirect(path);
}

/**
 * "Yes, that's me": the person joins the family their school has on file with their phone, and lands in the school.
 * The database checks the phone again.
 */
export async function claimFamilyAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations();
  const input = ClaimByPhoneInput.safeParse({ orgId: fd.get('orgId') });
  if (!input.success) return { ok: false, errors: {}, message: t('common.errors.forbidden') };
  const orgId = input.data.orgId;
  try {
    const target = await dbFor(orgId);
    await prepareJoin(target, session.userId);
    await withSignedIn((tx) => claimByPhone(tx, orgId), { database: target });
    await afterJoin(target, orgId, session.userId);
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return {
      ok: false,
      errors: {},
      message: t.has(de.code) ? t(de.code) : t('forms.errors.invalid'),
    };
  }

  if (session.mode === 'dev') {
    const key = Object.entries(ACCOUNT_PERSONAS).find(([, p]) => p.userId === session.userId)?.[0];
    if (!isPersonaKey(key) || !FAMILY_FINDERS.has(key)) redirect('/');
    (await cookies()).set(DEV_COOKIE, devCookieValue(key, orgId), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    redirect(homePath(devSessionFor(key, orgId)));
  }
  await (await createSupabaseServerClient())?.auth.refreshSession();
  const next = await getSession();
  redirect(next ? homePath(next) : '/login');
}
