/**
 * The household ledger (brief §6.7, convention 7): append-only entries with signed amounts. Balances, statements and
 * aging are derived from it; a correction is a new entry, a reversal names the entry it reverses.
 */
import { z } from 'zod';
import {
  BillingPeriod,
  optionalText,
  requiredText,
  type LedgerEntryType,
  type LedgerSource,
} from '@rswim/contracts';
import { and, asc, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { allocate, balanceOf, type LedgerFact } from '../policies';
import { guarded, positiveAgorot, todayIL } from './shared';

const { billingRunLines, ledgerEntries } = schema;

export type LedgerRow = typeof ledgerEntries.$inferSelect;

export interface PostEntry {
  householdId: string;
  type: LedgerEntryType;
  /** Signed: positive is owed. */
  amountAgorot: number;
  description: string;
  source: LedgerSource;
  idempotencyKey: string;
  studentId?: string | null;
  enrollmentId?: string | null;
  period?: string | null;
  occurredOn?: string;
  billingRunId?: string | null;
  billingRunLineId?: string | null;
  paymentId?: string | null;
  reversesEntryId?: string | null;
  policyVersionKey?: string | null;
  explanation?: unknown;
  note?: string | null;
}

/** Posts one entry once: a second post with the same idempotency key returns the first entry's id. */
export async function postEntry(tx: Tx, ctx: ServiceContext, e: PostEntry): Promise<string> {
  const occurredOn = e.occurredOn ?? (await todayIL(tx));
  const [row] = await guarded(() =>
    tx
      .insert(ledgerEntries)
      .values({
        organizationId: ctx.orgId,
        householdId: e.householdId,
        studentId: e.studentId ?? null,
        enrollmentId: e.enrollmentId ?? null,
        type: e.type,
        amountAgorot: e.amountAgorot,
        period: e.period ?? null,
        description: e.description,
        occurredOn,
        source: e.source,
        billingRunId: e.billingRunId ?? null,
        billingRunLineId: e.billingRunLineId ?? null,
        paymentId: e.paymentId ?? null,
        reversesEntryId: e.reversesEntryId ?? null,
        policyVersionKey: e.policyVersionKey ?? null,
        explanation: e.explanation ?? null,
        idempotencyKey: e.idempotencyKey,
        note: e.note ?? null,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing({ target: [ledgerEntries.organizationId, ledgerEntries.idempotencyKey] })
      .returning({ id: ledgerEntries.id }),
  );
  if (row) return row.id;
  const [seen] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.idempotencyKey, e.idempotencyKey));
  return (seen as { id: string }).id;
}

export const AdjustmentInput = z.object({
  householdId: z.uuid(),
  kind: z.enum(['credit', 'charge', 'write_off']),
  amountAgorot: positiveAgorot(),
  description: requiredText(200),
  period: z.preprocess((v) => (v === '' ? undefined : v), BillingPeriod.optional()),
  studentId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  note: optionalText(500),
  /** The form's one-time token, so a double submit posts once. */
  requestId: z.uuid(),
});
export type AdjustmentInput = z.input<typeof AdjustmentInput>;

/** A credit, a manual charge (an entry fee, a replaced cap) or a write-off, by the office. */
export async function postAdjustment(tx: Tx, ctx: ServiceContext, raw: AdjustmentInput) {
  const input = AdjustmentInput.parse(raw);
  const sign = input.kind === 'charge' ? 1 : -1;
  return postEntry(tx, ctx, {
    householdId: input.householdId,
    type: input.kind,
    amountAgorot: sign * input.amountAgorot,
    description: input.description,
    source: 'manual',
    period: input.period ?? null,
    studentId: input.studentId ?? null,
    note: input.note,
    idempotencyKey: `manual:${input.requestId}`,
  });
}

/** Reverses an entry with its exact opposite. Payments are reversed through a refund, not here. */
export async function reverseEntry(
  tx: Tx,
  ctx: ServiceContext,
  entryId: string,
  note: string | null,
) {
  const [e] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId));
  if (!e) throw new DomainError('common.errors.notFound');
  if (e.reversesEntryId) throw new DomainError('billing.errors.cannotReverseReversal');
  if (e.type === 'payment' || e.type === 'refund')
    throw new DomainError('billing.errors.reverseViaRefund');
  return guarded(() =>
    postEntry(tx, ctx, {
      householdId: e.householdId,
      type: 'adjustment',
      amountAgorot: -e.amountAgorot,
      description: e.description,
      source: 'reversal',
      period: e.period,
      studentId: e.studentId,
      enrollmentId: e.enrollmentId,
      reversesEntryId: e.id,
      note,
      idempotencyKey: `reversal:${e.id}`,
    }),
  );
}

/** The ledger facts the pure rules read. A run line's entries settle under the line they apply to. */
export async function ledgerFacts(tx: Tx, householdIds?: readonly string[]) {
  const rows = await tx
    .select({
      id: ledgerEntries.id,
      householdId: ledgerEntries.householdId,
      type: ledgerEntries.type,
      amount: ledgerEntries.amountAgorot,
      occurredOn: ledgerEntries.occurredOn,
      lineId: ledgerEntries.billingRunLineId,
      appliesTo: billingRunLines.appliesToLineId,
      reversesEntryId: ledgerEntries.reversesEntryId,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .leftJoin(billingRunLines, eq(billingRunLines.id, ledgerEntries.billingRunLineId))
    .where(householdIds ? inArray(ledgerEntries.householdId, [...householdIds]) : undefined)
    .orderBy(asc(ledgerEntries.occurredOn), asc(ledgerEntries.createdAt), asc(ledgerEntries.id));
  const out = new Map<string, LedgerFact[]>();
  for (const r of rows) {
    const fact: LedgerFact = {
      id: r.id,
      type: r.type as LedgerEntryType,
      amount: r.amount,
      occurredOn: r.occurredOn,
      lineId: r.appliesTo ?? r.lineId,
      reversesEntryId: r.reversesEntryId,
    };
    out.set(r.householdId, [...(out.get(r.householdId) ?? []), fact]);
  }
  return out;
}

/** A household's balance (positive: owes). */
export async function balanceOfHousehold(tx: Tx, householdId: string): Promise<number> {
  const r = await tx.execute<{ b: number }>(
    sql`select coalesce(sum(amount_agorot), 0)::int as b from ledger_entries where household_id = ${householdId}`,
  );
  return (r.rows[0] as { b: number }).b;
}

/** A household's entries, newest first, with what is still unpaid. */
export async function ledgerOfHousehold(tx: Tx, householdId: string) {
  const entries = await tx
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.householdId, householdId))
    .orderBy(desc(ledgerEntries.occurredOn), desc(ledgerEntries.createdAt));
  const facts = (await ledgerFacts(tx, [householdId])).get(householdId) ?? [];
  const allocation = allocate(facts);
  return {
    entries,
    balance: balanceOf(facts),
    outstanding: allocation.outstanding,
    unallocated: allocation.unallocated,
    reversed: new Set(entries.map((e) => e.reversesEntryId).filter((x): x is string => !!x)),
  };
}

/** Statement of account for one month: the balance before, the month's entries, the balance after. */
export async function householdStatement(tx: Tx, householdId: string, period: string) {
  const from = `${period}-01`;
  const entries = await tx
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.householdId, householdId),
        sql`to_char(${ledgerEntries.occurredOn}, 'YYYY-MM') = ${period}`,
      ),
    )
    .orderBy(asc(ledgerEntries.occurredOn), asc(ledgerEntries.createdAt));
  const r = await tx.execute<{ b: number }>(
    sql`select coalesce(sum(amount_agorot), 0)::int as b from ledger_entries
        where household_id = ${householdId} and occurred_on < ${from}::date`,
  );
  const opening = (r.rows[0] as { b: number }).b;
  return {
    period,
    opening,
    entries,
    closing: opening + entries.reduce((s, e) => s + e.amountAgorot, 0),
  };
}

/** Which of these places the ledger has charged (a venue migration may not be reverted over them). */
export async function chargedPlaces(tx: Tx, enrollmentIds: readonly string[]): Promise<string[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx
    .selectDistinct({ id: ledgerEntries.enrollmentId })
    .from(ledgerEntries)
    .where(
      and(
        inArray(ledgerEntries.enrollmentId, [...enrollmentIds]),
        eq(ledgerEntries.type, 'charge'),
      ),
    );
  return rows.flatMap((r) => (r.id ? [r.id] : []));
}
