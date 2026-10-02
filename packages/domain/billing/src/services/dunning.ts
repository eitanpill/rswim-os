/**
 * Dunning (brief §6.7): a failed charge opens one case per household. The update-card message goes out through
 * Phase 5 (`billing.dunning_step`); the daily job (collect.ts) retries or resends the link on the policy's days and
 * hands the case to the owner after `dunning.escalate_after_days`. Paying closes it.
 */
import { and, asc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { emit, type ServiceContext } from '@rswim/domain-core';
import { dunningNextStep, type Explanation } from '../policies';
import { balanceOfHousehold, postEntry } from './ledger';
import { orgBillingRules, todayIL } from './shared';

const { dunningCases, households } = schema;

export type DunningRow = typeof dunningCases.$inferSelect;

export interface DunningLogEntry {
  at: string;
  action: string;
  explanation: Explanation | null;
  paymentId?: string | null;
}

const logEntry = (action: string, explanation: Explanation | null, paymentId?: string | null) =>
  JSON.stringify([
    { at: new Date().toISOString(), action, explanation, paymentId: paymentId ?? null },
  ]);

/** Opens the household's case on a failed charge, or records another failure on the open one. */
export async function openOrUpdateCase(
  tx: Tx,
  ctx: ServiceContext,
  input: { householdId: string; paymentId: string; amountAgorot: number; reason: string },
): Promise<string> {
  const [open] = await tx
    .select()
    .from(dunningCases)
    .where(
      and(
        eq(dunningCases.householdId, input.householdId),
        inArray(dunningCases.status, ['open', 'escalated']),
      ),
    )
    .for('update');
  const failed = { code: 'billing.decision.chargeFailed', params: { reason: input.reason } };
  if (open) {
    await tx
      .update(dunningCases)
      .set({
        log: sql`${dunningCases.log} || ${logEntry('failed', failed, input.paymentId)}::jsonb`,
      })
      .where(eq(dunningCases.id, open.id));
    return open.id;
  }
  const today = await todayIL(tx);
  const { versionKey, rules } = await orgBillingRules(tx, today);
  const next = dunningNextStep(
    { openedOn: today, status: 'open', retriesDone: 0, hasMandate: true },
    today,
    rules.dunning,
  );
  const [row] = await tx
    .insert(dunningCases)
    .values({
      organizationId: ctx.orgId,
      householdId: input.householdId,
      paymentId: input.paymentId,
      openedOn: today,
      amountAgorot: input.amountAgorot,
      nextActionOn: next.nextOn,
      log: JSON.parse(logEntry('opened', failed, input.paymentId)),
      policyVersionKey: versionKey,
    })
    .returning({ id: dunningCases.id });
  const caseId = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.dunning_step',
    payload: {
      caseId,
      householdId: input.householdId,
      step: 'update_card',
      amountAgorot: input.amountAgorot,
    },
    idempotencyKey: `billing.dunning_step:${caseId}:update_card`,
  });
  return caseId;
}

/** Closes the household's open case once it owes nothing. */
export async function closeCaseIfPaid(tx: Tx, ctx: ServiceContext, householdId: string) {
  const balance = await balanceOfHousehold(tx, householdId);
  if (balance > 0) return false;
  const rows = await tx
    .update(dunningCases)
    .set({
      status: 'resolved',
      resolvedAt: new Date(),
      nextActionOn: null,
      log: sql`${dunningCases.log} || ${logEntry('resolved', { code: 'billing.decision.dunningPaid', params: {} })}::jsonb`,
    })
    .where(
      and(
        eq(dunningCases.householdId, householdId),
        inArray(dunningCases.status, ['open', 'escalated']),
      ),
    )
    .returning({ id: dunningCases.id });
  for (const r of rows) {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'billing.dunning_resolved',
      payload: { caseId: r.id, householdId },
      idempotencyKey: `billing.dunning_resolved:${r.id}`,
    });
  }
  return rows.length > 0;
}

export async function appendCaseLog(
  tx: Tx,
  caseId: string,
  action: string,
  explanation: Explanation | null,
  set: Partial<Pick<DunningRow, 'retriesDone' | 'nextActionOn' | 'status' | 'escalatedAt'>> = {},
  paymentId?: string | null,
) {
  await tx
    .update(dunningCases)
    .set({
      ...set,
      log: sql`${dunningCases.log} || ${logEntry(action, explanation, paymentId)}::jsonb`,
    })
    .where(eq(dunningCases.id, caseId));
}

/** The owner gives up on a debt: the case closes and the rest is written off in the ledger. */
export async function writeOffCase(
  tx: Tx,
  ctx: ServiceContext,
  caseId: string,
  note: string | null,
) {
  const [c] = await tx.select().from(dunningCases).where(eq(dunningCases.id, caseId));
  if (!c || !['open', 'escalated'].includes(c.status)) return false;
  const balance = await balanceOfHousehold(tx, c.householdId);
  if (balance > 0) {
    await postEntry(tx, ctx, {
      householdId: c.householdId,
      type: 'write_off',
      amountAgorot: -balance,
      description: note ?? '',
      source: 'manual',
      note,
      idempotencyKey: `write-off:${caseId}`,
    });
  }
  await appendCaseLog(tx, caseId, 'written_off', null, {
    status: 'written_off',
    nextActionOn: null,
  });
  return true;
}

export async function listCases(tx: Tx, statuses: readonly string[] = ['open', 'escalated']) {
  return tx
    .select({
      case: dunningCases,
      householdName: households.displayName,
    })
    .from(dunningCases)
    .innerJoin(households, eq(households.id, dunningCases.householdId))
    .where(inArray(dunningCases.status, [...statuses]))
    .orderBy(asc(dunningCases.openedOn));
}
