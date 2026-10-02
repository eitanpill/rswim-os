/**
 * Recreates the E2E database (plain Postgres: shim, migrations, fake demo seed) before the web server starts.
 * Uses TEST_DATABASE_ADMIN_URL like the other database tests. Never points at a real environment.
 */
import pg from 'pg';
import { createPool } from '@rswim/db';
import { applySupabaseShim, runMigrations } from '@rswim/db/migrate';
import { seedDemo } from '@rswim/seed';

// A fixed, test-only master key (not a secret) so the seed and the web app agree on the fake data keys.
const E2E_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.RSWIM_MASTER_KEY = E2E_MASTER_KEY;

const admin =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rswim:rswim@localhost:5432/postgres';
const NAME = 'rswim_e2e';

const root = new pg.Client({ connectionString: admin });
await root.connect();
await root.query(`drop database if exists ${NAME} with (force)`);
await root.query(`create database ${NAME}`);
await root.end();

const url = new URL(admin);
url.pathname = `/${NAME}`;
const pool = createPool(url.toString(), 2);
try {
  await applySupabaseShim(pool);
  await runMigrations(pool);
  console.log(
    'e2e database ready',
    await seedDemo(pool, { masterKey: Buffer.from(E2E_MASTER_KEY, 'base64') }),
  );
} finally {
  await pool.end();
}
