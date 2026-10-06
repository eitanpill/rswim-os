/**
 * Phase 9 reports on the fake demo tenant: each report runs as the owner, under RLS, and the numbers add up.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  buildWeeklyDigest,
  chargedByVenueProgram,
  churn,
  funnelReport,
  instructorKpis,
  listDigests,
  moneyByMonth,
  occupancy,
  sundayOf,
  venueProfitability,
} from '@rswim/domain-reports';
import type { ServiceContext } from '@rswim/domain-core';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const ctx: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
// The demo money is September and October 2026 (fixed dates in the seed).
const range = { from: '2026-08', to: '2026-11' };
const instructor = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.instructor.userId, org_id: ctx.orgId }, fn);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('reports on the demo tenant', () => {
  it('charged and collected per month add up to the lines per venue and program', async () => {
    const [months, lines] = await owner(
      async (tx) =>
        [await moneyByMonth(tx, range), await chargedByVenueProgram(tx, range)] as const,
    );
    expect(months.map((m) => m.period)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    const sept = months[1]!;
    expect(sept.chargedAgorot).toBe(
      lines.filter((l) => l.period === '2026-09').reduce((n, l) => n + l.amountAgorot, 0),
    );
    expect(sept.collectedAgorot).toBeGreaterThan(0);
    expect(sept.collectedAgorot).toBeLessThan(sept.chargedAgorot);
    expect(sept.institutionInvoicedAgorot).toBeGreaterThan(0);
    expect(new Set(lines.map((l) => l.venue))).toContain('בריכת הדמו - גוש עציון');
  });

  it('shows the closing Gush Etzion pool losing money on its rent, and Jerusalem earning', async () => {
    const venues = await owner((tx) => venueProfitability(tx, range));
    const gush = venues.find((v) => v.venue.includes('גוש') && v.period === '2026-09')!;
    expect(gush).toMatchObject({ rent: 450_000, rentUnknown: false });
    expect(gush.staffCost).toBeGreaterThan(0);
    expect(gush.margin).toBe(
      gush.familyRevenue + gush.institutionRevenue - 450_000 - gush.staffCost,
    );
    expect(gush.margin).toBeLessThan(0);
    const jlm = venues.find((v) => v.venue.includes('ירושלים') && v.period === '2026-09')!;
    expect(jlm.margin).toBeGreaterThan(0);
    expect(jlm.institutionRevenue).toBeGreaterThan(0);
    expect(jlm.utilizationPct).toBeGreaterThan(0);
  });

  it('fills a heatmap from the groups running on a date', async () => {
    const out = await owner((tx) => occupancy(tx, '2026-10-06'));
    expect(out.venues).toHaveLength(2);
    expect(out.cells.reduce((n, c) => n + c.groups, 0)).toBe(out.groups.length);
    expect(out.cells.reduce((n, c) => n + c.held, 0)).toBe(
      out.groups.reduce((n, g) => n + g.held, 0),
    );
  });

  it('counts the children leaving after October by their reason', async () => {
    const out = await owner((tx) => churn(tx, range));
    expect(out.totals).toMatchObject({
      total: 3,
      byReason: { cold_water: 1, schedule: 1, cost: 1 },
    });
    expect(out.rows.find((r) => r.period === '2026-10')?.total).toBe(3);
    expect(out.places.every((p) => p.endedOn === '2026-10-31' && p.venue.includes('ירושלים'))).toBe(
      true,
    );
  });

  it('follows families from joining to a place', async () => {
    const out = await owner((tx) => funnelReport(tx, { from: '2026-01', to: '2027-12' }));
    expect(out.bySource.total.families).toBeGreaterThan(20);
    expect(out.bySource.total.enrolled).toBeLessThanOrEqual(out.bySource.total.families);
    expect(out.byBranch.rows.reduce((n, r) => n + r.families, 0)).toBe(out.bySource.total.families);
  });

  it("lists every active instructor's lessons", async () => {
    const out = await owner((tx) => instructorKpis(tx, range));
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.some((k) => k.taught > 0)).toBe(true);
  });

  it('builds and stores the Sunday digest once per week', async () => {
    const weekOf = sundayOf('2026-10-06');
    expect(weekOf).toBe('2026-10-04');
    const first = await withOrg(t.db, ctx.orgId, (tx) => buildWeeklyDigest(tx, ctx, weekOf));
    const items = first?.items ?? [];
    expect(items.slice(0, 3).map((i) => i.section)).toEqual(['happened', 'happened', 'happened']);
    expect(items.find((i) => i.code.endsWith('venueLoss'))?.params).toMatchObject({
      venue: 'בריכת הדמו - גוש עציון',
      period: '2026-09',
    });
    await withOrg(t.db, ctx.orgId, (tx) => buildWeeklyDigest(tx, ctx, weekOf));
    const stored = await owner((tx) => listDigests(tx));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.items).toEqual(items);
  });

  it('shows an instructor no money and no digest (RLS)', async () => {
    const months = await instructor((tx) => moneyByMonth(tx, range));
    expect(months.every((m) => m.chargedAgorot === 0 && m.collectedAgorot === 0)).toBe(true);
    expect(await instructor((tx) => listDigests(tx))).toEqual([]);
  });
});
