/**
 * Joining a club on its own: a visitor opens the club's join link, signs in with their phone, fills in their details
 * and becomes a diver of the club (the database creates the household, the diver and the customer membership). Then
 * a short list of first steps: their contact for emergencies, their certification card, the forms and a first dive.
 * The club checks every uploaded card; a verified card lifts the diver's level on their file.
 */
import { z } from 'zod';
import {
  DIVE_CERT_AGENCIES,
  DIVE_LEVELS,
  toE164IL,
  type DiveCertAgency,
  type DiveCertStatus,
  type DiveFormKind,
} from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import {
  welcomeSteps,
  type PaperworkState,
  type WelcomeStep,
  type WelcomeStepState,
} from '../policies';
import { diverPaperwork } from './forms';
import { guarded, loadRules, myDiverId, one, rows } from './shared';

const id = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'forms.errors.date');
/** An Israeli phone as typed ("050-1234567"), stored as E.164. Empty fields arrive unset (the forms drop them). */
const phone = z.string({ error: 'dive.errors.joinPhone' }).transform((v, c) => {
  const e164 = toE164IL(v);
  if (!e164) {
    c.addIssue({ code: 'custom', message: 'dive.errors.joinPhone' });
    return z.NEVER;
  }
  return e164;
});

// ─── The join link ──────────────────────────────────────────────────────────

export interface PublicClub {
  id: string;
  name: string;
  open: boolean;
}

/** What a visitor may know about a club by its link (null: no such freediving club). Works signed out. */
export async function clubForJoin(tx: Tx, slug: string): Promise<PublicClub | null> {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const r = await one<{ j: PublicClub | null }>(
    tx,
    sql`select public.dive_club_public(${slug}) as j`,
  );
  return r?.j ?? null;
}

export const JoinClubInput = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
    firstName: z.string().trim().min(1, 'dive.errors.joinName').max(60),
    lastName: z.string().trim().min(1, 'dive.errors.joinName').max(60),
    phone,
    email: z.email('forms.errors.email').optional(),
    dob: isoDate.optional(),
    emergencyName: z.string().trim().max(80).optional(),
    emergencyPhone: phone.optional(),
    beginner: z.literal('on').optional(),
    agree: z.literal('on', { error: 'dive.errors.mustAgree' }),
  })
  .strict();
export type JoinClubData = z.output<typeof JoinClubInput>;

/**
 * The signed-in person joins the club as a diver (signed in without a club claim). Returns the club's id; joining
 * again returns it too, without creating anything.
 */
export async function joinClub(tx: Tx, input: JoinClubData): Promise<string> {
  const r = await guarded(() =>
    one<{ id: string }>(
      tx,
      sql`select public.dive_join_club(${input.slug}, ${input.firstName}, ${input.lastName}, ${input.phone},
                                       ${input.email ?? null}, ${input.dob ?? null}::date,
                                       ${input.emergencyName ?? null}, ${input.emergencyPhone ?? null},
                                       ${input.beginner === 'on'}) as id`,
    ),
  );
  return (r as { id: string }).id;
}

// ─── The diver's own details ────────────────────────────────────────────────

export const MyDetailsInput = z
  .object({
    emergencyName: z.string().trim().min(2, 'dive.errors.emergency').max(80),
    emergencyPhone: phone,
    email: z.email('forms.errors.email').optional(),
  })
  .strict();

/** A diver updates who to call in an emergency and their email (the database lets a customer change only these). */
export async function updateMyDetails(
  tx: Tx,
  input: z.output<typeof MyDetailsInput>,
): Promise<void> {
  const diverId = await myDiverId(tx);
  if (!diverId) throw new DomainError('dive.errors.noDiver');
  await guarded(() =>
    tx.execute(
      sql`update dive_divers set emergency_name = ${input.emergencyName},
                                 emergency_phone = ${input.emergencyPhone},
                                 email = coalesce(${input.email ?? null}, email)
          where id = ${diverId}`,
    ),
  );
}

// ─── Certification cards ────────────────────────────────────────────────────

export const CertInput = z
  .object({
    diverId: id.optional(),
    agency: z.enum(DIVE_CERT_AGENCIES, { error: 'dive.errors.certAgency' }),
    level: z.coerce
      .number()
      .int()
      .refine(
        (n) => (DIVE_LEVELS as readonly number[]).includes(n) && n > 0,
        'dive.errors.certLevel',
      ),
    name: z.string().trim().min(2, 'dive.errors.certName').max(80),
    number: z.string().trim().max(60).optional(),
    issuedOn: isoDate.optional(),
    /** The desk saw the card itself: record it as verified. */
    verified: z.literal('on').optional(),
    fileId: id.optional(),
  })
  .strict();
export type CertData = z.output<typeof CertInput>;

export interface CertCard {
  id: string;
  diverId: string;
  agency: DiveCertAgency;
  level: number;
  name: string;
  number: string | null;
  issuedOn: string | null;
  fileId: string | null;
  status: DiveCertStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/**
 * Adds a certification card: a diver uploads their own (waits for the club), the desk records one for the diver it
 * names (verified on the spot when it saw the card). Emits `dive.cert_submitted`.
 */
export async function submitCert(tx: Tx, ctx: ServiceContext, input: CertData): Promise<CertCard> {
  const diverId = input.diverId ?? (await myDiverId(tx));
  if (!diverId) throw new DomainError('dive.errors.noDiver');
  const status = input.diverId && input.verified === 'on' ? 'verified' : 'pending';
  const card = (await guarded(() =>
    one<CertCard>(
      tx,
      sql`insert into dive_certifications (organization_id, diver_id, agency, level, name, number, issued_on,
                                           file_id, status)
          values (${ctx.orgId}, ${diverId}, ${input.agency}, ${input.level}, ${input.name}, ${input.number ?? null},
                  ${input.issuedOn ?? null}::date, ${input.fileId ?? null}, ${status})
          returning ${CERT_COLUMNS}`,
    ),
  )) as CertCard;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'dive.cert_submitted',
    payload: { certId: card.id, diverId, status: card.status },
    idempotencyKey: `dive.cert_submitted:${card.id}`,
  });
  return card;
}

const CERT_COLUMNS = sql`id, diver_id as "diverId", agency, level, name, number, issued_on::text as "issuedOn",
  file_id as "fileId", status, review_note as "reviewNote", created_at as "createdAt", reviewed_at as "reviewedAt"`;

export const CertReviewInput = z
  .object({
    certId: id,
    decision: z.enum(['verified', 'rejected']),
    level: z.coerce.number().int().min(0).max(5).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/** The office verifies (possibly correcting the level) or rejects a card that waits for it. */
export async function reviewCert(
  tx: Tx,
  ctx: ServiceContext,
  input: z.output<typeof CertReviewInput>,
): Promise<void> {
  const done = await guarded(() =>
    rows<{ diverId: string }>(
      tx,
      sql`update dive_certifications set status = ${input.decision},
                                         level = coalesce(${input.level ?? null}::smallint, level),
                                         review_note = ${input.note ?? null}
          where id = ${input.certId} returning diver_id as "diverId"`,
    ),
  );
  if (done.length === 0) throw new DomainError('common.errors.notFound');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'dive.cert_reviewed',
    payload: { certId: input.certId, diverId: done[0]?.diverId, decision: input.decision },
    idempotencyKey: `dive.cert_reviewed:${input.certId}`,
  });
}

/** A diver's cards, newest first. RLS limits a customer to their own. */
export function diverCerts(tx: Tx, diverId: string): Promise<CertCard[]> {
  return rows<CertCard>(
    tx,
    sql`select ${CERT_COLUMNS} from dive_certifications where diver_id = ${diverId} order by created_at desc`,
  );
}

export interface PendingCert extends CertCard {
  diverName: string;
  /** The level on the diver's file today. */
  currentLevel: number;
  nextOn: string | null;
}

/** Cards waiting for the club, oldest first, with who uploaded them and when they dive next. */
export function pendingCerts(tx: Tx): Promise<PendingCert[]> {
  return rows<PendingCert>(
    tx,
    sql`select c.id, c.diver_id as "diverId", c.agency, c.level, c.name, c.number, c.issued_on::text as "issuedOn",
               c.file_id as "fileId", c.status, c.review_note as "reviewNote", c.created_at as "createdAt",
               c.reviewed_at as "reviewedAt", d.first_name || ' ' || d.last_name as "diverName",
               d.cert_level as "currentLevel",
               (select min((x.starts_at at time zone 'Asia/Jerusalem')::date)::text from dive_bookings b
                join dive_sessions x on x.id = b.session_id
                where b.diver_id = d.id and b.status in ('booked', 'pending_payment') and x.starts_at > now())
                 as "nextOn"
        from dive_certifications c join dive_divers d on d.id = c.diver_id
        where c.status = 'pending' order by c.created_at`,
  );
}

// ─── First steps ────────────────────────────────────────────────────────────

export interface Welcome {
  diverId: string;
  firstName: string;
  clubName: string;
  steps: { key: WelcomeStep; state: WelcomeStepState }[];
  next: WelcomeStep | null;
  done: number;
  /** Joined through the club's link (the diver's home keeps pointing at these steps until they are done). */
  joinedViaLink: boolean;
  emergencyName: string | null;
  emergencyPhone: string | null;
  email: string | null;
  certs: CertCard[];
}

/** The signed-in diver's first steps in the club, with what each step needs (null: not a diver here). */
export async function myWelcome(tx: Tx): Promise<Welcome | null> {
  const diverId = await myDiverId(tx);
  if (!diverId) return null;
  const d = await one<{
    firstName: string;
    emergencyName: string | null;
    emergencyPhone: string | null;
    email: string | null;
    certLevel: number;
    tags: string[];
    bookings: number;
    clubName: string;
  }>(
    tx,
    sql`select d.first_name as "firstName", d.emergency_name as "emergencyName",
               d.emergency_phone as "emergencyPhone", d.email, d.cert_level as "certLevel", d.tags,
               (select count(*)::int from dive_bookings b where b.diver_id = d.id and b.status <> 'cancelled')
                 as bookings,
               (select o.name from organizations o where o.id = d.organization_id) as "clubName"
        from dive_divers d where d.id = ${diverId}`,
  );
  if (!d) return null;
  const [certs, paperwork, { rules }] = await Promise.all([
    diverCerts(tx, diverId),
    diverPaperwork(tx, diverId),
    loadRules(tx),
  ]);
  const forms = { health: 'missing', waiver: 'missing', insurance: 'missing' } as Record<
    DiveFormKind,
    PaperworkState
  >;
  for (const i of paperwork.items) forms[i.kind] = i.state;
  const cert =
    d.certLevel > 0 || certs.some((c) => c.status === 'verified')
      ? 'verified'
      : certs.some((c) => c.status === 'pending')
        ? 'pending'
        : certs.length > 0
          ? 'rejected'
          : 'none';
  const w = welcomeSteps(
    {
      hasEmergencyContact: Boolean(d.emergencyName && d.emergencyPhone),
      cert,
      beginner: d.tags.includes('beginner'),
      forms,
      bookings: d.bookings,
    },
    rules.paperwork,
  );
  return {
    diverId,
    firstName: d.firstName,
    clubName: d.clubName,
    ...w,
    joinedViaLink: d.tags.includes('self_signup'),
    emergencyName: d.emergencyName,
    emergencyPhone: d.emergencyPhone,
    email: d.email,
    certs,
  };
}
