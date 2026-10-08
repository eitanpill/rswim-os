/**
 * Rebuilds the live demo's database from scratch: drop, migrations, the fake seed, the neutral school name.
 * Run by deploy/demo/start.sh at boot, every night and on request. It deletes the whole database, so it refuses to
 * run anywhere but the demo (RSWIM_DEMO_MODE=1).
 */
import pg from 'pg';
import { createDb, createPool } from '@rswim/db';
import { demoProfile } from '@rswim/db/demo-profiles';
import { DEMO_ORG } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { applySupabaseShim, runMigrations } from '@rswim/db/migrate';
import { parseMasterKey } from '@rswim/domain-core';
import { refreshInsights, todayIL } from '@rswim/domain-reports';
import { seedDemo } from './demo';
import { rebrandLiveDemo } from './live-demo';

if (process.env.RSWIM_DEMO_MODE !== '1')
  throw new Error('Refusing to reset: RSWIM_DEMO_MODE is not 1');
if (process.env.VERCEL_ENV === 'production' || process.env.RSWIM_ENV === 'production') {
  throw new Error('Refusing to reset a production database');
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const target = new URL(url);
const name = target.pathname.slice(1);
if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected database name: ${name}`);

const started = Date.now();
const admin = new pg.Client({
  connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString(),
});
await admin.connect();
try {
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
} finally {
  await admin.end();
}

const pool = createPool(url, 2);
try {
  await applySupabaseShim(pool);
  await runMigrations(pool);
  const masterKey = process.env.RSWIM_MASTER_KEY;
  const seeded = await seedDemo(pool, masterKey ? { masterKey: parseMasterKey(masterKey) } : {});
  const profile = demoProfile();
  await rebrandLiveDemo(pool, profile);
  // The owner's home opens with this morning's insights rather than an empty feed.
  const insights = await withOrg(createDb(pool), DEMO_ORG.id, async (tx) =>
    refreshInsights(tx, { orgId: DEMO_ORG.id, userId: null }, await todayIL(tx)),
  );
  console.log(
    JSON.stringify({
      msg: 'live demo reset',
      profile: profile.key,
      ms: Date.now() - started,
      students: seeded.students,
      insights: insights?.open,
    }),
  );
} finally {
  await pool.end();
}
