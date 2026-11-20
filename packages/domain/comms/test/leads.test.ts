/**
 * WhatsApp track, stage 1: a number the business does not know opens a lead, the office answers it from the lead's
 * page, and a join request, a family, a trial and a group seat move it on by themselves. Every phone is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import type { ServiceContext } from '@rswim/domain-core';
import {
  createLead,
  getLead,
  leadCounts,
  listLeads,
  moveLeadStage,
  updateLead,
} from '@rswim/domain-crm';
import { ensureCommsDefaults, replyToLead } from '../src';
import { ingestInboundMessage } from '../src/services/intake';

let t: TestDatabase;
let ctx: ServiceContext;
let parentUser = '';
let template = '';
let student = '';
const LOCATION = 'loc-fake-leads';
const STRANGER = '+972504440001';

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
let seq = 0;
const say = (phone: string, body: string) =>
  ingestInboundMessage(
    t.db,
    JSON.stringify({
      type: 'InboundMessage',
      locationId: LOCATION,
      messageId: `fake-lead-msg-${++seq}`,
      phone,
      body,
      direction: 'inbound',
    }),
  );
const leadOf = async (phone: string) =>
  (
    await q(`select * from leads where organization_id = $1 and phone_e164 = $2`, [
      ctx.orgId,
      phone,
    ])
  )[0];

beforeAll(async () => {
  t = await createTestDatabase();
  const [org] = await q(
    `insert into organizations (slug, name) values ('leads', 'שחייה דמו') returning id`,
  );
  const [u] = await q(`insert into auth.users (email) values ('owner@leads.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  await q(
    `insert into org_settings (organization_id, integrations) values ($1, $2)
     on conflict (organization_id) do update set integrations = excluded.integrations`,
    [ctx.orgId, JSON.stringify({ ghl: { locationId: LOCATION, tagMap: {} } })],
  );
  const [h] = await q(
    `insert into households (organization_id, display_name) values ($1, 'משפחת כהן (דמו)') returning id`,
    [ctx.orgId],
  );
  const [g] = await q(
    `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164)
     values ($1, $2, 'רותם', 'דמו', '+972504440099') returning id`,
    [ctx.orgId, h.id],
  );
  const [pu] = await q(`insert into auth.users (email) values ('parent@leads.test') returning id`);
  parentUser = pu.id;
  await q(
    `insert into memberships (organization_id, user_id, role, guardian_id) values ($1, $2, 'parent', $3)`,
    [ctx.orgId, pu.id, g.id],
  );
  await q(
    `insert into staff_members (organization_id, first_name, last_name, gender, employment_type, phone_e164)
     values ($1, 'מיכל', 'מדריכה', 'female', 'employee', '+972504440098')`,
    [ctx.orgId],
  );
  const [v] = await q(
    `insert into venues (organization_id, name) values ($1, 'בריכה') returning id`,
    [ctx.orgId],
  );
  const [pool] = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
    [ctx.orgId, v.id],
  );
  const [p] = await q(
    `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
     values ($1, 'kids', 'group_kids', 'קבוצת ילדים', 45, 6) returning id`,
    [ctx.orgId],
  );
  const [tpl] = await q(
    `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                  duration_min, capacity, effective_from)
     values ($1, 'דולפינים', $2, $3, $4, 2, '18:00', 45, 6, '2026-01-01') returning id`,
    [ctx.orgId, p.id, v.id, pool.id],
  );
  template = tpl.id;
  await system((tx) => ensureCommsDefaults(tx, ctx.orgId));
}, 60_000);

afterAll(async () => {
  await t?.drop();
});

describe('a new number on WhatsApp', () => {
  it('opens a lead, and its next message updates the same lead', async () => {
    const first = await say(STRANGER, 'שלום, יש חוג לגיל 6?');
    expect(first).toMatchObject({ outcome: 'stored' });
    let lead = await leadOf(STRANGER);
    expect(lead).toMatchObject({ stage: 'new', source: 'whatsapp', message_count: 1 });
    expect(lead.last_message).toBe('שלום, יש חוג לגיל 6?');
    const [msg] = await q(`select lead_id from inbound_messages where external_id = $1`, [
      `fake-lead-msg-${seq}`,
    ]);
    expect(msg.lead_id).toBe(lead.id);

    await say(STRANGER, 'ובאיזה ימים?');
    lead = await leadOf(STRANGER);
    expect(lead).toMatchObject({ stage: 'new', message_count: 2, last_message: 'ובאיזה ימים?' });
  });

  it('is not a lead when the number is a family, a staff member or a diver', async () => {
    await q(
      `insert into dive_divers (organization_id, first_name, last_name, phone_e164) values ($1, 'נועם', 'דמו', '+972504440097')`,
      [ctx.orgId],
    );
    for (const phone of ['+972504440099', '+972504440098', '+972504440097']) {
      await say(phone, 'היי');
      expect(await leadOf(phone)).toBeUndefined();
    }
  });

  it('brings a lost lead back as new', async () => {
    const lead = await leadOf(STRANGER);
    await owner((tx) => moveLeadStage(tx, { id: lead.id, stage: 'lost', lostReason: 'price' }));
    expect(await leadOf(STRANGER)).toMatchObject({ stage: 'lost', lost_reason: 'price' });
    await say(STRANGER, 'חשבתי שוב, אפשר פרטים?');
    expect(await leadOf(STRANGER)).toMatchObject({
      stage: 'new',
      lost_reason: null,
      message_count: 3,
    });
  });
});

describe('the office', () => {
  it('answers a lead on WhatsApp: the message goes to its phone and the lead is talking', async () => {
    const lead = await leadOf(STRANGER);
    const m = await owner((tx) =>
      replyToLead(tx, ctx, { leadId: lead.id, text: 'היי! יש קבוצה בשלישי ב-16:30' }),
    );
    // Queued to go out now, or held until Shabbat or the quiet hours end (the clock decides).
    expect(['queued', 'held']).toContain(m.status);
    const [out] = await q(`select to_phone_e164, body, guardian_id from messages where id = $1`, [
      m.id,
    ]);
    expect(out).toMatchObject({
      to_phone_e164: STRANGER,
      body: 'היי! יש קבוצה בשלישי ב-16:30',
      guardian_id: null,
    });
    expect((await leadOf(STRANGER)).stage).toBe('talking');
    const open = await q(
      `select id from inbound_messages where lead_id = $1 and status in ('new', 'needs_human')`,
      [lead.id],
    );
    expect(open).toEqual([]);
    const { conversation } = await owner((tx) => getLead(tx, lead.id));
    expect(conversation.map((c) => c.direction)).toEqual(['in', 'in', 'in', 'out']);
  });

  it('writes a lead down by hand, edits it and lists it', async () => {
    const id = await owner((tx) =>
      createLead(tx, ctx, {
        name: 'הדס (דמו)',
        phone: '052-444-0002',
        source: 'phone',
        interest: 'שני ילדים',
      }),
    );
    await owner((tx) =>
      updateLead(tx, {
        id,
        name: 'הדס כהן (דמו)',
        note: 'חוזרת אחרי החגים',
        nextActionOn: '2026-01-01',
      }),
    );
    const list = await owner((tx) => listLeads(tx));
    const row = list.find((l) => l.id === id);
    expect(row).toMatchObject({
      name: 'הדס כהן (דמו)',
      phone: '+972524440002',
      attention: 'follow_up',
      interest: null,
    });
    expect((await owner((tx) => listLeads(tx, { q: '0524440002' }))).map((l) => l.id)).toEqual([
      id,
    ]);
    const counts = await owner((tx) => leadCounts(tx));
    expect(counts.open).toBe(2);
    expect(counts.waiting).toBe(1);
  });

  it('is the only one who sees leads', async () => {
    await expect(
      asUser(t.db, { sub: parentUser, org_id: ctx.orgId }, (tx) => listLeads(tx)),
    ).resolves.toEqual([]);
  });
});

describe('a lead moves on by itself', () => {
  it('a join request opens it, a family links it, a trial and a group seat move it', async () => {
    const phone = '+972504440003';
    const [u] = await q(`insert into auth.users (email) values ('joiner@leads.test') returning id`);
    const [jr] = await q(
      `insert into join_requests (organization_id, user_id, kind, first_name, last_name, phone_e164, children)
       values ($1, $2, 'trial', 'יעל', 'דמו', $3, '[{"firstName":"עומר"}]') returning id`,
      [ctx.orgId, u.id, phone],
    );
    expect(await leadOf(phone)).toMatchObject({
      stage: 'talking',
      source: 'join_link',
      name: 'יעל דמו',
      join_request_id: jr.id,
    });

    const [h] = await q(
      `insert into households (organization_id, display_name) values ($1, 'משפחת דמו') returning id`,
      [ctx.orgId],
    );
    await q(
      `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164) values ($1, $2, 'יעל', 'דמו', $3)`,
      [ctx.orgId, h.id, phone],
    );
    expect(await leadOf(phone)).toMatchObject({ stage: 'talking', household_id: h.id });

    const [s] = await q(
      `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
       values ($1, $2, 'עומר', 'דמו', 'male', '2019-01-01') returning id`,
      [ctx.orgId, h.id],
    );
    student = s.id;
    await q(
      `insert into enrollments (organization_id, student_id, class_template_id, status, starts_on, ends_on)
       values ($1, $2, $3, 'trial_booked', '2026-02-03', '2026-02-04')`,
      [ctx.orgId, student, template],
    );
    expect((await leadOf(phone)).stage).toBe('trial_booked');
    await q(
      `insert into enrollments (organization_id, student_id, class_template_id, status, starts_on)
       values ($1, $2, $3, 'active', '2026-02-10')`,
      [ctx.orgId, student, template],
    );
    expect((await leadOf(phone)).stage).toBe('joined');
  });

  it('accepting a join request makes a customer', async () => {
    const phone = '+972504440004';
    const [u] = await q(
      `insert into auth.users (email) values ('joiner2@leads.test') returning id`,
    );
    const [jr] = await q(
      `insert into join_requests (organization_id, user_id, kind, first_name, last_name, phone_e164)
       values ($1, $2, 'join', 'אבי', 'דמו', $3) returning id`,
      [ctx.orgId, u.id, phone],
    );
    expect((await leadOf(phone)).stage).toBe('new');
    await owner((tx) => tx.execute(`select public.accept_join_request('${jr.id}'::uuid)` as never));
    const lead = await leadOf(phone);
    expect(lead.stage).toBe('joined');
    expect(lead.household_id).not.toBeNull();
  });
});
