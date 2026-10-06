/**
 * The instructor's lesson (brief §6.7): the lineup with each child's flags, one-tap attendance that syncs from an
 * offline queue, and progress ticks against the level's skills.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ATTENDANCE_STATUSES, type AttendanceKind, type StaffGender } from '@rswim/contracts';
import { and, asc, eq, inArray, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { trialsInSessions } from '@rswim/domain-enrollment';
import { studentsByIds } from '@rswim/domain-people';
import { ageInMonths, seatHoldersOn } from '@rswim/domain-scheduling';
import { listPrograms } from '@rswim/domain-settings';
import { attendanceStatusForArrival } from '../policies';
import { rulesForSession, sessionOrThrow } from './shared';

const { absenceNotices, attendance, makeupBookings, progressMarks } = schema;

export interface LineupRow {
  studentId: string;
  firstName: string;
  lastName: string;
  kind: AttendanceKind;
  /** The enrollment status for members (frozen children are expected to be away). */
  seatStatus: string | null;
  gender: StaffGender | null;
  ageMonths: number | null;
  levelId: string | null;
  levelName: string | null;
  skills: { code: string; he: string; achieved: boolean }[];
  flags: {
    waterFear: boolean;
    femaleInstructor: boolean;
    noPhotos: boolean;
    medical: boolean;
  };
  notice: { status: string; classification: string | null } | null;
  mark: { status: string; minutesLate: number | null; markedAt: Date } | null;
  trialId: string | null;
}

export type Lineup = Awaited<ReturnType<typeof sessionLineup>>;

/** Who is expected in a lesson: seat holders, makeup guests and trials, with flags, notices, marks and skills. */
export async function sessionLineup(tx: Tx, sessionId: string) {
  const session = await sessionOrThrow(tx, sessionId);
  const [seats, guests, trialRows, notices, marks, programs] = await Promise.all([
    seatHoldersOn(tx, [session.classTemplateId], session.date),
    tx
      .select()
      .from(makeupBookings)
      .where(and(eq(makeupBookings.sessionId, sessionId), ne(makeupBookings.status, 'cancelled'))),
    trialsInSessions(tx, [sessionId]),
    tx
      .select()
      .from(absenceNotices)
      .where(and(eq(absenceNotices.sessionId, sessionId), ne(absenceNotices.status, 'withdrawn'))),
    tx.select().from(attendance).where(eq(attendance.sessionId, sessionId)),
    listPrograms(tx),
  ]);
  const trialByStudent = new Map(trialRows.map((t) => [t.studentId, t]));
  const entries: { studentId: string; kind: AttendanceKind; seatStatus: string | null }[] = [
    ...seats.map((e) => ({
      studentId: e.studentId,
      kind: (trialByStudent.has(e.studentId) || e.status === 'trial_booked'
        ? 'trial'
        : 'member') as AttendanceKind,
      seatStatus: e.status,
    })),
    ...guests.map((g) => ({ studentId: g.studentId, kind: 'makeup' as const, seatStatus: null })),
  ];
  const ids = [...new Set(entries.map((e) => e.studentId))];
  const [people, progress] = await Promise.all([
    studentsByIds(tx, ids),
    ids.length
      ? tx.select().from(progressMarks).where(inArray(progressMarks.studentId, ids))
      : Promise.resolve([]),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const levels = new Map(programs.flatMap((p) => p.levels.map((l) => [l.id, l] as const)));
  const rows: LineupRow[] = entries.flatMap((e) => {
    const s = byId.get(e.studentId);
    if (!s) return [];
    const level = s.levelId ? levels.get(s.levelId) : undefined;
    const skills = (level?.skills ?? []) as { code: string; he: string }[];
    const notice = notices.find((n) => n.studentId === s.id);
    const mark = marks.find((m) => m.studentId === s.id);
    return [
      {
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        kind: e.kind,
        seatStatus: e.seatStatus,
        gender: s.gender as StaffGender | null,
        ageMonths: s.dob ? ageInMonths(s.dob, session.date) : null,
        levelId: s.levelId,
        levelName: level?.nameHe ?? null,
        skills: skills.map((k) => ({
          ...k,
          achieved: progress.some(
            (p) => p.studentId === s.id && p.levelId === s.levelId && p.skillCode === k.code,
          ),
        })),
        flags: {
          waterFear: s.waterFear,
          femaleInstructor: s.requiresFemaleInstructor,
          noPhotos: !s.photoConsent,
          medical: s.hasMedicalNotes ?? false,
        },
        notice: notice ? { status: notice.status, classification: notice.classification } : null,
        mark: mark
          ? { status: mark.status, minutesLate: mark.minutesLate, markedAt: mark.markedAt }
          : null,
        trialId: trialByStudent.get(s.id)?.id ?? null,
      },
    ];
  });
  const order: Record<AttendanceKind, number> = { member: 0, trial: 1, makeup: 2 };
  rows.sort(
    (a, b) => order[a.kind] - order[b.kind] || a.firstName.localeCompare(b.firstName, 'he'),
  );
  return { session, rows };
}

export const MarkInput = z.object({
  studentId: z.uuid(),
  status: z.enum(ATTENDANCE_STATUSES),
  minutesLate: z.int().min(0).max(600).nullable().default(null),
  /** The device's id for this tap, so a replayed sync applies once. */
  clientMarkId: z.string().min(8).max(80),
  /** When the instructor tapped, on the device; the latest tap wins. */
  markedAt: z.iso.datetime({ offset: true }),
  note: z.string().max(300).nullable().default(null),
});
export const MarksInput = z.array(MarkInput).min(1).max(100);
export type MarkInput = z.input<typeof MarkInput>;

/**
 * Records a batch of marks for one lesson (the offline queue syncs in batches). Each child keeps their latest tap by
 * device time; a mark replayed with the same id, or older than the stored one, changes nothing. A late arrival past
 * `attendance.late_threshold_min` is stored as an absence.
 */
export async function recordAttendance(
  tx: Tx,
  ctx: ServiceContext,
  sessionId: string,
  raw: readonly MarkInput[],
): Promise<{ applied: number; ignored: number }> {
  const marks = MarksInput.parse(raw);
  const { session, rows } = await sessionLineup(tx, sessionId);
  if (session.status !== 'scheduled' && session.status !== 'completed') {
    throw new DomainError('attendance.errors.sessionNotScheduled');
  }
  const { rules, versionKey } = await rulesForSession(tx, session);
  let applied = 0;
  for (const m of marks) {
    const row = rows.find((r) => r.studentId === m.studentId);
    if (!row) throw new DomainError('attendance.errors.notInSession');
    const status =
      m.status === 'late' ? attendanceStatusForArrival(m.minutesLate, rules).status : m.status;
    const result = await tx
      .insert(attendance)
      .values({
        organizationId: ctx.orgId,
        sessionId,
        studentId: m.studentId,
        kind: row.kind,
        status,
        minutesLate: m.status === 'late' ? m.minutesLate : null,
        note: m.note,
        recordedBy: ctx.userId,
        markedAt: new Date(m.markedAt),
        clientMarkId: m.clientMarkId,
        policyVersionKey: versionKey,
      })
      .onConflictDoUpdate({
        target: [attendance.sessionId, attendance.studentId],
        set: {
          status: sql`excluded.status`,
          minutesLate: sql`excluded.minutes_late`,
          note: sql`excluded.note`,
          recordedBy: sql`excluded.recorded_by`,
          markedAt: sql`excluded.marked_at`,
          clientMarkId: sql`excluded.client_mark_id`,
          policyVersionKey: sql`excluded.policy_version_key`,
        },
        setWhere: sql`${attendance.markedAt} <= excluded.marked_at
          and ${attendance.clientMarkId} is distinct from excluded.client_mark_id`,
      })
      .returning({ id: attendance.id });
    applied += result.length;
  }
  if (applied > 0) {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'attendance.recorded',
      payload: { sessionId, marks: applied },
      idempotencyKey: `attendance.recorded:${sessionId}:${createHash('sha256')
        .update(marks.map((m) => m.clientMarkId).join(','))
        .digest('hex')}`,
    });
  }
  return { applied, ignored: marks.length - applied };
}

export const ProgressInput = z.object({
  studentId: z.uuid(),
  levelId: z.uuid(),
  skillCode: z.string().min(1).max(40),
  sessionId: z.uuid().nullable().default(null),
  achieved: z.boolean(),
});

/** Ticks (or unticks) a level skill for a child, by the signed-in instructor. */
export async function setProgress(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof ProgressInput>,
): Promise<void> {
  const input = ProgressInput.parse(raw);
  if (!input.achieved) {
    await tx
      .delete(progressMarks)
      .where(
        and(
          eq(progressMarks.studentId, input.studentId),
          eq(progressMarks.levelId, input.levelId),
          eq(progressMarks.skillCode, input.skillCode),
        ),
      );
    return;
  }
  await tx
    .insert(progressMarks)
    .values({
      organizationId: ctx.orgId,
      studentId: input.studentId,
      levelId: input.levelId,
      skillCode: input.skillCode,
      achievedOn: sql`app.today()`,
      sessionId: input.sessionId,
      staffMemberId: sql`app.current_staff_member_id()`,
    })
    .onConflictDoNothing();
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.progress_marked',
    payload: { studentId: input.studentId, levelId: input.levelId, skillCode: input.skillCode },
    idempotencyKey: `attendance.progress_marked:${input.studentId}:${input.levelId}:${input.skillCode}`,
  });
}

/** The skills these children achieved, oldest first (RLS: a family reads only their own children's). */
export async function progressMarksOf(tx: Tx, studentIds: readonly string[]) {
  if (studentIds.length === 0) return [];
  return tx
    .select()
    .from(progressMarks)
    .where(inArray(progressMarks.studentId, [...studentIds]))
    .orderBy(asc(progressMarks.achievedOn));
}

export interface ChildProgress {
  studentId: string;
  programName: string | null;
  levelName: string | null;
  /** The level's checklist, each skill with the day it was achieved (null while still working on it). */
  skills: { code: string; name: string; achievedOn: string | null }[];
  nextLevelName: string | null;
}

/** Each child's level, its skills ticked so far and the level after it (the family's progress card). */
export async function childProgress(
  tx: Tx,
  children: readonly { id: string; levelId: string | null }[],
): Promise<ChildProgress[]> {
  const [programs, marks] = await Promise.all([
    listPrograms(tx),
    progressMarksOf(
      tx,
      children.map((c) => c.id),
    ),
  ]);
  return children.map((c) => {
    const program = programs.find((p) => p.levels.some((l) => l.id === c.levelId));
    const index = program?.levels.findIndex((l) => l.id === c.levelId) ?? -1;
    const level = program && index >= 0 ? program.levels[index] : undefined;
    const skills = ((level?.skills ?? []) as { code: string; he?: string; name?: string }[]).map(
      (s) => ({
        code: s.code,
        name: s.he ?? s.name ?? s.code,
        achievedOn:
          marks.find(
            (m) => m.studentId === c.id && m.levelId === level?.id && m.skillCode === s.code,
          )?.achievedOn ?? null,
      }),
    );
    return {
      studentId: c.id,
      programName: program?.nameHe ?? null,
      levelName: level?.nameHe ?? null,
      skills,
      nextLevelName: program && index >= 0 ? (program.levels[index + 1]?.nameHe ?? null) : null,
    };
  });
}

/** The marks recorded for these lessons (an institution's monthly attendance report). */
export async function marksOfSessions(tx: Tx, sessionIds: readonly string[]) {
  if (sessionIds.length === 0) return [];
  return tx
    .select({
      sessionId: attendance.sessionId,
      studentId: attendance.studentId,
      status: attendance.status,
    })
    .from(attendance)
    .where(inArray(attendance.sessionId, [...sessionIds]));
}

/**
 * How many bookings hang on these lessons: makeups and trials still booked, and marks already recorded. A venue
 * migration will not cancel lessons that have any.
 */
export async function bookingsInSessions(tx: Tx, sessionIds: readonly string[]): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const ids = [...sessionIds];
  const [m, tr, a] = await Promise.all([
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(makeupBookings)
      .where(and(inArray(makeupBookings.sessionId, ids), eq(makeupBookings.status, 'booked'))),
    trialsInSessions(tx, ids),
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(attendance)
      .where(inArray(attendance.sessionId, ids)),
  ]);
  return (m[0]?.n ?? 0) + tr.filter((x) => x.status === 'booked').length + (a[0]?.n ?? 0);
}
