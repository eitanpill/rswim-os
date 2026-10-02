/**
 * Phase 4 acceptance at the service level, against a real database with RLS:
 * 2. the pre-run review flags (a) a charge without an enrollment, (b) an enrollment without a charge, (c) a duplicate
 *    mandate, each with its reason;
 * 3. a failed charge reported by a (fake) Grow webhook opens the dunning sequence: update-card message, retries on
 *    the policy's days, escalation to the owner, and a later payment closes it;
 * 4. a reimbursement household's invoice-receipt carries the profile's wording, the ID number, the lesson dates and
 *    the payment method.
 * Plus freezes, the cancellation cut-off, sibling discounts, refunds, credits from Phase 3 events and who may see
 * money. Every person, card and amount is fake.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, sql, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { createDataKey, DomainError, type ServiceContext } from '@rswim/domain-core';
import {
  FakeInvoicingProvider,
  FakePaymentProvider,
  signGrowWebhook,
  verifyGrowSignature,
} from '@rswim/integrations';
import {
  addDays,
  addStandingOrder,
  applyClosureCredits,
  applyGrowWebhook,
  applyTrialOffset,
  billingDetailsOf,
  collectRun,
  debtsDashboard,
  decideFreeze,
  draftRun,
  getRun,
  growWebhookBody,
  householdMoney,
  householdStatement,
  issueReceipts,
  postAdjustment,
  postRun,
  recordManualPayment,
  refundPayment,
  requestCancellation,
  requestFreeze,
  reverseEntry,
  runDunning,
  saveBillingDetails,
  saveProfile,
  withdrawCancellation,
  type Anomaly,
} from '../src';
import { ingestGrowWebhook } from '../src/services/webhook';

let t: TestDatabase;
let ctx: ServiceContext;
const users = { parentE: '', accountant: '', instructor: '' };
const h: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G', string> = {
  A: '',
  B: '',
  C: '',
  D: '',
  E: '',
  F: '',
  G: '',
};
const kids: Record<string, string> = {};
const seats: Record<string, string> = {};
const programs = { kids: '', adults: '', therapy: '' };
const groups = { tue: '', wed: '' };
let venue = '';
let staff = '';

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const as = <T>(who: keyof typeof users, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: users[who], org_id: ctx.orgId }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
const sys: () => ServiceContext = () => ({ orgId: ctx.orgId, userId: null });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};
const events = async (type: string) =>
  (await q(`select payload from outbox where event_type = $1 order by created_at`, [type])).map(
    (r: { payload: Record<string, unknown> }) => r.payload,
  );
const SECRET = 'test-grow-secret';
/** Sends a fake Grow callback through intake and applies it as the worker does. */
async function growCallback(body: Record<string, unknown>) {
  const raw = JSON.stringify({ occurredAt: '2026-10-01T09:00:00+03:00', ...body });
  expect(verifyGrowSignature(raw, signGrowWebhook(raw, SECRET), SECRET)).toBe(true);
  const intake = await ingestGrowWebhook(t.db, raw);
  if (intake !== 'queued') return intake;
  const [row] = await q(
    `select id from webhook_events where provider = 'grow' and external_id = $1`,
    [body.id],
  );
  const parsed = await growWebhookBody(t.db, ctx.orgId, row.id);
  return system((tx) => applyGrowWebhook(tx, sys(), parsed as NonNullable<typeof parsed>));
}

/** Tuesdays and Wednesdays of September 2026, and therapy lessons in August. */
const SEPT_TUE = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'];
const SEPT_WED = ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30'];
const AUG_THERAPY = ['2026-08-04', '2026-08-11', '2026-08-18'];

beforeAll(async () => {
  t = await createTestDatabase();
  const master = Buffer.alloc(32, 7);
  process.env.RSWIM_MASTER_KEY = master.toString('base64');
  const [org] = await q(
    `insert into organizations (slug, name) values ('bill', 'בדיקת כספים') returning id`,
  );
  await q(`insert into org_keys (organization_id, wrapped_dek) values ($1, $2)`, [
    org.id,
    createDataKey(master, org.id).wrapped,
  ]);
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };

  for (const k of Object.keys(h) as (keyof typeof h)[]) {
    const [row] = await q(
      `insert into households (organization_id, display_name) values ($1, $2) returning id`,
      [ctx.orgId, `משפחת ${k} (דמו)`],
    );
    h[k] = row.id;
  }
  const [g] = await q(
    `insert into guardians (organization_id, household_id, first_name, last_name, is_billing_contact)
     values ($1, $2, 'דנה', 'הורה E', true) returning id`,
    [ctx.orgId, h.E],
  );
  const [st] = await q(
    `insert into staff_members (organization_id, first_name, last_name, gender, employment_type)
     values ($1, 'נועה', 'דמו', 'female', 'employee') returning id`,
    [ctx.orgId],
  );
  staff = st.id;
  for (const [key, role, extra] of [
    ['parentE', 'parent', { guardian_id: g.id }],
    ['accountant', 'accountant', {}],
    ['instructor', 'instructor', { staff_member_id: staff }],
  ] as const) {
    const [pu] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${key}@example.test`,
    ]);
    users[key] = pu.id;
    await q(
      `insert into memberships (organization_id, user_id, role, guardian_id, staff_member_id)
       values ($1, $2, $3, $4, $5)`,
      [
        ctx.orgId,
        pu.id,
        role,
        'guardian_id' in extra ? extra.guardian_id : null,
        'staff_member_id' in extra ? extra.staff_member_id : null,
      ],
    );
  }
  for (const [key, hh, dob] of [
    ['a1', 'A', '2015-03-01'],
    ['a2', 'A', '2018-03-01'],
    ['b1', 'B', '2016-01-01'],
    ['d1', 'D', '1990-01-01'],
    ['e1', 'E', '2012-01-01'],
    ['f1', 'F', '2016-06-01'],
  ] as const) {
    const [s] = await q(
      `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
       values ($1, $2, $3, 'דמו', 'female', $4) returning id`,
      [ctx.orgId, h[hh], key, dob],
    );
    kids[key] = s.id;
  }

  await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2026-01-01', $2)`,
    [ctx.orgId, JSON.stringify(DEFAULT_ORG_RULES)],
  );
  const [v] = await q(
    `insert into venues (organization_id, name) values ($1, 'בריכת בדיקה (דמו)') returning id`,
    [ctx.orgId],
  );
  venue = v.id;
  const [pool] = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
    [ctx.orgId, venue],
  );
  for (const [key, kind, name] of [
    ['kids', 'group_kids', 'קבוצת ילדים'],
    ['adults', 'adult_beginner', 'מבוגרים'],
    ['therapy', 'therapy', 'הידרותרפיה'],
  ] as const) {
    const [p] = await q(
      `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
       values ($1, $2, $3, $4, 45, 6) returning id`,
      [ctx.orgId, key, kind, name],
    );
    programs[key] = p.id;
  }
  const [list] = await q(
    `insert into price_lists (organization_id, name, effective_from, status) values ($1, 'מחירון', '2026-01-01', 'draft') returning id`,
    [ctx.orgId],
  );
  await q(
    `insert into price_items (organization_id, price_list_id, program_id, kind, amount_agorot)
     values ($1, $2, $3, 'monthly', 33000), ($1, $2, $4, 'single', 20000)`,
    [ctx.orgId, list.id, programs.kids, programs.therapy],
  );
  await q(`update price_lists set status = 'published' where id = $1`, [list.id]);

  for (const [key, program, weekday, name, dates] of [
    ['tue', programs.kids, 2, 'דולפינים שלישי', SEPT_TUE],
    ['wed', programs.adults, 3, 'מבוגרים רביעי', SEPT_WED],
  ] as const) {
    const [tpl] = await q(
      `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                    duration_min, capacity, effective_from)
       values ($1, $2, $3, $4, $5, $6, '17:00', 45, 6, '2026-08-01') returning id`,
      [ctx.orgId, name, program, venue, pool.id, weekday],
    );
    groups[key] = tpl.id;
    for (const d of dates) {
      await q(
        `insert into sessions (organization_id, class_template_id, venue_id, date, starts_at, ends_at)
         values ($1, $2, $3, $4, ($4::date + time '17:00') at time zone 'Asia/Jerusalem',
                 ($4::date + time '17:45') at time zone 'Asia/Jerusalem')`,
        [ctx.orgId, tpl.id, venue, d],
      );
    }
  }
  for (const [key, kid, group] of [
    ['a1', 'a1', 'tue'],
    ['a2', 'a2', 'tue'],
    ['b1', 'b1', 'tue'],
    ['d1', 'd1', 'wed'],
    ['f1', 'f1', 'tue'],
  ] as const) {
    const [e] = await q(
      `insert into enrollments (organization_id, student_id, class_template_id, status, starts_on)
       values ($1, $2, $3, 'active', '2026-08-01') returning id`,
      [ctx.orgId, kids[kid], groups[group]],
    );
    seats[key] = e.id;
  }
  // Therapy for e1 in August: two lessons, and one cancelled 5 hours before (charged: 24h notice for therapy).
  await q(
    `insert into policy_sets (organization_id, scope_type, program_id, effective_from, rules)
     values ($1, 'program', $2, '2026-01-01', '{"absence": {"notice_min_hours": 24}}')`,
    [ctx.orgId, programs.therapy],
  );
  for (const [i, d] of AUG_THERAPY.entries()) {
    const [slot] = await q(
      `insert into private_slots (organization_id, staff_member_id, venue_id, program_id, kind, date, starts_at, ends_at, capacity)
       values ($1, $2, $3, $4, 'therapy', $5, ($5::date + time '16:00') at time zone 'Asia/Jerusalem',
               ($5::date + time '16:45') at time zone 'Asia/Jerusalem', 1) returning id, starts_at`,
      [ctx.orgId, staff, venue, programs.therapy, d],
    );
    await q(
      `insert into slot_bookings (organization_id, slot_id, student_id, status, cancelled_at) values ($1, $2, $3, $4, $5)`,
      [
        ctx.orgId,
        slot.id,
        kids.e1,
        i === 2 ? 'cancelled' : 'booked',
        i === 2 ? new Date(new Date(slot.starts_at).getTime() - 5 * 3_600_000) : null,
      ],
    );
  }

  await owner(async (tx) => {
    await addStandingOrder(tx, ctx, { householdId: h.A, mandateId: 'mA', cardLast4: '1111' });
    await addStandingOrder(tx, ctx, { householdId: h.B, mandateId: 'mB-1' });
    await addStandingOrder(tx, ctx, { householdId: h.B, mandateId: 'mB-2' });
    await addStandingOrder(tx, ctx, { householdId: h.C, mandateId: 'mC' });
    await addStandingOrder(tx, ctx, { householdId: h.F, mandateId: 'mF', cardLast4: '4242' });
  });
});
afterAll(async () => {
  await t.drop();
});

describe('freezes and the cancellation cut-off', () => {
  it('a freeze waits for approval, then its lessons are not charged', async () => {
    const { freezeId, status } = await owner((tx) =>
      requestFreeze(tx, ctx, {
        enrollmentId: seats.a2 as string,
        fromDate: '2026-09-01',
        toDate: '2026-09-10',
        reason: 'medical',
        note: 'ניתוח (דמו)',
      }),
    );
    expect(status).toBe('requested');
    await owner((tx) => decideFreeze(tx, ctx, freezeId, 'approved'));
    expect(await codeOf(owner((tx) => decideFreeze(tx, ctx, freezeId, 'rejected')))).toBe(
      'billing.errors.freezeNotOpen',
    );
  });

  it('a request after the 25th charges the next month too; withdrawing restores the seat', async () => {
    const { cancellationId, decision } = await owner((tx) =>
      requestCancellation(tx, ctx, {
        enrollmentId: seats.b1 as string,
        requestedAt: '2026-09-26T10:00',
      }),
    );
    expect(decision).toMatchObject({
      lastChargedPeriod: '2026-10',
      endsOn: '2026-11-01',
      explanation: { code: 'billing.decision.cancelAfterCutoff' },
    });
    const [e] = await q(`select status, ends_on::text from enrollments where id = $1`, [seats.b1]);
    expect(e).toEqual({ status: 'cancel_requested', ends_on: '2026-11-01' });
    expect(
      await codeOf(
        owner((tx) => requestCancellation(tx, ctx, { enrollmentId: seats.b1 as string })),
      ),
    ).toBe('billing.errors.notCancellable');
    await owner((tx) => withdrawCancellation(tx, ctx, cancellationId));
    const [back] = await q(`select status, ends_on from enrollments where id = $1`, [seats.b1]);
    expect(back).toEqual({ status: 'active', ends_on: null });
    const { decision: early } = await owner((tx) =>
      requestCancellation(tx, ctx, {
        enrollmentId: seats.b1 as string,
        requestedAt: '2026-09-25T23:30',
      }),
    );
    expect(early.lastChargedPeriod).toBe('2026-09');
  });
});

let runId = '';
let anomalies: Anomaly[] = [];

describe('AC2: the pre-run review', () => {
  it('drafts September: seats prorated by freezes, the sibling discount, last month’s therapy', async () => {
    const r = await owner((tx) => draftRun(tx, ctx, '2026-09'));
    runId = r.runId;
    anomalies = r.anomalies;
    const run = await owner((tx) => getRun(tx, runId));
    const fam = (k: keyof typeof h) => run?.families.find((f) => f.householdId === h[k]);
    const a = fam('A');
    expect(a?.lines.map((l) => [l.kind, l.studentId, l.amountAgorot])).toEqual([
      ['seat', kids.a1, 33_000],
      ['seat', kids.a2, 19_800], // 3 of 5 Tuesdays: two fell in the freeze
      ['sibling_discount', kids.a2, -1980], // 10% off the cheaper child
    ]);
    expect(a?.lines[1]?.sessionDates).toEqual(SEPT_TUE.slice(2));
    expect(a?.lines[2]?.appliesToLineId).toBe(a?.lines[1]?.id);
    expect(a?.total).toBe(50_820);
    expect(a?.anomalies).toEqual([]);
    const e = fam('E');
    expect(e?.lines).toHaveLength(1);
    expect(e?.lines[0]).toMatchObject({
      kind: 'slots',
      period: '2026-08',
      amountAgorot: 60_000,
      sessionDates: AUG_THERAPY,
      explanation: { code: 'billing.decision.slotsMonth', params: { lessons: 3, late: 1 } },
    });
  });

  it('(a) a mandate for a family with no seat', () => {
    expect(anomalies.filter((x) => x.householdId === h.C)).toEqual([
      {
        kind: 'charge_without_enrollment',
        householdId: h.C,
        studentId: null,
        enrollmentId: null,
        explanation: { code: 'billing.decision.mandateWithoutSeat', params: { count: 1 } },
      },
    ]);
  });

  it('(b) a seat that produces no charge (no price for the adults group)', () => {
    expect(
      anomalies
        .filter((x) => x.householdId === h.D)
        .map((x) => [x.kind, x.explanation.code, x.enrollmentId]),
    ).toEqual([['enrollment_without_charge', 'billing.decision.noPrice', seats.d1]]);
  });

  it('(c) two standing orders for one family', () => {
    expect(anomalies.filter((x) => x.householdId === h.B)).toEqual([
      expect.objectContaining({
        kind: 'duplicate_mandate',
        explanation: { code: 'billing.decision.duplicateMandate', params: { count: 2 } },
      }),
    ]);
  });

  it('flags a family that owes but has no mandate (a link goes out)', () => {
    expect(anomalies.find((x) => x.householdId === h.E)).toMatchObject({
      kind: 'missing_mandate',
      explanation: { params: { amount: 60_000 } },
    });
  });

  it('redrafting replaces the draft; posting writes the ledger and locks the run', async () => {
    const again = await owner((tx) => draftRun(tx, ctx, '2026-09'));
    runId = again.runId;
    expect(
      (await q(`select count(*)::int as n from billing_runs where period = '2026-09'`))[0].n,
    ).toBe(1);
    const { posted } = await owner((tx) => postRun(tx, ctx, runId));
    expect(posted).toBe(6); // a1, a2, a2's discount, b1, f1, e1's therapy (d1 has no price)
    expect(await events('billing.run_posted')).toEqual([{ runId, period: '2026-09' }]);
    expect(await codeOf(owner((tx) => postRun(tx, ctx, runId)))).toBe('billing.errors.runLocked');
    expect(await codeOf(owner((tx) => draftRun(tx, ctx, '2026-09')))).toBe(
      'billing.errors.alreadyPosted',
    );
    const entries = await q(
      `select type, amount_agorot from ledger_entries where household_id = $1 order by amount_agorot desc`,
      [h.A],
    );
    expect(entries).toEqual([
      { type: 'charge', amount_agorot: 33_000 },
      { type: 'charge', amount_agorot: 19_800 },
      { type: 'discount', amount_agorot: -1980 },
    ]);
    await expect(
      owner((tx) => tx.execute(sql`update ledger_entries set amount_agorot = 1`)),
    ).rejects.toThrow();
    await expect(owner((tx) => tx.execute(sql`delete from ledger_entries`))).rejects.toThrow();
  });
});

const grow = new FakePaymentProvider();
const invoicing = new FakeInvoicingProvider();

describe('AC3: a failed charge starts dunning', () => {
  it('collects the run: mandates are charged, a family without one gets a link', async () => {
    grow.pending = true;
    const out = await system((tx) => collectRun(tx, sys(), grow, runId));
    // D owes nothing (its only seat has no price), so it is skipped.
    expect(out).toEqual({ charged: 0, failed: 0, pending: 3, links: 1, skipped: 1 });
    // B is charged through its first mandate only.
    expect(
      grow.calls
        .filter((c) => c.op === 'charge')
        .map((c) => (c.req as { mandateId: string }).mandateId)
        .sort(),
    ).toEqual(['mA', 'mB-1', 'mF']);
    const links = await events('billing.payment_link_created');
    expect(links.map((l) => l.householdId).sort()).toEqual([h.E]);
    // Collecting again repeats nothing at the provider.
    const before = grow.calls.length;
    await system((tx) => collectRun(tx, sys(), grow, runId));
    expect(grow.calls.length).toBe(before);
  });

  it('the webhook reports A paid and F declined: F’s case opens with the update-card step', async () => {
    const [pa] = await q(`select external_id from payments where household_id = $1`, [h.A]);
    const [pf] = await q(`select id, external_id from payments where household_id = $1`, [h.F]);
    expect(
      await growCallback({
        id: 'evt-a',
        type: 'charge.succeeded',
        paymentId: pa.external_id,
        amountAgorot: 50_820,
      }),
    ).toBe('settled');
    expect(
      await growCallback({
        id: 'evt-f',
        type: 'charge.failed',
        paymentId: pf.external_id,
        amountAgorot: 33_000,
        failureReason: 'card_declined',
      }),
    ).toBe('failed');
    expect(
      await growCallback({
        id: 'evt-f',
        type: 'charge.failed',
        paymentId: pf.external_id,
        amountAgorot: 33_000,
      }),
    ).toBe('duplicate');
    expect(
      await growCallback({
        id: 'evt-x',
        type: 'charge.failed',
        paymentId: 'nobody',
        amountAgorot: 1,
      }),
    ).toBe('unknown_payment');

    const [payment] = await q(`select status, failure_reason from payments where id = $1`, [pf.id]);
    expect(payment).toEqual({ status: 'failed', failure_reason: 'card_declined' });
    const [mandate] = await q(`select status from standing_orders where household_id = $1`, [h.F]);
    expect(mandate.status).toBe('failing');
    const [c] = await q(`select * from dunning_cases where household_id = $1`, [h.F]);
    expect(c).toMatchObject({ status: 'open', retries_done: 0, amount_agorot: 33_000 });
    expect(await events('billing.dunning_step')).toEqual([
      { caseId: c.id, householdId: h.F, step: 'update_card', amountAgorot: 33_000 },
    ]);
    expect((await events('billing.payment_succeeded')).map((e) => e.householdId)).toEqual([h.A]);
  });

  it('retries on the policy’s days, escalates to the owner after ten days, and closes when paid', async () => {
    const [c] = await q(
      `select id, opened_on::text as opened from dunning_cases where household_id = $1`,
      [h.F],
    );
    grow.pending = false;
    grow.failNext = 1;
    // Opened today: nothing before the first retry day.
    expect(await system((tx) => runDunning(tx, sys(), grow, c.opened))).toEqual({
      retried: 0,
      reminded: 0,
      escalated: 0,
      resolved: 0,
    });
    const day1 = addDays(c.opened, 1);
    expect((await system((tx) => runDunning(tx, sys(), grow, day1))).retried).toBe(1);
    const [after1] = await q(
      `select retries_done, next_action_on::text as next, status from dunning_cases where id = $1`,
      [c.id],
    );
    expect(after1).toEqual({ retries_done: 1, next: addDays(c.opened, 4), status: 'open' });
    const attempts = await q(
      `select attempt, status from payments where household_id = $1 order by attempt`,
      [h.F],
    );
    expect(attempts).toEqual([
      { attempt: 1, status: 'failed' },
      { attempt: 2, status: 'failed' },
    ]);
    // Before day 4 nothing is due.
    expect((await system((tx) => runDunning(tx, sys(), grow, addDays(c.opened, 3)))).retried).toBe(
      0,
    );
    // Day 10: the owner gets it.
    grow.failNext = 5;
    expect(
      (await system((tx) => runDunning(tx, sys(), grow, addDays(c.opened, 10)))).escalated,
    ).toBe(1);
    expect(await events('billing.dunning_escalated')).toEqual([
      { caseId: c.id, householdId: h.F, amountAgorot: 33_000, pauseEnrollment: false },
    ]);
    // The family pays by Bit: the case closes and the receipt is requested.
    await owner((tx) =>
      recordManualPayment(tx, ctx, {
        householdId: h.F,
        method: 'bit',
        amountAgorot: 33_000,
        paidOn: c.opened,
        requestId: randomUUID(),
      }),
    );
    const [closed] = await q(`select status from dunning_cases where id = $1`, [c.id]);
    expect(closed.status).toBe('resolved');
    expect(await events('billing.dunning_resolved')).toEqual([{ caseId: c.id, householdId: h.F }]);
  });
});

describe('AC4: a reimbursement receipt', () => {
  it('stores the payer’s ID encrypted and shows only its last digits', async () => {
    const profileId = await owner((tx) =>
      saveProfile(tx, ctx, {
        name: 'משרד הביטחון',
        kind: 'ministry_of_defense',
        wording: 'טיפולי הידרותרפיה',
        requiresNationalId: 'on',
        includeSessionDates: 'on',
        splitPerMonth: 'on',
      }),
    );
    await expect(
      owner((tx) =>
        saveBillingDetails(tx, ctx, { householdId: h.E, payerNationalId: '123456789' }),
      ),
    ).rejects.toThrow('forms.errors.nationalId');
    await owner((tx) =>
      saveBillingDetails(tx, ctx, {
        householdId: h.E,
        payerName: 'דנה הורה E (דמו)',
        payerNationalId: '000000018',
        reimbursementProfileId: profileId,
        preferredMethod: 'payment_link',
      }),
    );
    const details = await owner((tx) => billingDetailsOf(tx, h.E));
    expect(details).toMatchObject({ payerIdLast4: '0018', reimbursementProfileId: profileId });
    const [raw] = await q(
      `select enc_payer_national_id from household_billing where household_id = $1`,
      [h.E],
    );
    expect(raw.enc_payer_national_id.toString('utf8')).not.toContain('000000018');
    await expect(
      as('parentE', (tx) => tx.execute(sql`select enc_payer_national_id from household_billing`)),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/) } });
  });

  it('the paid link’s invoice-receipt has the wording, ID, lesson dates and method', async () => {
    const [link] = await q(`select external_id from payment_links where household_id = $1`, [h.E]);
    expect(
      await growCallback({
        id: 'evt-e',
        type: 'link.paid',
        paymentId: 'grow-pay-e',
        linkId: link.external_id,
        amountAgorot: 60_000,
      }),
    ).toBe('settled');
    const [p] = await q(`select id, status, method from payments where household_id = $1`, [h.E]);
    expect(p).toMatchObject({ status: 'succeeded', method: 'credit_card' });
    const issued = await system((tx) => issueReceipts(tx, sys(), invoicing, p.id));
    expect(issued).toHaveLength(1);
    const doc = invoicing.issued.at(-1);
    expect(doc).toMatchObject({
      client: { name: 'דנה הורה E (דמו)', nationalId: '000000018' },
      lines: [
        { description: 'טיפולי הידרותרפיה – e1 – חודש 08/2026', amount: 60_000, quantity: 1 },
      ],
      paymentMethod: 'כרטיס אשראי',
    });
    expect(doc?.notes).toBe(
      'טיפולי הידרותרפיה\nת.ז. 000000018\nתאריכי המפגשים: 4.8.2026, 11.8.2026, 18.8.2026\nכרטיס אשראי',
    );
    const [stored] = await q(
      `select status, number, period, request from fiscal_documents where payment_id = $1`,
      [p.id],
    );
    expect(stored).toMatchObject({ status: 'issued', number: doc?.number, period: '2026-08' });
    expect(stored.request.notes).toBe(doc?.notes);
    // A retried job issues nothing twice.
    expect(await system((tx) => issueReceipts(tx, sys(), invoicing, p.id))).toEqual([]);
  });

  it('refuses a receipt the profile cannot accept (no ID number), and says why', async () => {
    const profileId = (await q(`select id from reimbursement_profiles`))[0].id;
    await owner((tx) =>
      saveBillingDetails(tx, ctx, { householdId: h.G, reimbursementProfileId: profileId }),
    );
    const id = await owner((tx) =>
      recordManualPayment(tx, ctx, {
        householdId: h.G,
        method: 'cash',
        amountAgorot: 10_000,
        paidOn: '2026-09-02',
        receivedByStaffId: staff,
        requestId: randomUUID(),
      }),
    );
    expect(await system((tx) => issueReceipts(tx, sys(), invoicing, id))).toEqual([]);
    const [doc] = await q(`select status, error from fiscal_documents where payment_id = $1`, [id]);
    expect(doc).toEqual({
      status: 'failed',
      error: { code: 'billing.decision.receiptNeedsNationalId', params: {} },
    });
  });
});

describe('ledger corrections, refunds and credits from Phase 3', () => {
  it('a partial refund off-platform, never more than what was paid', async () => {
    const [p] = await q(
      `select id from payments where household_id = $1 and kind = 'payment' and status = 'succeeded'`,
      [h.A],
    );
    expect(
      await codeOf(
        owner((tx) =>
          refundPayment(tx, ctx, {
            paymentId: p.id,
            amountAgorot: 60_000,
            via: 'bit',
            note: 'x',
            requestId: randomUUID(),
          }),
        ),
      ),
    ).toBe('billing.errors.refundTooMuch');
    await owner((tx) =>
      refundPayment(tx, ctx, {
        paymentId: p.id,
        amountAgorot: 1980,
        via: 'bit',
        note: 'החזר הנחה (דמו)',
        requestId: randomUUID(),
      }),
    );
    const money = await owner((tx) => householdMoney(tx, h.A));
    expect(money.balance).toBe(1980);
    // Through the provider it waits for the worker.
    await owner((tx) =>
      refundPayment(tx, ctx, {
        paymentId: p.id,
        amountAgorot: 100,
        via: 'provider',
        note: 'בדיקה',
        requestId: randomUUID(),
      }),
    );
    expect((await events('billing.refund_requested')).length).toBe(1);
  });

  it('credits, manual charges, write-offs and reversals are new entries', async () => {
    const id = await owner((tx) =>
      postAdjustment(tx, ctx, {
        householdId: h.C,
        kind: 'charge',
        amountAgorot: 5000,
        description: 'דמי רישום',
        requestId: randomUUID(),
      }),
    );
    const reversal = await owner((tx) => reverseEntry(tx, ctx, id, 'נרשם בטעות'));
    // Reversing twice is the same reversal, not a second one.
    expect(await owner((tx) => reverseEntry(tx, ctx, id, null))).toBe(reversal);
    expect(await codeOf(owner((tx) => reverseEntry(tx, ctx, reversal, null)))).toBe(
      'billing.errors.cannotReverseReversal',
    );
    const [{ p }] = await q(`select to_char(app.today(), 'YYYY-MM') as p`);
    const s = await owner((tx) => householdStatement(tx, h.C, p));
    expect(s.entries.map((e) => e.amountAgorot)).toEqual([5000, -5000]);
    expect(s.closing).toBe(0);
  });

  it('a converted trial’s offset and converted closure credits become credits, once', async () => {
    const payload = {
      trialId: randomUUID(),
      studentId: kids.f1,
      enrollmentId: seats.f1,
      offsetAgorot: 6000,
    };
    await system((tx) => applyTrialOffset(tx, sys(), payload));
    await system((tx) => applyTrialOffset(tx, sys(), payload));
    const credits = await q(
      `select amount_agorot, source from ledger_entries where household_id = $1 and type = 'credit'`,
      [h.F],
    );
    expect(credits).toEqual([{ amount_agorot: -6000, source: 'trial_offset' }]);
    expect(
      await system((tx) =>
        applyClosureCredits(tx, sys(), { closureEventId: randomUUID(), credits: [] }),
      ),
    ).toBe(0);
  });

  it('the debts dashboard ages what is unpaid', async () => {
    const d = await owner((tx) => debtsDashboard(tx));
    const b = d.rows.find((r) => r.householdId === h.B);
    expect(b).toMatchObject({ balance: 33_000, mandate: 'active', aging: { current: 33_000 } });
    expect(d.rows.some((r) => r.householdId === h.A)).toBe(true);
  });
});

describe('who sees money', () => {
  it('a parent sees their own household’s ledger, payments and receipts only', async () => {
    await as('parentE', async (tx) => {
      const own = await tx.execute<{ household_id: string }>(
        sql`select distinct household_id from ledger_entries`,
      );
      expect(own.rows.map((r) => r.household_id)).toEqual([h.E]);
      expect((await tx.execute(sql`select id from fiscal_documents`)).rows).toHaveLength(1);
      expect((await tx.execute(sql`select id from billing_runs`)).rows).toEqual([]);
      expect((await tx.execute(sql`select id from dunning_cases`)).rows).toEqual([]);
      expect((await tx.execute(sql`select app.wrapped_dek() as k`)).rows).toEqual([{ k: null }]);
    });
  });

  it('the accountant reads every money table and changes none; an instructor sees none', async () => {
    await as('accountant', async (tx) => {
      expect((await tx.execute(sql`select id from ledger_entries`)).rows.length).toBeGreaterThan(5);
      expect((await tx.execute(sql`select id from billing_runs`)).rows).toHaveLength(1);
      const upd = await tx.execute(sql`update payments set note = 'x' returning id`);
      expect(upd.rows).toEqual([]);
    });
    await as('instructor', async (tx) => {
      for (const table of ['ledger_entries', 'payments', 'billing_runs', 'standing_orders']) {
        expect((await tx.execute(sql.raw(`select id from ${table}`))).rows, table).toEqual([]);
      }
    });
  });
});
