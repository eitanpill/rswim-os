/**
 * Phase 5 acceptance at the service level, against a real database with RLS:
 * 1. "דניאל לא יגיע היום" from a known guardian becomes a pre-filled absence action in under 5 seconds, and one tap
 *    records the absence with the regulations' decision;
 * 2. nothing is sent on Shabbat: a message due on Friday afternoon is held at candle lighting and sent after havdalah;
 * 3. every outbound message is logged, sent, held, failed or blocked, and the provider is never called without a row.
 * Plus automations, triage routes, broadcasts, the holiday notice and who may read conversations. Every person and
 * phone number is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES, type Classification } from '@rswim/contracts';
import { asUser, sql, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import { FakeMessagingProvider } from '@rswim/integrations';
import {
  applyAiClassification,
  approveTriageAction,
  cancelBroadcast,
  createBroadcast,
  dispatchDue,
  dueBroadcasts,
  enqueueMessage,
  ensureCommsDefaults,
  israelInstant,
  listInbox,
  listMessages,
  listTemplates,
  previewAudience,
  replyToInbound,
  resolveInbound,
  restWindowAt,
  runAutomation,
  sendHolidayNotice,
  setAutomation,
  updateTemplate,
  listAutomations,
} from '../src';
import { ingestInboundMessage } from '../src/services/intake';

let t: TestDatabase;
let ctx: ServiceContext;
const users = { parent: '', instructor: '' };
const hh = { cohen: '', levi: '', mizrahi: '' };
const g = { cohen: '', levi: '', mizrahi: '' };
const kids = { daniel: '', noa: '', tamar: '' };
let todaySession = '';
let staff = '';
const LOCATION = 'loc-fake-rswim';

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
    const de = toDomainError(e);
    if (de) return de.code;
    throw e;
  }
  return null;
};
let seq = 0;
const webhook = (body: string, phone: string | null, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'InboundMessage',
    locationId: LOCATION,
    messageId: `fake-msg-${++seq}`,
    contactId: null,
    phone,
    body,
    messageType: 'WhatsApp',
    direction: 'inbound',
    ...extra,
  });

beforeAll(async () => {
  t = await createTestDatabase();
  const [org] = await q(
    `insert into organizations (slug, name) values ('comms', 'שחייה דמו') returning id`,
  );
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
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
  await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2026-01-01', $2)`,
    [ctx.orgId, JSON.stringify(DEFAULT_ORG_RULES)],
  );
  for (const [key, name, phone, optIn, first] of [
    ['cohen', 'משפחת כהן (דמו)', '+972501111111', true, 'רותם'],
    ['levi', 'משפחת לוי (דמו)', '+972502222222', false, 'שירה'],
    ['mizrahi', 'משפחת מזרחי (דמו)', null, true, 'אורי'],
  ] as const) {
    const [h] = await q(
      `insert into households (organization_id, display_name) values ($1, $2) returning id`,
      [ctx.orgId, name],
    );
    hh[key] = h.id;
    const [gr] = await q(
      `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164, whatsapp_opt_in)
       values ($1, $2, $3, 'דמו', $4, $5) returning id`,
      [ctx.orgId, h.id, first, phone, optIn],
    );
    g[key] = gr.id;
  }
  for (const [key, house, name] of [
    ['daniel', 'cohen', 'דניאל'],
    ['noa', 'cohen', 'נועה'],
    ['tamar', 'levi', 'תמר'],
  ] as const) {
    const [s] = await q(
      `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
       values ($1, $2, $3, 'דמו', 'female', '2017-01-01') returning id`,
      [ctx.orgId, hh[house], name],
    );
    kids[key] = s.id;
  }
  const [st] = await q(
    `insert into staff_members (organization_id, first_name, last_name, gender, employment_type, phone_e164)
     values ($1, 'מיכל', 'מדריכה', 'female', 'employee', '+972503333333') returning id`,
    [ctx.orgId],
  );
  staff = st.id;
  for (const [key, role, extra] of [
    ['parent', 'parent', { guardian_id: g.cohen }],
    ['instructor', 'instructor', { staff_member_id: staff }],
  ] as const) {
    const [pu] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${key}@example.test`,
    ]);
    users[key] = pu.id;
    await q(
      `insert into memberships (organization_id, user_id, role, guardian_id, staff_member_id) values ($1, $2, $3, $4, $5)`,
      [
        ctx.orgId,
        pu.id,
        role,
        'guardian_id' in extra ? extra.guardian_id : null,
        'staff_member_id' in extra ? extra.staff_member_id : null,
      ],
    );
  }
  const [v] = await q(
    `insert into venues (organization_id, name) values ($1, 'בריכת הדמו') returning id`,
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
  const [today] = await q(`select app.today()::text as d`);
  const [tpl] = await q(
    `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                  duration_min, capacity, effective_from)
     values ($1, 'דולפינים', $2, $3, $4, extract(dow from $5::date)::int, '18:00', 45, 6, '2026-01-01') returning id`,
    [ctx.orgId, p.id, v.id, pool.id, today.d],
  );
  for (const offset of [0, 7]) {
    const [s] = await q(
      `insert into sessions (organization_id, class_template_id, venue_id, date, starts_at, ends_at)
       values ($1, $2, $3, $4::date + $5::int, ($4::date + $5::int + time '18:00') at time zone 'Asia/Jerusalem',
               ($4::date + $5::int + time '18:45') at time zone 'Asia/Jerusalem') returning id`,
      [ctx.orgId, tpl.id, v.id, today.d, offset],
    );
    if (offset === 0) todaySession = s.id;
  }
  for (const kid of [kids.daniel, kids.noa, kids.tamar]) {
    await q(
      `insert into enrollments (organization_id, student_id, class_template_id, status, starts_on)
       values ($1, $2, $3, 'active', '2026-01-01')`,
      [ctx.orgId, kid, tpl.id],
    );
  }
  await system((tx) => ensureCommsDefaults(tx, ctx.orgId));
}, 60_000);

afterAll(async () => {
  await t?.drop();
});

describe('AC1: a WhatsApp absence becomes a one-tap action', () => {
  let actionId = '';

  it('turns "דניאל לא יגיע היום" into a pre-filled absence in under 5 seconds', async () => {
    const started = performance.now();
    const result = await ingestInboundMessage(
      t.db,
      webhook('היי, דניאל לא יגיע היום 🙏', '+972501111111'),
    );
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(5000);
    if (typeof result === 'string') throw new Error(result);
    expect(result).toMatchObject({ outcome: 'stored', status: 'new' });
    expect(result.classification).toMatchObject({
      intent: 'absence_notice',
      studentIds: [kids.daniel],
    });
    actionId = result.actionId as string;
    const [a] = await q(`select kind, status, payload from triage_actions where id = $1`, [
      actionId,
    ]);
    expect(a.kind).toBe('absence_notice');
    expect(a.payload.lessons).toEqual([
      expect.objectContaining({ sessionId: todaySession, studentId: kids.daniel, time: '18:00' }),
    ]);
    const inbox = await owner((tx) => listInbox(tx, { status: 'open' }));
    expect(inbox[0]).toMatchObject({ guardian: { id: g.cohen }, action: { id: actionId } });
    expect(inbox[0]?.students.map((s) => s.firstName)).toEqual(['דניאל']);
  });

  it('records the absence with the regulations decision on approval', async () => {
    const result = await owner((tx) => approveTriageAction(tx, ctx, actionId));
    const [n] = await q(
      `select channel, status, classification from absence_notices where student_id = $1`,
      [kids.daniel],
    );
    expect(n).toMatchObject({ channel: 'whatsapp', status: 'processed' });
    expect(result).toMatchObject({ absences: [{ studentId: kids.daniel }] });
    const [inbound] = await q(
      `select i.status from inbound_messages i join triage_actions a on a.inbound_message_id = i.id where a.id = $1`,
      [actionId],
    );
    expect(inbound.status).toBe('actioned');
    expect(await codeOf(owner((tx) => approveTriageAction(tx, ctx, actionId)))).toBe(
      'comms.errors.actionClosed',
    );
  });

  it('confirms to the family through the absence automation', async () => {
    const [ev] = await q(
      `select id, event_type, payload from outbox where event_type = 'attendance.absence_processed' order by created_at desc limit 1`,
    );
    const r = await system((tx) =>
      runAutomation(tx, sys(), { id: ev.id, type: ev.event_type, payload: ev.payload }),
    );
    expect(r.outcome).toBe('done');
    const [m] = await q(`select * from messages where source_event_id = $1`, [ev.id]);
    expect(m.template_key).toMatch(/^absence_received/);
    expect(m.body).toContain('דניאל');
    expect(m.body).toContain('רותם');
    // Redelivery queues nothing new.
    await system((tx) =>
      runAutomation(tx, sys(), { id: ev.id, type: ev.event_type, payload: ev.payload }),
    );
    expect(await q(`select id from messages where source_event_id = $1`, [ev.id])).toHaveLength(1);
  });

  it('stores a webhook once and ignores what is not ours', async () => {
    const raw = webhook('נועה לא תגיע מחר', '+972501111111');
    expect(await ingestInboundMessage(t.db, raw)).toMatchObject({ outcome: 'stored' });
    expect(await ingestInboundMessage(t.db, raw)).toBe('duplicate');
    expect(await ingestInboundMessage(t.db, webhook('x', null, { locationId: 'elsewhere' }))).toBe(
      'unknown_location',
    );
    expect(
      await ingestInboundMessage(
        t.db,
        JSON.stringify({ type: 'ContactCreate', locationId: LOCATION }),
      ),
    ).toBe('ignored');
    expect(await ingestInboundMessage(t.db, webhook('x', null, { direction: 'outbound' }))).toBe(
      'ignored',
    );
  });
});

describe('triage routes', () => {
  it('sends complaints to a person, without a draft', async () => {
    const r = await ingestInboundMessage(t.db, webhook('אני ממש לא מרוצה מהיחס', '+972501111111'));
    expect(r).toMatchObject({
      status: 'needs_human',
      actionId: null,
      classification: { intent: 'complaint' },
    });
  });

  it('marks a stranger asking about times as a lead, and staff messages as staff', async () => {
    const lead = await ingestInboundMessage(
      t.db,
      webhook('באיזו שעה יש שיעורים לגיל 6?', '+972509999999'),
    );
    expect(lead).toMatchObject({
      status: 'new',
      actionId: null,
      classification: { intent: 'lead' },
    });
    const staffMsg = await ingestInboundMessage(t.db, webhook('אני מאחרת בעשר דקות', '0503333333'));
    expect(staffMsg).toMatchObject({ classification: { intent: 'instructor_message' } });
  });

  it('asks a person when no lesson matches the day', async () => {
    const [day] = await q(`select to_char(app.today() + 3, 'FMDD.FMMM') as d`);
    const r = await ingestInboundMessage(t.db, webhook(`תמר לא תגיע ב-${day.d}`, '+972502222222'));
    expect(r).toMatchObject({ status: 'needs_human', actionId: null });
  });

  it('never answers a personal message by itself', async () => {
    const r = await ingestInboundMessage(t.db, webhook('חג שמח לכל הצוות!', '+972501111111'));
    if (typeof r === 'string') throw new Error(r);
    expect(r).toMatchObject({
      status: 'new',
      actionId: null,
      classification: { intent: 'personal_other' },
    });
    expect(
      await q(`select id from messages where inbound_message_id = $1`, [r.inboundMessageId]),
    ).toEqual([]);
    await owner((tx) => resolveInbound(tx, ctx, r.inboundMessageId, 'dismissed'));
    const [row] = await q(`select status from inbound_messages where id = $1`, [
      r.inboundMessageId,
    ]);
    expect(row.status).toBe('dismissed');
  });

  it('lets the office answer in the conversation', async () => {
    const r = await ingestInboundMessage(t.db, webhook('מתי השיעור של נועה?', '+972501111111'));
    if (typeof r === 'string') throw new Error(r);
    const m = await owner((tx) =>
      replyToInbound(tx, ctx, { inboundMessageId: r.inboundMessageId, text: 'ב-18:00 😊' }),
    );
    expect(m.status).not.toBe('blocked');
    const [row] = await q(`select template_key, body from messages where id = $1`, [m.id]);
    expect(row).toEqual({ template_key: 'free_text', body: 'ב-18:00 😊' });
    const stranger = await ingestInboundMessage(t.db, webhook('שלום', '+972508888888'));
    if (typeof stranger === 'string') throw new Error(stranger);
    expect(
      await codeOf(
        owner((tx) =>
          replyToInbound(tx, ctx, { inboundMessageId: stranger.inboundMessageId, text: 'היי' }),
        ),
      ),
    ).toBe('comms.errors.unknownSender');
  });

  it('takes the AI verdict only when it is more confident', async () => {
    const r = await ingestInboundMessage(t.db, webhook('אפשר לדבר על נועה?', '+972501111111'));
    if (typeof r === 'string') throw new Error(r);
    const ai: Classification = {
      intent: 'makeup_request',
      confidence: 90,
      studentIds: [kids.noa, kids.tamar],
      date: null,
      classifier: 'claude:test',
      signals: [],
    };
    expect(
      await system((tx) =>
        applyAiClassification(tx, sys(), r.inboundMessageId, { ...ai, confidence: 10 }),
      ),
    ).toBe('kept');
    expect(await system((tx) => applyAiClassification(tx, sys(), r.inboundMessageId, ai))).toBe(
      'applied',
    );
    const [row] = await q(`select intent, classification from inbound_messages where id = $1`, [
      r.inboundMessageId,
    ]);
    expect(row.intent).toBe('makeup_request');
    // Only the family's own children are kept.
    expect(row.classification.studentIds).toEqual([kids.noa]);
    const [a] = await q(`select kind, status from triage_actions where inbound_message_id = $1`, [
      r.inboundMessageId,
    ]);
    expect(a).toEqual({ kind: 'makeup_request', status: 'pending' });
    await owner((tx) => resolveInbound(tx, ctx, r.inboundMessageId, 'actioned'));
    expect(await system((tx) => applyAiClassification(tx, sys(), r.inboundMessageId, ai))).toBe(
      'closed',
    );
  });
});

/** Friday 9 October 2026: candle lighting − 30 min is about 17:04 in Jerusalem. */
const FRIDAY_AFTERNOON = israelInstant('2026-10-09', '16:00');
const FRIDAY_EVENING = israelInstant('2026-10-09', '17:30');

describe('AC2: nothing is sent on Shabbat', () => {
  it('holds a message still waiting at candle lighting and sends it after havdalah', async () => {
    const provider = new FakeMessagingProvider();
    const m = await system((tx) =>
      enqueueMessage(tx, sys(), {
        guardian: guardianOf('cohen'),
        templateKey: 'free_text',
        vars: { text: 'תזכורת לשבוע הבא' },
        idempotencyKey: 'test:shabbat',
        notBefore: FRIDAY_AFTERNOON,
      }),
    );
    expect(m.status).toBe('queued');
    const held = await system((tx) => dispatchDue(tx, sys(), provider, FRIDAY_EVENING));
    expect(held.held).toBeGreaterThan(0);
    expect(provider.sent).toEqual([]);
    const [row] = await q(`select status, hold_reason, not_before from messages where id = $1`, [
      m.id,
    ]);
    expect(row).toMatchObject({ status: 'held', hold_reason: 'rest_window' });
    const until = new Date(row.not_before);
    expect(restWindowAt(until)).toBeNull();
    expect(restWindowAt(new Date(until.getTime() - 120_000))).not.toBeNull();
    // Still Shabbat a minute before: nothing due for this message.
    await system((tx) => dispatchDue(tx, sys(), provider, new Date(until.getTime() - 60_000)));
    expect(provider.sent.map((s) => s.ctx.idempotencyKey)).not.toContain('test:shabbat');
    await system((tx) => dispatchDue(tx, sys(), provider, until));
    const [sent] = await q(
      `select status, provider_message_id, sent_at from messages where id = $1`,
      [m.id],
    );
    expect(sent.status).toBe('sent');
    expect(
      provider.sent.find((s) => s.ctx.idempotencyKey === 'test:shabbat')?.providerMessageId,
    ).toBe(sent.provider_message_id);
  });

  it('holds a message queued during Shabbat from the start', async () => {
    const m = await system((tx) =>
      enqueueMessage(tx, sys(), {
        guardian: guardianOf('cohen'),
        templateKey: 'free_text',
        vars: { text: 'שבוע טוב' },
        idempotencyKey: 'test:queued-on-shabbat',
        notBefore: FRIDAY_EVENING,
      }),
    );
    expect(m.status).toBe('held');
  });
});

function guardianOf(key: keyof typeof g) {
  const phones = { cohen: '+972501111111', levi: '+972502222222', mizrahi: null };
  return {
    id: g[key],
    householdId: hh[key],
    firstName: 'דמו',
    phoneE164: phones[key],
    whatsappOptIn: key !== 'levi',
    locale: 'he',
  };
}

describe('AC3: every outbound message is logged', () => {
  it('logs blocked messages with their reason', async () => {
    const base = { templateKey: 'free_text' as const, vars: { text: 'שלום' } };
    const optedOut = await system((tx) =>
      enqueueMessage(tx, sys(), {
        ...base,
        guardian: guardianOf('levi'),
        idempotencyKey: 'test:opted-out',
      }),
    );
    const noPhone = await system((tx) =>
      enqueueMessage(tx, sys(), {
        ...base,
        guardian: guardianOf('mizrahi'),
        idempotencyKey: 'test:no-phone',
      }),
    );
    const missing = await system((tx) =>
      enqueueMessage(tx, sys(), {
        guardian: guardianOf('cohen'),
        templateKey: 'payment_link',
        vars: { amount: '₪330' },
        idempotencyKey: 'test:missing',
      }),
    );
    const rows = await q(
      `select idempotency_key, status, block_reason, body from messages where idempotency_key like 'test:%' and status = 'blocked' order by idempotency_key`,
    );
    expect(rows).toEqual([
      {
        idempotency_key: 'test:missing',
        status: 'blocked',
        block_reason: 'missing_variable',
        body: null,
      },
      {
        idempotency_key: 'test:no-phone',
        status: 'blocked',
        block_reason: 'no_phone',
        body: 'שלום',
      },
      {
        idempotency_key: 'test:opted-out',
        status: 'blocked',
        block_reason: 'opted_out',
        body: 'שלום',
      },
    ]);
    expect([optedOut.status, noPhone.status, missing.status]).toEqual([
      'blocked',
      'blocked',
      'blocked',
    ]);
  });

  it('logs a switched-off template as blocked', async () => {
    const tpl = (await owner((tx) => listTemplates(tx))).find(
      (x) => x.key === 'receipt_ready' && x.locale === 'he',
    );
    await owner((tx) =>
      updateTemplate(tx, ctx, { id: tpl?.id as string, body: tpl?.body as string, active: 'off' }),
    );
    const m = await system((tx) =>
      enqueueMessage(tx, sys(), {
        guardian: guardianOf('cohen'),
        templateKey: 'receipt_ready',
        vars: { amount: '₪330', url: 'https://example.test/r' },
        idempotencyKey: 'test:inactive',
      }),
    );
    const [row] = await q(`select block_reason from messages where id = $1`, [m.id]);
    expect(row.block_reason).toBe('template_inactive');
  });

  it('refuses a template variable the code does not fill', async () => {
    const tpl = (await owner((tx) => listTemplates(tx))).find(
      (x) => x.key === 'payment_link' && x.locale === 'he',
    );
    expect(
      await codeOf(
        owner((tx) =>
          updateTemplate(tx, ctx, {
            id: tpl?.id as string,
            body: '{{amount}} {{oops}}',
            active: 'on',
          }),
        ),
      ),
    ).toBe('comms.errors.unknownVariable');
  });

  it('retries a failing send and marks it failed after three attempts', async () => {
    const provider = new FakeMessagingProvider();
    const m = await system((tx) =>
      enqueueMessage(tx, sys(), {
        guardian: { ...guardianOf('cohen'), phoneE164: '+972500000000' },
        templateKey: 'free_text',
        vars: { text: 'בדיקה' },
        idempotencyKey: 'test:unreachable',
        notBefore: israelInstant('2026-10-12', '10:00'),
      }),
    );
    let now = israelInstant('2026-10-12', '10:00');
    for (let i = 0; i < 3; i++) {
      await system((tx) => dispatchDue(tx, sys(), provider, now));
      now = new Date(now.getTime() + 60 * 60_000);
    }
    const [row] = await q(`select status, attempts, error from messages where id = $1`, [m.id]);
    expect(row).toMatchObject({ status: 'failed', attempts: 3 });
    expect(row.error).toMatch(/unreachable/);
  });

  it('never calls the provider for a message without a row', async () => {
    const provider = new FakeMessagingProvider();
    await system((tx) => dispatchDue(tx, sys(), provider, israelInstant('2026-10-13', '10:00')));
    for (const s of provider.sent) {
      const [row] = await q(
        `select status, provider_message_id from messages where idempotency_key = $1`,
        [s.ctx.idempotencyKey],
      );
      expect(row).toEqual({ status: 'sent', provider_message_id: s.providerMessageId });
    }
    // The log is history: a sent message cannot be changed or deleted.
    const [sent] = await q(`select id from messages where status = 'sent' limit 1`);
    expect(
      await codeOf(owner((tx) => tx.execute(sql`delete from messages where id = ${sent.id}`))),
    ).toBe('comms.errors.logLocked');
  });
});

describe('automations', () => {
  it('can be switched off, and ignores events it does not know', async () => {
    const rule = (await owner((tx) => listAutomations(tx))).find(
      (r) => r.eventType === 'billing.dunning_step',
    );
    await owner((tx) => setAutomation(tx, rule?.id as string, false));
    const off = await system((tx) =>
      runAutomation(tx, sys(), {
        id: crypto.randomUUID(),
        type: 'billing.dunning_step',
        payload: { householdId: hh.cohen, amountAgorot: 33000 },
      }),
    );
    expect(off.outcome).toBe('disabled');
    await owner((tx) => setAutomation(tx, rule?.id as string, true));
    const on = await system((tx) =>
      runAutomation(tx, sys(), {
        id: crypto.randomUUID(),
        type: 'billing.dunning_step',
        payload: { householdId: hh.cohen, amountAgorot: 33000 },
      }),
    );
    expect(on).toMatchObject({ outcome: 'done', queued: 1 });
    expect(
      (
        await system((tx) =>
          runAutomation(tx, sys(), {
            id: crypto.randomUUID(),
            type: 'venues.venue_created',
            payload: {},
          }),
        )
      ).outcome,
    ).toBe('unmapped');
  });

  it('messages every family of a lesson about an instructor change', async () => {
    const ev = crypto.randomUUID();
    const r = await system((tx) =>
      runAutomation(tx, sys(), {
        id: ev,
        type: 'scheduling.staff_changed',
        payload: { sessionIds: [todaySession], toStaffId: staff, classTemplateId: null },
      }),
    );
    // Cohen (two children) and Levi (opted out, so blocked but logged).
    expect(r).toMatchObject({ queued: 2, blocked: 1 });
    const [m] = await q(
      `select body from messages where source_event_id = $1 and status <> 'blocked' limit 1`,
      [ev],
    );
    expect(m.body).toContain('מיכל');
  });
});

describe('broadcasts and the holiday notice', () => {
  it('previews and sends to a segment, logging opted-out guardians', async () => {
    expect(await owner((tx) => previewAudience(tx, {}))).toEqual({
      households: 2,
      guardians: 2,
      reachable: 1,
    });
    const r = await owner((tx) =>
      createBroadcast(tx, ctx, { title: 'בדיקה', body: 'שלום לכולם', owing: 'off' }),
    );
    expect(r).toMatchObject({ status: 'sent', households: 2, queued: 1, blocked: 1 });
    const rows = await q(`select status from messages where broadcast_id = $1 order by status`, [
      r.id,
    ]);
    expect(
      rows.map((x: { status: string }) => (x.status === 'held' ? 'queued' : x.status)),
    ).toEqual(['blocked', 'queued']);
    expect(await owner((tx) => previewAudience(tx, { owing: true }))).toMatchObject({
      households: 0,
    });
  });

  it('keeps a scheduled broadcast for its time, and can cancel it', async () => {
    const r = await owner((tx) =>
      createBroadcast(tx, ctx, {
        title: 'מחר',
        body: 'נתראה',
        scheduledFor: '2099-01-01T10:00',
        owing: 'off',
      }),
    );
    expect(r.status).toBe('scheduled');
    expect(await owner((tx) => dueBroadcasts(tx))).toEqual([]);
    expect(
      (await owner((tx) => dueBroadcasts(tx, new Date('2099-01-02T00:00:00Z')))).map((b) => b.id),
    ).toEqual([r.id]);
    await owner((tx) => cancelBroadcast(tx, r.id));
    expect(await codeOf(owner((tx) => cancelBroadcast(tx, r.id)))).toBe(
      'comms.errors.broadcastClosed',
    );
  });

  it('announces Pesach once to every active family', async () => {
    const r = await system((tx) => sendHolidayNotice(tx, sys(), '2027-04-19'));
    expect(r).toMatchObject({
      outcome: 'sent',
      stretch: { start: '2027-04-21', resumeOn: '2027-04-29' },
    });
    const before = await q(
      `select count(*)::int as n from messages where template_key = 'holiday_schedule'`,
    );
    await system((tx) => sendHolidayNotice(tx, sys(), '2027-04-20'));
    const after = await q(
      `select count(*)::int as n from messages where template_key = 'holiday_schedule'`,
    );
    expect(after[0].n).toBe(before[0].n);
    expect((await system((tx) => sendHolidayNotice(tx, sys(), '2026-11-10'))).outcome).toBe('none');
    const [m] = await q(
      `select body from messages where template_key = 'holiday_schedule' and status <> 'blocked'`,
    );
    expect(m.body).toContain('יום חמישי 29.4');
  });
});

describe('who reads conversations', () => {
  it('lets a parent read only their own household, and staff nothing', async () => {
    const mine = await as('parent', (tx) => listMessages(tx));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m) => m.householdId === hh.cohen)).toBe(true);
    expect(await as('instructor', (tx) => listMessages(tx))).toEqual([]);
    expect(await as('instructor', (tx) => listInbox(tx))).toEqual([]);
    expect(
      await codeOf(
        as('parent', (tx) =>
          enqueueMessage(
            tx,
            { orgId: ctx.orgId, userId: users.parent },
            {
              guardian: guardianOf('cohen'),
              templateKey: 'free_text',
              vars: { text: 'x' },
              idempotencyKey: 'test:parent',
            },
          ),
        ),
      ),
    ).toBe('common.errors.forbidden');
  });
});
