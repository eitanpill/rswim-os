/** Groups (class templates): create, edit, archive, read. Lead instructor changes go through shift changes. */
import { z } from 'zod';
import {
  ADMITTED_GENDERS,
  optionalDate,
  optionalInt,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
  STAFF_GENDERS,
  STAFF_SKILLS,
  TimeOfDay,
} from '@rswim/contracts';
import { and, asc, desc, eq, gte, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { listPrograms } from '@rswim/domain-settings';
import { checkTemplate, type TemplateDraft } from '../policies';
import {
  activeTemplates,
  instructorFacts,
  optionalUuid,
  poolWindows,
  refuse,
  rulesFor,
  todayIL,
} from './shared';
import { requestShiftChange } from './shifts';

const { classTemplates, classTemplateLanes, sessions, sessionStaff, enrollments, shiftChanges } =
  schema;

export const TemplateInput = z
  .object({
    name: requiredText(120),
    programId: z.uuid(),
    venueId: z.uuid(),
    poolId: z.uuid(),
    weekday: requiredInt(0, 6),
    startsAt: TimeOfDay,
    durationMin: requiredInt(5, 240),
    laneIds: z.array(z.uuid()).min(1, 'scheduling.rules.noLanes'),
    levelMinId: optionalUuid(),
    levelMaxId: optionalUuid(),
    ageMinMonths: optionalInt(0, 1200),
    ageMaxMonths: optionalInt(0, 1200),
    admittedGender: z.enum(ADMITTED_GENDERS),
    capacity: requiredInt(1, 100),
    requiredInstructorGender: z
      .preprocess((v) => (v === '' ? undefined : v), z.enum(STAFF_GENDERS).optional())
      .transform((v) => v ?? null),
    requiredSkills: z.array(z.enum(STAFF_SKILLS)).default([]),
    leadStaffId: optionalUuid(),
    effectiveFrom: requiredDate(),
    effectiveTo: optionalDate(),
    notes: optionalText(500),
  })
  .refine(
    (t) => t.ageMinMonths === null || t.ageMaxMonths === null || t.ageMaxMonths >= t.ageMinMonths,
    { message: 'forms.errors.range', path: ['ageMaxMonths'] },
  )
  .refine((t) => t.effectiveTo === null || t.effectiveTo > t.effectiveFrom, {
    message: 'forms.errors.datesReversed',
    path: ['effectiveTo'],
  });
export type TemplateInput = z.infer<typeof TemplateInput>;

const draftOf = (
  input: TemplateInput,
  id: string | undefined,
  leadStaffId: string | null,
): TemplateDraft => ({
  id,
  venueId: input.venueId,
  poolId: input.poolId,
  weekday: input.weekday,
  startsAt: input.startsAt,
  durationMin: input.durationMin,
  laneIds: input.laneIds,
  admittedGender: input.admittedGender,
  ageMinMonths: input.ageMinMonths,
  effectiveFrom: input.effectiveFrom,
  effectiveTo: input.effectiveTo,
  requiredInstructorGender: input.requiredInstructorGender,
  requiredSkills: input.requiredSkills,
  leadStaffId,
});

/** Runs every hard rule on a draft group (window, lanes, instructor) without saving it. */
export async function checkGroup(
  tx: Tx,
  input: TemplateInput,
  id?: string,
  leadStaffId?: string | null,
) {
  const lead = leadStaffId === undefined ? input.leadStaffId : leadStaffId;
  const draft = draftOf(input, id, lead);
  const [windows, others, instructor, rules] = await Promise.all([
    poolWindows(tx, input.poolId),
    activeTemplates(tx),
    lead ? instructorFacts(tx, lead) : Promise.resolve(null),
    rulesFor(tx, {
      date: input.effectiveFrom,
      venueId: input.venueId,
      programId: input.programId,
      classTemplateId: id ?? null,
    }),
  ]);
  return checkTemplate(draft, windows, others, instructor, rules.scheduling);
}

/** Level ids must belong to the group's program and come in order. */
async function checkLevels(tx: Tx, input: TemplateInput) {
  if (!input.levelMinId && !input.levelMaxId) return;
  const program = (await listPrograms(tx)).find((p) => p.id === input.programId);
  const ordinal = (id: string | null) =>
    id === null ? null : (program?.levels.find((l) => l.id === id)?.ordinal ?? -1);
  const [min, max] = [ordinal(input.levelMinId), ordinal(input.levelMaxId)];
  if (min === -1 || max === -1) throw new DomainError('scheduling.errors.levelProgram');
  if (min !== null && max !== null && max < min)
    throw new DomainError('scheduling.errors.levelOrder');
}

async function writeLanes(
  tx: Tx,
  ctx: ServiceContext,
  id: string,
  poolId: string,
  laneIds: readonly string[],
) {
  await tx.delete(classTemplateLanes).where(eq(classTemplateLanes.classTemplateId, id));
  await tx
    .insert(classTemplateLanes)
    .values(
      laneIds.map((laneId) => ({ organizationId: ctx.orgId, poolId, classTemplateId: id, laneId })),
    );
}

/**
 * Creates a group after the hard rules pass. The lead instructor is not written directly: it becomes a shift change
 * the instructor accepts (change-protection rule), unless the policy turns acceptance off.
 */
export async function createGroup(
  tx: Tx,
  ctx: ServiceContext,
  input: TemplateInput,
): Promise<string> {
  await checkLevels(tx, input);
  refuse((await checkGroup(tx, input)).violations);
  const { laneIds, leadStaffId, ...values } = input;
  const [row] = await tx
    .insert(classTemplates)
    .values({ ...values, organizationId: ctx.orgId, leadStaffId: null })
    .returning({ id: classTemplates.id });
  const id = (row as { id: string }).id;
  await writeLanes(tx, ctx, id, input.poolId, laneIds);
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.group_saved',
    payload: { classTemplateId: id, created: true },
    idempotencyKey: `scheduling.group_saved:${id}:created`,
  });
  if (leadStaffId) {
    await requestShiftChange(tx, ctx, {
      kind: 'reassign_group',
      classTemplateId: id,
      effectiveFrom: input.effectiveFrom,
      toStaffId: leadStaffId,
      reason: null,
    });
  }
  return id;
}

/**
 * Edits a group. The lead stays as it is (see shift changes). Moving the day or time of a group that has an
 * instructor and sessions ahead would change that instructor's shift without asking, so it is refused: end this
 * group and open a new one from a date instead (DECISIONS 2026-10-02).
 */
export async function updateGroup(tx: Tx, ctx: ServiceContext, id: string, input: TemplateInput) {
  const [before] = await tx.select().from(classTemplates).where(eq(classTemplates.id, id));
  if (!before) throw new DomainError('common.errors.notFound');
  await checkLevels(tx, input);
  const moved =
    before.weekday !== input.weekday ||
    before.startsAt.slice(0, 5) !== input.startsAt ||
    before.durationMin !== input.durationMin ||
    before.venueId !== input.venueId;
  if (moved && before.leadStaffId) {
    const [ahead] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(and(eq(sessions.classTemplateId, id), gte(sessions.date, await todayIL(tx))));
    if ((ahead?.n ?? 0) > 0) throw new DomainError('scheduling.errors.timeChangeNeedsNewGroup');
  }
  refuse((await checkGroup(tx, input, id, before.leadStaffId)).violations);
  const { laneIds, leadStaffId: _ignored, ...values } = input;
  await tx.update(classTemplates).set(values).where(eq(classTemplates.id, id));
  await writeLanes(tx, ctx, id, input.poolId, laneIds);
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.group_saved',
    payload: { classTemplateId: id, created: false },
    idempotencyKey: `scheduling.group_saved:${id}:${Date.now()}`,
  });
}

/** Archives a group: it leaves the board and generation; sessions ahead are left for the closure workflow (Phase 3). */
export async function archiveGroup(tx: Tx, ctx: ServiceContext, id: string) {
  await tx.update(classTemplates).set({ status: 'archived' }).where(eq(classTemplates.id, id));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.group_archived',
    payload: { classTemplateId: id },
    idempotencyKey: `scheduling.group_archived:${id}`,
  });
}

export async function listGroups(
  tx: Tx,
  filter: { venueId?: string | null; status?: string } = {},
) {
  const rows = await tx
    .select()
    .from(classTemplates)
    .where(
      and(
        filter.venueId ? eq(classTemplates.venueId, filter.venueId) : undefined,
        eq(classTemplates.status, filter.status ?? 'active'),
      ),
    )
    .orderBy(asc(classTemplates.weekday), asc(classTemplates.startsAt), asc(classTemplates.name));
  return rows;
}

export type GroupDetail = NonNullable<Awaited<ReturnType<typeof getGroup>>>;

export async function getGroup(tx: Tx, id: string) {
  const [group] = await tx.select().from(classTemplates).where(eq(classTemplates.id, id));
  if (!group) return null;
  const today = await todayIL(tx);
  const [lanes, upcoming, members, changes] = await Promise.all([
    tx.select().from(classTemplateLanes).where(eq(classTemplateLanes.classTemplateId, id)),
    tx
      .select({
        id: sessions.id,
        date: sessions.date,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        status: sessions.status,
        leadStaffId: sessionStaff.staffMemberId,
      })
      .from(sessions)
      .leftJoin(
        sessionStaff,
        and(eq(sessionStaff.sessionId, sessions.id), eq(sessionStaff.role, 'lead')),
      )
      .where(and(eq(sessions.classTemplateId, id), gte(sessions.date, today)))
      .orderBy(asc(sessions.date))
      .limit(12),
    tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.classTemplateId, id))
      .orderBy(desc(enrollments.startsOn)),
    tx
      .select()
      .from(shiftChanges)
      .where(eq(shiftChanges.classTemplateId, id))
      .orderBy(desc(shiftChanges.createdAt))
      .limit(10),
  ]);
  return {
    group,
    laneIds: lanes.map((l) => l.laneId),
    upcoming,
    enrollments: members,
    shiftChanges: changes,
  };
}

/** Sessions of these groups between two dates, with their lead instructor. */
export async function sessionsBetween(
  tx: Tx,
  from: string,
  to: string,
  groupIds?: readonly string[],
) {
  return tx
    .select({
      id: sessions.id,
      classTemplateId: sessions.classTemplateId,
      date: sessions.date,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      status: sessions.status,
      leadStaffId: sessionStaff.staffMemberId,
    })
    .from(sessions)
    .leftJoin(
      sessionStaff,
      and(eq(sessionStaff.sessionId, sessions.id), eq(sessionStaff.role, 'lead')),
    )
    .where(
      and(
        gte(sessions.date, from),
        sql`${sessions.date} <= ${to}`,
        groupIds ? inArray(sessions.classTemplateId, [...groupIds]) : undefined,
      ),
    )
    .orderBy(asc(sessions.startsAt));
}

/** The signed-in instructor's own sessions between two dates (instructor app "My day"). */
export async function mySessions(tx: Tx, from: string, to: string) {
  return tx
    .select({
      id: sessions.id,
      classTemplateId: sessions.classTemplateId,
      groupName: classTemplates.name,
      venueId: classTemplates.venueId,
      date: sessions.date,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      status: sessions.status,
    })
    .from(sessions)
    .innerJoin(sessionStaff, eq(sessionStaff.sessionId, sessions.id))
    .innerJoin(classTemplates, eq(classTemplates.id, sessions.classTemplateId))
    .where(
      and(
        sql`${sessionStaff.staffMemberId} = app.current_staff_member_id()`,
        gte(sessions.date, from),
        sql`${sessions.date} <= ${to}`,
      ),
    )
    .orderBy(asc(sessions.startsAt));
}
