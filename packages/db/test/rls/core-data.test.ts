/**
 * Phase 1: who may read and write the core data tables, the "history is immutable" triggers on policies and
 * prices, and staff invite acceptance. Tenant isolation for these tables is in isolation.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;
const { as } = sessions(() => t.pool);

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'core-a');
  B = await createOrgFixture(t.pool, 'core-b');
});
afterAll(async () => {
  await t.drop();
});

type Role = keyof OrgFixture['users'];
const ROLES: Role[] = [
  'owner',
  'admin',
  'adminSensitive',
  'instructor',
  'escort',
  'accountant',
  'parent',
];

/** Rows of `table` visible to each role, as a map role → count. */
async function visibility(table: string): Promise<Record<Role, number>> {
  const out = {} as Record<Role, number>;
  for (const role of ROLES) {
    await as(A.users[role], A.orgId, async (run) => {
      out[role] = (await run(`select 1 from ${table}`)).length;
    });
  }
  return out;
}

const everyStaff = {
  owner: 1,
  admin: 1,
  adminSensitive: 1,
  instructor: 1,
  escort: 1,
  accountant: 1,
  parent: 0,
};
const ownerAdminAccountant = {
  owner: 1,
  admin: 1,
  adminSensitive: 1,
  instructor: 0,
  escort: 0,
  accountant: 1,
  parent: 0,
};

describe('read access by role', () => {
  it.each([
    'venues',
    'pools',
    'lanes',
    'venue_operating_windows',
    'operating_window_lanes',
    'venue_closures',
    'programs',
    'levels',
  ])('%s: every staff member reads, parents do not', async (table) => {
    expect(await visibility(table)).toEqual(everyStaff);
  });

  it.each(['venue_contracts', 'policy_sets', 'price_lists', 'price_items'])(
    '%s: owner, admins and the accountant read',
    async (table) => {
      expect(await visibility(table)).toEqual(ownerAdminAccountant);
    },
  );

  it('certifications and availability: owner/admin see all, staff see their own', async () => {
    const own = {
      owner: 1,
      admin: 1,
      adminSensitive: 1,
      instructor: 1,
      escort: 0,
      accountant: 0,
      parent: 0,
    };
    expect(await visibility('certifications')).toEqual(own);
    expect(await visibility('availability_rules')).toEqual(own);
    expect(await visibility('availability_exceptions')).toEqual(own);
  });

  it('pay rules: payroll.read or the accountant, plus the instructor for their own rate', async () => {
    expect(await visibility('pay_rules')).toEqual({
      owner: 1,
      admin: 0,
      adminSensitive: 0,
      instructor: 1,
      escort: 0,
      accountant: 1,
      parent: 0,
    });
  });

  it('staff invites: owner only, and never the token hash', async () => {
    expect(await visibility('staff_invites')).toEqual({
      owner: 1,
      admin: 0,
      adminSensitive: 0,
      instructor: 0,
      escort: 0,
      accountant: 0,
      parent: 0,
    });
    await as(A.users.owner, A.orgId, async (run) => {
      await expect(run('select token_hash from staff_invites')).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('student relations: owner/admin; a parent only when both children are theirs', async () => {
    // The fixture relation links a child of the parent's household with one from another household.
    expect(await visibility('student_relations')).toEqual({
      owner: 1,
      admin: 1,
      adminSensitive: 1,
      instructor: 0,
      escort: 0,
      accountant: 0,
      parent: 0,
    });
  });

  it('import runs: owner and admins', async () => {
    expect(await visibility('import_runs')).toEqual({
      owner: 1,
      admin: 1,
      adminSensitive: 1,
      instructor: 0,
      escort: 0,
      accountant: 0,
      parent: 0,
    });
  });
});

describe('write access by role', () => {
  it('owner and admins edit venues; instructors and the accountant cannot', async () => {
    for (const role of ['owner', 'admin'] as const) {
      await as(A.users[role], A.orgId, async (run) => {
        expect(await run(`update venues set notes = 'x' returning id`)).toHaveLength(1);
      });
    }
    for (const role of ['instructor', 'accountant', 'escort'] as const) {
      await as(A.users[role], A.orgId, async (run) => {
        expect(await run(`update venues set notes = 'x' returning id`)).toEqual([]);
        await expect(
          run(
            `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
               values ($1, 'x', 'private', 'x', 30, 1)`,
            [A.orgId],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    }
  });

  it('prices and policies need settings.write: the owner yes, a plain admin no', async () => {
    const insertList = `insert into price_lists (organization_id, name, effective_from) values ($1, 'חדש', '2030-01-01') returning id`;
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await run(insertList, [A.orgId])).toHaveLength(1);
    });
    await as(A.users.admin, A.orgId, async (run) => {
      await expect(run(insertList, [A.orgId])).rejects.toThrow(/row-level security/);
    });
    await t.pool.query(
      `update memberships set permissions = '{settings.write}' where user_id = $1`,
      [A.users.admin],
    );
    try {
      await as(A.users.admin, A.orgId, async (run) => {
        expect(await run(insertList, [A.orgId])).toHaveLength(1);
      });
    } finally {
      await t.pool.query(`update memberships set permissions = '{}' where user_id = $1`, [
        A.users.admin,
      ]);
    }
  });

  it('an instructor manages their own availability but no one else’s', async () => {
    const add = `insert into availability_rules (organization_id, staff_member_id, weekday, starts_at, ends_at, effective_from)
                 values ($1, $2, 3, '16:00', '18:00', '2026-10-01') returning id`;
    await as(A.users.instructor, A.orgId, async (run) => {
      expect(await run(add, [A.orgId, A.staff.instructor])).toHaveLength(1);
      await expect(run(add, [A.orgId, A.staff.escort])).rejects.toThrow(/row-level security/);
    });
  });

  it('pay rules need payroll.write; the accountant may read but not write', async () => {
    const raise = `update pay_rules set notes = 'x' returning id`;
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await run(raise)).toHaveLength(1);
    });
    for (const role of ['accountant', 'admin', 'instructor'] as const) {
      await as(A.users[role], A.orgId, async (run) => {
        expect(await run(raise), role).toEqual([]);
      });
    }
  });
});

describe('schema guards', () => {
  it('keeps a window’s pool in the same venue and its lanes in the same pool', async () => {
    const otherVenue = (
      await t.pool.query(
        `insert into venues (organization_id, name) values ($1, 'אחרת') returning id`,
        [A.orgId],
      )
    ).rows[0].id;
    await expect(
      t.pool.query(
        `insert into venue_operating_windows (organization_id, venue_id, pool_id, weekday, starts_at, ends_at, effective_from)
         values ($1, $2, $3, 2, '10:00', '11:00', '2026-09-01')`,
        [A.orgId, otherVenue, A.core.pool],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      t.pool.query(
        `insert into operating_window_lanes (organization_id, pool_id, window_id, lane_id) values ($1, $2, $3, $4)`,
        [A.orgId, A.core.pool, A.core.window, B.core.lane],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('rejects a window that ends before it starts and an unknown gender restriction', async () => {
    const insert = (start: string, end: string, gender: string) =>
      t.pool.query(
        `insert into venue_operating_windows (organization_id, venue_id, pool_id, weekday, starts_at, ends_at, gender_restriction, effective_from)
         values ($1, $2, $3, 2, $4, $5, $6, '2026-09-01')`,
        [A.orgId, A.core.venue, A.core.pool, start, end, gender],
      );
    await expect(insert('11:00', '10:00', 'mixed')).rejects.toThrow(/windows_time_check/);
    await expect(insert('10:00', '11:00', 'adults')).rejects.toThrow(/windows_gender_check/);
  });

  it('requires the scope columns that match the scope type', async () => {
    await expect(
      t.pool.query(
        `insert into policy_sets (organization_id, scope_type, effective_from) values ($1, 'venue', '2027-01-01')`,
        [A.orgId],
      ),
    ).rejects.toThrow(/policy_sets_scope_columns_check/);
  });
});

describe('policies and prices in effect are history', () => {
  it('blocks editing a policy set in effect, but allows ending it from today', async () => {
    await expect(
      t.pool.query(`update policy_sets set rules = '{}' where id = $1`, [A.core.policySet]),
    ).rejects.toThrow(/create a new version/);
    await expect(
      t.pool.query(`delete from policy_sets where id = $1`, [A.core.policySet]),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      t.pool.query(`update policy_sets set effective_to = '2026-02-01' where id = $1`, [
        A.core.policySet,
      ]),
    ).rejects.toThrow(/create a new version/);
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query(`update policy_sets set effective_to = app.today() + 1 where id = $1`, [
        A.core.policySet,
      ]);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('lets a future version be edited and deleted', async () => {
    const id = (
      await t.pool.query(
        `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2030-01-01', '{}') returning id`,
        [A.orgId],
      )
    ).rows[0].id;
    await t.pool.query(
      `update policy_sets set rules = '{"makeup":{"max_per_month":2}}' where id = $1`,
      [id],
    );
    await t.pool.query(`delete from policy_sets where id = $1`, [id]);
  });

  it('locks the items of a published price list in effect; drafts stay editable', async () => {
    await expect(
      t.pool.query(`update price_items set amount_agorot = 1 where id = $1`, [A.core.priceItem]),
    ).rejects.toThrow(/create a new version/);
    await expect(
      t.pool.query(
        `insert into price_items (organization_id, price_list_id, program_id, kind, amount_agorot) values ($1, $2, $3, 'trial', 5000)`,
        [A.orgId, A.core.priceList, A.core.program],
      ),
    ).rejects.toThrow(/create a new version/);
    await expect(
      t.pool.query(`update price_lists set name = 'x' where id = $1`, [A.core.priceList]),
    ).rejects.toThrow(/create a new version/);
    await expect(
      t.pool.query(`update price_lists set status = 'draft' where id = $1`, [A.core.priceList]),
    ).rejects.toThrow(/create a new version/);
    await expect(
      t.pool.query(`delete from price_lists where id = $1`, [A.core.priceList]),
    ).rejects.toThrow(/cannot be deleted/);

    const draft = (
      await t.pool.query(
        `insert into price_lists (organization_id, name, effective_from) values ($1, 'טיוטה', '2026-01-01') returning id`,
        [A.orgId],
      )
    ).rows[0].id;
    const item = (
      await t.pool.query(
        `insert into price_items (organization_id, price_list_id, program_id, kind, amount_agorot) values ($1, $2, $3, 'trial', 5000) returning id`,
        [A.orgId, draft, A.core.program],
      )
    ).rows[0].id;
    await t.pool.query(`update price_items set amount_agorot = 6000 where id = $1`, [item]);
    await expect(
      t.pool.query(`update price_items set price_list_id = $2 where id = $1`, [
        item,
        A.core.priceList,
      ]),
    ).rejects.toThrow(/create a new version|cannot move/);
    await t.pool.query(`delete from price_lists where id = $1`, [draft]);
  });

  it('allows archiving a list in effect', async () => {
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query(
        `update price_lists set status = 'archived', effective_to = app.today() + 1 where id = $1`,
        [A.core.priceList],
      );
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
});

describe('staff invite acceptance', () => {
  async function newUser(email: string | null, phone: string | null = null): Promise<string> {
    return (
      await t.pool.query(`insert into auth.users (email, phone) values ($1, $2) returning id`, [
        email,
        phone,
      ])
    ).rows[0].id;
  }
  async function invite(opts: { email?: string; phone?: string; expires?: string } = {}) {
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    await t.pool.query(
      `insert into staff_invites (organization_id, role, email, phone_e164, staff_member_id, token_hash, expires_at)
       values ($1, 'instructor', $2, $3, $4, encode(sha256(convert_to($5, 'UTF8')), 'hex'), coalesce($6::timestamptz, now() + interval '7 days'))`,
      [
        A.orgId,
        opts.email ?? null,
        opts.phone ?? null,
        A.staff.instructor,
        token,
        opts.expires ?? null,
      ],
    );
    return token;
  }
  const accept = (userId: string, token: string) =>
    as(userId, null, (run) =>
      run<{ org: string }>(`select public.accept_staff_invite($1) as org`, [token]),
    );

  it('creates the membership for the invited email and cannot be reused', async () => {
    const token = await invite({ email: 'Invited@Example.test' });
    const u = await newUser('invited@example.test');
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: u }),
      ]);
      await c.query('set local role authenticated');
      const r = await c.query(`select public.accept_staff_invite($1) as org`, [token]);
      expect(r.rows[0].org).toBe(A.orgId);
      await c.query('reset role');
      const m = await c.query(`select role, staff_member_id from memberships where user_id = $1`, [
        u,
      ]);
      expect(m.rows).toEqual([{ role: 'instructor', staff_member_id: A.staff.instructor }]);
      await c.query('set local role authenticated');
      await expect(c.query(`select public.accept_staff_invite($1)`, [token])).rejects.toThrow(
        /not valid/,
      );
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('matches a phone invite against the user’s phone', async () => {
    const token = await invite({ phone: '+972500000777' });
    const right = await newUser(null, '972500000777'); // Supabase stores phones without the plus
    const [row] = await accept(right, token);
    expect(row?.org).toBe(A.orgId);
  });

  it('refuses someone else, an expired invite, an unknown token and anonymous callers', async () => {
    const token = await invite({ email: 'a@example.test' });
    await expect(accept(await newUser('b@example.test'), token)).rejects.toThrow(/someone else/);
    const expired = await invite({ email: 'c@example.test', expires: '2020-01-01T00:00:00Z' });
    await expect(accept(await newUser('c@example.test'), expired)).rejects.toThrow(/not valid/);
    await expect(accept(await newUser('d@example.test'), 'no-such-token')).rejects.toThrow(
      /not valid/,
    );
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await expect(c.query(`select public.accept_staff_invite($1)`, [token])).rejects.toThrow(
        /sign in first/,
      );
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
