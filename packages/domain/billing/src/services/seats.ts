/**
 * Freezes and cancellations (brief §1.5, POLICIES §1): the seat is kept through a freeze and its approved days are
 * not charged; a cancellation request is decided against the cut-off day and ends the seat after the last month the
 * family pays for. Both are decided under the policy of the seat's group and keep its version.
 */
import { z } from 'zod';
import { FREEZE_REASONS, optionalText, requiredDate } from '@rswim/contracts';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { endPlaceForCancellation, placesByIds, restorePlace } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { billingRulesFrom, cancellationEffectiveMonth } from '../policies';
import { guarded, todayIL } from './shared';

const { cancellationRequests, enrollmentFreezes } = schema;

async function placeRules(tx: Tx, enrollmentId: string, date: string) {
  const [place] = await placesByIds(tx, [enrollmentId]);
  if (!place) throw new DomainError('common.errors.notFound');
  const resolved = await resolvePolicyFor(tx, {
    date,
    venueId: place.venueId,
    programId: place.programId,
    classTemplateId: place.classTemplateId,
  });
  return { place, versionKey: resolved.versionKey, rules: billingRulesFrom(resolved.rules) };
}

export const FreezeInput = z
  .object({
    enrollmentId: z.uuid(),
    fromDate: requiredDate(),
    toDate: requiredDate(),
    reason: z.enum(FREEZE_REASONS),
    note: optionalText(500),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'forms.errors.dateOrder', path: ['toDate'] });
export type FreezeInput = z.input<typeof FreezeInput>;

/** Records a freeze. It waits for approval when `billing.freeze_requires_approval` is on. */
export async function requestFreeze(tx: Tx, ctx: ServiceContext, raw: FreezeInput) {
  const input = FreezeInput.parse(raw);
  const { versionKey, rules } = await placeRules(tx, input.enrollmentId, input.fromDate);
  const status = rules.freezeRequiresApproval ? 'requested' : 'approved';
  const [row] = await guarded(() =>
    tx
      .insert(enrollmentFreezes)
      .values({
        organizationId: ctx.orgId,
        enrollmentId: input.enrollmentId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
        note: input.note,
        status,
        requestedBy: ctx.userId,
        policyVersionKey: versionKey,
        ...(status === 'approved' ? { decidedBy: ctx.userId, decidedAt: new Date() } : {}),
      })
      .returning({ id: enrollmentFreezes.id }),
  );
  return { freezeId: (row as { id: string }).id, status };
}

/** The owner approves or rejects a requested freeze, or cancels one. */
export async function decideFreeze(
  tx: Tx,
  ctx: ServiceContext,
  freezeId: string,
  decision: 'approved' | 'rejected' | 'cancelled',
) {
  const from = decision === 'cancelled' ? ['requested', 'approved'] : ['requested'];
  const rows = await tx
    .update(enrollmentFreezes)
    .set({ status: decision, decidedBy: ctx.userId, decidedAt: new Date() })
    .where(and(eq(enrollmentFreezes.id, freezeId), inArray(enrollmentFreezes.status, from)))
    .returning({ id: enrollmentFreezes.id, enrollmentId: enrollmentFreezes.enrollmentId });
  if (rows.length === 0) throw new DomainError('billing.errors.freezeNotOpen');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.freeze_decided',
    payload: { freezeId, enrollmentId: rows[0]?.enrollmentId, decision },
    idempotencyKey: `billing.freeze_decided:${freezeId}:${decision}`,
  });
}

/** "YYYY-MM-DDTHH:MM" as typed in Israel, or empty for now. */
const localDateTime = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'forms.errors.dateTime')
    .optional(),
);

export const CancellationInput = z.object({
  enrollmentId: z.uuid(),
  requestedAt: localDateTime,
  note: optionalText(500),
});
export type CancellationInput = z.input<typeof CancellationInput>;

/**
 * Records a family's request to leave and decides it against the cut-off: the seat ends after the last month they
 * pay for (unless it already ends earlier) and is marked as leaving.
 */
export async function requestCancellation(tx: Tx, ctx: ServiceContext, raw: CancellationInput) {
  const input = CancellationInput.parse(raw);
  const r = await tx.execute<{ at: Date }>(
    input.requestedAt
      ? sql`select (${input.requestedAt}::timestamp at time zone 'Asia/Jerusalem') as at`
      : sql`select now() as at`,
  );
  const requestedAt = new Date((r.rows[0] as { at: Date | string }).at);
  const today = await todayIL(tx);
  const { place, versionKey, rules } = await placeRules(tx, input.enrollmentId, today);
  if (!['active', 'frozen'].includes(place.status)) {
    throw new DomainError('billing.errors.notCancellable');
  }
  const decision = cancellationEffectiveMonth(requestedAt, rules);
  const [row] = await guarded(() =>
    tx
      .insert(cancellationRequests)
      .values({
        organizationId: ctx.orgId,
        enrollmentId: input.enrollmentId,
        requestedAt,
        lastChargedPeriod: decision.lastChargedPeriod,
        endsOn: decision.endsOn,
        explanation: decision.explanation,
        policyVersionKey: versionKey,
        note: input.note,
        recordedBy: ctx.userId,
      })
      .returning({ id: cancellationRequests.id }),
  );
  const id = (row as { id: string }).id;
  await endPlaceForCancellation(tx, input.enrollmentId, decision.endsOn);
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.cancellation_requested',
    payload: {
      cancellationId: id,
      enrollmentId: input.enrollmentId,
      studentId: place.studentId,
      lastChargedPeriod: decision.lastChargedPeriod,
      endsOn: decision.endsOn,
      explanation: decision.explanation,
    },
    idempotencyKey: `billing.cancellation_requested:${id}`,
  });
  return { cancellationId: id, decision };
}

/** The family changed their mind: the request is withdrawn and the seat goes on. */
export async function withdrawCancellation(tx: Tx, ctx: ServiceContext, cancellationId: string) {
  const [row] = await tx
    .update(cancellationRequests)
    .set({ status: 'withdrawn', withdrawnAt: new Date() })
    .where(
      and(eq(cancellationRequests.id, cancellationId), eq(cancellationRequests.status, 'active')),
    )
    .returning();
  if (!row) throw new DomainError('common.errors.notFound');
  await restorePlace(tx, row.enrollmentId, row.endsOn);
  void ctx;
}

/** Freezes and cancellations of some seats (the family card). */
export async function seatChangesOf(tx: Tx, enrollmentIds: readonly string[]) {
  if (enrollmentIds.length === 0) return { freezes: [], cancellations: [] };
  const [freezes, cancellations] = await Promise.all([
    tx
      .select()
      .from(enrollmentFreezes)
      .where(inArray(enrollmentFreezes.enrollmentId, [...enrollmentIds]))
      .orderBy(desc(enrollmentFreezes.fromDate)),
    tx
      .select()
      .from(cancellationRequests)
      .where(inArray(cancellationRequests.enrollmentId, [...enrollmentIds]))
      .orderBy(desc(cancellationRequests.requestedAt)),
  ]);
  return { freezes, cancellations };
}

/** Freezes waiting for the owner. */
export async function pendingFreezes(tx: Tx) {
  return tx
    .select()
    .from(enrollmentFreezes)
    .where(eq(enrollmentFreezes.status, 'requested'))
    .orderBy(enrollmentFreezes.fromDate);
}
