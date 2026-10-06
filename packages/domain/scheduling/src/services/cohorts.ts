/**
 * Course and camp cohorts (brief §6.11): a fixed group of children over set dates, meeting in one or more groups (an
 * intensive course twice a week, a camp week every day). Registering places the child in every group of the cohort
 * for its dates; billing charges the program's package price once per cohort. A camp keeps its staff ratio. The
 * cohort's own regulations are its program's policy version.
 */
import { z } from 'zod';
import {
  CohortStatus,
  optionalDate,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
} from '@rswim/contracts';
import { and, asc, eq, inArray, isNull, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { guardiansOfStudents, staffNames, studentsByIds } from '@rswim/domain-people';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { addDays } from '@rswim/calendar';
import {
  cohortRatio,
  cohortRegistrationCheck,
  cohortRulesFrom,
  type CohortFacts,
  type CohortRatio,
} from '../policies';
import { groupTexts, type GroupText } from './transport-facts';
import { todayIL } from './shared';

const { cohorts, cohortStaff, classTemplates, enrollments, programs, sessions } = schema;

/** A cohort's member holds (or held) a place in its groups; a cancelled registration is not a member. */
const MEMBER_STATUSES = ['active', 'frozen', 'cancel_requested', 'completed'];

export const CohortInput = z
  .object({
    name: requiredText(120),
    programId: z.uuid('forms.errors.required'),
    startsOn: requiredDate(),
    endsOn: requiredDate(),
    capacity: requiredInt(1, 500),
    registrationClosesOn: optionalDate(),
    notes: optionalText(1000),
  })
  .refine((c) => c.endsOn >= c.startsOn, {
    message: 'forms.errors.datesReversed',
    path: ['endsOn'],
  });
export type CohortInput = z.input<typeof CohortInput>;

async function unique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new DomainError('forms.errors.duplicate');
    throw e;
  }
}

export async function createCohort(tx: Tx, ctx: ServiceContext, raw: CohortInput) {
  const input = CohortInput.parse(raw);
  const [row] = await unique(() =>
    tx
      .insert(cohorts)
      .values({ organizationId: ctx.orgId, ...input })
      .returning({ id: cohorts.id }),
  );
  return (row as { id: string }).id;
}

export async function updateCohort(tx: Tx, id: string, raw: CohortInput) {
  const input = CohortInput.parse(raw);
  const groups = await groupsOf(tx, [id]);
  if (groups.length > 0 && groups.some((g) => g.programId !== input.programId)) {
    throw new DomainError('scheduling.cohort.programMismatch');
  }
  await unique(() => tx.update(cohorts).set(input).where(eq(cohorts.id, id)));
}

export const CohortStatusInput = z.object({ id: z.uuid(), status: CohortStatus });

export async function setCohortStatus(tx: Tx, raw: z.input<typeof CohortStatusInput>) {
  const input = CohortStatusInput.parse(raw);
  await tx.update(cohorts).set({ status: input.status }).where(eq(cohorts.id, input.id));
}

// ─── Groups and staff ───────────────────────────────────────────────────────

async function groupsOf(tx: Tx, cohortIds: readonly string[]) {
  if (cohortIds.length === 0) return [];
  return tx
    .select({
      id: classTemplates.id,
      cohortId: classTemplates.cohortId,
      programId: classTemplates.programId,
      leadStaffId: classTemplates.leadStaffId,
      effectiveFrom: classTemplates.effectiveFrom,
      status: classTemplates.status,
    })
    .from(classTemplates)
    .where(inArray(classTemplates.cohortId, [...cohortIds]));
}

export const CohortGroupInput = z.object({
  cohortId: z.uuid(),
  classTemplateId: z.uuid('forms.errors.required'),
});

/** Makes a group one of the cohort's meetings. It must run the cohort's program and belong to no other cohort. */
export async function attachGroup(tx: Tx, raw: z.input<typeof CohortGroupInput>) {
  const input = CohortGroupInput.parse(raw);
  const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, input.cohortId));
  const [group] = await tx
    .select()
    .from(classTemplates)
    .where(eq(classTemplates.id, input.classTemplateId));
  if (!cohort || !group) throw new DomainError('common.errors.notFound');
  if (group.programId !== cohort.programId)
    throw new DomainError('scheduling.cohort.programMismatch');
  if (group.cohortId && group.cohortId !== cohort.id)
    throw new DomainError('scheduling.cohort.otherCohort');
  if ((await membersOf(tx, [cohort.id])).length > 0)
    throw new DomainError('scheduling.cohort.hasMembers');
  await tx
    .update(classTemplates)
    .set({ cohortId: cohort.id })
    .where(eq(classTemplates.id, group.id));
}

/** Takes a group out of a cohort that has nobody registered yet. */
export async function detachGroup(tx: Tx, raw: z.input<typeof CohortGroupInput>) {
  const input = CohortGroupInput.parse(raw);
  if ((await membersOf(tx, [input.cohortId])).length > 0)
    throw new DomainError('scheduling.cohort.hasMembers');
  await tx
    .update(classTemplates)
    .set({ cohortId: null })
    .where(
      and(
        eq(classTemplates.id, input.classTemplateId),
        eq(classTemplates.cohortId, input.cohortId),
      ),
    );
}

export const CohortStaffInput = z.object({
  cohortId: z.uuid(),
  staffMemberId: z.uuid('forms.errors.required'),
  role: optionalText(80),
});

export async function addCohortStaff(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof CohortStaffInput>,
) {
  const input = CohortStaffInput.parse(raw);
  await unique(() => tx.insert(cohortStaff).values({ organizationId: ctx.orgId, ...input }));
}

export async function removeCohortStaff(tx: Tx, id: string) {
  await tx.delete(cohortStaff).where(eq(cohortStaff.id, id));
}

// ─── Members ────────────────────────────────────────────────────────────────

async function membersOf(tx: Tx, cohortIds: readonly string[]) {
  if (cohortIds.length === 0) return [];
  const rows = await tx
    .selectDistinct({
      cohortId: classTemplates.cohortId,
      studentId: enrollments.studentId,
      startsOn: sql<string>`min(${enrollments.startsOn}) over (partition by ${classTemplates.cohortId}, ${enrollments.studentId})`,
      registeredAt: sql<Date>`min(${enrollments.createdAt}) over (partition by ${classTemplates.cohortId}, ${enrollments.studentId})`,
    })
    .from(enrollments)
    .innerJoin(classTemplates, eq(classTemplates.id, enrollments.classTemplateId))
    .where(
      and(
        inArray(classTemplates.cohortId, [...cohortIds]),
        inArray(enrollments.status, MEMBER_STATUSES),
      ),
    );
  return rows as { cohortId: string; studentId: string; startsOn: string; registeredAt: Date }[];
}

async function staffOf(tx: Tx, cohortIds: readonly string[]) {
  if (cohortIds.length === 0) return [];
  return tx
    .select()
    .from(cohortStaff)
    .where(inArray(cohortStaff.cohortId, [...cohortIds]));
}

export interface CohortSummary {
  id: string;
  name: string;
  programId: string;
  programName: string;
  programKind: string;
  startsOn: string;
  endsOn: string;
  capacity: number;
  registrationClosesOn: string | null;
  status: CohortStatus;
  notes: string | null;
  groupIds: string[];
  registered: number;
  /** Instructors leading its groups and the cohort's own counselors, each counted once. */
  staffIds: string[];
  ratio: CohortRatio;
  facts: CohortFacts;
  policyVersionKey: string;
  /** The date the program's own regulations start, when it has its own (else the school's general ones apply). */
  ownPolicyFrom: string | null;
}

const CAMP_KINDS = new Set(['camp']);

/** Cohorts with their counts and ratio, newest first (optionally only some). */
export async function listCohorts(tx: Tx, ids?: readonly string[]): Promise<CohortSummary[]> {
  const rows = await tx
    .select({
      cohort: cohorts,
      programName: programs.nameHe,
      programKind: programs.kind,
    })
    .from(cohorts)
    .innerJoin(programs, eq(programs.id, cohorts.programId))
    .where(ids ? inArray(cohorts.id, [...ids]) : undefined)
    .orderBy(sql`${cohorts.startsOn} desc`, asc(cohorts.name));
  const cohortIds = rows.map((r) => r.cohort.id);
  const [groups, members, staff] = await Promise.all([
    groupsOf(tx, cohortIds),
    membersOf(tx, cohortIds),
    staffOf(tx, cohortIds),
  ]);
  const out: CohortSummary[] = [];
  for (const r of rows) {
    const c = r.cohort;
    const mine = groups.filter((g) => g.cohortId === c.id && g.status !== 'archived');
    const staffIds = [
      ...new Set([
        ...mine.map((g) => g.leadStaffId).filter((s): s is string => !!s),
        ...staff.filter((s) => s.cohortId === c.id).map((s) => s.staffMemberId),
      ]),
    ];
    const facts: CohortFacts = {
      status: c.status as CohortStatus,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      capacity: c.capacity,
      registrationClosesOn: c.registrationClosesOn,
      isCamp: CAMP_KINDS.has(r.programKind),
      groups: mine.length,
      registered: members.filter((m) => m.cohortId === c.id).length,
      staff: staffIds.length,
    };
    const policy = await resolvePolicyFor(tx, {
      date: c.startsOn,
      venueId: null,
      programId: c.programId,
      classTemplateId: null,
    });
    out.push({
      id: c.id,
      name: c.name,
      programId: c.programId,
      programName: r.programName,
      programKind: r.programKind,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      capacity: c.capacity,
      registrationClosesOn: c.registrationClosesOn,
      status: c.status as CohortStatus,
      notes: c.notes,
      groupIds: mine.map((g) => g.id),
      registered: facts.registered,
      staffIds,
      ratio: cohortRatio(facts, cohortRulesFrom(policy.rules)),
      facts,
      policyVersionKey: policy.versionKey,
      ownPolicyFrom: policy.sources.find((x) => x.scopeType === 'program')?.effectiveFrom ?? null,
    });
  }
  return out;
}

export interface CohortRosterRow {
  studentId: string;
  name: string;
  dob: string | null;
  gender: string | null;
  waterFear: boolean;
  hasMedicalNotes: boolean;
  guardians: { name: string; phone: string | null }[];
  registeredAt: Date;
}

export interface CohortView extends CohortSummary {
  groups: (GroupText & { leadName: string | null; lessonDates: string[] })[];
  staff: { id: string; staffMemberId: string; name: string; role: string | null }[];
  roster: CohortRosterRow[];
}

/** One cohort with its groups and lesson dates, staff and roster (the print page and the office screen). */
export async function getCohort(tx: Tx, id: string): Promise<CohortView | null> {
  const [summary] = await listCohorts(tx, [id]);
  if (!summary) return null;
  const [texts, members, staff, lessons] = await Promise.all([
    groupTexts(tx, summary.groupIds),
    membersOf(tx, [id]),
    staffOf(tx, [id]),
    summary.groupIds.length
      ? tx
          .select({ templateId: sessions.classTemplateId, date: sessions.date })
          .from(sessions)
          .where(
            and(
              inArray(sessions.classTemplateId, summary.groupIds),
              sql`${sessions.date} between ${summary.startsOn}::date and ${summary.endsOn}::date`,
              sql`${sessions.status} not like 'cancelled%'`,
            ),
          )
          .orderBy(asc(sessions.date))
      : Promise.resolve([]),
  ]);
  const groups = await groupsOf(tx, [id]);
  const names = await staffNames(tx, [
    ...groups.map((g) => g.leadStaffId).filter((s): s is string => !!s),
    ...staff.map((s) => s.staffMemberId),
  ]);
  const ids = members.map((m) => m.studentId);
  const [kids, contacts] = await Promise.all([
    studentsByIds(tx, ids),
    guardiansOfStudents(tx, ids),
  ]);
  const roster = members
    .map((m): CohortRosterRow | null => {
      const k = kids.find((x) => x.id === m.studentId);
      if (!k) return null;
      return {
        studentId: k.id,
        name: `${k.firstName} ${k.lastName}`,
        dob: k.dob,
        gender: k.gender,
        waterFear: k.waterFear,
        hasMedicalNotes: k.hasMedicalNotes ?? false,
        guardians: contacts
          .filter((g) => g.studentId === k.id)
          .map((g) => ({ name: `${g.firstName} ${g.lastName}`, phone: g.phoneE164 })),
        registeredAt: m.registeredAt,
      };
    })
    .filter((r): r is CohortRosterRow => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return {
    ...summary,
    groups: texts.map((g) => {
      const lead = groups.find((x) => x.id === g.id)?.leadStaffId;
      return {
        ...g,
        leadName: lead ? (names.get(lead) ?? null) : null,
        lessonDates: lessons.filter((l) => l.templateId === g.id).map((l) => l.date),
      };
    }),
    staff: staff.map((s) => ({
      id: s.id,
      staffMemberId: s.staffMemberId,
      name: names.get(s.staffMemberId) ?? '',
      role: s.role,
    })),
    roster,
  };
}

export const RegisterInput = z.object({
  cohortId: z.uuid(),
  studentId: z.uuid('forms.errors.required'),
});

/**
 * Registers a child: places them in each of the cohort's groups from the cohort's first day (or the group's, if
 * later) to its last, once the regulations allow it (open, before closing, a seat, a camp's staff ratio).
 */
export async function registerToCohort(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof RegisterInput>,
) {
  const input = RegisterInput.parse(raw);
  const [summary] = await listCohorts(tx, [input.cohortId]);
  if (!summary) throw new DomainError('common.errors.notFound');
  const members = await membersOf(tx, [summary.id]);
  if (members.some((m) => m.studentId === input.studentId))
    throw new DomainError('scheduling.cohort.alreadyRegistered');
  const policy = await resolvePolicyFor(tx, {
    date: summary.startsOn,
    venueId: null,
    programId: summary.programId,
    classTemplateId: null,
  });
  const decision = cohortRegistrationCheck(
    summary.facts,
    await todayIL(tx),
    cohortRulesFrom(policy.rules),
  );
  if (!decision.ok) throw new DomainError(decision.code, decision.params);
  const groups = (await groupsOf(tx, [summary.id])).filter((g) => g.status !== 'archived');
  const endsOn = addDays(summary.endsOn, 1);
  const rows = await tx
    .insert(enrollments)
    .values(
      groups.map((g) => ({
        organizationId: ctx.orgId,
        studentId: input.studentId,
        classTemplateId: g.id,
        status: 'active',
        startsOn: g.effectiveFrom > summary.startsOn ? g.effectiveFrom : summary.startsOn,
        endsOn,
        source: 'cohort',
        createdBy: ctx.userId,
      })),
    )
    .returning({ id: enrollments.id });
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.cohort_registered',
    payload: {
      cohortId: summary.id,
      studentId: input.studentId,
      policyVersionKey: policy.versionKey,
    },
    idempotencyKey: `scheduling.cohort_registered:${summary.id}:${input.studentId}:${rows[0]?.id ?? ''}`,
  });
}

/**
 * Cancels a registration. Before the cohort starts the places simply go (nothing is billed); once it started they
 * end today and stay on the bill, and the regulations decide any refund.
 */
export async function cancelRegistration(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof RegisterInput>,
) {
  const input = RegisterInput.parse(raw);
  const today = await todayIL(tx);
  const groupIds = (await groupsOf(tx, [input.cohortId])).map((g) => g.id);
  if (groupIds.length === 0) throw new DomainError('scheduling.cohort.notRegistered');
  const mine = and(
    eq(enrollments.studentId, input.studentId),
    inArray(enrollments.classTemplateId, groupIds),
    inArray(enrollments.status, MEMBER_STATUSES),
  );
  const removed = await tx
    .delete(enrollments)
    .where(and(mine, sql`${enrollments.startsOn} > ${today}::date`))
    .returning({ id: enrollments.id });
  const ended = await tx
    .update(enrollments)
    .set({
      status: 'cancelled',
      endsOn: sql`least(coalesce(${enrollments.endsOn}, ${addDays(today, 1)}::date), ${addDays(today, 1)}::date)`,
    })
    .where(mine)
    .returning({ id: enrollments.id });
  if (removed.length + ended.length === 0) throw new DomainError('scheduling.cohort.notRegistered');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.cohort_cancelled',
    payload: { cohortId: input.cohortId, studentId: input.studentId, billed: ended.length > 0 },
    idempotencyKey: `scheduling.cohort_cancelled:${input.cohortId}:${input.studentId}:${today}`,
  });
}

/** Groups of a program that could join a cohort (in no other cohort, not archived). */
export async function groupsForCohort(tx: Tx, programId: string) {
  return tx
    .select({ id: classTemplates.id, name: classTemplates.name, weekday: classTemplates.weekday })
    .from(classTemplates)
    .where(
      and(
        eq(classTemplates.programId, programId),
        isNull(classTemplates.cohortId),
        ne(classTemplates.status, 'archived'),
      ),
    )
    .orderBy(asc(classTemplates.weekday), asc(classTemplates.name));
}
