/**
 * The Group Board (brief §6.3) and enrollment moves: who is in which group, can a child join another group (hard
 * rules), how well it fits (soft score), who would be told, and the move itself.
 */
import { z } from 'zod';
import {
  ENROLLMENT_STATUSES,
  requiredDate,
  SEAT_HOLDING_STATUSES,
  type GenderRestriction,
  type StaffGender,
} from '@rswim/contracts';
import { and, asc, eq, gt, inArray, isNull, lte, or, schema, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { guardiansOfStudents, relationsOfStudents, studentsByIds } from '@rswim/domain-people';
import { listPrograms } from '@rswim/domain-settings';
import { listStaff } from '@rswim/domain-staff';
import {
  ageInMonths,
  checkPlacement,
  scorePlacement,
  windowFor,
  type Decision,
  type PlacementGroup,
  type Score,
  type WindowRow,
} from '../policies';
import { byIds, poolWindows, todayIL } from './shared';

const { classTemplates, classTemplateLanes, enrollments, waitlistEntries, shiftChanges } = schema;

export const PlaceInput = z.object({
  studentId: z.uuid(),
  toTemplateId: z.uuid(),
  fromTemplateId: z
    .preprocess((v) => (v === '' ? undefined : v), z.uuid().optional())
    .transform((v) => v ?? null),
  onDate: requiredDate(),
  status: z.enum(ENROLLMENT_STATUSES).default('active'),
});
export type PlaceInput = z.infer<typeof PlaceInput>;

/** Enrollments that hold a seat on a date (or start later and have not ended). */
const seatOn = (date: string) =>
  and(
    inArray(enrollments.status, [...SEAT_HOLDING_STATUSES]),
    or(isNull(enrollments.endsOn), gt(enrollments.endsOn, date)),
  );

async function groupsWithLanes(tx: Tx, where: ReturnType<typeof and>) {
  const rows = await tx
    .select()
    .from(classTemplates)
    .where(where)
    .orderBy(asc(classTemplates.weekday), asc(classTemplates.startsAt), asc(classTemplates.name));
  const lanes = rows.length
    ? await tx
        .select()
        .from(classTemplateLanes)
        .where(
          inArray(
            classTemplateLanes.classTemplateId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((r) => ({
    ...r,
    laneIds: lanes.filter((l) => l.classTemplateId === r.id).map((l) => l.laneId),
  }));
}

type GroupRow = Awaited<ReturnType<typeof groupsWithLanes>>[number];

const windowRestriction = (g: GroupRow, windows: readonly WindowRow[]): GenderRestriction | null =>
  windowFor(g, windows)?.genderRestriction ?? null;

export type BoardGroup = Awaited<ReturnType<typeof boardData>>['groups'][number];

/**
 * Everything the board shows for a venue: its active groups with lanes, window, instructor, fill, members (with the
 * facts the badges need), and whether a shift change is waiting. Members are the seats held on `onDate`, including
 * children whose place starts later. Course and camp groups are left out: they belong to a cohort and are run from
 * its page.
 */
export async function boardData(tx: Tx, venueId: string, onDate: string) {
  const groups = await groupsWithLanes(
    tx,
    and(
      eq(classTemplates.venueId, venueId),
      eq(classTemplates.status, 'active'),
      isNull(classTemplates.cohortId),
      or(isNull(classTemplates.effectiveTo), gt(classTemplates.effectiveTo, onDate)),
    ),
  );
  const ids = groups.map((g) => g.id);
  const [seats, programs, staff, pending] = await Promise.all([
    ids.length
      ? tx
          .select()
          .from(enrollments)
          .where(and(inArray(enrollments.classTemplateId, ids), seatOn(onDate)))
      : Promise.resolve([]),
    listPrograms(tx),
    listStaff(tx),
    ids.length
      ? tx
          .select({ classTemplateId: shiftChanges.classTemplateId, status: shiftChanges.status })
          .from(shiftChanges)
          .where(
            and(
              inArray(shiftChanges.classTemplateId, ids),
              inArray(shiftChanges.status, ['pending', 'accepted', 'escalated']),
            ),
          )
      : Promise.resolve([]),
  ]);
  const people = byIds(await studentsByIds(tx, [...new Set(seats.map((e) => e.studentId))]));
  const levels = new Map(programs.flatMap((p) => p.levels.map((l) => [l.id, l] as const)));
  const staffById = byIds(staff);
  const windowsByPool = new Map<string, WindowRow[]>();
  for (const poolId of new Set(groups.map((g) => g.poolId))) {
    windowsByPool.set(poolId, await poolWindows(tx, poolId));
  }
  return {
    groups: groups.map((g) => {
      const lead = g.leadStaffId ? staffById.get(g.leadStaffId) : undefined;
      const members = seats
        .filter((e) => e.classTemplateId === g.id)
        .flatMap((e) => {
          const s = people.get(e.studentId);
          if (!s) return [];
          const level = s.levelId ? levels.get(s.levelId) : undefined;
          return [
            {
              enrollmentId: e.id,
              studentId: s.id,
              householdId: s.householdId,
              firstName: s.firstName,
              lastName: s.lastName,
              gender: s.gender as StaffGender | null,
              ageMonths: s.dob ? ageInMonths(s.dob, onDate) : null,
              levelName: level?.nameHe ?? null,
              levelOrdinal: level?.ordinal ?? null,
              status: e.status,
              startsOn: e.startsOn,
              waterFear: s.waterFear,
              requiresFemaleInstructor: s.requiresFemaleInstructor,
            },
          ];
        })
        .sort((a, b) => a.firstName.localeCompare(b.firstName, 'he'));
      const program = programs.find((p) => p.id === g.programId);
      return {
        id: g.id,
        name: g.name,
        poolId: g.poolId,
        laneIds: g.laneIds,
        weekday: g.weekday,
        startsAt: g.startsAt.slice(0, 5),
        durationMin: g.durationMin,
        capacity: g.capacity,
        admittedGender: g.admittedGender,
        ageMinMonths: g.ageMinMonths,
        ageMaxMonths: g.ageMaxMonths,
        programName: program?.nameHe ?? '',
        levelMin: g.levelMinId ? (levels.get(g.levelMinId)?.nameHe ?? null) : null,
        levelMax: g.levelMaxId ? (levels.get(g.levelMaxId)?.nameHe ?? null) : null,
        windowRestriction: windowRestriction(g, windowsByPool.get(g.poolId) ?? []),
        lead: lead
          ? { id: lead.id, name: `${lead.firstName} ${lead.lastName}`, gender: lead.gender }
          : null,
        pendingChange: pending.find((p) => p.classTemplateId === g.id)?.status ?? null,
        members,
      };
    }),
  };
}

export interface PlacementPreview {
  decision: Decision;
  score: Score;
  student: { id: string; firstName: string; lastName: string };
  from: { id: string; name: string; lead: string | null } | null;
  to: { id: string; name: string; lead: string | null };
  /** Who will be told once Phase 5 sends messages: the family's guardians and both instructors. */
  notify: { guardians: string[]; instructors: string[] };
}

/** Hard rules, soft score and who-to-notify for placing a child (moving them when `fromTemplateId` is set). */
export async function previewPlacement(tx: Tx, input: PlaceInput): Promise<PlacementPreview> {
  const [student] = await studentsByIds(tx, [input.studentId]);
  if (!student) throw new DomainError('common.errors.notFound');
  const targetIds = [input.toTemplateId, ...(input.fromTemplateId ? [input.fromTemplateId] : [])];
  const groups = byIds(await groupsWithLanes(tx, inArray(classTemplates.id, targetIds)));
  const to = groups.get(input.toTemplateId);
  if (!to) throw new DomainError('common.errors.notFound');
  const from = input.fromTemplateId ? (groups.get(input.fromTemplateId) ?? null) : null;

  const [programs, staff, windows, toSeats, mySeats, relations, guardians, waiting] =
    await Promise.all([
      listPrograms(tx),
      listStaff(tx),
      poolWindows(tx, to.poolId),
      tx
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.classTemplateId, to.id), seatOn(input.onDate))),
      tx
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.studentId, student.id), seatOn(input.onDate))),
      relationsOfStudents(tx, [student.id]),
      guardiansOfStudents(tx, [student.id]),
      tx
        .select()
        .from(waitlistEntries)
        .where(
          and(eq(waitlistEntries.studentId, student.id), eq(waitlistEntries.status, 'waiting')),
        ),
    ]);
  const levels = new Map(programs.flatMap((p) => p.levels.map((l) => [l.id, l] as const)));
  const staffById = byIds(staff);
  const leadName = (g: GroupRow | null) => {
    const s = g?.leadStaffId ? staffById.get(g.leadStaffId) : undefined;
    return s ? `${s.firstName} ${s.lastName}` : null;
  };
  const lead = to.leadStaffId ? staffById.get(to.leadStaffId) : undefined;
  const ordinal = (id: string | null) => (id ? (levels.get(id)?.ordinal ?? null) : null);

  // The child's other groups (not the one they leave), and the groups their siblings are in.
  const siblingIds = relations.filter((r) => r.type === 'sibling').map((r) => r.otherId);
  const friendIds = relations.filter((r) => r.type === 'friend').map((r) => r.otherId);
  const siblingSeats = siblingIds.length
    ? await tx
        .select()
        .from(enrollments)
        .where(and(inArray(enrollments.studentId, siblingIds), seatOn(input.onDate)))
    : [];
  const otherIds = [
    ...new Set(
      [...mySeats, ...siblingSeats]
        .map((e) => e.classTemplateId)
        .filter((id) => id !== input.fromTemplateId && id !== to.id),
    ),
  ];
  const others = byIds(
    otherIds.length ? await groupsWithLanes(tx, inArray(classTemplates.id, otherIds)) : [],
  );
  const timeOf = (g: GroupRow) => ({
    weekday: g.weekday,
    startsAt: g.startsAt,
    durationMin: g.durationMin,
  });

  const memberStudents = byIds(
    await studentsByIds(
      tx,
      toSeats.map((e) => e.studentId),
    ),
  );
  const placementGroup: PlacementGroup = {
    id: to.id,
    name: to.name,
    ...timeOf(to),
    capacity: to.capacity,
    admittedGender: to.admittedGender as PlacementGroup['admittedGender'],
    ageMinMonths: to.ageMinMonths,
    ageMaxMonths: to.ageMaxMonths,
    levelMinOrdinal: ordinal(to.levelMinId),
    levelMaxOrdinal: ordinal(to.levelMaxId),
    windowRestriction: windowRestriction(to, windows),
    leadGender: (lead?.gender as StaffGender | null | undefined) ?? null,
    memberIds: toSeats.map((e) => e.studentId),
  };
  const decision = checkPlacement(
    {
      id: student.id,
      firstName: student.firstName,
      gender: student.gender as StaffGender | null,
      dob: student.dob,
      levelOrdinal: ordinal(student.levelId),
      requiresFemaleInstructor: student.requiresFemaleInstructor,
    },
    placementGroup,
    input.onDate,
    mySeats.flatMap((e) => {
      const g = others.get(e.classTemplateId);
      return g ? [{ id: g.id, name: g.name, ...timeOf(g) }] : [];
    }),
  );
  const pref = waiting.find((w) => w.programId === to.programId) ?? waiting[0];
  const score = scorePlacement({
    student: {
      levelOrdinal: ordinal(student.levelId),
      preferredStaffId: student.preferredStaffId,
      friendIds,
      preference: pref
        ? { weekdays: pref.preferredWeekdays, earliestAt: pref.earliestAt, latestAt: pref.latestAt }
        : undefined,
    },
    group: {
      ...timeOf(to),
      venueId: to.venueId,
      leadStaffId: to.leadStaffId,
      memberIds: placementGroup.memberIds,
      memberLevelOrdinals: toSeats.flatMap((e) => {
        const o = ordinal(memberStudents.get(e.studentId)?.levelId ?? null);
        return o === null ? [] : [o];
      }),
    },
    siblingGroups: siblingSeats.flatMap((e) => {
      const g = e.classTemplateId === to.id ? to : others.get(e.classTemplateId);
      return g ? [{ ...timeOf(g), venueId: g.venueId }] : [];
    }),
  });
  return {
    decision,
    score,
    student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
    from: from ? { id: from.id, name: from.name, lead: leadName(from) } : null,
    to: { id: to.id, name: to.name, lead: leadName(to) },
    notify: {
      guardians: guardians.map((g) => `${g.firstName} ${g.lastName}`),
      instructors: [
        ...new Set([leadName(from), leadName(to)].filter((n): n is string => n !== null)),
      ],
    },
  };
}

/**
 * Places or moves a child after the hard rules pass. A move ends the old place on `onDate` and starts the new one the
 * same day, linked to it, so history and (Phase 4) billing see one continuous enrollment.
 */
export async function placeStudent(tx: Tx, ctx: ServiceContext, input: PlaceInput) {
  const preview = await previewPlacement(tx, input);
  const first = preview.decision.violations[0];
  if (first) throw new DomainError(first.code, first.params);
  let previousId: string | null = null;
  if (input.fromTemplateId) {
    const ended = await tx
      .update(enrollments)
      .set({ endsOn: input.onDate, status: 'completed' })
      .where(
        and(
          eq(enrollments.studentId, input.studentId),
          eq(enrollments.classTemplateId, input.fromTemplateId),
          seatOn(input.onDate),
          lte(enrollments.startsOn, input.onDate),
        ),
      )
      .returning({ id: enrollments.id, status: enrollments.status });
    if (ended.length === 0) {
      // The old place starts later than the move date: it simply goes.
      const removed = await tx
        .delete(enrollments)
        .where(
          and(
            eq(enrollments.studentId, input.studentId),
            eq(enrollments.classTemplateId, input.fromTemplateId),
            seatOn(input.onDate),
          ),
        )
        .returning({ id: enrollments.id });
      if (removed.length === 0) throw new DomainError('scheduling.errors.notInGroup');
    } else {
      previousId = (ended[0] as { id: string }).id;
    }
  }
  const [row] = await tx
    .insert(enrollments)
    .values({
      organizationId: ctx.orgId,
      studentId: input.studentId,
      classTemplateId: input.toTemplateId,
      status: input.status,
      startsOn: input.onDate,
      previousEnrollmentId: previousId,
      source: input.fromTemplateId ? 'board_move' : 'board',
      createdBy: ctx.userId,
    })
    .returning({ id: enrollments.id });
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.enrollment_changed',
    payload: {
      enrollmentId: id,
      studentId: input.studentId,
      fromTemplateId: input.fromTemplateId,
      toTemplateId: input.toTemplateId,
      onDate: input.onDate,
    },
    idempotencyKey: `scheduling.enrollment_changed:${id}`,
  });
  return { enrollmentId: id, preview };
}

/** Ends a child's place in a group from a date (the next lesson they will not attend). */
export async function removeStudent(
  tx: Tx,
  ctx: ServiceContext,
  input: { studentId: string; templateId: string; onDate: string },
) {
  const ended = await tx
    .update(enrollments)
    .set({ endsOn: input.onDate, status: 'completed' })
    .where(
      and(
        eq(enrollments.studentId, input.studentId),
        eq(enrollments.classTemplateId, input.templateId),
        seatOn(input.onDate),
        lte(enrollments.startsOn, input.onDate),
      ),
    )
    .returning({ id: enrollments.id });
  if (ended.length === 0) {
    const removed = await tx
      .delete(enrollments)
      .where(
        and(
          eq(enrollments.studentId, input.studentId),
          eq(enrollments.classTemplateId, input.templateId),
          seatOn(input.onDate),
        ),
      )
      .returning({ id: enrollments.id });
    if (removed.length === 0) throw new DomainError('scheduling.errors.notInGroup');
  }
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.enrollment_changed',
    payload: {
      studentId: input.studentId,
      fromTemplateId: input.templateId,
      toTemplateId: null,
      onDate: input.onDate,
    },
    idempotencyKey: `scheduling.enrollment_changed:${input.studentId}:${input.templateId}:${input.onDate}:removed`,
  });
}

/** Groups a child is in on a date, for the family page. */
export async function groupsOfStudent(tx: Tx, studentId: string, onDate?: string) {
  const date = onDate ?? (await todayIL(tx));
  return tx
    .select({
      enrollmentId: enrollments.id,
      status: enrollments.status,
      startsOn: enrollments.startsOn,
      classTemplateId: classTemplates.id,
      name: classTemplates.name,
      venueId: classTemplates.venueId,
      weekday: classTemplates.weekday,
      startsAt: classTemplates.startsAt,
    })
    .from(enrollments)
    .innerJoin(classTemplates, eq(classTemplates.id, enrollments.classTemplateId))
    .where(and(eq(enrollments.studentId, studentId), seatOn(date)));
}
