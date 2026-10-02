/**
 * Phase 4 demo money for the demo tenant, through the billing services as the tenant's worker (all fake):
 * - September is drafted and approved: most families paid (standing order, Bit, cash an instructor still holds), a
 *   few still owe, and one card was declined, so its dunning case is open.
 * - October is drafted and waits for review, with every flag the review knows: a family with two standing orders,
 *   a standing order with no seat, adult seats with no price (the demo price list leaves adults out on purpose),
 *   families with no standing order, and a sharp change in a family's total.
 * - A Ministry of Defense reimbursement profile on the family with private lessons (with an ID number when the
 *   master key is set), and a freeze waiting for approval.
 */
import { randomUUID } from 'node:crypto';
import { createDb, type Tx } from '@rswim/db';
import {
  addStandingOrder,
  createPendingPayment,
  draftRun,
  failPayment,
  postRun,
  recordManualPayment,
  requestFreeze,
  runTotalsByHousehold,
  saveBillingDetails,
  saveProfile,
  settlePayment,
} from '@rswim/domain-billing';
import type { ServiceContext } from '@rswim/domain-core';
import type pg from 'pg';

export interface BillingDataSummary {
  mandates: number;
  payments: number;
  failedCharges: number;
  septemberPosted: number;
  octoberFlags: number;
}

export async function seedBillingData(
  client: pg.PoolClient,
  orgId: string,
  staffIds: readonly string[],
): Promise<BillingDataSummary> {
  const rows = async <T>(text: string, params: unknown[] = []) =>
    (await client.query(text, params)).rows as T[];
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
    [orgId],
  );
  await client.query('set local role rswim_system');
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };
  const summary: BillingDataSummary = {
    mandates: 0,
    payments: 0,
    failedCharges: 0,
    septemberPosted: 0,
    octoberFlags: 0,
  };

  // Families with a group seat (most children per family first), and one family with no seat at all.
  const seated = await rows<{ household_id: string; display_name: string; kids: number }>(
    `select s.household_id, h.display_name, count(distinct s.id)::int kids
     from enrollments e join students s on s.id = e.student_id join households h on h.id = s.household_id
     where e.organization_id = $1 and e.status = 'active'
     group by s.household_id, h.display_name order by count(distinct s.id) desc, h.display_name`,
    [orgId],
  );
  const [unseated] = await rows<{ id: string }>(
    `select h.id from households h where h.organization_id = $1 and not exists (
       select 1 from students s join enrollments e on e.student_id = s.id where s.household_id = h.id)
     order by h.display_name limit 1`,
    [orgId],
  );
  const [privateFamily] = await rows<{ household_id: string }>(
    `select household_id from students where organization_id = $1 and first_name = 'רועי' limit 1`,
    [orgId],
  );

  // ─── Standing orders: most families; one with two; one declined card; a few with none ──
  const declined = seated[1];
  const withoutMandate = new Set(seated.slice(-3).map((f) => f.household_id));
  const mandateOf = new Map<string, string>();
  let n = 0;
  for (const f of seated) {
    if (withoutMandate.has(f.household_id)) continue;
    n++;
    const fail = f.household_id === declined?.household_id;
    const id = await addStandingOrder(tx, ctx, {
      householdId: f.household_id,
      mandateId: fail ? `fake-fail-${n}` : `fake-mandate-${n}`,
      cardLast4: String(1000 + n),
      dayOfMonth: 2,
    });
    mandateOf.set(f.household_id, id);
    summary.mandates++;
  }
  const duplicate = seated.find((f) => mandateOf.has(f.household_id) && f !== declined);
  if (duplicate) {
    await addStandingOrder(tx, ctx, {
      householdId: duplicate.household_id,
      mandateId: `fake-mandate-dup`,
      cardLast4: '9999',
      dayOfMonth: 10,
    });
    summary.mandates++;
  }
  if (unseated) {
    await addStandingOrder(tx, ctx, {
      householdId: unseated.id,
      mandateId: 'fake-mandate-left',
      cardLast4: '4242',
      dayOfMonth: 2,
    });
    summary.mandates++;
  }

  // ─── Reimbursement: the family with private lessons claims from the Ministry of Defense ──
  const profileId = await saveProfile(tx, ctx, {
    name: 'משרד הביטחון (דמו)',
    kind: 'ministry_of_defense',
    wording: 'טיפולי הידרותרפיה לפי אישור אגף השיקום (נוסח דמו)',
    requiresNationalId: 'on',
    includeSessionDates: 'on',
    splitPerMonth: 'on',
    active: 'on',
  });
  if (privateFamily) {
    await saveBillingDetails(tx, ctx, {
      householdId: privateFamily.household_id,
      payerName: 'הורה דמו (לא אמיתי)',
      // A checksum-valid fake number, stored only when the org has a data key.
      payerNationalId: process.env.RSWIM_MASTER_KEY ? '000000018' : undefined,
      reimbursementProfileId: profileId,
      preferredMethod: 'standing_order',
    });
  }

  // ─── September: approve the run, then the families pay (or not) ─────────────
  const sept = await draftRun(tx, ctx, '2026-09');
  summary.septemberPosted = (await postRun(tx, ctx, sept.runId)).posted;
  // In the families' order above, so who pays by hand is the same on every run of the seed.
  const rank = (id: string) => {
    const k = seated.findIndex((f) => f.household_id === id);
    return k === -1 ? seated.length : k;
  };
  const names = new Map(
    (
      await rows<{ id: string; display_name: string }>(
        `select id, display_name from households where organization_id = $1`,
        [orgId],
      )
    ).map((h) => [h.id, h.display_name]),
  );
  const totals = (await runTotalsByHousehold(tx, sept.runId)).sort(
    (a, b) =>
      rank(a.householdId) - rank(b.householdId) ||
      (names.get(a.householdId) ?? '').localeCompare(names.get(b.householdId) ?? '', 'he'),
  );
  let i = 0;
  for (const { householdId, total: amount } of totals) {
    if (amount <= 0) continue;
    i++;
    const mandate = mandateOf.get(householdId);
    if (mandate) {
      const p = await createPendingPayment(tx, ctx, {
        householdId,
        amountAgorot: amount,
        method: 'standing_order',
        standingOrderId: mandate,
        billingRunId: sept.runId,
        idempotencyKey: `seed:${sept.runId}:${householdId}`,
      });
      if (householdId === declined?.household_id) {
        await failPayment(tx, ctx, p.id, { reason: 'card_declined', externalId: `fake_pay_${i}` });
        summary.failedCharges++;
      } else {
        await settlePayment(tx, ctx, p.id, { paidOn: '2026-09-02', externalId: `fake_pay_${i}` });
        summary.payments++;
      }
    } else if (i % 2 === 0) {
      // Families without a standing order: some paid by hand (one in cash to an instructor), some still owe.
      await recordManualPayment(tx, ctx, {
        householdId,
        method: summary.payments % 2 ? 'bit' : 'cash',
        amountAgorot: amount,
        paidOn: '2026-09-15',
        receivedByStaffId: staffIds[2],
        note: 'שולם בבריכה (דמו)',
        requestId: randomUUID(),
      });
      summary.payments++;
    }
  }

  // ─── A freeze waiting for the owner (a family trip in October) ──────────────
  const [seat] = await rows<{ id: string }>(
    `select e.id from enrollments e join students s on s.id = e.student_id
     where e.organization_id = $1 and e.status = 'active' and s.household_id = $2 limit 1`,
    [orgId, seated[2]?.household_id ?? null],
  );
  if (seat) {
    await requestFreeze(tx, ctx, {
      enrollmentId: seat.id,
      fromDate: '2026-10-11',
      toDate: '2026-10-25',
      reason: 'vacation',
      note: 'טיול משפחתי (דמו)',
    });
  }

  // ─── October: drafted, waiting for review ───────────────────────────────────
  const oct = await draftRun(tx, ctx, '2026-10');
  summary.octoberFlags = oct.anomalies.length;
  await client.query('reset role');
  return summary;
}
