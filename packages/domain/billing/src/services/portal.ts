/**
 * A family's own requests from the portal (Phase 7): freeze a seat for a while, or leave. The family only asks; the
 * database stamps who asked and when, and the worker decides with the office's own services (`requestFreeze`,
 * `requestCancellation`), so the same regulations apply and the cut-off is decided by the moment the family asked.
 */
import { z } from 'zod';
import { CHURN_REASONS, FREEZE_REASONS, optionalText, requiredDate } from '@rswim/contracts';
import { and, desc, eq, inArray, schema, type Tx } from '@rswim/db';
import { DomainError, emit, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { guarded } from './shared';
import { requestCancellation, requestFreeze } from './seats';

const { portalRequests } = schema;

export const PortalFreezeInput = z
  .object({
    enrollmentId: z.uuid(),
    fromDate: requiredDate(),
    toDate: requiredDate(),
    reason: z.enum(FREEZE_REASONS),
    note: optionalText(500),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'forms.errors.dateOrder', path: ['toDate'] });
export type PortalFreezeInput = z.input<typeof PortalFreezeInput>;

export const PortalCancellationInput = z.object({
  enrollmentId: z.uuid(),
  reason: z.enum(CHURN_REASONS),
  note: optionalText(500),
});
export type PortalCancellationInput = z.input<typeof PortalCancellationInput>;

async function ask(
  tx: Tx,
  ctx: ServiceContext,
  values: Omit<typeof portalRequests.$inferInsert, 'organizationId'>,
) {
  const open = await tx
    .select({ id: portalRequests.id })
    .from(portalRequests)
    .where(
      and(
        eq(portalRequests.enrollmentId, values.enrollmentId),
        eq(portalRequests.kind, values.kind),
        eq(portalRequests.status, 'pending'),
      ),
    );
  if (open.length) throw new DomainError('parent.requests.errors.alreadyPending');
  const [row] = await guarded(() =>
    tx
      .insert(portalRequests)
      .values({ organizationId: ctx.orgId, ...values })
      .returning({ id: portalRequests.id }),
  );
  const id = (row as { id: string }).id;
  // A family may not read the outbox back, and its payload is not trusted: the worker reads the request row.
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.portal_request_created',
    payload: { requestId: id },
    idempotencyKey: `billing.portal_request_created:${id}`,
  });
  return id;
}

/** The family asks to freeze a seat between two dates. */
export async function askFreeze(tx: Tx, ctx: ServiceContext, raw: PortalFreezeInput) {
  const input = PortalFreezeInput.parse(raw);
  return ask(tx, ctx, {
    enrollmentId: input.enrollmentId,
    kind: 'freeze',
    fromDate: input.fromDate,
    toDate: input.toDate,
    reason: input.reason,
    note: input.note,
  });
}

/** The family asks to leave the group; the regulations' cut-off decides the last month they pay for. */
export async function askCancellation(tx: Tx, ctx: ServiceContext, raw: PortalCancellationInput) {
  const input = PortalCancellationInput.parse(raw);
  return ask(tx, ctx, {
    enrollmentId: input.enrollmentId,
    kind: 'cancellation',
    reason: input.reason,
    note: input.note,
  });
}

/** The family changes their mind before the request was decided. */
export async function withdrawPortalRequest(tx: Tx, id: string) {
  const rows = await guarded(() =>
    tx
      .update(portalRequests)
      .set({ status: 'withdrawn' })
      .where(and(eq(portalRequests.id, id), eq(portalRequests.status, 'pending')))
      .returning({ id: portalRequests.id }),
  );
  if (rows.length === 0) throw new DomainError('parent.requests.errors.notPending');
}

/** "2026-10-04T18:05" in Israel: the cancellation service takes the moment as the family's local time. */
function israelMinute(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}

/**
 * The worker decides a pending request with the office's services. A refusal by the rules (the seat already ended,
 * overlapping dates, a request already active) is stored with its reason for the family to read; anything else throws
 * so the worker retries.
 */
export async function processPortalRequest(tx: Tx, ctx: ServiceContext, id: string) {
  const [r] = await tx.select().from(portalRequests).where(eq(portalRequests.id, id)).for('update');
  if (!r || r.status !== 'pending') return null;
  const actor: ServiceContext = { orgId: ctx.orgId, userId: r.requestedBy ?? ctx.userId };
  try {
    // A savepoint: a refusal rolls back whatever the decision half-wrote, and the refusal itself is still stored.
    return await tx.transaction(async (sp) => {
      if (r.kind === 'freeze') {
        const out = await requestFreeze(sp, actor, {
          enrollmentId: r.enrollmentId,
          fromDate: r.fromDate as string,
          toDate: r.toDate as string,
          reason: r.reason as (typeof FREEZE_REASONS)[number],
          note: r.note,
        });
        await sp
          .update(portalRequests)
          .set({ status: 'done', freezeId: out.freezeId, processedAt: new Date() })
          .where(eq(portalRequests.id, id));
        return { status: 'done' as const, kind: r.kind, freezeStatus: out.status };
      }
      const out = await requestCancellation(sp, actor, {
        enrollmentId: r.enrollmentId,
        requestedAt: israelMinute(r.requestedAt),
        reason: (r.reason ?? 'other') as (typeof CHURN_REASONS)[number],
        note: r.note,
      });
      await sp
        .update(portalRequests)
        .set({ status: 'done', cancellationId: out.cancellationId, processedAt: new Date() })
        .where(eq(portalRequests.id, id));
      return { status: 'done' as const, kind: r.kind, decision: out.decision };
    });
  } catch (e) {
    const de = e instanceof DomainError ? e : toDomainError(e);
    if (!de) throw e;
    await tx
      .update(portalRequests)
      .set({
        status: 'refused',
        error: { code: de.code, params: de.params },
        processedAt: new Date(),
      })
      .where(eq(portalRequests.id, id));
    return { status: 'refused' as const, kind: r.kind, code: de.code };
  }
}

/** Requests still waiting (the office's list, and the worker's sweep for lost events). */
export async function pendingPortalRequests(tx: Tx) {
  return tx
    .select()
    .from(portalRequests)
    .where(eq(portalRequests.status, 'pending'))
    .orderBy(portalRequests.requestedAt);
}

/** A family's requests on some seats, newest first (RLS: their own children only). */
export async function portalRequestsOf(tx: Tx, enrollmentIds: readonly string[]) {
  if (enrollmentIds.length === 0) return [];
  return tx
    .select()
    .from(portalRequests)
    .where(inArray(portalRequests.enrollmentId, [...enrollmentIds]))
    .orderBy(desc(portalRequests.requestedAt));
}
