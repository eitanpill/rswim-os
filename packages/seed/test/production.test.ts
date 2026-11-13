/** The production seed: plans and the starter regulations only, nothing fake, and safe to run on every deploy. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { PLAN_CATALOG } from '../src/plans';
import { seedProduction } from '../src/production';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

it('writes the approved plans and one regulations template, and nothing else', async () => {
  expect(await seedProduction(t.pool)).toEqual({ plans: 3, templatesAdded: 1 });
  const plans = await t.pool.query<{
    code: string;
    price_agorot: number;
    max_students: number | null;
  }>('select code, price_agorot, max_students from plans order by sort_order');
  expect(plans.rows).toEqual(
    PLAN_CATALOG.map((p) => ({ code: p.code, price_agorot: p.price, max_students: p.students })),
  );
  expect(plans.rows.map((p) => p.price_agorot)).toEqual([19900, 39900, 74900]);
  const counts = await t.pool.query<{ orgs: number; users: number; templates: number }>(
    `select (select count(*)::int from organizations) as orgs, (select count(*)::int from auth.users) as users,
            (select count(*)::int from templates) as templates`,
  );
  expect(counts.rows[0]).toEqual({ orgs: 0, users: 0, templates: 1 });
});

it('runs again without duplicating anything', async () => {
  expect(await seedProduction(t.pool)).toEqual({ plans: 3, templatesAdded: 0 });
  const r = await t.pool.query<{ n: number }>('select count(*)::int as n from templates');
  expect(r.rows[0]?.n).toBe(1);
});
