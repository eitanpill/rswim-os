/**
 * Lead → trial → enrollment (brief §6.2): a trial is one seat in one lesson, the instructor's verdict opens an offer
 * window, and conversion places the child in a group with the trial-fee offset announced for billing (Phase 4).
 */
import { z } from 'zod';
import { optionalText, requiredDate, TRIAL_OUTCOMES } from '@rswim/contracts';
import { and, asc, eq, gte, inArray, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { studentsByIds } from '@rswim/domain-people';
import { endSeatAfter, placeStudent, sessionFacts } from '@rswim/domain-scheduling';
import { priceFor, resolvePolicyFor } from '@rswim/domain-settings';
import { enrollmentRulesFrom, offerValidUntil, trialOffset } from '../policies';
import { formsDueForStudent } from './forms';

const { trials } = schema;

const blankToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

export const TrialInput = z.object({
  studentId: z.uuid(),
  sessionId: z.uuid(),
  notes: optionalText(500),
});

async function sessionOrThrow(tx: Tx, sessionId: string) {
  const [s] = await sessionFacts(tx, [sessionId]);
  if (!s) throw new DomainError('common.errors.notFound');
  return s;
}

/**
 * Books a trial: a `trial_booked` seat in the session's group for that day only (the placement rules apply: age,
 * gender, level, a free seat), with the trial price from the price list in force.
 */
export async function bookTrial(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof TrialInput>,
): Promise<string> {
  const input = TrialInput.parse(raw);
  const s = await sessionOrThrow(tx, input.sessionId);
  if (s.status !== 'scheduled' || s.startsAt.getTime() <= Date.now()) {
    throw new DomainError('enrollment.errors.sessionNotBookable');
  }
  const { enrollmentId } = await placeStudent(tx, ctx, {
    studentId: input.studentId,
    toTemplateId: s.classTemplateId,
    fromTemplateId: null,
    onDate: s.date,
    status: 'trial_booked',
  });
  await endSeatAfter(tx, enrollmentId, s.date);
  const price = await priceFor(tx, {
    date: s.date,
    venueId: s.venueId,
    programId: s.programId,
    kind: 'trial',
  });
  const [row] = await tx
    .insert(trials)
    .values({
      organizationId: ctx.orgId,
      studentId: input.studentId,
      sessionId: s.id,
      classTemplateId: s.classTemplateId,
      enrollmentId,
      date: s.date,
      feeAgorot: price ? Number(price.amount) : null,
      notes: input.notes,
      createdBy: ctx.userId,
    })
    .returning({ id: trials.id });
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'enrollment.trial_booked',
    payload: {
      trialId: id,
      studentId: input.studentId,
      sessionId: s.id,
      date: s.date,
      feeAgorot: price ? Number(price.amount) : null,
    },
    idempotencyKey: `enrollment.trial_booked:${id}`,
  });
  return id;
}

/** Cancels a booked trial; its one-day seat goes (sync_trial_seat). */
export async function cancelTrial(tx: Tx, ctx: ServiceContext, trialId: string, reason?: string) {
  const rows = await tx
    .update(trials)
    .set({ status: 'cancelled', notes: reason ?? null })
    .where(and(eq(trials.id, trialId), eq(trials.status, 'booked')))
    .returning({ id: trials.id, studentId: trials.studentId });
  const row = rows[0];
  if (!row) throw new DomainError('enrollment.errors.trialNotBooked');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'enrollment.trial_cancelled',
    payload: { trialId, studentId: row.studentId },
    idempotencyKey: `enrollment.trial_cancelled:${trialId}`,
  });
}

/** A closure cancels the trials in its sessions; the office rebooks them. */
export async function cancelTrialsInSessions(
  tx: Tx,
  ctx: ServiceContext,
  sessionIds: readonly string[],
  reason: string,
) {
  const booked = await tx
    .select({ id: trials.id })
    .from(trials)
    .where(and(inArray(trials.sessionId, [...sessionIds]), eq(trials.status, 'booked')));
  for (const t of booked) await cancelTrial(tx, ctx, t.id, reason);
  return booked.length;
}

export const VerdictInput = z
  .object({
    attended: z.preprocess((v) => v === 'true' || v === true || v === 'on', z.boolean()),
    outcome: z.preprocess(blankToNull, z.enum(TRIAL_OUTCOMES).nullable()),
    recommendedLevelId: z.preprocess(blankToNull, z.uuid().nullable()),
    recommendedTemplateId: z.preprocess(blankToNull, z.uuid().nullable()),
    note: optionalText(1000),
  })
  .refine((v) => !v.attended || v.outcome !== null, {
    message: 'forms.errors.required',
    path: ['outcome'],
  });
export type VerdictInput = z.input<typeof VerdictInput>;

/**
 * The instructor's (or the office's) verdict: attended or not, fit or not, the level and group they recommend. The
 * offer window for the trial-fee offset starts on the trial day (`trial.offset.valid_days`).
 */
export async function recordTrialVerdict(
  tx: Tx,
  ctx: ServiceContext,
  trialId: string,
  raw: VerdictInput,
) {
  const input = VerdictInput.parse(raw);
  const [t] = await tx.select().from(trials).where(eq(trials.id, trialId));
  if (!t || t.status === 'cancelled') throw new DomainError('common.errors.notFound');
  const s = await sessionOrThrow(tx, t.sessionId);
  const resolved = await resolvePolicyFor(tx, {
    date: t.date,
    venueId: s.venueId,
    programId: s.programId,
    classTemplateId: s.classTemplateId,
  });
  const rules = enrollmentRulesFrom(resolved.rules);
  await tx
    .update(trials)
    .set({
      status: input.attended ? 'attended' : 'no_show',
      outcome: input.attended ? input.outcome : null,
      recommendedLevelId: input.recommendedLevelId,
      recommendedTemplateId: input.recommendedTemplateId,
      verdictNote: input.note,
      verdictBy: ctx.userId,
      verdictAt: sql`now()`,
      offerValidUntil: input.attended ? offerValidUntil(t.date, rules) : null,
    })
    .where(eq(trials.id, trialId));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'enrollment.trial_verdict',
    payload: {
      trialId,
      studentId: t.studentId,
      attended: input.attended,
      outcome: input.outcome,
      recommendedTemplateId: input.recommendedTemplateId,
    },
    idempotencyKey: `enrollment.trial_verdict:${trialId}:${input.attended}:${input.outcome}`,
  });
}

export const ConvertInput = z.object({
  templateId: z.uuid(),
  startsOn: requiredDate(),
});

/**
 * Converts a trial into an active place once the household's required forms are accepted. The trial-fee offset and
 * its explanation travel in `enrollment.trial_converted` for the first payment link (Phase 4).
 */
export async function convertTrial(
  tx: Tx,
  ctx: ServiceContext,
  trialId: string,
  raw: z.input<typeof ConvertInput>,
) {
  const input = ConvertInput.parse(raw);
  const [t] = await tx.select().from(trials).where(eq(trials.id, trialId));
  if (!t) throw new DomainError('common.errors.notFound');
  if (t.status !== 'attended') throw new DomainError('enrollment.errors.trialNotAttended');
  if (t.convertedEnrollmentId) throw new DomainError('enrollment.errors.alreadyConverted');
  const [student] = await studentsByIds(tx, [t.studentId]);
  if (!student) throw new DomainError('common.errors.notFound');
  const missing = await formsDueForStudent(tx, student.householdId, student.id);
  if (missing.length > 0) {
    throw new DomainError('enrollment.errors.formsMissing', { count: missing.length });
  }
  const { enrollmentId } = await placeStudent(tx, ctx, {
    studentId: t.studentId,
    toTemplateId: input.templateId,
    fromTemplateId: null,
    onDate: input.startsOn,
    status: 'active',
  });
  const s = await sessionOrThrow(tx, t.sessionId);
  const resolved = await resolvePolicyFor(tx, {
    date: t.date,
    venueId: s.venueId,
    programId: s.programId,
    classTemplateId: s.classTemplateId,
  });
  const offset = trialOffset(
    { feeAgorot: t.feeAgorot, trialDate: t.date, enrollDate: input.startsOn },
    enrollmentRulesFrom(resolved.rules),
  );
  await tx
    .update(trials)
    .set({ convertedEnrollmentId: enrollmentId })
    .where(eq(trials.id, trialId));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'enrollment.trial_converted',
    payload: {
      trialId,
      studentId: t.studentId,
      enrollmentId,
      startsOn: input.startsOn,
      feeAgorot: t.feeAgorot,
      offsetAgorot: offset.offsetAgorot,
      explanation: offset.explanation,
      policyVersionKey: resolved.versionKey,
    },
    idempotencyKey: `enrollment.trial_converted:${trialId}`,
  });
  return { enrollmentId, offset };
}

export type TrialRow = Awaited<ReturnType<typeof listTrials>>[number];

/** Trials from a date on (or of some sessions), with the child's name and the lesson. */
export async function listTrials(
  tx: Tx,
  filter: { from?: string; sessionIds?: readonly string[]; studentIds?: readonly string[] } = {},
) {
  const rows = await tx
    .select()
    .from(trials)
    .where(
      and(
        ne(trials.status, 'cancelled'),
        filter.from ? gte(trials.date, filter.from) : undefined,
        filter.sessionIds ? inArray(trials.sessionId, [...filter.sessionIds]) : undefined,
        filter.studentIds ? inArray(trials.studentId, [...filter.studentIds]) : undefined,
      ),
    )
    .orderBy(asc(trials.date));
  const [people, sessions] = await Promise.all([
    studentsByIds(tx, [...new Set(rows.map((r) => r.studentId))]),
    sessionFacts(tx, [...new Set(rows.map((r) => r.sessionId))]),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const bySession = new Map(sessions.map((s) => [s.id, s]));
  return rows.map((r) => {
    const p = byId.get(r.studentId);
    const s = bySession.get(r.sessionId);
    return {
      ...r,
      studentName: p ? `${p.firstName} ${p.lastName}` : '',
      householdId: p?.householdId ?? null,
      groupName: s?.groupName ?? '',
      startsAt: s?.startsAt ?? null,
      venueId: s?.venueId ?? null,
    };
  });
}

/** Trials in some sessions (the instructor's lineup). */
export async function trialsInSessions(tx: Tx, sessionIds: readonly string[]) {
  if (sessionIds.length === 0) return [];
  return tx
    .select()
    .from(trials)
    .where(and(inArray(trials.sessionId, [...sessionIds]), ne(trials.status, 'cancelled')));
}
