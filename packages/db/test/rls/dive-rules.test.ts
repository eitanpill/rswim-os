/**
 * Editing the club's rules: only settings.write (the owner, the manager) writes a version, only from today on, and a
 * version that already took effect is history (never changed or removed). The front desk keeps reading them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let past: string;

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'rules-a');
  await t.pool.query(`update organizations set vertical = 'freediving' where id = $1`, [A.orgId]);
  past = (
    await t.pool.query(
      `insert into dive_rule_sets (organization_id, effective_from, rules)
       values ($1, '2020-01-01', '{"ratio": {"course": 4}}') returning id`,
      [A.orgId],
    )
  ).rows[0].id as string;
});
afterAll(async () => {
  await t.drop();
});

const { as } = sessions(() => t.pool);
const future = `insert into dive_rule_sets (organization_id, effective_from, rules)
                values ($1, app.today() + 7, '{"ratio": {"course": 5}}') returning id`;

describe('club rules versions', () => {
  it('the owner adds a version from a future date, but cannot rewrite or remove one in effect', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await run(future, [A.orgId])).toHaveLength(1);
      expect(
        await run(`update dive_rule_sets set rules = '{}' where id = $1 returning id`, [past]),
      ).toHaveLength(0);
      expect(
        await run(`delete from dive_rule_sets where id = $1 returning id`, [past]),
      ).toHaveLength(0);
      await expect(
        run(
          `insert into dive_rule_sets (organization_id, effective_from, rules) values ($1, '2021-01-01', '{}')`,
          [A.orgId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('the front desk (an admin without settings.write) reads the rules but cannot write a version', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      expect(await run(`select id from dive_rule_sets`)).toHaveLength(1);
      await expect(run(future, [A.orgId])).rejects.toThrow(/row-level security/);
    });
  });
});
