/**
 * Staff profiles, certifications, availability, pay rules and invites (brief §6.8). Payroll itself is Phase 6;
 * this phase stores the inputs it will use.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  CERTIFICATION_TYPES,
  EMPLOYMENT_TYPES,
  optionalDate,
  optionalEmail,
  optionalPhone,
  optionalText,
  PAY_BASES,
  PAY_ROUTINGS,
  requiredDate,
  requiredInt,
  requiredText,
  STAFF_SKILLS,
  TimeOfDay,
} from '@rswim/contracts';
import { asc, desc, eq, isNull, schema, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';

export { certificationStatus } from './policies';

const {
  staffMembers,
  certifications,
  availabilityRules,
  availabilityExceptions,
  payRules,
  staffInvites,
  memberships,
} = schema;

const nullableUuid = () => z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable());

export const StaffInput = z.object({
  firstName: requiredText(80),
  lastName: requiredText(80),
  phoneE164: optionalPhone(),
  email: optionalEmail(),
  gender: z.preprocess((v) => (v === '' ? null : v), z.enum(['female', 'male']).nullable()),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  startDate: optionalDate(),
  endDate: optionalDate(),
  status: z.enum(['active', 'inactive']).default('active'),
  skills: z.array(z.enum(STAFF_SKILLS)).default([]),
  notes: optionalText(),
});
export type StaffInput = z.infer<typeof StaffInput>;

export const CertificationInput = z.object({
  type: z.enum(CERTIFICATION_TYPES),
  issuer: optionalText(120),
  issuedOn: optionalDate(),
  expiresOn: optionalDate(),
});

export const AvailabilityRuleInput = z
  .object({
    weekday: requiredInt(0, 6),
    startsAt: TimeOfDay,
    endsAt: TimeOfDay,
    venueId: nullableUuid(),
    effectiveFrom: requiredDate(),
    effectiveTo: optionalDate(),
  })
  .refine((r) => r.endsAt > r.startsAt, {
    message: 'venues.errors.endBeforeStart',
    path: ['endsAt'],
  });

export const AvailabilityExceptionInput = z
  .object({
    kind: z.enum(['unavailable', 'available']),
    startsOn: requiredDate(),
    endsOn: requiredDate(),
    reason: optionalText(200),
  })
  .refine((r) => r.endsOn >= r.startsOn, {
    message: 'venues.errors.datesReversed',
    path: ['endsOn'],
  });

export const PayRuleInput = z.object({
  basis: z.enum(PAY_BASES),
  amountAgorot: z.int().min(0),
  programId: nullableUuid(),
  venueId: nullableUuid(),
  routing: z.enum(PAY_ROUTINGS),
  travelAllowanceAgorot: z.int().min(0).default(0),
  effectiveFrom: requiredDate(),
  notes: optionalText(300),
});

export const InviteInput = z
  .object({
    role: z.enum(['admin', 'instructor', 'escort', 'accountant']),
    email: optionalEmail(),
    phoneE164: optionalPhone(),
    staffMemberId: nullableUuid(),
  })
  .refine((i) => i.email || i.phoneE164, {
    message: 'people.errors.contactRequired',
    path: ['email'],
  });

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listStaff(tx: Tx) {
  const rows = await tx
    .select({
      id: staffMembers.id,
      firstName: staffMembers.firstName,
      lastName: staffMembers.lastName,
      phoneE164: staffMembers.phoneE164,
      email: staffMembers.email,
      gender: staffMembers.gender,
      employmentType: staffMembers.employmentType,
      status: staffMembers.status,
      skills: staffMembers.skills,
    })
    .from(staffMembers)
    .orderBy(asc(staffMembers.status), asc(staffMembers.firstName));
  const certs = await tx
    .select({
      staffMemberId: certifications.staffMemberId,
      type: certifications.type,
      expiresOn: certifications.expiresOn,
    })
    .from(certifications);
  return rows.map((s) => ({ ...s, certifications: certs.filter((c) => c.staffMemberId === s.id) }));
}

export async function getStaff(tx: Tx, staffId: string) {
  const [staff] = await tx
    .select({
      id: staffMembers.id,
      firstName: staffMembers.firstName,
      lastName: staffMembers.lastName,
      phoneE164: staffMembers.phoneE164,
      email: staffMembers.email,
      gender: staffMembers.gender,
      employmentType: staffMembers.employmentType,
      startDate: staffMembers.startDate,
      endDate: staffMembers.endDate,
      status: staffMembers.status,
      skills: staffMembers.skills,
      notes: staffMembers.notes,
    })
    .from(staffMembers)
    .where(eq(staffMembers.id, staffId));
  if (!staff) return null;
  const [certs, rules, exceptions, pay] = await Promise.all([
    tx
      .select()
      .from(certifications)
      .where(eq(certifications.staffMemberId, staffId))
      .orderBy(asc(certifications.expiresOn)),
    tx
      .select()
      .from(availabilityRules)
      .where(eq(availabilityRules.staffMemberId, staffId))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startsAt)),
    tx
      .select()
      .from(availabilityExceptions)
      .where(eq(availabilityExceptions.staffMemberId, staffId))
      .orderBy(desc(availabilityExceptions.startsOn)),
    // Hidden by RLS without payroll.read; the page then shows nothing rather than failing.
    tx
      .select()
      .from(payRules)
      .where(eq(payRules.staffMemberId, staffId))
      .orderBy(desc(payRules.effectiveFrom)),
  ]);
  return { staff, certifications: certs, availability: rules, exceptions, payRules: pay };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function createStaff(tx: Tx, ctx: ServiceContext, input: StaffInput): Promise<string> {
  const [row] = await tx
    .insert(staffMembers)
    .values({ ...input, organizationId: ctx.orgId })
    .returning({ id: staffMembers.id });
  return (row as { id: string }).id;
}

export async function updateStaff(tx: Tx, staffId: string, input: StaffInput) {
  await tx.update(staffMembers).set(input).where(eq(staffMembers.id, staffId));
}

export async function addCertification(
  tx: Tx,
  ctx: ServiceContext,
  staffId: string,
  input: z.infer<typeof CertificationInput>,
) {
  await tx
    .insert(certifications)
    .values({ ...input, staffMemberId: staffId, organizationId: ctx.orgId });
}

export async function deleteCertification(tx: Tx, id: string) {
  await tx.delete(certifications).where(eq(certifications.id, id));
}

export async function addAvailabilityRule(
  tx: Tx,
  ctx: ServiceContext,
  staffId: string,
  input: z.infer<typeof AvailabilityRuleInput>,
) {
  await tx
    .insert(availabilityRules)
    .values({ ...input, staffMemberId: staffId, organizationId: ctx.orgId });
}

export async function deleteAvailabilityRule(tx: Tx, id: string) {
  await tx.delete(availabilityRules).where(eq(availabilityRules.id, id));
}

export async function addAvailabilityException(
  tx: Tx,
  ctx: ServiceContext,
  staffId: string,
  input: z.infer<typeof AvailabilityExceptionInput>,
) {
  await tx
    .insert(availabilityExceptions)
    .values({ ...input, staffMemberId: staffId, organizationId: ctx.orgId });
}

export async function deleteAvailabilityException(tx: Tx, id: string) {
  await tx.delete(availabilityExceptions).where(eq(availabilityExceptions.id, id));
}

/**
 * Adds a pay rule version. Rules are effective-dated; an older rule for the same program/venue/routing is ended
 * the day the new one starts, so exactly one applies on any date.
 */
export async function addPayRule(
  tx: Tx,
  ctx: ServiceContext,
  staffId: string,
  input: z.infer<typeof PayRuleInput>,
) {
  const open = await tx.select().from(payRules).where(eq(payRules.staffMemberId, staffId));
  for (const r of open) {
    const sameSlot =
      r.programId === input.programId &&
      r.venueId === input.venueId &&
      r.routing === input.routing &&
      r.basis === input.basis;
    if (sameSlot && r.effectiveTo === null && r.effectiveFrom < input.effectiveFrom) {
      await tx
        .update(payRules)
        .set({ effectiveTo: input.effectiveFrom })
        .where(eq(payRules.id, r.id));
    } else if (sameSlot && r.effectiveFrom === input.effectiveFrom) {
      throw new DomainError('settings.errors.duplicateStart');
    }
  }
  await tx
    .insert(payRules)
    .values({ ...input, staffMemberId: staffId, organizationId: ctx.orgId, createdBy: ctx.userId });
}

export const hashInviteToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** Creates an invite valid for 7 days and returns the one-time token for the link. Only its hash is stored. */
export async function createInvite(
  tx: Tx,
  ctx: ServiceContext,
  input: z.infer<typeof InviteInput>,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await tx.insert(staffInvites).values({
    ...input,
    organizationId: ctx.orgId,
    tokenHash: hashInviteToken(token),
    expiresAt,
    createdBy: ctx.userId,
  });
  return { token, expiresAt };
}

export async function listInvites(tx: Tx) {
  return tx
    .select({
      id: staffInvites.id,
      role: staffInvites.role,
      email: staffInvites.email,
      phoneE164: staffInvites.phoneE164,
      expiresAt: staffInvites.expiresAt,
      acceptedAt: staffInvites.acceptedAt,
      revokedAt: staffInvites.revokedAt,
      createdAt: staffInvites.createdAt,
    })
    .from(staffInvites)
    .where(isNull(staffInvites.revokedAt))
    .orderBy(desc(staffInvites.createdAt));
}

export async function revokeInvite(tx: Tx, id: string) {
  await tx.update(staffInvites).set({ revokedAt: new Date() }).where(eq(staffInvites.id, id));
}

/** Members of the org linked to staff records, for showing who has an account. */
export async function staffAccounts(tx: Tx) {
  return tx
    .select({
      staffMemberId: memberships.staffMemberId,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships);
}

/** Every pay rule version (payroll prices lessons with them), optionally for some staff only. */
export async function payRulesOf(tx: Tx, staffIds?: readonly string[]) {
  const rows = await tx.select().from(payRules);
  return staffIds ? rows.filter((r) => staffIds.includes(r.staffMemberId)) : rows;
}

/** The signed-in user's own staff record in this organization, or null (an owner who doesn't teach). */
export async function myStaffId(tx: Tx): Promise<string | null> {
  const r = await tx.execute<{ id: string | null }>(
    sql`select app.current_staff_member_id() as id`,
  );
  return r.rows[0]?.id ?? null;
}
