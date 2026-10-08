/**
 * The owner's insights feed on the fake demo tenant: the daily check finds what the seed planted (families leaving,
 * children missing lessons), keeps dismissals, and stays the office's (RLS).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  dismissInsight,
  homeSummary,
  insightsWithoutNotes,
  listInsights,
  refreshInsights,
  saveInsightNote,
  todayIL,
} from '@rswim/domain-reports';
import type { ServiceContext } from '@rswim/domain-core';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
let today: string;
const ctx: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const instructor = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.instructor.userId, org_id: ctx.orgId }, fn);
const worker = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  today = await worker((tx) => todayIL(tx));
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('owner insights on the demo tenant', () => {
  it('finds the families the seed planted as leaving and the child who keeps missing lessons', async () => {
    // The seed's leaving families end their places on 1.11.2026; run as of 8.10.2026 so they are in the coming month.
    const out = await worker((tx) =>
      refreshInsights(tx, { orgId: ctx.orgId, userId: null }, '2026-10-08'),
    );
    expect(out).toMatchObject({ aiNotes: true });
    const feed = await owner((tx) => listInsights(tx));
    expect(feed.length).toBe(out?.open);
    const leaving = feed.find((i) => i.kind === 'leaving');
    expect(leaving?.params.count).toBe(3);
    expect(leaving?.detail.map((d) => d.reason).sort()).toEqual(['cold_water', 'cost', 'schedule']);
    // Severity order: every high before any medium before any low.
    const rank = { high: 0, medium: 1, low: 2 };
    expect(feed.map((i) => rank[i.severity])).toEqual(
      [...feed.map((i) => rank[i.severity])].sort((a, b) => a - b),
    );
    expect(
      feed.every((i) => i.status === 'open' && i.note === null && i.href.startsWith('/admin')),
    ).toBe(true);
  });

  it('keeps a note until the facts change, and hides a dismissed insight on the next check', async () => {
    const [first] = await owner((tx) => insightsWithoutNotes(tx));
    expect(first).toBeDefined();
    const note = { explanation: 'הסבר', recommendation: 'המלצה', model: 'test' };
    expect(
      await worker((tx) => saveInsightNote(tx, { id: first!.id, params: { stale: true }, note })),
    ).toBe(false);
    expect(
      await worker((tx) => saveInsightNote(tx, { id: first!.id, params: first!.params, note })),
    ).toBe(true);
    await worker((tx) => refreshInsights(tx, { orgId: ctx.orgId, userId: null }, '2026-10-08'));
    expect((await owner((tx) => listInsights(tx))).find((i) => i.id === first!.id)?.note).toEqual(
      note,
    );

    await owner((tx) => dismissInsight(tx, ctx, { id: first!.id }));
    await worker((tx) => refreshInsights(tx, { orgId: ctx.orgId, userId: null }, '2026-10-08'));
    expect((await owner((tx) => listInsights(tx))).some((i) => i.id === first!.id)).toBe(false);
  });

  it('resolves insights that no longer hold', async () => {
    // Long after the leaving families are gone, their insight is no longer true.
    await worker((tx) => refreshInsights(tx, { orgId: ctx.orgId, userId: null }, '2027-03-01'));
    expect((await owner((tx) => listInsights(tx))).some((i) => i.kind === 'leaving')).toBe(false);
  });

  it('shows the home numbers', async () => {
    const home = await owner((tx) => homeSummary(tx, today));
    expect(home.period).toBe(today.slice(0, 7));
    expect(home.seats).toBeGreaterThan(0);
    expect(home.expectedAgorot).toBeGreaterThanOrEqual(home.money.chargedAgorot);
  });

  it('shows an instructor no insights (RLS)', async () => {
    expect(await instructor((tx) => listInsights(tx))).toEqual([]);
  });
});
