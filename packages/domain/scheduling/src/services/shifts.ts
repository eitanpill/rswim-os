/**
 * The change-protection rule (brief §6.3, Phase 2 AC 3). A change to an instructor's shift is recorded as pending and
 * changes nothing on the schedule. The instructor answers in the instructor app; an accepted change is applied by the
 * worker (`scheduling-apply-shift-change`), and only the applied change emits `scheduling.staff_changed`, which is
 * what Phase 5 turns into messages to parents. Unanswered changes escalate to the owner.
 */
import { z } from 'zod';
import { optionalText, requiredDate, TimeOfDay, type ShiftChangeKind } from '@rswim/contracts';
import { and, asc, desc, eq, gte, inArray, lte, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import {
  checkInstructor,
  planShiftChange,
  toMinutes,
  windowFor,
  type TemplateDraft,
} from '../policies';
import {
  activeTemplates,
  instructorFacts,
  localInstant,
  poolWindows,
  refuse,
  rulesFor,
} from './shared';

const { classTemplates, classTemplateLanes, sessions, sessionStaff, shiftChanges } = schema;

export const ShiftChangeInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('reassign_group'),
    classTemplateId: z.uuid(),
    effectiveFrom: requiredDate(),
    toStaffId: z.uuid(),
    reason: optionalText(300),
  }),
  z.object({
    kind: z.literal('reassign_session'),
    sessionId: z.uuid(),
    toStaffId: z.uuid(),
    reason: optionalText(300),
  }),
  z.object({
    kind: z.literal('reschedule_session'),
    sessionId: z.uuid(),
    startsAt: TimeOfDay,
    endsAt: TimeOfDay,
    reason: optionalText(300),
  }),
]);
export type ShiftChangeInput = z.infer<typeof ShiftChangeInput>;

export const AnswerInput = z.object({
  accept: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
  note: optionalText(300),
});

async function groupOf(tx: Tx, id: string) {
  const [g] = await tx.select().from(classTemplates).where(eq(classTemplates.id, id));
  if (!g) throw new DomainError('common.errors.notFound');
  const lanes = await tx
    .select()
    .from(classTemplateLanes)
    .where(eq(classTemplateLanes.classTemplateId, id));
  return { ...g, laneIds: lanes.map((l) => l.laneId) };
}

async function sessionOf(tx: Tx, id: string) {
  const [s] = await tx
    .select({
      id: sessions.id,
      date: sessions.date,
      classTemplateId: sessions.classTemplateId,
      leadStaffId: sessionStaff.staffMemberId,
    })
    .from(sessions)
    .leftJoin(
      sessionStaff,
      and(eq(sessionStaff.sessionId, sessions.id), eq(sessionStaff.role, 'lead')),
    )
    .where(eq(sessions.id, id));
  if (!s) throw new DomainError('common.errors.notFound');
  return s;
}

const draftOf = (g: Awaited<ReturnType<typeof groupOf>>, leadStaffId: string): TemplateDraft => ({
  id: g.id,
  venueId: g.venueId,
  poolId: g.poolId,
  weekday: g.weekday,
  startsAt: g.startsAt,
  durationMin: g.durationMin,
  laneIds: g.laneIds,
  admittedGender: g.admittedGender as TemplateDraft['admittedGender'],
  ageMinMonths: g.ageMinMonths,
  effectiveFrom: g.effectiveFrom,
  effectiveTo: g.effectiveTo,
  requiredInstructorGender: g.requiredInstructorGender as TemplateDraft['requiredInstructorGender'],
  requiredSkills: g.requiredSkills,
  leadStaffId,
});

/** Can this instructor take this group (from a date, or on one session's date and time)? Throws the first reason not. */
async function assertInstructorFits(
  tx: Tx,
  group: Awaited<ReturnType<typeof groupOf>>,
  staffId: string,
  onDate: string,
  scheduling: Awaited<ReturnType<typeof rulesFor>>['scheduling'],
  time?: { startsAt: string; durationMin: number },
) {
  const [instructor, windows, others] = await Promise.all([
    instructorFacts(tx, staffId),
    poolWindows(tx, group.poolId),
    activeTemplates(tx),
  ]);
  const draft = { ...draftOf(group, staffId), effectiveFrom: onDate, ...time };
  const window = windowFor(draft, windows);
  refuse(checkInstructor(draft, instructor, others, scheduling, window, onDate).violations);
}

/**
 * Records a shift change after checking the new instructor can take it. When the policy needs no acceptance (or the
 * instructor asked themself), it is applied at once in the same transaction.
 */
export async function requestShiftChange(
  tx: Tx,
  ctx: ServiceContext,
  input: ShiftChangeInput,
  requestedByStaffId: string | null = null,
): Promise<{ id: string; status: 'pending' | 'applied' }> {
  let group: Awaited<ReturnType<typeof groupOf>>;
  let currentStaffId: string | null;
  let onDate: string;
  let session: Awaited<ReturnType<typeof sessionOf>> | null = null;
  if (input.kind === 'reassign_group') {
    group = await groupOf(tx, input.classTemplateId);
    currentStaffId = group.leadStaffId;
    onDate = input.effectiveFrom;
  } else {
    session = await sessionOf(tx, input.sessionId);
    group = await groupOf(tx, session.classTemplateId);
    currentStaffId = session.leadStaffId;
    onDate = session.date;
  }
  const toStaffId = input.kind === 'reschedule_session' ? null : input.toStaffId;
  const rules = await rulesFor(tx, {
    date: onDate,
    venueId: group.venueId,
    programId: group.programId,
    classTemplateId: group.id,
  });
  const plan = planShiftChange({
    kind: input.kind,
    currentStaffId,
    toStaffId,
    requestedByStaffId,
    requestedAt: new Date(),
    ...rules.staffing,
  });
  if (!plan.ok) throw new DomainError(plan.code);
  if (input.kind === 'reschedule_session') {
    const durationMin = toMinutes(input.endsAt) - toMinutes(input.startsAt);
    if (durationMin <= 0) throw new DomainError('forms.errors.timesReversed');
    await assertInstructorFits(tx, group, plan.respondentStaffId, onDate, rules.scheduling, {
      startsAt: input.startsAt,
      durationMin,
    });
  } else {
    await assertInstructorFits(tx, group, plan.respondentStaffId, onDate, rules.scheduling);
  }
  const open = await tx
    .select({ id: shiftChanges.id })
    .from(shiftChanges)
    .where(
      and(
        inArray(shiftChanges.status, ['pending', 'accepted', 'escalated']),
        session
          ? eq(shiftChanges.sessionId, session.id)
          : eq(shiftChanges.classTemplateId, group.id),
      ),
    );
  if (open.length > 0) throw new DomainError('scheduling.shift.alreadyPending');

  const [row] = await tx
    .insert(shiftChanges)
    .values({
      organizationId: ctx.orgId,
      kind: input.kind,
      classTemplateId: group.id,
      sessionId: session?.id ?? null,
      effectiveFrom: input.kind === 'reassign_group' ? input.effectiveFrom : null,
      fromStaffId: currentStaffId,
      toStaffId,
      newStartsAt:
        input.kind === 'reschedule_session' ? localInstant(onDate, input.startsAt) : null,
      newEndsAt: input.kind === 'reschedule_session' ? localInstant(onDate, input.endsAt) : null,
      respondentStaffId: plan.respondentStaffId,
      status: 'pending',
      reason: input.reason,
      requestedBy: ctx.userId,
      escalateAt: plan.escalateAt,
    })
    .returning({ id: shiftChanges.id });
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.shift_change_requested',
    payload: { shiftChangeId: id, kind: input.kind, respondentStaffId: plan.respondentStaffId },
    idempotencyKey: `scheduling.shift_change_requested:${id}`,
  });
  if (!plan.needsAcceptance) {
    await applyShiftChange(tx, ctx, id, { withoutAcceptance: true });
    return { id, status: 'applied' };
  }
  return { id, status: 'pending' };
}

/**
 * The instructor's answer. Runs as the instructor: RLS and the guard trigger let them change only the status (to
 * accepted or declined) and the note of a pending change addressed to them. The worker applies an acceptance.
 */
export async function answerShiftChange(
  tx: Tx,
  ctx: ServiceContext,
  id: string,
  answer: z.infer<typeof AnswerInput>,
) {
  const updated = await tx
    .update(shiftChanges)
    .set({ status: answer.accept ? 'accepted' : 'declined', responseNote: answer.note })
    .where(and(eq(shiftChanges.id, id), eq(shiftChanges.status, 'pending')))
    .returning({ id: shiftChanges.id });
  if (updated.length === 0) throw new DomainError('scheduling.shift.notPending');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.shift_change_answered',
    payload: { shiftChangeId: id, accepted: answer.accept },
    idempotencyKey: `scheduling.shift_change_answered:${id}`,
  });
}

/**
 * Puts a change on the schedule. An accepted change is applied by the worker; the owner may apply an escalated or
 * pending one herself (`withoutAcceptance`), which is recorded. Applying twice is a no-op.
 */
export async function applyShiftChange(
  tx: Tx,
  ctx: ServiceContext,
  id: string,
  opts: { withoutAcceptance?: boolean } = {},
): Promise<boolean> {
  const [c] = await tx.select().from(shiftChanges).where(eq(shiftChanges.id, id)).for('update');
  if (!c) throw new DomainError('common.errors.notFound');
  if (c.status === 'applied') return false;
  const allowed = opts.withoutAcceptance ? ['pending', 'escalated', 'accepted'] : ['accepted'];
  if (!allowed.includes(c.status)) throw new DomainError('scheduling.shift.notAccepted');

  let sessionIds: string[] = [];
  if (c.kind === 'reassign_group') {
    const to = c.toStaffId as string;
    await tx
      .update(classTemplates)
      .set({ leadStaffId: to })
      .where(eq(classTemplates.id, c.classTemplateId as string));
    const ahead = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.classTemplateId, c.classTemplateId as string),
          gte(sessions.date, c.effectiveFrom as string),
          eq(sessions.status, 'scheduled'),
        ),
      );
    sessionIds = ahead.map((s) => s.id);
    await setLead(tx, ctx, sessionIds, to);
  } else if (c.kind === 'reassign_session') {
    sessionIds = [c.sessionId as string];
    await setLead(tx, ctx, sessionIds, c.toStaffId as string);
  } else {
    sessionIds = [c.sessionId as string];
    await tx
      .update(sessions)
      .set({ startsAt: c.newStartsAt as Date, endsAt: c.newEndsAt as Date })
      .where(eq(sessions.id, c.sessionId as string));
  }
  await tx
    .update(shiftChanges)
    .set({
      status: 'applied',
      appliedAt: new Date(),
      responseNote:
        opts.withoutAcceptance && c.status !== 'accepted'
          ? (c.responseNote ?? 'applied_without_acceptance')
          : c.responseNote,
    })
    .where(eq(shiftChanges.id, id));
  // The one event that may reach parents (Phase 5), and only now, after the instructor accepted.
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.staff_changed',
    payload: {
      shiftChangeId: id,
      kind: c.kind as ShiftChangeKind,
      classTemplateId: c.classTemplateId,
      sessionIds,
      fromStaffId: c.fromStaffId,
      toStaffId: c.toStaffId,
      acceptedByInstructor: c.status === 'accepted',
    },
    idempotencyKey: `scheduling.staff_changed:${id}`,
  });
  return true;
}

export async function setLead(
  tx: Tx,
  ctx: ServiceContext,
  sessionIds: readonly string[],
  staffId: string,
) {
  if (sessionIds.length === 0) return;
  await tx
    .delete(sessionStaff)
    .where(and(inArray(sessionStaff.sessionId, [...sessionIds]), eq(sessionStaff.role, 'lead')));
  // The new lead may already be on the session as an assistant: they become the lead.
  await tx
    .delete(sessionStaff)
    .where(
      and(
        inArray(sessionStaff.sessionId, [...sessionIds]),
        eq(sessionStaff.staffMemberId, staffId),
      ),
    );
  await tx.insert(sessionStaff).values(
    sessionIds.map((sessionId) => ({
      organizationId: ctx.orgId,
      sessionId,
      staffMemberId: staffId,
      role: 'lead',
    })),
  );
}

/** The owner withdraws a change that is not on the schedule yet. */
export async function cancelShiftChange(tx: Tx, ctx: ServiceContext, id: string) {
  const updated = await tx
    .update(shiftChanges)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(shiftChanges.id, id),
        inArray(shiftChanges.status, ['pending', 'escalated', 'declined', 'accepted']),
      ),
    )
    .returning({ id: shiftChanges.id });
  if (updated.length === 0) throw new DomainError('scheduling.shift.notPending');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.shift_change_cancelled',
    payload: { shiftChangeId: id },
    idempotencyKey: `scheduling.shift_change_cancelled:${id}`,
  });
}

/** Worker job: pending changes past their escalation time go to the owner's "needs you" list. */
export async function escalateDueShiftChanges(tx: Tx, ctx: ServiceContext, now = new Date()) {
  const due = await tx
    .update(shiftChanges)
    .set({ status: 'escalated' })
    .where(and(eq(shiftChanges.status, 'pending'), lte(shiftChanges.escalateAt, now)))
    .returning({ id: shiftChanges.id, respondentStaffId: shiftChanges.respondentStaffId });
  for (const c of due) {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'scheduling.shift_change_escalated',
      payload: { shiftChangeId: c.id, respondentStaffId: c.respondentStaffId },
      idempotencyKey: `scheduling.shift_change_escalated:${c.id}`,
    });
  }
  return due.length;
}

export type ShiftChangeRow = Awaited<ReturnType<typeof listShiftChanges>>[number];

/**
 * Changes with what they are about. RLS decides whose: the owner sees all, an instructor those that involve them.
 */
export async function listShiftChanges(
  tx: Tx,
  filter: { statuses?: readonly string[]; limit?: number; awaitingMe?: boolean } = {},
) {
  return tx
    .select({
      id: shiftChanges.id,
      kind: shiftChanges.kind,
      status: shiftChanges.status,
      classTemplateId: shiftChanges.classTemplateId,
      groupName: classTemplates.name,
      venueId: classTemplates.venueId,
      weekday: classTemplates.weekday,
      groupStartsAt: classTemplates.startsAt,
      durationMin: classTemplates.durationMin,
      sessionId: shiftChanges.sessionId,
      sessionDate: sessions.date,
      sessionStartsAt: sessions.startsAt,
      effectiveFrom: shiftChanges.effectiveFrom,
      fromStaffId: shiftChanges.fromStaffId,
      toStaffId: shiftChanges.toStaffId,
      respondentStaffId: shiftChanges.respondentStaffId,
      newStartsAt: shiftChanges.newStartsAt,
      newEndsAt: shiftChanges.newEndsAt,
      reason: shiftChanges.reason,
      escalateAt: shiftChanges.escalateAt,
      respondedAt: shiftChanges.respondedAt,
      responseNote: shiftChanges.responseNote,
      appliedAt: shiftChanges.appliedAt,
      createdAt: shiftChanges.createdAt,
    })
    .from(shiftChanges)
    .leftJoin(sessions, eq(sessions.id, shiftChanges.sessionId))
    .leftJoin(
      classTemplates,
      eq(
        classTemplates.id,
        sql`coalesce(${shiftChanges.classTemplateId}, ${sessions.classTemplateId})`,
      ),
    )
    .where(
      and(
        filter.statuses ? inArray(shiftChanges.status, [...filter.statuses]) : undefined,
        // The signed-in instructor's own answers to give (instructor app).
        filter.awaitingMe
          ? sql`${shiftChanges.respondentStaffId} = app.current_staff_member_id()`
          : undefined,
      ),
    )
    .orderBy(
      asc(
        sql`case ${shiftChanges.status} when 'escalated' then 0 when 'pending' then 1 when 'accepted' then 2 else 3 end`,
      ),
      desc(shiftChanges.createdAt),
    )
    .limit(filter.limit ?? 100);
}
