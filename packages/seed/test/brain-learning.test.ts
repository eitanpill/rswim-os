/**
 * The business brain, stage 6 (docs/AI-BRAIN.md), on the fake demo tenant: it reads the owner's decisions, suggests a
 * level per kind of action and changes nothing until she accepts, stays quiet a month after she declines, and the
 * morning check stops asking families she called a special case and amounts she called too small.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound } from '@rswim/domain-comms';
import {
  acceptLearning,
  declineLearning,
  getAgentSettings,
  learningState,
  morningLessons,
  runBrainInbound,
  runMorningCheck,
  saveAgentSettings,
  sendLearningDigest,
  setApprovalPhone,
} from '@rswim/domain-copilot';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import type { AgentActionKind } from '@rswim/contracts';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const owner: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const OWNER_PHONE = '+972509990004';
let special = '';
let small = '';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return toDomainError(e)?.code ?? String(e);
  }
  return null;
};

/** Decided actions of the past weeks, as if the owner had decided them. */
async function history(
  kind: AgentActionKind,
  n: number,
  r: { status: string; alone: boolean; amount?: number },
) {
  for (let i = 0; i < n; i++) {
    await q(
      `insert into copilot_actions (organization_id, source, kind, params, summary, status, ran_alone, decided_by,
                                    decided_at, autonomy)
       values ($1, 'morning_check', $2, $3, '{"code":"copilot.summary.payment","params":{}}', $4, $5, $6,
               now() - make_interval(days => $7), $8)`,
      [
        DEMO_ORG.id,
        kind,
        { householdId: randomUUID(), amountAgorot: r.amount ?? 20000 },
        r.status,
        r.alone,
        r.alone ? null : PERSONAS.owner.userId,
        i + 1,
        r.alone ? 'auto' : 'approve',
      ],
    );
  }
}

async function ownerWrites(body: string) {
  const intake = await withOrg(t.db, DEMO_ORG.id, (tx) =>
    intakeInbound(tx, worker, {
      provider: 'ghl',
      externalId: randomUUID(),
      phoneE164: OWNER_PHONE,
      ghlContactId: null,
      body,
      receivedAt: new Date(),
    }),
  );
  if (intake.outcome !== 'stored') throw new Error('not stored');
  return withOrg(t.db, DEMO_ORG.id, (tx) => runBrainInbound(tx, worker, intake.inboundMessageId));
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  await as((tx) => setApprovalPhone(tx, owner, OWNER_PHONE));
  // Two fake families with an old charge each.
  const hs = await q(
    `select id from households where organization_id = $1 order by display_name limit 2`,
    [DEMO_ORG.id],
  );
  for (const [i, h] of hs.entries()) {
    await q(
      `insert into ledger_entries (organization_id, household_id, type, amount_agorot, description, occurred_on,
                                   source, idempotency_key)
       values ($1, $2, 'charge', $3, 'חיוב ישן (בדיקה)', current_date - 90, 'manual', $4)`,
      [DEMO_ORG.id, h.id, i === 0 ? 45000 : 3000, `test:learning-debt-${i}`],
    );
  }
  special = hs[0]!.id as string;
  small = hs[1]!.id as string;
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('the brain learns the owner', () => {
  it('suggests running alone what she always approves, and changes nothing until she accepts', async () => {
    await history('payment_link', 9, { status: 'confirmed', alone: false });
    const before = await as((tx) => learningState(tx));
    expect(before.suggestions).toContainEqual({
      kind: 'payment_link',
      from: 'approve',
      to: 'auto',
      why: 'approves',
      count: 9,
      of: 9,
    });
    expect(before.stats.payment_link.approved).toBe(9);
    expect((await as((tx) => getAgentSettings(tx))).effective.payment_link).toBe('approve');
    expect(await as((tx) => acceptLearning(tx, owner, 'payment_link'))).toEqual({
      kind: 'payment_link',
      level: 'auto',
    });
    const after = await as((tx) => getAgentSettings(tx));
    expect(after.effective.payment_link).toBe('auto');
    expect((await as((tx) => learningState(tx))).suggestions).toHaveLength(0);
    // Back to waiting for her, for the morning check below.
    await as((tx) =>
      saveAgentSettings(tx, owner, {
        profile: after.profile,
        levels: { ...after.levels, payment_link: 'approve' },
        maxAutoPerDay: after.maxAutoPerDay,
        maxAutoPaymentAgorot: after.maxAutoPaymentAgorot,
        paused: false,
      }),
    );
  });

  it('suggests asking her again what she takes back, and stays quiet a month once she declines', async () => {
    await history('report_absence', 4, { status: 'confirmed', alone: true });
    await history('report_absence', 2, { status: 'undone', alone: true });
    const s = await as((tx) => learningState(tx));
    expect(s.suggestions).toContainEqual(
      expect.objectContaining({ kind: 'report_absence', to: 'approve', why: 'undoes', count: 2 }),
    );
    const { until } = await as((tx) => declineLearning(tx, owner, 'report_absence'));
    const after = await as((tx) => learningState(tx));
    expect(after.declined.report_absence).toBe(until);
    expect(after.suggestions.map((x) => x.kind)).not.toContain('report_absence');
    expect((await as((tx) => getAgentSettings(tx))).effective.report_absence).toBe('auto');
    expect(await code(as((tx) => declineLearning(tx, owner, 'report_absence')))).toBe(
      'agent.learning.errors.gone',
    );
    expect(await code(as((tx) => acceptLearning(tx, owner, 'freeze')))).toBe(
      'agent.learning.errors.gone',
    );
  });

  it('learns why she drops a payment link on WhatsApp, and the morning check listens', async () => {
    const first = await withOrg(t.db, DEMO_ORG.id, (tx) => runMorningCheck(tx, worker));
    const asked = first!.plan.payments.map((p) => p.householdId);
    expect(asked).toEqual(expect.arrayContaining([special, small]));
    const refOf = async (h: string) =>
      (
        await q(
          `select ref from copilot_actions where kind = 'payment_link' and status = 'proposed'
             and params->>'householdId' = $1`,
          [h],
        )
      )[0].ref as number;
    const smallAmount = first!.plan.payments.find((p) => p.householdId === small)!.amountAgorot;
    expect((await ownerWrites(`לא ${await refOf(special)} מקרה מיוחד`)).outcome).toBe(
      'owner_decided',
    );
    expect((await ownerWrites(`לא ${await refOf(small)} קטן מדי`)).outcome).toBe('owner_decided');
    const reasons = await q(
      `select params->>'householdId' h, status, dismiss_reason from copilot_actions
       where kind = 'payment_link' and params->>'householdId' = any($1)`,
      [[special, small]],
    );
    expect(reasons).toEqual(
      expect.arrayContaining([
        { h: special, status: 'dismissed', dismiss_reason: 'special_case' },
        { h: small, status: 'dismissed', dismiss_reason: 'too_small' },
      ]),
    );
    const lessons = await withOrg(t.db, DEMO_ORG.id, (tx) => morningLessons(tx, 30));
    expect(lessons.skippedHouseholds).toEqual(expect.arrayContaining([special, small]));
    expect(lessons.minLinkAgorot).toBe(Math.max(100, Math.min(smallAmount + 1, 20000)));
    const next = await withOrg(t.db, DEMO_ORG.id, (tx) => runMorningCheck(tx, worker));
    expect(next!.plan.payments.map((p) => p.householdId)).not.toContain(special);
    expect(next!.plan.payments.map((p) => p.householdId)).not.toContain(small);
  });

  it('tells her WhatsApp what it learned once, and nothing without a number', async () => {
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => sendLearningDigest(tx, worker))).toEqual({
      sent: true,
    });
    const [m] = await q(
      `select body from messages where to_phone_e164 = $1 and idempotency_key like 'agent.learning:%'`,
      [OWNER_PHONE],
    );
    expect(m.body).toContain('מה למדתי על דרך העבודה שלך');
    expect(m.body).toContain('קישורי תשלום');
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => sendLearningDigest(tx, worker))).toEqual({
      sent: false,
      reason: 'already',
    });
    await as((tx) => setApprovalPhone(tx, owner, ''));
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => sendLearningDigest(tx, worker))).toEqual({
      sent: false,
      reason: 'no_phone',
    });
  });

  it('shows the office nothing of what it learned', async () => {
    const office = await asUser(t.db, { sub: PERSONAS.admin.userId, org_id: DEMO_ORG.id }, (tx) =>
      learningState(tx),
    );
    expect(office.suggestions).toHaveLength(0);
    expect(office.stats.payment_link.approved).toBe(0);
  });
});
