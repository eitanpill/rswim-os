/**
 * Deleting your own account (store launch, stage 8): the sign-in and every membership go, the school's records of the
 * family stay, and a school is never left without an owner. Every name is invented.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;

const { as } = sessions(() => t.pool);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === 'RSW01' ? err.message : err.code;
  }
};
const exists = async (userId: string) =>
  (await t.pool.query(`select 1 from auth.users where id = $1`, [userId])).rowCount === 1;

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'delete-a');
  B = await createOrgFixture(t.pool, 'delete-b');
});
afterAll(async () => {
  await t.drop();
});

describe('deleting my account', () => {
  it("removes a parent's sign-in and memberships, and keeps the school's family file", async () => {
    // A's parent also has an open join request at B.
    await as(A.users.parent, A.orgId, async (run, c) => {
      await run(
        `select public.request_to_join('delete-b', 'trial', 'מיכל', 'בדיקה', '+972541230000', null, '[]'::jsonb, null)`,
      );
      await c.query('commit');
    });
    await as(A.users.parent, A.orgId, async (run, c) => {
      expect(await run(`select * from public.my_sole_owned_schools()`)).toEqual([]);
      await run(`select public.delete_my_account()`);
      await c.query('commit');
    });
    expect(await exists(A.users.parent)).toBe(false);
    const left = await t.pool.query(
      `select (select count(*)::int from memberships where user_id = $1) m,
              (select count(*)::int from join_requests where user_id = $1) r,
              (select count(*)::int from guardians where id = $2) g`,
      [A.users.parent, A.guardians.mine],
    );
    expect(left.rows[0]).toEqual({ m: 0, r: 0, g: 1 });
  });

  it('refuses the only owner of a school, until another owner exists', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await run(`select organization_id from public.my_sole_owned_schools()`)).toEqual([
        { organization_id: A.orgId },
      ]);
      expect(await code(run(`select public.delete_my_account()`))).toBe('account.errors.soleOwner');
    });
    expect(await exists(A.users.owner)).toBe(true);

    const second = randomUUID();
    await t.pool.query(`insert into auth.users (id, email) values ($1, $2)`, [
      second,
      `${second}@x.test`,
    ]);
    await t.pool.query(
      `insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`,
      [A.orgId, second],
    );
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await run(`select * from public.my_sole_owned_schools()`)).toEqual([]);
      await run(`select public.delete_my_account()`);
    });
  });

  it('touches nobody else, and is closed to anonymous callers', async () => {
    await as(B.users.instructor, B.orgId, async (run, c) => {
      await run(`select public.delete_my_account()`);
      await c.query('commit');
    });
    expect(await exists(B.users.instructor)).toBe(false);
    expect(await exists(B.users.owner)).toBe(true);
    expect(await exists(A.users.instructor)).toBe(true);

    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      expect(await code(c.query(`select public.delete_my_account()`))).toBe('42501');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
