/**
 * The business brain, stage 4 (docs/AI-BRAIN.md), on the fake demo tenant: the morning check turns old debts into
 * payment links and uncovered lessons into instructor searches through the gate, never twice for the same family or
 * lesson, nothing of a kind the owner turned off; the evening summary goes once a day to the approvals number.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  getAgentSettings,
  runMorningCheck,
  saveAgentSettings,
  sendEveningSummary,
  setApprovalPhone,
} from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import type { AgentActionKind, AutonomyLevel } from '@rswim/contracts';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const owner: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const morning = () => withOrg(t.db, DEMO_ORG.id, (tx) => runMorningCheck(tx, worker));
const OWNER_PHONE = '+972509990002';
let gap = '';
let debtor = '';

async function setLevels(levels: Partial<Record<AgentActionKind, AutonomyLevel>>) {
  await as(async (tx) => {
    const s = await getAgentSettings(tx);
    await saveAgentSettings(tx, owner, {
      profile: s.profile,
      levels: { ...s.effective, ...levels },
      maxAutoPerDay: s.maxAutoPerDay,
      maxAutoPaymentAgorot: s.maxAutoPaymentAgorot,
      paused: false,
    });
  });
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  await as((tx) => setApprovalPhone(tx, owner, OWNER_PHONE));
  // A fake family owing an old charge, and a lesson of the coming days left without an instructor.
  const [h] = await q(
    `select id from households where organization_id = $1 order by display_name limit 1`,
    [DEMO_ORG.id],
  );
  await q(
    `insert into ledger_entries (organization_id, household_id, type, amount_agorot, description, occurred_on,
                                 source, idempotency_key)
     values ($1, $2, 'charge', 45000, 'חיוב ישן (בדיקה)', current_date - 90, 'manual', 'test:old-debt')`,
    [DEMO_ORG.id, h.id],
  );
  const [s] = await q(
    `select s.id from sessions s where s.organization_id = $1 and s.status = 'scheduled'
       and s.starts_at > now() + interval '1 day'
       and s.date <= current_date + 6 order by s.starts_at limit 1`,
    [DEMO_ORG.id],
  );
  await q(`delete from session_staff where session_id = $1`, [s.id]);
  gap = s.id;
  debtor = h.id;
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe("the brain's daily rounds", () => {
  it('turns nothing into actions when the owner turned both kinds off', async () => {
    await setLevels({ payment_link: 'off', substitute: 'off' });
    const r = await morning();
    expect(r).toMatchObject({ plan: { payments: [], substitutes: [] }, actions: [] });
    await setLevels({ payment_link: 'approve', substitute: 'approve' });
  });

  it('asks old debts to pay and looks for instructors, waiting for the owner on WhatsApp', async () => {
    const r = await morning();
    expect(r).not.toBeNull();
    const { plan, actions } = r!;
    expect(plan.payments.map((p) => p.householdId)).toContain(debtor);
    expect(plan.substitutes).toContainEqual({ sessionId: gap });
    expect(actions).toHaveLength(plan.payments.length + plan.substitutes.length);
    expect(actions.every((a) => a.status === 'waiting')).toBe(true);
    const rows = await q(
      `select kind, source, status, params, summary from copilot_actions where source = 'morning_check' order by ref`,
    );
    expect(rows).toHaveLength(actions.length);
    const link = rows.find((x) => x.kind === 'payment_link' && x.params.householdId === debtor)!;
    expect(link.params.amountAgorot).toBeGreaterThanOrEqual(45000);
    expect(rows.find((x) => x.kind === 'substitute')!.summary.code).toBe(
      'copilot.summary.substituteOpen',
    );
    const asked = await q(
      `select body from messages where to_phone_e164 = $1 and idempotency_key like 'agent.approval:%'`,
      [OWNER_PHONE],
    );
    expect(asked).toHaveLength(actions.length);
    expect(asked.map((m) => m.body).join('\n')).toContain('למצוא מדריך/ה לשיעור');
  });

  it('does not ask the same family or lesson again the next morning', async () => {
    const r = await morning();
    expect(r!.actions).toHaveLength(0);
  });

  it('sends the evening summary once a day, and not when turned off', async () => {
    const first = await withOrg(t.db, DEMO_ORG.id, (tx) => sendEveningSummary(tx, worker));
    expect(first).toEqual({ sent: true });
    const [m] = await q(
      `select body from messages where to_phone_e164 = $1 and idempotency_key like 'agent.evening:%'`,
      [OWNER_PHONE],
    );
    expect(m.body).toContain('היום של המוח');
    expect(m.body).toMatch(/מחכות לך: [1-9]/);
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => sendEveningSummary(tx, worker))).toEqual({
      sent: false,
      reason: 'already',
    });
    await as((tx) => setApprovalPhone(tx, owner, OWNER_PHONE, false));
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => sendEveningSummary(tx, worker))).toEqual({
      sent: false,
      reason: 'off',
    });
    await as((tx) => setApprovalPhone(tx, owner, ''));
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => sendEveningSummary(tx, worker))).toEqual({
      sent: false,
      reason: 'no_phone',
    });
  });
});
