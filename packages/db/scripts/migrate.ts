import { applySupabaseShim, createPool, runMigrations } from '../src';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const pool = createPool(url, 1);
try {
  // Plain Postgres (local without Supabase, CI) needs the shim. Supabase already has auth.* and its roles.
  if (process.env.RSWIM_PLAIN_POSTGRES === '1') await applySupabaseShim(pool);
  await runMigrations(pool);
  console.log('migrations applied');
} finally {
  await pool.end();
}
