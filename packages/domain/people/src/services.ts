/**
 * Households, guardians and students (brief §6.4). A guardian change emits `people.guardian_upserted`, which the
 * worker turns into a GHL contact update (domain-crm).
 */
import { z } from 'zod';
import {
  checkbox,
  optionalDate,
  optionalEmail,
  optionalPhone,
  optionalText,
  requiredText,
  type StudentRelationType,
} from '@rswim/contracts';
import { and, asc, eq, ilike, inArray, or, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';

const { households, guardians, students, studentRelations } = schema;

export const HouseholdInput = z.object({
  displayName: requiredText(120),
  preferredLocale: z.enum(['he', 'en', 'ar', 'ru']).default('he'),
  notes: optionalText(),
});
export type HouseholdInput = z.infer<typeof HouseholdInput>;

export const GuardianInput = z
  .object({
    firstName: requiredText(80),
    lastName: requiredText(80),
    phoneE164: optionalPhone(),
    email: optionalEmail(),
    relation: optionalText(40),
    whatsappOptIn: checkbox(),
    isBillingContact: checkbox(),
  })
  .refine((g) => g.phoneE164 || g.email, {
    message: 'people.errors.contactRequired',
    path: ['phoneE164'],
  });
export type GuardianInput = z.infer<typeof GuardianInput>;

export const StudentInput = z.object({
  firstName: requiredText(80),
  lastName: requiredText(80),
  dob: optionalDate(),
  gender: z.preprocess((v) => (v === '' ? null : v), z.enum(['female', 'male']).nullable()),
  school: optionalText(120),
  grade: optionalText(20),
  levelId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()),
  preferredStaffId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()),
  waterFear: checkbox(),
  photoConsent: checkbox(),
  isSelfGuardian: checkbox(),
  requiresFemaleInstructor: checkbox(),
  custodyPattern: optionalText(200),
});
export type StudentInput = z.infer<typeof StudentInput>;

// ─── Reads ──────────────────────────────────────────────────────────────────

/** Households matching a name, a guardian's name or phone, or a student's name. Empty query lists the first page. */
export async function searchHouseholds(tx: Tx, query: string, limit = 50) {
  const q = query.trim();
  const digits = q.replace(/\D/g, '');
  const like = `%${q}%`;
  const matchIds = q
    ? sql`${households.id} in (
        select household_id from guardians where first_name ilike ${like} or last_name ilike ${like}
          ${digits.length >= 4 ? sql`or phone_e164 like ${`%${digits.slice(-9)}%`}` : sql``}
        union select household_id from students where first_name ilike ${like} or last_name ilike ${like})`
    : sql`true`;
  const rows = await tx
    .select()
    .from(households)
    .where(or(q ? ilike(households.displayName, like) : sql`true`, matchIds))
    .orderBy(asc(households.displayName))
    .limit(limit);
  if (rows.length === 0) return [];
  const ids = rows.map((h) => h.id);
  const [gs, ss] = await Promise.all([
    tx.select().from(guardians).where(inArray(guardians.householdId, ids)),
    tx
      .select({ id: students.id, householdId: students.householdId, firstName: students.firstName })
      .from(students)
      .where(inArray(students.householdId, ids)),
  ]);
  return rows.map((h) => ({
    ...h,
    guardians: gs.filter((g) => g.householdId === h.id),
    students: ss.filter((s) => s.householdId === h.id),
  }));
}

export async function getHousehold(tx: Tx, householdId: string) {
  const [household] = await tx.select().from(households).where(eq(households.id, householdId));
  if (!household) return null;
  const gs = await tx
    .select()
    .from(guardians)
    .where(eq(guardians.householdId, householdId))
    .orderBy(asc(guardians.createdAt));
  const ss = await tx
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      dob: students.dob,
      gender: students.gender,
      school: students.school,
      grade: students.grade,
      levelId: students.levelId,
      preferredStaffId: students.preferredStaffId,
      waterFear: students.waterFear,
      photoConsent: students.photoConsent,
      isSelfGuardian: students.isSelfGuardian,
      requiresFemaleInstructor: students.requiresFemaleInstructor,
      custodyPattern: students.custodyPattern,
    })
    .from(students)
    .where(eq(students.householdId, householdId))
    .orderBy(asc(students.dob));
  const relations = ss.length
    ? await tx
        .select()
        .from(studentRelations)
        .where(
          or(
            inArray(
              studentRelations.studentId,
              ss.map((s) => s.id),
            ),
            inArray(
              studentRelations.relatedStudentId,
              ss.map((s) => s.id),
            ),
          ),
        )
    : [];
  return { household, guardians: gs, students: ss, relations };
}

/** Students by id, with the facts scheduling decides on (no sensitive columns). */
export async function studentsByIds(tx: Tx, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({
      id: students.id,
      householdId: students.householdId,
      firstName: students.firstName,
      lastName: students.lastName,
      dob: students.dob,
      gender: students.gender,
      levelId: students.levelId,
      preferredStaffId: students.preferredStaffId,
      waterFear: students.waterFear,
      photoConsent: students.photoConsent,
      requiresFemaleInstructor: students.requiresFemaleInstructor,
      hasMedicalNotes: students.hasMedicalNotes,
    })
    .from(students)
    .where(inArray(students.id, [...ids]));
}

/** Students whose name matches, for pickers (waitlist, slot booking). */
export async function searchStudents(tx: Tx, query: string, limit = 20) {
  const q = `%${query.trim()}%`;
  return tx
    .select({
      id: students.id,
      householdId: students.householdId,
      firstName: students.firstName,
      lastName: students.lastName,
      dob: students.dob,
      gender: students.gender,
    })
    .from(students)
    .where(
      query.trim()
        ? or(
            ilike(students.firstName, q),
            ilike(students.lastName, q),
            ilike(sql`${students.firstName} || ' ' || ${students.lastName}`, q),
          )
        : undefined,
    )
    .orderBy(asc(students.firstName), asc(students.lastName))
    .limit(limit);
}

/** Guardians of the households these students belong to, for "who to notify" previews. */
export async function guardiansOfStudents(tx: Tx, studentIds: readonly string[]) {
  if (studentIds.length === 0) return [];
  return tx
    .select({
      studentId: students.id,
      guardianId: guardians.id,
      firstName: guardians.firstName,
      lastName: guardians.lastName,
      phoneE164: guardians.phoneE164,
      whatsappOptIn: guardians.whatsappOptIn,
    })
    .from(students)
    .innerJoin(guardians, eq(guardians.householdId, students.householdId))
    .where(inArray(students.id, [...studentIds]));
}

/** Sibling and friend links touching these students, as (student, other, type) both ways. */
export async function relationsOfStudents(tx: Tx, studentIds: readonly string[]) {
  if (studentIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(studentRelations)
    .where(
      or(
        inArray(studentRelations.studentId, [...studentIds]),
        inArray(studentRelations.relatedStudentId, [...studentIds]),
      ),
    );
  return rows.flatMap((r) => [
    { studentId: r.studentId, otherId: r.relatedStudentId, type: r.type as StudentRelationType },
    { studentId: r.relatedStudentId, otherId: r.studentId, type: r.type as StudentRelationType },
  ]);
}

// ─── Writes ─────────────────────────────────────────────────────────────────

async function guardianChanged(
  tx: Tx,
  ctx: ServiceContext,
  guardianId: string,
  source: 'os' | 'ghl',
) {
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'people.guardian_upserted',
    payload: { guardianId, source },
    // One push per change: a second save of the same data finds an equal sync hash and does nothing.
    idempotencyKey: `people.guardian_upserted:${guardianId}:${Date.now()}`,
  });
}

/** New family with its first guardian, in one step (the usual intake). */
export async function createHousehold(
  tx: Tx,
  ctx: ServiceContext,
  input: HouseholdInput,
  firstGuardian: GuardianInput,
): Promise<{ householdId: string; guardianId: string }> {
  const [h] = await tx
    .insert(households)
    .values({ ...input, organizationId: ctx.orgId })
    .returning({ id: households.id });
  const householdId = (h as { id: string }).id;
  const guardianId = await addGuardian(tx, ctx, householdId, {
    ...firstGuardian,
    isBillingContact: true,
  });
  return { householdId, guardianId };
}

export async function updateHousehold(tx: Tx, householdId: string, input: HouseholdInput) {
  await tx.update(households).set(input).where(eq(households.id, householdId));
}

export async function addGuardian(
  tx: Tx,
  ctx: ServiceContext,
  householdId: string,
  input: GuardianInput,
) {
  const [g] = await tx
    .insert(guardians)
    .values({ ...input, householdId, organizationId: ctx.orgId })
    .returning({ id: guardians.id });
  const id = (g as { id: string }).id;
  await guardianChanged(tx, ctx, id, 'os');
  return id;
}

export async function updateGuardian(
  tx: Tx,
  ctx: ServiceContext,
  guardianId: string,
  input: GuardianInput,
) {
  const updated = await tx
    .update(guardians)
    .set(input)
    .where(eq(guardians.id, guardianId))
    .returning({ id: guardians.id });
  if (updated.length === 0) throw new DomainError('common.errors.notFound');
  await guardianChanged(tx, ctx, guardianId, 'os');
}

export async function addStudent(
  tx: Tx,
  ctx: ServiceContext,
  householdId: string,
  input: StudentInput,
) {
  const [s] = await tx
    .insert(students)
    .values({ ...input, householdId, organizationId: ctx.orgId })
    .returning({ id: students.id });
  return (s as { id: string }).id;
}

export async function updateStudent(tx: Tx, studentId: string, input: StudentInput) {
  await tx.update(students).set(input).where(eq(students.id, studentId));
}

/** Records a sibling/friend relation once per pair (lower id first, as the table requires). */
export async function relateStudents(
  tx: Tx,
  ctx: ServiceContext,
  a: string,
  b: string,
  type: StudentRelationType,
) {
  if (a === b) throw new DomainError('people.errors.selfRelation');
  const [studentId, relatedStudentId] = [a, b].sort() as [string, string];
  await tx
    .insert(studentRelations)
    .values({ organizationId: ctx.orgId, studentId, relatedStudentId, type })
    .onConflictDoNothing();
}

export async function unrelateStudents(tx: Tx, a: string, b: string, type: StudentRelationType) {
  const [studentId, relatedStudentId] = [a, b].sort() as [string, string];
  await tx
    .delete(studentRelations)
    .where(
      and(
        eq(studentRelations.studentId, studentId),
        eq(studentRelations.relatedStudentId, relatedStudentId),
        eq(studentRelations.type, type),
      ),
    );
}
