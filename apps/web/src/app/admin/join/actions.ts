'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { asUser } from '@rswim/db';
import { toDomainError } from '@rswim/domain-core';
import {
  acceptJoinRequest,
  DecideJoinRequest,
  declineJoinRequest,
  joinRequestUser,
  ListingInput,
  updateListing,
} from '@rswim/domain-platform';
import { getSession } from '@/lib/auth/session';
import { afterJoin, db, dbFor, withSession } from '@/lib/db';
import type { FormState } from '@/lib/form-state';

const PATH = '/admin/join';

async function failed(e: unknown): Promise<FormState> {
  const de = toDomainError(e);
  if (!de) throw e;
  const t = await getTranslations();
  return {
    ok: false,
    errors: {},
    message: t.has(de.code) ? t(de.code) : t('forms.errors.invalid'),
  };
}

/** The office takes the family: it is created (or the known family is used) and the parent gets the app. */
export async function acceptJoinRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const input = DecideJoinRequest.safeParse({ id: fd.get('id') });
  if (!input.success) return failed(new Error('invalid'));
  let who: { orgId: string; userId: string | null };
  try {
    who = await withSession(async (tx, ctx) => {
      const userId = await joinRequestUser(tx, input.data.id);
      await acceptJoinRequest(tx, input.data.id);
      return { orgId: ctx.orgId, userId };
    });
  } catch (e) {
    return failed(e);
  }
  // A school with its own database: the platform learns the new parent at once (their next sign-in carries it).
  if (who.userId) await afterJoin(await dbFor(who.orgId), who.orgId, who.userId);
  revalidatePath(PATH);
  return { ok: true, errors: {}, message: null };
}

export async function declineJoinRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const input = DecideJoinRequest.safeParse({ id: fd.get('id') });
  if (!input.success) return failed(new Error('invalid'));
  try {
    await withSession((tx) => declineJoinRequest(tx, input.data.id));
  } catch (e) {
    return failed(e);
  }
  revalidatePath(PATH);
  return { ok: true, errors: {}, message: null };
}

/**
 * Whether the school shows in the app's school search, its city and a line about it. The platform's database holds
 * the school's row (a school with its own database gets a copy right after).
 */
export async function saveListingAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session?.orgId) redirect('/login');
  const orgId = session.orgId;
  const raw = Object.fromEntries(
    [...fd.entries()].filter(([k, v]) => !k.startsWith('$') && v !== ''),
  );
  const input = ListingInput.safeParse(raw);
  const t = await getTranslations();
  if (!input.success) return { ok: false, errors: {}, message: t('forms.errors.invalid') };
  try {
    await asUser(db(), { sub: session.userId, org_id: orgId }, (tx) =>
      updateListing(tx, { orgId, userId: session.userId }, input.data),
    );
  } catch (e) {
    return failed(e);
  }
  revalidatePath(PATH);
  return { ok: true, errors: {}, message: t('schools.admin.saved') };
}
