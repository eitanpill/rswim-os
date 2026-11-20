/**
 * WhatsApp track W2: the bot answers new customers on the fake demo tenants (a swim school and a freediving club) with
 * the rules-based stand-in: prices and open places from what the business offers, the details the person gives saved
 * on the lead and the next question asked, a person for whoever asks for one, silence while the office is talking,
 * and a module (lodging) adding its facts and tools. Every phone is fake.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ORG, DIVE_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound, replyToLead } from '@rswim/domain-comms';
import { AGENT_DEFAULT_SETTINGS, AGENT_PROFILE_LEVELS } from '@rswim/contracts';
import {
  businessInfo,
  clearLeadBotModules,
  confirmCopilotAction,
  saveAgentSettings,
  trialOptions,
  FakeParentBotModel,
  registerLeadBotModule,
  runParentBot,
} from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { asUser } from '@rswim/db';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const model = new FakeParentBotModel();
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;

/** A stranger writes on WhatsApp to the business: the inbox opens the lead, then the bot runs as the worker would. */
async function write(orgId: string, phone: string, body: string) {
  const worker: ServiceContext = { orgId, userId: null };
  const intake = await withOrg(t.db, orgId, (tx) =>
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
  const run = await withOrg(t.db, orgId, (tx) =>
    runParentBot(tx, worker, model, intake.inboundMessageId),
  );
  const [reply] = await q(`select * from bot_replies where inbound_message_id = $1`, [
    intake.inboundMessageId,
  ]);
  const sent = reply?.message_id
    ? (
        await q(`select template_key, body, to_phone_e164 from messages where id = $1`, [
          reply.message_id,
        ])
      )[0]
    : null;
  const [lead] = await q(`select * from leads where organization_id = $1 and phone_e164 = $2`, [
    orgId,
    phone,
  ]);
  return { run, reply, sent, lead };
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  clearLeadBotModules();
  await t.drop();
});

describe('the bot for new customers', () => {
  it('greets a new number, opens the lead and asks its name', async () => {
    const r = await write(DEMO_ORG.id, '+972585550001', 'היי');
    expect(r.run.outcome).toBe('answered');
    expect(r.reply).toMatchObject({ outcome: 'answered', lead_id: r.lead.id, household_id: null });
    expect(r.sent).toMatchObject({ template_key: 'free_text', to_phone_e164: '+972585550001' });
    expect(r.sent.body).toContain('איך קוראים לך');
    expect(r.lead.stage).toBe('talking');
  });

  it('saves the details one answer at a time and asks the next question', async () => {
    const name = await write(DEMO_ORG.id, '+972585550001', 'קוראים לי מיכל');
    expect(name.lead.name).toBe('מיכל');
    expect(name.sent.body).toContain('בן או בת כמה');
    const age = await write(DEMO_ORG.id, '+972585550001', '5');
    expect(age.lead.details).toMatchObject({ child_age: '5' });
    expect(age.sent.body).toContain('מאיזה אזור');
  });

  it('answers prices from the published price list and open groups', async () => {
    const r = await write(DEMO_ORG.id, '+972585550002', 'כמה עולה חוג שחייה לילד בן 6?');
    expect(r.run.outcome).toBe('answered');
    expect(r.sent.body).toMatch(/₪/);
    expect(r.lead.details).toMatchObject({ child_age: '6' });
    const info = await withOrg(t.db, DEMO_ORG.id, (tx) => businessInfo(tx, 'swim', '2026-11-20'));
    expect(info.offers.length).toBeGreaterThan(0);
    expect(info.places.length).toBeGreaterThan(0);
  });

  it('hands a request for a person or a sensitive question to the office', async () => {
    const human = await write(DEMO_ORG.id, '+972585550003', 'אפשר לדבר עם נציג בבקשה?');
    expect(human.reply).toMatchObject({
      outcome: 'handed_off',
      handoff_reason: 'needs_action',
      model: 'rules',
    });
    expect(human.sent.template_key).toBe('bot_handoff');
    const health = await write(DEMO_ORG.id, '+972585550004', 'לבן שלי יש אסתמה, זה בסדר?');
    expect(health.reply).toMatchObject({ outcome: 'handed_off', handoff_reason: 'sensitive' });
  });

  it('keeps out of a conversation the office is in', async () => {
    const first = await write(DEMO_ORG.id, '+972585550005', 'שלום');
    await asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, (tx) =>
      replyToLead(
        tx,
        { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId },
        {
          leadId: first.lead.id,
          text: 'היי, כאן רעות, אשמח לעזור',
        },
      ),
    );
    const r = await write(DEMO_ORG.id, '+972585550005', 'מעולה תודה');
    expect(r.run).toEqual({ outcome: 'skipped', reason: 'office_talking' });
  });

  it('answers a freediving club from its programs and asks about experience', async () => {
    const hi = await write(DIVE_ORG.id, '+972585550006', 'שמי דניאל');
    expect(hi.lead.name).toBe('דניאל');
    expect(hi.sent.body).toContain('ניסיון בצלילה');
    const price = await write(DIVE_ORG.id, '+972585550006', 'כמה עולה קורס?');
    expect(price.sent.body).toMatch(/₪/);
  });

  it('lets a module add its facts and tools', async () => {
    const calls: string[] = [];
    registerLeadBotModule({
      key: 'lodging',
      enabled: async () => true,
      facts: async () => ['חדר זוגי 350 ₪ ללילה'],
      tools: [
        {
          name: 'lodging_rooms',
          description: 'Rooms',
          input_schema: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
      call: async (_tx, _ctx, _lead, tool) => {
        calls.push(tool);
        return { rooms: 2 };
      },
    });
    let seen: string[] = [];
    const spy = {
      name: 'spy',
      run: async (input: Parameters<FakeParentBotModel['run']>[0]) => {
        seen = input.tools.map((x) => x.name);
        expect(input.system).toContain('חדר זוגי 350');
        await input.callTool('lodging_rooms', {});
        await input.callTool('reply_to_lead', { text: 'יש חדרים פנויים' });
        return { answer: '', trace: [], incomplete: false };
      },
    };
    const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
    const intake = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      intakeInbound(tx, worker, {
        provider: 'ghl',
        externalId: randomUUID(),
        phoneE164: '+972585550007',
        ghlContactId: null,
        body: 'יש לכם גם לינה?',
        receivedAt: new Date(),
      }),
    );
    if (intake.outcome !== 'stored') throw new Error('not stored');
    const run = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      runParentBot(tx, worker, spy, intake.inboundMessageId),
    );
    expect(run.outcome).toBe('answered');
    expect(seen).toContain('lodging_rooms');
    expect(calls).toEqual(['lodging_rooms']);
    clearLeadBotModules();
  });

  it('books a trial a new customer chose, waiting for the owner at the careful level', async () => {
    const phone = '+972585550011';
    await write(DEMO_ORG.id, phone, 'קוראים לי רונית כהן');
    const ask = await write(DEMO_ORG.id, phone, 'אפשר לקבוע שיעור ניסיון?');
    expect(ask.sent.body).toContain('תאריך הלידה');
    const dob = await childWithOptions();
    const [y, m, d] = dob.split('-');
    const list = await write(DEMO_ORG.id, phone, `נועה ${Number(d)}.${Number(m)}.${y}`);
    expect(list.sent.body).toContain('1. ');
    expect(list.lead.details).toMatchObject({ child_name: 'נועה', child_dob: dob });
    const pick = await write(DEMO_ORG.id, phone, '1');
    expect(pick.sent.body).toContain('המשרד יאשר');
    const [action] = await q(
      `select * from copilot_actions where kind = 'book_trial' and inbound_message_id = $1`,
      [pick.reply.inbound_message_id],
    );
    expect(action).toMatchObject({ status: 'proposed', source: 'parent_whatsapp' });
    // The owner confirms: the family opens, the trial is booked and the lead follows by itself.
    const done = await asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, (tx) =>
      confirmCopilotAction(tx, { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId }, action.id),
    );
    expect(done.status).toBe('confirmed');
    const [lead] = await q(`select * from leads where phone_e164 = $1`, [phone]);
    expect(lead.stage).toBe('trial_booked');
    expect(lead.household_id).not.toBeNull();
    const [trial] = await q(
      `select t.* from trials t join students s on s.id = t.student_id
       where s.household_id = $1 and s.first_name = 'נועה'`,
      [lead.household_id],
    );
    expect(trial).toBeDefined();
  });

  it('books at once and sends the trial fee link when the owner lets it', async () => {
    const office = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
    await asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, (tx) =>
      saveAgentSettings(tx, office, {
        ...AGENT_DEFAULT_SETTINGS,
        levels: { ...AGENT_PROFILE_LEVELS.careful, book_trial: 'auto', payment_link: 'auto' },
      }),
    );
    const phone = '+972585550012';
    await write(DEMO_ORG.id, phone, 'קוראים לי אבי לוי');
    const dob = await childWithOptions();
    const [y, m, d] = dob.split('-');
    await write(DEMO_ORG.id, phone, `שיעור ניסיון בבקשה, אורי ${Number(d)}.${Number(m)}.${y}`);
    const pick = await write(DEMO_ORG.id, phone, '1');
    expect(pick.sent.body).toContain('קבענו לאורי שיעור ניסיון');
    const [lead] = await q(`select * from leads where phone_e164 = $1`, [phone]);
    expect(lead.stage).toBe('trial_booked');
    const links = await q(`select * from payment_links where household_id = $1`, [
      lead.household_id,
    ]);
    expect(links.length).toBe(1);
  });

  it("sends the person's own invite link", async () => {
    const r = await write(DIVE_ORG.id, '+972585550013', 'אפשר קישור להרשמה?');
    const [lead] = await q(`select invite_token from leads where phone_e164 = $1`, [
      '+972585550013',
    ]);
    expect(r.sent.body).toContain(`/i/${lead.invite_token}`);
  });
});

/** A date of birth that has a free trial lesson in the next two weeks in the demo school. */
async function childWithOptions(): Promise<string> {
  for (const years of [5, 6, 4, 7, 8, 3, 9, 10, 2]) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    const dob = d.toISOString().slice(0, 10);
    const options = await withOrg(t.db, DEMO_ORG.id, (tx) => trialOptions(tx, dob));
    if (options.length) return dob;
  }
  throw new Error('no trial lesson with a free place in the demo');
}
