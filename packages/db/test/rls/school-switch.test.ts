/**
 * One app for everyone (store launch, stage 3): a person in two schools lists both and picks one. The pick is
 * remembered on their sign-in row and the access-token hook honours it. Nobody can pick a school they don't belong to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;
let twoHats: string;

const { as } = sessions(() => t.pool);
const rsw = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === 'RSW01' ? err.message : err.code;
  }
};

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'switch-a');
  B = await createOrgFixture(t.pool, 'switch-b');
  // A's instructor is also a parent at B.
  twoHats = A.users.instructor;
  await t.pool.query(
    `insert into memberships (organization_id, user_id, role, guardian_id) values ($1, $2, 'parent', $3)`,
    [B.orgId, twoHats, B.guardians.other],
  );
});
afterAll(async () => {
  await t.drop();
});

const hook = async (userId: string) => {
  const { rows } = await t.pool.query<{ claims: { org_id: string | null; app_role: string } }>(
    `select public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) -> 'claims' claims`,
    [userId],
  );
  return rows[0]!.claims;
};

describe('my schools', () => {
  it('lists every school of a person with two roles, marking the one in the token', async () => {
    const rows = await as(twoHats, A.orgId, (run) =>
      run<{ organization_id: string; role: string; active: boolean }>(
        `select organization_id, role, active from public.my_schools() order by role`,
      ),
    );
    expect(rows).toEqual([
      { organization_id: A.orgId, role: 'instructor', active: true },
      { organization_id: B.orgId, role: 'parent', active: false },
    ]);
  });

  it('lists only their own schools', async () => {
    const rows = await as(A.users.owner, A.orgId, (run) =>
      run<{ organization_id: string }>(`select organization_id from public.my_schools()`),
    );
    expect(rows).toEqual([{ organization_id: A.orgId }]);
  });

  it('is closed to anonymous callers', async () => {
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      expect(await rsw(c.query(`select * from public.my_schools()`))).toBe('42501');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('switching school', () => {
  it('remembers the pick, and the next token carries that school and role', async () => {
    await as(twoHats, A.orgId, async (run, c) => {
      await run(`select public.switch_school($1)`, [B.orgId]);
      await c.query('commit');
    });
    expect(await hook(twoHats)).toMatchObject({ org_id: B.orgId, app_role: 'parent' });

    await as(twoHats, B.orgId, async (run, c) => {
      await run(`select public.switch_school($1)`, [A.orgId]);
      await c.query('commit');
    });
    expect(await hook(twoHats)).toMatchObject({ org_id: A.orgId, app_role: 'instructor' });
  });

  it("refuses a school the caller doesn't belong to", async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await rsw(run(`select public.switch_school($1)`, [B.orgId]))).toBe(
        'common.errors.forbidden',
      );
    });
    expect(await hook(A.users.owner)).toMatchObject({ org_id: A.orgId });
  });

  it('refuses a membership that is no longer active', async () => {
    await t.pool.query(
      `update memberships set status = 'suspended' where organization_id = $1 and user_id = $2`,
      [B.orgId, twoHats],
    );
    try {
      await as(twoHats, A.orgId, async (run) => {
        expect(await rsw(run(`select public.switch_school($1)`, [B.orgId]))).toBe(
          'common.errors.forbidden',
        );
      });
    } finally {
      await t.pool.query(
        `update memberships set status = 'active' where organization_id = $1 and user_id = $2`,
        [B.orgId, twoHats],
      );
    }
  });
});
