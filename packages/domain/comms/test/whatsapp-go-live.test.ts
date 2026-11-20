/**
 * Going live with the business's own number (WhatsApp track W10), against a real database with RLS and Meta's fake:
 * 1. the owner asks for a check; the worker's check writes what Meta says about the number and points Meta's webhook
 *    at the connection, or keeps Meta's refusal for her to read;
 * 2. every message goes to Meta's review once, a message named by hand is left alone, one Meta would refuse as
 *    written is reported, and a template already at Meta is adopted instead of sent twice;
 * 3. Meta's decisions come home, and the page shows where each message stands;
 * 4. the owner sends a test message from the page. Only the owner can do any of it.
 * Every phone, token and secret is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { createDataKey, DomainError, type ServiceContext } from '@rswim/domain-core';
import { FakeWhatsAppAdmin } from '@rswim/integrations';
import {
  connectWhatsApp,
  loadWhatsApp,
  metaReviewPending,
  metaTemplateOverview,
  requestMetaTemplates,
  requestWhatsAppCheck,
  runWhatsAppCheck,
  sendWhatsAppTest,
  setMetaTemplate,
  submitMetaTemplates,
  syncMetaTemplates,
  WHATSAPP_CHECK_REQUESTED,
  WHATSAPP_TEMPLATES_REQUESTED,
  whatsappConnection,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
let officeId: string;
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const system = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(t.db, ctx.orgId, fn);
const asOwner = <T>(fn: Parameters<typeof asUser<T>>[2]) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const asOffice = <T>(fn: Parameters<typeof asUser<T>>[2]) =>
  asUser(t.db, { sub: officeId, org_id: ctx.orgId }, fn);
const admin = () =>
  new FakeWhatsAppAdmin({ phoneNumberId: '1000001', businessAccountId: '2000001' });
const broken = () =>
  new FakeWhatsAppAdmin({ phoneNumberId: '1000001', businessAccountId: '20000000' });
const facts = async () => {
  const loaded = await system((tx) => loadWhatsApp(tx, ctx.orgId));
  if (!loaded) throw new Error('no connection');
  return { connectionId: loaded.connectionId, verifyToken: loaded.verifyToken };
};
const notConnected = (e: unknown) =>
  e instanceof DomainError && e.code === 'whatsapp.errors.notConnected';

beforeAll(async () => {
  t = await createTestDatabase();
  const master = Buffer.alloc(32, 7);
  process.env.RSWIM_MASTER_KEY = master.toString('base64');
  const [org] = await q(
    `insert into organizations (slug, name) values ('live', 'בית ספר עולה לאוויר (דמו)') returning id`,
  );
  await q(`insert into org_settings (organization_id) values ($1)`, [org.id]);
  await q(`insert into org_keys (organization_id, wrapped_dek) values ($1, $2)`, [
    org.id,
    createDataKey(master, org.id).wrapped,
  ]);
  const [u] = await q(`insert into auth.users (email) values ('owner@live.test') returning id`);
  const [o] = await q(`insert into auth.users (email) values ('office@live.test') returning id`);
  await q(
    `insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'admin')`,
    [org.id, u.id, o.id],
  );
  ctx = { orgId: org.id, userId: u.id };
  officeId = o.id;
});
afterAll(async () => {
  await t.drop();
});

describe('checking the connection', () => {
  it('has nothing to check before a number is connected', async () => {
    await expect(asOwner((tx) => requestWhatsAppCheck(tx, ctx))).rejects.toSatisfy(notConnected);
    await expect(asOwner((tx) => requestMetaTemplates(tx, ctx))).rejects.toSatisfy(notConnected);
  });

  it('asks the worker, which writes what Meta says and points the webhook at this connection', async () => {
    await asOwner((tx) =>
      connectWhatsApp(tx, ctx, {
        phoneNumberId: '1000001',
        businessAccountId: '2000001',
        displayPhone: '+972 2-555-0101',
        accessToken: 'fake-access-token-0123456789',
        appSecret: 'a'.repeat(32),
      }),
    );
    await asOwner((tx) => requestWhatsAppCheck(tx, ctx));
    const conn = await facts();
    const events = await q(`select payload from outbox where event_type = $1`, [
      WHATSAPP_CHECK_REQUESTED,
    ]);
    expect(events).toEqual([{ payload: { connectionId: conn.connectionId } }]);

    const meta = admin();
    expect(
      await system((tx) => runWhatsAppCheck(tx, conn, meta, 'https://app.example.test/')),
    ).toBe('ok');
    expect(meta.subscriptions).toEqual([
      {
        callbackUrl: `https://app.example.test/api/webhooks/whatsapp/${conn.connectionId}`,
        verifyToken: conn.verifyToken,
      },
    ]);
    const view = await asOffice((tx) => whatsappConnection(tx));
    expect(view).toMatchObject({
      verifiedName: 'Demo Business',
      quality: 'GREEN',
      displayPhone: '+972 2-555-0101',
      checkError: null,
    });
    expect(view?.checkedAt).toBeInstanceOf(Date);
    expect(view?.subscribedAt).toBeInstanceOf(Date);
  });

  it("keeps Meta's refusal in Meta's words", async () => {
    const conn = await facts();
    expect(
      await system((tx) => runWhatsAppCheck(tx, conn, broken(), 'https://app.example.test')),
    ).toBe('failed');
    const view = await asOwner((tx) => whatsappConnection(tx));
    expect(view?.checkError).toContain('Invalid parameter');
    expect(view?.subscribedAt).toBeNull();
    await asOwner((tx) => requestWhatsAppCheck(tx, ctx));
    expect((await asOwner((tx) => whatsappConnection(tx)))?.checkError).toBeNull();
  });

  it('is the owner’s to ask', async () => {
    await expect(asOffice((tx) => requestWhatsAppCheck(tx, ctx))).rejects.toSatisfy(notConnected);
    await expect(asOffice((tx) => requestMetaTemplates(tx, ctx))).rejects.toSatisfy(notConnected);
    await expect(
      asOffice((tx) => sendWhatsAppTest(tx, ctx, { phone: '+972501234567', text: 'בדיקה' })),
    ).rejects.toSatisfy(notConnected);
  });
});

describe("sending the messages to Meta's review", () => {
  const meta = admin();

  it('sends each message once, and leaves alone what was named by hand or cannot be a template', async () => {
    await asOwner((tx) =>
      setMetaTemplate(tx, ctx, {
        key: 'lesson_reminder',
        locale: 'he',
        metaName: 'my_own_reminder',
        metaParams: '',
      }),
    );
    await asOwner((tx) => requestMetaTemplates(tx, ctx));
    expect(
      await q(`select 1 from outbox where event_type = $1`, [WHATSAPP_TEMPLATES_REQUESTED]),
    ).toHaveLength(1);

    const first = await system((tx) => submitMetaTemplates(tx, ctx, meta));
    expect(first.submitted).toBeGreaterThan(50);
    expect(first.submitted).toBe(meta.created.size);
    expect(first.failed).toBe(0);
    // free_text is only a placeholder in both languages, and one message is named by hand.
    expect(first.skipped).toBeGreaterThanOrEqual(3);
    for (const tpl of meta.created.values()) {
      expect(tpl.name).toMatch(/^[a-z0-9_]+$/);
      expect(tpl.text).not.toMatch(/\{\{[a-z_]/);
      expect(tpl.examples.every((e) => e.length > 0)).toBe(true);
    }

    const overview = await asOwner((tx) => metaTemplateOverview(tx, ctx));
    const state = (key: string, locale = 'he') =>
      overview.find((r) => r.key === key && r.locale === locale)?.state;
    expect(state('lesson_reminder')).toBe('by_hand');
    expect(state('lesson_reminder', 'en')).toBe('waiting');
    expect(state('free_text')).toBe('no_text');
    expect(await system((tx) => metaReviewPending(tx))).toBe(true);

    const second = await system((tx) => submitMetaTemplates(tx, ctx, meta));
    expect(second).toMatchObject({ submitted: 0, adopted: 0, failed: 0 });
    expect(second.skipped).toBe(first.submitted + first.skipped);
  });

  it('adopts a template that is already at Meta, and sends a changed text again under a new name', async () => {
    const [row] = await q(
      `update message_templates set meta_name = null, meta_status = null, meta_template_id = null
       where key = 'lesson_reminder' and locale = 'en' returning id`,
    );
    const before = meta.created.size;
    expect(await system((tx) => submitMetaTemplates(tx, ctx, meta))).toMatchObject({
      submitted: 0,
      adopted: 1,
    });
    expect(meta.created.size).toBe(before);

    await q(`update message_templates set body = body || ' Thank you.' where id = $1`, [row.id]);
    const overview = await asOwner((tx) => metaTemplateOverview(tx, ctx));
    expect(overview.find((r) => r.key === 'lesson_reminder' && r.locale === 'en')?.state).toBe(
      'not_sent',
    );
    expect(await system((tx) => submitMetaTemplates(tx, ctx, meta))).toMatchObject({
      submitted: 1,
      adopted: 0,
    });
    expect(meta.created.size).toBe(before + 1);
  });

  it("brings Meta's decisions home", async () => {
    const [refused] = await q(
      `select meta_name from message_templates where key = 'lesson_reminder' and locale = 'en'`,
    );
    meta.review([refused.meta_name as string]);
    const changed = await system((tx) => syncMetaTemplates(tx, meta));
    expect(changed).toBeGreaterThan(5);
    expect(await system((tx) => syncMetaTemplates(tx, meta))).toBe(0);
    expect(await system((tx) => metaReviewPending(tx))).toBe(false);
    const overview = await asOwner((tx) => metaTemplateOverview(tx, ctx));
    expect(overview.find((r) => r.key === 'lesson_reminder' && r.locale === 'en')?.state).toBe(
      'rejected',
    );
    expect(overview.filter((r) => r.state === 'approved').length).toBeGreaterThan(5);
    expect(overview.filter((r) => r.state === 'waiting')).toEqual([]);
  });

  it("keeps Meta's refusal on each message when sending fails", async () => {
    await q(`update message_templates set body = body || ' שוב.' where key = 'payment_failed'`);
    const out = await system((tx) => submitMetaTemplates(tx, ctx, broken()));
    expect(out.submitted).toBe(0);
    expect(out.failed).toBeGreaterThanOrEqual(1);
    const [row] = await q(
      `select meta_error from message_templates where key = 'payment_failed' and locale = 'he'`,
    );
    expect(row.meta_error).toContain('Invalid parameter');
  });

  it('asks Meta nothing when no template of ours is there', async () => {
    const [other] = await q(
      `insert into organizations (slug, name) values ('quiet', 'בית ספר שקט (דמו)') returning id`,
    );
    expect(await withOrg(t.db, other.id as string, (tx) => syncMetaTemplates(tx, broken()))).toBe(
      0,
    );
  });
});

describe('the test message', () => {
  it('goes out as free text from the business number', async () => {
    const sent = await asOwner((tx) =>
      sendWhatsAppTest(tx, ctx, { phone: '+972501234567', text: 'בדיקה מהמסך' }),
    );
    expect(sent.created).toBe(true);
    const [row] = await q(`select body, to_phone_e164 from messages where id = $1`, [sent.id]);
    expect(row).toMatchObject({ body: 'בדיקה מהמסך', to_phone_e164: '+972501234567' });
    await expect(
      asOwner((tx) => sendWhatsAppTest(tx, ctx, { phone: '123', text: 'x' })),
    ).rejects.toThrow();
  });
});
