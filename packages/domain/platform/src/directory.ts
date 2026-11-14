/**
 * Finding a school (store launch, stage 4). A family finds its school by the link or QR the school shares, by the
 * app's search, or because the school already has their phone on file ("we found you"). A swim school's office
 * receives join and trial requests and decides them; a freediving club takes divers directly (domain-dive signup).
 * The database functions (migration 0057) hold every check; these are thin, typed wrappers.
 */
import { z } from 'zod';
import {
  JOIN_REQUEST_MAX_CHILDREN,
  toE164IL,
  type JoinRequestKind,
  type JoinRequestStatus,
  type Vertical,
} from '@rswim/contracts';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}

const vertical = (v: unknown): Vertical => (v === 'freediving' ? 'freediving' : 'swim');
const SLUG = /^[a-z0-9-]{2,60}$/;

// ─── The school search and a school's public page ───────────────────────────

export interface DirectoryEntry {
  slug: string;
  name: string;
  vertical: Vertical;
  city: string | null;
  about: string | null;
}

/** Listed schools matching a name or city (empty: all of them). Works signed out; runs on the platform database. */
export async function schoolDirectory(
  tx: Tx,
  q: string,
  only?: Vertical,
): Promise<DirectoryEntry[]> {
  const list = await rows<{
    slug: string;
    name: string;
    vertical: string;
    city: string | null;
    about: string | null;
  }>(tx, sql`select * from public.school_directory(${q.slice(0, 60) || null}, ${only ?? null})`);
  return list.map((r) => ({ ...r, vertical: vertical(r.vertical) }));
}

export interface PublicSchool {
  id: string;
  name: string;
  vertical: Vertical;
  city: string | null;
  about: string | null;
}

/** What anyone may know about a school by its link (null: no such active school). */
export async function schoolPublic(tx: Tx, slug: string): Promise<PublicSchool | null> {
  if (!SLUG.test(slug)) return null;
  const [r] = await rows<{ j: (Omit<PublicSchool, 'vertical'> & { vertical: string }) | null }>(
    tx,
    sql`select public.school_public(${slug}) as j`,
  );
  return r?.j ? { ...r.j, vertical: vertical(r.j.vertical) } : null;
}

// ─── Join and trial requests ────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'forms.errors.date');
const phone = z.string({ error: 'join.errors.phone' }).transform((v, c) => {
  const e164 = toE164IL(v);
  if (!e164) {
    c.addIssue({ code: 'custom', message: 'join.errors.phone' });
    return z.NEVER;
  }
  return e164;
});
const childFields = Object.fromEntries(
  Array.from({ length: JOIN_REQUEST_MAX_CHILDREN }, (_, i) => [
    [`child${i + 1}Name`, z.string().trim().max(40).optional()],
    [`child${i + 1}Dob`, isoDate.optional()],
  ]).flat(),
) as Record<string, z.ZodOptional<z.ZodString>>;

/** The join form: the parent, up to four children (a row per child), join or trial, and a note. */
export const JoinRequestInput = z
  .object({
    slug: z.string().regex(SLUG),
    kind: z.enum(['join', 'trial']),
    firstName: z.string().trim().min(1, 'join.errors.name').max(60),
    lastName: z.string().trim().min(1, 'join.errors.name').max(60),
    phone,
    email: z.email('forms.errors.email').optional(),
    note: z.string().trim().max(500).optional(),
    ...childFields,
  })
  .strict();
export type JoinRequestData = z.output<typeof JoinRequestInput>;

/** The children the form names, in order; a date without a name is a mistake the person should see. */
export function childrenOf(input: JoinRequestData): { firstName: string; dob: string | null }[] {
  const kids: { firstName: string; dob: string | null }[] = [];
  const data = input as Record<string, string | undefined>;
  for (let i = 1; i <= JOIN_REQUEST_MAX_CHILDREN; i++) {
    const name = data[`child${i}Name`]?.trim();
    const dob = data[`child${i}Dob`] ?? null;
    if (!name && dob) throw new DomainError('join.errors.childName');
    if (name) kids.push({ firstName: name, dob });
  }
  return kids;
}

/** The signed-in person asks a swim school to take their family (or for a trial). Returns the request. */
export async function requestToJoin(tx: Tx, input: JoinRequestData): Promise<string> {
  const kids = childrenOf(input);
  const [r] = await guarded(() =>
    rows<{ id: string }>(
      tx,
      sql`select public.request_to_join(${input.slug}, ${input.kind}, ${input.firstName}, ${input.lastName},
                                        ${input.phone}, ${input.email ?? null}, ${JSON.stringify(kids)}::jsonb,
                                        ${input.note ?? null}) as id`,
    ),
  );
  return (r as { id: string }).id;
}

export interface MyJoinRequest {
  id: string;
  orgId: string;
  schoolName: string;
  kind: JoinRequestKind;
  status: JoinRequestStatus;
  createdAt: string;
}

/** The person's own requests in this database, newest first. */
export async function myJoinRequests(tx: Tx): Promise<MyJoinRequest[]> {
  const list = await rows<{
    id: string;
    organization_id: string;
    organization_name: string;
    kind: JoinRequestKind;
    status: JoinRequestStatus;
    created_at: string | Date;
  }>(tx, sql`select * from public.my_join_requests()`);
  return list.map((r) => ({
    id: r.id,
    orgId: r.organization_id,
    schoolName: r.organization_name,
    kind: r.kind,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export interface JoinRequestRow {
  id: string;
  kind: JoinRequestKind;
  status: JoinRequestStatus;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  children: { firstName: string; dob: string | null }[];
  note: string | null;
  createdAt: Date;
  handledAt: Date | null;
}

/** The office's list: open requests first (oldest first), then the last decided ones. */
export async function listJoinRequests(tx: Tx): Promise<JoinRequestRow[]> {
  const j = schema.joinRequests;
  const cols = {
    id: j.id,
    kind: j.kind,
    status: j.status,
    firstName: j.firstName,
    lastName: j.lastName,
    phone: j.phoneE164,
    email: j.email,
    children: j.children,
    note: j.note,
    createdAt: j.createdAt,
    handledAt: j.handledAt,
  };
  const [open, done] = await Promise.all([
    tx.select(cols).from(j).where(eq(j.status, 'new')).orderBy(j.createdAt),
    tx
      .select(cols)
      .from(j)
      .where(and(inArray(j.status, ['accepted', 'declined'])))
      .orderBy(desc(j.handledAt))
      .limit(10),
  ]);
  return [...open, ...done].map((r) => ({
    ...r,
    kind: r.kind as JoinRequestKind,
    status: r.status as JoinRequestStatus,
    children: (r.children ?? []) as JoinRequestRow['children'],
  }));
}

export const DecideJoinRequest = z.object({ id: z.uuid() }).strict();

/** The office takes the family (an existing family when the phone is already on file). Returns the family contact. */
export async function acceptJoinRequest(tx: Tx, id: string): Promise<string> {
  const [r] = await guarded(() =>
    rows<{ g: string }>(tx, sql`select public.accept_join_request(${id}::uuid) as g`),
  );
  return (r as { g: string }).g;
}

export async function declineJoinRequest(tx: Tx, id: string): Promise<void> {
  await guarded(() => tx.execute(sql`select public.decline_join_request(${id}::uuid)`));
}

/** Who asked (the office accepts as itself; the web layer needs the person to sync a school's own database). */
export async function joinRequestUser(tx: Tx, id: string): Promise<string | null> {
  const [r] = await tx
    .select({ userId: schema.joinRequests.userId })
    .from(schema.joinRequests)
    .where(eq(schema.joinRequests.id, id));
  return r?.userId ?? null;
}

// ─── "We found you" ─────────────────────────────────────────────────────────

export interface PhoneMatch {
  orgId: string;
  name: string;
  vertical: Vertical;
}

/** Schools that have the signed-in person's phone on a family nobody holds yet. */
export async function myPhoneMatches(tx: Tx): Promise<PhoneMatch[]> {
  const list = await rows<{ organization_id: string; organization_name: string; vertical: string }>(
    tx,
    sql`select * from public.my_phone_matches()`,
  );
  return list.map((r) => ({
    orgId: r.organization_id,
    name: r.organization_name,
    vertical: vertical(r.vertical),
  }));
}

export const ClaimByPhoneInput = z.object({ orgId: z.uuid() }).strict();

/** "Yes, that's me": the person joins that family. */
export async function claimByPhone(tx: Tx, orgId: string): Promise<string> {
  const [r] = await guarded(() =>
    rows<{ o: string }>(tx, sql`select public.claim_by_phone(${orgId}::uuid) as o`),
  );
  return (r as { o: string }).o;
}

// ─── The school's listing ───────────────────────────────────────────────────

export interface Listing {
  slug: string;
  listed: boolean;
  city: string | null;
  about: string | null;
}

export async function getListing(tx: Tx, ctx: ServiceContext): Promise<Listing | null> {
  const o = schema.organizations;
  const [r] = await tx
    .select({ slug: o.slug, listed: o.listed, city: o.city, about: o.about })
    .from(o)
    .where(eq(o.id, ctx.orgId));
  return r ?? null;
}

export const ListingInput = z
  .object({
    listed: z.literal('on').optional(),
    city: z.string().trim().max(60).optional(),
    about: z.string().trim().max(400).optional(),
  })
  .strict();

/** Whether the school appears in the app's search, and what it says there. Runs on the platform database. */
export async function updateListing(
  tx: Tx,
  ctx: ServiceContext,
  input: z.output<typeof ListingInput>,
): Promise<void> {
  const o = schema.organizations;
  const done = await guarded(() =>
    tx
      .update(o)
      .set({ listed: input.listed === 'on', city: input.city || null, about: input.about || null })
      .where(eq(o.id, ctx.orgId))
      .returning({ id: o.id }),
  );
  if (done.length === 0) throw new DomainError('common.errors.forbidden');
}
