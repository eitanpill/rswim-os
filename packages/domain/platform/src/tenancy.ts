/**
 * A school's own database (docs/TENANT-DATABASES.md): creating it through the host (Supabase Management API, or a
 * local Postgres in tests), running every migration on it, copying in what the school starts with, and keeping it
 * in step with the platform's database (the control plane) afterwards.
 *
 * Every step is safe to run again: the worker runs them as Inngest steps and retries a failed one.
 */
import { randomBytes } from 'node:crypto';
import { asUser, createDb, createPool, eq, schema, sql, type Db, type Tx } from '@rswim/db';
import { applySupabaseShim, runMigrations } from '@rswim/db/migrate';
import {
  openConnection,
  sealConnection,
  type DatabaseRouter,
  type TenantConnection,
} from '@rswim/db/tenants';
import { createDataKey } from '@rswim/domain-core';
import type { DatabaseHost } from '@rswim/integrations';
import { provisionSchool } from './services';

export interface TenancyDeps {
  control: Db;
  host: DatabaseHost;
  masterKey: Buffer;
  router: DatabaseRouter;
}

type Row = Record<string, unknown>;

// ─── Generic row copying ─────────────────────────────────────────────────────

async function columnsOf(tx: Tx, table: string): Promise<string[]> {
  const [s, t] = table.includes('.') ? table.split('.') : ['public', table];
  const r = await tx.execute<{ column_name: string }>(
    sql`select column_name from information_schema.columns
        where table_schema = ${s} and table_name = ${t} and is_generated = 'NEVER'
        order by ordinal_position`,
  );
  return r.rows.map((c) => c.column_name);
}

const ident = (name: string) =>
  name
    .split('.')
    .map((p) => `"${p.replace(/"/g, '""')}"`)
    .join('.');

/** Reads rows as JSON (so every column type survives the trip between databases). */
async function readRows(tx: Tx, table: string, where: ReturnType<typeof sql>): Promise<Row[]> {
  const r = await tx.execute<{ j: Row }>(
    sql`select to_jsonb(t) as j from ${sql.raw(ident(table))} t where ${where}`,
  );
  return r.rows.map((x) => x.j);
}

/**
 * Inserts or updates `rows` in `table` on the conflict columns, with the columns both sides have. Returns how many
 * rows it wrote.
 */
export async function upsertRows(tx: Tx, table: string, rows: Row[], conflict: string[]): Promise<number> {
  if (rows.length === 0) return 0;
  const target = new Set(await columnsOf(tx, table));
  const cols = Object.keys(rows[0]!).filter((c) => target.has(c));
  const list = cols.map(ident).join(', ');
  const updates = cols.filter((c) => !conflict.includes(c));
  const onConflict =
    updates.length === 0
      ? 'do nothing'
      : `do update set (${updates.map(ident).join(', ')}) = row(${updates.map((c) => `excluded.${ident(c)}`).join(', ')})`;
  await tx.execute(
    sql`insert into ${sql.raw(ident(table))} (${sql.raw(list)})
        select ${sql.raw(list)} from jsonb_populate_recordset(null::${sql.raw(ident(table))}, ${JSON.stringify(rows)}::jsonb)
        on conflict (${sql.raw(conflict.map(ident).join(', '))}) ${sql.raw(onConflict)}`,
  );
  return rows.length;
}

// ─── The registry row ────────────────────────────────────────────────────────

async function registryRow(control: Db, orgId: string) {
  const [row] = await control.transaction((tx) =>
    tx.select().from(schema.tenantDatabases).where(eq(schema.tenantDatabases.organizationId, orgId)),
  );
  return row ?? null;
}

async function setRegistry(control: Db, orgId: string, change: Partial<typeof schema.tenantDatabases.$inferInsert>) {
  await control.transaction((tx) =>
    tx.update(schema.tenantDatabases).set(change).where(eq(schema.tenantDatabases.organizationId, orgId)),
  );
}

/** Records a failed step on the registry row; the platform console shows it and offers a retry. */
export async function markDatabaseFailed(control: Db, orgId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await setRegistry(control, orgId, { status: 'failed', lastError: message.slice(0, 500) });
}

function connectionOf(deps: TenancyDeps, sealed: string | null): TenantConnection {
  if (!sealed) throw new Error('school database has no sealed connection');
  return openConnection(deps.masterKey, sealed);
}

/** The project name on the host: readable in the Supabase dashboard, unique per school. */
export function projectNameFor(slug: string, orgId: string): string {
  return `rswim-${slug}`.slice(0, 40) + `-${orgId.slice(0, 8)}`;
}

// ─── Steps ───────────────────────────────────────────────────────────────────

export type CreateOutcome = 'created' | 'ready' | 'not_requested';

/** Step 1: create the project (or find it again). The password is sealed and saved before the host is called. */
export async function createSchoolDatabase(deps: TenancyDeps, orgId: string): Promise<CreateOutcome> {
  const row = await registryRow(deps.control, orgId);
  if (!row) return 'not_requested';
  if (row.status === 'ready') return 'ready';
  if (row.projectRef) return 'created';

  let sealed = row.connectionSealed;
  if (!sealed) {
    sealed = sealConnection(deps.masterKey, { dbPass: randomBytes(24).toString('base64url') });
    await setRegistry(deps.control, orgId, { connectionSealed: sealed });
  }
  const { dbPass } = connectionOf(deps, sealed);
  const [org] = await deps.control.transaction((tx) =>
    tx
      .select({ slug: schema.organizations.slug })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId)),
  );
  if (!org) throw new Error(`school ${orgId} not found`);
  await setRegistry(deps.control, orgId, {
    status: 'creating',
    attempts: sql`${schema.tenantDatabases.attempts} + 1` as unknown as number,
    lastError: null,
  });
  const created = await deps.host.createDatabase({ name: projectNameFor(org.slug, orgId), dbPass });
  await setRegistry(deps.control, orgId, { projectRef: created.ref, region: created.region });
  return 'created';
}

export type WaitOutcome = 'creating' | 'up' | 'failed';

/** Step 2 (polled): is the project up? When it is, its connection string is sealed next to the password. */
export async function checkSchoolDatabase(deps: TenancyDeps, orgId: string): Promise<WaitOutcome> {
  const row = await registryRow(deps.control, orgId);
  if (!row?.projectRef) throw new Error('school database was not created');
  if (row.status === 'ready' || row.status === 'migrating' || row.status === 'seeding') return 'up';
  const status = await deps.host.status(row.projectRef);
  if (status === 'creating') return 'creating';
  if (status === 'failed') {
    await markDatabaseFailed(deps.control, orgId, new Error(`host reports project ${row.projectRef} failed`));
    return 'failed';
  }
  const conn = connectionOf(deps, row.connectionSealed);
  const url = await deps.host.connectionUrl(row.projectRef, conn.dbPass);
  await setRegistry(deps.control, orgId, {
    status: 'migrating',
    connectionSealed: sealConnection(deps.masterKey, { ...conn, url }),
  });
  return 'up';
}

async function withSchoolPool<T>(
  deps: TenancyDeps,
  orgId: string,
  fn: (db: Db, pool: ReturnType<typeof createPool>) => Promise<T>,
) {
  const row = await registryRow(deps.control, orgId);
  const { url } = connectionOf(deps, row?.connectionSealed ?? null);
  if (!url) throw new Error('school database has no connection string yet');
  const pool = createPool(url, 2);
  try {
    return await fn(createDb(pool), pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Step 3: every migration (with the Supabase shim first on plain Postgres). */
export async function migrateSchoolDatabase(deps: TenancyDeps, orgId: string): Promise<void> {
  await withSchoolPool(deps, orgId, async (_db, pool) => {
    if (deps.host.plainPostgres) await applySupabaseShim(pool);
    await runMigrations(pool);
  });
  await setRegistry(deps.control, orgId, { status: 'seeding' });
}

/** The school's data key in the control plane (created here if the sign-up event has not made it yet). */
async function ensureDataKey(deps: TenancyDeps, orgId: string): Promise<Row[]> {
  return deps.control.transaction(async (tx) => {
    const { wrapped } = createDataKey(deps.masterKey, orgId);
    await tx
      .insert(schema.orgKeys)
      .values({ organizationId: orgId, wrappedDek: wrapped })
      .onConflictDoNothing();
    return readRows(tx, 'org_keys', sql`organization_id = ${orgId}`);
  });
}

/** Copies a user's sign-in row into the school's database (memberships and invites point at it). */
export async function mirrorUsers(control: Db, school: Db, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const users = await control.transaction((tx) =>
    readRows(tx, 'auth.users', sql`id in (${sql.join(userIds.map((u) => sql`${u}::uuid`), sql`, `)})`),
  );
  await school.transaction((tx) => upsertRows(tx, 'auth.users', users, ['id']));
}

/** Platform rows the school reads but the control plane owns: the school itself, plans, its subscription, templates. */
export async function syncDown(control: Db, school: Db, orgId: string): Promise<void> {
  const data = await control.transaction(async (tx) => ({
    org: await readRows(tx, 'organizations', sql`id = ${orgId}`),
    plans: await readRows(tx, 'plans', sql`true`),
    sub: await readRows(tx, 'org_subscriptions', sql`organization_id = ${orgId}`),
    templates: (await readRows(tx, 'templates', sql`status = 'published'`)).map((t) => ({
      ...t,
      source_organization_id: t.source_organization_id === orgId ? orgId : null,
    })),
  }));
  await school.transaction(async (tx) => {
    await upsertRows(tx, 'organizations', data.org, ['id']);
    await upsertRows(tx, 'plans', data.plans, ['code']);
    await upsertRows(tx, 'org_subscriptions', data.sub, ['organization_id']);
    await upsertRows(tx, 'templates', data.templates, ['id']);
  });
}

/**
 * What sign-in and the white-label host lookup need from the school's database: who belongs (into the directory),
 * its branding and its domains.
 */
export async function syncUp(control: Db, school: Db, orgId: string): Promise<{ members: number }> {
  const data = await school.transaction(async (tx) => ({
    members: await readRows(tx, 'memberships', sql`organization_id = ${orgId}`),
    settings: await readRows(tx, 'org_settings', sql`organization_id = ${orgId}`),
    domains: await readRows(tx, 'org_domains', sql`organization_id = ${orgId}`),
  }));
  await control.transaction(async (tx) => {
    const dir = data.members.map((m) => ({
      organization_id: orgId,
      user_id: m.user_id,
      role: m.role,
      permissions: m.permissions,
      status: m.status,
    }));
    await upsertRows(tx, 'directory_memberships', dir, ['organization_id', 'user_id']);
    const keep = dir.map((d) => d.user_id as string);
    await tx.execute(
      keep.length
        ? sql`delete from directory_memberships where organization_id = ${orgId}
              and user_id not in (${sql.join(keep.map((u) => sql`${u}::uuid`), sql`, `)})`
        : sql`delete from directory_memberships where organization_id = ${orgId}`,
    );
    await upsertRows(tx, 'org_settings', data.settings, ['organization_id']);
    await upsertRows(tx, 'org_domains', data.domains, ['id']);
    const hosts = data.domains.map((d) => d.id as string);
    await tx.execute(
      hosts.length
        ? sql`delete from org_domains where organization_id = ${orgId}
              and id not in (${sql.join(hosts.map((h) => sql`${h}::uuid`), sql`, `)})`
        : sql`delete from org_domains where organization_id = ${orgId}`,
    );
  });
  return { members: data.members.length };
}

/**
 * Step 4: what the school starts with. The marker first (so the school's database reports its changes upward),
 * then the platform rows, its data key, the owner's sign-in row and membership, and the school's defaults added as
 * the owner, exactly as a shared school gets them at sign-up.
 */
export async function seedSchoolDatabase(deps: TenancyDeps, orgId: string): Promise<{ owners: number }> {
  const key = await ensureDataKey(deps, orgId);
  const [settings, members] = await deps.control.transaction(async (tx) => [
    await readRows(tx, 'org_settings', sql`organization_id = ${orgId}`),
    await readRows(tx, 'memberships', sql`organization_id = ${orgId}`),
  ]);
  const owners = members.filter((m) => m.role === 'owner');

  const owner = await withSchoolPool(deps, orgId, async (school) => {
    await school.transaction((tx) =>
      upsertRows(tx, 'platform_settings', [{ key: 'database_role', value: 'tenant' }], ['key']),
    );
    await syncDown(deps.control, school, orgId);
    await mirrorUsers(deps.control, school, members.map((m) => m.user_id as string));
    await school.transaction(async (tx) => {
      await upsertRows(tx, 'org_settings', settings, ['organization_id']);
      await upsertRows(tx, 'org_keys', key, ['organization_id']);
      await upsertRows(
        tx,
        'memberships',
        members.map((m) => ({ ...m, staff_member_id: null, guardian_id: null })),
        ['organization_id', 'user_id'],
      );
    });
    const first = owners[0]?.user_id as string | undefined;
    if (first) {
      await asUser(school, { sub: first, org_id: orgId }, (tx) => provisionSchool(tx, { orgId, userId: first }));
    }
    await syncUp(deps.control, school, orgId);
    return first;
  });

  await setRegistry(deps.control, orgId, { status: 'ready', readyAt: new Date(), lastError: null });
  deps.router.invalidate();
  return { owners: owner ? owners.length : 0 };
}

/**
 * Removes a database that never became ready (and its registry row), so the school can be set up again. A ready
 * database holds the school's data and is never removed from here.
 */
export async function deleteSchoolDatabase(deps: TenancyDeps, orgId: string): Promise<void> {
  const row = await registryRow(deps.control, orgId);
  if (!row) return;
  if (row.status === 'ready') throw new Error('a ready school database is not removed');
  if (row.projectRef) await deps.host.deleteDatabase(row.projectRef);
  await deps.control.transaction((tx) =>
    tx.delete(schema.tenantDatabases).where(eq(schema.tenantDatabases.organizationId, orgId)),
  );
  deps.router.invalidate();
}
