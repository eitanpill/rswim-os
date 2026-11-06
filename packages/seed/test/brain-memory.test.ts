/**
 * The business brain, stage 5 (docs/AI-BRAIN.md), on the fake demo tenant: it keeps the facts of every month, records
 * what happened once, keeps what the owner asks it to remember (chat, WhatsApp, the screen), answers about the past
 * from all of it, and shows none of it to anyone but the owner.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, sql, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound } from '@rswim/domain-comms';
import {
  archiveMemory,
  askCopilot,
  confirmCopilotAction,
  FakeCopilotModel,
  FakeParentBotModel,
  listCopilot,
  listMemories,
  monthReport,
  refreshMemory,
  remember,
  runBrainInbound,
  runParentBot,
  setApprovalPhone,
} from '@rswim/domain-copilot';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const owner: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.admin.userId, org_id: DEMO_ORG.id }, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const refresh = () => withOrg(t.db, DEMO_ORG.id, (tx) => refreshMemory(tx, worker));
const OWNER_PHONE = '+972509990003';
let today = '';
let model: FakeCopilotModel;

const chat = (prompt: string) =>
  as(async (tx) => {
    const id = await askCopilot(tx, owner, model, prompt);
    return (await listCopilot(tx)).find((x) => x.id === id)!;
  });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return toDomainError(e)?.code ?? String(e);
  }
  return null;
};

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  today = await as((tx) => todayIL(tx));
  model = new FakeCopilotModel(today);
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe("the brain's memory", () => {
  it('keeps every month once and the running month every day', async () => {
    const first = await refresh();
    expect(first.months).toBeGreaterThan(1);
    const months = await q(`select period, final, facts from business_snapshots order by period`);
    expect(months).toHaveLength(first.months);
    const now = months.at(-1)!;
    expect(now.period).toBe(today.slice(0, 7));
    expect(now.final).toBe(false);
    expect(months.slice(0, -1).every((m) => m.final)).toBe(true);
    expect(now.facts.placesAtEnd).toBeGreaterThan(0);
    expect(now.facts.venues.length).toBeGreaterThan(0);
    // The next day only the running month is computed again, and nothing is recorded twice.
    const again = await refresh();
    expect(again).toEqual({ months: 1, events: 0 });
  });

  it('records a closure once, as an event of that day', async () => {
    const [{ d }] = await q(
      `select min(date)::text d from sessions where date > $1::date and status = 'scheduled'`,
      [today],
    );
    const r = await chat(`תבטל את השיעורים ב-${d} בגלל תקלה בחימום`);
    await as((tx) => confirmCopilotAction(tx, owner, r.actions[0]!.id));
    const swept = await refresh();
    expect(swept.events).toBe(1);
    const [e] = await as((tx) => listMemories(tx, { kind: 'event', query: 'תקלה בחימום' }));
    expect(e).toMatchObject({
      kind: 'event',
      source: 'system',
      happenedOn: d,
      summary: { code: 'agent.memory.events.closure' },
    });
    expect(Number(e!.summary!.params.sessions)).toBeGreaterThan(0);
    expect((await refresh()).events).toBe(0);
  });

  it('keeps a note about a family and finds it by the family', async () => {
    const [h] = await q(
      `select id, display_name from households where organization_id = $1 order by display_name limit 1`,
      [DEMO_ORG.id],
    );
    const saved = await as((tx) =>
      remember(
        tx,
        owner,
        {
          body: 'משלמים תמיד באיחור של שבוע, אבל משלמים',
          subjectType: 'household',
          subjectId: h.id,
        },
        'owner_screen',
      ),
    );
    expect(saved.subjectLabel).toBe(h.display_name);
    const found = await as((tx) => listMemories(tx, { subjectId: h.id }));
    expect(found.map((m) => m.id)).toContain(saved.id);
    // Asked from the chat by the family's name.
    const r = await chat(`מה אתה זוכר על ${h.display_name}?`);
    expect(r.answer).toContain('באיחור של שבוע');
    // A subject that does not exist, or a note with no words, is refused.
    expect(
      await code(
        as((tx) =>
          remember(
            tx,
            owner,
            { body: 'x y', subjectType: 'staff', subjectId: randomUUID() },
            'owner_screen',
          ),
        ),
      ),
    ).toBe('agent.memory.errors.subject');
    expect(await code(as((tx) => remember(tx, owner, { body: ' ' }, 'owner_screen')))).toBe(
      'agent.memory.errors.note',
    );
  });

  it('remembers from the chat and answers about the month', async () => {
    const r = await chat('תזכור שהבריכה בעמק סגורה בכל חנוכה');
    expect(r.answer).toContain('שמרתי');
    const [note] = await q(
      `select source, created_by, body from business_memories where body like '%בעמק סגורה%'`,
    );
    expect(note).toMatchObject({ source: 'owner_chat', created_by: PERSONAS.owner.userId });
    const month = await chat('איך היה החודש?');
    expect(month.answer).toContain('מקומות בסוף החודש');
    expect(month.answer).toContain('מול החודש הקודם');
    const report = await as((tx) => monthReport(tx, today.slice(0, 7)));
    expect(report.previous).not.toBeNull();
    expect(report.memories.some((m) => m.body?.includes('בעמק סגורה'))).toBe(true);
    expect(await code(as((tx) => monthReport(tx, '2026-13')))).toBe('agent.memory.errors.period');
  });

  it("remembers what the owner writes on WhatsApp, and the parents' bot stays out", async () => {
    await as((tx) => setApprovalPhone(tx, owner, OWNER_PHONE));
    const intake = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      intakeInbound(tx, worker, {
        provider: 'ghl',
        externalId: randomUUID(),
        phoneE164: OWNER_PHONE,
        ghlContactId: null,
        body: 'תזכור שהמדריכה החדשה מעדיפה ימי שני',
        receivedAt: new Date(),
      }),
    );
    if (intake.outcome !== 'stored') throw new Error('not stored');
    const run = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      runBrainInbound(tx, worker, intake.inboundMessageId),
    );
    expect(run.outcome).toBe('remembered');
    const [note] = await q(
      `select source, created_by, body from business_memories where body like '%ימי שני%'`,
    );
    expect(note).toMatchObject({
      source: 'owner_whatsapp',
      created_by: PERSONAS.owner.userId,
      body: 'המדריכה החדשה מעדיפה ימי שני',
    });
    const [reply] = await q(`select body from messages where inbound_message_id = $1`, [
      intake.inboundMessageId,
    ]);
    expect(reply.body).toContain('שמרתי');
    const bot = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      runParentBot(tx, worker, new FakeParentBotModel(), intake.inboundMessageId),
    );
    expect(bot).toEqual({ outcome: 'skipped', reason: 'owner_reply' });
  });

  it('forgets what the owner archives, and shows nothing to the office', async () => {
    const [n] = await as((tx) => listMemories(tx, { query: 'בעמק סגורה' }));
    await as((tx) => archiveMemory(tx, owner, n!.id));
    expect(await as((tx) => listMemories(tx, { query: 'בעמק סגורה' }))).toHaveLength(0);
    expect(await code(as((tx) => archiveMemory(tx, owner, n!.id)))).toBe(
      'agent.memory.errors.notFound',
    );
    expect(await asAdmin((tx) => listMemories(tx))).toHaveLength(0);
    const [snapshots] = await asAdmin((tx) =>
      tx
        .execute(sql`select count(*)::int n from business_snapshots`)
        .then((r) => r.rows as { n: number }[]),
    );
    expect(snapshots!.n).toBe(0);
  });
});
