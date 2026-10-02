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
      // pool.end() does not wait for every socket to close, so `drop … with (force)` can still terminate a backend
      // whose client then reports 57P01. That is the expected end of a throwaway database, not a test failure.
      pool.on('error', () => undefined);
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      // Give the closed sockets a moment to leave, so `force` rarely has anyone to terminate.
      for (let i = 0; i < 50; i++) {
        const { rows } = await c.query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where datname = $1',
          [name],
        );
        if (!rows[0]?.n) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}
