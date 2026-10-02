/**
 * Read models for the screens: a household's money (family card and the parent's payments page) and the debts
 * dashboard with aging buckets (brief §6.7).
 */
import { inArray, schema, sql, type Tx } from '@rswim/db';
import { agingBuckets, allocate, balanceOf, type AgingBuckets } from '../policies';
import { listCases } from './dunning';
import { ledgerFacts, ledgerOfHousehold } from './ledger';
import { linksOf, paymentsOf, standingOrdersOf } from './payments';
import { billingDetailsOf, listProfiles } from './profiles';
import { documentsOf } from './receipts';
import { todayIL } from './shared';

const { households, standingOrders } = schema;

export async function householdMoney(tx: Tx, householdId: string) {
  const [ledger, payments, links, documents, mandates, details, profiles] = await Promise.all([
    ledgerOfHousehold(tx, householdId),
    paymentsOf(tx, householdId),
    linksOf(tx, householdId),
    documentsOf(tx, householdId),
    standingOrdersOf(tx, householdId),
    billingDetailsOf(tx, householdId),
    listProfiles(tx),
  ]);
  return { ...ledger, payments, links, documents, mandates, details, profiles };
}

export interface DebtRow {
  householdId: string;
  name: string;
  balance: number;
  aging: AgingBuckets;
  oldest: string | null;
  mandate: 'active' | 'failing' | 'none';
  dunning: { caseId: string; status: string; openedOn: string; retriesDone: number } | null;
}

/** Every household that owes money, the largest and oldest first. */
export async function debtsDashboard(tx: Tx) {
  const today = await todayIL(tx);
  const [facts, cases, mandates] = await Promise.all([
    ledgerFacts(tx),
    listCases(tx),
    tx
      .select({ householdId: standingOrders.householdId, status: standingOrders.status })
      .from(standingOrders)
      .where(inArray(standingOrders.status, ['active', 'failing'])),
  ]);
  const owing = [...facts.entries()].filter(([, f]) => balanceOf(f) > 0);
  const names = owing.length
    ? await tx
        .select({ id: households.id, name: households.displayName })
        .from(households)
        .where(
          inArray(
            households.id,
            owing.map(([id]) => id),
          ),
        )
    : [];
  const rows: DebtRow[] = owing.map(([householdId, f]) => {
    const { outstanding } = allocate(f);
    const c = cases.find((x) => x.case.householdId === householdId)?.case;
    const m = mandates.filter((x) => x.householdId === householdId);
    return {
      householdId,
      name: names.find((n) => n.id === householdId)?.name ?? '',
      balance: balanceOf(f),
      aging: agingBuckets(outstanding, today),
      oldest: outstanding[0]?.occurredOn ?? null,
      mandate: m.some((x) => x.status === 'active') ? 'active' : m.length ? 'failing' : 'none',
      dunning: c
        ? { caseId: c.id, status: c.status, openedOn: c.openedOn, retriesDone: c.retriesDone }
        : null,
    };
  });
  rows.sort((a, b) => (a.oldest ?? '').localeCompare(b.oldest ?? '') || b.balance - a.balance);
  const totals = rows.reduce(
    (t, r) => ({
      balance: t.balance + r.balance,
      current: t.current + r.aging.current,
      days31to60: t.days31to60 + r.aging.days31to60,
      days61to90: t.days61to90 + r.aging.days61to90,
      over90: t.over90 + r.aging.over90,
    }),
    { balance: 0, current: 0, days31to60: 0, days61to90: 0, over90: 0 },
  );
  return { rows, totals, today };
}

/** Balances of every household in one query (the families list). */
export async function balancesByHousehold(tx: Tx): Promise<Map<string, number>> {
  const r = await tx.execute<{ household_id: string; b: number }>(
    sql`select household_id, sum(amount_agorot)::int as b from ledger_entries group by household_id`,
  );
  return new Map(r.rows.map((x) => [x.household_id, x.b]));
}
