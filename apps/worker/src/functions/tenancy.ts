/**
 * A school's own database (docs/TENANT-DATABASES.md): set up after sign-up, and kept in step with the platform's
 * database afterwards. Both run on the platform's database (CONTROL_ONLY in ../tenancy.ts) and open the school's
 * database themselves.
 */
import { schema } from '@rswim/db';
import { asPlatform } from '@rswim/db/service';
import { masterKeyFromEnv } from '@rswim/db/tenants';
import {
  checkSchoolDatabase,
  createSchoolDatabase,
  markDatabaseFailed,
  migrateSchoolDatabase,
  seedSchoolDatabase,
  syncDown,
  syncUp,
  type TenancyDeps,
} from '@rswim/domain-platform/tenancy';
import { eq } from '@rswim/db';
import { controlDb, inngest, log, router } from '../client';
import { databaseHost } from '../providers';
import { toEnvelope } from './core-ping';

/** About 10 minutes of 15-second checks; Supabase usually takes one to three. */
export const MAX_CHECKS = 40;

async function depsFor(orgId: string): Promise<TenancyDeps> {
  const masterKey = masterKeyFromEnv();
  if (!masterKey) throw new Error('RSWIM_MASTER_KEY is needed to set up a school database');
  const [row] = await asPlatform(controlDb(), (tx) =>
    tx
      .select({ provider: schema.tenantDatabases.provider })
      .from(schema.tenantDatabases)
      .where(eq(schema.tenantDatabases.organizationId, orgId)),
  );
  return { control: controlDb(), host: databaseHost(row?.provider ?? 'supabase'), masterKey, router: router() };
}

export const platformProvisionDatabase = inngest.createFunction(
  {
    id: 'platform-provision-database',
    triggers: [{ event: 'platform.database_requested' }],
    retries: 4,
    concurrency: { limit: 1, key: 'event.data.organizationId' },
    onFailure: async ({ event, error }) => {
      const orgId = (event.data.event.data as { organizationId?: string }).organizationId;
      if (orgId) await markDatabaseFailed(controlDb(), orgId, error);
      log.error({ orgId, err: error.message }, 'school database setup failed');
    },
  },
  async ({ event, step }) => {
    const orgId = toEnvelope(event).organizationId;
    const created = await step.run('create', async () => createSchoolDatabase(await depsFor(orgId), orgId));
    if (created !== 'created') return { orgId, created };

    let up = false;
    for (let i = 0; i < MAX_CHECKS && !up; i++) {
      const s = await step.run(`check-${i}`, async () => checkSchoolDatabase(await depsFor(orgId), orgId));
      if (s === 'failed') return { orgId, status: 'failed' };
      up = s === 'up';
      if (!up) await step.sleep(`wait-${i}`, '15s');
    }
    if (!up) {
      await step.run('timed-out', () =>
        markDatabaseFailed(controlDb(), orgId, new Error('the host did not bring the database up in time')),
      );
      return { orgId, status: 'failed' };
    }
    await step.run('migrate', async () => migrateSchoolDatabase(await depsFor(orgId), orgId));
    const seeded = await step.run('seed', async () => seedSchoolDatabase(await depsFor(orgId), orgId));
    log.info({ orgId, ...seeded }, 'school database ready');
    return { orgId, status: 'ready' };
  },
);

/**
 * The school's database reported a change (members, branding, domains) → copy up; the platform changed the school
 * or its subscription → copy down. A school without its own database has nothing to sync.
 */
export const platformSyncSchool = inngest.createFunction(
  {
    id: 'platform-sync-school',
    triggers: [{ event: 'platform.tenant_changed' }, { event: 'platform.org_changed' }],
    retries: 5,
    concurrency: { limit: 1, key: 'event.data.organizationId' },
  },
  async ({ event, step }) => {
    const orgId = toEnvelope(event).organizationId;
    return step.run('sync', async () => {
      if (!(await router().isDedicated(orgId))) return { orgId, synced: false };
      const school = await router().forOrg(orgId);
      if (event.name === 'platform.tenant_changed') return { orgId, ...(await syncUp(controlDb(), school, orgId)) };
      await syncDown(controlDb(), school, orgId);
      return { orgId, synced: true };
    });
  },
);
