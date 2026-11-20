/**
 * The bot's personal invite (WhatsApp track) on the fake demo school: a new customer asks how to join and gets a link
 * made for their phone; signed in with that phone they join the school at once, in the family the bot opened from
 * what they said. Another phone is refused, a used or expired link no longer works, and asking again before then sends
 * the same link. Every phone is fake.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser } from '@rswim/db';
import { DEMO_ORG } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound } from '@rswim/domain-comms';
import {
  closeInvite,
  FakeParentBotModel,
  inviteByToken,
  leadInviteToken,
  namesOf,
  openInviteFamily,
  runParentBot,
} from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { claimByPhone, myPhone } from '@rswim/domain-platform';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const model = new FakeParentBotModel();
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const system = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(t.db, DEMO_ORG.id, fn);

/** Someone writes on WhatsApp and the bot answers, as the worker would. Returns what the bot sent. */
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
  const [sent] = await q(
    `select body from messages where to_phone_e164 = $1 order by created_at desc limit 1`,
    [phone],
  );
  return sent?.body as string;
}

/** A signed-in account with a verified phone, as phone sign-in makes one. */
async function account(phone: string) {
  const [u] = await q(`insert into auth.users (phone) values ($1) returning id`, [phone]);
  return u.id as string;
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe("the bot's personal invite", () => {
  it('lets the invited phone join the school at once, in the family opened from the chat', async () => {
    const phone = '+972585550031';
    await write(phone, 'קוראים לי מאיה אדלר');
    const body = await write(phone, 'אפשר קישור להרשמה?');
    const [lead] = await q(`select * from leads where phone_e164 = $1`, [phone]);
    expect(body).toContain(`/i/${lead.invite_token}`);
    // Asking again sends the same link.
    expect(await system((tx) => leadInviteToken(tx, lead.id))).toBe(lead.invite_token);

    const view = await inviteByToken(t.db, lead.invite_token);
    expect(view).toMatchObject({
      orgId: DEMO_ORG.id,
      slug: DEMO_ORG.slug,
      firstName: 'מאיה',
      phoneE164: phone,
      state: 'open',
    });

    // Someone else's phone is refused.
    const stranger = await account('+972585550039');
    const strangerPhone = await asUser(t.db, { sub: stranger, org_id: null }, (tx) => myPhone(tx));
    await expect(openInviteFamily(t.db, lead.invite_token, strangerPhone)).rejects.toThrow(
      'leadInvite.errors.otherPhone',
    );

    const user = await account(phone);
    const signedIn = await asUser(t.db, { sub: user, org_id: null }, (tx) => myPhone(tx));
    expect(signedIn).toBe(phone);
    const opened = await openInviteFamily(t.db, lead.invite_token, signedIn);
    await asUser(t.db, { sub: user, org_id: null }, (tx) => claimByPhone(tx, DEMO_ORG.id));
    await closeInvite(t.db, opened.orgId, opened.leadId);

    const [member] = await q(
      `select m.role, g.first_name, g.last_name from memberships m join guardians g on g.id = m.guardian_id
       where m.user_id = $1 and m.organization_id = $2`,
      [user, DEMO_ORG.id],
    );
    expect(member).toEqual({ role: 'parent', first_name: 'מאיה', last_name: 'אדלר' });
    const [after] = await q(`select household_id, invite_used_at from leads where id = $1`, [
      lead.id,
    ]);
    expect(after.household_id).not.toBeNull();
    expect(after.invite_used_at).not.toBeNull();
    expect((await inviteByToken(t.db, lead.invite_token))?.state).toBe('used');
    await expect(openInviteFamily(t.db, lead.invite_token, signedIn)).rejects.toThrow(
      'leadInvite.errors.expired',
    );
    // A used invite is replaced by a new one when the bot is asked again.
    expect(await system((tx) => leadInviteToken(tx, lead.id))).not.toBe(lead.invite_token);
  });

  it('stops working once expired, and knows no made-up link', async () => {
    const phone = '+972585550032';
    await write(phone, 'קוראים לי דור');
    const [lead] = await q(`select id from leads where phone_e164 = $1`, [phone]);
    const token = (await system((tx) => leadInviteToken(tx, lead.id))) as string;
    await q(`update leads set invite_expires_at = now() - interval '1 minute' where id = $1`, [
      lead.id,
    ]);
    expect((await inviteByToken(t.db, token))?.state).toBe('expired');
    await expect(openInviteFamily(t.db, token, phone)).rejects.toThrow('leadInvite.errors.expired');
    expect(await inviteByToken(t.db, 'not a token')).toBeNull();
    await expect(openInviteFamily(t.db, 'x'.repeat(30), phone)).rejects.toThrow(
      'leadInvite.errors.unknown',
    );
  });

  it('splits a name for the family file', () => {
    expect(namesOf('רונית כהן לוי', '+972')).toEqual({ first: 'רונית', last: 'כהן לוי' });
    expect(namesOf('דור', '+972')).toEqual({ first: 'דור', last: 'דור' });
    expect(namesOf(null, '+972585550033')).toEqual({
      first: '+972585550033',
      last: '+972585550033',
    });
  });
});
