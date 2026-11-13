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

it('deleting a term clears only sessions.term_id, never the organization', async () => {
  const r = await t.pool.query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'sessions_term_fk'`,
  );
  expect(r.rows[0]?.def).toMatch(/ON DELETE SET NULL \(term_id\)/);
});
