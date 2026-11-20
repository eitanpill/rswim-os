'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ACCOUNT_PERSONAS } from '@rswim/db/personas';
import { toDomainError } from '@rswim/domain-core';
import { closeInvite, inviteByToken, openInviteFamily } from '@rswim/domain-copilot';
import { claimByPhone, myPhone } from '@rswim/domain-platform';
import { DEV_COOKIE, devCookieValue, devSessionFor, isPersonaKey } from '@/lib/auth/dev';
import { homePath } from '@/lib/auth/routing';
import { getSession } from '@/lib/auth/session';
import { acrossSchools, afterJoin, dbFor, prepareJoin, withSignedIn } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * "Enter": the person signed in with the invite's phone joins the business at once. A swim school: the family the bot
 * opened (or one opened now) becomes theirs, through the database's own phone check. A freediving club: on to the
 * club's sign-up, where the diver's details are filled in.
 */
export async function joinByInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations();
  const token = String(fd.get('token') ?? '');
  const fail = (code: string): FormState => ({
    ok: false,
    errors: {},
    message: t.has(code) ? t(code) : t('forms.errors.invalid'),
  });
  const invite = await acrossSchools(
    (d) => inviteByToken(d, token),
    (r) => r === null,
  );
  if (!invite) return fail('leadInvite.errors.unknown');
  const target = await dbFor(invite.orgId);
  try {
    const phone = await withSignedIn((tx) => myPhone(tx));
    const opened = await openInviteFamily(target, token, phone);
    if (invite.vertical !== 'swim') {
      await closeInvite(target, invite.orgId, opened.leadId);
      redirect(`/join/${invite.slug}`);
    }
    await prepareJoin(target, session.userId);
    await withSignedIn((tx) => claimByPhone(tx, invite.orgId), { database: target });
    await closeInvite(target, invite.orgId, opened.leadId);
    await afterJoin(target, invite.orgId, session.userId);
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return fail(de.code);
  }
  if (session.mode === 'dev') {
    const key = Object.entries(ACCOUNT_PERSONAS).find(([, p]) => p.userId === session.userId)?.[0];
    if (!isPersonaKey(key)) redirect('/');
    (await cookies()).set(DEV_COOKIE, devCookieValue(key, invite.orgId), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    redirect(homePath(devSessionFor(key, invite.orgId)));
  }
  await (await createSupabaseServerClient())?.auth.refreshSession();
  const next = await getSession();
  redirect(next ? homePath(next) : '/login');
}
