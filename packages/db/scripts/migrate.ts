import { createPool } from '../src';
import { applySupabaseShim, runMigrations } from '../src/migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const MIGRATION_LOCK = 7_240_002;
const pool = createPool(url, 2);
// Two deploys starting together (web and worker, or a restart during a deploy) must not migrate at the same time:
// one waits on this lock while the other applies the migrations, then finds nothing left to do.
const lock = await pool.connect();
try {
  await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
  // Plain Postgres (local without Supabase, CI) needs the shim. Supabase already has auth.* and its roles.
  if (process.env.RSWIM_PLAIN_POSTGRES === '1') await applySupabaseShim(pool);
  await runMigrations(pool);
  console.log('migrations applied');
} finally {
  await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
  lock.release();
  await pool.end();
}
