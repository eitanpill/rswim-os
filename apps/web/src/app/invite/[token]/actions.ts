'use server';

import { getTranslations } from 'next-intl/server';
import { asUser, sql } from '@rswim/db';
import { acrossSchools, afterJoin, db, prepareJoin } from '@/lib/db';
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
  // The invite lives with the school's data: in its own database when it has one.
  let target = db();
  await acrossSchools(
    async (d) => {
      const r = await d.transaction((tx) =>
        tx.execute(
          sql`select 1 from staff_invites where token_hash = encode(sha256(convert_to(${token}, 'UTF8')), 'hex')`,
        ),
      );
      if (r.rows.length) target = d;
      return r.rows.length > 0;
    },
    (hit) => !hit,
  );
  try {
    await prepareJoin(target, session.userId);
    const orgId = await asUser(target, { sub: session.userId, org_id: null }, async (tx) => {
      const r = await tx.execute<{ org: string }>(sql`select public.accept_staff_invite(${token}) as org`);
      return r.rows[0]!.org;
    });
    await afterJoin(target, orgId, session.userId);
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
