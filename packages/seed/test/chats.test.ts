/**
 * WhatsApp track W9 on the fake demo school: every conversation in one list by phone, the office reads the thread and
 * answers, and "I'm taking over" keeps the bot quiet for that number until the conversation is given back. Every
 * phone is fake.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  botPerformance,
  chatHeld,
  getChat,
  intakeInbound,
  listChats,
  releaseChat,
  replyToChat,
  takeOverChat,
} from '@rswim/domain-comms';
import { FakeParentBotModel, runParentBot } from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const model = new FakeParentBotModel();
const office: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const LEAD = '+972585559001';
const QUIET = '+972585559002';
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);

/** Someone writes on WhatsApp; the bot runs on the message as the worker would. */
async function write(phone: string, body: string) {
  const intake = await withOrg(t.db, DEMO_ORG.id, (tx) =>
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
  return withOrg(t.db, DEMO_ORG.id, (tx) =>
    runParentBot(tx, worker, model, intake.inboundMessageId),
  );
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('the conversations screen', () => {
  it('lists a new conversation with the bot’s answer as its last line', async () => {
    expect((await write(LEAD, 'היי')).outcome).toBe('answered');
    const chats = await owner((tx) => listChats(tx));
    const chat = chats.find((c) => c.phone === LEAD);
    expect(chat).toMatchObject({
      kind: 'lead',
      held: false,
      bot: 'answered',
      lastDirection: 'out',
    });
    expect(chat?.lastBody).toContain('איך קוראים לך');
    // The newest conversation comes first.
    expect(chats[0]?.phone).toBe(LEAD);
  });

  it('shows the whole thread, each outgoing line with who wrote it', async () => {
    const chat = await owner((tx) => getChat(tx, LEAD));
    expect(chat).toMatchObject({ phone: LEAD, kind: 'lead', heldSince: null, windowOpen: true });
    expect(chat.lines.map((l) => [l.direction, l.by])).toEqual([
      ['in', 'person'],
      ['out', 'bot'],
    ]);
  });

  it('does not know a number that never wrote, or a broken one', async () => {
    await expect(owner((tx) => getChat(tx, '+972585559999'))).rejects.toMatchObject({
      code: 'common.errors.notFound',
    });
    await expect(owner((tx) => getChat(tx, 'nope'))).rejects.toThrow();
  });
});

describe('“I’m taking over”', () => {
  it('keeps the bot quiet for that number, and only for that number', async () => {
    await owner((tx) => takeOverChat(tx, office, { phone: LEAD }));
    // Taking twice changes nothing.
    await owner((tx) => takeOverChat(tx, office, { phone: LEAD }));
    expect(await q(`select taken_by from chat_holds where phone_e164 = $1`, [LEAD])).toEqual([
      { taken_by: PERSONAS.owner.userId },
    ]);
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => chatHeld(tx, LEAD))).toBe(true);
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => chatHeld(tx, null))).toBe(false);

    expect(await write(LEAD, 'קוראים לי מיכל')).toEqual({
      outcome: 'skipped',
      reason: 'taken_over',
    });
    expect((await write(QUIET, 'היי')).outcome).toBe('answered');

    const held = await owner((tx) => listChats(tx, { filter: 'held' }));
    expect(held.map((c) => c.phone)).toEqual([LEAD]);
    expect(held[0]).toMatchObject({ held: true, lastDirection: 'in', lastBody: 'קוראים לי מיכל' });
    expect(held[0]?.open).toBeGreaterThan(0);
    const waiting = await owner((tx) => listChats(tx, { filter: 'waiting' }));
    expect(waiting.map((c) => c.phone)).toContain(LEAD);
    expect((await owner((tx) => getChat(tx, LEAD))).heldSince).toBeInstanceOf(Date);
  });

  it('lets the office answer: the message goes out and nothing of this person waits any more', async () => {
    const m = await owner((tx) =>
      replyToChat(tx, office, { phone: LEAD, text: 'היי מיכל, כאן רעות' }),
    );
    // Queued, or held until Shabbat or quiet hours end when the suite runs then (it runs on the real clock).
    expect(['queued', 'held']).toContain(m.status);
    const chat = await owner((tx) => getChat(tx, LEAD));
    expect(chat.lines.at(-1)).toMatchObject({
      direction: 'out',
      by: 'office',
      body: 'היי מיכל, כאן רעות',
    });
    const [row] = (await owner((tx) => listChats(tx))).filter((c) => c.phone === LEAD);
    expect(row).toMatchObject({ open: 0, lastDirection: 'out' });
    expect((await q(`select stage from leads where phone_e164 = $1`, [LEAD]))[0].stage).toBe(
      'talking',
    );
    await expect(
      owner((tx) => replyToChat(tx, office, { phone: '+972585559999', text: 'היי' })),
    ).rejects.toMatchObject({ code: 'common.errors.notFound' });
  });

  it('gives the conversation back to the bot', async () => {
    await owner((tx) => releaseChat(tx, { phone: LEAD }));
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => chatHeld(tx, LEAD))).toBe(false);
    expect(await owner((tx) => listChats(tx, { filter: 'held' }))).toEqual([]);
  });

  it('is the office’s alone: a parent cannot see or take a conversation', async () => {
    await owner((tx) => takeOverChat(tx, office, { phone: QUIET }));
    const parent = { sub: PERSONAS.parent.userId, org_id: DEMO_ORG.id };
    expect(
      await asUser(t.db, parent, async (tx) => (await tx.execute(`select 1 from chat_holds`)).rows),
    ).toEqual([]);
    await expect(
      asUser(t.db, parent, (tx) =>
        takeOverChat(tx, { orgId: DEMO_ORG.id, userId: PERSONAS.parent.userId }, { phone: LEAD }),
      ),
    ).rejects.toThrow();
    await owner((tx) => releaseChat(tx, { phone: QUIET }));
  });
});

describe('answering whoever wrote', () => {
  it('answers a family through the inbox and a staff member as free text', async () => {
    const [g] = await q(
      `select phone_e164 from guardians where organization_id = $1 and phone_e164 = $2`,
      [DEMO_ORG.id, PERSONAS.parent.phone],
    );
    await write(g.phone_e164, 'שלום, רציתי לשאול משהו');
    const family = await owner((tx) => getChat(tx, g.phone_e164));
    expect(family.kind).toBe('family');
    expect(family.name).toBeTruthy();
    expect(family.householdId).not.toBeNull();
    await owner((tx) => replyToChat(tx, office, { phone: g.phone_e164, text: 'בשמחה, מה השאלה?' }));
    const [out] = await q(
      `select guardian_id from messages where to_phone_e164 = $1 and body = 'בשמחה, מה השאלה?'`,
      [g.phone_e164],
    );
    expect(out.guardian_id).not.toBeNull();

    const [s] = await q(
      `select phone_e164 from staff_members where organization_id = $1 and phone_e164 is not null limit 1`,
      [DEMO_ORG.id],
    );
    await write(s.phone_e164, 'מישהו יכול לחזור אליי?');
    const staff = await owner((tx) => getChat(tx, s.phone_e164));
    expect(staff).toMatchObject({ kind: 'staff', name: null });
    await owner((tx) => replyToChat(tx, office, { phone: s.phone_e164, text: 'חוזרים אלייך' }));
    const [toStaff] = await q(
      `select guardian_id, template_key from messages where to_phone_e164 = $1 and body = 'חוזרים אלייך'`,
      [s.phone_e164],
    );
    expect(toStaff).toEqual({ guardian_id: null, template_key: 'free_text' });
  });
});

describe('the bot’s numbers', () => {
  it('counts what it closed alone, what it passed on and why, and what is held', async () => {
    await write('+972585559003', 'אפשר לדבר עם נציג בבקשה?');
    await owner((tx) => takeOverChat(tx, office, { phone: QUIET }));
    const p = await owner((tx) => botPerformance(tx));
    expect(p.answered).toBeGreaterThanOrEqual(2);
    expect(p.handedOff).toBeGreaterThanOrEqual(1);
    expect(p.total).toBe(p.answered + p.handedOff);
    expect(p.alonePercent).toBe(Math.round((p.answered / p.total) * 100));
    expect(p.reasons.map((r) => r.reason)).toContain('needs_action');
    expect(p.held).toBe(1);
    expect(p.waiting).toBeGreaterThanOrEqual(1);
  });
});
