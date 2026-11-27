/**
 * The business brain, stage 7 (docs/AI-BRAIN.md): looking ahead on the fake demo tenant. The forecast reads the
 * remembered months, counts places already asked to end, follows the policy, reaches the owner's assistant and the
 * weekly coach, and shows nothing to anyone but the owner.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, schema, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  askCopilot,
  businessForecast,
  coachFacts,
  FakeCopilotModel,
  forecastInput,
  forecastRules,
  holidaysWithin,
  listCopilot,
  refreshMemory,
  shiftPeriod,
} from '@rswim/domain-copilot';
import type { ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const owner: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
let today = '';

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  today = await as((tx) => todayIL(tx));
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('looking ahead', () => {
  it('works out the last months itself before the first memory refresh', async () => {
    const input = await as(async (tx) => forecastInput(tx, today, await forecastRules(tx, today)));
    expect(input.history.length).toBeGreaterThan(0);
    expect(input.history.every((m) => m.period < today.slice(0, 7))).toBe(true);
    expect(input.placesNow).toBeGreaterThan(0);
  });

  it('forecasts the coming months from the remembered ones, as ranges', async () => {
    await withOrg(t.db, DEMO_ORG.id, (tx) => refreshMemory(tx, worker));
    const f = (await as((tx) => businessForecast(tx, today)))!;
    expect(f.months.map((m) => m.period)).toEqual(
      [1, 2, 3].map((n) => shiftPeriod(today.slice(0, 7), n)),
    );
    for (const m of f.months) {
      expect(m.basis).not.toBe('none');
      expect(m.places.low).toBeLessThanOrEqual(m.places.mid);
      expect(m.places.mid).toBeLessThanOrEqual(m.places.high);
      expect(m.endedPlaces.low).toBeGreaterThanOrEqual(m.knownEnding);
    }
    expect(f.recentPeriods.length).toBeGreaterThan(0);
    expect(f.placesNow).toBeGreaterThan(0);
  });

  it('counts a place asked to end as leaving in its month', async () => {
    const next = shiftPeriod(today.slice(0, 7), 1);
    const [e] = await q(
      `select id from enrollments where organization_id = $1 and status = 'active' and ends_on is null
         and starts_on <= $2::date limit 1`,
      [DEMO_ORG.id, today],
    );
    const before = (await as((tx) => businessForecast(tx, today)))!.months[0]!.knownEnding;
    await q(
      `update enrollments set status = 'cancel_requested', ends_on = $2::date where id = $1`,
      [e.id, `${shiftPeriod(next, 1)}-01`],
    );
    const after = (await as((tx) => businessForecast(tx, today)))!.months[0]!;
    expect(after.knownEnding).toBe(before + 1);
    expect(after.endedPlaces.low).toBeGreaterThanOrEqual(before + 1);
  });

  it('takes holidays from the Hebrew calendar, the first day of each', () => {
    const h = holidaysWithin('2026-09-01', 60);
    expect(h.map((x) => x.date)).toContain('2026-09-12'); // ראש השנה
    expect(h.map((x) => x.date)).not.toContain('2026-09-13');
    expect(h[0]!.name.he.length).toBeGreaterThan(0);
  });

  it("answers the owner's assistant from the forecast", async () => {
    const model = new FakeCopilotModel(today);
    const reply = await as(async (tx) => {
      const id = await askCopilot(tx, owner, model, 'מה צפוי?');
      return (await listCopilot(tx)).find((x) => x.id === id)!;
    });
    expect(JSON.stringify(reply)).toMatch(/צפויים \d+(–\d+)? מקומות/);
  });

  it('is the owner’s alone: the office sees no remembered months to forecast from', async () => {
    const n = await asUser(
      t.db,
      { sub: PERSONAS.admin.userId, org_id: DEMO_ORG.id },
      async (tx) => (await tx.select().from(schema.businessSnapshots)).length,
    );
    expect(n).toBe(0);
  });

  it('follows the policy: off means no forecast, in the coach too', async () => {
    expect((await as((tx) => coachFacts(tx, today))).forecast).not.toBeNull();
    // A new version of the school's rules from today, with the forecast off.
    await q(
      `insert into policy_sets (organization_id, scope_type, effective_from, rules)
       select organization_id, 'org', $2::date, jsonb_set(rules, '{forecast}', '{"enabled": false}')
       from policy_sets where organization_id = $1 and scope_type = 'org'
       order by effective_from desc limit 1`,
      [DEMO_ORG.id, today],
    );
    expect(await as((tx) => businessForecast(tx, today))).toBeNull();
    expect((await as((tx) => coachFacts(tx, today))).forecast).toBeNull();
  });
});
