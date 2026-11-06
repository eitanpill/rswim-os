/**
 * A school's own database, end to end on a local Postgres: sign-up asks for it, the worker's steps create it, run
 * every migration, copy what the school starts with, and the two databases stay in step afterwards.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createPool, sql, type Db } from '@rswim/db';
import { ADMIN_URL, createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  DatabaseRouter,
  findAcross,
  openConnection,
  SchoolDatabaseNotReady,
} from '@rswim/db/tenants';
import { LocalPostgresHost } from '@rswim/integrations';
import {
  checkSchoolDatabase,
  createSchoolDatabase,
  deleteSchoolDatabase,
  migrateSchoolDatabase,
  mirrorUsers,
  seedSchoolDatabase,
  syncDown,
  syncUp,
  type TenancyDeps,
} from '../src/tenancy';

let t: TestDatabase;
let deps: TenancyDeps;
let router: DatabaseRouter;
let host: LocalPostgresHost;
let owner: string;
let parentUser: string;
let orgId: string;
const masterKey = randomBytes(32);

const newUser = async (label: string) => {
  const id = randomUUID();
  await t.pool.query(`insert into auth.users (id, email) values ($1, $2)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
};

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) =>
  (await db.transaction((tx) => tx.execute(q))).rows as T[];

beforeAll(async () => {
  t = await createTestDatabase();
  await t.pool.query(
    `insert into plans (code, name_he, name_en, price_agorot, max_students, max_staff, max_venues, features)
     values ('solo', 'סולו', 'Solo', 9900, 50, 5, 2, '{}')`,
  );
  await t.pool.query(
    `insert into platform_settings (key, value) values ('new_school_database', 'dedicated'),
       ('tenant_database_provider', 'local')`,
  );
  owner = await newUser('owner');
  parentUser = await newUser('parent');
  host = new LocalPostgresHost(ADMIN_URL, 1);
  router = new DatabaseRouter(t.db, { masterKey: () => masterKey, ttlMs: 0 });
  deps = { control: t.db, host, masterKey, router };
});

afterAll(async () => {
  await router.close();
  const [row] = (await t.pool.query(`select project_ref from tenant_databases`)).rows as {
    project_ref: string;
  }[];
  if (row?.project_ref) await host.deleteDatabase(row.project_ref);
  await t.drop();
});

describe('a new school with its own database', () => {
  it('sign-up records the request and tells the worker', async () => {
    orgId = await asUser(t.db, { sub: owner, org_id: null }, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`select public.create_school('גלי ים', 'gali-yam', 'solo') id`,
      );
      return r.rows[0]!.id;
    });
    const reg = (
      await t.pool.query(
        `select status, provider from tenant_databases where organization_id = $1`,
        [orgId],
      )
    ).rows;
    expect(reg).toEqual([{ status: 'requested', provider: 'local' }]);
    const ev = (
      await t.pool.query(
        `select event_type from outbox where organization_id = $1 order by created_at`,
        [orgId],
      )
    ).rows.map((r) => r.event_type);
    expect(ev).toContain('platform.database_requested');
  });

  it('the school is not served from the shared database while its own one is being made', async () => {
    await expect(router.forOrg(orgId)).rejects.toBeInstanceOf(SchoolDatabaseNotReady);
    const status = await asUser(
      t.db,
      { sub: owner, org_id: orgId },
      async (tx) =>
        (
          await tx.execute<{ s: { mode: string; status: string } }>(
            sql`select public.my_school_database() s`,
          )
        ).rows[0]!.s,
    );
    expect(status).toEqual({ mode: 'dedicated', status: 'requested' });
  });

  it('creates the database once, keeping the password sealed', async () => {
    expect(await createSchoolDatabase(deps, orgId)).toBe('created');
    expect(await createSchoolDatabase(deps, orgId)).toBe('created');
    const [r] = (
      await t.pool.query(`select project_ref, connection_sealed, status from tenant_databases`)
    ).rows;
    expect(r.project_ref).toMatch(/^rswim_school_rswim_gali_yam_/);
    expect(r.status).toBe('creating');
    expect(r.connection_sealed).not.toContain('postgres');
    expect(openConnection(masterKey, r.connection_sealed).dbPass).toHaveLength(32);
  });

  it('waits until the host says the database is up, then saves its connection string', async () => {
    expect(await checkSchoolDatabase(deps, orgId)).toBe('creating');
    expect(await checkSchoolDatabase(deps, orgId)).toBe('up');
    const [r] = (await t.pool.query(`select connection_sealed, status from tenant_databases`)).rows;
    expect(r.status).toBe('migrating');
    expect(openConnection(masterKey, r.connection_sealed).url).toContain('rswim_school_');
  });

  it('runs every migration and seeds the school, then serves it', async () => {
    await migrateSchoolDatabase(deps, orgId);
    expect(await seedSchoolDatabase(deps, orgId)).toEqual({ owners: 1 });
    const school = await router.forOrg(orgId);
    expect(school).not.toBe(t.db);

    const org = await rows<{ name: string; slug: string }>(
      school,
      sql`select name, slug from organizations`,
    );
    expect(org).toEqual([{ name: 'גלי ים', slug: 'gali-yam' }]);
    const members = await rows<{ role: string }>(school, sql`select role from memberships`);
    expect(members).toEqual([{ role: 'owner' }]);
    const marker = await rows<{ value: string }>(
      school,
      sql`select value from platform_settings where key = 'database_role'`,
    );
    expect(marker).toEqual([{ value: 'tenant' }]);
    const sub = await rows<{ plan_code: string; status: string }>(
      school,
      sql`select plan_code, status from org_subscriptions`,
    );
    expect(sub).toEqual([{ plan_code: 'solo', status: 'trialing' }]);
    const keys = await rows<{ n: number }>(school, sql`select count(*)::int n from org_keys`);
    expect(keys).toEqual([{ n: 1 }]);
    // The school's defaults were added as its owner, as for any new school.
    const templates = await rows<{ n: number }>(
      school,
      sql`select count(*)::int n from message_templates`,
    );
    expect(templates[0]!.n).toBeGreaterThan(0);
    // The owner works in the school's own database with RLS as usual.
    const mine = await asUser(
      school,
      { sub: owner, org_id: orgId },
      async (tx) => (await tx.execute<{ name: string }>(sql`select name from organizations`)).rows,
    );
    expect(mine).toEqual([{ name: 'גלי ים' }]);
    // And the school's own data never lands in the platform's database.
    const shared = (
      await t.pool.query(
        `select count(*)::int n from message_templates where organization_id = $1`,
        [orgId],
      )
    ).rows[0];
    expect(shared.n).toBe(0);
  });

  it('a family that joins in the school database can sign in through the platform', async () => {
    const school = await router.forOrg(orgId);
    await mirrorUsers(t.db, school, [parentUser]);
    await school.transaction(async (tx) => {
      const hh = await tx.execute<{ id: string }>(
        sql`insert into households (organization_id, display_name) values (${orgId}, 'כהן') returning id`,
      );
      const g = await tx.execute<{ id: string }>(
        sql`insert into guardians (organization_id, household_id, first_name, last_name, relation, phone_e164)
            values (${orgId}, ${hh.rows[0]!.id}, 'דנה', 'כהן', 'mother', '+972501234567') returning id`,
      );
      await tx.execute(
        sql`insert into memberships (organization_id, user_id, role, guardian_id)
            values (${orgId}, ${parentUser}, 'parent', ${g.rows[0]!.id})`,
      );
    });
    // The school database reported the change for the worker.
    const reported = await rows<{ event_type: string }>(
      school,
      sql`select event_type from outbox where event_type = 'platform.tenant_changed'`,
    );
    expect(reported.length).toBeGreaterThan(0);

    await syncUp(t.db, school, orgId);
    const hook = (
      await t.pool.query(`select public.custom_access_token_hook($1::jsonb) e`, [
        JSON.stringify({ user_id: parentUser, claims: {} }),
      ])
    ).rows[0].e;
    expect(hook.claims).toMatchObject({ org_id: orgId, app_role: 'parent' });
    // The directory row lets the platform show the school's name to its member.
    const name = await asUser(
      t.db,
      { sub: parentUser, org_id: orgId },
      async (tx) => (await tx.execute<{ name: string }>(sql`select name from organizations`)).rows,
    );
    expect(name).toEqual([{ name: 'גלי ים' }]);

    // Leaving the school leaves the directory too.
    await school.transaction((tx) =>
      tx.execute(sql`delete from memberships where user_id = ${parentUser}`),
    );
    await syncUp(t.db, school, orgId);
    const left = (
      await t.pool.query(`select count(*)::int n from directory_memberships where user_id = $1`, [
        parentUser,
      ])
    ).rows[0];
    expect(left.n).toBe(0);
  });

  it('a plan change on the platform reaches the school database', async () => {
    await t.pool.query(
      `update org_subscriptions set status = 'active' where organization_id = $1`,
      [orgId],
    );
    const ev = (
      await t.pool.query(
        `select count(*)::int n from outbox where event_type = 'platform.org_changed'`,
      )
    ).rows[0];
    expect(ev.n).toBe(1);
    const school = await router.forOrg(orgId);
    await syncDown(t.db, school, orgId);
    expect(await rows(school, sql`select status from org_subscriptions`)).toEqual([
      { status: 'active' },
    ]);
  });

  it('jobs that sweep every school see both databases, and lookups find the right one', async () => {
    const all = await router.all();
    expect(all.map((d) => d.key)).toEqual(['control', orgId]);
    const found = await findAcross(router, async (db) => {
      const r = await rows<{ id: string }>(
        db,
        sql`select id from organizations where slug = 'gali-yam'`,
      );
      const marker = await rows(
        db,
        sql`select 1 from platform_settings where key = 'database_role'`,
      );
      return r.length && marker.length ? r[0]!.id : null;
    });
    expect(found?.key).toBe(orgId);
  });

  it('a ready database is never removed from the console', async () => {
    await expect(deleteSchoolDatabase(deps, orgId)).rejects.toThrow(/not removed/);
  });

  it('a shared school keeps working as before', async () => {
    await t.pool.query(
      `update platform_settings set value = 'shared' where key = 'new_school_database'`,
    );
    const other = await newUser('other');
    const shared = await asUser(
      t.db,
      { sub: other, org_id: null },
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`select public.create_school('בריכה', 'brecha', 'solo') id`,
          )
        ).rows[0]!.id,
    );
    expect(await router.forOrg(shared)).toBe(t.db);
    expect(await createSchoolDatabase(deps, shared)).toBe('not_requested');
  });
});

describe('the local host', () => {
  it('creates and drops a database by name', async () => {
    const h = new LocalPostgresHost(ADMIN_URL);
    const { ref } = await h.createDatabase({ name: `t-${randomUUID().slice(0, 8)}` });
    expect(await h.status(ref)).toBe('ready');
    const p = createPool(await h.connectionUrl(ref), 1);
    expect((await p.query('select 1 as one')).rows).toEqual([{ one: 1 }]);
    await p.end();
    await h.deleteDatabase(ref);
  });
});
