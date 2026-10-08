/**
 * Phase 0 acceptance: RLS proves tenant and role isolation.
 * Two orgs (A, B) with one user per role. Every query runs as `authenticated` with JWT claims,
 * exactly as Supabase does per request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { ids, sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'org-a');
  B = await createOrgFixture(t.pool, 'org-b');
});
afterAll(async () => {
  await t.drop();
});

const { as, asSystem } = sessions(() => t.pool);

const ROLES = [
  'owner',
  'admin',
  'adminSensitive',
  'instructor',
  'escort',
  'accountant',
  'parent',
] as const;
const TENANT_TABLES = [
  'organizations',
  'org_settings',
  'memberships',
  'feature_flags',
  'files',
  'households',
  'guardians',
  'students',
  'staff_members',
  'audit_log',
  'outbox',
  'venues',
  'venue_contracts',
  'pools',
  'lanes',
  'venue_operating_windows',
  'operating_window_lanes',
  'venue_closures',
  'programs',
  'levels',
  'policy_sets',
  'price_lists',
  'price_items',
  'certifications',
  'availability_rules',
  'availability_exceptions',
  'pay_rules',
  'staff_invites',
  'student_relations',
  'import_runs',
  'terms',
  'hebrew_calendar_overrides',
  'class_templates',
  'class_template_lanes',
  'session_generation_runs',
  'sessions',
  'session_staff',
  'enrollments',
  'private_slots',
  'slot_bookings',
  'waitlist_entries',
  'shift_changes',
  'closure_events',
  'trials',
  'form_templates',
  'form_submissions',
  'attendance',
  'makeup_credits',
  'absence_notices',
  'makeup_bookings',
  'progress_marks',
  'reimbursement_profiles',
  'household_billing',
  'enrollment_freezes',
  'cancellation_requests',
  'billing_runs',
  'billing_run_lines',
  'standing_orders',
  'payment_links',
  'payments',
  'ledger_entries',
  'fiscal_documents',
  'dunning_cases',
  'message_templates',
  'automation_rules',
  'broadcasts',
  'messages',
  'inbound_messages',
  'triage_actions',
  'timesheets',
  'payroll_runs',
  'payroll_lines',
  'payroll_adjustments',
  'sick_leave_entries',
  'substitute_requests',
  'substitute_offers',
  'applicants',
  'portal_requests',
  'schools',
  'transport_routes',
  'route_riders',
  'route_runs',
  'run_events',
  'cohorts',
  'cohort_staff',
  'institutions',
  'institution_contracts',
  'institution_contract_groups',
  'institution_invoices',
  'institution_payments',
  'venue_migrations',
  'venue_migration_items',
  'copilot_requests',
  'copilot_actions',
  'weekly_digests',
  'owner_insights',
  'org_subscriptions',
  'platform_invoices',
  'org_domains',
  'template_installs',
] as const;

describe('schema guardrails', () => {
  it('has RLS enabled on every table in public', async () => {
    const rows = (
      await t.pool.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      )
    ).rows;
    expect(rows).toEqual([]);
  });

  it('gives every org-scoped table at least one policy or no grant at all', async () => {
    const rows = (
      await t.pool.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
           and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
           and has_table_privilege('authenticated', c.oid, 'select')`,
      )
    ).rows;
    expect(rows).toEqual([]);
  });

  it('lists every org-scoped table in the tenant isolation sweep', async () => {
    const rows = (
      await t.pool.query(
        `select distinct table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'organization_id'`,
      )
    ).rows.map((r: { table_name: string }) => r.table_name);
    const infrastructure = ['org_keys', 'inbox_receipts', 'webhook_events', 'dead_letters'];
    const missing = rows.filter(
      (r) => !(TENANT_TABLES as readonly string[]).includes(r) && !infrastructure.includes(r),
    );
    expect(missing).toEqual([]);
  });

  it('never lets anon read anything', async () => {
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      await expect(c.query('select * from households')).rejects.toThrow(/permission denied/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('tenant isolation', () => {
  for (const role of ROLES) {
    it(`${role} of org A sees no row of org B in any table`, async () => {
      await as(A.users[role], A.orgId, async (run) => {
        for (const table of TENANT_TABLES) {
          const col = table === 'organizations' ? 'id' : 'organization_id';
          const rows = await run(`select 1 from ${table} where ${col} = $1`, [B.orgId]);
          expect(rows, `${role} read ${table} of org B`).toEqual([]);
        }
      });
    });
  }

  it('ignores a forged org claim for an org the user is not a member of', async () => {
    await as(A.users.owner, B.orgId, async (run) => {
      expect(await run('select id from households')).toEqual([]);
      expect(await run('select id from organizations')).toEqual([]);
    });
  });

  it('blocks writes into another org', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      await expect(
        run(`insert into households (organization_id, display_name) values ($1, 'חדירה')`, [
          B.orgId,
        ]),
      ).rejects.toThrow(/row-level security/);
      const updated = await run(
        `update households set display_name = 'x' where organization_id = $1 returning id`,
        [B.orgId],
      );
      expect(updated).toEqual([]);
      const deleted = await run(`delete from students where organization_id = $1 returning id`, [
        B.orgId,
      ]);
      expect(deleted).toEqual([]);
    });
  });

  it('cannot link a student in org A to a household of org B (composite FK)', async () => {
    await expect(
      t.pool.query(
        `insert into students (organization_id, household_id, first_name, last_name) values ($1, $2, 'x', 'y')`,
        [A.orgId, B.households.mine],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('cuts off a suspended membership immediately, even with a valid token', async () => {
    await t.pool.query(`update memberships set status = 'suspended' where user_id = $1`, [
      A.users.admin,
    ]);
    try {
      await as(A.users.admin, A.orgId, async (run) => {
        expect(await run('select id from households')).toEqual([]);
      });
    } finally {
      await t.pool.query(`update memberships set status = 'active' where user_id = $1`, [
        A.users.admin,
      ]);
    }
  });

  it('scopes the system role (worker) to the one org it was given', async () => {
    await asSystem(A.orgId, async (run) => {
      expect(ids(await run('select id from households'))).toEqual(
        [A.households.mine, A.households.other].sort(),
      );
      expect(await run('select id from households where organization_id = $1', [B.orgId])).toEqual(
        [],
      );
      await expect(
        run(`insert into households (organization_id, display_name) values ($1, 'x')`, [B.orgId]),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe('role isolation inside one org', () => {
  it('owner and admins see every household and student', async () => {
    for (const role of ['owner', 'admin'] as const) {
      await as(A.users[role], A.orgId, async (run) => {
        expect(ids(await run('select id from households'))).toEqual(
          [A.households.mine, A.households.other].sort(),
        );
        expect(ids(await run('select id from students'))).toEqual(
          [A.students.mine, A.students.other].sort(),
        );
      });
    }
  });

  it('a parent sees only their own household, its guardians and its students', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      expect(ids(await run('select id from households'))).toEqual([A.households.mine]);
      expect(ids(await run('select id from guardians'))).toEqual([A.guardians.mine]);
      expect(ids(await run('select id from students'))).toEqual([A.students.mine]);
      expect(await run('select id from staff_members')).toEqual([]);
      expect(await run('select organization_id from org_settings')).toEqual([]);
    });
  });

  it('a parent cannot change students or households', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      expect(await run(`update students set first_name = 'x' returning id`)).toEqual([]);
      await expect(
        run(`insert into households (organization_id, display_name) values ($1, 'x')`, [A.orgId]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('an instructor sees only their own staff record and (until Phase 2 sessions) no students', async () => {
    await as(A.users.instructor, A.orgId, async (run) => {
      expect(ids(await run('select id from staff_members'))).toEqual([A.staff.instructor]);
      expect(await run('select id from students')).toEqual([]);
      expect(await run('select id from households')).toEqual([]);
      expect(await run(`update staff_members set first_name = 'x' returning id`)).toEqual([]);
    });
  });

  it('an escort sees only themself', async () => {
    await as(A.users.escort, A.orgId, async (run) => {
      expect(ids(await run('select id from staff_members'))).toEqual([A.staff.escort]);
      expect(await run('select id from guardians')).toEqual([]);
    });
  });

  it('the accountant reads households and staff but not students, and cannot write', async () => {
    await as(A.users.accountant, A.orgId, async (run) => {
      expect((await run('select id from households')).length).toBe(2);
      expect((await run('select id from staff_members')).length).toBe(3);
      expect(await run('select id from students')).toEqual([]);
      expect(await run(`update households set display_name = 'x' returning id`)).toEqual([]);
    });
  });

  it('only the owner manages memberships; others see only their own', async () => {
    await as(A.users.instructor, A.orgId, async (run) => {
      const rows = await run<{ user_id: string }>('select user_id from memberships');
      expect(rows.map((r) => r.user_id)).toEqual([A.users.instructor]);
      expect(await run(`update memberships set role = 'owner' returning id`)).toEqual([]);
    });
    await as(A.users.admin, A.orgId, async (run) => {
      expect((await run('select id from memberships')).length).toBe(7);
      expect(
        await run(`update memberships set role = 'owner' where user_id = $1 returning id`, [
          A.users.admin,
        ]),
      ).toEqual([]);
    });
    await as(A.users.owner, A.orgId, async (run) => {
      expect(
        (
          await run(
            `update memberships set permissions = '{billing.read}' where user_id = $1 returning id`,
            [A.users.admin],
          )
        ).length,
      ).toBe(1);
    });
  });

  it('org settings: admins read, only owner (or settings.write) changes them', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      expect((await run('select organization_id from org_settings')).length).toBe(1);
      expect(
        await run(`update org_settings set billing_run_day = 5 returning organization_id`),
      ).toEqual([]);
    });
    await as(A.users.owner, A.orgId, async (run) => {
      expect(
        (await run(`update org_settings set billing_run_day = 5 returning organization_id`)).length,
      ).toBe(1);
    });
  });
});

describe('sensitive data', () => {
  it('no signed-in user can select encrypted columns directly', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      await expect(run('select enc_medical_notes from students')).rejects.toThrow(
        /permission denied/,
      );
      await expect(run('select enc_bank_details from staff_members')).rejects.toThrow(
        /permission denied/,
      );
      // but the rest of the row is readable
      expect((await run('select id, first_name from students')).length).toBe(2);
    });
  });

  it('read_sensitive returns the value to the owner and writes an audit record', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      const [r] = await run<{ v: Buffer }>(
        `select app.read_sensitive('students', 'enc_medical_notes', $1) as v`,
        [A.students.mine],
      );
      expect(r?.v.toString('hex')).toBe('deadbeef');
    });
    const audit = await t.pool.query(
      `select actor_id, subject_id, diff from audit_log where action = 'sensitive_read' and subject_id = $1`,
      [A.students.mine],
    );
    expect(audit.rows).toHaveLength(0); // the helper rolls back; the next test checks the entry inside the transaction
  });

  it('records the sensitive read in the same transaction', async () => {
    await as(A.users.owner, A.orgId, async (run, c) => {
      await run(`select app.read_sensitive('students', 'enc_medical_notes', $1)`, [
        A.students.mine,
      ]);
      await c.query('reset role');
      const rows = (
        await c.query(
          `select actor_id, diff from audit_log where action = 'sensitive_read' and subject_id = $1`,
          [A.students.mine],
        )
      ).rows;
      expect(rows).toEqual([
        { actor_id: A.users.owner, diff: { column: 'enc_medical_notes', found: true } },
      ]);
    });
  });

  it('denies read_sensitive without the permission, across orgs, and for non-sensitive columns', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      await expect(
        run(`select app.read_sensitive('students', 'enc_medical_notes', $1)`, [A.students.mine]),
      ).rejects.toThrow(/sensitive.read/);
    });
    await as(A.users.adminSensitive, A.orgId, async (run) => {
      const [own] = await run<{ v: Buffer | null }>(
        `select app.read_sensitive('students', 'enc_medical_notes', $1) as v`,
        [A.students.mine],
      );
      expect(own?.v).not.toBeNull();
      const [cross] = await run<{ v: Buffer | null }>(
        `select app.read_sensitive('students', 'enc_medical_notes', $1) as v`,
        [B.students.mine],
      );
      expect(cross?.v).toBeNull();
      await expect(
        run(`select app.read_sensitive('students', 'first_name', $1)`, [A.students.mine]),
      ).rejects.toThrow(/not a sensitive column/);
    });
  });

  it('keeps infrastructure tables out of reach of signed-in users', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      for (const table of ['org_keys', 'inbox_receipts', 'webhook_events', 'dead_letters']) {
        await expect(run(`select * from ${table}`), table).rejects.toThrow(/permission denied/);
      }
    });
  });
});

describe('audit log', () => {
  it('records changes with the actor and masks ciphertext', async () => {
    await as(A.users.owner, A.orgId, async (run, c) => {
      await run(
        `update students set first_name = 'יואבי', enc_medical_notes = '\\x00' where id = $1`,
        [A.students.mine],
      );
      await c.query('reset role');
      const [row] = (
        await c.query(
          `select actor_id, action, diff from audit_log where subject_type = 'students' and subject_id = $1 and action = 'update'`,
          [A.students.mine],
        )
      ).rows;
      expect(row.actor_id).toBe(A.users.owner);
      expect(row.diff.first_name).toEqual({ old: 'יואב', new: 'יואבי' });
      expect(row.diff.enc_medical_notes).toBe('[encrypted]');
    });
  });

  it('is append-only, even for the database owner', async () => {
    await expect(t.pool.query(`update audit_log set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
  });

  it('accepts app entries only for your own org and as yourself', async () => {
    await as(A.users.instructor, A.orgId, async (run) => {
      await run(
        `insert into audit_log (organization_id, actor_id, action, subject_type) values ($1, $2, 'login', 'session')`,
        [A.orgId, A.users.instructor],
      );
      await expect(
        run(
          `insert into audit_log (organization_id, actor_id, action, subject_type) values ($1, $2, 'login', 'session')`,
          [A.orgId, A.users.owner],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        run(
          `insert into audit_log (organization_id, actor_id, action, subject_type) values ($1, $2, 'login', 'session')`,
          [B.orgId, A.users.instructor],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('is readable only with audit.read', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      expect(await run('select id from audit_log')).toEqual([]);
    });
    await as(A.users.adminSensitive, A.orgId, async (run) => {
      expect((await run('select id from audit_log')).length).toBeGreaterThan(0);
    });
  });
});

describe('outbox', () => {
  it('lets any member enqueue for their own org only, and nobody read it', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      await run(
        `insert into outbox (organization_id, event_type, payload, idempotency_key) values ($1, 'core.ping', '{}', 'k1')`,
        [A.orgId],
      );
      await expect(
        run(
          `insert into outbox (organization_id, event_type, payload, idempotency_key) values ($1, 'core.ping', '{}', 'k2')`,
          [B.orgId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await run('select id from outbox')).toEqual([]);
    });
  });
});

describe('custom access-token hook', () => {
  const hook = async (userId: string) =>
    (
      await t.pool.query(`select public.custom_access_token_hook($1::jsonb) as e`, [
        JSON.stringify({ user_id: userId, claims: { sub: userId, role: 'authenticated' } }),
      ])
    ).rows[0].e.claims;

  it('adds org, role and permissions', async () => {
    expect(await hook(A.users.accountant)).toMatchObject({
      sub: A.users.accountant,
      role: 'authenticated',
      org_id: A.orgId,
      app_role: 'accountant',
      permissions: ['billing.read', 'payroll.read'],
      is_platform_admin: false,
    });
  });

  it('honours the active org chosen by a multi-org user', async () => {
    await t.pool.query(
      `insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`,
      [B.orgId, A.users.owner],
    );
    expect((await hook(A.users.owner)).org_id).toBe(A.orgId);
    await t.pool.query(
      `update auth.users set raw_app_meta_data = jsonb_build_object('active_org_id', $1::text) where id = $2`,
      [B.orgId, A.users.owner],
    );
    expect(await hook(A.users.owner)).toMatchObject({ org_id: B.orgId, app_role: 'admin' });
  });

  it('returns empty claims for a user with no membership and flags platform admins', async () => {
    const u = (
      await t.pool.query(
        `insert into auth.users (email) values ('nobody@example.test') returning id`,
      )
    ).rows[0].id;
    expect(await hook(u)).toMatchObject({
      org_id: null,
      app_role: null,
      permissions: [],
      is_platform_admin: false,
    });
    await t.pool.query(`insert into platform_admins (user_id) values ($1)`, [u]);
    expect((await hook(u)).is_platform_admin).toBe(true);
  });

  it("lists a multi-org user's memberships for the org switcher, and only theirs", async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      const rows = await run<{ organization_id: string; role: string }>(
        'select organization_id, role from public.my_memberships()',
      );
      expect(rows.map((r) => [r.organization_id, r.role]).sort()).toEqual(
        [
          [A.orgId, 'owner'],
          [B.orgId, 'admin'],
        ].sort(),
      );
    });
    await as(A.users.parent, A.orgId, async (run) => {
      expect((await run('select organization_id from public.my_memberships()')).length).toBe(1);
    });
  });

  it('cannot be called by signed-in users', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      await expect(run(`select public.custom_access_token_hook('{}'::jsonb)`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
