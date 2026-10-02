/**
 * The makeup marketplace (brief §6.4): where a credit can be spent, and booking it. Seats come from
 * app.makeup_session_facts, which tells a family how many seats are free and what a group admits, never who is in it.
 * The booking trigger re-checks the credit and the seat under a row lock.
 */
import { z } from 'zod';
import {
  optionalText,
  type CreditStatus,
  type GenderRestriction,
  type StaffGender,
} from '@rswim/contracts';
import { and, eq, inArray, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { studentsByIds } from '@rswim/domain-people';
import {
  ADULT_AGE_MONTHS,
  ageInMonths,
  seatsOfStudent,
  sessionFacts,
} from '@rswim/domain-scheduling';
import { listPrograms, resolvePolicyFor } from '@rswim/domain-settings';
import {
  attendanceRulesFrom,
  canBookMakeup,
  makeupCandidates,
  type BookingDecision,
  type MakeupFit,
  type MarketSession,
} from '../policies';
import { guarded, isOffice, todayIL } from './shared';

const { makeupBookings, makeupCredits } = schema;

interface FactsRow extends Record<string, unknown> {
  session_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  class_template_id: string;
  template_name: string;
  program_id: string;
  venue_id: string;
  venue_name: string;
  admitted_gender: string;
  age_min_months: number | null;
  age_max_months: number | null;
  level_min_ordinal: number | null;
  level_max_ordinal: number | null;
  window_restriction: string | null;
  lead_gender: string | null;
  free_seats: number;
}

export interface MakeupOffer {
  sessionId: string;
  date: string;
  startsAt: Date;
  endsAt: Date;
  groupName: string;
  venueName: string;
  freeSeats: number;
  fit: MakeupFit;
  decision: BookingDecision;
}

/**
 * Every session in the credit's life with a decision for the caller: the family sees clean fits; the office also sees
 * soft-rule fits it may book with an override. Sessions that break a hard rule are left out unless `all`.
 */
export async function makeupOffers(
  tx: Tx,
  creditId: string,
  opts: { all?: boolean; overrideNote?: string | null } = {},
): Promise<{ credit: typeof makeupCredits.$inferSelect; offers: MakeupOffer[] }> {
  const [credit] = await tx.select().from(makeupCredits).where(eq(makeupCredits.id, creditId));
  if (!credit) throw new DomainError('common.errors.notFound');
  const today = await todayIL(tx);
  const [[student], programs, seats, office, resolved] = await Promise.all([
    studentsByIds(tx, [credit.studentId]),
    listPrograms(tx),
    seatsOfStudent(tx, credit.studentId, today),
    isOffice(tx),
    resolvePolicyFor(tx, { date: today, programId: credit.programId }),
  ]);
  if (!student) throw new DomainError('common.errors.notFound');
  const rules = attendanceRulesFrom(resolved.rules);
  const levels = new Map(programs.flatMap((p) => p.levels.map((l) => [l.id, l] as const)));
  const from = credit.validFrom && credit.validFrom > today ? credit.validFrom : today;
  const facts =
    credit.status === 'open' && from <= credit.expiresOn
      ? ((
          await tx.execute<FactsRow>(
            sql`select * from app.makeup_session_facts(${from}::date, ${credit.expiresOn}::date)`,
          )
        ).rows as FactsRow[])
      : [];
  const months = student.dob ? ageInMonths(student.dob, today) : null;
  const market: MarketSession[] = facts.map((f) => ({
    sessionId: f.session_id,
    date: String(f.date),
    classTemplateId: f.class_template_id,
    programId: f.program_id,
    admittedGender: f.admitted_gender as MarketSession['admittedGender'],
    ageMinMonths: f.age_min_months,
    ageMaxMonths: f.age_max_months,
    levelMinOrdinal: f.level_min_ordinal,
    levelMaxOrdinal: f.level_max_ordinal,
    windowRestriction: f.window_restriction as GenderRestriction | null,
    leadGender: f.lead_gender as StaffGender | null,
    freeSeats: f.free_seats,
  }));
  const fits = makeupCandidates(
    {
      id: student.id,
      firstName: student.firstName,
      gender: student.gender as StaffGender | null,
      ageMonths: months,
      isAdult: months !== null && months >= ADULT_AGE_MONTHS,
      levelOrdinal: student.levelId ? (levels.get(student.levelId)?.ordinal ?? null) : null,
      requiresFemaleInstructor: student.requiresFemaleInstructor,
      ownTemplateIds: seats.map((s) => s.classTemplateId),
    },
    {
      id: credit.id,
      programId: credit.programId,
      status: credit.status as CreditStatus,
      expiresOn: credit.expiresOn,
      windowFrom: credit.validFrom,
    },
    market,
    rules,
    today,
  );
  const hasActive = seats.some((s) => s.status === 'active' && s.startsOn <= today);
  const offers = facts.flatMap((f, i) => {
    const fit = fits[i] as MakeupFit;
    if (fit.hard.length > 0 && !opts.all) return [];
    const decision = canBookMakeup(
      {
        actor: office ? 'office' : 'family',
        credit: { status: credit.status as CreditStatus },
        fit,
        hasActiveEnrollment: hasActive,
        overrideNote: opts.overrideNote ?? null,
      },
      rules,
    );
    if (!office && !decision.ok && !opts.all) return [];
    return [
      {
        sessionId: f.session_id,
        date: String(f.date),
        startsAt: new Date(f.starts_at),
        endsAt: new Date(f.ends_at),
        groupName: f.template_name,
        venueName: f.venue_name,
        freeSeats: f.free_seats,
        fit,
        decision,
      },
    ];
  });
  return { credit, offers };
}

export const BookMakeupInput = z.object({
  creditId: z.uuid(),
  sessionId: z.uuid(),
  overrideNote: optionalText(300),
});

/** Books a credit into a session after the rules pass (and an override note, where the office needs one). */
export async function bookMakeup(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof BookMakeupInput>,
): Promise<string> {
  const input = BookMakeupInput.parse(raw);
  const { credit, offers } = await makeupOffers(tx, input.creditId, {
    all: true,
    overrideNote: input.overrideNote,
  });
  const offer = offers.find((o) => o.sessionId === input.sessionId);
  if (!offer) throw new DomainError('attendance.errors.notOffered');
  const first = offer.decision.violations[0];
  if (first) throw new DomainError(first.code, first.params);
  const [row] = await guarded(() =>
    tx
      .insert(makeupBookings)
      .values({
        organizationId: ctx.orgId,
        creditId: credit.id,
        sessionId: input.sessionId,
        studentId: credit.studentId,
        bookedBy: ctx.userId,
        overrideNote: offer.decision.overridden.length > 0 ? input.overrideNote : null,
      })
      .returning({ id: makeupBookings.id }),
  );
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.makeup_booked',
    payload: {
      bookingId: id,
      creditId: credit.id,
      studentId: credit.studentId,
      sessionId: input.sessionId,
      overridden: offer.decision.overridden.map((o) => o.code),
    },
    idempotencyKey: `attendance.makeup_booked:${id}`,
  });
  return id;
}

/** Cancels a booking; the credit is open again (or expired, past its last day). */
export async function cancelMakeupBooking(tx: Tx, ctx: ServiceContext, bookingId: string) {
  const rows = await guarded(() =>
    tx
      .update(makeupBookings)
      .set({ status: 'cancelled', cancelledAt: sql`now()` })
      .where(and(eq(makeupBookings.id, bookingId), eq(makeupBookings.status, 'booked')))
      .returning({ id: makeupBookings.id, creditId: makeupBookings.creditId }),
  );
  if (rows.length === 0) throw new DomainError('attendance.errors.cannotCancelBooking');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.makeup_cancelled',
    payload: { bookingId, creditId: (rows[0] as { creditId: string }).creditId },
    idempotencyKey: `attendance.makeup_cancelled:${bookingId}`,
  });
}

/** Live bookings of some credits, with their session (the family's credits page and the closure report). */
export async function bookingsOfCredits(tx: Tx, creditIds: readonly string[]) {
  if (creditIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(makeupBookings)
    .where(
      and(inArray(makeupBookings.creditId, [...creditIds]), ne(makeupBookings.status, 'cancelled')),
    );
  const sessions = new Map(
    (await sessionFacts(tx, [...new Set(rows.map((r) => r.sessionId))])).map((s) => [s.id, s]),
  );
  return rows.map((b) => {
    const s = sessions.get(b.sessionId);
    return {
      id: b.id,
      creditId: b.creditId,
      sessionId: b.sessionId,
      status: b.status,
      date: s?.date ?? null,
      startsAt: s?.startsAt ?? null,
      groupName: s?.groupName ?? null,
    };
  });
}
