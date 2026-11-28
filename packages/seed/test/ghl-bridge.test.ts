/**
 * WhatsApp through the business's own GHL sub-account (the GHL bridge) on the fake demo school, against a real
 * database with RLS:
 * 1. the owner connects the sub-account; the token is sealed and only the system role opens it; the worker checks it;
 * 2. the hook needs the connection's own secret and only names a contact; the worker reads what was said from GHL,
 *    each message once, and nothing from before the connection;
 * 3. in shadow mode the bot's answer waits as a suggestion that a person sends or drops;
 * 4. someone else answering in GHL (the old GHL bot) is counted, and in live mode gives the conversation to a person.
 * Every phone, id and token is fake; GHL is the in-memory sub-account.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CopilotActionKind } from '@rswim/contracts';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  chatHeld,
  connectGhlBridge,
  dismissSuggestion,
  getChat,
  ghlBridge,
  ghlBridgeMode,
  ingestGhlBridgeHook,
  loadGhlBridge,
  runGhlBridgeCheck,
  runGhlBridgePull,
  sendSuggestion,
  setGhlBridgeMode,
  setGhlWhatsApp,
  GHL_BRIDGE_PULL_REQUESTED,
  type LoadedGhlBridge,
} from '@rswim/domain-comms';
import {
  FakeParentBotModel,
  getAgentSettings,
  runParentBot,
  takeAction,
} from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { FakeGhlBridgeClient } from '@rswim/integrations';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const model = new FakeParentBotModel();
const office: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const LOCATION = 'loc-demo-bridge';
const TOKEN = `pit-${randomBytes(16).toString('hex')}`;
const LEAD = '+972508558001';
const SECOND = '+972508558002';
const fake = new FakeGhlBridgeClient(LOCATION);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, DEMO_ORG.id, fn);
const bridge = async () =>
  (await system((tx) => loadGhlBridge(tx, DEMO_ORG.id))) as LoadedGhlBridge;
const later = (min: number) => new Date(Date.now() + min * 60_000);
const pull = (contactId: string, now = later(5)) =>
  system(async (tx) => {
    const { plan: _plan, ...r } = await runGhlBridgePull(
      tx,
      worker,
      await bridge(),
      fake,
      contactId,
      now,
    );
    return r;
  });

beforeAll(async () => {
  const master = randomBytes(32);
  process.env.RSWIM_MASTER_KEY = master.toString('base64');
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: master });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('open to every business (A1, 2026-11-28)', () => {
  it('needs no option from the platform', async () => {
    const [sub] = await q(`select extras from org_subscriptions where organization_id = $1`, [
      DEMO_ORG.id,
    ]);
    expect(sub.extras).toEqual([]);
  });
});

describe('connecting the sub-account', () => {
  it('seals the token, starts in shadow mode and asks the worker to check it', async () => {
    await owner((tx) => connectGhlBridge(tx, office, { locationId: LOCATION, token: TOKEN }));
    const view = await owner((tx) => ghlBridge(tx));
    expect(view).toMatchObject({ status: 'connected', mode: 'shadow', locationId: LOCATION });
    expect(view?.hookToken).toMatch(/^[0-9a-f]{48}$/);
    expect(JSON.stringify(await q(`select enc_token from ghl_connections`))).not.toContain(TOKEN);
    expect((await bridge()).token).toBe(TOKEN);
    expect(
      await q(
        `select count(*)::int n from outbox where event_type = 'comms.ghl_bridge_check_requested'`,
      ),
    ).toEqual([{ n: 1 }]);
    // The location also becomes the school's GHL location for contacts and pipelines.
    const [s] = await q(
      `select integrations -> 'ghl' ->> 'locationId' loc from org_settings where organization_id = $1`,
      [DEMO_ORG.id],
    );
    expect(s.loc).toBe(LOCATION);
  });

  it('cannot run WhatsApp before the check passed; the check keeps what GHL said', async () => {
    await expect(owner((tx) => setGhlWhatsApp(tx, { on: '1' }))).rejects.toMatchObject({
      code: 'ghlBridge.errors.checkFirst',
    });
    expect(
      await system(async (tx) =>
        runGhlBridgeCheck(tx, await bridge(), new FakeGhlBridgeClient('bad')),
      ),
    ).toBe('failed');
    expect((await owner((tx) => ghlBridge(tx)))?.checkError).toContain('401');
    expect(await system(async (tx) => runGhlBridgeCheck(tx, await bridge(), fake))).toBe('ok');
    expect(await owner((tx) => ghlBridge(tx))).toMatchObject({
      checkError: null,
      locationName: 'Fake sub-account',
      whatsapp: false,
      summary: { pipelines: [{ name: 'Fake pipeline' }], tags: 1, missing: [] },
    });
  });

  it('tells the owner which permission the token lacks', async () => {
    const lacking = new FakeGhlBridgeClient('loc-nopipes');
    expect(await system(async (tx) => runGhlBridgeCheck(tx, await bridge(), lacking))).toBe('ok');
    expect((await owner((tx) => ghlBridge(tx)))?.summary).toMatchObject({
      pipelines: null,
      missing: ['pipelines'],
    });
    await system(async (tx) => runGhlBridgeCheck(tx, await bridge(), fake));
  });

  it('serves contacts only until the owner runs WhatsApp through it', async () => {
    const view = (await owner((tx) => ghlBridge(tx))) as NonNullable<
      Awaited<ReturnType<typeof ghlBridge>>
    >;
    const body = JSON.stringify({ contact_id: 'contact-lead-1' });
    expect(await ingestGhlBridgeHook(t.db, view.id, view.hookToken, body)).toBe('not_connected');
    expect(await owner((tx) => ghlBridgeMode(tx))).toBeNull();
    expect((await bridge()).whatsapp).toBe(false);
    await expect(owner((tx) => setGhlBridgeMode(tx, { mode: 'live' }))).rejects.toMatchObject({
      code: 'ghlBridge.errors.whatsappOff',
    });
    await owner((tx) => setGhlWhatsApp(tx, { on: '1' }));
    expect(await owner((tx) => ghlBridgeMode(tx))).toBe('shadow');
    expect((await bridge()).whatsapp).toBe(true);
  });
});

describe('the hook', () => {
  it('needs the connection’s own secret and only queues a read of the contact', async () => {
    const view = (await owner((tx) => ghlBridge(tx))) as NonNullable<
      Awaited<ReturnType<typeof ghlBridge>>
    >;
    const body = JSON.stringify({ contact_id: 'contact-lead-1', message: { body: 'forged text' } });
    expect(await ingestGhlBridgeHook(t.db, view.id, 'wrong', body)).toBe('forbidden');
    expect(await ingestGhlBridgeHook(t.db, randomUUID(), view.hookToken, body)).toBe(
      'unknown_connection',
    );
    expect(await ingestGhlBridgeHook(t.db, 'not-a-uuid', view.hookToken, body)).toBe(
      'unknown_connection',
    );
    expect(await ingestGhlBridgeHook(t.db, view.id, view.hookToken, '{nope')).toBe('ignored');
    expect(await ingestGhlBridgeHook(t.db, view.id, view.hookToken, '{}')).toBe('ignored');
    expect(await ingestGhlBridgeHook(t.db, view.id, view.hookToken, body)).toBe('queued');
    const rows = await q(`select payload from outbox where event_type = $1`, [
      GHL_BRIDGE_PULL_REQUESTED,
    ]);
    expect(rows).toEqual([{ payload: { connectionId: view.id, contactId: 'contact-lead-1' } }]);
  });
});

describe('reading the conversation in shadow mode', () => {
  it('brings the person’s message in once, and nothing from before the connection', async () => {
    fake.add('contact-lead-1', '050-855-8001', {
      id: 'ghl-history',
      direction: 'inbound',
      body: 'הודעה ישנה',
      at: new Date(Date.now() - 86_400_000),
      userId: null,
    });
    fake.add('contact-lead-1', '050-855-8001', {
      id: 'ghl-in-1',
      direction: 'inbound',
      body: 'היי, אפשר פרטים על שיעורי שחייה?',
      at: new Date(),
      userId: null,
    });
    expect(await pull('contact-lead-1')).toMatchObject({ inbound: 1, foreign: 0 });
    expect(await pull('contact-lead-1')).toMatchObject({ inbound: 0, foreign: 0 });
    const rows = await q(
      `select from_phone_e164 phone, lead_id is not null lead from inbound_messages where external_id = 'ghl-in-1'`,
    );
    expect(rows).toEqual([{ phone: LEAD, lead: true }]);
    expect(await q(`select 1 from inbound_messages where external_id = 'ghl-history'`)).toEqual([]);
    expect((await owner((tx) => ghlBridge(tx)))?.lastInboundAt).toBeInstanceOf(Date);
  });

  it('keeps the bot’s answer as a suggestion that a person sends', async () => {
    const [row] = await q(`select id from inbound_messages where external_id = 'ghl-in-1'`);
    expect((await system((tx) => runParentBot(tx, worker, model, row.id))).outcome).toBe(
      'answered',
    );
    const [m] = await q(`select id, status from messages where idempotency_key = $1`, [
      `bot:${row.id}`,
    ]);
    expect(m.status).toBe('suggested');
    const chat = await owner((tx) => getChat(tx, LEAD));
    expect(chat.lines.at(-1)).toMatchObject({ direction: 'out', by: 'bot', status: 'suggested' });
    await owner((tx) => sendSuggestion(tx, office, m.id));
    expect((await q(`select status from messages where id = $1`, [m.id]))[0].status).toMatch(
      /^(queued|held)$/,
    );
    await expect(owner((tx) => sendSuggestion(tx, office, m.id))).rejects.toMatchObject({
      code: 'chats.errors.noSuggestion',
    });
  });

  it('counts the old GHL bot’s answer without giving the conversation away', async () => {
    const now = Date.now();
    fake.add('contact-lead-1', '050-855-8001', {
      id: 'ghl-in-2',
      direction: 'inbound',
      body: 'כמה עולה?',
      at: new Date(now),
      userId: null,
    });
    fake.add('contact-lead-1', '050-855-8001', {
      id: 'ghl-old-bot-1',
      direction: 'outbound',
      body: 'תודה שפנית! נציג יחזור אליך',
      at: new Date(now + 1000),
      userId: null,
    });
    expect(await pull('contact-lead-1')).toMatchObject({
      inbound: 1,
      foreign: 1,
      foreignReplies: 1,
    });
    // A second read records it once.
    expect(await pull('contact-lead-1')).toMatchObject({ foreign: 0 });
    expect(await owner((tx) => ghlBridge(tx))).toMatchObject({ foreignReplies: 1 });
    expect(await system((tx) => chatHeld(tx, LEAD))).toBe(false);
    const chat = await owner((tx) => getChat(tx, LEAD));
    expect(chat.lines.some((l) => l.by === 'ghl' && l.body.includes('נציג יחזור'))).toBe(true);
    // Another person's suggestion is dropped by the office.
    fake.add('contact-third', '050-855-8003', {
      id: 'ghl-third-in',
      direction: 'inbound',
      body: 'היי',
      at: new Date(),
      userId: null,
    });
    expect(await pull('contact-third')).toMatchObject({ inbound: 1 });
    const [row] = await q(`select id from inbound_messages where external_id = 'ghl-third-in'`);
    expect((await system((tx) => runParentBot(tx, worker, model, row.id))).outcome).toBe(
      'answered',
    );
    const [m] = await q(`select id, status from messages where idempotency_key = $1`, [
      `bot:${row.id}`,
    ]);
    expect(m.status).toBe('suggested');
    await owner((tx) => dismissSuggestion(tx, m.id));
    expect((await q(`select status from messages where id = $1`, [m.id]))[0].status).toBe(
      'dismissed',
    );
    expect(
      (await owner((tx) => getChat(tx, '+972508558003'))).lines.some((l) => l.id === m.id),
    ).toBe(false);
  });

  it('makes what a bot wants to do from WhatsApp wait for the owner', async () => {
    const settings = await system((tx) => getAgentSettings(tx));
    const kind = (Object.keys(settings.effective) as (keyof typeof settings.effective)[]).find(
      (k) => k !== 'lesson_reminder' && settings.effective[k] === 'auto',
    ) as CopilotActionKind | undefined;
    expect(kind).toBeDefined();
    const out = await system((tx) =>
      takeAction(tx, worker, {
        source: 'parent_whatsapp',
        requestId: null,
        kind: kind as CopilotActionKind,
        params: {},
        summary: { code: 'test', params: {} },
        amountAgorot: null,
      }),
    );
    expect(out.status).toBe('waiting');
    const [a] = await q(`select result from copilot_actions where id = $1`, [out.id]);
    expect(a.result).toEqual({ waitReason: 'shadow' });
  });

  it('waits on an answer too fresh to judge', async () => {
    fake.add('contact-lead-1', '050-855-8001', {
      id: 'ghl-fresh',
      direction: 'outbound',
      body: 'עוד רגע',
      at: new Date(),
      userId: null,
    });
    expect(await pull('contact-lead-1', new Date())).toMatchObject({ deferred: 1, foreign: 0 });
  });

  it('skips a contact without a phone', async () => {
    expect(await pull('nobody')).toMatchObject({ skipped: 'no_phone' });
  });
});

describe('live mode', () => {
  it('lets the bot answer, and steps back when someone else answers in GHL', async () => {
    await owner((tx) => setGhlBridgeMode(tx, { mode: 'live' }));
    expect(await owner((tx) => ghlBridge(tx))).toMatchObject({ mode: 'live', foreignReplies: 0 });
    const now = Date.now();
    fake.add('contact-second', '050-855-8002', {
      id: 'ghl-second-in',
      direction: 'inbound',
      body: 'היי',
      at: new Date(now),
      userId: null,
    });
    expect(await pull('contact-second')).toMatchObject({ inbound: 1 });
    const [row] = await q(`select id from inbound_messages where external_id = 'ghl-second-in'`);
    expect((await system((tx) => runParentBot(tx, worker, model, row.id))).outcome).toBe(
      'answered',
    );
    const [m] = await q(`select status from messages where idempotency_key = $1`, [
      `bot:${row.id}`,
    ]);
    expect(m.status).toMatch(/^(queued|held)$/);

    fake.add('contact-second', '050-855-8002', {
      id: 'ghl-second-person',
      direction: 'outbound',
      body: 'היי, כאן רעות מהמשרד',
      at: new Date(now + 2000),
      userId: 'ghl-user-1',
    });
    expect(await pull('contact-second')).toMatchObject({ foreignReplies: 1 });
    expect(await system((tx) => chatHeld(tx, SECOND))).toBe(true);
  });
});

describe('stopping WhatsApp through GHL', () => {
  it('stops the hook and the bots’ mode but keeps the connection for contacts', async () => {
    const view = (await owner((tx) => ghlBridge(tx))) as NonNullable<
      Awaited<ReturnType<typeof ghlBridge>>
    >;
    const body = JSON.stringify({ contact_id: 'contact-lead-1' });
    await owner((tx) => setGhlWhatsApp(tx, { on: '0' }));
    expect(await owner((tx) => ghlBridge(tx))).toMatchObject({
      id: view.id,
      status: 'connected',
      whatsapp: false,
      mode: 'shadow',
    });
    expect(await owner((tx) => ghlBridgeMode(tx))).toBeNull();
    expect(await ingestGhlBridgeHook(t.db, view.id, view.hookToken, body)).toBe('not_connected');
    // Turning it on again starts in shadow mode with the same hook.
    await owner((tx) => setGhlWhatsApp(tx, { on: '1' }));
    expect(await owner((tx) => ghlBridge(tx))).toMatchObject({
      hookToken: view.hookToken,
      mode: 'shadow',
      whatsapp: true,
    });
  });
});
