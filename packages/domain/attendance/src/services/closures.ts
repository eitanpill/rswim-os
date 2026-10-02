/**
 * The closure workflow (brief §6.5 mass cancellation events): preview what a closure touches, open it (cancel the
 * sessions, issue credits, open the makeup window), report the uptake, and close it with the end rule.
 */
import { z } from 'zod';
import {
  CLOSURE_END_RULES,
  CLOSURE_SOURCES,
  requiredDate,
  requiredText,
  type ClosureEndRule,
  type ClosureSource,
  type CreditStatus,
  type MakeupBookingStatus,
} from '@rswim/contracts';
import { and, desc, eq, inArray, lt, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { cancelTrialsInSessions } from '@rswim/domain-enrollment';
import { studentsByIds } from '@rswim/domain-people';
import {
  cancelSessions,
  countSessionsOfClosure,
  scheduledSessionsInRange,
  seatHoldersOn,
  sessionFacts,
  type SessionFacts,
} from '@rswim/domain-scheduling';
import { loadPolicyResolver } from '@rswim/domain-settings';
import { addClosure } from '@rswim/domain-venues';
import {
  attendanceRulesFrom,
  closureEndActions,
  closureTreatment,
  uptakeReport,
  type ClosureTreatment,
  type Explanation,
} from '../policies';
import { todayIL } from './shared';

const { closureEvents, makeupBookings, makeupCredits } = schema;

const blankToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

export const ClosureEventInput = z
  .object({
    venueId: z.preprocess(blankToNull, z.uuid().nullable()),
    startsOn: requiredDate(),
    endsOn: requiredDate(),
    source: z.enum(CLOSURE_SOURCES),
    reason: requiredText(300),
    /** First day of the makeup window; empty = the day after the closure. */
    makeupFrom: z.preprocess(blankToNull, z.iso.date('forms.errors.date').nullable()),
    makeupDeadline: requiredDate(),
    /** Empty = closure.event_end_rule from the regulations. */
    endRule: z.preprocess(blankToNull, z.enum(CLOSURE_END_RULES).nullable()),
  })
  .refine((c) => c.endsOn >= c.startsOn, {
    message: 'forms.errors.datesReversed',
    path: ['endsOn'],
  })
  .refine((c) => c.makeupDeadline >= (c.makeupFrom ?? c.endsOn), {
    message: 'attendance.errors.deadlineBeforeWindow',
    path: ['makeupDeadline'],
  });
export type ClosureEventInput = z.input<typeof ClosureEventInput>;

export interface AffectedChild {
  studentId: string;
  name: string;
  seatStatus: string;
  getsCredit: boolean;
  why: Explanation;
}

export interface ClosurePreview {
  treatment: ClosureTreatment;
  sessions: (Pick<
    SessionFacts,
    'id' | 'date' | 'startsAt' | 'groupName' | 'venueId' | 'classTemplateId' | 'programId'
  > & {
    treatment: ClosureTreatment;
    policyVersionKey: string;
    children: AffectedChild[];
    guests: number;
  })[];
  totals: { sessions: number; children: number; credits: number; guests: number };
}

const why = (code: string): Explanation => ({ code: `attendance.closure.${code}`, params: {} });

/**
 * What a closure would do, session by session: who held a seat, who gets a credit and why not (frozen children and
 * trials get none; a trial is rebooked instead), and how many makeup guests lose their booking.
 */
export async function previewClosure(
  tx: Tx,
  raw: Pick<ClosureEventInput, 'venueId' | 'startsOn' | 'endsOn' | 'source'>,
): Promise<ClosurePreview> {
  const input = z
    .object({
      venueId: z.preprocess(blankToNull, z.uuid().nullable()),
      startsOn: requiredDate(),
      endsOn: requiredDate(),
      source: z.enum(CLOSURE_SOURCES),
    })
    .parse(raw);
  const [rows, resolve] = await Promise.all([
    scheduledSessionsInRange(tx, {
      venueId: input.venueId,
      from: input.startsOn,
      to: input.endsOn,
    }),
    loadPolicyResolver(tx),
  ]);
  const eventRules = resolve({ date: input.startsOn, venueId: input.venueId });
  const guests = rows.length
    ? await tx
        .select({ sessionId: makeupBookings.sessionId })
        .from(makeupBookings)
        .where(
          and(
            inArray(
              makeupBookings.sessionId,
              rows.map((r) => r.id),
            ),
            eq(makeupBookings.status, 'booked'),
          ),
        )
    : [];
  const sessions: ClosurePreview['sessions'] = [];
  const seen = new Set<string>();
  for (const s of rows) {
    const resolved = resolve({
      date: s.date,
      venueId: s.venueId,
      programId: s.programId,
      classTemplateId: s.classTemplateId,
    });
    const treatment = closureTreatment(input.source, attendanceRulesFrom(resolved.rules));
    const seats = await seatHoldersOn(tx, [s.classTemplateId], s.date);
    const people = new Map(
      (
        await studentsByIds(
          tx,
          seats.map((e) => e.studentId),
        )
      ).map((p) => [p.id, p]),
    );
    const children = seats.map((e): AffectedChild => {
      const p = people.get(e.studentId);
      const eligible = e.status === 'active' || e.status === 'cancel_requested';
      const getsCredit = eligible && treatment.issuesCredits;
      return {
        studentId: e.studentId,
        name: p ? `${p.firstName} ${p.lastName}` : '',
        seatStatus: e.status,
        getsCredit,
        why: why(
          getsCredit
            ? 'credit'
            : e.status === 'frozen'
              ? 'frozen'
              : e.status === 'trial_booked'
                ? 'trial'
                : 'noMakeup',
        ),
      };
    });
    children.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    for (const c of children) seen.add(c.studentId);
    sessions.push({
      id: s.id,
      date: s.date,
      startsAt: s.startsAt,
      groupName: s.groupName,
      venueId: s.venueId,
      classTemplateId: s.classTemplateId,
      programId: s.programId,
      treatment,
      policyVersionKey: resolved.versionKey,
      children,
      guests: guests.filter((g) => g.sessionId === s.id).length,
    });
  }
  return {
    treatment: closureTreatment(input.source, attendanceRulesFrom(eventRules.rules)),
    sessions,
    totals: {
      sessions: sessions.length,
      children: seen.size,
      credits: sessions.reduce((n, s) => n + s.children.filter((c) => c.getsCredit).length, 0),
      guests: sessions.reduce((n, s) => n + s.guests, 0),
    },
  };
}

/** Saves a closure as a draft; nothing changes on the schedule until it is opened. */
export async function createClosureEvent(
  tx: Tx,
  ctx: ServiceContext,
  raw: ClosureEventInput,
): Promise<string> {
  const input = ClosureEventInput.parse(raw);
  const preview = await previewClosure(tx, input);
  const [row] = await tx
    .insert(closureEvents)
    .values({
      organizationId: ctx.orgId,
      venueId: input.venueId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      source: input.source,
      reason: input.reason,
      guarantee: preview.treatment.guarantee,
      makeupFrom: input.makeupFrom ?? sql`${input.endsOn}::date + 1`,
      makeupDeadline: input.makeupDeadline,
      endRule: input.endRule ?? preview.treatment.endRule,
      createdBy: ctx.userId,
    })
    .returning({ id: closureEvents.id });
  return (row as { id: string }).id;
}

async function eventOrThrow(tx: Tx, id: string) {
  const [e] = await tx.select().from(closureEvents).where(eq(closureEvents.id, id));
  if (!e) throw new DomainError('common.errors.notFound');
  return e;
}

/**
 * Opens a draft: records the venue closure (so the generator skips the dates too), cancels every scheduled session in
 * the range, issues one credit per lost lesson to each child holding an active seat (valid from the window's start to
 * the deadline), cancels makeup guests' bookings so their credits are open again, and cancels trials to rebook.
 */
export async function openClosureEvent(tx: Tx, ctx: ServiceContext, id: string) {
  const event = await eventOrThrow(tx, id);
  if (event.status !== 'draft') throw new DomainError('attendance.errors.eventNotDraft');
  const preview = await previewClosure(tx, {
    venueId: event.venueId,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    source: event.source as ClosureSource,
  });
  const venueClosureId = event.venueId
    ? await addClosure(tx, ctx, event.venueId, {
        startsOn: event.startsOn,
        endsOn: event.endsOn,
        source: event.source as ClosureSource,
        reason: event.reason,
      })
    : null;
  const today = await todayIL(tx);
  let cancelled = 0;
  let credits = 0;
  for (const status of ['cancelled_by_school', 'cancelled_external'] as const) {
    const ids = preview.sessions
      .filter((s) => s.treatment.sessionStatus === status)
      .map((s) => s.id);
    cancelled += (
      await cancelSessions(tx, ctx, {
        sessionIds: ids,
        status,
        reason: event.reason,
        closureEventId: id,
      })
    ).length;
  }
  const sessionIds = preview.sessions.map((s) => s.id);
  if (sessionIds.length > 0) {
    await tx
      .update(makeupBookings)
      .set({ status: 'cancelled', cancelledAt: sql`now()` })
      .where(
        and(inArray(makeupBookings.sessionId, sessionIds), eq(makeupBookings.status, 'booked')),
      );
    await cancelTrialsInSessions(tx, ctx, sessionIds, event.reason);
  }
  const values = preview.sessions.flatMap((s) =>
    s.children
      .filter((c) => c.getsCredit)
      .map((c) => ({
        organizationId: ctx.orgId,
        studentId: c.studentId,
        programId: s.programId,
        reason: s.treatment.creditReason,
        sourceSessionId: s.id,
        sourceDate: s.date,
        closureEventId: id,
        issuedOn: today < event.makeupDeadline ? today : event.makeupDeadline,
        validFrom: event.makeupFrom,
        expiresOn: event.makeupDeadline,
        countsTowardCap: s.treatment.countsTowardCap,
        policyVersionKey: s.policyVersionKey,
        createdBy: ctx.userId,
      })),
  );
  if (values.length > 0) {
    credits = (
      await tx
        .insert(makeupCredits)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: makeupCredits.id })
    ).length;
  }
  await tx
    .update(closureEvents)
    .set({
      status: 'open',
      venueClosureId,
      guarantee: preview.treatment.guarantee,
      policyVersionKey: preview.sessions[0]?.policyVersionKey ?? null,
      openedAt: sql`now()`,
    })
    .where(eq(closureEvents.id, id));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.closure_opened',
    payload: {
      closureEventId: id,
      venueId: event.venueId,
      startsOn: event.startsOn,
      endsOn: event.endsOn,
      sessionsCancelled: cancelled,
      creditsIssued: credits,
      makeupDeadline: event.makeupDeadline,
    },
    idempotencyKey: `attendance.closure_opened:${id}`,
  });
  return { sessionsCancelled: cancelled, creditsIssued: credits };
}

/** Deletes a draft the owner decided against. */
export async function discardClosureEvent(tx: Tx, id: string) {
  const rows = await tx
    .update(closureEvents)
    .set({ status: 'cancelled' })
    .where(and(eq(closureEvents.id, id), eq(closureEvents.status, 'draft')))
    .returning({ id: closureEvents.id });
  if (rows.length === 0) throw new DomainError('attendance.errors.eventNotDraft');
}

/**
 * Closes an open event with its end rule: credits nobody booked expire, or are converted (Phase 4 turns
 * `attendance.closure_credits_converted` into ledger entries). Booked credits stay so the lesson still happens.
 */
export async function closeClosureEvent(tx: Tx, ctx: ServiceContext, id: string) {
  const event = await eventOrThrow(tx, id);
  if (event.status !== 'open') throw new DomainError('attendance.errors.eventNotOpen');
  const credits = await tx
    .select({
      id: makeupCredits.id,
      status: makeupCredits.status,
      studentId: makeupCredits.studentId,
    })
    .from(makeupCredits)
    .where(eq(makeupCredits.closureEventId, id));
  const actions = closureEndActions(
    credits.map((c) => ({ id: c.id, status: c.status as CreditStatus })),
    event.endRule as ClosureEndRule,
  );
  if (actions.expire.length > 0) {
    await tx
      .update(makeupCredits)
      .set({ status: 'expired' })
      .where(inArray(makeupCredits.id, actions.expire));
  }
  if (actions.convert.length > 0) {
    await tx
      .update(makeupCredits)
      .set({ status: 'converted' })
      .where(inArray(makeupCredits.id, actions.convert));
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'attendance.closure_credits_converted',
      payload: {
        closureEventId: id,
        endRule: event.endRule,
        credits: credits
          .filter((c) => actions.convert.includes(c.id))
          .map((c) => ({ creditId: c.id, studentId: c.studentId })),
      },
      idempotencyKey: `attendance.closure_credits_converted:${id}`,
    });
  }
  await tx
    .update(closureEvents)
    .set({ status: 'closed', closedAt: sql`now()` })
    .where(eq(closureEvents.id, id));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.closure_closed',
    payload: {
      closureEventId: id,
      expired: actions.expire.length,
      converted: actions.convert.length,
    },
    idempotencyKey: `attendance.closure_closed:${id}`,
  });
  return { expired: actions.expire.length, converted: actions.convert.length };
}

/** Daily: open events whose makeup deadline has passed are closed. */
export async function closeDueClosureEvents(tx: Tx, ctx: ServiceContext): Promise<number> {
  const today = await todayIL(tx);
  const due = await tx
    .select({ id: closureEvents.id })
    .from(closureEvents)
    .where(and(eq(closureEvents.status, 'open'), lt(closureEvents.makeupDeadline, today)));
  for (const e of due) await closeClosureEvent(tx, ctx, e.id);
  return due.length;
}

export async function listClosureEvents(tx: Tx) {
  return tx
    .select()
    .from(closureEvents)
    .where(ne(closureEvents.status, 'cancelled'))
    .orderBy(desc(closureEvents.startsOn));
}

/** The event with its uptake report: credits issued per group and where each one is now. */
export async function closureReport(tx: Tx, id: string) {
  const event = await eventOrThrow(tx, id);
  const credits = await tx.select().from(makeupCredits).where(eq(makeupCredits.closureEventId, id));
  const sources = new Map(
    (
      await sessionFacts(tx, [
        ...new Set(credits.map((c) => c.sourceSessionId).filter((x): x is string => x !== null)),
      ])
    ).map((s) => [s.id, s]),
  );
  const bookings = credits.length
    ? await tx
        .select()
        .from(makeupBookings)
        .where(
          and(
            inArray(
              makeupBookings.creditId,
              credits.map((c) => c.id),
            ),
            ne(makeupBookings.status, 'cancelled'),
          ),
        )
    : [];
  const report = uptakeReport(
    credits.map((c) => {
      const s = c.sourceSessionId ? sources.get(c.sourceSessionId) : undefined;
      return {
        id: c.id,
        groupId: s?.classTemplateId ?? '',
        groupName: s?.groupName ?? '',
        status: c.status as CreditStatus,
        bookingStatus:
          (bookings.find((b) => b.creditId === c.id)?.status as MakeupBookingStatus | undefined) ??
          null,
      };
    }),
  );
  return { event, report, sessionsCancelled: await countSessionsOfClosure(tx, id) };
}
