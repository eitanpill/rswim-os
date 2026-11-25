/**
 * The store app's push tokens (store stage 6): a person registers their phone in their school, sees only their own,
 * a phone moves to whoever signed in on it last, the worker reads them all, and deleting the account takes them.
 * Every name and token is invented.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;

const { as, asSystem } = sessions(() => t.pool);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === 'RSW01' ? err.message : err.code;
  }
};
const TOKEN = 'fake-push-token-family-phone-0001';

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'push-a');
  B = await createOrgFixture(t.pool, 'push-b');
});
afterAll(async () => {
  await t.drop();
});

describe('push devices', () => {
  it('registers my phone in my school and shows me only mine', async () => {
    await as(A.users.parent, A.orgId, async (run, c) => {
      await run(`select public.register_push_device('android', $1)`, [TOKEN]);
      await run(`select public.register_push_device('android', $1)`, [TOKEN]);
      expect(await run(`select platform, token from push_devices`)).toEqual([
        { platform: 'android', token: TOKEN },
      ]);
      await c.query('commit');
    });
    await as(A.users.instructor, A.orgId, async (run) => {
      expect(await run(`select token from push_devices`)).toEqual([]);
    });
  });

  it('moves a phone to whoever signed in on it last', async () => {
    await as(A.users.owner, A.orgId, async (run, c) => {
      await run(`select public.register_push_device('android', $1)`, [TOKEN]);
      await c.query('commit');
    });
    const r = await t.pool.query(`select user_id from push_devices where token = $1`, [TOKEN]);
    expect(r.rows).toEqual([{ user_id: A.users.owner }]);
  });

  it("refuses a school I don't belong to, a strange platform and a short token", async () => {
    await as(A.users.parent, B.orgId, async (run) => {
      expect(await code(run(`select public.register_push_device('ios', $1)`, [TOKEN]))).toBe(
        'common.errors.forbidden',
      );
    });
    await as(A.users.parent, A.orgId, async (run) => {
      expect(await code(run(`select public.register_push_device('web', $1)`, [TOKEN]))).toBe(
        'common.errors.invalid',
      );
      expect(await code(run(`select public.register_push_device('ios', 'short')`))).toBe(
        'common.errors.invalid',
      );
    });
  });

  it("gives the school's worker every phone in the school and none of another school's", async () => {
    await as(B.users.parent, B.orgId, async (run, c) => {
      await run(`select public.register_push_device('ios', 'fake-push-token-other-school-0002')`);
      await c.query('commit');
    });
    await asSystem(A.orgId, async (run) => {
      expect(await run(`select token from push_devices`)).toEqual([{ token: TOKEN }]);
    });
  });

  it("takes the person's phones when they delete their account", async () => {
    await as(B.users.parent, B.orgId, async (run, c) => {
      await run(`select public.delete_my_account()`);
      await c.query('commit');
    });
    const r = await t.pool.query(
      `select count(*)::int n from push_devices where organization_id = $1`,
      [B.orgId],
    );
    expect(r.rows[0]).toEqual({ n: 0 });
  });
});
