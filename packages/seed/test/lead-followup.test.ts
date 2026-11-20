/**
 * WhatsApp track W4 on the fake demo school: a new customer who went quiet after the bot answered hears from the
 * business once (after the owner approves, at the careful level), a family whose trial was yesterday gets an offer to
 * continue (alone, when the owner lets it), every trial lesson tomorrow is reminded, the owner's evening summary counts
 * the day's new customers, and the month's sources report adds them up. Every phone is fake.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_DEFAULT_SETTINGS, AGENT_PROFILE_LEVELS } from '@rswim/contracts';
import { asUser } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound, runAutomation } from '@rswim/domain-comms';
import {
  bookLeadTrial,
  confirmCopilotAction,
  FakeParentBotModel,
  runLeadFollowUps,
  runParentBot,
  saveAgentSettings,
  sendEveningSummary,
  trialOptions,
} from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { leadSources } from '@rswim/domain-crm';
import { queueTrialReminders } from '@rswim/domain-enrollment';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const model = new FakeParentBotModel();
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const office = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const system = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(t.db, DEMO_ORG.id, fn);
const asOwner = <T>(fn: Parameters<typeof asUser<T>>[2]) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);

/** A stranger writes on WhatsApp and the bot answers, as the worker would. Returns the lead. */
async function write(phone: string, body: string) {
  const intake = await system((tx) =>
    intakeInbound(tx, worker, {
      provider: 'ghl',
      externalId: randomUUID(),
      phoneE164: phone,
      ghlContactId: null,
      body,
      receivedAt: new Date(),
    }),
  );
  if (intake.outcome !== 'stored') throw new Error('not stored');
  await system((tx) => runParentBot(tx, worker, model, intake.inboundMessageId));
  const [lead] = await q(`select * from leads where organization_id = $1 and phone_e164 = $2`, [
    DEMO_ORG.id,
    phone,
  ]);
  return lead;
}

/** Changes rows behind the triggers' back (a trial moved in time, a conversation aged). */
async function rewrite(statements: [string, unknown[]][]) {
  const c = await t.pool.connect();
  try {
    await c.query(`set session_replication_role = replica`);
    for (const [s, p] of statements) await c.query(s, p);
  } finally {
    await c.query(`reset session_replication_role`);
    c.release();
  }
}

/** A family's trial booked from a lead, in the first lesson open to a child of five. */
async function trialFor(phone: string, parent: string, child: string) {
  const lead = await write(phone, `קוראים לי ${parent}`);
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  const dob = d.toISOString().slice(0, 10);
  const [first] = await system((tx) => trialOptions(tx, dob));
  if (!first) throw new Error('no trial lesson with a free place in the demo');
  const [parentFirstName, parentLastName] = parent.split(' ') as [string, string];
  const r = await system((tx) =>
    bookLeadTrial(tx, worker, {
      leadId: lead.id,
      sessionId: first.sessionId,
      parentFirstName,
      parentLastName,
      childFirstName: child,
      childDob: dob,
    }),
  );
  return { lead, ...r };
}

const followUps = async (leadId: string) =>
  q(`select * from copilot_actions where kind = 'lead_followup' and params->>'leadId' = $1`, [
    leadId,
  ]);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('following up new customers', () => {
  it('nudges a quiet lead once, after the owner approves at the careful level', async () => {
    const phone = '+972585550021';
    const lead = await write(phone, 'קוראים לי שירה');
    expect(await system((tx) => runLeadFollowUps(tx, worker))).not.toContainEqual(
      expect.objectContaining({ reason: 'silent' }),
    );
    // Three days of silence after the bot's answer.
    await rewrite([
      [
        `update inbound_messages set received_at = received_at - interval '3 days' where lead_id = $1`,
        [lead.id],
      ],
      [
        `update messages set created_at = created_at - interval '3 days' where to_phone_e164 = $1`,
        [phone],
      ],
    ]);
    await system((tx) => runLeadFollowUps(tx, worker));
    const [action] = await followUps(lead.id);
    expect(action).toMatchObject({ status: 'proposed', source: 'morning_check' });
    expect(action.params).toMatchObject({ reason: 'silent' });
    expect(action.params.text).toContain('היי שירה');
    const done = await asOwner((tx) => confirmCopilotAction(tx, office, action.id));
    expect(done.status).toBe('confirmed');
    const [sent] = await q(
      `select body, created_by, template_key from messages where idempotency_key = $1`,
      [`lead_followup:${lead.id}:silent`],
    );
    expect(sent).toMatchObject({ template_key: 'free_text', created_by: null });
    expect(sent.body).toContain('רק בודקים');
    // Once only.
    await system((tx) => runLeadFollowUps(tx, worker));
    expect(await followUps(lead.id)).toHaveLength(1);
  });

  it('offers a family to continue the day after the trial, alone when the owner lets it', async () => {
    await asOwner((tx) =>
      saveAgentSettings(tx, office, {
        ...AGENT_DEFAULT_SETTINGS,
        levels: { ...AGENT_PROFILE_LEVELS.careful, lead_followup: 'auto' },
      }),
    );
    const { lead, trialId } = await trialFor('+972585550022', 'רונית כהן', 'נועה');
    await rewrite([
      [`update trials set date = app.today() - 1, status = 'attended' where id = $1`, [trialId]],
    ]);
    await system((tx) => runLeadFollowUps(tx, worker));
    const [action] = await followUps(lead.id);
    expect(action).toMatchObject({ status: 'confirmed', ran_alone: true });
    expect(action.params.reason).toBe('after_trial');
    const [sent] = await q(`select body from messages where idempotency_key = $1`, [
      `lead_followup:${lead.id}:after_trial`,
    ]);
    expect(sent.body).toContain('איך היה השיעור של נועה');
  });

  it('reminds every trial lesson tomorrow, once', async () => {
    const { trialId } = await trialFor('+972585550023', 'אבי לוי', 'אורי');
    await rewrite([
      [
        `update trials set date = app.today() + 1, created_at = now() - interval '1 day' where id = $1`,
        [trialId],
      ],
    ]);
    expect(await system((tx) => queueTrialReminders(tx, worker))).toBeGreaterThanOrEqual(1);
    await system((tx) => queueTrialReminders(tx, worker));
    const events = await q(
      `select id, event_type, payload from outbox
       where event_type = 'enrollment.trial_reminder' and payload->>'trialId' = $1`,
      [trialId],
    );
    expect(events).toHaveLength(1);
    const [ev] = events;
    const r = await system((tx) =>
      runAutomation(tx, worker, { id: ev.id, type: ev.event_type, payload: ev.payload }),
    );
    expect(r).toMatchObject({ outcome: 'done', queued: 1 });
    const [m] = await q(`select body from messages where source_event_id = $1`, [ev.id]);
    expect(m.body).toContain('שיעור הניסיון של אורי');
  });

  it("counts the day's new customers in the evening summary and by source for the month", async () => {
    await q(
      `update agent_settings set approval_phone_e164 = '+972585559999' where organization_id = $1`,
      [DEMO_ORG.id],
    );
    const r = await system((tx) => sendEveningSummary(tx, worker));
    expect(r.sent).toBe(true);
    const [m] = await q(`select body from messages where to_phone_e164 = '+972585559999'`);
    expect(m.body).toMatch(/לקוחות חדשים: \d+ פניות, \d+ קבעו שיעור ניסיון/);
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })
      .format(new Date())
      .slice(0, 7);
    const report = await system((tx) => leadSources(tx, month));
    const whatsapp = report.rows.find((x) => x.source === 'whatsapp');
    expect(whatsapp?.leads).toBeGreaterThanOrEqual(3);
    expect(whatsapp?.trials).toBeGreaterThanOrEqual(2);
    expect(report.total.leads).toBeGreaterThanOrEqual(whatsapp?.leads ?? 0);
  });
});
