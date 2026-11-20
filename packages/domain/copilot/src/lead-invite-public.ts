/**
 * Reading a personal invite by its token alone (the link does not name the business): across tenants on the owner
 * connection, before anything runs as that business. Only what the invite page shows leaves here.
 */
import { and, eq, schema, type Db } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { DomainError } from '@rswim/domain-core';
import { INVITE_TOKEN, markInviteUsed, prepareInviteFamily } from './lead-invite';

const { leads, organizations } = schema;

export interface InviteView {
  orgId: string;
  slug: string;
  vertical: string;
  firstName: string | null;
  phoneE164: string;
  state: 'open' | 'expired' | 'used';
}

export async function inviteByToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<InviteView | null> {
  if (!INVITE_TOKEN.test(token)) return null;
  const [row] = await asPlatform(db, (tx) =>
    tx
      .select({
        orgId: leads.organizationId,
        slug: organizations.slug,
        vertical: organizations.vertical,
        name: leads.name,
        phone: leads.phoneE164,
        until: leads.inviteExpiresAt,
        used: leads.inviteUsedAt,
      })
      .from(leads)
      .innerJoin(organizations, eq(organizations.id, leads.organizationId))
      .where(and(eq(leads.inviteToken, token), eq(organizations.status, 'active'))),
  );
  if (!row?.phone) return null;
  return {
    orgId: row.orgId,
    slug: row.slug,
    vertical: row.vertical,
    firstName: row.name?.trim().split(/\s+/)[0] ?? null,
    phoneE164: row.phone,
    state: row.used ? 'used' : !row.until || row.until <= now ? 'expired' : 'open',
  };
}

/**
 * The person signed in with the invite's phone: their family is made ready in the business (as its system role), so
 * the database's own phone check (`claim_by_phone`) lets them join it next. Another phone is refused here.
 */
export async function openInviteFamily(
  db: Db,
  token: string,
  signedInPhone: string | null,
): Promise<{ orgId: string; leadId: string }> {
  const invite = await inviteByToken(db, token);
  if (!invite) throw new DomainError('leadInvite.errors.unknown');
  if (invite.state !== 'open') throw new DomainError('leadInvite.errors.expired');
  if (!signedInPhone || signedInPhone !== invite.phoneE164)
    throw new DomainError('leadInvite.errors.otherPhone');
  const r = await withOrg(db, invite.orgId, (tx) =>
    prepareInviteFamily(tx, { orgId: invite.orgId, userId: null }, token),
  );
  return { orgId: invite.orgId, leadId: r.leadId };
}

/** After they joined: the invite is used up (as the business's system role). */
export async function closeInvite(db: Db, orgId: string, leadId: string): Promise<void> {
  await withOrg(db, orgId, (tx) => markInviteUsed(tx, leadId));
}
