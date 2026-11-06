/**
 * A school's own database, as the web app sees it (docs/TENANT-DATABASES.md): the platform console's list and switch,
 * and the "getting your system ready" screen. Everything goes through security-definer functions in the platform's
 * database; the sealed connection strings never leave it.
 */
import { z } from 'zod';
import { SchoolDatabaseMode, type TenantDatabaseStatus } from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';

export interface SchoolDatabaseRow {
  organizationId: string;
  name: string;
  slug: string;
  provider: string;
  status: TenantDatabaseStatus;
  projectRef: string | null;
  region: string | null;
  attempts: number;
  lastError: string | null;
  readyAt: string | null;
  createdAt: string;
}

export async function listSchoolDatabases(tx: Tx): Promise<SchoolDatabaseRow[]> {
  const r = await tx.execute<Record<string, unknown>>(
    sql`select * from public.platform_school_databases()`,
  );
  return r.rows.map((x) => ({
    organizationId: String(x.organization_id),
    name: String(x.name),
    slug: String(x.slug),
    provider: String(x.provider),
    status: x.status as TenantDatabaseStatus,
    projectRef: (x.project_ref as string | null) ?? null,
    region: (x.region as string | null) ?? null,
    attempts: Number(x.attempts),
    lastError: (x.last_error as string | null) ?? null,
    readyAt: x.ready_at ? String(x.ready_at) : null,
    createdAt: String(x.created_at),
  }));
}

export async function databaseSettings(
  tx: Tx,
): Promise<{ newSchoolDatabase: SchoolDatabaseMode; provider: string }> {
  const r = await tx.execute<{ s: { newSchoolDatabase: SchoolDatabaseMode; provider: string } }>(
    sql`select public.platform_database_settings() as s`,
  );
  const s = r.rows[0]?.s;
  if (!s) throw new Error('platform_database_settings returned nothing');
  return s;
}

export const NewSchoolDatabaseInput = z.object({ mode: SchoolDatabaseMode });

export async function setNewSchoolDatabase(tx: Tx, mode: SchoolDatabaseMode): Promise<void> {
  await tx.execute(sql`select public.platform_set_new_school_database(${mode})`);
}

export async function retrySchoolDatabase(tx: Tx, orgId: string): Promise<void> {
  await tx.execute(sql`select public.platform_retry_school_database(${orgId}::uuid)`);
}

/** The signed-in member's school: 'shared', or its own database's status. */
export async function mySchoolDatabase(
  tx: Tx,
): Promise<{ mode: SchoolDatabaseMode; status: TenantDatabaseStatus }> {
  const r = await tx.execute<{ s: { mode: SchoolDatabaseMode; status: TenantDatabaseStatus } }>(
    sql`select public.my_school_database() as s`,
  );
  return r.rows[0]?.s ?? { mode: 'shared', status: 'ready' };
}
