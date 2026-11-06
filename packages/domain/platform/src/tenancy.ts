/**
 * A school's own database (docs/TENANT-DATABASES.md): creating it through the host (Supabase Management API, or a
 * local Postgres in tests), running every migration on it, copying in what the school starts with, and keeping it
 * in step with the platform's database (the control plane) afterwards.
 *
 * Every step is safe to run again: the worker runs them as Inngest steps and retries a failed one.
 */
import { randomBytes } from 'node:crypto';
import { asUser, createDb, createPool, eq, schema, sql, type Db } from '@rswim/db';
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
import { mirrorUsers, readRows, syncDown, syncUp, upsertRows } from './sync';

export { mirrorUsers, syncDown, syncUp, upsertRows };

export interface TenancyDeps {
  control: Db;
  host: DatabaseHost;
  masterKey: Buffer;
  router: DatabaseRouter;
}

type Row = Record<string, unknown>;

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
