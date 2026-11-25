/**
 * SaaS stage 6: Claude's monthly allowance per school, on the fake demo tenant. AI work is recorded with what it cost,
 * the owner sees the month against the plan's cap, and once the cap is reached the copilot refuses and the parents'
 * bot hands families to the office without calling the model.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, sql, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { intakeInbound } from '@rswim/domain-comms';
import {
  aiLevel,
  askCopilot,
  FakeParentBotModel,
  runParentBot,
  setAiLevel,
} from '@rswim/domain-copilot';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import { aiAllowance, aiUsageByFeature, recordAiUsage } from '@rswim/domain-platform';
import { reportUsage, type CopilotModel } from '@rswim/integrations';
import { PLAN_CATALOG } from '../src/plans';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const owner: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const as = <T>(who: keyof typeof PERSONAS, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS[who].userId, org_id: DEMO_ORG.id }, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;

/** A model that "calls Claude" once (reports Opus usage) and answers. */
const paidModel: CopilotModel = {
  name: 'claude:test',
  async run() {
    reportUsage('claude-opus-5-5', {
      input_tokens: 10_000,
      output_tokens: 1_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    } as Parameters<typeof reportUsage>[1]);
    return { answer: 'שלום', trace: [], incomplete: false };
  },
};

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  // The demo school is on Pro; a cap of 10 actions keeps the test short.
  await q(`update plans set ai_monthly_actions = 10 where code = 'pro'`);
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('AI allowance', () => {
  it('every plan has a monthly AI allowance; the bot is on growth and pro', () => {
    expect(PLAN_CATALOG.map((p) => [p.code, p.aiActions])).toEqual([
      ['starter', 300],
      ['growth', 2000],
      ['pro', 3000],
    ]);
    expect(
      PLAN_CATALOG.filter((p) => (p.features as readonly string[]).includes('parent_bot')).map(
        (p) => p.code,
      ),
    ).toEqual(['growth', 'pro']);
  });

  it('records what the copilot cost and shows the month against the cap', async () => {
    expect(await as('owner', (tx) => aiAllowance(tx))).toMatchObject({
      state: 'ok',
      used: 0,
      cap: 10,
    });
    await as('owner', (tx) => askCopilot(tx, owner, paidModel, 'מה קורה היום?'));
    // Opus: 10,000 × $4 + 1,000 × $20 per million tokens = 60,000 millionths of a dollar.
    const [row] = await q(`select feature, model, input_tokens, cost_micros from ai_usage`);
    expect(row).toMatchObject({
      feature: 'copilot',
      model: 'claude-opus-5-5',
      input_tokens: 10000,
    });
    expect(Number(row.cost_micros)).toBe(60_000);
    expect(await as('owner', (tx) => aiAllowance(tx))).toMatchObject({
      state: 'ok',
      percent: 10,
      used: 1,
    });
    expect((await as('owner', (tx) => aiUsageByFeature(tx))).copilot).toEqual({
      actions: 1,
      micros: 60_000,
    });
  });

  it('only the owner and admins read it; an instructor cannot', async () => {
    expect((await as('instructor', (tx) => aiAllowance(tx))).used).toBe(0);
    expect((await as('admin', (tx) => aiAllowance(tx))).used).toBe(1);
  });

  it('the owner picks the level; cheaper levels take less of the allowance', async () => {
    expect(await as('owner', (tx) => aiLevel(tx))).toBe('balanced');
    await as('owner', (tx) => setAiLevel(tx, owner, 'frugal'));
    // The worker reads the owner's choice; the office cannot change it.
    expect(await withOrg(t.db, DEMO_ORG.id, (tx) => aiLevel(tx))).toBe('frugal');
    await expect(
      as('admin', (tx) => setAiLevel(tx, { ...owner, userId: PERSONAS.admin.userId }, 'smart')),
    ).rejects.toThrow();
    expect(await as('owner', (tx) => aiLevel(tx))).toBe('frugal');

    const use = (model: string) => ({
      model,
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // Three balanced answers are one and a half actions; a frugal one adds a tenth. With the copilot's one: 3.
    for (let i = 0; i < 3; i++)
      await withOrg(t.db, DEMO_ORG.id, (tx) =>
        recordAiUsage(tx, DEMO_ORG.id, 'parent_bot', [use('claude-sonnet-5-5')]),
      );
    await withOrg(t.db, DEMO_ORG.id, (tx) =>
      recordAiUsage(tx, DEMO_ORG.id, 'parent_bot', [use('claude-haiku-5-5')]),
    );
    expect((await as('owner', (tx) => aiAllowance(tx))).used).toBe(3);
    expect((await as('owner', (tx) => aiUsageByFeature(tx))).parent_bot.actions).toBe(2);
    await q(`delete from ai_usage where feature = 'parent_bot'`);
    expect((await as('owner', (tx) => aiAllowance(tx))).used).toBe(1);
  });

  it('warns near the cap, and past it the copilot refuses and the bot hands off', async () => {
    const once = {
      model: 'claude-haiku-5-5',
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    for (let i = 0; i < 7; i++)
      await withOrg(t.db, DEMO_ORG.id, (tx) => recordAiUsage(tx, DEMO_ORG.id, 'triage', [once]));
    expect(await as('owner', (tx) => aiAllowance(tx))).toMatchObject({ state: 'warn', used: 8 });
    // Nothing is recorded for work that did not call Claude.
    expect(
      await withOrg(t.db, DEMO_ORG.id, (tx) => recordAiUsage(tx, DEMO_ORG.id, 'triage', [])),
    ).toBe(0);
    for (let i = 0; i < 2; i++)
      await withOrg(t.db, DEMO_ORG.id, (tx) => recordAiUsage(tx, DEMO_ORG.id, 'insights', [once]));
    expect(await as('owner', (tx) => aiAllowance(tx))).toMatchObject({
      state: 'over',
      percent: 100,
    });

    const refused = await as('owner', (tx) => askCopilot(tx, owner, paidModel, 'עוד שאלה')).then(
      () => null,
      (e: unknown) => toDomainError(e)?.code,
    );
    expect(refused).toBe('platform.errors.aiCap');

    const [fam] = await q(
      `select g.phone_e164 phone from guardians g
       where g.phone_e164 is not null
         and (select count(*) from guardians x where x.phone_e164 = g.phone_e164) = 1
       limit 1`,
    );
    const intake = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      intakeInbound(tx, worker, {
        provider: 'ghl',
        externalId: randomUUID(),
        phoneE164: fam.phone,
        ghlContactId: null,
        body: 'מתי השיעור הבא?',
        receivedAt: new Date(),
      }),
    );
    if (intake.outcome !== 'stored') throw new Error('not stored');
    const run = await withOrg(t.db, DEMO_ORG.id, (tx) =>
      runParentBot(tx, worker, new FakeParentBotModel(), intake.inboundMessageId),
    );
    expect(run.outcome).toBe('handed_off');
    const [reply] = await q(
      `select handoff_reason from bot_replies where inbound_message_id = $1`,
      [intake.inboundMessageId],
    );
    expect(reply.handoff_reason).toBe('ai_cap');
  });

  it('a plan without a cap is unlimited', async () => {
    await q(`update plans set ai_monthly_actions = null where code = 'pro'`);
    expect((await as('owner', (tx) => aiAllowance(tx))).state).toBe('unlimited');
  });

  it('the usage log is append-only', async () => {
    await expect(
      withOrg(t.db, DEMO_ORG.id, (tx) => tx.execute(sql`update ai_usage set cost_micros = 0`)),
    ).rejects.toThrow();
  });
});
