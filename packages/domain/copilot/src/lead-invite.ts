/**
 * The personal invite the bot sends a new customer (WhatsApp track): instead of the business's general sign-up link,
 * a link made for this person. It opens the app (or the site) on the business's page with their phone ready; after
 * the SMS code they are in the business at once, joined to the family the bot opened (or one opened now from what
 * the bot learned). Only their own phone can use it (the database checks the signed-in phone when they join), it
 * lasts INVITE_DAYS, and once used the lead shows it.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, schema, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { createHousehold, GuardianInput, HouseholdInput } from '@rswim/domain-people';

const { leads } = schema;

/** How long a personal invite works. */
export const INVITE_DAYS = 30;
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

/** The lead's personal invite token: the one still valid, or a new one (the old one stops working). */
export async function leadInviteToken(
  tx: Tx,
  leadId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const [lead] = await tx
    .select({
      phone: leads.phoneE164,
      token: leads.inviteToken,
      until: leads.inviteExpiresAt,
      used: leads.inviteUsedAt,
    })
    .from(leads)
    .where(eq(leads.id, leadId));
  if (!lead?.phone) return null;
  // A link still valid stays the same, so a second "send me the link" sends the same one.
  if (lead.token && lead.until && lead.until > now && !lead.used) return lead.token;
  const token = randomBytes(24).toString('base64url');
  await tx
    .update(leads)
    .set({
      inviteToken: token,
      inviteExpiresAt: new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60_000),
      inviteUsedAt: null,
    })
    .where(eq(leads.id, leadId));
  return token;
}

/** The invite's link on the business's public address. */
export const inviteUrl = (publicUrl: string, token: string) =>
  `${publicUrl.replace(/\/$/, '')}/i/${token}`;

/** Splits "רונית כהן" into a first and a last name; a single name is both (the office corrects it later). */
export function namesOf(name: string | null, fallback: string): { first: string; last: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? fallback;
  return { first, last: parts.slice(1).join(' ') || first };
}

/**
 * Before the person joins with an invite (as the business's system role): the family their phone joins. The one the
 * bot opened with the trial, a family the office already has with this phone, or a new one from the lead's name.
 * Returns the lead's household, or throws when the invite is unknown, expired or used.
 */
export async function prepareInviteFamily(
  tx: Tx,
  ctx: ServiceContext,
  token: string,
  now: Date = new Date(),
): Promise<{ leadId: string; householdId: string }> {
  if (!INVITE_TOKEN.test(token)) throw new DomainError('leadInvite.errors.unknown');
  const [lead] = await tx
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phoneE164,
      householdId: leads.householdId,
    })
    .from(leads)
    .where(
      and(eq(leads.inviteToken, token), gt(leads.inviteExpiresAt, now), isNull(leads.inviteUsedAt)),
    );
  if (!lead?.phone) throw new DomainError('leadInvite.errors.expired');
  const [known] = (
    await tx.execute<{ h: string }>(
      sql`select household_id h from guardians where phone_e164 = ${lead.phone}
          order by created_at limit 1`,
    )
  ).rows;
  let householdId = known?.h ?? null;
  if (!householdId) {
    const { first, last } = namesOf(lead.name, lead.phone);
    householdId = (
      await createHousehold(
        tx,
        ctx,
        HouseholdInput.parse({ displayName: lead.name ?? lead.phone }),
        GuardianInput.parse({
          firstName: first,
          lastName: last,
          phoneE164: lead.phone,
          whatsappOptIn: true,
        }),
      )
    ).householdId;
  }
  return { leadId: lead.id, householdId };
}

/** After the person joined: the invite is used up, and the lead shows when they came in. */
export async function markInviteUsed(tx: Tx, leadId: string, now: Date = new Date()) {
  await tx.update(leads).set({ inviteUsedAt: now }).where(eq(leads.id, leadId));
}
