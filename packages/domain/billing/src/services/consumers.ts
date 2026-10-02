/**
 * Money from Phase 3 events: a converted trial's fee offset becomes a credit, and closure credits the owner turned
 * into money become credits at the lesson's value (the month's price over its lessons). Both are idempotent per
 * source, so a redelivered event posts once.
 */
import { z } from 'zod';
import { listCredits } from '@rswim/domain-attendance';
import { type Tx } from '@rswim/db';
import { type ServiceContext } from '@rswim/domain-core';
import { studentsByIds } from '@rswim/domain-people';
import { lessonDatesOfGroups, sessionFacts } from '@rswim/domain-scheduling';
import { loadPriceResolver } from '@rswim/domain-settings';
import { agorot } from '@rswim/money';
import { lessonValue, periodEnd, periodOf, periodStart } from '../policies';
import { postEntry } from './ledger';

export const TrialConvertedPayload = z.object({
  trialId: z.uuid(),
  studentId: z.uuid(),
  enrollmentId: z.uuid(),
  offsetAgorot: z.number().int().min(0),
  explanation: z.unknown().optional(),
  policyVersionKey: z.string().nullish(),
});

export async function applyTrialOffset(tx: Tx, ctx: ServiceContext, raw: unknown) {
  const p = TrialConvertedPayload.parse(raw);
  if (p.offsetAgorot <= 0) return null;
  const [student] = await studentsByIds(tx, [p.studentId]);
  if (!student) return null;
  return postEntry(tx, ctx, {
    householdId: student.householdId,
    studentId: p.studentId,
    enrollmentId: p.enrollmentId,
    type: 'credit',
    amountAgorot: -p.offsetAgorot,
    description: student.firstName,
    source: 'trial_offset',
    explanation: p.explanation ?? null,
    policyVersionKey: p.policyVersionKey ?? null,
    idempotencyKey: `trial-offset:${p.trialId}`,
  });
}

export const ClosureConvertedPayload = z.object({
  closureEventId: z.uuid(),
  credits: z.array(z.object({ creditId: z.uuid(), studentId: z.uuid() })),
});

export async function applyClosureCredits(tx: Tx, ctx: ServiceContext, raw: unknown) {
  const p = ClosureConvertedPayload.parse(raw);
  const wanted = new Set(p.credits.map((c) => c.creditId));
  const credits = (await listCredits(tx, { closureEventId: p.closureEventId })).filter((c) =>
    wanted.has(c.id),
  );
  const sessions = new Map(
    (
      await sessionFacts(tx, [
        ...new Set(credits.map((c) => c.sourceSessionId).filter((x): x is string => !!x)),
      ])
    ).map((s) => [s.id, s]),
  );
  const students = new Map(
    (await studentsByIds(tx, [...new Set(credits.map((c) => c.studentId))])).map((s) => [s.id, s]),
  );
  const priceAt = await loadPriceResolver(tx);
  let posted = 0;
  for (const c of credits) {
    const s = c.sourceSessionId ? sessions.get(c.sourceSessionId) : undefined;
    const student = students.get(c.studentId);
    if (!s || !student) continue;
    const period = periodOf(s.date);
    const dates = await lessonDatesOfGroups(
      tx,
      [s.classTemplateId],
      periodStart(period),
      periodEnd(period),
    );
    const price = priceAt({
      date: s.date,
      venueId: s.venueId,
      programId: s.programId,
      kind: 'monthly',
    });
    const value = price
      ? lessonValue(agorot(price.amount), dates.get(s.classTemplateId)?.length ?? 0)
      : 0;
    if (value <= 0) continue;
    await postEntry(tx, ctx, {
      householdId: student.householdId,
      studentId: c.studentId,
      type: 'credit',
      amountAgorot: -value,
      description: s.groupName,
      period,
      source: 'closure_credit',
      explanation: { code: 'billing.decision.closureCredit', params: { date: s.date } },
      idempotencyKey: `closure-credit:${c.id}`,
    });
    posted++;
  }
  return posted;
}
