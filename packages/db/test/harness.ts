import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, createPool, type Db } from '../src';
import { applySupabaseShim, runMigrations } from '../src/migrate';

export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rswim:rswim@localhost:5432/postgres';

const SETUP_LOCK = 7_240_001;

export interface TestDatabase {
  url: string;
  pool: pg.Pool;
  db: Db;
  drop(): Promise<void>;
}

/** Creates a throwaway database with the shim and all migrations applied. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `rswim_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = createPool(url.toString(), 5);
  // Roles are cluster-wide, so parallel test packages setting up fresh databases race on
  // `create role`. Serialise setup with an advisory lock held on the admin database.
  await admin.query('select pg_advisory_lock($1)', [SETUP_LOCK]);
  try {
    await applySupabaseShim(pool);
    await runMigrations(pool);
  } finally {
    await admin.query('select pg_advisory_unlock($1)', [SETUP_LOCK]);
    await admin.end();
  }

  return {
    url: url.toString(),
    pool,
    db: createDb(pool),
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}
