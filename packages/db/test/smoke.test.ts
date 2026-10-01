import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

it('applies migrations', async () => {
  const r = await t.pool.query(
    `select count(*)::int as n from pg_tables where schemaname = 'public'`,
  );
  expect(r.rows[0].n).toBeGreaterThanOrEqual(15);
});
